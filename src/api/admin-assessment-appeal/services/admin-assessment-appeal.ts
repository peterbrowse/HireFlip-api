import { errors, validateZodSchema, z } from '@strapi/utils';
import { publishAdminRealtimeEvent } from '../../../utils/admin-realtime-events';
import {
  publishCandidateClassRealtimeEvent,
  publishClassRealtimeEvent,
} from '../../../utils/class-realtime-events';
import { subtractWorkingDays, workingDayWindow } from '../../../utils/working-days';

const { ForbiddenError, ValidationError } = errors;

type RequestContext = {
  ipAddress?: string;
  requestId?: string;
  serviceName?: string;
  userAgent?: string;
};

type AdminSession = {
  user: {
    displayName: string;
    email: string;
    id: string;
    roleKeys: string[];
    roles: string[];
  };
};

type AdminAuthService = {
  getSession(input: unknown, context: RequestContext): Promise<AdminSession>;
};

type AdminReviewClaimService = {
  assertActiveClaimForSession(input: unknown, session: AdminSession): Promise<unknown>;
  claimForSession(
    input: unknown,
    session: AdminSession,
    context: RequestContext
  ): Promise<{ reviewClaim: unknown }>;
};

type AuditEventService = {
  record(input: Record<string, unknown>): Promise<unknown>;
};

type NotificationServiceQueueResponse = {
  data?: {
    jobId?: unknown;
    queued?: unknown;
  };
};

type DocumentRecord = Record<string, unknown> & {
  answerPayload?: unknown;
  appealState?: string;
  attemptLimit?: number;
  attemptNumber?: number;
  attemptState?: string;
  beganClassAt?: string;
  candidate?: DocumentRecord;
  candidateState?: string;
  class?: DocumentRecord;
  completedAt?: string;
  completionStatus?: string;
  correctAnswerPayload?: unknown;
  course?: DocumentRecord;
  courseCompletionDeadline?: string;
  courseDeadlineExtensionSeconds?: number;
  courseModule?: DocumentRecord;
  courseQuestion?: DocumentRecord;
  courseSection?: DocumentRecord;
  courseTest?: DocumentRecord;
  courseTestAttempt?: DocumentRecord;
  createdAt?: string;
  decision?: string;
  displayTitle?: string;
  documentId?: string;
  email?: string;
  enrollment?: DocumentRecord;
  enrollmentState?: string;
  eventCategory?: string;
  eventType?: string;
  feedback?: string;
  firstName?: string;
  flagState?: string;
  id?: number | string;
  lastName?: string;
  maxScore?: number;
  metadata?: unknown;
  name?: string;
  options?: unknown;
  passMark?: number;
  passMarkSnapshot?: number;
  passStatus?: string;
  passed?: boolean;
  phone?: string;
  prompt?: string;
  questionType?: string;
  reason?: string;
  resultState?: string;
  retryEligibilityState?: string;
  retryType?: string;
  reviewedAt?: string;
  reviewedByAdminId?: string;
  score?: number;
  scoringRubric?: unknown;
  severity?: string;
  sortOrder?: number;
  submittedAt?: string;
  subjectDisplayName?: string;
  subjectId?: string;
  subjectType?: string;
  title?: string;
  updatedAt?: string;
  version?: string;
};

type DocumentCollection = {
  count(input: Record<string, unknown>): Promise<number>;
  create(input: Record<string, unknown>): Promise<DocumentRecord>;
  findMany(input: Record<string, unknown>): Promise<DocumentRecord[]>;
  update(input: Record<string, unknown>): Promise<DocumentRecord>;
};

type StrapiDocumentService = {
  documents(uid: string): unknown;
  log?: {
    error?: (message: string, error?: unknown) => void;
  };
  service(uid: string): unknown;
};

const activeAppealStates = ['submitted', 'under_review'] as const;
const appealStateFilters = ['all', ...activeAppealStates] as const;
const priorityFilters = ['all', 'low', 'normal', 'high', 'urgent'] as const;
type ActiveAppealState = typeof activeAppealStates[number];

const isActiveAppealState = (value: unknown): value is ActiveAppealState =>
  activeAppealStates.includes(String(value || '') as ActiveAppealState);

const listSchema = z
  .object({
    appealState: z.enum(appealStateFilters).default('all'),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(10).max(100).default(25),
    priority: z.enum(priorityFilters).default('all'),
    search: z.string().trim().max(120).optional().transform((value) => value || undefined),
    sessionToken: z.string().trim().min(32).max(512),
  })
  .strict();

const detailSchema = listSchema
  .extend({
    taskKey: z.string().trim().min(1).max(220),
  })
  .strict();

const approveSchema = detailSchema
  .extend({
    message: z.string().trim().max(4000).optional(),
    reviewClaimToken: z.string().trim().min(32).max(160).optional(),
  })
  .strict();

const rejectSchema = detailSchema
  .extend({
    message: z.string().trim().min(10).max(4000),
    reviewClaimToken: z.string().trim().min(32).max(160).optional(),
  })
  .strict();

const validateList = validateZodSchema(listSchema);
const validateDetail = validateZodSchema(detailSchema);
const validateApprove = validateZodSchema(approveSchema);
const validateReject = validateZodSchema(rejectSchema);

const documents = (strapi: StrapiDocumentService, uid: string) =>
  strapi.documents(uid) as unknown as DocumentCollection;

const findAllDocuments = async (
  strapi: StrapiDocumentService,
  uid: string,
  input: Record<string, unknown>,
  pageSize = 100
) => {
  const collection = documents(strapi, uid);
  const total = await collection.count({ filters: input.filters || {} });
  const records: DocumentRecord[] = [];

  for (let start = 0; start < total; start += pageSize) {
    records.push(
      ...(await collection.findMany({
        ...input,
        limit: pageSize,
        start,
      }))
    );
  }

  return records;
};

const adminAuthService = (strapi: StrapiDocumentService) =>
  strapi.service('api::admin-auth.admin-auth') as unknown as AdminAuthService;

const reviewClaimService = (strapi: StrapiDocumentService) =>
  strapi.service('api::admin-review-claim.admin-review-claim') as unknown as AdminReviewClaimService;

const auditEvents = (strapi: StrapiDocumentService) =>
  strapi.service('api::audit-event.audit-event') as unknown as AuditEventService;

const assessmentAppealResponseWorkingDays = 14;

const getDocumentId = (record?: DocumentRecord | null) => {
  if (!record) {
    return undefined;
  }

  return typeof record.documentId === 'string'
    ? record.documentId
    : typeof record.id === 'number' || typeof record.id === 'string'
      ? String(record.id)
      : undefined;
};

const relationConnect = (record?: DocumentRecord | null) =>
  getDocumentId(record) ? { connect: [{ documentId: getDocumentId(record) }] } : undefined;

const objectValue = (value: unknown) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

const getIntegerEnv = (name: string, fallback: number) => {
  const parsedValue = Number.parseInt(process.env[name] || '', 10);

  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : fallback;
};

const byDocumentId = async (
  strapi: StrapiDocumentService,
  uid: string,
  documentId?: string,
  populate: string[] = []
) => {
  if (!documentId) {
    return undefined;
  }

  const records = await documents(strapi, uid).findMany({
    filters: {
      documentId,
    },
    limit: 1,
    populate,
  });

  return records[0];
};

const candidateDisplayName = (candidate?: DocumentRecord | null) => {
  if (!candidate) {
    return undefined;
  }

  const firstName = typeof candidate.firstName === 'string' ? candidate.firstName.trim() : '';
  const lastName = typeof candidate.lastName === 'string' ? candidate.lastName.trim() : '';
  const fullName = `${firstName} ${lastName}`.trim();

  return fullName || (typeof candidate.email === 'string' ? candidate.email : undefined);
};

const candidateFirstName = (candidate?: DocumentRecord | null) =>
  typeof candidate?.firstName === 'string' && candidate.firstName.trim()
    ? candidate.firstName.trim()
    : 'there';

const assessmentAppealTaskKey = (appealDocumentId: string) => `assessment-appeal:${appealDocumentId}`;
const assessmentAppealTaskPath = (taskKey: string) => {
  const [, appealDocumentId] = taskKey.split(':');

  return `/classes/appeals/${encodeURIComponent(appealDocumentId || taskKey)}`;
};
const candidateCourseUrl = () =>
  `${trimTrailingSlash(process.env.CANDIDATE_DASHBOARD_BASE_URL || 'http://localhost:3001')}/course`;

const scorePercent = (score?: number, maxScore?: number) =>
  typeof score === 'number' && typeof maxScore === 'number' && maxScore > 0
    ? Math.round((score / maxScore) * 100)
    : null;

const formatReviewElapsed = (seconds: number) => {
  if (seconds >= 86400) {
    const days = Math.ceil(seconds / 86400);
    return `${days} day${days === 1 ? '' : 's'}`;
  }

  if (seconds >= 3600) {
    const hours = Math.ceil(seconds / 3600);
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }

  return 'the review time';
};

const selectedIds = (value: unknown) =>
  Array.isArray(value)
    ? Array.from(new Set(
        value
          .filter((item): item is string => typeof item === 'string' && item.trim() !== '')
          .map((item) => item.trim())
      )).sort()
    : [];

const optionsById = (question?: DocumentRecord | null) => {
  const options = Array.isArray(question?.options) ? question.options : [];
  const map = new Map<string, string>();

  options.forEach((option) => {
    const payload = objectValue(option);
    const id = typeof payload.id === 'string' ? payload.id : undefined;
    const label = typeof payload.label === 'string' ? payload.label : id;

    if (id && label) {
      map.set(id, label);
    }
  });

  return map;
};

const labelsForIds = (ids: string[], question?: DocumentRecord | null) => {
  const labels = optionsById(question);

  return ids.map((id) => labels.get(id) || id);
};

const assertAssessmentAppealSession = async (
  strapi: StrapiDocumentService,
  sessionToken: string,
  context: RequestContext
) => {
  const session = await adminAuthService(strapi).getSession({ sessionToken }, context);
  const canReviewAppeals = session.user.roleKeys.some((roleKey) =>
    ['admin', 'super_admin'].includes(roleKey)
  );

  if (!canReviewAppeals) {
    throw new ForbiddenError('Admin or Super Admin access is required.');
  }

  return session;
};

const requestNotificationServiceEmail = async ({
  correlationId,
  template,
  to,
  type,
}: {
  correlationId?: string;
  template: {
    key: string;
    variables?: Record<string, unknown>;
  };
  to: string;
  type: string;
}): Promise<NotificationServiceQueueResponse> => {
  const baseUrl = process.env.NOTIFICATION_SERVICE_URL;
  const serviceToken = process.env.NOTIFICATION_SERVICE_TOKEN;

  if (!baseUrl || !serviceToken) {
    throw new Error('Notification service is not configured.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    getIntegerEnv('NOTIFICATION_SERVICE_TIMEOUT_MS', 5000)
  );

  try {
    const response = await fetch(`${trimTrailingSlash(baseUrl)}/api/internal/notifications/email`, {
      body: JSON.stringify({
        correlationId,
        priority: 'high',
        source: 'core-api',
        template,
        to,
        type,
      }),
      headers: {
        'content-type': 'application/json',
        'x-hireflip-service-name': 'core-api',
        'x-hireflip-service-token': serviceToken,
      },
      method: 'POST',
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => null)) as NotificationServiceQueueResponse | null;

    if (!response.ok || !payload?.data) {
      throw new Error('Candidate assessment appeal notification could not be queued.');
    }

    return payload;
  } finally {
    clearTimeout(timeout);
  }
};

const publishAssessmentAppealChange = async (strapi: StrapiDocumentService, taskKey?: string) => {
  await publishAdminRealtimeEvent(
    {
      channels: ['operations'],
      resourceKey: taskKey,
      resourceType: 'assessment_appeal',
      type: 'assessment_appeals_changed',
    },
    strapi.log
  );
  await publishAdminRealtimeEvent(
    {
      channels: ['operations'],
      resourceKey: taskKey,
      resourceType: 'admin_task',
      type: 'admin_tasks_changed',
    },
    strapi.log
  );
};

const publishCandidateCourseChange = async (
  strapi: StrapiDocumentService,
  candidate?: DocumentRecord,
  classRecord?: DocumentRecord
) => {
  if (candidate?.documentId) {
    await publishCandidateClassRealtimeEvent(
      {
        candidateDocumentId: candidate.documentId,
        classDocumentId: classRecord?.documentId,
        type: 'class_relationship_updated',
      },
      strapi.log
    );
  }

  if (classRecord?.documentId) {
    await publishClassRealtimeEvent(
      {
        candidateDocumentId: candidate?.documentId,
        classDocumentId: classRecord.documentId,
        type: 'class_relationship_updated',
      },
      strapi.log
    );
  }
};

const publicCandidate = (candidate?: DocumentRecord | null) =>
  candidate
    ? {
        displayName: candidateDisplayName(candidate) || 'Candidate',
        documentId: getDocumentId(candidate) || null,
        email: candidate.email || null,
        phone: candidate.phone || null,
        state: candidate.candidateState || null,
      }
    : null;

const publicClass = (classRecord?: DocumentRecord | null) =>
  classRecord
    ? {
        displayTitle: classRecord.displayTitle || classRecord.name || 'Class',
        documentId: getDocumentId(classRecord) || null,
        state: classRecord.state || null,
      }
    : null;

const publicEnrollment = (enrollment?: DocumentRecord | null) =>
  enrollment
    ? {
        beganClassAt: enrollment.beganClassAt || null,
        completionStatus: enrollment.completionStatus || null,
        courseCompletionDeadline: enrollment.courseCompletionDeadline || null,
        courseDeadlineExtensionSeconds: enrollment.courseDeadlineExtensionSeconds || 0,
        documentId: getDocumentId(enrollment) || null,
        enrollmentState: enrollment.enrollmentState || null,
        passStatus: enrollment.passStatus || null,
      }
    : null;

const publicCourse = (course?: DocumentRecord | null) =>
  course
    ? {
        documentId: getDocumentId(course) || null,
        name: course.name || null,
        version: course.version || null,
      }
    : null;

const publicCourseSection = (section?: DocumentRecord | null) =>
  section
    ? {
        documentId: getDocumentId(section) || null,
        sortOrder: section.sortOrder ?? null,
        title: section.title || null,
      }
    : null;

const publicCourseModule = (module?: DocumentRecord | null) =>
  module
    ? {
        documentId: getDocumentId(module) || null,
        sortOrder: module.sortOrder ?? null,
        title: module.title || null,
      }
    : null;

const publicCourseTest = (test?: DocumentRecord | null) =>
  test
    ? {
        attemptLimit: test.attemptLimit ?? null,
        documentId: getDocumentId(test) || null,
        maxScore: test.maxScore ?? null,
        passMark: test.passMark ?? null,
        title: test.title || null,
      }
    : null;

const publicAttempt = (attempt?: DocumentRecord | null) =>
  attempt
    ? {
        attemptNumber: attempt.attemptNumber ?? null,
        attemptState: attempt.attemptState || null,
        documentId: getDocumentId(attempt) || null,
        maxScore: attempt.maxScore ?? null,
        passed: attempt.passed ?? null,
        passMarkSnapshot: attempt.passMarkSnapshot ?? null,
        retryEligibilityState: attempt.retryEligibilityState || null,
        retryType: attempt.retryType || null,
        score: attempt.score ?? null,
        scorePercent: scorePercent(attempt.score, attempt.maxScore),
        submittedAt: attempt.submittedAt || null,
      }
    : null;

const publicAppeal = (appeal: DocumentRecord) => ({
  appealState: appeal.appealState || null,
  decision: appeal.decision || null,
  documentId: getDocumentId(appeal) || null,
  reason: appeal.reason || null,
  responseSla: workingDayWindow({
    days: assessmentAppealResponseWorkingDays,
    from: appeal.submittedAt || appeal.createdAt,
  }),
  reviewedAt: appeal.reviewedAt || null,
  reviewedByAdminId: appeal.reviewedByAdminId || null,
  submittedAt: appeal.submittedAt || appeal.createdAt || null,
});

const publicAnswerSubmission = (answer: DocumentRecord) => {
  const question = answer.courseQuestion;
  const selectedOptionIds = selectedIds(objectValue(answer.answerPayload).selectedOptionIds);
  const correctOptionIds = selectedIds(objectValue(question?.correctAnswerPayload).correctOptionIds);

  return {
    correctOptionIds,
    correctOptionLabels: labelsForIds(correctOptionIds, question),
    documentId: getDocumentId(answer) || null,
    feedback: answer.feedback || null,
    flagState: answer.flagState || null,
    question: question
      ? {
          documentId: getDocumentId(question) || null,
          prompt: question.prompt || null,
          questionType: question.questionType || null,
          sortOrder: question.sortOrder ?? null,
        }
      : null,
    score: answer.score ?? null,
    selectedOptionIds,
    selectedOptionLabels: labelsForIds(selectedOptionIds, question),
    submittedAt: answer.submittedAt || null,
  };
};

const publicAuditEvent = (event: DocumentRecord) => ({
  eventCategory: event.eventCategory || null,
  eventType: event.eventType || 'audit.event',
  occurredAt: event.occurredAt || event.createdAt || null,
  severity: event.severity || 'info',
  subjectDisplayName: event.subjectDisplayName || null,
  subjectId: event.subjectId || null,
  subjectType: event.subjectType || null,
});

const appealDocumentIdFromTaskKey = (taskKey: string) => {
  const [prefix, documentId] = taskKey.split(':');

  return prefix === 'assessment-appeal' && documentId ? documentId : undefined;
};

const findAppealByDocumentId = async (
  strapi: StrapiDocumentService,
  appealDocumentId?: string,
  states = activeAppealStates
) => {
  if (!appealDocumentId) {
    return undefined;
  }

  const appeals = await documents(strapi, 'api::assessment-appeal.assessment-appeal').findMany({
    filters: {
      appealState: {
        $in: states,
      },
      documentId: appealDocumentId,
    },
    limit: 1,
    populate: ['candidate', 'courseTestAttempt', 'enrollment'],
  });

  return appeals[0];
};

const hydrateAppealContext = async (strapi: StrapiDocumentService, appeal: DocumentRecord) => {
  const attempt = getDocumentId(appeal.courseTestAttempt)
    ? await byDocumentId(
        strapi,
        'api::course-test-attempt.course-test-attempt',
        getDocumentId(appeal.courseTestAttempt),
        ['candidate', 'courseTest', 'enrollment']
      )
    : undefined;
  const enrollment = getDocumentId(appeal.enrollment || attempt?.enrollment)
    ? await byDocumentId(
        strapi,
        'api::enrollment.enrollment',
        getDocumentId(appeal.enrollment || attempt?.enrollment),
        ['candidate', 'class']
      )
    : undefined;
  const candidate = appeal.candidate || attempt?.candidate || enrollment?.candidate;
  const courseTest = getDocumentId(attempt?.courseTest)
    ? await byDocumentId(strapi, 'api::course-test.course-test', getDocumentId(attempt?.courseTest), [
        'course',
        'courseModule',
      ])
    : undefined;
  const courseModule = getDocumentId(courseTest?.courseModule)
    ? await byDocumentId(
        strapi,
        'api::course-module.course-module',
        getDocumentId(courseTest?.courseModule),
        ['courseSection']
      )
    : undefined;
  const courseSection = getDocumentId(courseModule?.courseSection)
    ? await byDocumentId(
        strapi,
        'api::course-section.course-section',
        getDocumentId(courseModule?.courseSection),
        ['course']
      )
    : undefined;
  const course = courseTest?.course || courseSection?.course;
  const testResults = getDocumentId(attempt)
    ? await documents(strapi, 'api::course-test-result.course-test-result').findMany({
        filters: {
          courseTestAttempt: {
            documentId: getDocumentId(attempt),
          },
        },
        limit: 1,
        populate: ['courseTest', 'courseTestAttempt'],
        sort: ['updatedAt:desc', 'createdAt:desc'],
      })
    : [];

  return {
    appeal,
    attempt,
    candidate,
    classRecord: enrollment?.class,
    course,
    courseModule,
    courseSection,
    courseTest,
    enrollment,
    testResult: testResults[0],
  };
};

type AppealContext = Awaited<ReturnType<typeof hydrateAppealContext>>;

const reviewSummary = (context: AppealContext) => {
  const candidateName = candidateDisplayName(context.candidate) || 'Candidate';
  const testTitle = context.courseTest?.title || 'course assessment';
  const attemptNumber = typeof context.attempt?.attemptNumber === 'number'
    ? ` after attempt ${context.attempt.attemptNumber}`
    : '';

  return `${candidateName} appealed ${testTitle}${attemptNumber}.`;
};

const publicReview = (context: AppealContext) => {
  const appealDocumentId = getDocumentId(context.appeal) || '';
  const taskKey = assessmentAppealTaskKey(appealDocumentId);
  const title = 'Assessment appeal review';
  const canAction = isActiveAppealState(context.appeal.appealState);
  const responseSla = workingDayWindow({
    days: assessmentAppealResponseWorkingDays,
    from: context.appeal.submittedAt || context.appeal.createdAt,
  });

  return {
    actionPath: assessmentAppealTaskPath(taskKey),
    actions: {
      canApprove: canAction,
      canReject: canAction,
    },
    appeal: publicAppeal(context.appeal),
    attempt: publicAttempt(context.attempt),
    candidate: publicCandidate(context.candidate),
    class: publicClass(context.classRecord),
    course: publicCourse(context.course),
    courseModule: publicCourseModule(context.courseModule),
    courseSection: publicCourseSection(context.courseSection),
    courseTest: publicCourseTest(context.courseTest),
    createdAt: context.appeal.createdAt || null,
    enrollment: publicEnrollment(context.enrollment),
    priority: responseSla.isOverdue ? 'urgent' : 'high',
    sourceDocumentId: appealDocumentId,
    sourceType: 'assessment_appeal',
    responseSla,
    summary: reviewSummary(context),
    taskKey,
    title,
    updatedAt: context.appeal.updatedAt || null,
  };
};

type ListBody = ReturnType<typeof validateList>;

const hydrateReviews = async (strapi: StrapiDocumentService, appeals: DocumentRecord[]) => {
  const contexts = await Promise.all(appeals.map((appeal) => hydrateAppealContext(strapi, appeal)));

  return contexts
    .map(publicReview)
    .sort(
      (left, right) =>
        new Date(right.appeal.submittedAt || right.createdAt || 0).getTime() -
        new Date(left.appeal.submittedAt || left.createdAt || 0).getTime()
    );
};

const activeAppealFilter = () => ({
  appealState: {
    $in: activeAppealStates,
  },
});

const containsFilter = (value: string) => ({
  $containsi: value,
});

const appendAndFilter = (filters: Record<string, unknown>, nextFilter: Record<string, unknown>) => {
  filters.$and = [...((filters.$and as Record<string, unknown>[] | undefined) || []), nextFilter];
};

const appealSlaThreshold = (workingDays: number) =>
  subtractWorkingDays(new Date(), workingDays)?.toISOString();

const applyPriorityFilter = (filters: Record<string, unknown>, priority: ListBody['priority']) => {
  if (priority === 'all') {
    return;
  }

  const overdueThreshold = appealSlaThreshold(assessmentAppealResponseWorkingDays);

  if (!overdueThreshold) {
    return;
  }

  if (priority === 'urgent') {
    appendAndFilter(filters, { submittedAt: { $lt: overdueThreshold } });
    return;
  }

  if (priority === 'high') {
    appendAndFilter(filters, { submittedAt: { $gte: overdueThreshold } });
    return;
  }

  appendAndFilter(filters, { documentId: { $eq: '__hireflip_no_assessment_appeal_priority_match__' } });
};

const applySearchFilter = (filters: Record<string, unknown>, search?: string) => {
  if (!search) {
    return;
  }

  appendAndFilter(filters, {
    $or: [
      { documentId: containsFilter(search) },
      { reason: containsFilter(search) },
      { candidate: { email: containsFilter(search) } },
      { candidate: { firstName: containsFilter(search) } },
      { candidate: { lastName: containsFilter(search) } },
      { courseTestAttempt: { documentId: containsFilter(search) } },
      { enrollment: { documentId: containsFilter(search) } },
    ],
  });
};

const listAppealFilters = (body: ListBody) => {
  const filters: Record<string, unknown> =
    body.appealState === 'all'
      ? activeAppealFilter()
      : {
          appealState: body.appealState,
        };

  applyPriorityFilter(filters, body.priority);
  applySearchFilter(filters, body.search);

  return filters;
};

const collectReviewCounts = async (appealDocuments: DocumentCollection) => {
  const baseFilters = activeAppealFilter();
  const overdueThreshold = appealSlaThreshold(assessmentAppealResponseWorkingDays);
  const dueSoonThreshold = appealSlaThreshold(assessmentAppealResponseWorkingDays - 2);

  const [total, waiting, underReview, dueSoon, overdue] = await Promise.all([
    appealDocuments.count({ filters: baseFilters }),
    appealDocuments.count({ filters: { appealState: 'submitted' } }),
    appealDocuments.count({ filters: { appealState: 'under_review' } }),
    dueSoonThreshold && overdueThreshold
      ? appealDocuments.count({
          filters: {
            ...baseFilters,
            submittedAt: {
              $gte: overdueThreshold,
              $lt: dueSoonThreshold,
            },
          },
        })
      : Promise.resolve(0),
    overdueThreshold
      ? appealDocuments.count({
          filters: {
            ...baseFilters,
            submittedAt: {
              $lt: overdueThreshold,
            },
          },
        })
      : Promise.resolve(0),
  ]);

  return {
    dueSoon,
    overdue,
    total,
    underReview,
    waiting,
  };
};

const contextByTaskKey = async (strapi: StrapiDocumentService, taskKey: string) => {
  const appeal = await findAppealByDocumentId(strapi, appealDocumentIdFromTaskKey(taskKey));

  if (!appeal) {
    throw new ValidationError('Assessment appeal review could not be found.');
  }

  return hydrateAppealContext(strapi, appeal);
};

const answerSubmissionsForAttempt = async (strapi: StrapiDocumentService, attemptDocumentId?: string) => {
  if (!attemptDocumentId) {
    return [];
  }

  const answers = await findAllDocuments(strapi, 'api::course-answer-submission.course-answer-submission', {
    filters: {
      courseTestAttempt: {
        documentId: attemptDocumentId,
      },
    },
    populate: ['courseQuestion', 'courseTestAttempt'],
    sort: ['createdAt:asc'],
  });

  return answers.map(publicAnswerSubmission);
};

const attemptsForTest = async (
  strapi: StrapiDocumentService,
  enrollmentDocumentId?: string,
  testDocumentId?: string
) => {
  if (!enrollmentDocumentId || !testDocumentId) {
    return [];
  }

  const attempts = await findAllDocuments(strapi, 'api::course-test-attempt.course-test-attempt', {
    filters: {
      courseTest: {
        documentId: testDocumentId,
      },
      enrollment: {
        documentId: enrollmentDocumentId,
      },
    },
    populate: ['courseTest'],
    sort: ['attemptNumber:asc', 'createdAt:asc'],
  });

  return attempts.map(publicAttempt);
};

const auditEventsForReview = async (strapi: StrapiDocumentService, context: AppealContext) => {
  const subjectIds = [
    getDocumentId(context.appeal),
    getDocumentId(context.attempt),
    getDocumentId(context.candidate),
    getDocumentId(context.classRecord),
    getDocumentId(context.courseTest),
    getDocumentId(context.enrollment),
  ].filter((value): value is string => typeof value === 'string' && value.length > 0);

  if (subjectIds.length === 0) {
    return [];
  }

  const events = await findAllDocuments(strapi, 'api::audit-event.audit-event', {
    filters: {
      subjectId: {
        $in: subjectIds,
      },
    },
    sort: ['occurredAt:desc', 'createdAt:desc'],
  });

  return events.map(publicAuditEvent);
};

const secondsBetween = (from?: string | null, to = new Date()) => {
  if (!from) {
    return 0;
  }

  const fromMs = Date.parse(from);

  if (!Number.isFinite(fromMs)) {
    return 0;
  }

  return Math.max(0, Math.round((to.getTime() - fromMs) / 1000));
};

const extendedDeadline = (deadline?: string | null, seconds = 0) => {
  if (!deadline || seconds <= 0) {
    return deadline || null;
  }

  const deadlineMs = Date.parse(deadline);

  if (!Number.isFinite(deadlineMs)) {
    return deadline;
  }

  return new Date(deadlineMs + seconds * 1000).toISOString();
};

const courseResultForEnrollment = async (strapi: StrapiDocumentService, enrollmentDocumentId?: string) => {
  if (!enrollmentDocumentId) {
    return undefined;
  }

  const results = await documents(strapi, 'api::course-result.course-result').findMany({
    filters: {
      enrollment: {
        documentId: enrollmentDocumentId,
      },
    },
    limit: 1,
    populate: ['course', 'enrollment'],
    sort: ['updatedAt:desc', 'createdAt:desc'],
  });

  return results[0];
};

const recordDecisionAudit = async ({
  context,
  eventType,
  metadata,
  newState,
  previousState,
  requestContext,
  session,
  strapi,
}: {
  context: AppealContext;
  eventType: string;
  metadata?: Record<string, unknown>;
  newState?: unknown;
  previousState?: unknown;
  requestContext: RequestContext;
  session: AdminSession;
  strapi: StrapiDocumentService;
}) =>
  auditEvents(strapi).record({
    actorDisplayName: session.user.displayName,
    actorEmail: session.user.email,
    actorId: session.user.id,
    actorType: 'admin',
    eventCategory: 'course',
    eventType,
    ipAddress: requestContext.ipAddress,
    metadata,
    newState,
    occurredAt: new Date().toISOString(),
    previousState,
    requestId: requestContext.requestId,
    source: 'admin_dashboard',
    subjectDisplayName: candidateDisplayName(context.candidate),
    subjectId: getDocumentId(context.appeal),
    subjectType: 'assessment_appeal',
    userAgent: requestContext.userAgent,
  });

export default ({ strapi }) => ({
  async listReviews(input: unknown, requestContext: RequestContext = {}) {
    const body = validateList(input);
    const session = await assertAssessmentAppealSession(strapi, body.sessionToken, requestContext);
    const appealDocuments = documents(strapi, 'api::assessment-appeal.assessment-appeal');
    const filters = listAppealFilters(body);
    const [counts, filteredTotal] = await Promise.all([
      collectReviewCounts(appealDocuments),
      appealDocuments.count({ filters }),
    ]);
    const pageCount = Math.max(1, Math.ceil(filteredTotal / body.pageSize));
    const page = Math.min(body.page, pageCount);
    const pageStart = (page - 1) * body.pageSize;
    const appeals = await appealDocuments.findMany({
      filters,
      limit: body.pageSize,
      populate: ['candidate', 'courseTestAttempt', 'enrollment'],
      sort: ['submittedAt:desc', 'createdAt:desc'],
      start: pageStart,
    });
    const reviews = await hydrateReviews(strapi, appeals);

    return {
      counts,
      filteredReviews: filteredTotal,
      generatedAt: new Date().toISOString(),
      pagination: {
        page,
        pageCount,
        pageSize: body.pageSize,
        total: filteredTotal,
      },
      reviews,
      totalReviews: counts.total,
      user: session.user,
    };
  },

  async getReviewDetail(input: unknown, requestContext: RequestContext = {}) {
    const body = validateDetail(input);
    const session = await assertAssessmentAppealSession(strapi, body.sessionToken, requestContext);
    let context = await contextByTaskKey(strapi, body.taskKey);
    const review = publicReview(context);
    const { reviewClaim } = await reviewClaimService(strapi).claimForSession(
      {
        resourceDocumentId: review.sourceDocumentId,
        resourceKey: review.taskKey,
        resourceLabel: review.title,
        resourceType: 'assessment_appeal',
      },
      session,
      requestContext
    );

    if (
      context.appeal.documentId &&
      context.appeal.appealState === 'submitted' &&
      (reviewClaim as { isOwnedByCurrentUser?: boolean } | null)?.isOwnedByCurrentUser
    ) {
      const updatedAppeal = await documents(strapi, 'api::assessment-appeal.assessment-appeal').update({
        documentId: context.appeal.documentId,
        data: {
          appealState: 'under_review',
          metadata: {
            ...(objectValue(context.appeal.metadata)),
            reviewStartedAt: new Date().toISOString(),
            reviewStartedByAdminEmail: session.user.email,
            reviewStartedByAdminId: session.user.id,
          },
        },
        populate: ['candidate', 'courseTestAttempt', 'enrollment'],
      });

      context = await hydrateAppealContext(strapi, updatedAppeal);
      await publishAssessmentAppealChange(strapi, body.taskKey);
    }

    const [answers, attempts, auditEvents] = await Promise.all([
      answerSubmissionsForAttempt(strapi, getDocumentId(context.attempt)),
      attemptsForTest(strapi, getDocumentId(context.enrollment), getDocumentId(context.courseTest)),
      auditEventsForReview(strapi, context),
    ]);

    return {
      generatedAt: new Date().toISOString(),
      review: {
        ...publicReview(context),
        answers,
        attempts,
        auditEvents,
      },
      reviewClaim,
    };
  },

  async approveReview(input: unknown, requestContext: RequestContext = {}) {
    const body = validateApprove(input);
    const session = await assertAssessmentAppealSession(strapi, body.sessionToken, requestContext);
    const context = await contextByTaskKey(strapi, body.taskKey);
    const review = publicReview(context);

    if (!context.appeal.documentId || !context.attempt?.documentId || !context.enrollment?.documentId) {
      throw new ValidationError('Assessment appeal is missing the linked attempt or enrollment.');
    }

    if (!isActiveAppealState(context.appeal.appealState)) {
      throw new ValidationError('Only submitted or under-review appeals can be approved.');
    }

    await reviewClaimService(strapi).assertActiveClaimForSession(
      {
        claimToken: body.reviewClaimToken,
        resourceDocumentId: review.sourceDocumentId,
        resourceKey: review.taskKey,
        resourceLabel: review.title,
        resourceType: 'assessment_appeal',
      },
      session
    );

    const now = new Date();
    const nowIso = now.toISOString();
    const reviewElapsedSeconds = secondsBetween(context.appeal.submittedAt || context.appeal.createdAt, now);
    const previousDeadline = context.enrollment.courseCompletionDeadline || null;
    const nextDeadline = extendedDeadline(previousDeadline, reviewElapsedSeconds);
    const nextDeadlineExtensionSeconds =
      Number(context.enrollment.courseDeadlineExtensionSeconds || 0) + reviewElapsedSeconds;
    const decisionMessage =
      body.message ||
      `Your course appeal has been approved. The assessment has been reopened for one more attempt.`;
    const previousAttempt = context.attempt;
    const previousEnrollment = context.enrollment;
    const previousAppeal = context.appeal;
    const courseResult = await courseResultForEnrollment(strapi, context.enrollment.documentId);

    const [updatedAttempt, updatedEnrollment, updatedAppeal, updatedTestResult] = await Promise.all([
      documents(strapi, 'api::course-test-attempt.course-test-attempt').update({
        documentId: context.attempt.documentId,
        data: {
          attemptState: 'failed',
          metadata: {
            ...(objectValue(context.attempt.metadata)),
            adminOverrideRetryGrantedAt: nowIso,
            adminOverrideRetryGrantedByAdminEmail: session.user.email,
            adminOverrideRetryGrantedByAdminId: session.user.id,
            assessmentAppealDocumentId: context.appeal.documentId,
          },
          retryEligibilityState: 'eligible_conditional_retry',
        },
        populate: ['candidate', 'courseTest', 'enrollment'],
      }),
      documents(strapi, 'api::enrollment.enrollment').update({
        documentId: context.enrollment.documentId,
        data: {
          ...(nextDeadline ? { courseCompletionDeadline: nextDeadline } : {}),
          courseDeadlineExtensionSeconds: nextDeadlineExtensionSeconds,
          completionStatus: 'in_progress',
          enrollmentState: ['failed', 'completed'].includes(String(context.enrollment.enrollmentState || ''))
            ? 'in_class'
            : context.enrollment.enrollmentState,
          passStatus: context.enrollment.passStatus === 'failed' ? 'not_assessed' : context.enrollment.passStatus,
        },
        populate: ['candidate', 'class'],
      }),
      documents(strapi, 'api::assessment-appeal.assessment-appeal').update({
        documentId: context.appeal.documentId,
        data: {
          appealState: 'approved',
          decision: decisionMessage,
          metadata: {
            ...(objectValue(context.appeal.metadata)),
            decisionedByAdminEmail: session.user.email,
            decisionedByAdminId: session.user.id,
            outcome: 'admin_override_retry_granted',
          },
          outcomeAdjustment: {
            adminOverrideRetryGranted: true,
            deadlineExtendedBySeconds: reviewElapsedSeconds,
            newCourseCompletionDeadline: nextDeadline,
            previousCourseCompletionDeadline: previousDeadline,
            reviewElapsedSeconds,
          },
          reviewedAt: nowIso,
          reviewedByAdminId: session.user.id,
        },
        populate: ['candidate', 'courseTestAttempt', 'enrollment'],
      }),
      context.testResult?.documentId
        ? documents(strapi, 'api::course-test-result.course-test-result').update({
            documentId: context.testResult.documentId,
            data: {
              metadata: {
                ...(objectValue(context.testResult.metadata)),
                assessmentAppealDocumentId: context.appeal.documentId,
                voidedByAssessmentAppealAt: nowIso,
                voidedByAdminEmail: session.user.email,
              },
              resultState: 'void',
            },
          })
        : Promise.resolve(undefined),
    ]);

    if (courseResult?.documentId) {
      await documents(strapi, 'api::course-result.course-result').update({
        documentId: courseResult.documentId,
        data: {
          ...(nextDeadline ? { completionDeadline: nextDeadline } : {}),
          deadlineExtensionSeconds:
            Number(courseResult.deadlineExtensionSeconds || 0) + reviewElapsedSeconds,
          metadata: {
            ...(objectValue(courseResult.metadata)),
            lastAssessmentAppealApprovedAt: nowIso,
            lastAssessmentAppealDocumentId: context.appeal.documentId,
          },
          resultState: 'in_progress',
        },
      });
    }

    await documents(strapi, 'api::course-progress.course-progress').create({
      data: {
        candidate: relationConnect(context.candidate),
        courseTest: relationConnect(context.courseTest),
        enrollment: relationConnect(updatedEnrollment),
        metadata: {
          assessmentAppealDocumentId: context.appeal.documentId,
          attemptDocumentId: context.attempt.documentId,
          source: 'admin_assessment_appeal_approved',
        },
        progressState: 'in_progress',
        progressType: 'test',
        startedAt: nowIso,
      },
    });

    let queueResult: NotificationServiceQueueResponse | undefined;
    let notificationFailureMessage: string | undefined;

    if (context.candidate?.email && typeof context.candidate.email === 'string') {
      try {
        queueResult = await requestNotificationServiceEmail({
          correlationId: context.appeal.documentId,
          template: {
            key: 'generic_branded_message',
            variables: {
              bodyLines: [
                `Hi ${candidateFirstName(context.candidate)},`,
                decisionMessage,
                `We have added ${formatReviewElapsed(reviewElapsedSeconds)} back onto your course deadline while the appeal was under review.`,
                'Open your course page to continue from the reopened assessment.',
              ],
              ctaLabel: 'Open course',
              ctaUrl: candidateCourseUrl(),
              heading: 'Course appeal approved',
              replyInstruction:
                'Please use your HireFlip dashboard for any follow-up so your course history stays linked.',
              replyTo: process.env.SUPPORT_REPLY_TO_EMAIL || 'support@hireflip.work',
              subject: 'Your HireFlip course appeal has been approved',
            },
          },
          to: context.candidate.email,
          type: 'candidate_course_appeal_approved',
        });
      } catch (error) {
        notificationFailureMessage =
          error instanceof Error ? error.message : 'Candidate course appeal approval notification failed.';
        strapi.log?.error?.('Candidate course appeal approval notification failed.', error);
      }
    }

    await recordDecisionAudit({
      context,
      eventType: 'admin.assessment_appeal_approved',
      metadata: {
        deadlineExtendedBySeconds: reviewElapsedSeconds,
        notificationFailureMessage: notificationFailureMessage || null,
        notificationQueued: queueResult?.data?.queued === true,
        notificationServiceJobId: queueResult?.data?.jobId ?? null,
        taskKey: body.taskKey,
      },
      newState: {
        appeal: publicAppeal(updatedAppeal),
        attempt: publicAttempt(updatedAttempt),
        enrollment: publicEnrollment(updatedEnrollment),
        testResult: updatedTestResult ? { documentId: updatedTestResult.documentId, resultState: updatedTestResult.resultState } : null,
      },
      previousState: {
        appeal: publicAppeal(previousAppeal),
        attempt: publicAttempt(previousAttempt),
        enrollment: publicEnrollment(previousEnrollment),
      },
      requestContext,
      session,
      strapi,
    });
    await publishAssessmentAppealChange(strapi, body.taskKey);
    await publishCandidateCourseChange(strapi, context.candidate, updatedEnrollment.class || context.classRecord);

    return {
      appeal: publicAppeal(updatedAppeal),
      approved: true,
      notificationQueued: queueResult?.data?.queued === true,
    };
  },

  async rejectReview(input: unknown, requestContext: RequestContext = {}) {
    const body = validateReject(input);
    const session = await assertAssessmentAppealSession(strapi, body.sessionToken, requestContext);
    const context = await contextByTaskKey(strapi, body.taskKey);
    const review = publicReview(context);

    if (!context.appeal.documentId || !context.attempt?.documentId) {
      throw new ValidationError('Assessment appeal is missing the linked attempt.');
    }

    if (!isActiveAppealState(context.appeal.appealState)) {
      throw new ValidationError('Only submitted or under-review appeals can be rejected.');
    }

    await reviewClaimService(strapi).assertActiveClaimForSession(
      {
        claimToken: body.reviewClaimToken,
        resourceDocumentId: review.sourceDocumentId,
        resourceKey: review.taskKey,
        resourceLabel: review.title,
        resourceType: 'assessment_appeal',
      },
      session
    );

    const nowIso = new Date().toISOString();
    const previousAttempt = context.attempt;
    const previousAppeal = context.appeal;
    const [updatedAttempt, updatedAppeal] = await Promise.all([
      documents(strapi, 'api::course-test-attempt.course-test-attempt').update({
        documentId: context.attempt.documentId,
        data: {
          attemptState: 'failed',
          metadata: {
            ...(objectValue(context.attempt.metadata)),
            assessmentAppealRejectedAt: nowIso,
            assessmentAppealRejectedByAdminEmail: session.user.email,
            assessmentAppealRejectedByAdminId: session.user.id,
          },
          retryEligibilityState: 'exhausted',
        },
        populate: ['candidate', 'courseTest', 'enrollment'],
      }),
      documents(strapi, 'api::assessment-appeal.assessment-appeal').update({
        documentId: context.appeal.documentId,
        data: {
          appealState: 'rejected',
          decision: body.message,
          metadata: {
            ...(objectValue(context.appeal.metadata)),
            decisionedByAdminEmail: session.user.email,
            decisionedByAdminId: session.user.id,
            outcome: 'appeal_rejected',
          },
          outcomeAdjustment: {
            adminOverrideRetryGranted: false,
          },
          reviewedAt: nowIso,
          reviewedByAdminId: session.user.id,
        },
        populate: ['candidate', 'courseTestAttempt', 'enrollment'],
      }),
    ]);

    let queueResult: NotificationServiceQueueResponse | undefined;
    let notificationFailureMessage: string | undefined;

    if (context.candidate?.email && typeof context.candidate.email === 'string') {
      try {
        queueResult = await requestNotificationServiceEmail({
          correlationId: context.appeal.documentId,
          template: {
            key: 'generic_branded_message',
            variables: {
              bodyLines: [
                `Hi ${candidateFirstName(context.candidate)},`,
                'We have reviewed your course appeal and cannot approve another attempt on the information currently available.',
                body.message,
              ],
              ctaLabel: 'Open course',
              ctaUrl: candidateCourseUrl(),
              heading: 'Course appeal reviewed',
              replyInstruction:
                'Please use your HireFlip dashboard for any follow-up so your course history stays linked.',
              replyTo: process.env.SUPPORT_REPLY_TO_EMAIL || 'support@hireflip.work',
              subject: 'Your HireFlip course appeal has been reviewed',
            },
          },
          to: context.candidate.email,
          type: 'candidate_course_appeal_rejected',
        });
      } catch (error) {
        notificationFailureMessage =
          error instanceof Error ? error.message : 'Candidate course appeal rejection notification failed.';
        strapi.log?.error?.('Candidate course appeal rejection notification failed.', error);
      }
    }

    await recordDecisionAudit({
      context,
      eventType: 'admin.assessment_appeal_rejected',
      metadata: {
        notificationFailureMessage: notificationFailureMessage || null,
        notificationQueued: queueResult?.data?.queued === true,
        notificationServiceJobId: queueResult?.data?.jobId ?? null,
        taskKey: body.taskKey,
      },
      newState: {
        appeal: publicAppeal(updatedAppeal),
        attempt: publicAttempt(updatedAttempt),
      },
      previousState: {
        appeal: publicAppeal(previousAppeal),
        attempt: publicAttempt(previousAttempt),
      },
      requestContext,
      session,
      strapi,
    });
    await publishAssessmentAppealChange(strapi, body.taskKey);
    await publishCandidateCourseChange(strapi, context.candidate, context.classRecord);

    return {
      appeal: publicAppeal(updatedAppeal),
      notificationQueued: queueResult?.data?.queued === true,
      rejected: true,
    };
  },
});

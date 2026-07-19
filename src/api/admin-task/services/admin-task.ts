import { factories } from '@strapi/strapi';
import { errors, validateZodSchema, z } from '@strapi/utils';
import { publishAdminRealtimeEvent } from '../../../utils/admin-realtime-events';
import { workingDayWindow } from '../../../utils/working-days';

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
  activeClaimsForSession(input: unknown, session: AdminSession): Promise<Map<string, unknown>>;
  claimForSession(
    input: unknown,
    session: AdminSession,
    context: RequestContext
  ): Promise<{ reviewClaim: unknown }>;
};

type DocumentRecord = Record<string, unknown> & {
  actionLabel?: string;
  actionPath?: string;
  amountPence?: number;
  appealState?: string;
  aiModel?: string;
  aiProvider?: string;
  candidate?: DocumentRecord;
  candidateReportFailureCategory?: string;
  candidateReportFailureFirstDetectedAt?: string;
  candidateReportFailureReason?: string;
  candidateReportLastAttemptAt?: string;
  candidateReportRetryCount?: number;
  candidateReportState?: string;
  candidateLabel?: string;
  candidateResponseDeadline?: string;
  candidateRespondedAt?: string;
  class?: DocumentRecord;
  classArea?: DocumentRecord;
  classLabel?: string;
  companyName?: string;
  completedAt?: string;
  courseTestAttempt?: DocumentRecord;
  createdAt?: string;
  currency?: string;
  deliveryState?: string;
  documentId?: string;
  dueAt?: string;
  displayTitle?: string;
  email?: string;
  enrollment?: DocumentRecord;
  enrollmentState?: string;
  errorMessage?: string;
  eventCategory?: string;
  eventType?: string;
  failedAt?: string;
  firstName?: string;
  id?: number | string;
  interview?: DocumentRecord;
  interviewState?: string;
  issueKey?: string;
  lastDetectedAt?: string;
  lastName?: string;
  employer?: DocumentRecord;
  employerContact?: DocumentRecord;
  employerLabel?: string;
  employerDetailsDueAt?: string;
  employerDetailsReleaseEligibleAt?: string;
  employerDetailsReleaseReason?: string;
  employerDetailsReleasedAt?: string;
  feedbackDueAt?: string;
  feedbackOverdueDetectedAt?: string;
  metadata?: unknown;
  name?: string;
  openingReadinessCheckedAt?: string;
  openingReadinessStatus?: string;
  openingReadinessSummary?: unknown;
  ownerKeyText?: string;
  occurredAt?: string;
  payment?: DocumentRecord;
  paymentState?: string;
  paymentStatus?: string;
  priority?: AdminTaskPriority;
  priorityRank?: number;
  progressionState?: string;
  refund?: DocumentRecord;
  refundState?: string;
  relatedDocumentId?: string;
  relatedId?: string;
  relatedType?: string;
  reservation?: DocumentRecord;
  reservationState?: string;
  region?: string;
  regionLabel?: string;
  resolvedAt?: string | null;
  requestedDetailsAt?: string;
  scheduledEndTime?: string;
  scheduledStartTime?: string;
  severity?: string;
  sector?: string;
  searchText?: string;
  sourceDocumentId?: string;
  sourceType?: AdminTaskSourceType;
  submittedAt?: string;
  subjectDisplayName?: string;
  subjectId?: string;
  subjectType?: string;
  summary?: string;
  taskKey?: string;
  taskState?: AdminTaskState;
  taskType?: AdminTaskType;
  templateKey?: string;
  title?: string;
  updatedAt?: string;
  workSector?: DocumentRecord;
};

type DocumentCollection = {
  count(input: Record<string, unknown>): Promise<number>;
  create(input: Record<string, unknown>): Promise<DocumentRecord>;
  findMany(input: Record<string, unknown>): Promise<DocumentRecord[]>;
  update(input: Record<string, unknown>): Promise<DocumentRecord>;
};

type StrapiDocumentService = {
  documents(uid: string): unknown;
  service(uid: string): unknown;
};

type AdminTaskPriority = 'low' | 'normal' | 'high' | 'urgent';
type AdminTaskSourceType =
  | 'assessment_appeal'
  | 'audit_event'
  | 'class'
  | 'enrollment'
  | 'interview'
  | 'interview_feedback'
  | 'interview_request'
  | 'notification_event'
  | 'payment'
  | 'privacy_rights_request'
  | 'progression_request'
  | 'refund'
  | 'reservation'
  | 'support_case';
type AdminTaskState = 'acknowledged' | 'dismissed' | 'open' | 'resolved';
type AdminTaskType =
  | 'assessment_appeal'
  | 'ai_feedback_review'
  | 'class_readiness'
  | 'interview_operation'
  | 'notification_failure'
  | 'privacy_request'
  | 'payment_review'
  | 'refund_review'
  | 'support_case'
  | 'system_alert';

type AdminTaskDraft = {
  actionLabel: string;
  actionPath: string;
  metadata: Record<string, unknown>;
  priority: AdminTaskPriority;
  relatedDocumentId?: string;
  relatedType?: string;
  sourceDocumentId?: string;
  sourceType: AdminTaskSourceType;
  summary: string;
  taskKey: string;
  taskType: AdminTaskType;
  title: string;
};

const overviewSchema = z
  .object({
    sessionToken: z.string().trim().min(32).max(512),
  })
  .strict();
const taskActionSchema = overviewSchema
  .extend({
    reviewClaimToken: z.string().trim().min(32).max(160).optional(),
    taskKey: z.string().trim().min(1).max(220),
  })
  .strict();
const taskStateActionSchema = taskActionSchema
  .extend({
    taskState: z.enum(['acknowledged', 'dismissed']),
  })
  .strict();
const taskListSchema = overviewSchema
  .extend({
    candidate: z.string().trim().max(160).optional(),
    className: z.string().trim().max(160).optional(),
    dueDate: z.enum(['overdue', 'next_24h', 'next_7d', 'none']).optional(),
    employer: z.string().trim().max(160).optional(),
    owner: z.string().trim().max(80).optional(),
    page: z.coerce.number().int().min(1).max(500).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
    priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
    region: z.string().trim().max(160).optional(),
    issueKey: z.string().trim().max(120).optional(),
    search: z.string().trim().max(220).optional(),
    sourceType: z
      .enum([
        'assessment_appeal',
        'audit_event',
        'class',
        'enrollment',
        'interview',
        'interview_feedback',
        'interview_request',
        'notification_event',
        'payment',
        'privacy_rights_request',
        'progression_request',
        'refund',
        'reservation',
        'support_case',
      ])
      .optional(),
    taskState: z.enum(['acknowledged', 'all', 'dismissed', 'open', 'resolved']).optional(),
    taskType: z
      .enum([
        'assessment_appeal',
        'ai_feedback_review',
        'class_readiness',
        'interview_operation',
        'notification_failure',
        'privacy_request',
        'payment_review',
        'refund_review',
        'support_case',
        'system_alert',
      ])
      .optional(),
  })
  .strict();

const validateOverview = validateZodSchema(overviewSchema);
const validateTaskAction = validateZodSchema(taskActionSchema);
const validateTaskStateAction = validateZodSchema(taskStateActionSchema);
const validateTaskList = validateZodSchema(taskListSchema);

const documents = (strapi: StrapiDocumentService, uid: string) =>
  strapi.documents(uid) as unknown as DocumentCollection;

const findAllDocuments = async (
  strapi: StrapiDocumentService,
  uid: string,
  input: Record<string, unknown>,
  pageSize = 100
) => {
  const collection = documents(strapi, uid);
  const filters = (input.filters || {}) as Record<string, unknown>;
  const total = await collection.count({ filters });
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

const trimToLength = (value: string, maxLength: number) =>
  value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;

const taskRouteSegment = (taskKey: string) => encodeURIComponent(taskKey);
const assessmentAppealTaskPath = (taskKey: string) => `/classes/appeals/${taskRouteSegment(taskKey)}`;
const taskDetailPath = (taskKey: string) => `/tasks/${taskRouteSegment(taskKey)}`;
const adminTaskClaimKey = (taskKey: string) => `admin_task:${taskKey}`;
const refundTaskPath = (taskKey: string) => `/refunds/${taskRouteSegment(taskKey)}`;
const supportCasePath = (supportCaseDocumentId: string) =>
  `/support/${encodeURIComponent(supportCaseDocumentId)}`;
const aiFeedbackReviewPath = (feedbackDocumentId: string) =>
  `/support/ai-feedback/${encodeURIComponent(feedbackDocumentId)}`;
const notificationIssuePath = (notificationEventDocumentId: string) =>
  `/support/notification-issues/${encodeURIComponent(notificationEventDocumentId)}`;
const privacyRequestPath = (requestDocumentId: string) =>
  `/support/privacy-requests/${encodeURIComponent(requestDocumentId)}`;
const classPath = (classDocumentId: string) =>
  `/classes/${encodeURIComponent(classDocumentId)}`;
const interviewOperationsPath = (params?: Record<string, string | undefined>) => {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params || {})) {
    if (value) {
      searchParams.set(key, value);
    }
  }

  const query = searchParams.toString();
  return `/interviews${query ? `?${query}` : ''}`;
};

const candidateDisplayName = (candidate?: DocumentRecord) => {
  if (!candidate) {
    return undefined;
  }

  const firstName = typeof candidate.firstName === 'string' ? candidate.firstName.trim() : '';
  const lastName = typeof candidate.lastName === 'string' ? candidate.lastName.trim() : '';
  const fullName = `${firstName} ${lastName}`.trim();

  return fullName || (typeof candidate.email === 'string' ? candidate.email : undefined);
};

const formatMoney = (amountPence?: number, currency = 'GBP') => {
  if (typeof amountPence !== 'number') {
    return undefined;
  }

  return new Intl.NumberFormat('en-GB', {
    currency,
    style: 'currency',
  }).format(amountPence / 100);
};

const sourceTimestamp = (record: DocumentRecord) =>
  record.submittedAt || record.failedAt || record.occurredAt || record.createdAt || new Date().toISOString();

const taskTypeLabels: Record<AdminTaskType, string> = {
  assessment_appeal: 'Assessment appeal',
  ai_feedback_review: 'AI feedback review',
  class_readiness: 'Class readiness',
  interview_operation: 'Interview operation',
  notification_failure: 'Notification failure',
  privacy_request: 'Privacy request',
  payment_review: 'Payment review',
  refund_review: 'Refund review',
  support_case: 'Support case',
  system_alert: 'System alert',
};
const assessmentAppealResponseWorkingDays = 14;

const priorityRank: Record<AdminTaskPriority, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

const monitoredTaskTypes: AdminTaskType[] = [
  'assessment_appeal',
  'ai_feedback_review',
  'class_readiness',
  'interview_operation',
  'privacy_request',
  'payment_review',
  'refund_review',
  'support_case',
  'notification_failure',
  'system_alert',
];
const activeTaskStates: AdminTaskState[] = ['open'];
const clearableTaskTypes = new Set<AdminTaskType>(['notification_failure', 'system_alert']);
const isClearableTask = (task?: Pick<DocumentRecord, 'taskType'> | null) =>
  Boolean(task?.taskType && clearableTaskTypes.has(task.taskType));

const objectValue = (value: unknown) => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
};

const documentRecordValue = (value: unknown): DocumentRecord | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as DocumentRecord)
    : undefined;

const businessDayStartHourUtc = 9;
const businessDayEndHourUtc = 17;
const isWorkingDay = (date: Date) => {
  const day = date.getUTCDay();
  return day !== 0 && day !== 6;
};

const nextBusinessStart = (date: Date) => {
  const result = new Date(date.getTime());

  while (!isWorkingDay(result)) {
    result.setUTCDate(result.getUTCDate() + 1);
    result.setUTCHours(businessDayStartHourUtc, 0, 0, 0);
  }

  if (result.getUTCHours() < businessDayStartHourUtc) {
    result.setUTCHours(businessDayStartHourUtc, 0, 0, 0);
  }

  if (result.getUTCHours() >= businessDayEndHourUtc) {
    result.setUTCDate(result.getUTCDate() + 1);
    result.setUTCHours(businessDayStartHourUtc, 0, 0, 0);
    return nextBusinessStart(result);
  }

  return result;
};

const addBusinessHours = (value?: string | Date | null, hours = 4) => {
  const parsed = value ? new Date(value) : undefined;

  if (!parsed || !Number.isFinite(parsed.getTime())) {
    return null;
  }

  let remainingMs = Math.max(0, hours) * 60 * 60 * 1000;
  let cursor = nextBusinessStart(parsed);

  while (remainingMs > 0) {
    const endOfDay = new Date(cursor.getTime());
    endOfDay.setUTCHours(businessDayEndHourUtc, 0, 0, 0);
    const availableMs = Math.max(0, endOfDay.getTime() - cursor.getTime());

    if (remainingMs <= availableMs) {
      return new Date(cursor.getTime() + remainingMs).toISOString();
    }

    remainingMs -= availableMs;
    cursor = nextBusinessStart(new Date(endOfDay.getTime() + 1));
  }

  return cursor.toISOString();
};

const assertOperationsSession = async (
  strapi: StrapiDocumentService,
  sessionToken: string,
  context: RequestContext
) => {
  const session = await adminAuthService(strapi).getSession({ sessionToken }, context);
  const canViewOperationalTasks = session.user.roleKeys.some((roleKey) =>
    ['admin', 'sales', 'super_admin', 'support'].includes(roleKey)
  );

  if (!canViewOperationalTasks) {
    throw new ForbiddenError('Admin, Sales, Support, or Super Admin access is required.');
  }

  return session;
};

const canViewTaskRecordForSession = (task: DocumentRecord, session: AdminSession) => {
  const roleKeys = session.user.roleKeys;
  const visibleRoleKeys = objectValue(task.metadata).visibleRoleKeys;

  if (
    Array.isArray(visibleRoleKeys) &&
    visibleRoleKeys.every((roleKey) => typeof roleKey === 'string')
  ) {
    return roleKeys.some((roleKey) => visibleRoleKeys.includes(roleKey));
  }

  if (task.taskType !== 'ai_feedback_review') {
    if (roleKeys.some((roleKey) => ['admin', 'super_admin'].includes(roleKey))) {
      return true;
    }

    return taskOwnerKeys(task).some((ownerKey) => roleKeys.includes(ownerKey));
  }

  const metadata = objectValue(task.metadata);
  const escalatedAt = typeof metadata.escalatedToAdminAt === 'string' ? metadata.escalatedToAdminAt : null;
  const isEscalated = Boolean(escalatedAt && Date.parse(escalatedAt) <= Date.now());

  if (roleKeys.some((roleKey) => ['sales', 'support'].includes(roleKey))) {
    return true;
  }

  return isEscalated && roleKeys.some((roleKey) => ['admin', 'super_admin'].includes(roleKey));
};

const findExistingTask = async (strapi: StrapiDocumentService, taskKey: string) => {
  const tasks = await documents(strapi, 'api::admin-task.admin-task').findMany({
    filters: {
      taskKey,
    },
    limit: 1,
  });

  return tasks[0];
};

const metadataString = (metadata: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const value = metadata[key];

    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return null;
};

const draftDueAt = (draft: AdminTaskDraft) =>
  metadataString(draft.metadata, [
    'appealResponseDueAt',
    'candidateResponseDeadline',
    'dueAt',
    'employerDetailsDueAt',
    'feedbackDueAt',
    'responseDueAt',
  ]);

const draftOwnerKeys = (draft: AdminTaskDraft) => {
  const visibleRoleKeys = draft.metadata.visibleRoleKeys;

  if (
    Array.isArray(visibleRoleKeys) &&
    visibleRoleKeys.every((roleKey) => typeof roleKey === 'string')
  ) {
    return uniqueStringValues(visibleRoleKeys);
  }

  return defaultOwnerKeysByTaskType[draft.taskType] || ['admin'];
};

const draftSearchText = ({
  candidateLabel,
  classLabel,
  dueAt,
  draft,
  employerLabel,
  ownerKeys,
  regionLabel,
}: {
  candidateLabel: string | null;
  classLabel: string | null;
  dueAt: string | null;
  draft: AdminTaskDraft;
  employerLabel: string | null;
  ownerKeys: string[];
  regionLabel: string | null;
}) =>
  [
    draft.actionLabel,
    draft.actionPath,
    candidateLabel,
    classLabel,
    dueAt,
    employerLabel,
    ownerKeys.join(' '),
    regionLabel,
    draft.priority,
    draft.relatedDocumentId,
    draft.relatedType,
    draft.sourceDocumentId,
    draft.sourceType,
    draft.summary,
    draft.taskKey,
    draft.taskType,
    taskTypeLabels[draft.taskType],
    draft.title,
    draft.metadata.eventType,
    draft.metadata.interviewDocumentId,
    draft.metadata.paymentDocumentId,
    draft.metadata.progressionRequestDocumentId,
    draft.metadata.requestType,
    draft.metadata.templateKey,
    JSON.stringify(draft.metadata),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

const taskData = (draft: AdminTaskDraft, detectedAt: string) => {
  const candidateLabel = metadataString(draft.metadata, ['candidateName', 'subjectName']);
  const classLabel = metadataString(draft.metadata, ['className']);
  const dueAt = draftDueAt(draft);
  const employerLabel = metadataString(draft.metadata, ['employerName']);
  const issueKey = metadataString(draft.metadata, ['issue']);
  const ownerKeys = draftOwnerKeys(draft);
  const regionLabel = metadataString(draft.metadata, ['regionName']);

  return {
    actionLabel: draft.actionLabel,
    actionPath: draft.actionPath,
    candidateLabel,
    classLabel,
    dueAt,
    employerLabel,
    issueKey,
    lastDetectedAt:
      typeof draft.metadata.sourceDetectedAt === 'string'
        ? draft.metadata.sourceDetectedAt
        : detectedAt,
    metadata: draft.metadata,
    ownerKeyText: ownerKeys.join(' '),
    priority: draft.priority,
    priorityRank: priorityRank[draft.priority],
    regionLabel,
    relatedDocumentId: draft.relatedDocumentId,
    relatedType: draft.relatedType,
    resolvedAt: null,
    searchText: draftSearchText({
      candidateLabel,
      classLabel,
      dueAt,
      draft,
      employerLabel,
      ownerKeys,
      regionLabel,
    }),
    sourceDocumentId: draft.sourceDocumentId,
    sourceType: draft.sourceType,
    summary: draft.summary,
    taskKey: draft.taskKey,
    taskState: 'open',
    taskType: draft.taskType,
    title: draft.title,
  };
};

const upsertTask = async (
  strapi: StrapiDocumentService,
  draft: AdminTaskDraft,
  detectedAt: string
) => {
  const existingTask = await findExistingTask(strapi, draft.taskKey);

  if (
    ['acknowledged', 'dismissed'].includes(existingTask?.taskState || '') &&
    isClearableTask(existingTask)
  ) {
    return existingTask;
  }

  if (existingTask?.documentId) {
    return documents(strapi, 'api::admin-task.admin-task').update({
      documentId: existingTask.documentId,
      data: taskData(draft, detectedAt),
    });
  }

  return documents(strapi, 'api::admin-task.admin-task').create({
    data: taskData(draft, detectedAt),
  });
};

const resolveStaleTasks = async (
  strapi: StrapiDocumentService,
  activeTaskKeys: Set<string>,
  resolvedAt: string
) => {
  const openTasks = await findAllDocuments(strapi, 'api::admin-task.admin-task', {
    filters: {
      taskState: {
        $in: activeTaskStates,
      },
      taskType: {
        $in: monitoredTaskTypes,
      },
    },
  });

  await Promise.all(
    openTasks
      .filter((task) => task.taskKey && !activeTaskKeys.has(task.taskKey))
      .map((task) =>
        task.documentId
          ? documents(strapi, 'api::admin-task.admin-task').update({
              documentId: task.documentId,
              data: {
                resolvedAt,
                taskState: 'resolved',
              },
            })
          : Promise.resolve(task)
      )
  );
};

const hasRequiresReviewPayment = async (
  strapi: StrapiDocumentService,
  relationName: 'enrollment' | 'reservation',
  relationDocumentId?: string
) => {
  if (!relationDocumentId) {
    return false;
  }

  const payments = await documents(strapi, 'api::payment.payment').findMany({
    filters: {
      paymentState: 'requires_review',
      [relationName]: {
        documentId: relationDocumentId,
      },
    },
    limit: 1,
  });

  return payments.length > 0;
};

const hasPaymentExceptionReservation = async (
  strapi: StrapiDocumentService,
  enrollmentDocumentId?: string
) => {
  if (!enrollmentDocumentId) {
    return false;
  }

  const reservations = await documents(strapi, 'api::reservation.reservation').findMany({
    filters: {
      enrollment: {
        documentId: enrollmentDocumentId,
      },
      reservationState: 'payment_exception',
    },
    limit: 1,
  });

  return reservations.length > 0;
};

const paymentTask = (payment: DocumentRecord): AdminTaskDraft | null => {
  const documentId = getDocumentId(payment);

  if (!documentId) {
    return null;
  }

  const taskKey = `payment:${documentId}:requires_review`;
  const amount = formatMoney(payment.amountPence, payment.currency || 'GBP');
  const candidateName = candidateDisplayName(payment.candidate);

  return {
    actionLabel: 'Review payment',
    actionPath: refundTaskPath(taskKey),
    metadata: {
      amountPence: payment.amountPence,
      currency: payment.currency || 'GBP',
      sourceCreatedAt: payment.createdAt,
      sourceDetectedAt: sourceTimestamp(payment),
    },
    priority: 'high',
    relatedDocumentId: documentId,
    relatedType: 'payment',
    sourceDocumentId: documentId,
    sourceType: 'payment',
    summary: trimToLength(
      [
        amount ? `${amount} payment requires manual review.` : 'Payment requires manual review.',
        candidateName ? `Candidate: ${candidateName}.` : '',
      ].filter(Boolean).join(' '),
      500
    ),
    taskKey,
    taskType: 'payment_review',
    title: 'Payment requires review',
  };
};

const reservationTask = (reservation: DocumentRecord): AdminTaskDraft | null => {
  const documentId = getDocumentId(reservation);

  if (!documentId) {
    return null;
  }

  const taskKey = `reservation:${documentId}:payment_exception`;
  const amount = formatMoney(reservation.amountPence, reservation.currency || 'GBP');
  const candidateName = candidateDisplayName(reservation.candidate);

  return {
    actionLabel: 'Review payment',
    actionPath: refundTaskPath(taskKey),
    metadata: {
      amountPence: reservation.amountPence,
      currency: reservation.currency || 'GBP',
      sourceCreatedAt: reservation.createdAt,
      sourceDetectedAt: sourceTimestamp(reservation),
    },
    priority: 'high',
    relatedDocumentId: documentId,
    relatedType: 'reservation',
    sourceDocumentId: documentId,
    sourceType: 'reservation',
    summary: trimToLength(
      [
        amount ? `${amount} reservation is in payment exception.` : 'Reservation is in payment exception.',
        candidateName ? `Candidate: ${candidateName}.` : '',
      ].filter(Boolean).join(' '),
      500
    ),
    taskKey,
    taskType: 'payment_review',
    title: 'Reservation payment exception',
  };
};

const enrollmentTask = (enrollment: DocumentRecord): AdminTaskDraft | null => {
  const documentId = getDocumentId(enrollment);

  if (!documentId) {
    return null;
  }

  const taskKey = `enrollment:${documentId}:payment_exception`;
  const candidateName = candidateDisplayName(enrollment.candidate);

  return {
    actionLabel: 'Review payment',
    actionPath: refundTaskPath(taskKey),
    metadata: {
      paymentStatus: enrollment.paymentStatus,
      sourceCreatedAt: enrollment.createdAt,
      sourceDetectedAt: sourceTimestamp(enrollment),
    },
    priority: 'high',
    relatedDocumentId: documentId,
    relatedType: 'enrollment',
    sourceDocumentId: documentId,
    sourceType: 'enrollment',
    summary: trimToLength(
      [
        'Enrollment payment state needs manual review.',
        candidateName ? `Candidate: ${candidateName}.` : '',
      ].filter(Boolean).join(' '),
      500
    ),
    taskKey,
    taskType: 'payment_review',
    title: 'Enrollment payment exception',
  };
};

const refundTask = (refund: DocumentRecord): AdminTaskDraft | null => {
  const documentId = getDocumentId(refund);

  if (!documentId) {
    return null;
  }

  const taskKey = `refund:${documentId}:${refund.refundState || 'review'}`;
  const amount = formatMoney(refund.amountPence, refund.currency || 'GBP');
  const isFailed = refund.refundState === 'failed';
  const isApproved = refund.refundState === 'approved';
  const candidateName = candidateDisplayName(refund.candidate);
  const enrollmentDocumentId = getDocumentId(refund.enrollment);
  const paymentDocumentId = getDocumentId(refund.payment);

  return {
    actionLabel: 'Review refund',
    actionPath: refundTaskPath(taskKey),
    metadata: {
      amountPence: refund.amountPence,
      candidateName: candidateName || null,
      currency: refund.currency || 'GBP',
      enrollmentDocumentId: enrollmentDocumentId || null,
      paymentDocumentId: paymentDocumentId || null,
      refundState: refund.refundState,
      sourceCreatedAt: refund.createdAt,
      sourceDetectedAt: sourceTimestamp(refund),
    },
    priority: isFailed ? 'urgent' : 'high',
    relatedDocumentId: documentId,
    relatedType: 'refund',
    sourceDocumentId: documentId,
    sourceType: 'refund',
    summary: trimToLength(
      [
        amount
          ? `${amount} refund is ${isFailed ? 'failed' : isApproved ? 'approved' : 'requested'}.`
          : `Refund is ${isFailed ? 'failed' : isApproved ? 'approved' : 'requested'}.`,
        candidateName ? `Candidate: ${candidateName}.` : '',
      ].filter(Boolean).join(' '),
      500
    ),
    taskKey,
    taskType: 'refund_review',
    title: isFailed ? 'Refund failed' : isApproved ? 'Refund approved' : 'Refund requested',
  };
};

const assessmentAppealTask = (appeal: DocumentRecord): AdminTaskDraft | null => {
  const documentId = getDocumentId(appeal);

  if (!documentId) {
    return null;
  }

  const taskKey = `assessment-appeal:${documentId}`;
  const candidateName = candidateDisplayName(appeal.candidate);
  const attempt = appeal.courseTestAttempt;
  const attemptNumber =
    typeof attempt?.attemptNumber === 'number' ? `Attempt ${attempt.attemptNumber}` : undefined;
  const responseSla = workingDayWindow({
    days: assessmentAppealResponseWorkingDays,
    from: appeal.submittedAt || appeal.createdAt,
  });

  return {
    actionLabel: 'Review appeal',
    actionPath: assessmentAppealTaskPath(taskKey),
    metadata: {
      appealState: appeal.appealState,
      sourceCreatedAt: appeal.createdAt,
      sourceDetectedAt: sourceTimestamp(appeal),
      submittedAt: appeal.submittedAt,
      responseDueAt: responseSla.dueAt,
      responseSlaOverdue: responseSla.isOverdue,
      responseWorkingDaysElapsed: responseSla.workingDaysElapsed,
      responseWorkingDaysRemaining: responseSla.workingDaysRemaining,
      attemptDocumentId: getDocumentId(attempt),
      attemptNumber: attempt?.attemptNumber ?? null,
    },
    priority: responseSla.isOverdue ? 'urgent' : 'high',
    relatedDocumentId: getDocumentId(attempt),
    relatedType: 'course_test_attempt',
    sourceDocumentId: documentId,
    sourceType: 'assessment_appeal',
    summary: trimToLength(
      [
        candidateName ? `${candidateName} submitted a course assessment appeal.` : 'Course assessment appeal needs review.',
        attemptNumber ? `${attemptNumber} is linked to this appeal.` : '',
      ].filter(Boolean).join(' '),
      500
    ),
    taskKey,
    taskType: 'assessment_appeal',
    title: 'Assessment appeal review',
  };
};

const notificationTask = (event: DocumentRecord): AdminTaskDraft | null => {
  const documentId = getDocumentId(event);

  if (!documentId) {
    return null;
  }

  if (objectValue(event.metadata).issueClearedAt) {
    return null;
  }

  const taskKey = `notification:${documentId}:failed`;

  return {
    actionLabel: 'Review event',
    actionPath: notificationIssuePath(documentId),
    metadata: {
      channel: event.channel,
      eventType: event.eventType,
      priority: event.priority,
      relatedId: event.relatedId,
      relatedType: event.relatedType,
      sourceCreatedAt: event.createdAt,
      sourceDetectedAt: sourceTimestamp(event),
      sourceFailedAt: event.failedAt,
      templateKey: event.templateKey,
      visibleRoleKeys: ['super_admin'],
    },
    priority: event.priority === 'urgent' ? 'urgent' : event.priority === 'high' ? 'high' : 'normal',
    relatedDocumentId: typeof event.relatedId === 'string' ? event.relatedId : undefined,
    relatedType: typeof event.relatedType === 'string' ? event.relatedType : undefined,
    sourceDocumentId: documentId,
    sourceType: 'notification_event',
    summary: trimToLength(
      [
        event.eventType ? `${event.eventType} notification failed.` : 'Notification delivery failed.',
        event.errorMessage ? `Error: ${event.errorMessage}` : '',
      ].filter(Boolean).join(' '),
      500
    ),
    taskKey,
    taskType: 'notification_failure',
    title: 'Notification delivery failed',
  };
};

const notificationFailureStates = [
  'failed',
  'bounced',
  'dropped',
  'blocked',
  'suppressed',
  'spam_reported',
];

const isHighValueNotificationEvent = (event: DocumentRecord) => {
  const haystack = [
    event.eventType,
    event.templateKey,
    event.relatedType,
    event.priority,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (['high', 'urgent'].includes(String(event.priority || ''))) {
    return true;
  }

  return [
    '2fa',
    'otp',
    'staff',
    'invite',
    'support',
    'refund',
    'interview',
    'feedback',
    'appeal',
    'amendment',
    'payment',
    'enrollment',
  ].some((keyword) => haystack.includes(keyword));
};

const auditTask = (event: DocumentRecord): AdminTaskDraft | null => {
  const documentId = getDocumentId(event);

  if (!documentId || !event.eventType) {
    return null;
  }

  const taskKey = `audit:${documentId}:${event.eventType}`;
  const isCritical = event.severity === 'critical';

  return {
    actionLabel: 'Review event',
    actionPath: taskDetailPath(taskKey),
    metadata: {
      eventCategory: event.eventCategory,
      eventType: event.eventType,
      occurredAt: event.occurredAt,
      severity: event.severity,
      sourceCreatedAt: event.createdAt,
      sourceDetectedAt: sourceTimestamp(event),
      subjectId: event.subjectId,
      subjectType: event.subjectType,
    },
    priority: isCritical ? 'urgent' : 'high',
    relatedDocumentId: typeof event.subjectId === 'string' ? event.subjectId : undefined,
    relatedType: typeof event.subjectType === 'string' ? event.subjectType : undefined,
    sourceDocumentId: documentId,
    sourceType: 'audit_event',
    summary: trimToLength(
      [
        `${event.eventCategory || 'System'} event ${event.eventType} was recorded as ${event.severity}.`,
        event.subjectDisplayName ? `Subject: ${event.subjectDisplayName}.` : '',
      ].filter(Boolean).join(' '),
      500
    ),
    taskKey,
    taskType: 'system_alert',
    title: isCritical ? 'Critical audit event' : 'Error audit event',
  };
};

const supportCaseTask = (supportCase: DocumentRecord): AdminTaskDraft | null => {
  const documentId = getDocumentId(supportCase);

  if (!documentId) {
    return null;
  }

  const metadata = objectValue(supportCase.metadata);
  const candidateName = candidateDisplayName(supportCase.candidate);
  const employer = documentRecordValue(supportCase.employer);
  const employerContact = documentRecordValue(supportCase.employerContact);
  const employerName = displayNameFallback(employer);
  const employerContactName = candidateDisplayName(employerContact) || displayNameFallback(employerContact);
  const flaggedAt = typeof metadata.flaggedAt === 'string' ? metadata.flaggedAt : undefined;
  const kind = typeof metadata.kind === 'string' ? metadata.kind : 'support_case';

  return {
    actionLabel: 'Review case',
    actionPath: supportCasePath(documentId),
    metadata: {
      feedbackDocumentId: metadata.feedbackDocumentId,
      interviewDocumentId: metadata.interviewDocumentId,
      kind,
      sourceCreatedAt: supportCase.createdAt,
      sourceDetectedAt: flaggedAt || sourceTimestamp(supportCase),
    },
    priority: supportCase.priority || 'high',
    relatedDocumentId: documentId,
    relatedType: 'support_case',
    sourceDocumentId: documentId,
    sourceType: 'support_case',
    summary: trimToLength(
      [
        supportCase.summary || 'Support case needs review.',
        candidateName ? `Candidate: ${candidateName}.` : '',
        employerName ? `Employer: ${employerName}.` : '',
        employerContactName ? `Contact: ${employerContactName}.` : '',
      ].filter(Boolean).join(' '),
      500
    ),
    taskKey: `support-case:${documentId}:${kind}`,
    taskType: 'support_case',
    title: supportCase.title || 'Support case',
  };
};

const aiFeedbackFailureTask = (feedback: DocumentRecord): AdminTaskDraft | null => {
  const documentId = getDocumentId(feedback);

  if (!documentId) {
    return null;
  }

  const interview = documentRecordValue(feedback.interview);
  const candidate = documentRecordValue(interview?.candidate);
  const candidateName = candidateDisplayName(candidate);
  const failureDetectedAt =
    feedback.candidateReportFailureFirstDetectedAt ||
    feedback.candidateReportLastAttemptAt ||
    feedback.updatedAt ||
    feedback.createdAt;
  const escalatedToAdminAt = addBusinessHours(failureDetectedAt, 4);
  const isEscalated = Boolean(escalatedToAdminAt && Date.parse(escalatedToAdminAt) <= Date.now());
  const retryCount = typeof feedback.candidateReportRetryCount === 'number'
    ? feedback.candidateReportRetryCount
    : 0;
  const taskKey = `ai-feedback-report:${documentId}:failed`;

  return {
    actionLabel: 'Review report',
    actionPath: aiFeedbackReviewPath(documentId),
    metadata: {
      candidateName,
      escalatedToAdminAt,
      failureCategory: feedback.candidateReportFailureCategory || null,
      failureDetectedAt,
      failureReason: feedback.candidateReportFailureReason || null,
      feedbackDocumentId: documentId,
      interviewDocumentId: getDocumentId(interview),
      model: feedback.aiModel || null,
      provider: feedback.aiProvider || null,
      retryCount,
      sourceCreatedAt: feedback.createdAt,
      sourceDetectedAt: failureDetectedAt || sourceTimestamp(feedback),
      visibleRoleKeys: isEscalated
        ? ['support', 'sales', 'admin', 'super_admin']
        : ['support', 'sales'],
    },
    priority: isEscalated ? 'urgent' : 'high',
    relatedDocumentId: getDocumentId(interview),
    relatedType: getDocumentId(interview) ? 'interview' : undefined,
    sourceDocumentId: documentId,
    sourceType: 'interview_feedback',
    summary: trimToLength(
      [
        'AI feedback report generation failed and needs staff recovery.',
        candidateName ? `Candidate: ${candidateName}.` : '',
        retryCount ? `Automatic attempts: ${retryCount}.` : '',
      ].filter(Boolean).join(' '),
      500
    ),
    taskKey,
    taskType: 'ai_feedback_review',
    title: 'AI feedback report failed',
  };
};

const addCalendarDays = (value?: string | Date | null, days = 7) => {
  const parsed = value ? new Date(value) : undefined;

  if (!parsed || !Number.isFinite(parsed.getTime())) {
    return null;
  }

  const result = new Date(parsed.getTime());
  result.setUTCDate(result.getUTCDate() + Math.max(0, Math.floor(days)));
  return result.toISOString();
};

const interviewCandidateName = (interview: DocumentRecord) =>
  candidateDisplayName(documentRecordValue(interview.candidate));

const interviewEmployerName = (interview: DocumentRecord) =>
  typeof documentRecordValue(interview.employer)?.companyName === 'string'
    ? String(documentRecordValue(interview.employer)?.companyName)
    : undefined;

const interviewDetailsOverdueTask = (interview: DocumentRecord): AdminTaskDraft | null => {
  const documentId = getDocumentId(interview);
  const dueAt = interview.employerDetailsDueAt || interview.createdAt;

  if (!documentId || !dueAt || Date.parse(dueAt) > Date.now()) {
    return null;
  }

  const releaseEligibleAt = interview.employerDetailsReleaseEligibleAt || null;
  const releaseEligible = Boolean(releaseEligibleAt && Date.parse(releaseEligibleAt) <= Date.now());
  const candidateName = interviewCandidateName(interview);
  const employerName = interviewEmployerName(interview);

  return {
    actionLabel: 'Review interview',
    actionPath: interviewOperationsPath({
      issue: 'details_overdue',
      interview: documentId,
    }),
    metadata: {
      candidateName,
      dueAt,
      employerName,
      issue: 'details_overdue',
      interviewDocumentId: documentId,
      releaseEligibleAt,
      sourceCreatedAt: interview.createdAt,
      sourceDetectedAt: dueAt,
      visibleRoleKeys: ['sales', 'admin', 'super_admin'],
    },
    priority: releaseEligible ? 'urgent' : 'high',
    relatedDocumentId: documentId,
    relatedType: 'interview',
    sourceDocumentId: documentId,
    sourceType: 'interview',
    summary: trimToLength(
      [
        'Employer interview details are overdue.',
        candidateName ? `Candidate: ${candidateName}.` : '',
        employerName ? `Employer: ${employerName}.` : '',
      ].filter(Boolean).join(' '),
      500
    ),
    taskKey: `interview:${documentId}:details_overdue`,
    taskType: 'interview_operation',
    title: releaseEligible ? 'Interview details release due' : 'Interview details overdue',
  };
};

const interviewDetailsReleasedTask = (interview: DocumentRecord): AdminTaskDraft | null => {
  const documentId = getDocumentId(interview);

  if (
    !documentId ||
    interview.interviewState !== 'employer_cancelled' ||
    interview.employerDetailsReleaseReason !== 'employer_did_not_confirm'
  ) {
    return null;
  }

  const releasedAt = interview.employerDetailsReleasedAt || interview.updatedAt || interview.createdAt;
  const candidateName = interviewCandidateName(interview);
  const employerName = interviewEmployerName(interview);

  return {
    actionLabel: 'Review release',
    actionPath: interviewOperationsPath({
      issue: 'details_released',
      interview: documentId,
    }),
    metadata: {
      candidateName,
      employerName,
      issue: 'details_released',
      interviewDocumentId: documentId,
      releasedAt,
      sourceCreatedAt: interview.createdAt,
      sourceDetectedAt: releasedAt || sourceTimestamp(interview),
      visibleRoleKeys: ['sales', 'admin', 'super_admin'],
    },
    priority: 'high',
    relatedDocumentId: documentId,
    relatedType: 'interview',
    sourceDocumentId: documentId,
    sourceType: 'interview',
    summary: trimToLength(
      [
        'Interview was released because the employer did not confirm final details.',
        candidateName ? `Candidate: ${candidateName}.` : '',
        employerName ? `Employer: ${employerName}.` : '',
      ].filter(Boolean).join(' '),
      500
    ),
    taskKey: `interview:${documentId}:details_released`,
    taskType: 'interview_operation',
    title: 'Interview released',
  };
};

const interviewCandidateRestrictionCancelledTask = (interview: DocumentRecord): AdminTaskDraft | null => {
  const documentId = getDocumentId(interview);
  const metadata = objectValue(interview.metadata);
  const cancelledAt =
    typeof metadata.candidateRestrictionCancelledAt === 'string'
      ? metadata.candidateRestrictionCancelledAt
      : null;

  if (
    !documentId ||
    interview.interviewState !== 'cancelled' ||
    interview.employerDetailsReleaseReason !== 'other' ||
    !cancelledAt
  ) {
    return null;
  }

  const candidateName = interviewCandidateName(interview);
  const employerName = interviewEmployerName(interview);

  return {
    actionLabel: 'Review cancellation',
    actionPath: interviewOperationsPath({
      issue: 'candidate_restriction_cancelled',
      interview: documentId,
    }),
    metadata: {
      candidateName,
      cancelledAt,
      employerName,
      issue: 'candidate_restriction_cancelled',
      interviewDocumentId: documentId,
      sourceCreatedAt: interview.createdAt,
      sourceDetectedAt: cancelledAt,
      visibleRoleKeys: ['sales', 'admin', 'super_admin'],
    },
    priority: 'high',
    relatedDocumentId: documentId,
    relatedType: 'interview',
    sourceDocumentId: documentId,
    sourceType: 'interview',
    summary: trimToLength(
      [
        'HireFlip cancelled an interview on behalf of a restricted candidate account.',
        candidateName ? `Candidate: ${candidateName}.` : '',
        employerName ? `Employer: ${employerName}.` : '',
      ].filter(Boolean).join(' '),
      500
    ),
    taskKey: `interview:${documentId}:candidate_restriction_cancelled`,
    taskType: 'interview_operation',
    title: 'Interview cancelled by HireFlip',
  };
};

const interviewFeedbackOverdueTask = (interview: DocumentRecord): AdminTaskDraft | null => {
  const documentId = getDocumentId(interview);
  const referenceAt =
    interview.scheduledEndTime || interview.completedAt || interview.scheduledStartTime || interview.createdAt;
  const dueAt = interview.feedbackDueAt || addCalendarDays(referenceAt || null, 7);

  if (!documentId || !dueAt || Date.parse(dueAt) > Date.now()) {
    return null;
  }

  const escalatedToAdminAt = addBusinessHours(dueAt, 4);
  const isEscalated = Boolean(escalatedToAdminAt && Date.parse(escalatedToAdminAt) <= Date.now());
  const candidateName = interviewCandidateName(interview);
  const employerName = interviewEmployerName(interview);

  return {
    actionLabel: 'Review feedback',
    actionPath: interviewOperationsPath({
      issue: 'feedback_overdue',
      interview: documentId,
    }),
    metadata: {
      candidateName,
      dueAt,
      employerName,
      escalatedToAdminAt,
      issue: 'feedback_overdue',
      interviewDocumentId: documentId,
      sourceCreatedAt: interview.createdAt,
      sourceDetectedAt: interview.feedbackOverdueDetectedAt || dueAt,
      visibleRoleKeys: isEscalated
        ? ['support', 'sales', 'admin', 'super_admin']
        : ['support', 'sales'],
    },
    priority: isEscalated ? 'urgent' : 'high',
    relatedDocumentId: documentId,
    relatedType: 'interview',
    sourceDocumentId: documentId,
    sourceType: 'interview',
    summary: trimToLength(
      [
        'Employer feedback is overdue.',
        candidateName ? `Candidate: ${candidateName}.` : '',
        employerName ? `Employer: ${employerName}.` : '',
      ].filter(Boolean).join(' '),
      500
    ),
    taskKey: `interview:${documentId}:feedback_overdue`,
    taskType: 'interview_operation',
    title: 'Interview feedback overdue',
  };
};

const interviewProgressionExpiredTask = (request: DocumentRecord): AdminTaskDraft | null => {
  const documentId = getDocumentId(request);

  if (!documentId || request.progressionState !== 'expired') {
    return null;
  }

  const candidateName = candidateDisplayName(documentRecordValue(request.candidate));
  const employerName =
    typeof documentRecordValue(request.employer)?.companyName === 'string'
      ? String(documentRecordValue(request.employer)?.companyName)
      : undefined;
  const referenceAt =
    request.candidateRespondedAt ||
    request.candidateResponseDeadline ||
    request.requestedDetailsAt ||
    request.updatedAt ||
    request.createdAt;

  return {
    actionLabel: 'Review progression',
    actionPath: interviewOperationsPath({
      issue: 'progression_expired',
      progression: documentId,
    }),
    metadata: {
      candidateName,
      employerName,
      issue: 'progression_expired',
      progressionRequestDocumentId: documentId,
      sourceCreatedAt: request.createdAt,
      sourceDetectedAt: referenceAt,
      visibleRoleKeys: ['sales', 'admin', 'super_admin'],
    },
    priority: 'high',
    relatedDocumentId: documentId,
    relatedType: 'progression_request',
    sourceDocumentId: documentId,
    sourceType: 'progression_request',
    summary: trimToLength(
      [
        'Candidate did not respond to an employer progression request.',
        candidateName ? `Candidate: ${candidateName}.` : '',
        employerName ? `Employer: ${employerName}.` : '',
      ].filter(Boolean).join(' '),
      500
    ),
    taskKey: `progression_request:${documentId}:expired`,
    taskType: 'interview_operation',
    title: 'Progression request expired',
  };
};

const interviewCapacityShortfallTask = (request: DocumentRecord): AdminTaskDraft | null => {
  const documentId = getDocumentId(request);

  if (!documentId || request.requestState !== 'pending_capacity') {
    return null;
  }

  const candidateName = candidateDisplayName(documentRecordValue(request.candidate));
  const classRecord = documentRecordValue(request.class);
  const regionRecord = documentRecordValue(request.region);
  const className =
    typeof classRecord?.displayTitle === 'string'
      ? classRecord.displayTitle
      : typeof classRecord?.name === 'string'
        ? classRecord.name
        : undefined;
  const regionName =
    typeof regionRecord?.name === 'string'
      ? regionRecord.name
      : typeof classRecord?.region === 'string'
        ? classRecord.region
        : undefined;
  const detectedAt =
    request.insufficientCapacityDetectedAt ||
    request.updatedAt ||
    request.createdAt ||
    new Date().toISOString();

  return {
    actionLabel: 'Review capacity',
    actionPath: interviewOperationsPath({
      issue: 'capacity_shortfall',
      request: documentId,
    }),
    metadata: {
      candidateName,
      className,
      dueAt: detectedAt,
      issue: 'capacity_shortfall',
      reason: request.insufficientCapacityReason || null,
      regionName: regionName || null,
      requestDocumentId: documentId,
      requestState: request.requestState || null,
      sourceCreatedAt: request.createdAt,
      sourceDetectedAt: detectedAt,
      visibleRoleKeys: ['sales', 'admin', 'super_admin'],
    },
    priority: 'urgent',
    relatedDocumentId: getDocumentId(classRecord),
    relatedType: getDocumentId(classRecord) ? 'class' : undefined,
    sourceDocumentId: documentId,
    sourceType: 'interview_request',
    summary: trimToLength(
      [
        request.insufficientCapacityReason || 'Insufficient employer interview capacity for an interview request.',
        candidateName ? `Candidate: ${candidateName}.` : '',
        className ? `Class: ${className}.` : '',
        regionName ? `Region: ${regionName}.` : '',
      ].filter(Boolean).join(' '),
      500
    ),
    taskKey: `interview-request:${documentId}:capacity_shortfall`,
    taskType: 'interview_operation',
    title: 'Capacity shortfall',
  };
};

const collectPaymentTasks = async (strapi: StrapiDocumentService) => {
  const payments = await findAllDocuments(strapi, 'api::payment.payment', {
    filters: {
      paymentState: 'requires_review',
    },
    populate: ['candidate', 'enrollment', 'reservation'],
    sort: ['createdAt:desc'],
  });

  return payments.map(paymentTask).filter((task): task is AdminTaskDraft => Boolean(task));
};

const collectReservationTasks = async (strapi: StrapiDocumentService) => {
  const reservations = await findAllDocuments(strapi, 'api::reservation.reservation', {
    filters: {
      reservationState: 'payment_exception',
    },
    populate: ['candidate', 'class', 'enrollment'],
    sort: ['createdAt:desc'],
  });
  const tasks: AdminTaskDraft[] = [];

  for (const reservation of reservations) {
    const reservationDocumentId = getDocumentId(reservation);
    const hasPayment = await hasRequiresReviewPayment(strapi, 'reservation', reservationDocumentId);

    if (!hasPayment) {
      const task = reservationTask(reservation);

      if (task) {
        tasks.push(task);
      }
    }
  }

  return tasks;
};

const collectEnrollmentTasks = async (strapi: StrapiDocumentService) => {
  const enrollments = await findAllDocuments(strapi, 'api::enrollment.enrollment', {
    filters: {
      $or: [
        {
          enrollmentState: 'payment_exception',
        },
        {
          paymentStatus: 'requires_review',
        },
      ],
    },
    populate: ['candidate', 'class'],
    sort: ['createdAt:desc'],
  });
  const tasks: AdminTaskDraft[] = [];

  for (const enrollment of enrollments) {
    const enrollmentDocumentId = getDocumentId(enrollment);
    const hasPayment = await hasRequiresReviewPayment(strapi, 'enrollment', enrollmentDocumentId);
    const hasReservation = await hasPaymentExceptionReservation(strapi, enrollmentDocumentId);

    if (!hasPayment && !hasReservation) {
      const task = enrollmentTask(enrollment);

      if (task) {
        tasks.push(task);
      }
    }
  }

  return tasks;
};

const collectRefundTasks = async (strapi: StrapiDocumentService) => {
  const refunds = await findAllDocuments(strapi, 'api::refund.refund', {
    filters: {
      refundState: {
        $in: ['requested', 'approved', 'failed'],
      },
    },
    populate: ['candidate', 'enrollment', 'payment'],
    sort: ['createdAt:desc'],
  });

  return refunds.map(refundTask).filter((task): task is AdminTaskDraft => Boolean(task));
};

const collectAssessmentAppealTasks = async (strapi: StrapiDocumentService) => {
  const appeals = await findAllDocuments(strapi, 'api::assessment-appeal.assessment-appeal', {
    filters: {
      appealState: {
        $in: ['submitted', 'under_review'],
      },
    },
    populate: ['candidate', 'courseTestAttempt', 'enrollment'],
    sort: ['submittedAt:desc', 'createdAt:desc'],
  });

  return appeals.map(assessmentAppealTask).filter((task): task is AdminTaskDraft => Boolean(task));
};

const collectNotificationTasks = async (strapi: StrapiDocumentService) => {
  const events = await findAllDocuments(strapi, 'api::notification-event.notification-event', {
    filters: {
      deliveryState: {
        $in: notificationFailureStates,
      },
    },
    sort: ['failedAt:desc', 'updatedAt:desc', 'createdAt:desc'],
  });

  return events
    .filter(isHighValueNotificationEvent)
    .map(notificationTask)
    .filter((task): task is AdminTaskDraft => Boolean(task));
};

const collectAuditTasks = async (strapi: StrapiDocumentService) => {
  const occurredAfter = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const events = await findAllDocuments(strapi, 'api::audit-event.audit-event', {
    filters: {
      occurredAt: {
        $gte: occurredAfter,
      },
      severity: {
        $in: ['error', 'critical'],
      },
    },
    sort: ['occurredAt:desc', 'createdAt:desc'],
  });

  return events.map(auditTask).filter((task): task is AdminTaskDraft => Boolean(task));
};

const collectSupportCaseTasks = async (strapi: StrapiDocumentService) => {
  const cases = await findAllDocuments(strapi, 'api::support-case.support-case', {
    filters: {
      caseState: {
        $in: ['open', 'awaiting_staff', 'in_progress'],
      },
    },
    populate: ['candidate', 'employer', 'employerContact'],
    sort: ['lastMessageAt:desc', 'createdAt:desc'],
  });

  return cases
    .map(supportCaseTask)
    .filter((task): task is AdminTaskDraft => Boolean(task));
};

const activePrivacyRequestStates = [
  'received',
  'identity_verification_required',
  'in_review',
  'clarification_requested',
  'processing',
];

const privacyRequestTask = (request: DocumentRecord): AdminTaskDraft | null => {
  const documentId = getDocumentId(request);

  if (!documentId) {
    return null;
  }

  const subject =
    request.subjectUserType === 'employer_contact'
      ? documentRecordValue(request.employerContact)
      : documentRecordValue(request.candidate);
  const subjectName = candidateDisplayName(subject) || displayNameFallback(subject);
  const dueAt = typeof request.dueAt === 'string' ? request.dueAt : null;
  const dueTime = dueAt ? Date.parse(dueAt) : Number.NaN;
  const isOverdue = Number.isFinite(dueTime) && dueTime < Date.now();
  const isDueSoon =
    Number.isFinite(dueTime) && dueTime - Date.now() <= 5 * 24 * 60 * 60 * 1000;
  const requestTypeLabel = String(request.requestType || 'privacy').replace(/[_-]+/g, ' ');
  const requestStateLabel = String(request.requestState || 'received').replace(/[_-]+/g, ' ');

  return {
    actionLabel: 'Review request',
    actionPath: privacyRequestPath(documentId),
    metadata: {
      dueAt,
      requestState: request.requestState || null,
      requestType: request.requestType || null,
      sourceCreatedAt: request.createdAt,
      sourceDetectedAt: request.receivedAt || sourceTimestamp(request),
      subjectName: subjectName || null,
      subjectType: request.subjectUserType || null,
      visibleRoleKeys: ['admin', 'super_admin'],
    },
    priority: isOverdue ? 'urgent' : isDueSoon ? 'high' : 'normal',
    relatedDocumentId: getDocumentId(subject),
    relatedType: typeof request.subjectUserType === 'string' ? request.subjectUserType : undefined,
    sourceDocumentId: documentId,
    sourceType: 'privacy_rights_request',
    summary: trimToLength(
      [
        `${requestTypeLabel} privacy request is ${requestStateLabel}.`,
        subjectName ? `Subject: ${subjectName}.` : '',
        dueAt ? `Due: ${new Date(dueAt).toLocaleDateString('en-GB')}.` : '',
      ].filter(Boolean).join(' '),
      500
    ),
    taskKey: `privacy-request:${documentId}`,
    taskType: 'privacy_request',
    title: isOverdue ? 'Privacy request overdue' : 'Privacy request needs review',
  };
};

function displayNameFallback(record?: DocumentRecord) {
  if (!record) {
    return undefined;
  }

  return (
    [record.firstName, record.lastName].filter(Boolean).join(' ').trim() ||
    (typeof record.companyName === 'string' ? record.companyName : undefined) ||
    (typeof record.email === 'string' ? record.email : undefined)
  );
}

const collectPrivacyRequestTasks = async (strapi: StrapiDocumentService) => {
  const requests = await findAllDocuments(strapi, 'api::privacy-rights-request.privacy-rights-request', {
    filters: {
      requestState: {
        $in: activePrivacyRequestStates,
      },
    },
    populate: {
      candidate: true,
      employerContact: {
        populate: ['employer'],
      },
    },
    sort: ['dueAt:asc', 'receivedAt:asc', 'createdAt:asc'],
  });

  return requests.map(privacyRequestTask).filter((task): task is AdminTaskDraft => Boolean(task));
};

const classDisplayName = (classRecord: DocumentRecord) =>
  String(classRecord.displayTitle || classRecord.name || classRecord.documentId || 'Class');

const classReadinessTask = (classRecord: DocumentRecord): AdminTaskDraft | null => {
  const documentId = getDocumentId(classRecord);
  const summary = objectValue(classRecord.openingReadinessSummary);
  const ready = summary.ready === true || classRecord.openingReadinessStatus === 'ready';
  const blockerKeys = Array.isArray(summary.blockerKeys) ? summary.blockerKeys.map(String) : [];

  if (!documentId || ready || classRecord.openingReadinessStatus !== 'blocked') {
    return null;
  }

  const title = blockerKeys.includes('employer_capacity')
    ? 'Class needs employer capacity'
    : blockerKeys.includes('course_setup')
      ? 'Class needs course setup'
      : 'Class opening is blocked';
  const regionName = documentRecordValue(classRecord.classArea)?.name || classRecord.region;
  const sectorName = documentRecordValue(classRecord.workSector)?.name || classRecord.sector;
  const required = typeof summary.requiredInterviewCapacity === 'number'
    ? summary.requiredInterviewCapacity
    : null;
  const available = typeof summary.availableInterviewCapacity === 'number'
    ? summary.availableInterviewCapacity
    : null;
  const shortfall = typeof summary.shortfallByRegion === 'number'
    ? summary.shortfallByRegion
    : required !== null && available !== null
      ? Math.max(0, required - available)
      : null;
  const sourceDetectedAt =
    classRecord.openingReadinessCheckedAt || String(summary.checkedAt || '') || sourceTimestamp(classRecord);

  return {
    actionLabel: 'Review class',
    actionPath: classPath(documentId),
    metadata: {
      availableInterviewCapacity: available,
      blockerKeys,
      className: classDisplayName(classRecord),
      minimumViableCapacity: summary.minimumViableCapacity ?? null,
      regionName: regionName || null,
      requiredInterviewCapacity: required,
      sectorName: sectorName || null,
      shortfall,
      sourceCreatedAt: classRecord.createdAt,
      sourceDetectedAt,
      visibleRoleKeys: blockerKeys.includes('employer_capacity')
        ? ['sales', 'admin', 'super_admin']
        : ['admin', 'super_admin'],
    },
    priority: blockerKeys.includes('employer_capacity') ? 'high' : 'normal',
    relatedDocumentId: documentId,
    relatedType: 'class',
    sourceDocumentId: documentId,
    sourceType: 'class',
    summary: trimToLength(
      [
        classDisplayName(classRecord),
        regionName ? `Region: ${regionName}.` : '',
        sectorName ? `Sector: ${sectorName}.` : '',
        shortfall && shortfall > 0
          ? `Interview capacity shortfall: ${shortfall} slot(s).`
          : '',
        typeof summary.reason === 'string' ? summary.reason : '',
      ].filter(Boolean).join(' '),
      500
    ),
    taskKey: `class-readiness:${documentId}`,
    taskType: 'class_readiness',
    title,
  };
};

const collectClassReadinessTasks = async (strapi: StrapiDocumentService) => {
  const classes = await findAllDocuments(strapi, 'api::class.class', {
    filters: {
      openingReadinessStatus: 'blocked',
      state: {
        $in: ['draft', 'coming_soon', 'waitlist_open'],
      },
    },
    populate: ['classArea', 'workSector'],
    sort: ['openingReadinessCheckedAt:desc', 'updatedAt:desc', 'createdAt:desc'],
  });

  return classes.map(classReadinessTask).filter((task): task is AdminTaskDraft => Boolean(task));
};

const collectAiFeedbackFailureTasks = async (strapi: StrapiDocumentService) => {
  const feedbackRecords = await findAllDocuments(strapi, 'api::interview-feedback.interview-feedback', {
    filters: {
      candidateReportState: 'failed',
    },
    populate: {
      interview: {
        populate: ['candidate', 'employer'],
      },
    },
    sort: ['candidateReportFailureFirstDetectedAt:asc', 'updatedAt:asc', 'createdAt:asc'],
  });

  return feedbackRecords
    .map(aiFeedbackFailureTask)
    .filter((task): task is AdminTaskDraft => Boolean(task));
};

const collectInterviewDetailTasks = async (strapi: StrapiDocumentService) => {
  const interviews = await findAllDocuments(strapi, 'api::interview.interview', {
    filters: {
      $or: [
        {
          interviewState: 'awaiting_employer_details',
        },
        {
          employerDetailsReleaseReason: 'employer_did_not_confirm',
          interviewState: 'employer_cancelled',
        },
        {
          employerDetailsReleaseReason: 'other',
          interviewState: 'cancelled',
        },
      ],
    },
    populate: ['candidate', 'employer', 'employerContact'],
    sort: ['employerDetailsDueAt:asc', 'createdAt:asc'],
  });

  return interviews
    .flatMap((interview) => [
      interviewDetailsOverdueTask(interview),
      interviewDetailsReleasedTask(interview),
      interviewCandidateRestrictionCancelledTask(interview),
    ])
    .filter((task): task is AdminTaskDraft => Boolean(task));
};

const collectInterviewFeedbackTasks = async (strapi: StrapiDocumentService) => {
  const interviews = await findAllDocuments(strapi, 'api::interview.interview', {
    filters: {
      interviewState: 'completed',
    },
    populate: ['candidate', 'employer', 'employerContact'],
    sort: ['feedbackDueAt:asc', 'completedAt:asc', 'createdAt:asc'],
  });
  const interviewDocumentIds = interviews
    .map(getDocumentId)
    .filter((documentId): documentId is string => Boolean(documentId));
  const feedbackRecords = interviewDocumentIds.length
    ? await findAllDocuments(strapi, 'api::interview-feedback.interview-feedback', {
        filters: {
          interview: {
            documentId: {
              $in: interviewDocumentIds,
            },
          },
          submittedByType: 'employer_contact',
        },
        populate: ['interview'],
      })
    : [];
  const feedbackInterviewIds = new Set(
    feedbackRecords
      .map((feedback) => getDocumentId(feedback.interview))
      .filter((documentId): documentId is string => Boolean(documentId))
  );

  return interviews
    .filter((interview) => {
      const interviewDocumentId = getDocumentId(interview);
      return Boolean(interviewDocumentId && !feedbackInterviewIds.has(interviewDocumentId));
    })
    .map(interviewFeedbackOverdueTask)
    .filter((task): task is AdminTaskDraft => Boolean(task));
};

const collectInterviewProgressionTasks = async (strapi: StrapiDocumentService) => {
  const progressionRequests = await findAllDocuments(strapi, 'api::offer.offer', {
    filters: {
      progressionState: 'expired',
    },
    populate: ['candidate', 'employer', 'interview', 'requestedByEmployerContact'],
    sort: ['candidateRespondedAt:desc', 'updatedAt:desc', 'createdAt:desc'],
  });

  return progressionRequests
    .map(interviewProgressionExpiredTask)
    .filter((task): task is AdminTaskDraft => Boolean(task));
};

const collectInterviewCapacityShortfallTasks = async (strapi: StrapiDocumentService) => {
  const requests = await findAllDocuments(strapi, 'api::interview-request.interview-request', {
    filters: {
      insufficientCapacityDetectedAt: {
        $notNull: true,
      },
      requestState: 'pending_capacity',
    },
    populate: ['candidate', 'class', 'region'],
    sort: ['insufficientCapacityDetectedAt:desc', 'updatedAt:desc'],
  });

  return requests
    .map(interviewCapacityShortfallTask)
    .filter((task): task is AdminTaskDraft => Boolean(task));
};

const collectTaskDrafts = async (strapi: StrapiDocumentService) => {
  const [
    assessmentAppeals,
    interviewCapacityShortfalls,
    interviewDetails,
    interviewFeedback,
    interviewProgression,
    payments,
    reservations,
    enrollments,
    refunds,
    notifications,
    privacyRequests,
    auditEvents,
    aiFeedbackFailures,
    classReadiness,
    supportCases,
  ] = await Promise.all([
    collectAssessmentAppealTasks(strapi),
    collectInterviewCapacityShortfallTasks(strapi),
    collectInterviewDetailTasks(strapi),
    collectInterviewFeedbackTasks(strapi),
    collectInterviewProgressionTasks(strapi),
    collectPaymentTasks(strapi),
    collectReservationTasks(strapi),
    collectEnrollmentTasks(strapi),
    collectRefundTasks(strapi),
    collectNotificationTasks(strapi),
    collectPrivacyRequestTasks(strapi),
    collectAuditTasks(strapi),
    collectAiFeedbackFailureTasks(strapi),
    collectClassReadinessTasks(strapi),
    collectSupportCaseTasks(strapi),
  ]);

  return [
    ...assessmentAppeals,
    ...interviewCapacityShortfalls,
    ...interviewDetails,
    ...interviewFeedback,
    ...interviewProgression,
    ...payments,
    ...reservations,
    ...enrollments,
    ...refunds,
    ...notifications,
    ...privacyRequests,
    ...auditEvents,
    ...aiFeedbackFailures,
    ...classReadiness,
    ...supportCases,
  ];
};

const publicTask = (task: DocumentRecord) => {
  const taskState = task.taskState || 'open';
  const canAcknowledge = isClearableTask(task) && taskState === 'open';

  return {
    actionLabel: task.actionLabel || 'Review task',
    actionPath: task.actionPath || '/',
    canAcknowledge,
    createdAt: task.createdAt || null,
    documentId: getDocumentId(task) || '',
    lastDetectedAt: task.lastDetectedAt || null,
    priority: task.priority || 'normal',
    relatedDocumentId: task.relatedDocumentId || null,
    relatedType: task.relatedType || null,
    sourceDocumentId: task.sourceDocumentId || null,
    sourceType: task.sourceType || null,
    issueKey: task.issueKey || firstMetadataString(objectValue(task.metadata), ['issue']),
    summary: task.summary || '',
    taskKey: task.taskKey || '',
    taskState,
    taskType: task.taskType || 'system_alert',
    taskTypeLabel: task.taskType ? taskTypeLabels[task.taskType] : 'Task',
    title: task.title || 'Task',
    updatedAt: task.updatedAt || null,
  };
};

const publicTaskDetail = (task: DocumentRecord) => ({
  ...publicTask(task),
  metadata: objectValue(task.metadata),
});

const stringValue = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const firstMetadataString = (metadata: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const value = stringValue(metadata[key]);

    if (value) {
      return value;
    }
  }

  return null;
};

const summaryField = (summary: unknown, label: string) => {
  const value = stringValue(summary);

  if (!value) {
    return null;
  }

  const match = value.match(new RegExp(`${label}:\\s*([^\\.]+)`, 'i'));
  return match?.[1]?.trim() || null;
};

const taskDueAt = (task: DocumentRecord) => {
  const metadata = objectValue(task.metadata);

  return firstMetadataString(metadata, [
    'dueAt',
    'responseDueAt',
    'candidateResponseDeadline',
    'escalatedToAdminAt',
  ]);
};

const defaultOwnerKeysByTaskType: Record<AdminTaskType, string[]> = {
  assessment_appeal: ['admin'],
  ai_feedback_review: ['support', 'sales'],
  class_readiness: ['admin'],
  interview_operation: ['sales'],
  notification_failure: ['super_admin'],
  payment_review: ['admin'],
  privacy_request: ['admin'],
  refund_review: ['admin'],
  support_case: ['support'],
  system_alert: ['super_admin'],
};

const ownerLabels: Record<string, string> = {
  admin: 'Admin',
  sales: 'Sales',
  super_admin: 'Super admin',
  support: 'Support',
};

const taskOwnerKeys = (task: DocumentRecord) => {
  const visibleRoleKeys = objectValue(task.metadata).visibleRoleKeys;

  if (
    Array.isArray(visibleRoleKeys) &&
    visibleRoleKeys.every((roleKey) => typeof roleKey === 'string')
  ) {
    return uniqueStringValues(visibleRoleKeys);
  }

  return task.taskType
    ? defaultOwnerKeysByTaskType[task.taskType as AdminTaskType] || ['admin']
    : ['admin'];
};

const publicTaskListItem = (task: DocumentRecord) => {
  const metadata = objectValue(task.metadata);
  const ownerKeys = taskOwnerKeys(task);

  return {
    ...publicTask(task),
    candidateLabel:
      stringValue(task.candidateLabel) ||
      firstMetadataString(metadata, ['candidateName', 'subjectName']) ||
      summaryField(task.summary, 'Candidate'),
    classLabel:
      stringValue(task.classLabel) ||
      firstMetadataString(metadata, ['className']) ||
      summaryField(task.summary, 'Class'),
    dueAt: stringValue(task.dueAt) || taskDueAt(task),
    employerLabel:
      stringValue(task.employerLabel) ||
      firstMetadataString(metadata, ['employerName']) ||
      summaryField(task.summary, 'Employer'),
    ownerKeys,
    ownerLabels: ownerKeys.map((ownerKey) => ownerLabels[ownerKey] || ownerKey),
    regionLabel:
      stringValue(task.regionLabel) ||
      firstMetadataString(metadata, ['regionName']) ||
      summaryField(task.summary, 'Region'),
  };
};

type PublicTaskListItem = ReturnType<typeof publicTaskListItem>;
type TaskListQuery = z.infer<typeof taskListSchema>;

const uniqueStringValues = (values: unknown[]) =>
  [...new Set(values.map((value) => stringValue(value)).filter(Boolean))];

const taskVisibilityFilter = (session: AdminSession) => {
  if (session.user.roleKeys.includes('super_admin')) {
    return null;
  }

  if (session.user.roleKeys.some((roleKey) => ['sales', 'support'].includes(roleKey))) {
    return null;
  }

  return {
    $or: session.user.roleKeys.map((roleKey) => ({
      ownerKeyText: {
        $containsi: roleKey,
      },
    })),
  };
};

const taskDueDateFilter = (dueDate?: string) => {
  if (!dueDate) {
    return null;
  }

  const now = new Date();

  if (dueDate === 'none') {
    return {
      dueAt: {
        $null: true,
      },
    };
  }

  if (dueDate === 'overdue') {
    return {
      dueAt: {
        $lt: now.toISOString(),
      },
    };
  }

  if (dueDate === 'next_24h') {
    return {
      dueAt: {
        $gte: now.toISOString(),
        $lte: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
      },
    };
  }

  if (dueDate === 'next_7d') {
    return {
      dueAt: {
        $gte: now.toISOString(),
        $lte: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      },
    };
  }

  return null;
};

const taskRecordFilters = (query: Partial<TaskListQuery>, session: AdminSession) => {
  const filters: Record<string, unknown> = {
    taskType: {
      $in: monitoredTaskTypes,
    },
  };
  const andFilters: Record<string, unknown>[] = [];

  if (query.taskType) {
    filters.taskType = query.taskType;
  }

  if (query.taskState === 'all') {
    // No state filter.
  } else if (query.taskState) {
    filters.taskState = query.taskState;
  } else {
    filters.taskState = 'open';
  }

  if (query.priority) {
    filters.priority = query.priority;
  }

  if (query.sourceType) {
    filters.sourceType = query.sourceType;
  }

  if (query.issueKey) {
    filters.issueKey = query.issueKey;
  }

  if (query.owner) {
    filters.ownerKeyText = {
      $containsi: query.owner,
    };
  }

  if (query.candidate) {
    filters.candidateLabel = {
      $containsi: query.candidate,
    };
  }

  if (query.employer) {
    filters.employerLabel = {
      $containsi: query.employer,
    };
  }

  if (query.className) {
    filters.classLabel = {
      $containsi: query.className,
    };
  }

  if (query.region) {
    filters.regionLabel = {
      $containsi: query.region,
    };
  }

  const dueDate = taskDueDateFilter(query.dueDate);

  if (dueDate) {
    andFilters.push(dueDate);
  }

  if (query.search) {
    andFilters.push({
      $or: [
        { searchText: { $containsi: query.search } },
        { taskKey: { $containsi: query.search } },
        { sourceDocumentId: { $containsi: query.search } },
        { relatedDocumentId: { $containsi: query.search } },
        { title: { $containsi: query.search } },
        { summary: { $containsi: query.search } },
      ],
    });
  }

  const visibility = taskVisibilityFilter(session);

  if (visibility) {
    andFilters.push(visibility);
  }

  return andFilters.length ? { ...filters, $and: andFilters } : filters;
};

const option = (value: string, label: string) => ({ label, value });

const taskListFilterOptions = () => ({
  owners: Object.keys(ownerLabels).sort().map((ownerKey) => option(ownerKey, ownerLabels[ownerKey] || ownerKey)),
  priorities: (Object.keys(priorityRank) as AdminTaskPriority[])
    .sort((left, right) => priorityRank[left] - priorityRank[right])
    .map((priority) => option(priority, priority)),
  sourceTypes: [
    'assessment_appeal',
    'audit_event',
    'class',
    'enrollment',
    'interview',
    'interview_feedback',
    'interview_request',
    'notification_event',
    'payment',
    'privacy_rights_request',
    'progression_request',
    'refund',
    'reservation',
    'support_case',
  ].map((sourceType) => option(sourceType, String(sourceType).replace(/[_-]+/g, ' '))),
  states: ['acknowledged', 'dismissed', 'open', 'resolved'].map((state) => option(state, state)),
  taskTypes: monitoredTaskTypes.map((taskType) => option(taskType, taskTypeLabels[taskType] || taskType)),
});

const publishTaskChange = (strapi: StrapiDocumentService, task?: DocumentRecord) =>
  publishAdminRealtimeEvent(
    {
      channels: ['operations'],
      resourceKey: task?.taskKey,
      resourceType: 'admin_task',
      type: 'admin_tasks_changed',
    },
    (strapi as { log?: { error?: (message: string, error?: unknown) => void } }).log
  );

const taskCounts = (tasks: ReturnType<typeof publicTask>[]) => {
  const totalActiveTasks = tasks.length;

  return {
    assessmentAppeals: tasks.filter((task) => task.taskType === 'assessment_appeal').length,
    classReadiness: tasks.filter((task) => task.taskType === 'class_readiness').length,
    criticalEvents: tasks.filter((task) => task.taskType === 'system_alert').length,
    interviewOperations: tasks.filter((task) => task.taskType === 'interview_operation').length,
    notificationFailures: tasks.filter((task) => task.taskType === 'notification_failure').length,
    privacyRequests: tasks.filter((task) => task.taskType === 'privacy_request').length,
    paymentChecks: tasks.filter((task) =>
      ['payment_review', 'refund_review'].includes(task.taskType)
    ).length,
    supportCases: tasks.filter((task) => task.taskType === 'support_case').length,
    totalActiveTasks,
    totalOpenTasks: totalActiveTasks,
  };
};

const syncTaskRecords = async (strapi: StrapiDocumentService) => {
  const detectedAt = new Date().toISOString();
  const drafts = await collectTaskDrafts(strapi);
  const activeTaskKeys = new Set(drafts.map((draft) => draft.taskKey));

  await Promise.all(drafts.map((draft) => upsertTask(strapi, draft, detectedAt)));
  await resolveStaleTasks(strapi, activeTaskKeys, detectedAt);
};

const syncTasks = async (strapi: StrapiDocumentService, session?: AdminSession) =>
  {
    await syncTaskRecords(strapi);
    const filters: Record<string, unknown> = {
      taskState: {
        $in: activeTaskStates,
      },
      taskType: {
        $in: monitoredTaskTypes,
      },
    };
    const visibility = session ? taskVisibilityFilter(session) : null;
    const tasks = await findAllDocuments(strapi, 'api::admin-task.admin-task', {
      filters: visibility ? { ...filters, $and: [visibility] } : filters,
      sort: ['priorityRank:asc', 'lastDetectedAt:desc', 'createdAt:desc'],
    });

    return tasks.map(publicTask);
  };

export default factories.createCoreService('api::admin-task.admin-task', ({ strapi }) => ({
  async getOverview(input: unknown, requestContext: RequestContext = {}) {
    const body = validateOverview(input);
    const session = await assertOperationsSession(strapi, body.sessionToken, requestContext);
    const tasks = await syncTasks(strapi, session);

    return {
      counts: taskCounts(tasks),
      generatedAt: new Date().toISOString(),
      tasks,
      user: session.user,
    };
  },

  async listTasks(input: unknown, requestContext: RequestContext = {}) {
    const body = validateTaskList(input);
    const session = await assertOperationsSession(strapi, body.sessionToken, requestContext);
    await syncTaskRecords(strapi);
    const taskDocuments = documents(strapi, 'api::admin-task.admin-task');
    const filters = taskRecordFilters(body, session);
    const baseFilters = taskRecordFilters({ sessionToken: body.sessionToken }, session);
    const [filteredTasksCount, openTasksCount, totalTasksCount] = await Promise.all([
      taskDocuments.count({ filters }),
      taskDocuments.count({
        filters: {
          ...baseFilters,
          taskState: 'open',
        },
      }),
      taskDocuments.count({ filters: baseFilters }),
    ]);
    const pageCount = Math.max(1, Math.ceil(filteredTasksCount / body.pageSize));
    const page = Math.min(body.page, pageCount);
    const taskRecords = await taskDocuments.findMany({
      filters,
      limit: body.pageSize,
      sort: ['priorityRank:asc', 'lastDetectedAt:desc', 'createdAt:desc'],
      start: (page - 1) * body.pageSize,
    });
    const visibleTasks = taskRecords.map(publicTaskListItem);
    const reviewClaims = await reviewClaimService(strapi).activeClaimsForSession(
      visibleTasks.map((task) => ({
        resourceDocumentId: task.documentId,
        resourceKey: task.taskKey,
        resourceLabel: task.title,
        resourceType: 'admin_task',
      })),
      session
    );

    return {
      counts: {
        filteredTasks: filteredTasksCount,
        openTasks: openTasksCount,
        totalTasks: totalTasksCount,
      },
      filters: taskListFilterOptions(),
      generatedAt: new Date().toISOString(),
      pagination: {
        page,
        pageCount,
        pageSize: body.pageSize,
        total: filteredTasksCount,
      },
      tasks: visibleTasks.map((task) => {
        const reviewClaim = reviewClaims.get(adminTaskClaimKey(task.taskKey)) as
          | { isActive?: boolean }
          | null
          | undefined;

        return {
          ...task,
          reviewClaim: reviewClaim?.isActive ? reviewClaim : null,
        };
      }),
      user: session.user,
    };
  },

  async getTaskDetail(input: unknown, requestContext: RequestContext = {}) {
    const body = validateTaskAction(input);

    const session = await assertOperationsSession(strapi, body.sessionToken, requestContext);
    await syncTasks(strapi, session);

    const task = await findExistingTask(strapi, body.taskKey);

    if (!task) {
      throw new ValidationError('Admin task could not be found.');
    }
    if (!canViewTaskRecordForSession(task, session)) {
      throw new ForbiddenError('This task is not visible to your access level yet.');
    }
    const { reviewClaim } = await reviewClaimService(strapi).claimForSession(
      {
        resourceDocumentId: task.documentId,
        resourceKey: task.taskKey,
        resourceLabel: task.title,
        resourceType: 'admin_task',
      },
      session,
      requestContext
    );

    return {
      task: publicTaskDetail(task),
      reviewClaim,
    };
  },

  async updateTaskState(input: unknown, requestContext: RequestContext = {}) {
    const body = validateTaskStateAction(input);

    const session = await assertOperationsSession(strapi, body.sessionToken, requestContext);

    const task = await findExistingTask(strapi, body.taskKey);

    if (!task?.documentId) {
      throw new ValidationError('Admin task could not be found.');
    }

    const currentTaskState = task.taskState || 'open';

    if (!activeTaskStates.includes(currentTaskState)) {
      throw new ValidationError('Only active tasks can be updated.');
    }

    await reviewClaimService(strapi).assertActiveClaimForSession(
      {
        claimToken: body.reviewClaimToken,
        resourceDocumentId: task.documentId,
        resourceKey: task.taskKey,
        resourceLabel: task.title,
        resourceType: 'admin_task',
      },
      session
    );

    if (body.taskState === 'acknowledged') {
      if (!isClearableTask(task)) {
        throw new ValidationError(
          'Only clearable event tasks can be acknowledged from Timely Tasks.'
        );
      }

      const acknowledgedTask = await documents(strapi, 'api::admin-task.admin-task').update({
        documentId: task.documentId,
        data: {
          resolvedAt: new Date().toISOString(),
          taskState: 'acknowledged',
        },
      });
      await publishTaskChange(strapi, acknowledgedTask);

      return {
        task: publicTaskDetail(acknowledgedTask),
        updated: true,
      };
    }

    if (!isClearableTask(task)) {
      throw new ValidationError('Only clearable event tasks can be dismissed from Timely Tasks.');
    }

    const dismissedTask = await documents(strapi, 'api::admin-task.admin-task').update({
      documentId: task.documentId,
      data: {
        resolvedAt: new Date().toISOString(),
        taskState: 'dismissed',
      },
    });
    await publishTaskChange(strapi, dismissedTask);

    return {
      task: publicTaskDetail(dismissedTask),
      updated: true,
    };
  },

  async clearTask(input: unknown, requestContext: RequestContext = {}) {
    const body = validateTaskAction(input);
    const result = await this.updateTaskState(
      {
        ...body,
        taskState: 'dismissed',
      },
      requestContext
    );

    return {
      cleared: true,
      task: result.task,
    };
  },
}));

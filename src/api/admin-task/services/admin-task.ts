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
  class?: DocumentRecord;
  companyName?: string;
  completedAt?: string;
  courseTestAttempt?: DocumentRecord;
  createdAt?: string;
  currency?: string;
  deliveryState?: string;
  documentId?: string;
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
  lastDetectedAt?: string;
  lastName?: string;
  employer?: DocumentRecord;
  employerContact?: DocumentRecord;
  employerDetailsDueAt?: string;
  employerDetailsReleaseEligibleAt?: string;
  employerDetailsReleaseReason?: string;
  employerDetailsReleasedAt?: string;
  feedbackDueAt?: string;
  feedbackOverdueDetectedAt?: string;
  metadata?: unknown;
  occurredAt?: string;
  payment?: DocumentRecord;
  paymentState?: string;
  paymentStatus?: string;
  priority?: AdminTaskPriority;
  refund?: DocumentRecord;
  refundState?: string;
  relatedDocumentId?: string;
  relatedId?: string;
  relatedType?: string;
  reservation?: DocumentRecord;
  reservationState?: string;
  resolvedAt?: string | null;
  scheduledEndTime?: string;
  scheduledStartTime?: string;
  severity?: string;
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
};

type DocumentCollection = {
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
  | 'enrollment'
  | 'interview'
  | 'interview_feedback'
  | 'notification_event'
  | 'payment'
  | 'refund'
  | 'reservation'
  | 'support_case';
type AdminTaskState = 'acknowledged' | 'dismissed' | 'open' | 'resolved';
type AdminTaskType =
  | 'assessment_appeal'
  | 'ai_feedback_review'
  | 'interview_operation'
  | 'notification_failure'
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

const validateOverview = validateZodSchema(overviewSchema);
const validateTaskAction = validateZodSchema(taskActionSchema);
const validateTaskStateAction = validateZodSchema(taskStateActionSchema);

const documents = (strapi: StrapiDocumentService, uid: string) =>
  strapi.documents(uid) as unknown as DocumentCollection;

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
const refundTaskPath = (taskKey: string) => `/refunds/${taskRouteSegment(taskKey)}`;
const supportCasePath = (supportCaseDocumentId: string) =>
  `/support/${encodeURIComponent(supportCaseDocumentId)}`;
const aiFeedbackReviewPath = (feedbackDocumentId: string) =>
  `/support/ai-feedback/${encodeURIComponent(feedbackDocumentId)}`;
const notificationIssuePath = (notificationEventDocumentId: string) =>
  `/support/notification-issues/${encodeURIComponent(notificationEventDocumentId)}`;
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
  interview_operation: 'Interview operation',
  notification_failure: 'Notification failure',
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
  'interview_operation',
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
  const visibleRoleKeys = objectValue(task.metadata).visibleRoleKeys;

  if (
    Array.isArray(visibleRoleKeys) &&
    visibleRoleKeys.every((roleKey) => typeof roleKey === 'string')
  ) {
    return session.user.roleKeys.some((roleKey) => visibleRoleKeys.includes(roleKey));
  }

  if (task.taskType !== 'ai_feedback_review') {
    return true;
  }

  const metadata = objectValue(task.metadata);
  const roleKeys = session.user.roleKeys;
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

const taskData = (draft: AdminTaskDraft, detectedAt: string) => ({
  actionLabel: draft.actionLabel,
  actionPath: draft.actionPath,
  lastDetectedAt:
    typeof draft.metadata.sourceDetectedAt === 'string'
      ? draft.metadata.sourceDetectedAt
      : detectedAt,
  metadata: draft.metadata,
  priority: draft.priority,
  relatedDocumentId: draft.relatedDocumentId,
  relatedType: draft.relatedType,
  resolvedAt: null,
  sourceDocumentId: draft.sourceDocumentId,
  sourceType: draft.sourceType,
  summary: draft.summary,
  taskKey: draft.taskKey,
  taskState: 'open',
  taskType: draft.taskType,
  title: draft.title,
});

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
  const openTasks = await documents(strapi, 'api::admin-task.admin-task').findMany({
    filters: {
      taskState: {
        $in: activeTaskStates,
      },
      taskType: {
        $in: monitoredTaskTypes,
      },
    },
    limit: 1000,
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

  return {
    actionLabel: 'Review refund',
    actionPath: refundTaskPath(taskKey),
    metadata: {
      amountPence: refund.amountPence,
      currency: refund.currency || 'GBP',
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
  const flaggedAt = typeof metadata.flaggedAt === 'string' ? metadata.flaggedAt : undefined;

  return {
    actionLabel: 'Review case',
    actionPath: supportCasePath(documentId),
    metadata: {
      feedbackDocumentId: metadata.feedbackDocumentId,
      interviewDocumentId: metadata.interviewDocumentId,
      kind: metadata.kind,
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
        supportCase.summary || 'AI feedback report concern needs support review.',
        candidateName ? `Candidate: ${candidateName}.` : '',
      ].filter(Boolean).join(' '),
      500
    ),
    taskKey: `support-case:${documentId}:ai-feedback-report-concern`,
    taskType: 'support_case',
    title: supportCase.title || 'AI feedback report concern',
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

const collectPaymentTasks = async (strapi: StrapiDocumentService) => {
  const payments = await documents(strapi, 'api::payment.payment').findMany({
    filters: {
      paymentState: 'requires_review',
    },
    limit: 100,
    populate: ['candidate', 'enrollment', 'reservation'],
    sort: ['createdAt:desc'],
  });

  return payments.map(paymentTask).filter((task): task is AdminTaskDraft => Boolean(task));
};

const collectReservationTasks = async (strapi: StrapiDocumentService) => {
  const reservations = await documents(strapi, 'api::reservation.reservation').findMany({
    filters: {
      reservationState: 'payment_exception',
    },
    limit: 100,
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
  const enrollments = await documents(strapi, 'api::enrollment.enrollment').findMany({
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
    limit: 100,
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
  const refunds = await documents(strapi, 'api::refund.refund').findMany({
    filters: {
      refundState: {
        $in: ['requested', 'approved', 'failed'],
      },
    },
    limit: 100,
    populate: ['candidate', 'enrollment', 'payment'],
    sort: ['createdAt:desc'],
  });

  return refunds.map(refundTask).filter((task): task is AdminTaskDraft => Boolean(task));
};

const collectAssessmentAppealTasks = async (strapi: StrapiDocumentService) => {
  const appeals = await documents(strapi, 'api::assessment-appeal.assessment-appeal').findMany({
    filters: {
      appealState: {
        $in: ['submitted', 'under_review'],
      },
    },
    limit: 100,
    populate: ['candidate', 'courseTestAttempt', 'enrollment'],
    sort: ['submittedAt:desc', 'createdAt:desc'],
  });

  return appeals.map(assessmentAppealTask).filter((task): task is AdminTaskDraft => Boolean(task));
};

const collectNotificationTasks = async (strapi: StrapiDocumentService) => {
  const events = await documents(strapi, 'api::notification-event.notification-event').findMany({
    filters: {
      deliveryState: {
        $in: notificationFailureStates,
      },
    },
    limit: 100,
    sort: ['failedAt:desc', 'updatedAt:desc', 'createdAt:desc'],
  });

  return events
    .filter(isHighValueNotificationEvent)
    .map(notificationTask)
    .filter((task): task is AdminTaskDraft => Boolean(task));
};

const collectAuditTasks = async (strapi: StrapiDocumentService) => {
  const occurredAfter = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const events = await documents(strapi, 'api::audit-event.audit-event').findMany({
    filters: {
      occurredAt: {
        $gte: occurredAfter,
      },
      severity: {
        $in: ['error', 'critical'],
      },
    },
    limit: 50,
    sort: ['occurredAt:desc', 'createdAt:desc'],
  });

  return events.map(auditTask).filter((task): task is AdminTaskDraft => Boolean(task));
};

const collectSupportCaseTasks = async (strapi: StrapiDocumentService) => {
  const cases = await documents(strapi, 'api::support-case.support-case').findMany({
    filters: {
      caseState: {
        $in: ['open', 'awaiting_staff', 'in_progress'],
      },
      caseType: 'interview',
    },
    limit: 100,
    populate: ['candidate'],
    sort: ['lastMessageAt:desc', 'createdAt:desc'],
  });

  return cases
    .filter((supportCase) => objectValue(supportCase.metadata).kind === 'ai_feedback_report_concern')
    .map(supportCaseTask)
    .filter((task): task is AdminTaskDraft => Boolean(task));
};

const collectAiFeedbackFailureTasks = async (strapi: StrapiDocumentService) => {
  const feedbackRecords = await documents(strapi, 'api::interview-feedback.interview-feedback').findMany({
    filters: {
      candidateReportState: 'failed',
    },
    limit: 100,
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
  const interviews = await documents(strapi, 'api::interview.interview').findMany({
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
    limit: 100,
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
  const interviews = await documents(strapi, 'api::interview.interview').findMany({
    filters: {
      interviewState: 'completed',
    },
    limit: 100,
    populate: ['candidate', 'employer', 'employerContact'],
    sort: ['feedbackDueAt:asc', 'completedAt:asc', 'createdAt:asc'],
  });
  const interviewDocumentIds = interviews
    .map(getDocumentId)
    .filter((documentId): documentId is string => Boolean(documentId));
  const feedbackRecords = interviewDocumentIds.length
    ? await documents(strapi, 'api::interview-feedback.interview-feedback').findMany({
        filters: {
          interview: {
            documentId: {
              $in: interviewDocumentIds,
            },
          },
          submittedByType: 'employer_contact',
        },
        limit: 100,
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

const collectTaskDrafts = async (strapi: StrapiDocumentService) => {
  const [
    assessmentAppeals,
    interviewDetails,
    interviewFeedback,
    payments,
    reservations,
    enrollments,
    refunds,
    notifications,
    auditEvents,
    aiFeedbackFailures,
    supportCases,
  ] = await Promise.all([
    collectAssessmentAppealTasks(strapi),
    collectInterviewDetailTasks(strapi),
    collectInterviewFeedbackTasks(strapi),
    collectPaymentTasks(strapi),
    collectReservationTasks(strapi),
    collectEnrollmentTasks(strapi),
    collectRefundTasks(strapi),
    collectNotificationTasks(strapi),
    collectAuditTasks(strapi),
    collectAiFeedbackFailureTasks(strapi),
    collectSupportCaseTasks(strapi),
  ]);

  return [
    ...assessmentAppeals,
    ...interviewDetails,
    ...interviewFeedback,
    ...payments,
    ...reservations,
    ...enrollments,
    ...refunds,
    ...notifications,
    ...auditEvents,
    ...aiFeedbackFailures,
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

const compareTasks = (left: DocumentRecord, right: DocumentRecord) => {
  const priorityDifference =
    priorityRank[left.priority || 'normal'] - priorityRank[right.priority || 'normal'];

  if (priorityDifference !== 0) {
    return priorityDifference;
  }

  return (
    new Date(right.lastDetectedAt || right.createdAt || 0).getTime() -
    new Date(left.lastDetectedAt || left.createdAt || 0).getTime()
  );
};

const taskCounts = (tasks: ReturnType<typeof publicTask>[]) => {
  const totalActiveTasks = tasks.length;

  return {
    assessmentAppeals: tasks.filter((task) => task.taskType === 'assessment_appeal').length,
    criticalEvents: tasks.filter((task) => task.taskType === 'system_alert').length,
    interviewOperations: tasks.filter((task) => task.taskType === 'interview_operation').length,
    notificationFailures: tasks.filter((task) => task.taskType === 'notification_failure').length,
    paymentChecks: tasks.filter((task) =>
      ['payment_review', 'refund_review'].includes(task.taskType)
    ).length,
    supportCases: tasks.filter((task) => task.taskType === 'support_case').length,
    totalActiveTasks,
    totalOpenTasks: totalActiveTasks,
  };
};

const syncTasks = async (strapi: StrapiDocumentService, session?: AdminSession) => {
  const detectedAt = new Date().toISOString();
  const drafts = await collectTaskDrafts(strapi);
  const activeTaskKeys = new Set(drafts.map((draft) => draft.taskKey));

  await Promise.all(drafts.map((draft) => upsertTask(strapi, draft, detectedAt)));
  await resolveStaleTasks(strapi, activeTaskKeys, detectedAt);

  const openTasks = await documents(strapi, 'api::admin-task.admin-task').findMany({
    filters: {
      taskState: {
        $in: activeTaskStates,
      },
      taskType: {
        $in: monitoredTaskTypes,
      },
    },
    limit: 200,
    sort: ['createdAt:desc'],
  });

  return openTasks
    .filter((task) => (session ? canViewTaskRecordForSession(task, session) : true))
    .sort(compareTasks)
    .slice(0, 20)
    .map(publicTask);
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

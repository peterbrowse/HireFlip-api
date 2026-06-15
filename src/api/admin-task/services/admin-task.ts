import { factories } from '@strapi/strapi';
import { errors, validateZodSchema, z } from '@strapi/utils';

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

type DocumentRecord = Record<string, unknown> & {
  actionLabel?: string;
  actionPath?: string;
  amountPence?: number;
  candidate?: DocumentRecord;
  class?: DocumentRecord;
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
  lastDetectedAt?: string;
  lastName?: string;
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
  severity?: string;
  sourceDocumentId?: string;
  sourceType?: AdminTaskSourceType;
  status?: AdminTaskStatus;
  subjectDisplayName?: string;
  subjectId?: string;
  subjectType?: string;
  summary?: string;
  taskKey?: string;
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
  | 'audit_event'
  | 'enrollment'
  | 'notification_event'
  | 'payment'
  | 'refund'
  | 'reservation';
type AdminTaskStatus = 'acknowledged' | 'dismissed' | 'open' | 'resolved';
type AdminTaskType = 'notification_failure' | 'payment_review' | 'refund_review' | 'system_alert';

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
    taskKey: z.string().trim().min(1).max(220),
  })
  .strict();

const validateOverview = validateZodSchema(overviewSchema);
const validateTaskAction = validateZodSchema(taskActionSchema);

const documents = (strapi: StrapiDocumentService, uid: string) =>
  strapi.documents(uid) as unknown as DocumentCollection;

const adminAuthService = (strapi: StrapiDocumentService) =>
  strapi.service('api::admin-auth.admin-auth') as unknown as AdminAuthService;

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
const taskDetailPath = (taskKey: string) => `/tasks/${taskRouteSegment(taskKey)}`;
const taskQuery = (taskKey: string) => encodeURIComponent(taskKey);
const refundTaskPath = (taskKey: string) => `/refunds?task=${taskQuery(taskKey)}`;

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
  record.failedAt || record.occurredAt || record.createdAt || new Date().toISOString();

const taskTypeLabels: Record<AdminTaskType, string> = {
  notification_failure: 'Notification failure',
  payment_review: 'Payment review',
  refund_review: 'Refund review',
  system_alert: 'System alert',
};

const priorityRank: Record<AdminTaskPriority, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

const monitoredTaskTypes: AdminTaskType[] = [
  'payment_review',
  'refund_review',
  'notification_failure',
  'system_alert',
];
const clearableTaskTypes = new Set<AdminTaskType>(['notification_failure', 'system_alert']);
const isClearableTask = (task?: Pick<DocumentRecord, 'taskType'> | null) =>
  Boolean(task?.taskType && clearableTaskTypes.has(task.taskType));

const objectValue = (value: unknown) => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
};

const assertOperationsSession = async (
  strapi: StrapiDocumentService,
  sessionToken: string,
  context: RequestContext
) => {
  const session = await adminAuthService(strapi).getSession({ sessionToken }, context);
  const canViewOperationalTasks = session.user.roleKeys.some((roleKey) =>
    ['admin', 'super_admin'].includes(roleKey)
  );

  if (!canViewOperationalTasks) {
    throw new ForbiddenError('Admin or Super Admin access is required.');
  }

  return session;
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
  lastDetectedAt: detectedAt,
  metadata: draft.metadata,
  priority: draft.priority,
  relatedDocumentId: draft.relatedDocumentId,
  relatedType: draft.relatedType,
  resolvedAt: null,
  sourceDocumentId: draft.sourceDocumentId,
  sourceType: draft.sourceType,
  status: 'open',
  summary: draft.summary,
  taskKey: draft.taskKey,
  taskType: draft.taskType,
  title: draft.title,
});

const upsertTask = async (
  strapi: StrapiDocumentService,
  draft: AdminTaskDraft,
  detectedAt: string
) => {
  const existingTask = await findExistingTask(strapi, draft.taskKey);

  if (existingTask?.status === 'dismissed' && isClearableTask(existingTask)) {
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
      status: 'open',
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
                status: 'resolved',
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
  const candidateName = candidateDisplayName(refund.candidate);

  return {
    actionLabel: 'Review refund',
    actionPath: refundTaskPath(taskKey),
    metadata: {
      amountPence: refund.amountPence,
      currency: refund.currency || 'GBP',
      refundState: refund.refundState,
      sourceCreatedAt: refund.createdAt,
    },
    priority: isFailed ? 'urgent' : 'high',
    relatedDocumentId: documentId,
    relatedType: 'refund',
    sourceDocumentId: documentId,
    sourceType: 'refund',
    summary: trimToLength(
      [
        amount ? `${amount} refund is ${isFailed ? 'failed' : 'requested'}.` : `Refund is ${isFailed ? 'failed' : 'requested'}.`,
        candidateName ? `Candidate: ${candidateName}.` : '',
      ].filter(Boolean).join(' '),
      500
    ),
    taskKey,
    taskType: 'refund_review',
    title: isFailed ? 'Refund failed' : 'Refund requested',
  };
};

const notificationTask = (event: DocumentRecord): AdminTaskDraft | null => {
  const documentId = getDocumentId(event);

  if (!documentId) {
    return null;
  }

  const taskKey = `notification:${documentId}:failed`;

  return {
    actionLabel: 'Review event',
    actionPath: taskDetailPath(taskKey),
    metadata: {
      channel: event.channel,
      eventType: event.eventType,
      priority: event.priority,
      relatedId: event.relatedId,
      relatedType: event.relatedType,
      sourceCreatedAt: event.createdAt,
      templateKey: event.templateKey,
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
        $in: ['requested', 'failed'],
      },
    },
    limit: 100,
    populate: ['candidate', 'enrollment', 'payment'],
    sort: ['createdAt:desc'],
  });

  return refunds.map(refundTask).filter((task): task is AdminTaskDraft => Boolean(task));
};

const collectNotificationTasks = async (strapi: StrapiDocumentService) => {
  const events = await documents(strapi, 'api::notification-event.notification-event').findMany({
    filters: {
      deliveryState: 'failed',
    },
    limit: 100,
    sort: ['failedAt:desc', 'createdAt:desc'],
  });

  return events.map(notificationTask).filter((task): task is AdminTaskDraft => Boolean(task));
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

const collectTaskDrafts = async (strapi: StrapiDocumentService) => {
  const [
    payments,
    reservations,
    enrollments,
    refunds,
    notifications,
    auditEvents,
  ] = await Promise.all([
    collectPaymentTasks(strapi),
    collectReservationTasks(strapi),
    collectEnrollmentTasks(strapi),
    collectRefundTasks(strapi),
    collectNotificationTasks(strapi),
    collectAuditTasks(strapi),
  ]);

  return [
    ...payments,
    ...reservations,
    ...enrollments,
    ...refunds,
    ...notifications,
    ...auditEvents,
  ];
};

const publicTask = (task: DocumentRecord) => ({
  actionLabel: task.actionLabel || 'Review task',
  actionPath: task.actionPath || '/',
  canClear: isClearableTask(task) && ['acknowledged', 'open'].includes(task.status || 'open'),
  createdAt: task.createdAt || null,
  documentId: getDocumentId(task) || '',
  lastDetectedAt: task.lastDetectedAt || null,
  priority: task.priority || 'normal',
  relatedDocumentId: task.relatedDocumentId || null,
  relatedType: task.relatedType || null,
  sourceDocumentId: task.sourceDocumentId || null,
  sourceType: task.sourceType || null,
  status: task.status || 'open',
  summary: task.summary || '',
  taskKey: task.taskKey || '',
  taskType: task.taskType || 'system_alert',
  taskTypeLabel: task.taskType ? taskTypeLabels[task.taskType] : 'Task',
  title: task.title || 'Task',
  updatedAt: task.updatedAt || null,
});

const publicTaskDetail = (task: DocumentRecord) => ({
  ...publicTask(task),
  metadata: objectValue(task.metadata),
});

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

const taskCounts = (tasks: ReturnType<typeof publicTask>[]) => ({
  criticalEvents: tasks.filter((task) => task.taskType === 'system_alert').length,
  notificationFailures: tasks.filter((task) => task.taskType === 'notification_failure').length,
  paymentChecks: tasks.filter((task) =>
    ['payment_review', 'refund_review'].includes(task.taskType)
  ).length,
  totalOpenTasks: tasks.length,
});

const syncTasks = async (strapi: StrapiDocumentService) => {
  const detectedAt = new Date().toISOString();
  const drafts = await collectTaskDrafts(strapi);
  const activeTaskKeys = new Set(drafts.map((draft) => draft.taskKey));

  await Promise.all(drafts.map((draft) => upsertTask(strapi, draft, detectedAt)));
  await resolveStaleTasks(strapi, activeTaskKeys, detectedAt);

  const openTasks = await documents(strapi, 'api::admin-task.admin-task').findMany({
    filters: {
      status: 'open',
      taskType: {
        $in: monitoredTaskTypes,
      },
    },
    limit: 200,
    sort: ['createdAt:desc'],
  });

  return openTasks.sort(compareTasks).slice(0, 20).map(publicTask);
};

export default factories.createCoreService('api::admin-task.admin-task', ({ strapi }) => ({
  async getOverview(input: unknown, requestContext: RequestContext = {}) {
    const body = validateOverview(input);
    const session = await assertOperationsSession(strapi, body.sessionToken, requestContext);
    const tasks = await syncTasks(strapi);

    return {
      counts: taskCounts(tasks),
      generatedAt: new Date().toISOString(),
      tasks,
      user: session.user,
    };
  },

  async getTaskDetail(input: unknown, requestContext: RequestContext = {}) {
    const body = validateTaskAction(input);

    await assertOperationsSession(strapi, body.sessionToken, requestContext);
    await syncTasks(strapi);

    const task = await findExistingTask(strapi, body.taskKey);

    if (!task) {
      throw new ValidationError('Admin task could not be found.');
    }

    return {
      task: publicTaskDetail(task),
    };
  },

  async clearTask(input: unknown, requestContext: RequestContext = {}) {
    const body = validateTaskAction(input);

    await assertOperationsSession(strapi, body.sessionToken, requestContext);

    const task = await findExistingTask(strapi, body.taskKey);

    if (!task?.documentId) {
      throw new ValidationError('Admin task could not be found.');
    }

    if (!isClearableTask(task)) {
      throw new ValidationError('This task type cannot be cleared from Timely Tasks.');
    }

    const clearedTask = await documents(strapi, 'api::admin-task.admin-task').update({
      documentId: task.documentId,
      data: {
        resolvedAt: new Date().toISOString(),
        status: 'dismissed',
      },
    });

    return {
      cleared: true,
      task: publicTaskDetail(clearedTask),
    };
  },
}));

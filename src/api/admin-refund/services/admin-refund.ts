import { errors, validateZodSchema, z } from '@strapi/utils';

const { ApplicationError, ForbiddenError, ValidationError } = errors;

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

type AuditEventService = {
  record(input: Record<string, unknown>): Promise<unknown>;
};

type NotificationServiceQueueResponse = {
  data?: {
    jobId?: unknown;
    queued?: unknown;
    type?: unknown;
  };
};

type PaymentServiceRefundResult = {
  amountPence: number;
  createdAt: string;
  currency: string;
  metadata: Record<string, unknown>;
  paymentProvider: string;
  providerPaymentIntentId: string | null;
  providerRefundId: string;
  providerRefundStatus?: string | null;
};

type PaymentServiceRefundResponse = {
  data?: Partial<PaymentServiceRefundResult>;
  error?: {
    message?: string;
  };
};

type SupportCaseService = {
  addMessage(input: unknown): Promise<DocumentRecord>;
  casesForRefund(refundDocumentId: string): Promise<unknown[]>;
  ensureRefundCase(input: unknown): Promise<{
    created: boolean;
    supportCase: DocumentRecord;
  }>;
  updateCaseState(input: unknown): Promise<DocumentRecord>;
};

type DocumentRecord = Record<string, unknown> & {
  amountPence?: number;
  approvedAt?: string;
  candidate?: DocumentRecord;
  candidateState?: string;
  class?: DocumentRecord;
  completedAt?: string;
  completionStatus?: string;
  createdAt?: string;
  currency?: string;
  displayTitle?: string;
  documentId?: string;
  email?: string;
  enrollment?: DocumentRecord;
  enrollmentState?: string;
  eventCategory?: string;
  eventType?: string;
  eligibilitySource?: string;
  firstName?: string;
  id?: number | string;
  interviewGuaranteeDeadline?: string;
  lastName?: string;
  metadata?: unknown;
  officialClassCode?: string;
  occurredAt?: string;
  paidAt?: string;
  passStatus?: string;
  processedAt?: string;
  payment?: DocumentRecord;
  paymentProvider?: string;
  paymentState?: string;
  paymentStatus?: string;
  phone?: string;
  providerCheckoutSessionId?: string;
  providerPaymentIntentId?: string;
  providerRefundId?: string;
  qualifyingInterviewsDeliveredCount?: number;
  reason?: string;
  refund?: DocumentRecord;
  refundEligibilityState?: string;
  refundPercentage?: number | string;
  refundState?: string;
  requestedAt?: string;
  reservation?: DocumentRecord;
  reservationState?: string;
  severity?: string;
  sourceDocumentId?: string;
  sourceType?: string;
  state?: string;
  subjectDisplayName?: string;
  subjectId?: string;
  subjectType?: string;
  summary?: string;
  taskKey?: string;
  taskType?: string;
  termsAcceptedAt?: string;
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

const reviewListSchema = z
  .object({
    sessionToken: z.string().trim().min(32).max(512),
  })
  .strict();

const reviewDetailSchema = reviewListSchema
  .extend({
    taskKey: z.string().trim().min(1).max(220),
  })
  .strict();
const reviewRefuseSchema = reviewDetailSchema
  .extend({
    message: z.string().trim().min(10).max(4000),
  })
  .strict();
const reviewEscalateSchema = reviewDetailSchema
  .extend({
    message: z.string().trim().max(4000).optional(),
    refundPercentage: z.enum(['25', '50']).transform((value) => Number(value)),
  })
  .strict();

const validateReviewList = validateZodSchema(reviewListSchema);
const validateReviewDetail = validateZodSchema(reviewDetailSchema);
const validateReviewRefuse = validateZodSchema(reviewRefuseSchema);
const validateReviewEscalate = validateZodSchema(reviewEscalateSchema);

const documents = (strapi: StrapiDocumentService, uid: string) =>
  strapi.documents(uid) as unknown as DocumentCollection;

const adminAuthService = (strapi: StrapiDocumentService) =>
  strapi.service('api::admin-auth.admin-auth') as unknown as AdminAuthService;

const auditEvents = (strapi: StrapiDocumentService) =>
  strapi.service('api::audit-event.audit-event') as unknown as AuditEventService;

const supportCaseService = (strapi: StrapiDocumentService) =>
  strapi.service('api::support-case.support-case') as unknown as SupportCaseService;

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

const getIntegerEnv = (name: string, fallback: number) => {
  const parsedValue = Number.parseInt(process.env[name] || '', 10);

  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : fallback;
};

const htmlEscape = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

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

const objectValue = (value: unknown) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const candidateDisplayName = (candidate?: DocumentRecord | null) => {
  if (!candidate) {
    return undefined;
  }

  const firstName = typeof candidate.firstName === 'string' ? candidate.firstName.trim() : '';
  const lastName = typeof candidate.lastName === 'string' ? candidate.lastName.trim() : '';
  const fullName = `${firstName} ${lastName}`.trim();

  return fullName || (typeof candidate.email === 'string' ? candidate.email : undefined);
};

const taskRouteSegment = (taskKey: string) => encodeURIComponent(taskKey);
const refundTaskPath = (taskKey: string) => `/refunds/${taskRouteSegment(taskKey)}`;

const formatMoney = (amountPence?: number, currency = 'GBP') => {
  if (typeof amountPence !== 'number') {
    return undefined;
  }

  return new Intl.NumberFormat('en-GB', {
    currency,
    style: 'currency',
  }).format(amountPence / 100);
};

const requestNotificationServiceEmail = async ({
  correlationId,
  html,
  subject,
  text,
  to,
  type,
}: {
  correlationId?: string;
  html: string;
  subject: string;
  text: string;
  to: string;
  type: string;
}): Promise<NotificationServiceQueueResponse> => {
  const baseUrl = process.env.NOTIFICATION_SERVICE_URL;
  const serviceToken = process.env.NOTIFICATION_SERVICE_TOKEN;

  if (!baseUrl || !serviceToken) {
    throw new ApplicationError('Notification service is not configured.');
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
        html,
        priority: 'critical',
        source: 'core-api',
        subject,
        text,
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
      throw new ApplicationError('Candidate refund notification could not be queued.');
    }

    return payload;
  } finally {
    clearTimeout(timeout);
  }
};

const requestPaymentServiceRefund = async ({
  amountPence,
  currency,
  metadata,
  paymentDocumentId,
  providerPaymentIntentId,
  refundDocumentId,
  requestedByAdminEmail,
  requestedByAdminId,
  reason,
}: {
  amountPence: number;
  currency: string;
  metadata: Record<string, string>;
  paymentDocumentId: string;
  providerPaymentIntentId: string;
  refundDocumentId: string;
  requestedByAdminEmail: string;
  requestedByAdminId: string;
  reason: string;
}): Promise<PaymentServiceRefundResult> => {
  const baseUrl = process.env.PAYMENT_SERVICE_URL;
  const serviceToken = process.env.PAYMENT_SERVICE_TOKEN;

  if (!baseUrl || !serviceToken) {
    throw new ApplicationError('Payment service is not configured.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    getIntegerEnv('PAYMENT_SERVICE_TIMEOUT_MS', 5000)
  );

  try {
    const response = await fetch(`${trimTrailingSlash(baseUrl)}/internal/refunds`, {
      body: JSON.stringify({
        amountPence,
        currency,
        metadata,
        paymentDocumentId,
        providerPaymentIntentId,
        refundDocumentId,
        requestedByAdminEmail,
        requestedByAdminId,
        reason,
      }),
      headers: {
        'content-type': 'application/json',
        'x-hireflip-service-name': 'core-api',
        'x-hireflip-service-token': serviceToken,
      },
      method: 'POST',
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => null)) as PaymentServiceRefundResponse | null;

    if (
      !response.ok ||
      typeof payload?.data?.providerRefundId !== 'string' ||
      typeof payload.data.amountPence !== 'number' ||
      typeof payload.data.currency !== 'string'
    ) {
      throw new ApplicationError(
        payload?.error?.message || 'Payment service refund request failed.'
      );
    }

    return {
      amountPence: payload.data.amountPence,
      createdAt:
        typeof payload.data.createdAt === 'string' ? payload.data.createdAt : new Date().toISOString(),
      currency: payload.data.currency,
      metadata:
        payload.data.metadata && typeof payload.data.metadata === 'object'
          ? payload.data.metadata
          : {},
      paymentProvider:
        typeof payload.data.paymentProvider === 'string' ? payload.data.paymentProvider : 'stripe',
      providerPaymentIntentId:
        typeof payload.data.providerPaymentIntentId === 'string'
          ? payload.data.providerPaymentIntentId
          : null,
      providerRefundId: payload.data.providerRefundId,
      providerRefundStatus:
        typeof payload.data.providerRefundStatus === 'string'
          ? payload.data.providerRefundStatus
          : null,
    };
  } finally {
    clearTimeout(timeout);
  }
};

const sourceTimestamp = (record: DocumentRecord) =>
  record.requestedAt || record.paidAt || record.createdAt || new Date().toISOString();

const assertRefundReviewSession = async (
  strapi: StrapiDocumentService,
  sessionToken: string,
  context: RequestContext
) => {
  const session = await adminAuthService(strapi).getSession({ sessionToken }, context);
  const canReviewRefunds = session.user.roleKeys.some((roleKey) =>
    ['admin', 'super_admin'].includes(roleKey)
  );

  if (!canReviewRefunds) {
    throw new ForbiddenError('Admin or Super Admin access is required.');
  }

  return session;
};

const assertSuperAdminSession = async (
  strapi: StrapiDocumentService,
  sessionToken: string,
  context: RequestContext
) => {
  const session = await assertRefundReviewSession(strapi, sessionToken, context);

  if (!session.user.roleKeys.includes('super_admin')) {
    throw new ForbiddenError('Super Admin access is required.');
  }

  return session;
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

const paymentForRelation = async (
  strapi: StrapiDocumentService,
  relationName: 'enrollment' | 'reservation',
  documentId?: string
) => {
  if (!documentId) {
    return undefined;
  }

  const payments = await documents(strapi, 'api::payment.payment').findMany({
    filters: {
      [relationName]: {
        documentId,
      },
      paymentState: {
        $in: ['paid', 'requires_review', 'partially_refunded', 'refunded'],
      },
    },
    limit: 1,
    populate: ['candidate', 'enrollment', 'reservation'],
    sort: ['paidAt:desc', 'createdAt:desc'],
  });

  return payments[0];
};

const relationContext = async (strapi: StrapiDocumentService, source: DocumentRecord) => {
  const enrollmentDocumentId = getDocumentId(source.enrollment);
  const reservationDocumentId = getDocumentId(source.reservation);

  const [enrollment, reservation] = await Promise.all([
    byDocumentId(strapi, 'api::enrollment.enrollment', enrollmentDocumentId, ['candidate', 'class']),
    byDocumentId(strapi, 'api::reservation.reservation', reservationDocumentId, [
      'candidate',
      'class',
      'enrollment',
    ]),
  ]);

  return {
    enrollment: enrollment || source.enrollment,
    reservation: reservation || source.reservation,
  };
};

const refundOptions = (originalAmountPence?: number, currency = 'GBP') => {
  if (typeof originalAmountPence !== 'number') {
    return [];
  }

  return [25, 50].map((percentage) => {
    const amountPence = Math.round((originalAmountPence * percentage) / 100);

    return {
      amountPence,
      currency,
      formattedAmount: formatMoney(amountPence, currency),
      percentage,
    };
  });
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
        officialClassCode: classRecord.officialClassCode || null,
        state: classRecord.state || null,
      }
    : null;

const publicEnrollment = (enrollment?: DocumentRecord | null) =>
  enrollment
    ? {
        completedAt: enrollment.completedAt || null,
        completionStatus: enrollment.completionStatus || null,
        documentId: getDocumentId(enrollment) || null,
        enrollmentState: enrollment.enrollmentState || null,
        interviewGuaranteeDeadline: enrollment.interviewGuaranteeDeadline || null,
        passStatus: enrollment.passStatus || null,
        paymentStatus: enrollment.paymentStatus || null,
        qualifyingInterviewsDeliveredCount:
          typeof enrollment.qualifyingInterviewsDeliveredCount === 'number'
            ? enrollment.qualifyingInterviewsDeliveredCount
            : null,
        refundEligibilityState: enrollment.refundEligibilityState || null,
      }
    : null;

const publicReservation = (reservation?: DocumentRecord | null) =>
  reservation
    ? {
        amountPence: reservation.amountPence ?? null,
        currency: reservation.currency || null,
        documentId: getDocumentId(reservation) || null,
        paidAt: reservation.paidAt || null,
        reservationState: reservation.reservationState || null,
        termsAcceptedAt: reservation.termsAcceptedAt || null,
      }
    : null;

const publicPayment = (payment?: DocumentRecord | null) =>
  payment
    ? {
        amountPence: payment.amountPence ?? null,
        currency: payment.currency || null,
        documentId: getDocumentId(payment) || null,
        formattedAmount: formatMoney(payment.amountPence, payment.currency || 'GBP') || null,
        paidAt: payment.paidAt || null,
        paymentProvider: payment.paymentProvider || null,
        paymentState: payment.paymentState || null,
        providerCheckoutSessionId: payment.providerCheckoutSessionId || null,
        providerPaymentIntentId: payment.providerPaymentIntentId || null,
      }
    : null;

const publicRefund = (refund?: DocumentRecord | null) =>
  refund
    ? {
        amountPence: refund.amountPence ?? null,
        approvedAt: refund.approvedAt || null,
        currency: refund.currency || null,
        documentId: getDocumentId(refund) || null,
        eligibilitySource: refund.eligibilitySource || null,
        formattedAmount: formatMoney(refund.amountPence, refund.currency || 'GBP') || null,
        processedAt: refund.processedAt || null,
        providerRefundId: refund.providerRefundId || null,
        reason: refund.reason || null,
        refundPercentage: refund.refundPercentage ?? null,
        refundState: refund.refundState || null,
        requestedAt: refund.requestedAt || null,
      }
    : null;

const reviewSummary = ({
  candidate,
  payment,
  refund,
  type,
}: {
  candidate?: DocumentRecord | null;
  payment?: DocumentRecord | null;
  refund?: DocumentRecord | null;
  type: 'payment_exception' | 'refund_request';
}) => {
  const candidateName = candidateDisplayName(candidate) || 'Candidate';
  const amount = formatMoney(
    refund?.amountPence ?? payment?.amountPence,
    refund?.currency || payment?.currency || 'GBP'
  );

  if (type === 'refund_request') {
    return amount
      ? `${candidateName} has a ${amount} refund request needing review.`
      : `${candidateName} has a refund request needing review.`;
  }

  return amount
    ? `${candidateName} has a ${amount} payment exception needing review.`
    : `${candidateName} has a payment exception needing review.`;
};

const buildReviewItem = async ({
  payment,
  refund,
  reservation,
  enrollment,
  source,
  taskKey,
  type,
}: {
  payment?: DocumentRecord;
  refund?: DocumentRecord;
  reservation?: DocumentRecord;
  enrollment?: DocumentRecord;
  source: DocumentRecord;
  taskKey: string;
  type: 'payment_exception' | 'refund_request';
}) => {
  const candidate = source.candidate || refund?.candidate || payment?.candidate || enrollment?.candidate || reservation?.candidate;
  const classRecord = enrollment?.class || reservation?.class;
  const originalPayment = payment || refund?.payment;
  const originalAmountPence =
    originalPayment?.amountPence ?? refund?.amountPence ?? reservation?.amountPence;
  const currency = originalPayment?.currency || refund?.currency || reservation?.currency || 'GBP';
  const title = type === 'refund_request' ? 'Refund request review' : 'Payment exception review';
  const refundState = String(refund?.refundState || '');

  return {
    actionPath: refundTaskPath(taskKey),
    actions: {
      canExecuteRefund: type === 'refund_request' && ['approved', 'failed'].includes(refundState),
      canEscalate: type === 'refund_request' && ['requested', 'failed'].includes(refundState),
      canRefuse: type === 'refund_request' && ['requested', 'failed'].includes(refundState),
    },
    candidate: publicCandidate(candidate),
    class: publicClass(classRecord),
    createdAt: source.createdAt || null,
    enrollment: publicEnrollment(enrollment),
    originalAmountPence: originalAmountPence ?? null,
    originalFormattedAmount: formatMoney(originalAmountPence, currency) || null,
    payment: publicPayment(originalPayment),
    priority: refund?.refundState === 'failed' || payment?.paymentState === 'requires_review' ? 'high' : 'normal',
    refund: publicRefund(refund),
    refundOptions: refundOptions(originalAmountPence, currency),
    reservation: publicReservation(reservation),
    reviewType: type,
    reviewTypeLabel: type === 'refund_request' ? 'Refund request' : 'Payment exception',
    sourceDocumentId: getDocumentId(source) || '',
    sourceType: refund ? 'refund' : payment ? 'payment' : reservation ? 'reservation' : 'enrollment',
    summary: reviewSummary({ candidate, payment: originalPayment, refund, type }),
    taskKey,
    title:
      type === 'refund_request' && refundState === 'approved'
        ? 'Approved refund review'
        : title,
    updatedAt: source.updatedAt || null,
  };
};

type RefundReviewItem = Awaited<ReturnType<typeof buildReviewItem>>;

const paymentReviewItem = async (strapi: StrapiDocumentService, payment: DocumentRecord) => {
  const documentId = getDocumentId(payment);
  const { enrollment, reservation } = await relationContext(strapi, payment);

  return buildReviewItem({
    enrollment,
    payment,
    reservation,
    source: payment,
    taskKey: `payment:${documentId}:requires_review`,
    type: 'payment_exception',
  });
};

const reservationReviewItem = async (strapi: StrapiDocumentService, reservation: DocumentRecord) => {
  const documentId = getDocumentId(reservation);
  const enrollment = reservation.enrollment
    ? await byDocumentId(strapi, 'api::enrollment.enrollment', getDocumentId(reservation.enrollment), [
        'candidate',
        'class',
      ])
    : undefined;
  const payment = await paymentForRelation(strapi, 'reservation', documentId);

  return buildReviewItem({
    enrollment: enrollment || reservation.enrollment,
    payment,
    reservation,
    source: reservation,
    taskKey: `reservation:${documentId}:payment_exception`,
    type: 'payment_exception',
  });
};

const enrollmentReviewItem = async (strapi: StrapiDocumentService, enrollment: DocumentRecord) => {
  const documentId = getDocumentId(enrollment);
  const payment = await paymentForRelation(strapi, 'enrollment', documentId);

  return buildReviewItem({
    enrollment,
    payment,
    source: enrollment,
    taskKey: `enrollment:${documentId}:payment_exception`,
    type: 'payment_exception',
  });
};

const refundReviewItem = async (strapi: StrapiDocumentService, refund: DocumentRecord) => {
  const documentId = getDocumentId(refund);
  const payment = refund.payment
    ? await byDocumentId(strapi, 'api::payment.payment', getDocumentId(refund.payment), [
        'candidate',
        'enrollment',
        'reservation',
      ])
    : undefined;
  const enrollment = refund.enrollment
    ? await byDocumentId(strapi, 'api::enrollment.enrollment', getDocumentId(refund.enrollment), [
        'candidate',
        'class',
      ])
    : payment?.enrollment
      ? await byDocumentId(strapi, 'api::enrollment.enrollment', getDocumentId(payment.enrollment), [
          'candidate',
          'class',
        ])
      : undefined;
  const reservation = payment?.reservation
    ? await byDocumentId(strapi, 'api::reservation.reservation', getDocumentId(payment.reservation), [
        'candidate',
        'class',
        'enrollment',
      ])
    : undefined;

  return buildReviewItem({
    enrollment,
    payment: payment || refund.payment,
    refund,
    reservation,
    source: refund,
    taskKey: `refund:${documentId}:${refund.refundState || 'review'}`,
    type: 'refund_request',
  });
};

const collectReviews = async (strapi: StrapiDocumentService) => {
  const [payments, reservations, enrollments, refunds] = await Promise.all([
    documents(strapi, 'api::payment.payment').findMany({
      filters: {
        paymentState: 'requires_review',
      },
      limit: 100,
      populate: ['candidate', 'enrollment', 'reservation'],
      sort: ['createdAt:desc'],
    }),
    documents(strapi, 'api::reservation.reservation').findMany({
      filters: {
        reservationState: 'payment_exception',
      },
      limit: 100,
      populate: ['candidate', 'class', 'enrollment'],
      sort: ['createdAt:desc'],
    }),
    documents(strapi, 'api::enrollment.enrollment').findMany({
      filters: {
        $or: [{ enrollmentState: 'payment_exception' }, { paymentStatus: 'requires_review' }],
      },
      limit: 100,
      populate: ['candidate', 'class'],
      sort: ['createdAt:desc'],
    }),
    documents(strapi, 'api::refund.refund').findMany({
      filters: {
        refundState: {
          $in: ['requested', 'approved', 'failed'],
        },
      },
      limit: 100,
      populate: ['candidate', 'enrollment', 'payment'],
      sort: ['requestedAt:desc', 'createdAt:desc'],
    }),
  ]);

  const reviews = await Promise.all([
    ...payments.map((payment) => paymentReviewItem(strapi, payment)),
    ...reservations.map((reservation) => reservationReviewItem(strapi, reservation)),
    ...enrollments.map((enrollment) => enrollmentReviewItem(strapi, enrollment)),
    ...refunds.map((refund) => refundReviewItem(strapi, refund)),
  ]);

  const byTaskKey = new Map<string, RefundReviewItem>();

  reviews.forEach((review) => {
    if (!byTaskKey.has(review.taskKey)) {
      byTaskKey.set(review.taskKey, review);
    }
  });

  return Array.from(byTaskKey.values()).sort(
    (left, right) =>
      new Date(right.updatedAt || right.createdAt || 0).getTime() -
      new Date(left.updatedAt || left.createdAt || 0).getTime()
  );
};

const auditEventsForReview = async (strapi: StrapiDocumentService, review: RefundReviewItem) => {
  const subjectIds = [
    review.candidate?.documentId,
    review.class?.documentId,
    review.enrollment?.documentId,
    review.payment?.documentId,
    review.refund?.documentId,
    review.reservation?.documentId,
    review.sourceDocumentId,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0);

  if (subjectIds.length === 0) {
    return [];
  }

  const events = await documents(strapi, 'api::audit-event.audit-event').findMany({
    filters: {
      subjectId: {
        $in: subjectIds,
      },
    },
    limit: 12,
    sort: ['occurredAt:desc', 'createdAt:desc'],
  });

  return events.map((event) => ({
    eventCategory: event.eventCategory || null,
    eventType: event.eventType || 'audit.event',
    occurredAt: event.occurredAt || event.createdAt || null,
    severity: event.severity || 'info',
    subjectDisplayName: event.subjectDisplayName || null,
    subjectId: event.subjectId || null,
    subjectType: event.subjectType || null,
  }));
};

const supportCasesForReview = async (strapi: StrapiDocumentService, review: RefundReviewItem) => {
  const refundDocumentId = review.refund?.documentId;

  if (!refundDocumentId) {
    return [];
  }

  return supportCaseService(strapi).casesForRefund(refundDocumentId);
};

const reviewByTaskKey = async (strapi: StrapiDocumentService, taskKey: string) => {
  const reviews = await collectReviews(strapi);
  const review = reviews.find((candidateReview) => candidateReview.taskKey === taskKey);

  if (!review) {
    throw new ValidationError('Refund review could not be found.');
  }

  return review;
};

const refundActionContext = async (strapi: StrapiDocumentService, taskKey: string) => {
  const review = await reviewByTaskKey(strapi, taskKey);
  const refundDocumentId = review.refund?.documentId;

  if (!refundDocumentId) {
    throw new ValidationError('This review is not linked to a refund request.');
  }

  const refund = await byDocumentId(strapi, 'api::refund.refund', refundDocumentId, [
    'candidate',
    'enrollment',
    'payment',
  ]);

  if (!refund) {
    throw new ValidationError('Refund request could not be found.');
  }

  const payment = refund.payment?.documentId
    ? await byDocumentId(strapi, 'api::payment.payment', getDocumentId(refund.payment), [
        'candidate',
        'enrollment',
        'reservation',
      ])
    : undefined;
  const candidate = refund.candidate || payment?.candidate || refund.enrollment?.candidate;

  if (!candidate?.email || typeof candidate.email !== 'string') {
    throw new ValidationError('Refund request is not linked to a candidate email address.');
  }

  return {
    candidate,
    payment: payment || refund.payment,
    refund,
    review,
  };
};

const refundSnapshot = (refund?: DocumentRecord | null) =>
  refund
    ? {
        amountPence: refund.amountPence ?? null,
        approvedAt: refund.approvedAt || null,
        documentId: getDocumentId(refund) || null,
        processedAt: refund.processedAt || null,
        providerRefundId: refund.providerRefundId || null,
        reason: refund.reason || null,
        refundPercentage: refund.refundPercentage ?? null,
        refundState: refund.refundState || null,
      }
    : null;

const paymentSnapshot = (payment?: DocumentRecord | null) =>
  payment
    ? {
        amountPence: payment.amountPence ?? null,
        documentId: getDocumentId(payment) || null,
        paymentState: payment.paymentState || null,
        providerPaymentIntentId: payment.providerPaymentIntentId || null,
      }
    : null;

const candidateFirstName = (candidate: DocumentRecord) =>
  typeof candidate.firstName === 'string' && candidate.firstName.trim()
    ? candidate.firstName.trim()
    : 'there';

const buildRefundRefusedEmail = ({
  candidate,
  message,
}: {
  candidate: DocumentRecord;
  message: string;
}) => {
  const name = candidateFirstName(candidate);

  return {
    html: [
      `<p>Hi ${htmlEscape(name)},</p>`,
      '<p>We have reviewed your refund request and cannot approve it on the information currently available.</p>',
      `<p>${htmlEscape(message)}</p>`,
      '<p>You can reply with any extra information you want the team to review.</p>',
      '<p>HireFlip</p>',
    ].join(''),
    subject: 'Your HireFlip refund request',
    text: [
      `Hi ${name},`,
      '',
      'We have reviewed your refund request and cannot approve it on the information currently available.',
      '',
      message,
      '',
      'You can reply with any extra information you want the team to review.',
      '',
      'HireFlip',
    ].join('\n'),
  };
};

const buildRefundAcceptedEmail = ({
  amount,
  candidate,
  message,
}: {
  amount?: string;
  candidate: DocumentRecord;
  message?: string;
}) => {
  const name = candidateFirstName(candidate);
  const amountText = amount ? ` for ${amount}` : '';
  const trimmedMessage = message?.trim();

  return {
    html: [
      `<p>Hi ${htmlEscape(name)},</p>`,
      `<p>Your refund request has been accepted${htmlEscape(amountText)} and is being processed.</p>`,
      trimmedMessage ? `<p>${htmlEscape(trimmedMessage)}</p>` : '',
      '<p>We will update you when the refund has been submitted to the payment provider.</p>',
      '<p>HireFlip</p>',
    ].filter(Boolean).join(''),
    subject: 'Your HireFlip refund has been accepted',
    text: [
      `Hi ${name},`,
      '',
      `Your refund request has been accepted${amountText} and is being processed.`,
      ...(trimmedMessage ? ['', trimmedMessage] : []),
      '',
      'We will update you when the refund has been submitted to the payment provider.',
      '',
      'HireFlip',
    ].join('\n'),
  };
};

const auditRefundAction = async ({
  eventType,
  metadata,
  newRefund,
  previousRefund,
  requestContext,
  session,
  strapi,
  subjectDisplayName,
  subjectId,
}: {
  eventType: string;
  metadata?: Record<string, unknown>;
  newRefund?: DocumentRecord | null;
  previousRefund?: DocumentRecord | null;
  requestContext: RequestContext;
  session: AdminSession;
  strapi: StrapiDocumentService;
  subjectDisplayName?: string;
  subjectId?: string;
}) =>
  auditEvents(strapi).record({
    actorDisplayName: session.user.displayName,
    actorEmail: session.user.email,
    actorId: session.user.id,
    actorType: 'admin',
    eventCategory: 'refund',
    eventType,
    ipAddress: requestContext.ipAddress,
    metadata,
    newState: {
      refund: refundSnapshot(newRefund),
    },
    previousState: {
      refund: refundSnapshot(previousRefund),
    },
    requestId: requestContext.requestId,
    source: 'admin_dashboard',
    subjectDisplayName,
    subjectId,
    subjectType: 'refund',
    userAgent: requestContext.userAgent,
  });

const providerRefundState = (status?: string | null) => {
  if (status === 'succeeded') {
    return 'completed';
  }

  if (status === 'failed' || status === 'canceled') {
    return 'failed';
  }

  return 'processing';
};

const adminSender = (session: AdminSession) => ({
  displayName: session.user.displayName,
  email: session.user.email,
  id: session.user.id,
  type: 'admin',
});

const ensureRefundSupportCase = async ({
  candidate,
  payment,
  refund,
  session,
  state,
  strapi,
  summary,
}: {
  candidate: DocumentRecord;
  payment?: DocumentRecord;
  refund: DocumentRecord;
  session: AdminSession;
  state: 'awaiting_candidate' | 'awaiting_staff' | 'in_progress' | 'resolved';
  strapi: StrapiDocumentService;
  summary?: string;
}) =>
  supportCaseService(strapi).ensureRefundCase({
    assignedTo: {
      displayName: session.user.displayName,
      email: session.user.email,
      id: session.user.id,
      roleKey: session.user.roleKeys[0],
    },
    candidate,
    createdBy: adminSender(session),
    enrollment: refund.enrollment || payment?.enrollment,
    payment,
    priority: state === 'awaiting_candidate' ? 'high' : 'normal',
    refund,
    source: 'admin_dashboard',
    state,
    summary,
  });

const updateRefundSupportCaseState = async ({
  caseState,
  supportCase,
  strapi,
}: {
  caseState: 'awaiting_candidate' | 'awaiting_staff' | 'in_progress' | 'resolved';
  supportCase: DocumentRecord;
  strapi: StrapiDocumentService;
}) =>
  supportCaseService(strapi).updateCaseState({
    caseState,
    supportCase,
  });

const addRefundSupportMessage = async ({
  body,
  candidate,
  deliveryState = 'not_required',
  direction,
  messageType,
  metadata,
  payment,
  refund,
  sender,
  sentAt,
  strapi,
  subject,
  supportCase,
  visibility = 'public',
}: {
  body: string;
  candidate: DocumentRecord;
  deliveryState?: 'not_required' | 'queued' | 'sent' | 'delivered' | 'failed';
  direction: 'outbound' | 'system' | 'internal';
  messageType: 'refund_acceptance' | 'refund_provider_update' | 'refund_refusal' | 'system_update';
  metadata?: Record<string, unknown>;
  payment?: DocumentRecord;
  refund: DocumentRecord;
  sender?: Record<string, unknown>;
  sentAt?: string;
  strapi: StrapiDocumentService;
  subject?: string;
  supportCase: DocumentRecord;
  visibility?: 'public' | 'internal';
}) =>
  supportCaseService(strapi).addMessage({
    body,
    candidate,
    deliveryState,
    direction,
    messageType,
    metadata,
    payment,
    refund,
    sender: sender || { type: 'system' },
    sentAt,
    subject,
    supportCase,
    visibility,
  });

const updatePaymentAfterProviderRefund = async ({
  payment,
  refund,
  strapi,
}: {
  payment?: DocumentRecord;
  refund: DocumentRecord;
  strapi: StrapiDocumentService;
}) => {
  if (!payment?.documentId || refund.refundState !== 'completed') {
    return undefined;
  }

  const paymentAmount = typeof payment.amountPence === 'number' ? payment.amountPence : undefined;
  const refundAmount = typeof refund.amountPence === 'number' ? refund.amountPence : undefined;
  const paymentState =
    typeof paymentAmount === 'number' && typeof refundAmount === 'number' && refundAmount >= paymentAmount
      ? 'refunded'
      : 'partially_refunded';

  const updatedPayment = await documents(strapi, 'api::payment.payment').update({
    documentId: payment.documentId,
    data: {
      metadata: {
        ...(objectValue(payment.metadata)),
        lastRefundDocumentId: refund.documentId,
        lastRefundProcessedAt: refund.processedAt,
        lastRefundProviderRefundId: refund.providerRefundId,
      },
      paymentState,
    },
  });

  if (payment.enrollment?.documentId) {
    await documents(strapi, 'api::enrollment.enrollment').update({
      documentId: payment.enrollment.documentId,
      data: {
        metadata: {
          ...(objectValue(payment.enrollment.metadata)),
          lastRefundDocumentId: refund.documentId,
          lastRefundProcessedAt: refund.processedAt,
        },
        paymentStatus: paymentState,
      },
    });
  }

  return updatedPayment;
};

export default ({ strapi }: { strapi: StrapiDocumentService }) => ({
  async listReviews(input: unknown, requestContext: RequestContext = {}) {
    const body = validateReviewList(input);
    const session = await assertRefundReviewSession(strapi, body.sessionToken, requestContext);
    const reviews = await collectReviews(strapi);

    return {
      counts: {
        paymentExceptions: reviews.filter((review) => review.reviewType === 'payment_exception')
          .length,
        refundRequests: reviews.filter((review) => review.reviewType === 'refund_request').length,
        total: reviews.length,
      },
      generatedAt: new Date().toISOString(),
      reviews,
      user: session.user,
    };
  },

  async getReviewDetail(input: unknown, requestContext: RequestContext = {}) {
    const body = validateReviewDetail(input);

    await assertRefundReviewSession(strapi, body.sessionToken, requestContext);

    const review = await reviewByTaskKey(strapi, body.taskKey);

    return {
      generatedAt: new Date().toISOString(),
      review: {
        ...review,
        auditEvents: await auditEventsForReview(strapi, review),
        supportCases: await supportCasesForReview(strapi, review),
      },
    };
  },

  async refuseReview(input: unknown, requestContext: RequestContext = {}) {
    const body = validateReviewRefuse(input);
    const session = await assertRefundReviewSession(strapi, body.sessionToken, requestContext);
    const { candidate, payment, refund } = await refundActionContext(strapi, body.taskKey);
    const currentState = String(refund.refundState || '');

    if (!['requested', 'failed'].includes(currentState)) {
      throw new ValidationError('Only requested or failed refunds can be refused.');
    }

    const email = buildRefundRefusedEmail({
      candidate,
      message: body.message,
    });
    const queueResult = await requestNotificationServiceEmail({
      correlationId: refund.documentId,
      html: email.html,
      subject: email.subject,
      text: email.text,
      to: candidate.email,
      type: 'candidate_refund_refused',
    });
    const now = new Date().toISOString();
    const updatedRefund = await documents(strapi, 'api::refund.refund').update({
      documentId: refund.documentId,
      data: {
        metadata: {
          ...(objectValue(refund.metadata)),
          decisionedAt: now,
          decisionedByAdminEmail: session.user.email,
          decisionedByAdminId: session.user.id,
          notificationServiceJobId: queueResult.data?.jobId ?? null,
          refundDecision: 'refused',
        },
        reason: body.message,
        refundState: 'rejected',
      },
    });
    const { supportCase } = await ensureRefundSupportCase({
      candidate,
      payment,
      refund: updatedRefund,
      session,
      state: 'awaiting_candidate',
      strapi,
      summary: 'Refund refused; waiting for candidate response or further evidence.',
    });

    await updateRefundSupportCaseState({
      caseState: 'awaiting_candidate',
      strapi,
      supportCase,
    });
    await addRefundSupportMessage({
      body: body.message,
      candidate,
      deliveryState: 'queued',
      direction: 'outbound',
      messageType: 'refund_refusal',
      metadata: {
        notificationServiceJobId: queueResult.data?.jobId ?? null,
      },
      payment,
      refund: updatedRefund,
      sender: adminSender(session),
      sentAt: now,
      strapi,
      subject: email.subject,
      supportCase,
      visibility: 'public',
    });

    await auditRefundAction({
      eventType: 'admin.refund_refused',
      metadata: {
        candidateEmail: candidate.email,
        notificationServiceJobId: queueResult.data?.jobId ?? null,
      },
      newRefund: updatedRefund,
      previousRefund: refund,
      requestContext,
      session,
      strapi,
      subjectDisplayName: candidateDisplayName(candidate),
      subjectId: refund.documentId,
    });

    return {
      notificationQueued: true,
      refund: publicRefund(updatedRefund),
      refused: true,
    };
  },

  async escalateReview(input: unknown, requestContext: RequestContext = {}) {
    const body = validateReviewEscalate(input);
    const session = await assertRefundReviewSession(strapi, body.sessionToken, requestContext);
    const { candidate, payment, refund, review } = await refundActionContext(strapi, body.taskKey);
    const currentState = String(refund.refundState || '');

    if (!['requested', 'failed'].includes(currentState)) {
      throw new ValidationError('Only requested or failed refunds can be escalated.');
    }

    if (typeof review.originalAmountPence !== 'number') {
      throw new ValidationError('The original payment amount is required before a refund can be accepted.');
    }

    const amountPence = Math.round((review.originalAmountPence * body.refundPercentage) / 100);
    const currency = refund.currency || review.payment?.currency || 'GBP';
    const formattedAmount = formatMoney(amountPence, currency);
    const email = buildRefundAcceptedEmail({
      amount: formattedAmount,
      candidate,
      message: body.message,
    });
    const queueResult = await requestNotificationServiceEmail({
      correlationId: refund.documentId,
      html: email.html,
      subject: email.subject,
      text: email.text,
      to: candidate.email,
      type: 'candidate_refund_accepted',
    });
    const now = new Date().toISOString();
    const updatedRefund = await documents(strapi, 'api::refund.refund').update({
      documentId: refund.documentId,
      data: {
        amountPence,
        approvedAt: now,
        currency,
        metadata: {
          ...(objectValue(refund.metadata)),
          acceptedCandidateMessage: body.message || null,
          acceptedNotificationServiceJobId: queueResult.data?.jobId ?? null,
          approvedByAdminEmail: session.user.email,
          approvedByAdminId: session.user.id,
          originalAmountPence: review.originalAmountPence,
          refundDecision: 'accepted_pending_super_admin_execution',
        },
        refundPercentage: body.refundPercentage,
        refundState: 'approved',
      },
    });
    const { supportCase } = await ensureRefundSupportCase({
      candidate,
      payment,
      refund: updatedRefund,
      session,
      state: 'awaiting_staff',
      strapi,
      summary: 'Refund accepted and waiting for Super Admin provider execution.',
    });

    await updateRefundSupportCaseState({
      caseState: 'awaiting_staff',
      strapi,
      supportCase,
    });
    await addRefundSupportMessage({
      body:
        body.message ||
        `Refund accepted for ${formattedAmount || 'the approved amount'} and waiting for Super Admin execution.`,
      candidate,
      deliveryState: 'queued',
      direction: 'outbound',
      messageType: 'refund_acceptance',
      metadata: {
        amountPence,
        notificationServiceJobId: queueResult.data?.jobId ?? null,
        refundPercentage: body.refundPercentage,
      },
      payment,
      refund: updatedRefund,
      sender: adminSender(session),
      sentAt: now,
      strapi,
      subject: email.subject,
      supportCase,
      visibility: 'public',
    });

    await auditRefundAction({
      eventType: 'admin.refund_accepted_for_execution',
      metadata: {
        amountPence,
        candidateEmail: candidate.email,
        notificationServiceJobId: queueResult.data?.jobId ?? null,
        refundPercentage: body.refundPercentage,
      },
      newRefund: updatedRefund,
      previousRefund: refund,
      requestContext,
      session,
      strapi,
      subjectDisplayName: candidateDisplayName(candidate),
      subjectId: refund.documentId,
    });

    return {
      escalated: true,
      notificationQueued: true,
      refund: publicRefund(updatedRefund),
    };
  },

  async executeReviewRefund(input: unknown, requestContext: RequestContext = {}) {
    const body = validateReviewDetail(input);
    const session = await assertSuperAdminSession(strapi, body.sessionToken, requestContext);
    const { candidate, payment, refund } = await refundActionContext(strapi, body.taskKey);
    const currentState = String(refund.refundState || '');

    if (!['approved', 'failed'].includes(currentState)) {
      throw new ValidationError('Only approved or failed refunds can be submitted to the payment provider.');
    }

    if (!payment?.documentId || !payment.providerPaymentIntentId) {
      throw new ValidationError('The original provider PaymentIntent is required before a refund can be executed.');
    }

    if (typeof refund.amountPence !== 'number' || refund.amountPence <= 0) {
      throw new ValidationError('A positive refund amount is required before a refund can be executed.');
    }

    const now = new Date().toISOString();
    const submittedRefund = await documents(strapi, 'api::refund.refund').update({
      documentId: refund.documentId,
      data: {
        metadata: {
          ...(objectValue(refund.metadata)),
          submittedByAdminEmail: session.user.email,
          submittedByAdminId: session.user.id,
          submittedToProviderAt: now,
        },
        refundState: 'submitted_to_provider',
      },
    });
    const { supportCase } = await ensureRefundSupportCase({
      candidate,
      payment,
      refund: submittedRefund,
      session,
      state: 'in_progress',
      strapi,
      summary: 'Refund submitted to the payment provider.',
    });

    await updateRefundSupportCaseState({
      caseState: 'in_progress',
      strapi,
      supportCase,
    });
    await addRefundSupportMessage({
      body: 'Refund submitted to the payment provider.',
      candidate,
      direction: 'system',
      messageType: 'refund_provider_update',
      metadata: {
        refundState: 'submitted_to_provider',
      },
      payment,
      refund: submittedRefund,
      strapi,
      supportCase,
      visibility: 'public',
    });

    await auditRefundAction({
      eventType: 'admin.refund_submitted_to_provider',
      metadata: {
        amountPence: refund.amountPence,
        payment: paymentSnapshot(payment),
      },
      newRefund: submittedRefund,
      previousRefund: refund,
      requestContext,
      session,
      strapi,
      subjectDisplayName: candidateDisplayName(candidate),
      subjectId: refund.documentId,
    });

    let providerRefund: PaymentServiceRefundResult;

    try {
      providerRefund = await requestPaymentServiceRefund({
        amountPence: refund.amountPence,
        currency: refund.currency || payment.currency || 'GBP',
        metadata: {
          refundPercentage: String(refund.refundPercentage ?? ''),
          taskKey: body.taskKey,
        },
        paymentDocumentId: payment.documentId,
        providerPaymentIntentId: payment.providerPaymentIntentId,
        refundDocumentId: refund.documentId,
        requestedByAdminEmail: session.user.email,
        requestedByAdminId: session.user.id,
        reason: refund.reason || 'HireFlip admin-approved refund.',
      });
    } catch (error) {
      const failedRefund = await documents(strapi, 'api::refund.refund').update({
        documentId: refund.documentId,
        data: {
          metadata: {
            ...(objectValue(submittedRefund.metadata)),
            providerSubmissionFailedAt: new Date().toISOString(),
            providerSubmissionFailureMessage:
              error instanceof Error ? error.message : 'Payment provider refund request failed.',
          },
          refundState: 'failed',
        },
      });

      await auditRefundAction({
        eventType: 'admin.refund_provider_submission_failed',
        metadata: {
          errorMessage: error instanceof Error ? error.message : 'Payment provider refund request failed.',
        },
        newRefund: failedRefund,
        previousRefund: submittedRefund,
        requestContext,
        session,
        strapi,
        subjectDisplayName: candidateDisplayName(candidate),
        subjectId: refund.documentId,
      });

      await updateRefundSupportCaseState({
        caseState: 'awaiting_staff',
        strapi,
        supportCase,
      });
      await addRefundSupportMessage({
        body:
          error instanceof Error
            ? `Refund provider submission failed: ${error.message}`
            : 'Refund provider submission failed.',
        candidate,
        direction: 'system',
        messageType: 'refund_provider_update',
        metadata: {
          failedAt: new Date().toISOString(),
        },
        payment,
        refund: failedRefund,
        strapi,
        supportCase,
        visibility: 'internal',
      });

      throw error;
    }

    const finalRefundState = providerRefundState(providerRefund.providerRefundStatus);
    const processedAt = finalRefundState === 'completed' ? providerRefund.createdAt : undefined;
    const updatedRefund = await documents(strapi, 'api::refund.refund').update({
      documentId: refund.documentId,
      data: {
        metadata: {
          ...(objectValue(submittedRefund.metadata)),
          providerRefundStatus: providerRefund.providerRefundStatus || null,
          providerSubmittedAt: providerRefund.createdAt,
        },
        processedAt: processedAt || submittedRefund.processedAt || null,
        providerRefundId: providerRefund.providerRefundId,
        refundState: finalRefundState,
      },
    });
    const updatedPayment = await updatePaymentAfterProviderRefund({
      payment,
      refund: updatedRefund,
      strapi,
    });

    await auditRefundAction({
      eventType:
        finalRefundState === 'completed'
          ? 'admin.refund_completed'
          : finalRefundState === 'failed'
            ? 'admin.refund_failed'
            : 'admin.refund_processing',
      metadata: {
        payment: paymentSnapshot(updatedPayment || payment),
        providerRefund,
      },
      newRefund: updatedRefund,
      previousRefund: submittedRefund,
      requestContext,
      session,
      strapi,
      subjectDisplayName: candidateDisplayName(candidate),
      subjectId: refund.documentId,
    });

    await updateRefundSupportCaseState({
      caseState:
        finalRefundState === 'completed'
          ? 'resolved'
          : finalRefundState === 'failed'
            ? 'awaiting_staff'
            : 'in_progress',
      strapi,
      supportCase,
    });
    await addRefundSupportMessage({
      body:
        finalRefundState === 'completed'
          ? 'Refund completed by the payment provider.'
          : finalRefundState === 'failed'
            ? 'Refund failed at the payment provider and needs staff review.'
            : 'Refund is processing with the payment provider.',
      candidate,
      direction: 'system',
      messageType: 'refund_provider_update',
      metadata: {
        providerRefund,
        refundState: finalRefundState,
      },
      payment: updatedPayment || payment,
      refund: updatedRefund,
      strapi,
      supportCase,
      visibility: finalRefundState === 'failed' ? 'internal' : 'public',
    });

    return {
      executed: true,
      providerRefund,
      refund: publicRefund(updatedRefund),
    };
  },
});

import { errors, validateZodSchema, z } from '@strapi/utils';
import { publishAdminRealtimeEvent } from '../../../utils/admin-realtime-events';

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
    type?: unknown;
  };
};

type NotificationTemplatePayload = {
  key: string;
  variables?: Record<string, unknown>;
};

type PaymentServiceRefundResult = {
  amountPence: number;
  createdAt: string;
  currency: string;
  failureReason?: string | null;
  metadata: Record<string, unknown>;
  paymentProvider: string;
  providerPaymentIntentId: string | null;
  providerRefundId: string;
  providerRefundStatus?: string | null;
  reason?: string | null;
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
  appealedAt?: string;
  appliedAt?: string;
  candidate?: DocumentRecord;
  candidateState?: string;
  class?: DocumentRecord;
  companyName?: string;
  concerns?: string;
  confirmedAt?: string;
  completedAt?: string;
  completionStatus?: string;
  countsTowardGuarantee?: boolean;
  createdAt?: string;
  currency?: string;
  displayTitle?: string;
  documentId?: string;
  email?: string;
  employer?: DocumentRecord;
  employerCancellation?: boolean;
  employerContact?: DocumentRecord;
  enrollment?: DocumentRecord;
  enrollmentState?: string;
  eventCategory?: string;
  eventType?: string;
  eligibilitySource?: string;
  firstName?: string;
  id?: number | string;
  interview?: DocumentRecord;
  interviewGuaranteeDeadline?: string;
  interviewSlot?: DocumentRecord;
  interviewState?: string;
  interviewsGuaranteed?: number;
  lastName?: string;
  metadata?: unknown;
  name?: string;
  nextStep?: string;
  notes?: string;
  officialClassCode?: string;
  occurredAt?: string;
  outcome?: string;
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
  rating?: number;
  reason?: string;
  refund?: DocumentRecord;
  refundEligibilityState?: string;
  refundPercentage?: number | string;
  refundState?: string;
  requestedAt?: string;
  reservation?: DocumentRecord;
  reservationState?: string;
  reviewedAt?: string;
  reviewDecision?: string;
  severity?: string;
  scheduledEndTime?: string;
  scheduledStartTime?: string;
  sourceDocumentId?: string;
  sourceType?: string;
  state?: string;
  strength?: string;
  strengths?: string;
  strikeNumber?: number;
  strikeState?: string;
  subjectDisplayName?: string;
  subjectId?: string;
  subjectType?: string;
  submittedAt?: string;
  submittedByType?: string;
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
    reviewClaimToken: z.string().trim().min(32).max(160).optional(),
  })
  .strict();
const reviewEscalateSchema = reviewDetailSchema
  .extend({
    message: z.string().trim().max(4000).optional(),
    refundPercentage: z.enum(['25', '50']).transform((value) => Number(value)),
    reviewClaimToken: z.string().trim().min(32).max(160).optional(),
  })
  .strict();
const reviewExecuteSchema = reviewDetailSchema
  .extend({
    reviewClaimToken: z.string().trim().min(32).max(160).optional(),
  })
  .strict();
const reviewPaymentExceptionApproveSchema = reviewDetailSchema
  .extend({
    message: z.string().trim().max(4000).optional(),
    reviewClaimToken: z.string().trim().min(32).max(160).optional(),
  })
  .strict();
const providerRefundSchema = z
  .object({
    amountPence: z.number().int().nonnegative(),
    createdAt: z.string().datetime(),
    currency: z.string().trim().min(3).max(3),
    failureReason: z.string().trim().max(255).nullable().optional(),
    metadata: z.unknown().optional(),
    paymentProvider: z.literal('stripe').default('stripe'),
    providerPaymentIntentId: z.string().trim().max(255).nullable().optional(),
    providerRefundId: z.string().trim().min(1).max(255),
    providerRefundStatus: z.string().trim().max(80).nullable().optional(),
    reason: z.string().trim().max(120).nullable().optional(),
  })
  .strict();
const providerRefundUpdateSchema = z
  .object({
    createdAt: z.string().datetime().optional(),
    eventType: z.string().trim().min(1).max(160).optional(),
    livemode: z.boolean().optional(),
    providerEventId: z.string().trim().min(1).max(255).optional(),
    providerRefund: providerRefundSchema,
  })
  .strict();

const validateReviewList = validateZodSchema(reviewListSchema);
const validateReviewDetail = validateZodSchema(reviewDetailSchema);
const validateReviewRefuse = validateZodSchema(reviewRefuseSchema);
const validateReviewEscalate = validateZodSchema(reviewEscalateSchema);
const validateReviewExecute = validateZodSchema(reviewExecuteSchema);
const validateReviewPaymentExceptionApprove = validateZodSchema(
  reviewPaymentExceptionApproveSchema
);
const validateProviderRefundUpdate = validateZodSchema(providerRefundUpdateSchema);

const documents = (strapi: StrapiDocumentService, uid: string) =>
  strapi.documents(uid) as unknown as DocumentCollection;

const adminAuthService = (strapi: StrapiDocumentService) =>
  strapi.service('api::admin-auth.admin-auth') as unknown as AdminAuthService;

const reviewClaimService = (strapi: StrapiDocumentService) =>
  strapi.service('api::admin-review-claim.admin-review-claim') as unknown as AdminReviewClaimService;

const auditEvents = (strapi: StrapiDocumentService) =>
  strapi.service('api::audit-event.audit-event') as unknown as AuditEventService;

const supportCaseService = (strapi: StrapiDocumentService) =>
  strapi.service('api::support-case.support-case') as unknown as SupportCaseService;

const publishRefundReviewChange = (strapi: StrapiDocumentService, taskKey?: string) =>
  publishAdminRealtimeEvent(
    {
      channels: ['operations', 'refunds', 'support'],
      resourceKey: taskKey,
      resourceType: 'refund_review',
      type: 'refund_reviews_changed',
    },
    (strapi as { log?: { error?: (message: string, error?: unknown) => void } }).log
  );

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

const getIntegerEnv = (name: string, fallback: number) => {
  const parsedValue = Number.parseInt(process.env[name] || '', 10);

  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : fallback;
};

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
const supportCaseUrl = (supportCaseDocumentId: string) =>
  `${trimTrailingSlash(process.env.CANDIDATE_DASHBOARD_BASE_URL || 'http://localhost:3001')}/support/${encodeURIComponent(supportCaseDocumentId)}`;

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
  priority = 'critical',
  subject,
  template,
  text,
  to,
  type,
}: {
  correlationId?: string;
  html?: string;
  priority?: 'critical' | 'high' | 'transactional' | 'normal' | 'low';
  subject?: string;
  template?: NotificationTemplatePayload;
  text?: string;
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
        ...(html ? { html } : {}),
        priority,
        source: 'core-api',
        ...(subject ? { subject } : {}),
        ...(template ? { template } : {}),
        ...(text ? { text } : {}),
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

const requestPaymentServiceRefundStatus = async (
  providerRefundId: string
): Promise<PaymentServiceRefundResult | undefined> => {
  const baseUrl = process.env.PAYMENT_SERVICE_URL;
  const serviceToken = process.env.PAYMENT_SERVICE_TOKEN;

  if (!baseUrl || !serviceToken) {
    return undefined;
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    getIntegerEnv('PAYMENT_SERVICE_TIMEOUT_MS', 5000)
  );

  try {
    const response = await fetch(
      `${trimTrailingSlash(baseUrl)}/internal/refunds/${encodeURIComponent(providerRefundId)}`,
      {
        headers: {
          'x-hireflip-service-name': 'core-api',
          'x-hireflip-service-token': serviceToken,
        },
        method: 'GET',
        signal: controller.signal,
      }
    );
    const payload = (await response.json().catch(() => null)) as PaymentServiceRefundResponse | null;

    if (
      !response.ok ||
      typeof payload?.data?.providerRefundId !== 'string' ||
      typeof payload.data.amountPence !== 'number' ||
      typeof payload.data.currency !== 'string'
    ) {
      return undefined;
    }

    return {
      amountPence: payload.data.amountPence,
      createdAt:
        typeof payload.data.createdAt === 'string' ? payload.data.createdAt : new Date().toISOString(),
      currency: payload.data.currency,
      failureReason:
        typeof payload.data.failureReason === 'string' ? payload.data.failureReason : null,
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
      reason: typeof payload.data.reason === 'string' ? payload.data.reason : null,
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
        interviewsGuaranteed:
          typeof classRecord.interviewsGuaranteed === 'number'
            ? classRecord.interviewsGuaranteed
            : null,
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
      canApproveFullRefund:
        type === 'payment_exception' &&
        typeof originalAmountPence === 'number' &&
        originalAmountPence > 0 &&
        Boolean(originalPayment?.providerPaymentIntentId),
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

const reviewRelationFilters = (review: RefundReviewItem) => {
  if (review.enrollment?.documentId) {
    return {
      enrollment: {
        documentId: review.enrollment.documentId,
      },
    };
  }

  if (review.candidate?.documentId) {
    return {
      candidate: {
        documentId: review.candidate.documentId,
      },
    };
  }

  return undefined;
};

const relationDisplayName = (record?: DocumentRecord | null) => {
  if (!record) {
    return null;
  }

  return (
    record.displayTitle ||
    record.companyName ||
    record.name ||
    candidateDisplayName(record) ||
    record.email ||
    getDocumentId(record) ||
    null
  );
};

const decisionTreeItem = ({
  detail,
  key,
  label,
  source,
  state,
}: {
  detail: string;
  key: string;
  label: string;
  source: string;
  state: 'met' | 'needs_review' | 'not_met' | 'not_recorded';
}) => ({
  detail,
  key,
  label,
  source,
  state,
});

const dateHasPassed = (value?: string | null) => {
  if (!value) {
    return undefined;
  }

  const timestamp = new Date(value).getTime();

  if (!Number.isFinite(timestamp)) {
    return undefined;
  }

  return timestamp <= Date.now();
};

const publicFeedback = (feedback: DocumentRecord) => ({
  concerns: feedback.concerns || null,
  documentId: getDocumentId(feedback) || null,
  nextStep: feedback.nextStep || null,
  notes: feedback.notes || null,
  outcome: feedback.outcome || null,
  rating: feedback.rating ?? null,
  strengths: feedback.strengths || null,
  submittedAt: feedback.submittedAt || feedback.createdAt || null,
  submittedByType: feedback.submittedByType || null,
});

const refundEvidenceForReview = async (strapi: StrapiDocumentService, review: RefundReviewItem) => {
  const filters = reviewRelationFilters(review);
  const interviews = filters
    ? await documents(strapi, 'api::interview.interview').findMany({
        filters,
        limit: 100,
        populate: ['candidate', 'employer', 'employerContact', 'enrollment', 'interviewSlot'],
        sort: ['scheduledStartTime:asc', 'createdAt:asc'],
      })
    : [];
  const strikes = filters
    ? await documents(strapi, 'api::candidate-interview-strike.candidate-interview-strike').findMany({
        filters,
        limit: 50,
        populate: ['candidate', 'enrollment', 'interview'],
        sort: ['appliedAt:asc', 'createdAt:asc'],
      })
    : [];
  const interviewIds = interviews
    .map((interview) => getDocumentId(interview))
    .filter((documentId): documentId is string => Boolean(documentId));
  const feedbackRecords = interviewIds.length
    ? await documents(strapi, 'api::interview-feedback.interview-feedback').findMany({
        filters: {
          interview: {
            documentId: {
              $in: interviewIds,
            },
          },
        },
        limit: 100,
        populate: ['interview'],
        sort: ['submittedAt:asc', 'createdAt:asc'],
      })
    : [];
  const feedbackByInterviewId = new Map<string, DocumentRecord[]>();

  feedbackRecords.forEach((feedback) => {
    const interviewDocumentId = getDocumentId(feedback.interview);

    if (!interviewDocumentId) {
      return;
    }

    feedbackByInterviewId.set(interviewDocumentId, [
      ...(feedbackByInterviewId.get(interviewDocumentId) || []),
      feedback,
    ]);
  });

  const guaranteedInterviews =
    typeof review.class?.interviewsGuaranteed === 'number'
      ? review.class.interviewsGuaranteed
      : null;
  const qualifyingFromInterviews = interviews.filter(
    (interview) => interview.countsTowardGuarantee
  ).length;
  const qualifyingInterviews =
    interviews.length > 0
      ? qualifyingFromInterviews
      : review.enrollment?.qualifyingInterviewsDeliveredCount ?? null;
  const completedInterviews = interviews.filter(
    (interview) => interview.interviewState === 'completed' || Boolean(interview.completedAt)
  ).length;
  const candidateNoShows = interviews.filter(
    (interview) => interview.interviewState === 'candidate_no_show'
  ).length;
  const candidateDeclines = interviews.filter(
    (interview) => interview.interviewState === 'candidate_declined'
  ).length;
  const employerCancellations = interviews.filter(
    (interview) => interview.employerCancellation || interview.interviewState === 'employer_cancelled'
  ).length;
  const activeStrikes = strikes.filter((strike) =>
    ['active', 'upheld'].includes(String(strike.strikeState || ''))
  ).length;
  const appealedStrikes = strikes.filter((strike) => strike.strikeState === 'appealed').length;
  const guaranteeDeadlinePassed = dateHasPassed(review.enrollment?.interviewGuaranteeDeadline);
  const passStatus = String(review.enrollment?.passStatus || '');
  const completionStatus = String(review.enrollment?.completionStatus || '');
  const paymentState = String(review.payment?.paymentState || review.enrollment?.paymentStatus || '');
  const decisionTree = [
    decisionTreeItem({
      detail:
        passStatus === 'passed'
          ? 'Candidate has passed the course.'
          : passStatus
            ? `Course pass status is ${passStatus}.`
            : 'Course pass status is not recorded.',
      key: 'course_passed',
      label: 'Course passed',
      source: 'Enrollment pass status',
      state: passStatus === 'passed' ? 'met' : passStatus === 'failed' ? 'not_met' : 'not_recorded',
    }),
    decisionTreeItem({
      detail:
        completionStatus === 'completed'
          ? 'Required course completion is recorded.'
          : completionStatus
            ? `Course completion status is ${completionStatus}.`
            : 'Course completion status is not recorded.',
      key: 'course_completion',
      label: 'Course completion',
      source: 'Enrollment completion status',
      state:
        completionStatus === 'completed'
          ? 'met'
          : completionStatus
            ? 'needs_review'
            : 'not_recorded',
    }),
    decisionTreeItem({
      detail:
        typeof guaranteeDeadlinePassed === 'undefined'
          ? 'No interview guarantee deadline is recorded.'
          : guaranteeDeadlinePassed
            ? `Guarantee deadline passed on ${review.enrollment?.interviewGuaranteeDeadline}.`
            : `Guarantee deadline is still open until ${review.enrollment?.interviewGuaranteeDeadline}.`,
      key: 'guarantee_window',
      label: 'Guarantee window',
      source: 'Enrollment guarantee deadline',
      state:
        typeof guaranteeDeadlinePassed === 'undefined'
          ? 'not_recorded'
          : guaranteeDeadlinePassed
            ? 'met'
            : 'needs_review',
    }),
    decisionTreeItem({
      detail:
        typeof qualifyingInterviews !== 'number' || typeof guaranteedInterviews !== 'number'
          ? 'Guaranteed or qualifying interview count is not fully recorded.'
          : qualifyingInterviews >= guaranteedInterviews
            ? `${qualifyingInterviews} of ${guaranteedInterviews} guaranteed interviews were delivered.`
            : `${qualifyingInterviews} of ${guaranteedInterviews} guaranteed interviews were delivered.`,
      key: 'qualifying_interviews',
      label: 'Qualifying interviews',
      source: 'Interview records and enrollment count',
      state:
        typeof qualifyingInterviews !== 'number' || typeof guaranteedInterviews !== 'number'
          ? 'not_recorded'
          : qualifyingInterviews >= guaranteedInterviews
            ? 'not_met'
            : 'met',
    }),
    decisionTreeItem({
      detail:
        activeStrikes >= 2
          ? `${activeStrikes} active or upheld strikes are recorded.`
          : appealedStrikes > 0
            ? `${appealedStrikes} appealed strike record needs review.`
            : `${activeStrikes} active or upheld strikes are recorded.`,
      key: 'strike_limit',
      label: 'Strike limit',
      source: 'Candidate interview strikes',
      state: activeStrikes >= 2 ? 'not_met' : appealedStrikes > 0 ? 'needs_review' : 'met',
    }),
    decisionTreeItem({
      detail:
        employerCancellations > 0
          ? `${employerCancellations} employer cancellation record needs review.`
          : 'No employer cancellation records found in the interview timeline.',
      key: 'employer_cancellations',
      label: 'Employer cancellations',
      source: 'Interview records',
      state: employerCancellations > 0 ? 'needs_review' : 'met',
    }),
    decisionTreeItem({
      detail: paymentState ? `Payment state is ${paymentState}.` : 'Payment state is not recorded.',
      key: 'payment_confirmed',
      label: 'Payment confirmed',
      source: 'Payment/enrollment payment state',
      state: ['paid', 'partially_refunded', 'refunded'].includes(paymentState)
        ? 'met'
        : paymentState
          ? 'needs_review'
          : 'not_recorded',
    }),
  ];

  return {
    decisionTree,
    interviewSummary: {
      candidateDeclines,
      candidateNoShows,
      completed: completedInterviews,
      employerCancellations,
      guaranteed: guaranteedInterviews,
      qualifying: qualifyingInterviews,
      strikes: activeStrikes,
      total: interviews.length,
    },
    interviews: interviews.map((interview) => {
      const interviewDocumentId = getDocumentId(interview);

      return {
        candidateStrikeApplied: Boolean(interview.candidateStrikeApplied),
        completedAt: interview.completedAt || null,
        confirmedAt: interview.confirmedAt || null,
        countsTowardGuarantee: Boolean(interview.countsTowardGuarantee),
        documentId: interviewDocumentId || null,
        employerCancellation: Boolean(interview.employerCancellation),
        employerContactName: relationDisplayName(interview.employerContact),
        employerName: relationDisplayName(interview.employer),
        feedback: (feedbackByInterviewId.get(interviewDocumentId || '') || []).map(publicFeedback),
        interviewState: interview.interviewState || null,
        scheduledEndTime: interview.scheduledEndTime || null,
        scheduledStartTime: interview.scheduledStartTime || null,
      };
    }),
    readiness: {
      completedAt: review.enrollment?.completedAt || null,
      completionStatus: review.enrollment?.completionStatus || null,
      guaranteeDeadline: review.enrollment?.interviewGuaranteeDeadline || null,
      passStatus: review.enrollment?.passStatus || null,
      paymentStatus: review.enrollment?.paymentStatus || null,
      refundEligibilityState: review.enrollment?.refundEligibilityState || null,
    },
    strikes: strikes.map((strike) => ({
      appliedAt: strike.appliedAt || strike.createdAt || null,
      appealedAt: strike.appealedAt || null,
      documentId: getDocumentId(strike) || null,
      interviewDocumentId: getDocumentId(strike.interview) || null,
      reason: strike.reason || null,
      reviewDecision: strike.reviewDecision || null,
      reviewedAt: strike.reviewedAt || null,
      strikeNumber: strike.strikeNumber ?? null,
      strikeState: strike.strikeState || null,
    })),
  };
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

const paymentExceptionActionContext = async (
  strapi: StrapiDocumentService,
  taskKey: string
) => {
  const review = await reviewByTaskKey(strapi, taskKey);

  if (review.reviewType !== 'payment_exception') {
    throw new ValidationError('This review is not linked to a payment exception.');
  }

  let payment: DocumentRecord | undefined;
  let reservation: DocumentRecord | undefined;
  let enrollment: DocumentRecord | undefined;

  if (review.sourceType === 'payment') {
    payment = await byDocumentId(strapi, 'api::payment.payment', review.sourceDocumentId, [
      'candidate',
      'enrollment',
      'reservation',
    ]);

    if (!payment) {
      throw new ValidationError('Payment exception could not be found.');
    }

    const relationRecords = await relationContext(strapi, payment);
    enrollment = relationRecords.enrollment;
    reservation = relationRecords.reservation;
  } else if (review.sourceType === 'reservation') {
    reservation = await byDocumentId(
      strapi,
      'api::reservation.reservation',
      review.sourceDocumentId,
      ['candidate', 'class', 'enrollment']
    );

    if (!reservation) {
      throw new ValidationError('Reservation payment exception could not be found.');
    }

    payment = await paymentForRelation(strapi, 'reservation', review.sourceDocumentId);
    enrollment = reservation.enrollment?.documentId
      ? await byDocumentId(strapi, 'api::enrollment.enrollment', getDocumentId(reservation.enrollment), [
          'candidate',
          'class',
        ])
      : reservation.enrollment;
  } else if (review.sourceType === 'enrollment') {
    enrollment = await byDocumentId(
      strapi,
      'api::enrollment.enrollment',
      review.sourceDocumentId,
      ['candidate', 'class']
    );

    if (!enrollment) {
      throw new ValidationError('Enrollment payment exception could not be found.');
    }

    payment = await paymentForRelation(strapi, 'enrollment', review.sourceDocumentId);
    reservation = payment?.reservation?.documentId
      ? await byDocumentId(
          strapi,
          'api::reservation.reservation',
          getDocumentId(payment.reservation),
          ['candidate', 'class', 'enrollment']
        )
      : undefined;
  }

  if (!payment?.documentId) {
    throw new ValidationError('A payment record is required before this exception can be refunded.');
  }

  if (!payment.providerPaymentIntentId) {
    throw new ValidationError('The provider PaymentIntent is required before this exception can be refunded.');
  }

  const candidate =
    payment.candidate || reservation?.candidate || enrollment?.candidate || review.candidate;

  if (!candidate?.email || typeof candidate.email !== 'string') {
    throw new ValidationError('Payment exception is not linked to a candidate email address.');
  }

  return {
    candidate,
    enrollment,
    payment,
    reservation,
    review,
  };
};

const activeExceptionRefundForPayment = async (
  strapi: StrapiDocumentService,
  paymentDocumentId: string
) => {
  const refunds = await documents(strapi, 'api::refund.refund').findMany({
    filters: {
      eligibilitySource: 'payment_error',
      payment: {
        documentId: paymentDocumentId,
      },
      refundState: {
        $in: ['requested', 'approved', 'submitted_to_provider', 'processing', 'failed'],
      },
    },
    limit: 1,
    populate: ['candidate', 'enrollment', 'payment'],
    sort: ['updatedAt:desc', 'createdAt:desc'],
  });

  return refunds[0];
};

const resolvePaymentExceptionSourceRecords = async ({
  enrollment,
  payment,
  refund,
  reservation,
  strapi,
}: {
  enrollment?: DocumentRecord;
  payment: DocumentRecord;
  refund: DocumentRecord;
  reservation?: DocumentRecord;
  strapi: StrapiDocumentService;
}) => {
  const now = new Date().toISOString();
  const metadata = {
    paymentExceptionResolvedAt: now,
    paymentExceptionResolution: 'full_refund_approved',
    refundDocumentId: getDocumentId(refund) || null,
  };
  const [updatedPayment, updatedReservation, updatedEnrollment] = await Promise.all([
    payment.documentId && payment.paymentState === 'requires_review'
      ? documents(strapi, 'api::payment.payment').update({
          documentId: payment.documentId,
          data: {
            metadata: {
              ...(objectValue(payment.metadata)),
              ...metadata,
            },
            paymentState: 'paid',
          },
          populate: ['candidate', 'enrollment', 'reservation'],
        })
      : Promise.resolve(payment),
    reservation?.documentId && reservation.reservationState === 'payment_exception'
      ? documents(strapi, 'api::reservation.reservation').update({
          documentId: reservation.documentId,
          data: {
            metadata: {
              ...(objectValue(reservation.metadata)),
              ...metadata,
            },
            reservationState: 'released',
          },
          populate: ['candidate', 'class', 'enrollment'],
        })
      : Promise.resolve(reservation),
    enrollment?.documentId &&
    (enrollment.enrollmentState === 'payment_exception' ||
      enrollment.paymentStatus === 'requires_review')
      ? documents(strapi, 'api::enrollment.enrollment').update({
          documentId: enrollment.documentId,
          data: {
            enrollmentState: 'removed_full_refund',
            metadata: {
              ...(objectValue(enrollment.metadata)),
              ...metadata,
            },
            paymentStatus: 'paid',
            reservationExpiresAt: null,
            waitingListPosition: null,
          },
          populate: ['candidate', 'class'],
        })
      : Promise.resolve(enrollment),
  ]);

  return {
    enrollment: updatedEnrollment,
    payment: updatedPayment,
    reservation: updatedReservation,
  };
};

const refundsByProviderRefundId = async (
  strapi: StrapiDocumentService,
  providerRefundId?: string | null
) => {
  if (!providerRefundId) {
    return [];
  }

  return documents(strapi, 'api::refund.refund').findMany({
    filters: {
      providerRefundId,
    },
    limit: 1,
    populate: ['candidate', 'enrollment', 'payment'],
  });
};

const refundsByProviderMetadata = async (
  strapi: StrapiDocumentService,
  providerRefund: PaymentServiceRefundResult
) => {
  const providerMetadata = objectValue(providerRefund.metadata);
  const refundDocumentId =
    typeof providerMetadata.refundDocumentId === 'string'
      ? providerMetadata.refundDocumentId
      : undefined;

  if (refundDocumentId) {
    const refund = await byDocumentId(strapi, 'api::refund.refund', refundDocumentId, [
      'candidate',
      'enrollment',
      'payment',
    ]);

    if (refund) {
      return [refund];
    }
  }

  if (!providerRefund.providerPaymentIntentId) {
    return [];
  }

  return documents(strapi, 'api::refund.refund').findMany({
    filters: {
      amountPence: providerRefund.amountPence,
      payment: {
        providerPaymentIntentId: providerRefund.providerPaymentIntentId,
      },
      refundState: {
        $in: ['approved', 'submitted_to_provider', 'processing', 'failed'],
      },
    },
    limit: 1,
    populate: ['candidate', 'enrollment', 'payment'],
    sort: ['updatedAt:desc', 'createdAt:desc'],
  });
};

const providerRefundContext = async (
  strapi: StrapiDocumentService,
  providerRefund: PaymentServiceRefundResult
) => {
  const [refundById] = await refundsByProviderRefundId(strapi, providerRefund.providerRefundId);
  const [fallbackRefund] = refundById
    ? [undefined]
    : await refundsByProviderMetadata(strapi, providerRefund);
  const refund = refundById || fallbackRefund;

  if (!refund) {
    return {
      candidate: undefined,
      payment: undefined,
      providerMetadata: objectValue(providerRefund.metadata),
      refund: undefined,
    };
  }

  const payment = refund.payment?.documentId
    ? await byDocumentId(strapi, 'api::payment.payment', getDocumentId(refund.payment), [
        'candidate',
        'enrollment',
        'reservation',
      ])
    : undefined;
  const candidate = refund.candidate || payment?.candidate || refund.enrollment?.candidate;

  return {
    candidate,
    payment: payment || refund.payment,
    providerMetadata: objectValue(providerRefund.metadata),
    refund,
  };
};

const providerRefundHasMaterialChange = ({
  finalRefundState,
  providerRefund,
  refund,
}: {
  finalRefundState: string;
  providerRefund: PaymentServiceRefundResult;
  refund: DocumentRecord;
}) => {
  const metadata = objectValue(refund.metadata);

  return (
    refund.refundState !== finalRefundState ||
    refund.providerRefundId !== providerRefund.providerRefundId ||
    metadata.providerRefundStatus !== providerRefund.providerRefundStatus ||
    metadata.providerRefundFailureReason !== (providerRefund.failureReason || null)
  );
};

const providerRefundSystemActor = (requestContext: RequestContext) => ({
  displayName: 'Payment service',
  id: requestContext.serviceName || 'payment-service',
  type: 'service',
});

const ensureProviderRefundSupportCase = async ({
  candidate,
  payment,
  refund,
  state,
  strapi,
  summary,
}: {
  candidate?: DocumentRecord;
  payment?: DocumentRecord;
  refund: DocumentRecord;
  state: 'awaiting_candidate' | 'awaiting_staff' | 'in_progress' | 'resolved';
  strapi: StrapiDocumentService;
  summary?: string;
}) =>
  supportCaseService(strapi).ensureRefundCase({
    candidate,
    createdBy: {
      displayName: 'Payment service',
      id: 'payment-service',
      type: 'service',
    },
    enrollment: refund.enrollment || payment?.enrollment,
    payment,
    priority: state === 'awaiting_staff' ? 'high' : 'normal',
    refund,
    source: 'payment_service',
    state,
    summary,
  });

const providerRefundCaseState = (refundState: string) =>
  refundState === 'completed'
    ? 'resolved'
    : refundState === 'failed'
      ? 'awaiting_staff'
      : 'in_progress';

const providerRefundMessageBody = (refundState: string) =>
  refundState === 'completed'
    ? 'Refund completed by the payment provider.'
    : refundState === 'failed'
      ? 'Refund failed at the payment provider and needs staff review.'
      : 'Refund is processing with the payment provider.';

const providerRefundPublicMessageBody = (refundState: string) =>
  refundState === 'completed'
    ? 'Refund completed by the payment provider.'
    : refundState === 'failed'
      ? "There's been an issue whilst processing your refund which may cause a delay. But fear not, our team are looking into it and will get back to you in due course."
      : 'Refund is processing with the payment provider.';

const providerRefundNotificationTemplateKey = (refundState: string) =>
  refundState === 'completed'
    ? 'candidate_refund_completed'
    : refundState === 'failed'
      ? 'candidate_refund_failed'
      : undefined;

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

const reservationSnapshot = (reservation?: DocumentRecord | null) =>
  reservation
    ? {
        documentId: getDocumentId(reservation) || null,
        paidAt: reservation.paidAt || null,
        reservationState: reservation.reservationState || null,
      }
    : null;

const enrollmentSnapshot = (enrollment?: DocumentRecord | null) =>
  enrollment
    ? {
        documentId: getDocumentId(enrollment) || null,
        enrollmentState: enrollment.enrollmentState || null,
        paymentStatus: enrollment.paymentStatus || null,
      }
    : null;

const candidateFirstName = (candidate: DocumentRecord) =>
  typeof candidate.firstName === 'string' && candidate.firstName.trim()
    ? candidate.firstName.trim()
    : 'there';

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

const auditPaymentExceptionResolution = async ({
  candidate,
  metadata,
  newEnrollment,
  newPayment,
  newRefund,
  newReservation,
  previousEnrollment,
  previousPayment,
  previousReservation,
  requestContext,
  session,
  strapi,
}: {
  candidate?: DocumentRecord | null;
  metadata?: Record<string, unknown>;
  newEnrollment?: DocumentRecord | null;
  newPayment?: DocumentRecord | null;
  newRefund?: DocumentRecord | null;
  newReservation?: DocumentRecord | null;
  previousEnrollment?: DocumentRecord | null;
  previousPayment?: DocumentRecord | null;
  previousReservation?: DocumentRecord | null;
  requestContext: RequestContext;
  session: AdminSession;
  strapi: StrapiDocumentService;
}) =>
  auditEvents(strapi).record({
    actorDisplayName: session.user.displayName,
    actorEmail: session.user.email,
    actorId: session.user.id,
    actorType: 'admin',
    eventCategory: 'payment',
    eventType: 'admin.payment_exception_full_refund_approved',
    ipAddress: requestContext.ipAddress,
    metadata,
    newState: {
      enrollment: enrollmentSnapshot(newEnrollment),
      payment: paymentSnapshot(newPayment),
      refund: refundSnapshot(newRefund),
      reservation: reservationSnapshot(newReservation),
    },
    previousState: {
      enrollment: enrollmentSnapshot(previousEnrollment),
      payment: paymentSnapshot(previousPayment),
      reservation: reservationSnapshot(previousReservation),
    },
    requestId: requestContext.requestId,
    source: 'admin_dashboard',
    subjectDisplayName: candidateDisplayName(candidate),
    subjectId: getDocumentId(newPayment || previousPayment) || getDocumentId(newRefund),
    subjectType: 'payment',
    userAgent: requestContext.userAgent,
  });

const auditProviderRefundAction = async ({
  eventType,
  metadata,
  newRefund,
  previousRefund,
  providerRefund,
  requestContext,
  severity = 'info',
  strapi,
  subjectDisplayName,
  subjectId,
}: {
  eventType: string;
  metadata?: Record<string, unknown>;
  newRefund?: DocumentRecord | null;
  previousRefund?: DocumentRecord | null;
  providerRefund: PaymentServiceRefundResult;
  requestContext: RequestContext;
  severity?: 'critical' | 'error' | 'info' | 'warning';
  strapi: StrapiDocumentService;
  subjectDisplayName?: string;
  subjectId?: string;
}) =>
  auditEvents(strapi).record({
    actorDisplayName: 'Payment service',
    actorId: requestContext.serviceName || 'payment-service',
    actorType: 'service',
    eventCategory: 'refund',
    eventType,
    ipAddress: requestContext.ipAddress,
    metadata: {
      providerRefund,
      ...metadata,
    },
    newState: {
      refund: refundSnapshot(newRefund),
    },
    previousState: {
      refund: refundSnapshot(previousRefund),
    },
    requestId: requestContext.requestId,
    serviceName: requestContext.serviceName || 'payment-service',
    severity,
    source: 'payment_service',
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
  candidate?: DocumentRecord;
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

const queueCandidateRefundProviderNotification = async ({
  candidate,
  refund,
  refundState,
  strapi,
  supportCase,
}: {
  candidate?: DocumentRecord;
  refund: DocumentRecord;
  refundState: string;
  strapi: StrapiDocumentService;
  supportCase: DocumentRecord;
}) => {
  const templateKey = providerRefundNotificationTemplateKey(refundState);

  if (!templateKey || !candidate?.email || typeof candidate.email !== 'string') {
    return undefined;
  }

  const supportCaseDocumentId = getDocumentId(supportCase);
  const amount = formatMoney(refund.amountPence, refund.currency || 'GBP');

  try {
    return await requestNotificationServiceEmail({
      correlationId: getDocumentId(refund),
      priority: 'critical',
      template: {
        key: templateKey,
        variables: {
          amount,
          candidateFirstName: candidateFirstName(candidate),
          supportCaseUrl: supportCaseDocumentId ? supportCaseUrl(supportCaseDocumentId) : undefined,
        },
      },
      to: candidate.email,
      type: templateKey,
    });
  } catch (error) {
    (strapi as { log?: { error?: (message: string, error?: unknown) => void } }).log?.error?.(
      'Candidate provider refund notification could not be queued.',
      error
    );

    return undefined;
  }
};

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
  async recordProviderRefundUpdate(input: unknown, requestContext: RequestContext = {}) {
    const body = validateProviderRefundUpdate(input);
    const providerRefund: PaymentServiceRefundResult = {
      ...body.providerRefund,
      metadata: objectValue(body.providerRefund.metadata),
      paymentProvider: 'stripe',
      providerPaymentIntentId: body.providerRefund.providerPaymentIntentId || null,
      providerRefundStatus: body.providerRefund.providerRefundStatus || null,
    };
    const context = {
      ...requestContext,
      serviceName: requestContext.serviceName || 'payment-service',
    };
    const { candidate, payment, providerMetadata, refund } = await providerRefundContext(
      strapi,
      providerRefund
    );

    if (!refund?.documentId) {
      await auditProviderRefundAction({
        eventType: 'payment.refund.provider_unmatched',
        metadata: {
          eventType: body.eventType,
          livemode: body.livemode,
          providerEventId: body.providerEventId,
          providerMetadata,
        },
        providerRefund,
        requestContext: context,
        severity: 'error',
        strapi,
        subjectDisplayName: providerRefund.providerRefundId,
        subjectId: providerRefund.providerRefundId,
      });

      return {
        ignored: true,
        providerRefundId: providerRefund.providerRefundId,
        reason: 'unmatched_provider_refund',
      };
    }

    const finalRefundState = providerRefundState(providerRefund.providerRefundStatus);
    const hasMaterialChange = providerRefundHasMaterialChange({
      finalRefundState,
      providerRefund,
      refund,
    });

    if (!hasMaterialChange) {
      return {
        payment: payment?.documentId ? { documentId: payment.documentId } : null,
        providerRefundId: providerRefund.providerRefundId,
        refund: { documentId: refund.documentId },
        unchanged: true,
      };
    }

    const now = new Date().toISOString();
    const updatedRefund = await documents(strapi, 'api::refund.refund').update({
      documentId: refund.documentId,
      data: {
        metadata: {
          ...(objectValue(refund.metadata)),
          providerRefundFailureReason: providerRefund.failureReason || null,
          providerRefundLastEventCreatedAt: body.createdAt || null,
          providerRefundLastEventType: body.eventType || null,
          providerRefundLastProviderEventId: body.providerEventId || null,
          providerRefundLastSyncedAt: now,
          providerRefundLivemode: body.livemode ?? null,
          providerRefundReason: providerRefund.reason || null,
          providerRefundStatus: providerRefund.providerRefundStatus || null,
        },
        processedAt:
          finalRefundState === 'completed'
            ? refund.processedAt || providerRefund.createdAt || now
            : refund.processedAt || null,
        providerRefundId: providerRefund.providerRefundId,
        refundState: finalRefundState,
      },
      populate: ['candidate', 'enrollment', 'payment'],
    });
    const updatedPayment =
      finalRefundState === 'completed'
        ? await updatePaymentAfterProviderRefund({
            payment,
            refund: updatedRefund,
            strapi,
          })
        : undefined;
    const caseState = providerRefundCaseState(finalRefundState);
    const { supportCase } = await ensureProviderRefundSupportCase({
      candidate,
      payment: updatedPayment || payment,
      refund: updatedRefund,
      state: caseState,
      strapi,
      summary: providerRefundMessageBody(finalRefundState),
    });

    await updateRefundSupportCaseState({
      caseState,
      strapi,
      supportCase,
    });
    const providerNotificationResult = await queueCandidateRefundProviderNotification({
      candidate,
      refund: updatedRefund,
      refundState: finalRefundState,
      strapi,
      supportCase,
    });
    await addRefundSupportMessage({
      body: providerRefundPublicMessageBody(finalRefundState),
      candidate,
      deliveryState:
        providerNotificationResult?.data?.queued === true
          ? 'queued'
          : providerRefundNotificationTemplateKey(finalRefundState) && candidate?.email
            ? 'failed'
            : 'not_required',
      direction: 'system',
      messageType: 'refund_provider_update',
      metadata: {
        eventType: body.eventType,
        livemode: body.livemode,
        notificationServiceJobId: providerNotificationResult?.data?.jobId ?? null,
        providerEventId: body.providerEventId,
        providerRefund,
        refundState: finalRefundState,
      },
      payment: updatedPayment || payment,
      refund: updatedRefund,
      strapi,
      supportCase,
      visibility: 'public',
    });

    await auditProviderRefundAction({
      eventType:
        finalRefundState === 'completed'
          ? 'payment.refund.completed'
          : finalRefundState === 'failed'
            ? 'payment.refund.failed'
            : 'payment.refund.provider_update',
      metadata: {
        eventType: body.eventType,
        livemode: body.livemode,
        payment: paymentSnapshot(updatedPayment || payment),
        providerEventId: body.providerEventId,
      },
      newRefund: updatedRefund,
      previousRefund: refund,
      providerRefund,
      requestContext: context,
      severity: finalRefundState === 'failed' ? 'error' : 'info',
      strapi,
      subjectDisplayName: candidateDisplayName(candidate),
      subjectId: refund.documentId,
    });
    await publishRefundReviewChange(strapi, `refund:${refund.documentId}:${finalRefundState}`);

    return {
      payment: (updatedPayment || payment)?.documentId
        ? { documentId: (updatedPayment || payment)?.documentId }
        : null,
      providerRefundId: providerRefund.providerRefundId,
      refund: { documentId: updatedRefund.documentId },
      refundState: finalRefundState,
    };
  },

  async reconcileProviderRefunds(limit = 50, requestContext: RequestContext = {}) {
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const refunds = await documents(strapi, 'api::refund.refund').findMany({
      filters: {
        paymentProvider: 'stripe',
        providerRefundId: {
          $notNull: true,
        },
        refundState: {
          $in: ['submitted_to_provider', 'processing'],
        },
      },
      limit: safeLimit,
      populate: ['payment'],
      sort: ['updatedAt:asc', 'createdAt:asc'],
    });
    const summary = {
      failed: 0,
      processed: 0,
      providerUnavailable: 0,
      skipped: 0,
      total: refunds.length,
    };

    for (const refund of refunds) {
      if (!refund.providerRefundId) {
        summary.skipped += 1;
        continue;
      }

      const providerRefund = await requestPaymentServiceRefundStatus(refund.providerRefundId);

      if (!providerRefund) {
        summary.providerUnavailable += 1;
        continue;
      }

      try {
        const service = strapi.service('api::admin-refund.admin-refund') as {
          recordProviderRefundUpdate(input: unknown, context?: RequestContext): Promise<unknown>;
        };

        await service.recordProviderRefundUpdate(
          {
            createdAt: new Date().toISOString(),
            eventType: 'stripe.refund.reconciled',
            providerRefund,
          },
          {
            ...requestContext,
            serviceName: requestContext.serviceName || 'refund-reconciliation',
          }
        );
        summary.processed += 1;
      } catch (error) {
        summary.failed += 1;
      }
    }

    return summary;
  },

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

    const session = await assertRefundReviewSession(strapi, body.sessionToken, requestContext);

    const review = await reviewByTaskKey(strapi, body.taskKey);
    const [auditEvents, supportCases, evidence] = await Promise.all([
      auditEventsForReview(strapi, review),
      supportCasesForReview(strapi, review),
      refundEvidenceForReview(strapi, review),
    ]);
    const { reviewClaim } = await reviewClaimService(strapi).claimForSession(
      {
        resourceDocumentId: review.sourceDocumentId,
        resourceKey: review.taskKey,
        resourceLabel: review.title,
        resourceType: 'refund_review',
      },
      session,
      requestContext
    );

    return {
      generatedAt: new Date().toISOString(),
      review: {
        ...review,
        auditEvents,
        evidence,
        supportCases,
      },
      reviewClaim,
    };
  },

  async approvePaymentExceptionRefund(input: unknown, requestContext: RequestContext = {}) {
    const body = validateReviewPaymentExceptionApprove(input);
    const session = await assertRefundReviewSession(strapi, body.sessionToken, requestContext);
    const { candidate, enrollment, payment, reservation, review } =
      await paymentExceptionActionContext(strapi, body.taskKey);

    await reviewClaimService(strapi).assertActiveClaimForSession(
      {
        claimToken: body.reviewClaimToken,
        resourceDocumentId: review.sourceDocumentId,
        resourceKey: body.taskKey,
        resourceLabel: review.title,
        resourceType: 'refund_review',
      },
      session
    );

    const existingRefund = await activeExceptionRefundForPayment(strapi, payment.documentId);

    if (existingRefund?.documentId) {
      throw new ValidationError('This payment exception already has an active refund review.');
    }

    if (typeof payment.amountPence !== 'number' || payment.amountPence <= 0) {
      throw new ValidationError('A positive payment amount is required before a full refund can be approved.');
    }

    const now = new Date().toISOString();
    const amount = formatMoney(payment.amountPence, payment.currency || 'GBP');
    const candidateMessage =
      body.message ||
      `Your payment exception has been reviewed and a full refund${amount ? ` of ${amount}` : ''} has been approved. It is now waiting for final provider processing.`;
    const refund = await documents(strapi, 'api::refund.refund').create({
      data: {
        amountPence: payment.amountPence,
        approvedAt: now,
        candidate: relationConnect(candidate),
        currency: payment.currency || 'GBP',
        eligibilitySource: 'payment_error',
        enrollment: relationConnect(enrollment || payment.enrollment),
        metadata: {
          approvedByAdminEmail: session.user.email,
          approvedByAdminId: session.user.id,
          originalAmountPence: payment.amountPence,
          paymentExceptionApprovedAt: now,
          paymentExceptionReason: objectValue(payment.metadata).exceptionReason || null,
          paymentExceptionSourceDocumentId: review.sourceDocumentId,
          paymentExceptionTaskKey: body.taskKey,
          refundDecision: 'payment_exception_full_refund_pending_super_admin_execution',
        },
        payment: relationConnect(payment),
        paymentProvider: payment.paymentProvider || 'stripe',
        reason: candidateMessage,
        refundPercentage: 100,
        refundState: 'approved',
        requestedAt: now,
      },
      populate: ['candidate', 'enrollment', 'payment'],
    });
    const { supportCase } = await ensureRefundSupportCase({
      candidate,
      payment,
      refund,
      session,
      state: 'awaiting_staff',
      strapi,
      summary: 'Payment exception approved for a full refund and waiting for Super Admin provider execution.',
    });
    const supportCaseDocumentId = getDocumentId(supportCase);
    let queueResult: NotificationServiceQueueResponse | undefined;
    let notificationFailureMessage: string | undefined;

    try {
      queueResult = await requestNotificationServiceEmail({
        correlationId: refund.documentId,
        template: {
          key: 'candidate_refund_accepted',
          variables: {
            amount,
            candidateFirstName: candidateFirstName(candidate),
            message: candidateMessage,
            supportCaseUrl: supportCaseDocumentId ? supportCaseUrl(supportCaseDocumentId) : undefined,
          },
        },
        to: candidate.email,
        type: 'candidate_refund_accepted',
      });
    } catch (error) {
      notificationFailureMessage =
        error instanceof Error
          ? error.message
          : 'Candidate payment exception refund notification could not be queued.';
      (strapi as { log?: { error?: (message: string, error?: unknown) => void } }).log?.error?.(
        'Candidate payment exception refund notification could not be queued.',
        error
      );
    }

    const notificationQueued = queueResult?.data?.queued === true;
    const refundWithNotification = await documents(strapi, 'api::refund.refund').update({
      documentId: refund.documentId,
      data: {
        metadata: {
          ...(objectValue(refund.metadata)),
          acceptedCandidateMessage: candidateMessage,
          acceptedNotificationFailureMessage: notificationFailureMessage || null,
          acceptedNotificationServiceJobId: queueResult?.data?.jobId ?? null,
        },
      },
      populate: ['candidate', 'enrollment', 'payment'],
    });

    await addRefundSupportMessage({
      body: candidateMessage,
      candidate,
      deliveryState: notificationQueued ? 'queued' : 'failed',
      direction: 'outbound',
      messageType: 'refund_acceptance',
      metadata: {
        amountPence: payment.amountPence,
        notificationFailureMessage: notificationFailureMessage || null,
        notificationServiceJobId: queueResult?.data?.jobId ?? null,
        refundPercentage: 100,
      },
      payment,
      refund: refundWithNotification,
      sender: adminSender(session),
      sentAt: now,
      strapi,
      subject: 'Your HireFlip refund has been accepted',
      supportCase,
      visibility: 'public',
    });
    const updatedRecords = await resolvePaymentExceptionSourceRecords({
      enrollment,
      payment,
      refund: refundWithNotification,
      reservation,
      strapi,
    });

    await auditPaymentExceptionResolution({
      candidate,
      metadata: {
        amountPence: payment.amountPence,
        candidateEmail: candidate.email,
        notificationFailureMessage: notificationFailureMessage || null,
        notificationQueued,
        notificationServiceJobId: queueResult?.data?.jobId ?? null,
        refundPercentage: 100,
        taskKey: body.taskKey,
      },
      newEnrollment: updatedRecords.enrollment,
      newPayment: updatedRecords.payment,
      newRefund: refundWithNotification,
      newReservation: updatedRecords.reservation,
      previousEnrollment: enrollment,
      previousPayment: payment,
      previousReservation: reservation,
      requestContext,
      session,
      strapi,
    });
    await publishRefundReviewChange(strapi, body.taskKey);
    await publishRefundReviewChange(strapi, `refund:${refundWithNotification.documentId}:approved`);

    return {
      approved: true,
      notificationQueued,
      refund: publicRefund(refundWithNotification),
    };
  },

  async refuseReview(input: unknown, requestContext: RequestContext = {}) {
    const body = validateReviewRefuse(input);
    const session = await assertRefundReviewSession(strapi, body.sessionToken, requestContext);
    const { candidate, payment, refund, review } = await refundActionContext(strapi, body.taskKey);
    const currentState = String(refund.refundState || '');

    if (!['requested', 'failed'].includes(currentState)) {
      throw new ValidationError('Only requested or failed refunds can be refused.');
    }

    await reviewClaimService(strapi).assertActiveClaimForSession(
      {
        claimToken: body.reviewClaimToken,
        resourceDocumentId: review.sourceDocumentId,
        resourceKey: body.taskKey,
        resourceLabel: review.title,
        resourceType: 'refund_review',
      },
      session
    );

    const now = new Date().toISOString();
    const { supportCase } = await ensureRefundSupportCase({
      candidate,
      payment,
      refund,
      session,
      state: 'awaiting_candidate',
      strapi,
      summary: 'Refund refused; waiting for candidate response or further evidence.',
    });
    const supportCaseDocumentId = getDocumentId(supportCase);
    const queueResult = await requestNotificationServiceEmail({
      correlationId: refund.documentId,
      template: {
        key: 'candidate_refund_refused',
        variables: {
          candidateFirstName: candidateFirstName(candidate),
          message: body.message,
          supportCaseUrl: supportCaseDocumentId ? supportCaseUrl(supportCaseDocumentId) : undefined,
        },
      },
      to: candidate.email,
      type: 'candidate_refund_refused',
    });
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
      subject: 'Your HireFlip refund request',
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
    await publishRefundReviewChange(strapi, body.taskKey);

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

    await reviewClaimService(strapi).assertActiveClaimForSession(
      {
        claimToken: body.reviewClaimToken,
        resourceDocumentId: review.sourceDocumentId,
        resourceKey: body.taskKey,
        resourceLabel: review.title,
        resourceType: 'refund_review',
      },
      session
    );

    const amountPence = Math.round((review.originalAmountPence * body.refundPercentage) / 100);
    const currency = refund.currency || review.payment?.currency || 'GBP';
    const formattedAmount = formatMoney(amountPence, currency);
    const now = new Date().toISOString();
    const { supportCase } = await ensureRefundSupportCase({
      candidate,
      payment,
      refund,
      session,
      state: 'awaiting_staff',
      strapi,
      summary: 'Refund accepted and waiting for Super Admin provider execution.',
    });
    const supportCaseDocumentId = getDocumentId(supportCase);
    const queueResult = await requestNotificationServiceEmail({
      correlationId: refund.documentId,
      template: {
        key: 'candidate_refund_accepted',
        variables: {
          amount: formattedAmount,
          candidateFirstName: candidateFirstName(candidate),
          message: body.message,
          supportCaseUrl: supportCaseDocumentId ? supportCaseUrl(supportCaseDocumentId) : undefined,
        },
      },
      to: candidate.email,
      type: 'candidate_refund_accepted',
    });
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
      subject: 'Your HireFlip refund has been accepted',
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
    await publishRefundReviewChange(strapi, body.taskKey);

    return {
      escalated: true,
      notificationQueued: true,
      refund: publicRefund(updatedRefund),
    };
  },

  async executeReviewRefund(input: unknown, requestContext: RequestContext = {}) {
    const body = validateReviewExecute(input);
    const session = await assertSuperAdminSession(strapi, body.sessionToken, requestContext);
    const { candidate, payment, refund, review } = await refundActionContext(strapi, body.taskKey);
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

    await reviewClaimService(strapi).assertActiveClaimForSession(
      {
        claimToken: body.reviewClaimToken,
        resourceDocumentId: review.sourceDocumentId,
        resourceKey: body.taskKey,
        resourceLabel: review.title,
        resourceType: 'refund_review',
      },
      session
    );

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
      await publishRefundReviewChange(strapi, body.taskKey);

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
    const providerNotificationResult = await queueCandidateRefundProviderNotification({
      candidate,
      refund: updatedRefund,
      refundState: finalRefundState,
      strapi,
      supportCase,
    });
    await addRefundSupportMessage({
      body: providerRefundPublicMessageBody(finalRefundState),
      candidate,
      deliveryState:
        providerNotificationResult?.data?.queued === true
          ? 'queued'
          : providerRefundNotificationTemplateKey(finalRefundState) && candidate?.email
            ? 'failed'
            : 'not_required',
      direction: 'system',
      messageType: 'refund_provider_update',
      metadata: {
        notificationServiceJobId: providerNotificationResult?.data?.jobId ?? null,
        providerRefund,
        refundState: finalRefundState,
      },
      payment: updatedPayment || payment,
      refund: updatedRefund,
      strapi,
      supportCase,
      visibility: 'public',
    });
    await publishRefundReviewChange(strapi, body.taskKey);

    return {
      executed: true,
      providerRefund,
      refund: publicRefund(updatedRefund),
    };
  },
});

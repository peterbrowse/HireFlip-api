import { errors, validateZodSchema, z } from '@strapi/utils';
import { publishAdminRealtimeEvent } from '../../../utils/admin-realtime-events';

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

type AuditEventService = {
  record(input: unknown): Promise<unknown>;
};

type DocumentRecord = Record<string, unknown> & {
  candidate?: DocumentRecord;
  channel?: string;
  createdAt?: string;
  deliveredAt?: string;
  deliveryState?: string;
  documentId?: string;
  employer?: DocumentRecord;
  errorMessage?: string;
  eventType?: string;
  failedAt?: string;
  id?: number | string;
  interview?: DocumentRecord;
  issueClearedAt?: string;
  issueClearedByEmail?: string;
  issueClearReason?: string;
  metadata?: unknown;
  notificationPreferences?: unknown;
  payment?: DocumentRecord;
  priority?: string;
  provider?: string;
  providerMessageId?: string;
  recipientEmail?: string;
  recipientId?: string;
  recipientPhone?: string;
  recipientType?: string;
  refund?: DocumentRecord;
  relatedId?: string;
  relatedType?: string;
  scheduledAt?: string;
  sentAt?: string;
  templateKey?: string;
  updatedAt?: string;
};

type DocumentCollection = {
  count(input: Record<string, unknown>): Promise<number>;
  create(input: Record<string, unknown>): Promise<DocumentRecord>;
  findMany(input: Record<string, unknown>): Promise<DocumentRecord[]>;
  update(input: Record<string, unknown>): Promise<DocumentRecord>;
};

type StrapiService = {
  documents(uid: string): unknown;
  log?: {
    error?: (message: string, error?: unknown) => void;
    warn?: (message: string, error?: unknown) => void;
  };
  service(uid: string): unknown;
};

type NotificationServiceQueueResponse = {
  data?: {
    jobId?: unknown;
    queued?: unknown;
    type?: unknown;
  };
};

const sessionTokenSchema = z
  .object({
    sessionToken: z.string().trim().min(32).max(512),
  })
  .strict();

const notificationDeliveryStates = [
  'queued',
  'processed',
  'scheduled',
  'sending',
  'sent',
  'delivered',
  'deferred',
  'failed',
  'bounced',
  'dropped',
  'blocked',
  'cancelled',
  'suppressed',
  'spam_reported',
] as const;

const activeIssueStates = [
  'deferred',
  'failed',
  'bounced',
  'dropped',
  'blocked',
  'suppressed',
  'spam_reported',
] as const;

const issueStateFilterValues = [
  'active',
  'all',
  'cleared',
  ...notificationDeliveryStates,
] as const;

const channelFilterValues = ['all', 'email', 'sms', 'in_app'] as const;

const listIssuesSchema = sessionTokenSchema
  .extend({
    channel: z.enum(channelFilterValues).default('all'),
    page: z.coerce.number().int().min(1).max(500).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    search: z.string().trim().max(180).optional().transform((value) => value || undefined),
    state: z.enum(issueStateFilterValues).default('active'),
  })
  .strict();

const issueDetailSchema = sessionTokenSchema
  .extend({
    notificationEventDocumentId: z.string().trim().min(1).max(160),
  })
  .strict();

const issueActionSchema = issueDetailSchema
  .extend({
    reason: z.string().trim().min(3).max(2000),
  })
  .strict();

const validateListIssues = validateZodSchema(listIssuesSchema);
const validateIssueDetail = validateZodSchema(issueDetailSchema);
const validateIssueAction = validateZodSchema(issueActionSchema);

type ListIssuesInput = z.infer<typeof listIssuesSchema>;

const documents = (strapi: StrapiService, uid: string) =>
  strapi.documents(uid) as DocumentCollection;

const adminAuthService = (strapi: StrapiService) =>
  strapi.service('api::admin-auth.admin-auth') as unknown as AdminAuthService;

const auditEvents = (strapi: StrapiService) =>
  strapi.service('api::audit-event.audit-event') as unknown as AuditEventService;

const objectValue = (value: unknown) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const stringValue = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

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

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

const humanize = (value?: string | null) =>
  String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());

const issueClearedAt = (event: DocumentRecord) => {
  if (typeof event.issueClearedAt === 'string' && event.issueClearedAt.trim()) {
    return event.issueClearedAt.trim();
  }

  const metadata = objectValue(event.metadata);
  const value = metadata.issueClearedAt || metadata.recipientEmailIssueClearedAt;

  return typeof value === 'string' && value.trim() ? value.trim() : null;
};

const hasIssueBeenCleared = (event: DocumentRecord) => Boolean(issueClearedAt(event));

const assertSuperAdminSession = async (
  strapi: StrapiService,
  sessionToken: string,
  context: RequestContext
) => {
  const session = await adminAuthService(strapi).getSession({ sessionToken }, context);

  if (!session.user.roleKeys.includes('super_admin')) {
    throw new ForbiddenError('Super Admin access is required.');
  }

  return session;
};

const safeProviderDelivery = (value: unknown) => {
  const delivery = objectValue(value);

  if (!Object.keys(delivery).length) {
    return null;
  }

  return {
    deliveryState: stringValue(delivery.deliveryState),
    event: stringValue(delivery.event),
    notificationServiceJobId: stringValue(delivery.notificationServiceJobId),
    occurredAt: stringValue(delivery.occurredAt),
    provider: stringValue(delivery.provider),
    providerEventId: stringValue(delivery.providerEventId),
    providerMessageId: stringValue(delivery.providerMessageId),
    reason: stringValue(delivery.reason),
    source: stringValue(delivery.source),
  };
};

const safeProviderHistory = (value: unknown) =>
  Array.isArray(value)
    ? value.map(safeProviderDelivery).filter((entry): entry is NonNullable<ReturnType<typeof safeProviderDelivery>> =>
        Boolean(entry)
      )
    : [];

const dashboardUrlFor = (event: DocumentRecord) => {
  const recipientType = String(event.recipientType || '');
  const relatedType = String(event.relatedType || '');

  if (recipientType === 'employer_contact' || relatedType.includes('employer')) {
    return trimTrailingSlash(process.env.EMPLOYER_DASHBOARD_BASE_URL || 'http://localhost:3004');
  }

  return trimTrailingSlash(process.env.CANDIDATE_DASHBOARD_BASE_URL || 'http://localhost:3001');
};

const recipientProfilePath = (event: DocumentRecord) => {
  if (event.recipientType === 'candidate') {
    const documentId = stringValue(event.recipientId) || getDocumentId(event.candidate);

    return documentId ? `/candidates/${encodeURIComponent(documentId)}` : null;
  }

  if (event.employer) {
    const documentId = getDocumentId(event.employer);

    return documentId ? `/employers/${encodeURIComponent(documentId)}` : null;
  }

  return null;
};

const relatedPath = (event: DocumentRecord) => {
  const relatedType = String(event.relatedType || '');
  const relatedId = stringValue(event.relatedId);

  if (relatedType === 'candidate' && relatedId) {
    return `/candidates/${encodeURIComponent(relatedId)}`;
  }

  if (relatedType === 'employer' && relatedId) {
    return `/employers/${encodeURIComponent(relatedId)}`;
  }

  if (relatedType === 'support_case' && relatedId) {
    return `/support/${encodeURIComponent(relatedId)}`;
  }

  if (relatedType === 'refund' && relatedId) {
    return `/refunds/${encodeURIComponent(relatedId)}`;
  }

  return null;
};

const securityResendKeywords = [
  '2fa',
  'otp',
  'password',
  'reset',
  'security',
  'admin.auth',
  'admin_auth',
  'staff',
  'login',
  'signin',
  'sign_in',
];

const resendCapability = (event: DocumentRecord) => {
  if (event.channel !== 'email') {
    return {
      canResend: false,
      reason: 'Only email notification issues can be resent from this view.',
    };
  }

  if (!stringValue(event.recipientEmail)) {
    return {
      canResend: false,
      reason: 'No recipient email is recorded for this notification event.',
    };
  }

  if (event.recipientType === 'admin') {
    return {
      canResend: false,
      reason: 'Admin and security emails cannot be resent from Notification Issues.',
    };
  }

  const haystack = [
    event.eventType,
    event.templateKey,
    event.relatedType,
    event.recipientType,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (securityResendKeywords.some((keyword) => haystack.includes(keyword))) {
    return {
      canResend: false,
      reason: 'Security, sign-in, password, OTP, and staff emails cannot be resent.',
    };
  }

  if (!activeIssueStates.includes(event.deliveryState as (typeof activeIssueStates)[number])) {
    return {
      canResend: false,
      reason: 'Only active delivery issues can be resent.',
    };
  }

  return {
    canResend: true,
    reason: null,
  };
};

const publicIssue = (event: DocumentRecord) => {
  const metadata = objectValue(event.metadata);
  const providerDelivery = safeProviderDelivery(metadata.providerDelivery);
  const providerDeliveryHistory = safeProviderHistory(metadata.providerDeliveryHistory);
  const resend = resendCapability(event);

  return {
    canClearRecipientEmailIssue:
      event.channel === 'email' &&
      ['candidate', 'employer_contact'].includes(String(event.recipientType || '')),
    canResend: resend.canResend,
    channel: event.channel || null,
    clearedAt: issueClearedAt(event),
    clearedByEmail:
      stringValue(event.issueClearedByEmail) ||
      stringValue(metadata.issueClearedByEmail || metadata.recipientEmailIssueClearedByEmail),
    createdAt: event.createdAt || null,
    deliveredAt: event.deliveredAt || null,
    deliveryState: event.deliveryState || null,
    documentId: getDocumentId(event) || null,
    errorMessage: event.errorMessage || null,
    eventType: event.eventType || null,
    failedAt: event.failedAt || null,
    metadataSummary: {
      notificationServiceJobId: stringValue(metadata.notificationServiceJobId),
      originalNotificationEventDocumentId: stringValue(metadata.originalNotificationEventDocumentId),
      resendOfNotificationEventDocumentId: stringValue(metadata.resendOfNotificationEventDocumentId),
    },
    priority: event.priority || null,
    profilePath: recipientProfilePath(event),
    provider: event.provider || providerDelivery?.provider || null,
    providerDelivery,
    providerDeliveryHistory,
    providerMessageId: event.providerMessageId || providerDelivery?.providerMessageId || null,
    recipientEmail: event.recipientEmail || null,
    recipientId: event.recipientId || null,
    recipientPhone: event.recipientPhone || null,
    recipientType: event.recipientType || null,
    relatedId: event.relatedId || null,
    relatedPath: relatedPath(event),
    relatedType: event.relatedType || null,
    resendDisabledReason: resend.reason,
    scheduledAt: event.scheduledAt || null,
    sentAt: event.sentAt || null,
    templateKey: event.templateKey || null,
    updatedAt: event.updatedAt || null,
  };
};

const issueListFilters = (body: ListIssuesInput) => {
  const filters: Record<string, unknown> = {};

  if (body.state === 'active') {
    filters.deliveryState = { $in: activeIssueStates };
    filters.issueClearedAt = { $null: true };
  } else if (body.state === 'cleared') {
    filters.deliveryState = { $in: activeIssueStates };
    filters.issueClearedAt = { $notNull: true };
  } else if (
    body.state !== 'all' &&
    notificationDeliveryStates.includes(body.state as (typeof notificationDeliveryStates)[number])
  ) {
    filters.deliveryState = body.state;
  }

  if (body.channel !== 'all') {
    filters.channel = body.channel;
  }

  if (body.search) {
    const search = body.search;

    filters.$or = [
      { documentId: { $containsi: search } },
      { errorMessage: { $containsi: search } },
      { eventType: { $containsi: search } },
      { provider: { $containsi: search } },
      { providerMessageId: { $containsi: search } },
      { recipientEmail: { $containsi: search } },
      { recipientId: { $containsi: search } },
      { recipientPhone: { $containsi: search } },
      { recipientType: { $containsi: search } },
      { relatedId: { $containsi: search } },
      { relatedType: { $containsi: search } },
      { templateKey: { $containsi: search } },
    ];
  }

  return filters;
};

const fetchIssue = async (strapi: StrapiService, notificationEventDocumentId: string) => {
  const [event] = await documents(strapi, 'api::notification-event.notification-event').findMany({
    filters: {
      documentId: notificationEventDocumentId,
    },
    limit: 1,
    populate: ['candidate', 'employer', 'interview', 'payment', 'refund'],
  });

  if (!event?.documentId) {
    throw new ValidationError('Notification issue could not be found.');
  }

  return event;
};

const requestNotificationServiceEmail = async ({
  correlationId,
  subject,
  template,
  text,
  to,
  type,
}: {
  correlationId?: string;
  subject: string;
  template?: {
    key: string;
    variables?: Record<string, unknown>;
  };
  text: string;
  to: string;
  type: string;
}): Promise<NotificationServiceQueueResponse | undefined> => {
  const baseUrl = process.env.NOTIFICATION_SERVICE_URL;
  const serviceToken = process.env.NOTIFICATION_SERVICE_TOKEN;

  if (!baseUrl || !serviceToken) {
    return undefined;
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Number(process.env.NOTIFICATION_SERVICE_TIMEOUT_MS || 5000)
  );

  try {
    const response = await fetch(`${trimTrailingSlash(baseUrl)}/api/internal/notifications/email`, {
      body: JSON.stringify({
        correlationId,
        priority: 'transactional',
        source: 'core-api',
        subject,
        template,
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
      return undefined;
    }

    return payload;
  } finally {
    clearTimeout(timeout);
  }
};

const recordAudit = (
  strapi: StrapiService,
  session: AdminSession,
  event: DocumentRecord,
  eventType: string,
  requestContext: RequestContext,
  payload: {
    metadata?: Record<string, unknown>;
    newState?: unknown;
    previousState?: unknown;
    severity?: 'info' | 'warning' | 'error' | 'critical';
  } = {}
) =>
  auditEvents(strapi).record({
    actorDisplayName: session.user.displayName,
    actorEmail: session.user.email,
    actorId: session.user.id,
    actorType: 'admin',
    eventCategory: 'notification',
    eventType,
    ipAddress: requestContext.ipAddress,
    metadata: payload.metadata,
    newState: payload.newState,
    occurredAt: new Date().toISOString(),
    previousState: payload.previousState,
    requestId: requestContext.requestId,
    severity: payload.severity || 'info',
    source: 'admin_dashboard',
    subjectDisplayName: event.eventType || event.templateKey || getDocumentId(event),
    subjectId: getDocumentId(event),
    subjectType: 'notification_event',
    userAgent: requestContext.userAgent,
  });

const createLinkedResendEvent = async ({
  errorMessage,
  event,
  jobId,
  reason,
  session,
  strapi,
}: {
  errorMessage?: string;
  event: DocumentRecord;
  jobId?: unknown;
  reason: string;
  session: AdminSession;
  strapi: StrapiService;
}) =>
  documents(strapi, 'api::notification-event.notification-event').create({
    data: {
      candidate: relationConnect(event.candidate),
      channel: 'email',
      deliveryState: jobId ? 'queued' : 'failed',
      employer: relationConnect(event.employer),
      errorMessage: jobId ? null : errorMessage || 'Notification service did not queue the resend email.',
      eventType: 'notification_issue_resend',
      interview: relationConnect(event.interview),
      metadata: {
        notificationServiceJobId: typeof jobId === 'undefined' ? null : String(jobId),
        originalDeliveryState: event.deliveryState || null,
        originalEventType: event.eventType || null,
        originalNotificationEventDocumentId: getDocumentId(event),
        originalProviderMessageId: event.providerMessageId || null,
        originalTemplateKey: event.templateKey || null,
        requestId: null,
        resendReason: reason,
        resentByStaffEmail: session.user.email,
        resentByStaffUserId: session.user.id,
      },
      payment: relationConnect(event.payment),
      priority: event.priority || 'normal',
      recipientEmail: event.recipientEmail,
      recipientId: event.recipientId,
      recipientPhone: event.recipientPhone,
      recipientType: event.recipientType,
      refund: relationConnect(event.refund),
      relatedId: event.relatedId,
      relatedType: event.relatedType,
      templateKey: 'generic_branded_message',
    },
  });

const updateOriginalResendHistory = async ({
  event,
  reason,
  resendEvent,
  session,
  strapi,
}: {
  event: DocumentRecord;
  reason: string;
  resendEvent: DocumentRecord;
  session: AdminSession;
  strapi: StrapiService;
}) => {
  const metadata = objectValue(event.metadata);
  const resendHistory = Array.isArray(metadata.resendHistory)
    ? metadata.resendHistory.slice(-9)
    : [];
  const now = new Date().toISOString();

  return documents(strapi, 'api::notification-event.notification-event').update({
    documentId: getDocumentId(event),
    data: {
      metadata: {
        ...metadata,
        lastResendReason: reason,
        lastResentAt: now,
        lastResentByStaffEmail: session.user.email,
        lastResentNotificationEventDocumentId: getDocumentId(resendEvent),
        resendHistory: [
          ...resendHistory,
          {
            reason,
            resentAt: now,
            resentByStaffEmail: session.user.email,
            resentNotificationEventDocumentId: getDocumentId(resendEvent),
          },
        ],
      },
    },
  });
};

const recipientLookup = (event: DocumentRecord) => {
  if (event.recipientType === 'candidate') {
    return {
      documentId: stringValue(event.recipientId) || getDocumentId(event.candidate),
      uid: 'api::candidate.candidate',
    };
  }

  if (event.recipientType === 'employer_contact') {
    return {
      documentId: stringValue(event.recipientId),
      uid: 'api::employer-contact.employer-contact',
    };
  }

  return {
    documentId: null,
    uid: null,
  };
};

const clearRecipientEmailIssue = async ({
  event,
  reason,
  session,
  strapi,
}: {
  event: DocumentRecord;
  reason: string;
  session: AdminSession;
  strapi: StrapiService;
}) => {
  const lookup = recipientLookup(event);

  if (!lookup.uid || !lookup.documentId) {
    throw new ValidationError('No candidate or employer contact is linked to this notification event.');
  }

  const [recipient] = await documents(strapi, lookup.uid).findMany({
    filters: {
      documentId: lookup.documentId,
    },
    limit: 1,
  });

  if (!recipient?.documentId) {
    throw new ValidationError('Linked notification recipient could not be found.');
  }

  const preferences = objectValue(recipient.notificationPreferences);
  const { emailDeliveryIssue: _emailDeliveryIssue, ...nextPreferences } = preferences;

  await documents(strapi, lookup.uid).update({
    documentId: recipient.documentId,
    data: {
      notificationPreferences: {
        ...nextPreferences,
        emailDeliveryIssueClearedAt: new Date().toISOString(),
        emailDeliveryIssueClearedByStaffEmail: session.user.email,
        emailDeliveryIssueClearReason: reason,
      },
    },
  });
};

const markIssueCleared = async ({
  event,
  reason,
  session,
  strapi,
}: {
  event: DocumentRecord;
  reason: string;
  session: AdminSession;
  strapi: StrapiService;
}) => {
  const metadata = objectValue(event.metadata);
  const now = new Date().toISOString();

  return documents(strapi, 'api::notification-event.notification-event').update({
    documentId: getDocumentId(event),
    data: {
      issueClearedAt: now,
      issueClearedByEmail: session.user.email,
      issueClearReason: reason,
      metadata: {
        ...metadata,
        issueClearedAt: now,
        issueClearedByStaffEmail: session.user.email,
        issueClearedByStaffUserId: session.user.id,
        issueClearReason: reason,
        recipientEmailIssueClearedAt: now,
        recipientEmailIssueClearedByEmail: session.user.email,
        recipientEmailIssueClearReason: reason,
      },
    },
  });
};

const notifyTaskFeedsChanged = (strapi: StrapiService, resourceKey?: string | null) =>
  publishAdminRealtimeEvent(
    {
      channels: ['operations', 'support'],
      resourceKey: resourceKey || undefined,
      resourceType: 'notification_event',
      type: 'admin_tasks_changed',
    },
    strapi.log
  ).catch((error) => {
    strapi.log?.warn?.('Admin realtime notification change could not be published.', error);
  });

export default ({ strapi }: { strapi: StrapiService }) => ({
  async listIssues(input: unknown, requestContext: RequestContext = {}) {
    const body = validateListIssues(input);
    const session = await assertSuperAdminSession(strapi, body.sessionToken, requestContext);
    const issueDocuments = documents(strapi, 'api::notification-event.notification-event');
    const filters = issueListFilters(body);
    const [filteredTotal, activeCount, clearedCount, totalCount] = await Promise.all([
      issueDocuments.count({ filters }),
      issueDocuments.count({
        filters: {
          ...(body.channel !== 'all' ? { channel: body.channel } : {}),
          deliveryState: { $in: activeIssueStates },
          issueClearedAt: { $null: true },
        },
      }),
      issueDocuments.count({
        filters: {
          ...(body.channel !== 'all' ? { channel: body.channel } : {}),
          deliveryState: { $in: activeIssueStates },
          issueClearedAt: { $notNull: true },
        },
      }),
      issueDocuments.count({
        filters: {
          ...(body.channel !== 'all' ? { channel: body.channel } : {}),
        },
      }),
    ]);
    const pageCount = Math.max(1, Math.ceil(filteredTotal / body.pageSize));
    const page = Math.min(body.page, pageCount);
    const events = await issueDocuments.findMany({
      filters,
      limit: body.pageSize,
      populate: ['candidate', 'employer', 'interview', 'payment', 'refund'],
      sort: ['failedAt:desc', 'updatedAt:desc', 'createdAt:desc'],
      start: (page - 1) * body.pageSize,
    });

    return {
      counts: {
        active: activeCount,
        cleared: clearedCount,
        filtered: filteredTotal,
        total: totalCount,
      },
      filters: {
        channel: body.channel,
        page,
        pageSize: body.pageSize,
        search: body.search || null,
        state: body.state,
      },
      generatedAt: new Date().toISOString(),
      issues: events.map(publicIssue),
      pagination: {
        page,
        pageCount,
        pageSize: body.pageSize,
        total: filteredTotal,
      },
      user: session.user,
    };
  },

  async getIssue(input: unknown, requestContext: RequestContext = {}) {
    const body = validateIssueDetail(input);
    const session = await assertSuperAdminSession(strapi, body.sessionToken, requestContext);
    const event = await fetchIssue(strapi, body.notificationEventDocumentId);

    return {
      generatedAt: new Date().toISOString(),
      issue: publicIssue(event),
      user: session.user,
    };
  },

  async resendIssue(input: unknown, requestContext: RequestContext = {}) {
    const body = validateIssueAction(input);
    const session = await assertSuperAdminSession(strapi, body.sessionToken, requestContext);
    const event = await fetchIssue(strapi, body.notificationEventDocumentId);
    const capability = resendCapability(event);

    if (!capability.canResend) {
      throw new ValidationError(capability.reason || 'This notification issue cannot be resent.');
    }

    const subject = `HireFlip update: ${humanize(event.eventType || event.templateKey || 'Notification')}`;
    const dashboardUrl = dashboardUrlFor(event);
    const text = [
      'There is a HireFlip update waiting for you.',
      '',
      'Open your dashboard to review it:',
      dashboardUrl,
      '',
      'HireFlip',
    ].join('\n');
    const notificationResult = await requestNotificationServiceEmail({
      correlationId: `notification-issue-resend:${getDocumentId(event)}:${Date.now()}`,
      subject,
      template: {
        key: 'generic_branded_message',
        variables: {
          bodyLines: [
            'There is a HireFlip update waiting for you.',
            'Open your dashboard to review it.',
          ],
          ctaLabel: 'Open dashboard',
          ctaUrl: dashboardUrl,
          heading: 'HireFlip update',
          subject,
        },
      },
      text,
      to: String(event.recipientEmail),
      type: 'notification_issue_resend',
    });
    const jobId = notificationResult?.data?.jobId;
    const resendEvent = await createLinkedResendEvent({
      errorMessage: notificationResult?.data
        ? undefined
        : 'Notification service did not queue the resend email.',
      event,
      jobId,
      reason: body.reason,
      session,
      strapi,
    });
    const updatedOriginal = await updateOriginalResendHistory({
      event,
      reason: body.reason,
      resendEvent,
      session,
      strapi,
    });

    await recordAudit(strapi, session, event, 'admin.notification_issue_resend_requested', requestContext, {
      metadata: {
        reason: body.reason,
        resendNotificationEventDocumentId: getDocumentId(resendEvent),
        resendQueued: Boolean(jobId),
      },
      newState: {
        resendNotificationEventDocumentId: getDocumentId(resendEvent),
      },
    });

    await notifyTaskFeedsChanged(strapi, getDocumentId(event));

    return {
      issue: publicIssue(updatedOriginal),
      notificationQueued: Boolean(jobId),
      resendNotificationEvent: publicIssue(resendEvent),
      resent: true,
      user: session.user,
    };
  },

  async clearEmailIssue(input: unknown, requestContext: RequestContext = {}) {
    const body = validateIssueAction(input);
    const session = await assertSuperAdminSession(strapi, body.sessionToken, requestContext);
    const event = await fetchIssue(strapi, body.notificationEventDocumentId);

    if (event.channel !== 'email') {
      throw new ValidationError('Only email delivery issues can be cleared from this action.');
    }

    await clearRecipientEmailIssue({
      event,
      reason: body.reason,
      session,
      strapi,
    });
    const updatedEvent = await markIssueCleared({
      event,
      reason: body.reason,
      session,
      strapi,
    });

    await recordAudit(strapi, session, event, 'admin.notification_recipient_email_issue_cleared', requestContext, {
      metadata: {
        reason: body.reason,
        recipientEmail: event.recipientEmail || null,
        recipientId: event.recipientId || null,
        recipientType: event.recipientType || null,
      },
      newState: {
        issueClearedAt: issueClearedAt(updatedEvent),
      },
      previousState: {
        deliveryState: event.deliveryState || null,
        emailDeliveryIssue: objectValue(event.metadata).providerDelivery || null,
      },
    });

    await notifyTaskFeedsChanged(strapi, getDocumentId(event));

    return {
      cleared: true,
      issue: publicIssue(updatedEvent),
      user: session.user,
    };
  },
});

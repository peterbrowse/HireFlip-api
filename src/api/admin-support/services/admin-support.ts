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

type AdminRoleKey = 'admin' | 'sales' | 'super_admin' | 'support';

type AdminUser = Record<string, unknown> & {
  blocked?: boolean;
  email?: string;
  firstname?: string;
  id?: number | string;
  isActive?: boolean;
  lastname?: string;
  roles?: Array<Record<string, unknown>>;
  username?: string;
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

type SupportCaseService = {
  addMessage(input: unknown): Promise<unknown>;
  assignCase(input: unknown): Promise<unknown>;
  getCase(input: {
    supportCaseDocumentId: string;
  }): Promise<unknown | null>;
  listCases(input?: {
    caseState?: string;
    caseType?: string;
    limit?: number;
  }): Promise<unknown[]>;
  updateCaseState(input: unknown): Promise<unknown>;
};

type DocumentRecord = Record<string, unknown> & {
  candidate?: DocumentRecord;
  documentId?: string;
  email?: string;
  firstName?: string;
  id?: number | string;
  lastName?: string;
  metadata?: unknown;
  notificationPreferences?: unknown;
  phone?: string;
  refund?: DocumentRecord;
  title?: string;
};

type DocumentCollection = {
  create(input: Record<string, unknown>): Promise<DocumentRecord>;
  findMany(input: Record<string, unknown>): Promise<DocumentRecord[]>;
};

type StrapiQuery = {
  findMany(input: Record<string, unknown>): Promise<AdminUser[]>;
  findOne(input: Record<string, unknown>): Promise<AdminUser | null>;
};

type StrapiService = {
  db: {
    query(uid: string): StrapiQuery;
  };
  documents(uid: string): unknown;
  service(uid: string): unknown;
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

const listCasesSchema = z
  .object({
    caseState: z
      .enum(['open', 'awaiting_candidate', 'awaiting_staff', 'in_progress', 'resolved', 'closed'])
      .optional(),
    caseType: z
      .enum(['general', 'refund', 'payment', 'course', 'interview', 'account', 'privacy', 'other'])
      .optional(),
    limit: z.number().int().min(1).max(100).optional(),
    sessionToken: z.string().trim().min(32).max(512),
  })
  .strict();
const caseDetailSchema = z
  .object({
    sessionToken: z.string().trim().min(32).max(512),
    supportCaseDocumentId: z.string().trim().min(1).max(120),
  })
  .strict();
const assignableStaffSchema = z
  .object({
    sessionToken: z.string().trim().min(32).max(512),
  })
  .strict();
const assignCaseSchema = z
  .object({
    assignedTo: z
      .object({
        displayName: z.string().trim().min(1).max(240),
        email: z.string().trim().email().max(254),
        id: z.string().trim().min(1).max(160),
        roleKey: z.enum(['admin', 'sales', 'super_admin', 'support']).optional(),
      })
      .optional(),
    assignedToStaffUserId: z
      .union([z.number().int().positive(), z.string().trim().min(1).max(160)])
      .optional(),
    reviewClaimToken: z.string().trim().min(32).max(160).optional(),
    sessionToken: z.string().trim().min(32).max(512),
    supportCaseDocumentId: z.string().trim().min(1).max(120),
  })
  .strict()
  .refine((value) => Boolean(value.assignedTo || value.assignedToStaffUserId), {
    message: 'Assigned staff user is required.',
  });
const messageCaseSchema = z
  .object({
    body: z.string().trim().min(1).max(12000),
    reviewClaimToken: z.string().trim().min(32).max(160).optional(),
    sessionToken: z.string().trim().min(32).max(512),
    supportCaseDocumentId: z.string().trim().min(1).max(120),
  })
  .strict();

const validateListCases = validateZodSchema(listCasesSchema);
const validateCaseDetail = validateZodSchema(caseDetailSchema);
const validateAssignableStaff = validateZodSchema(assignableStaffSchema);
const validateAssignCase = validateZodSchema(assignCaseSchema);
const validateMessageCase = validateZodSchema(messageCaseSchema);

const adminAuthService = (strapi: StrapiService) =>
  strapi.service('api::admin-auth.admin-auth') as unknown as AdminAuthService;

const reviewClaimService = (strapi: StrapiService) =>
  strapi.service('api::admin-review-claim.admin-review-claim') as unknown as AdminReviewClaimService;

const supportCaseService = (strapi: StrapiService) =>
  strapi.service('api::support-case.support-case') as unknown as SupportCaseService;

const documents = (strapi: StrapiService, uid: string) =>
  strapi.documents(uid) as unknown as DocumentCollection;

const assignableRoleKeys = new Set<AdminRoleKey>(['admin', 'super_admin', 'support']);

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

const getIntegerEnv = (name: string, fallback: number) => {
  const parsedValue = Number.parseInt(process.env[name] || '', 10);

  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : fallback;
};

const objectValue = (value: unknown) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const normalizeRole = (value: unknown) =>
  typeof value === 'string'
    ? value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
    : '';

const roleKeyFromRole = (role: Record<string, unknown>): AdminRoleKey | undefined => {
  const name = normalizeRole(role.name);
  const code = normalizeRole(role.code);
  const type = normalizeRole(role.type);
  const values = new Set([name, code, type]);

  if (values.has('super_admin') || values.has('strapi_super_admin')) {
    return 'super_admin';
  }

  if (values.has('admin') || values.has('hireflip_admin')) {
    return 'admin';
  }

  if (values.has('sales') || values.has('hireflip_sales')) {
    return 'sales';
  }

  if (values.has('support') || values.has('hireflip_support')) {
    return 'support';
  }

  return undefined;
};

const roleLabel = (roleKey: AdminRoleKey) => {
  if (roleKey === 'super_admin') {
    return 'Super Admin';
  }

  return `${roleKey.charAt(0).toUpperCase()}${roleKey.slice(1)}`;
};

const staffDisplayName = (user: AdminUser) => {
  const firstName = typeof user.firstname === 'string' ? user.firstname.trim() : '';
  const lastName = typeof user.lastname === 'string' ? user.lastname.trim() : '';
  const fullName = `${firstName} ${lastName}`.trim();

  return fullName || String(user.username || user.email || 'Staff user');
};

const assignableStaffPayload = (user: AdminUser) => {
  if (!user.id || !user.email || !user.isActive || user.blocked) {
    return null;
  }

  const roleKeys = Array.from(
    new Set((user.roles || []).map(roleKeyFromRole).filter(Boolean) as AdminRoleKey[])
  );
  const primaryAssignableRole = roleKeys.find((roleKey) => assignableRoleKeys.has(roleKey));

  if (!primaryAssignableRole) {
    return null;
  }

  return {
    displayName: staffDisplayName(user),
    email: user.email,
    id: String(user.id),
    roleKey: primaryAssignableRole,
    roleKeys,
    roles: roleKeys.map(roleLabel),
  };
};

const compareStaffUsers = (
  left: NonNullable<ReturnType<typeof assignableStaffPayload>>,
  right: NonNullable<ReturnType<typeof assignableStaffPayload>>
) => {
  const collator = new Intl.Collator('en-GB', {
    numeric: true,
    sensitivity: 'base',
  });

  return collator.compare(left.displayName || left.email, right.displayName || right.email);
};

const listAssignableStaffUsers = async (strapi: StrapiService) => {
  const users = await strapi.db.query('admin::user').findMany({
    orderBy: [
      {
        firstname: 'asc',
      },
      {
        lastname: 'asc',
      },
      {
        email: 'asc',
      },
    ],
    populate: ['roles'],
    where: {
      blocked: false,
      isActive: true,
    },
  });

  return users
    .map(assignableStaffPayload)
    .filter((user): user is NonNullable<ReturnType<typeof assignableStaffPayload>> =>
      Boolean(user)
    )
    .sort(compareStaffUsers);
};

const findAssignableStaffUser = async (strapi: StrapiService, staffUserId: string | number) => {
  const user = await strapi.db.query('admin::user').findOne({
    populate: ['roles'],
    where: {
      id: staffUserId,
    },
  });

  return user ? assignableStaffPayload(user) : null;
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

const candidateFirstName = (candidate?: DocumentRecord | null) => {
  if (typeof candidate?.firstName === 'string' && candidate.firstName.trim()) {
    return candidate.firstName.trim();
  }

  return 'there';
};

const supportCaseUrl = (supportCaseDocumentId: string) =>
  `${trimTrailingSlash(process.env.CANDIDATE_DASHBOARD_BASE_URL || 'http://localhost:3001')}/support/${encodeURIComponent(supportCaseDocumentId)}`;

const requestNotificationServiceEmail = async ({
  correlationId,
  html,
  subject,
  template,
  text,
  to,
  type,
}: {
  correlationId?: string;
  html?: string;
  subject?: string;
  template?: NotificationTemplatePayload;
  text?: string;
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
    getIntegerEnv('NOTIFICATION_SERVICE_TIMEOUT_MS', 5000)
  );

  try {
    const response = await fetch(`${trimTrailingSlash(baseUrl)}/api/internal/notifications/email`, {
      body: JSON.stringify({
        correlationId,
        ...(html ? { html } : {}),
        priority: 'transactional',
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
      return undefined;
    }

    return payload;
  } finally {
    clearTimeout(timeout);
  }
};

const requestNotificationServiceSms = async ({
  body,
  correlationId,
  to,
  type,
}: {
  body: string;
  correlationId?: string;
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
    getIntegerEnv('NOTIFICATION_SERVICE_TIMEOUT_MS', 5000)
  );

  try {
    const response = await fetch(`${trimTrailingSlash(baseUrl)}/api/internal/notifications/sms`, {
      body: JSON.stringify({
        body,
        correlationId,
        priority: 'transactional',
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

const findSupportCaseRecord = async (strapi: StrapiService, supportCaseDocumentId: string) => {
  const cases = await documents(strapi, 'api::support-case.support-case').findMany({
    filters: {
      documentId: supportCaseDocumentId,
    },
    limit: 1,
    populate: ['candidate', 'refund', 'payment', 'enrollment'],
  });

  return cases[0];
};

const buildSupportCasePrompt = (supportCase: DocumentRecord) => {
  const url = supportCaseUrl(String(supportCase.documentId));
  const name = candidateFirstName(supportCase.candidate);
  const isRefundCase = supportCase.refund || supportCase.title?.toLowerCase().includes('refund');
  const requestLabel = isRefundCase ? 'refund request' : 'support request';

  return {
    candidateFirstName: name,
    requestLabel,
    sms: `HireFlip: there is a new reply to your ${requestLabel}. Open your dashboard to view and reply: ${url}`,
    url,
  };
};

const queueCandidateSupportPrompt = async ({
  requestContext,
  strapi,
  supportCase,
}: {
  requestContext: RequestContext;
  strapi: StrapiService;
  supportCase: DocumentRecord;
}) => {
  const candidate = supportCase.candidate;
  const candidateDocumentId = getDocumentId(candidate);
  const supportCaseDocumentId = getDocumentId(supportCase);

  if (!candidateDocumentId || !supportCaseDocumentId) {
    return {
      emailQueued: false,
      smsQueued: false,
    };
  }

  const notificationPreferences = objectValue(candidate?.notificationPreferences);
  const channelPreferences = objectValue(notificationPreferences.channels);
  const content = buildSupportCasePrompt(supportCase);
  const emailAllowed = candidate?.email && channelPreferences.email !== false;
  const smsAllowed = candidate?.phone && channelPreferences.sms === true;
  const emailQueueResult =
    emailAllowed && typeof candidate.email === 'string'
      ? await requestNotificationServiceEmail({
          correlationId: supportCaseDocumentId,
          template: {
            key: 'candidate_support_case_updated',
            variables: {
              candidateFirstName: content.candidateFirstName,
              requestLabel: content.requestLabel,
              supportCaseUrl: content.url,
            },
          },
          to: candidate.email,
          type: 'candidate_support_case_updated',
        })
      : undefined;
  const smsQueueResult =
    smsAllowed && typeof candidate.phone === 'string'
      ? await requestNotificationServiceSms({
          body: content.sms,
          correlationId: supportCaseDocumentId,
          to: candidate.phone,
          type: 'candidate_support_case_updated',
        })
      : undefined;
  const channels = [
    {
      channel: 'in_app',
      deliveryState: 'queued',
      jobId: undefined,
      recipientPhone: undefined,
    },
    ...(emailAllowed
      ? [
          {
            channel: 'email',
            deliveryState: emailQueueResult?.data?.queued === true ? 'queued' : 'failed',
            jobId: emailQueueResult?.data?.jobId,
            recipientPhone: undefined,
          },
        ]
      : []),
    ...(smsAllowed
      ? [
          {
            channel: 'sms',
            deliveryState: smsQueueResult?.data?.queued === true ? 'queued' : 'failed',
            jobId: smsQueueResult?.data?.jobId,
            recipientPhone: candidate.phone,
          },
        ]
      : []),
  ];

  await Promise.all(
    channels.map(({ channel, deliveryState, jobId, recipientPhone }) =>
      documents(strapi, 'api::notification-event.notification-event').create({
        data: {
          candidate: {
            connect: [{ documentId: candidateDocumentId }],
          },
          channel,
          eventType: 'candidate.support_case_updated',
          metadata: {
            notificationServiceJobId: typeof jobId === 'string' ? jobId : undefined,
            requestId: requestContext.requestId,
            supportCaseDocumentId,
            url: content.url,
          },
          priority: 'normal',
          recipientEmail: candidate.email,
          recipientId: candidateDocumentId,
          recipientPhone,
          recipientType: 'candidate',
          relatedId: supportCaseDocumentId,
          relatedType: 'support_case',
          deliveryState,
          templateKey: 'candidate_support_case_updated',
        },
      })
    )
  );

  return {
    emailQueued: emailQueueResult?.data?.queued === true,
    smsQueued: smsQueueResult?.data?.queued === true,
  };
};

const assertSupportSession = async (
  strapi: StrapiService,
  sessionToken: string,
  requestContext: RequestContext
) => {
  const session = await adminAuthService(strapi).getSession({ sessionToken }, requestContext);
  const canViewSupport = session.user.roleKeys.some((roleKey) =>
    ['admin', 'super_admin', 'support'].includes(roleKey)
  );

  if (!canViewSupport) {
    throw new ForbiddenError('Admin or Support access is required.');
  }

  return session;
};

const publishSupportChange = (strapi: StrapiService, supportCaseDocumentId?: string) =>
  publishAdminRealtimeEvent(
    {
      channels: ['support'],
      resourceKey: supportCaseDocumentId,
      resourceType: 'support_case',
      type: 'support_cases_changed',
    },
    (strapi as { log?: { error?: (message: string, error?: unknown) => void } }).log
  );

export default ({ strapi }: { strapi: StrapiService }) => ({
  async listAssignableStaff(input: unknown, requestContext: RequestContext = {}) {
    const body = validateAssignableStaff(input);
    const session = await assertSupportSession(strapi, body.sessionToken, requestContext);
    const staffUsers = await listAssignableStaffUsers(strapi);

    return {
      counts: {
        total: staffUsers.length,
      },
      generatedAt: new Date().toISOString(),
      staffUsers,
      user: session.user,
    };
  },

  async listCases(input: unknown, requestContext: RequestContext = {}) {
    const body = validateListCases(input);
    const session = await assertSupportSession(strapi, body.sessionToken, requestContext);
    const cases = await supportCaseService(strapi).listCases({
      ...(body.caseState ? { caseState: body.caseState } : {}),
      ...(body.caseType ? { caseType: body.caseType } : {}),
      ...(body.limit ? { limit: body.limit } : {}),
    });

    return {
      cases,
      counts: {
        total: cases.length,
      },
      generatedAt: new Date().toISOString(),
      user: session.user,
    };
  },

  async getCase(input: unknown, requestContext: RequestContext = {}) {
    const body = validateCaseDetail(input);
    const session = await assertSupportSession(strapi, body.sessionToken, requestContext);
    const supportCase = await supportCaseService(strapi).getCase({
      supportCaseDocumentId: body.supportCaseDocumentId,
    });
    const claimResult = supportCase
      ? await reviewClaimService(strapi).claimForSession(
          {
            resourceDocumentId: body.supportCaseDocumentId,
            resourceKey: body.supportCaseDocumentId,
            resourceLabel:
              typeof (supportCase as DocumentRecord).title === 'string'
                ? (supportCase as DocumentRecord).title
                : 'Support case',
            resourceType: 'support_case',
          },
          session,
          requestContext
        )
      : { reviewClaim: null };

    return {
      generatedAt: new Date().toISOString(),
      reviewClaim: claimResult.reviewClaim,
      supportCase,
      user: session.user,
    };
  },

  async assignCase(input: unknown, requestContext: RequestContext = {}) {
    const body = validateAssignCase(input);
    const session = await assertSupportSession(strapi, body.sessionToken, requestContext);
    const supportCaseRecord = await findSupportCaseRecord(strapi, body.supportCaseDocumentId);
    const assignedTo = body.assignedTo || (body.assignedToStaffUserId
      ? await findAssignableStaffUser(strapi, body.assignedToStaffUserId)
      : null);

    if (!supportCaseRecord) {
      throw new ValidationError('Support case could not be found.');
    }

    if (!assignedTo) {
      throw new ValidationError('Assigned staff user could not be found.');
    }

    if (assignedTo.roleKey && !assignableRoleKeys.has(assignedTo.roleKey)) {
      throw new ValidationError('Assigned staff user cannot own support cases.');
    }

    await reviewClaimService(strapi).assertActiveClaimForSession(
      {
        claimToken: body.reviewClaimToken,
        resourceDocumentId: body.supportCaseDocumentId,
        resourceKey: body.supportCaseDocumentId,
        resourceLabel: supportCaseRecord.title,
        resourceType: 'support_case',
      },
      session
    );

    const supportCase = await supportCaseService(strapi).assignCase({
      assignedTo,
      metadata: {
        assignedByAdminEmail: session.user.email,
        assignedByAdminId: session.user.id,
      },
      supportCase: supportCaseRecord,
    });
    await publishSupportChange(strapi, body.supportCaseDocumentId);

    return {
      assigned: true,
      supportCase,
      user: session.user,
    };
  },

  async replyToCase(input: unknown, requestContext: RequestContext = {}) {
    const body = validateMessageCase(input);
    const session = await assertSupportSession(strapi, body.sessionToken, requestContext);
    const supportCaseRecord = await findSupportCaseRecord(strapi, body.supportCaseDocumentId);

    if (!supportCaseRecord) {
      throw new ForbiddenError('Support case could not be found.');
    }

    await reviewClaimService(strapi).assertActiveClaimForSession(
      {
        claimToken: body.reviewClaimToken,
        resourceDocumentId: body.supportCaseDocumentId,
        resourceKey: body.supportCaseDocumentId,
        resourceLabel: supportCaseRecord.title,
        resourceType: 'support_case',
      },
      session
    );

    const notificationResult = await queueCandidateSupportPrompt({
      requestContext,
      strapi,
      supportCase: supportCaseRecord,
    });
    await supportCaseService(strapi).addMessage({
      body: body.body,
      candidate: supportCaseRecord.candidate,
      deliveryState:
        notificationResult.emailQueued || notificationResult.smsQueued ? 'queued' : 'not_required',
      direction: 'outbound',
      messageType: 'staff_reply',
      metadata: {
        candidateDashboardUrl: supportCaseUrl(body.supportCaseDocumentId),
        notificationPromptQueued:
          notificationResult.emailQueued || notificationResult.smsQueued,
        notificationPromptChannels: {
          email: notificationResult.emailQueued,
          sms: notificationResult.smsQueued,
        },
      },
      refund: supportCaseRecord.refund,
      sender: {
        displayName: session.user.displayName,
        email: session.user.email,
        id: session.user.id,
        type: 'admin',
      },
      supportCase: {
        documentId: body.supportCaseDocumentId,
      },
      visibility: 'public',
    });
    await supportCaseService(strapi).updateCaseState({
      caseState: 'awaiting_candidate',
      metadata: {
        lastStaffReplyAt: new Date().toISOString(),
      },
      supportCase: {
        documentId: body.supportCaseDocumentId,
      },
    });
    const supportCase = await supportCaseService(strapi).getCase({
      supportCaseDocumentId: body.supportCaseDocumentId,
    });
    await publishSupportChange(strapi, body.supportCaseDocumentId);

    return {
      notificationQueued: notificationResult.emailQueued || notificationResult.smsQueued,
      replied: true,
      supportCase,
      user: session.user,
    };
  },

  async addInternalNote(input: unknown, requestContext: RequestContext = {}) {
    const body = validateMessageCase(input);
    const session = await assertSupportSession(strapi, body.sessionToken, requestContext);
    const supportCaseRecord = await findSupportCaseRecord(strapi, body.supportCaseDocumentId);

    if (!supportCaseRecord) {
      throw new ForbiddenError('Support case could not be found.');
    }

    await reviewClaimService(strapi).assertActiveClaimForSession(
      {
        claimToken: body.reviewClaimToken,
        resourceDocumentId: body.supportCaseDocumentId,
        resourceKey: body.supportCaseDocumentId,
        resourceLabel: supportCaseRecord.title,
        resourceType: 'support_case',
      },
      session
    );

    await supportCaseService(strapi).addMessage({
      body: body.body,
      candidate: supportCaseRecord.candidate,
      direction: 'internal',
      messageType: 'staff_note',
      refund: supportCaseRecord.refund,
      sender: {
        displayName: session.user.displayName,
        email: session.user.email,
        id: session.user.id,
        type: 'admin',
      },
      supportCase: {
        documentId: body.supportCaseDocumentId,
      },
      visibility: 'internal',
    });
    const supportCase = await supportCaseService(strapi).getCase({
      supportCaseDocumentId: body.supportCaseDocumentId,
    });
    await publishSupportChange(strapi, body.supportCaseDocumentId);

    return {
      noted: true,
      supportCase,
      user: session.user,
    };
  },
});

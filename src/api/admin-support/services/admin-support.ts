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
  employer?: DocumentRecord;
  employerContact?: DocumentRecord;
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
  update(input: Record<string, unknown>): Promise<DocumentRecord>;
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
const generatedReportSchema = z
  .object({
    conclusion: z.string().trim().min(1).max(5000),
    improvements: z.string().trim().min(1).max(6000),
    intro: z.string().trim().min(1).max(5000),
    strengths: z.string().trim().min(1).max(6000),
    takeaways: z.array(z.string().trim().min(1).max(500)).length(3),
  })
  .strict();
const feedbackReportConcernActionSchema = z
  .object({
    action: z.enum(['dismiss', 'edit_approve', 'regenerate']),
    report: generatedReportSchema.optional(),
    resolutionNote: z.string().trim().max(4000).optional(),
    reviewClaimToken: z.string().trim().min(32).max(160).optional(),
    sessionToken: z.string().trim().min(32).max(512),
    supportCaseDocumentId: z.string().trim().min(1).max(120),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.action === 'edit_approve' && !value.report) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Edited report is required.',
        path: ['report'],
      });
    }
  });
const aiFeedbackReportResponseSchema = z
  .object({
    data: z.object({
      metadata: z.record(z.string(), z.unknown()).optional(),
      model: z.string().min(1),
      promptVersion: z.string().min(1),
      provider: z.string().min(1),
      report: generatedReportSchema,
    }),
  })
  .strict();

const validateListCases = validateZodSchema(listCasesSchema);
const validateCaseDetail = validateZodSchema(caseDetailSchema);
const validateAssignableStaff = validateZodSchema(assignableStaffSchema);
const validateAssignCase = validateZodSchema(assignCaseSchema);
const validateMessageCase = validateZodSchema(messageCaseSchema);
const validateFeedbackReportConcernAction = validateZodSchema(feedbackReportConcernActionSchema);

type AiFeedbackReportResponse = z.infer<typeof aiFeedbackReportResponseSchema>['data'];

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

const relationConnect = (record?: DocumentRecord | null) =>
  getDocumentId(record) ? { connect: [{ documentId: getDocumentId(record) }] } : undefined;

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

const requestAiFeedbackReport = async ({
  correlationId,
  payload,
}: {
  correlationId?: string;
  payload: Record<string, unknown>;
}): Promise<AiFeedbackReportResponse | undefined> => {
  const baseUrl = process.env.AI_SERVICE_URL;
  const serviceToken = process.env.AI_SERVICE_TOKEN;

  if (!baseUrl || !serviceToken) {
    return undefined;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getIntegerEnv('AI_SERVICE_TIMEOUT_MS', 30000));

  try {
    const response = await fetch(`${trimTrailingSlash(baseUrl)}/api/internal/feedback-reports/generate`, {
      body: JSON.stringify({
        ...payload,
        ...(correlationId ? { correlationId } : {}),
      }),
      headers: {
        'content-type': 'application/json',
        'x-hireflip-service-name': 'core-api',
        'x-hireflip-service-token': serviceToken,
      },
      method: 'POST',
      signal: controller.signal,
    });
    const responseBody = await response.json().catch(() => null);
    const parsed = aiFeedbackReportResponseSchema.safeParse(responseBody);

    if (!response.ok || !parsed.success) {
      throw new ValidationError('AI service could not generate a valid feedback report.');
    }

    return parsed.data.data;
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

const stringValue = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);

const normalizeCandidateReportTakeaways = (value: unknown) =>
  (Array.isArray(value) ? value : [])
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .slice(0, 3);

const findFeedbackReportForConcernCase = async (
  strapi: StrapiService,
  supportCase: DocumentRecord
) => {
  const metadata = objectValue(supportCase.metadata);
  const feedbackDocumentId = stringValue(metadata.feedbackDocumentId);

  if (!feedbackDocumentId) {
    return null;
  }

  const feedbackRecords = await documents(strapi, 'api::interview-feedback.interview-feedback').findMany({
    filters: {
      documentId: feedbackDocumentId,
    },
    limit: 1,
    populate: ['candidateReportConcernSupportCase', 'interview'],
  });

  return feedbackRecords[0] || null;
};

const findInterviewForFeedbackReport = async (strapi: StrapiService, feedback: DocumentRecord) => {
  const interviewDocumentId = getDocumentId(feedback.interview as DocumentRecord);

  if (!interviewDocumentId) {
    return null;
  }

  const interviews = await documents(strapi, 'api::interview.interview').findMany({
    filters: {
      documentId: interviewDocumentId,
    },
    limit: 1,
    populate: ['candidate', 'employer', 'employerContact'],
  });

  return interviews[0] || null;
};

const findRawFeedbackForInterview = async (strapi: StrapiService, interviewDocumentId?: string) => {
  if (!interviewDocumentId) {
    return [];
  }

  return documents(strapi, 'api::interview-feedback.interview-feedback').findMany({
    filters: {
      interview: {
        documentId: interviewDocumentId,
      },
      submittedByType: {
        $in: ['employer_contact', 'external_interviewer'],
      },
    },
    limit: 20,
    populate: ['feedbackInvite', 'interview'],
    sort: ['submittedAt:asc', 'createdAt:asc'],
  });
};

const feedbackSourcePayload = (feedback: DocumentRecord) => ({
  concerns: stringValue(feedback.concerns) || 'No concerns were recorded by this interviewer.',
  feedbackDocumentId: getDocumentId(feedback) || 'unknown',
  nextStep: stringValue(feedback.nextStep) || 'No next step was recorded by this interviewer.',
  notes: stringValue(feedback.notes) || 'No general notes were recorded by this interviewer.',
  outcome: stringValue(feedback.outcome) || 'unknown',
  previousTakeawayAssessment: stringValue(feedback.previousTakeawayAssessment),
  rating: typeof feedback.rating === 'number' ? feedback.rating : null,
  sourceType:
    feedback.submittedByType === 'external_interviewer'
      ? 'external_interviewer'
      : 'employer_contact',
  strengths: stringValue(feedback.strengths) || 'No strengths were recorded by this interviewer.',
  submittedAt: stringValue(feedback.submittedAt || feedback.createdAt),
  submitterDisplayName: stringValue(feedback.submitterDisplayName || feedback.senderDisplayName),
  submitterRoleTitle: stringValue(feedback.submitterRoleTitle),
});

const publicRawFeedback = (feedback: DocumentRecord) => ({
  concerns: feedback.concerns || null,
  createdAt: feedback.createdAt || null,
  documentId: getDocumentId(feedback) || null,
  nextStep: feedback.nextStep || null,
  notes: feedback.notes || null,
  outcome: feedback.outcome || null,
  previousTakeawayAssessment: feedback.previousTakeawayAssessment || null,
  rating: feedback.rating ?? null,
  sourceType: feedback.submittedByType || null,
  strengths: feedback.strengths || null,
  submittedAt: feedback.submittedAt || null,
  submitterDisplayName: feedback.submitterDisplayName || null,
  submitterRoleTitle: feedback.submitterRoleTitle || null,
});

const buildFeedbackReportAiPayload = async ({
  feedback,
  interview,
  rawFeedback,
  strapi,
}: {
  feedback: DocumentRecord;
  interview: DocumentRecord;
  rawFeedback: DocumentRecord[];
  strapi: StrapiService;
}) => ({
  candidate: {
    displayName:
      [interview.candidate?.firstName, interview.candidate?.lastName]
        .filter(Boolean)
        .join(' ')
        .trim() ||
      stringValue(interview.candidate?.email) ||
      'Candidate',
  },
  company: {
    name: stringValue(interview.employer?.companyName || interview.employer?.name) || 'the employer',
  },
  feedback: rawFeedback.map(feedbackSourcePayload),
  interview: {
    completedAt: interview.completedAt || feedback.submittedAt || null,
    documentId: getDocumentId(interview) || '',
    interviewerName: interview.interviewerName || null,
    scheduledStartTime: interview.scheduledStartTime || null,
  },
  previousTakeaways: [],
});

const feedbackReportReviewPayload = async (
  strapi: StrapiService,
  supportCase: DocumentRecord
) => {
  const metadata = objectValue(supportCase.metadata);

  if (metadata.kind !== 'ai_feedback_report_concern') {
    return null;
  }

  const feedback = await findFeedbackReportForConcernCase(strapi, supportCase);

  if (!feedback) {
    return null;
  }

  const interview = await findInterviewForFeedbackReport(strapi, feedback);
  const interviewDocumentId = getDocumentId(interview) || stringValue(metadata.interviewDocumentId);
  const rawFeedback = await findRawFeedbackForInterview(strapi, interviewDocumentId || undefined);

  return {
    ai: {
      metadata: objectValue(feedback.aiMetadata),
      model: feedback.aiModel || null,
      promptVersion: feedback.aiPromptVersion || null,
      provider: feedback.aiProvider || null,
    },
    candidateReason: feedback.candidateReportConcernReason || metadata.reason || null,
    concern: {
      flaggedAt: feedback.candidateReportConcernFlaggedAt || metadata.flaggedAt || null,
      resolution: feedback.candidateReportConcernResolution || null,
      resolvedAt: feedback.candidateReportConcernResolvedAt || null,
      reviewedAt: feedback.candidateReportConcernReviewedAt || null,
      state: feedback.candidateReportConcernState || 'open',
    },
    feedbackDocumentId: getDocumentId(feedback) || null,
    interview: {
      documentId: interviewDocumentId || null,
      employerName: stringValue(interview?.employer?.companyName || interview?.employer?.name),
      scheduledStartTime: interview?.scheduledStartTime || null,
      state: interview?.interviewState || null,
    },
    rawFeedback: rawFeedback.map(publicRawFeedback),
    report: {
      conclusion: feedback.candidateReportConclusion || null,
      generatedAt: feedback.candidateReportGeneratedAt || null,
      improvements: feedback.candidateReportImprovements || null,
      intro: feedback.candidateReportIntro || null,
      state: feedback.candidateReportState || null,
      strengths: feedback.candidateReportStrengths || null,
      takeaways: normalizeCandidateReportTakeaways(feedback.candidateReportTakeaways),
      visibleAt: feedback.candidateReportVisibleAt || null,
    },
  };
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
    const supportCaseRecord = await findSupportCaseRecord(strapi, body.supportCaseDocumentId);
    const supportCase = await supportCaseService(strapi).getCase({
      supportCaseDocumentId: body.supportCaseDocumentId,
    });
    const feedbackReportReview = supportCaseRecord
      ? await feedbackReportReviewPayload(strapi, supportCaseRecord)
      : null;
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
      feedbackReportReview,
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

  async resolveFeedbackReportConcern(input: unknown, requestContext: RequestContext = {}) {
    const body = validateFeedbackReportConcernAction(input);
    const session = await assertSupportSession(strapi, body.sessionToken, requestContext);
    const supportCaseRecord = await findSupportCaseRecord(strapi, body.supportCaseDocumentId);

    if (!supportCaseRecord) {
      throw new ForbiddenError('Support case could not be found.');
    }

    const supportCaseMetadata = objectValue(supportCaseRecord.metadata);

    if (supportCaseMetadata.kind !== 'ai_feedback_report_concern') {
      throw new ValidationError('Support case is not an AI feedback report concern.');
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

    const feedback = await findFeedbackReportForConcernCase(strapi, supportCaseRecord);

    if (!feedback?.documentId) {
      throw new ValidationError('Feedback report could not be found.');
    }

    const interview = await findInterviewForFeedbackReport(strapi, feedback);
    const rawFeedback = await findRawFeedbackForInterview(
      strapi,
      getDocumentId(interview) || stringValue(supportCaseMetadata.interviewDocumentId) || undefined
    );
    const now = new Date().toISOString();
    let updatedFeedback: DocumentRecord;
    let publicMessage: string;
    let actionState: 'dismissed' | 'regenerated' | 'resolved';

    if (body.action === 'regenerate') {
      if (!interview || rawFeedback.length === 0) {
        throw new ValidationError('Raw interview feedback is required before regenerating the report.');
      }

      const aiReport = await requestAiFeedbackReport({
        correlationId: `interview-feedback-report:${feedback.documentId}:admin-regenerate:${Date.now()}`,
        payload: await buildFeedbackReportAiPayload({
          feedback,
          interview,
          rawFeedback,
          strapi,
        }),
      });

      if (!aiReport) {
        throw new ValidationError('AI service is not configured.');
      }

      updatedFeedback = await documents(strapi, 'api::interview-feedback.interview-feedback').update({
        documentId: feedback.documentId,
        data: {
          aiMetadata: {
            ...objectValue(feedback.aiMetadata),
            ...(aiReport.metadata || {}),
            feedbackSourceDocumentIds: rawFeedback
              .map((item) => getDocumentId(item))
              .filter(Boolean),
            regeneratedAt: now,
            regeneratedByStaffEmail: session.user.email,
            requestId: requestContext.requestId,
          },
          aiModel: aiReport.model,
          aiPromptVersion: aiReport.promptVersion,
          aiProvider: aiReport.provider,
          candidateReportConclusion: aiReport.report.conclusion,
          candidateReportConcernResolution:
            body.resolutionNote || 'The feedback report was regenerated after staff review.',
          candidateReportConcernResolvedAt: now,
          candidateReportConcernResolvedByStaffEmail: session.user.email,
          candidateReportConcernReviewedAt: now,
          candidateReportConcernState: 'regenerated',
          candidateReportGeneratedAt: now,
          candidateReportImprovements: aiReport.report.improvements,
          candidateReportIntro: aiReport.report.intro,
          candidateReportState: 'generated',
          candidateReportStrengths: aiReport.report.strengths,
          candidateReportTakeaways: aiReport.report.takeaways,
          candidateReportVisibleAt: now,
        },
        populate: ['candidateReportConcernSupportCase', 'interview'],
      });
      actionState = 'regenerated';
      publicMessage =
        body.resolutionNote ||
        'We reviewed your concern and regenerated the interview feedback report. The updated report is now available in your interview history.';
    } else if (body.action === 'edit_approve' && body.report) {
      updatedFeedback = await documents(strapi, 'api::interview-feedback.interview-feedback').update({
        documentId: feedback.documentId,
        data: {
          candidateReportConclusion: body.report.conclusion,
          candidateReportConcernResolution:
            body.resolutionNote || 'The feedback report was edited and approved after staff review.',
          candidateReportConcernResolvedAt: now,
          candidateReportConcernResolvedByStaffEmail: session.user.email,
          candidateReportConcernReviewedAt: now,
          candidateReportConcernState: 'resolved',
          candidateReportGeneratedAt: feedback.candidateReportGeneratedAt || now,
          candidateReportImprovements: body.report.improvements,
          candidateReportIntro: body.report.intro,
          candidateReportState: 'manually_edited',
          candidateReportStrengths: body.report.strengths,
          candidateReportTakeaways: body.report.takeaways,
          candidateReportVisibleAt: now,
          metadata: {
            ...objectValue(feedback.metadata),
            manuallyEditedByStaffEmail: session.user.email,
            manuallyEditedRequestId: requestContext.requestId,
          },
        },
        populate: ['candidateReportConcernSupportCase', 'interview'],
      });
      actionState = 'resolved';
      publicMessage =
        body.resolutionNote ||
        'We reviewed your concern and updated the interview feedback report. The updated report is now available in your interview history.';
    } else {
      updatedFeedback = await documents(strapi, 'api::interview-feedback.interview-feedback').update({
        documentId: feedback.documentId,
        data: {
          candidateReportConcernResolution:
            body.resolutionNote || 'The report was reviewed and no report change was required.',
          candidateReportConcernResolvedAt: now,
          candidateReportConcernResolvedByStaffEmail: session.user.email,
          candidateReportConcernReviewedAt: now,
          candidateReportConcernState: 'dismissed',
        },
        populate: ['candidateReportConcernSupportCase', 'interview'],
      });
      actionState = 'dismissed';
      publicMessage =
        body.resolutionNote ||
        'We reviewed your concern. The interview feedback report has been kept unchanged.';
    }

    const notificationResult = await queueCandidateSupportPrompt({
      requestContext,
      strapi,
      supportCase: supportCaseRecord,
    });
    await supportCaseService(strapi).addMessage({
      body: publicMessage,
      candidate: supportCaseRecord.candidate,
      deliveryState:
        notificationResult.emailQueued || notificationResult.smsQueued ? 'queued' : 'not_required',
      direction: 'outbound',
      messageType: 'staff_reply',
      metadata: {
        feedbackDocumentId: feedback.documentId,
        feedbackReportConcernAction: body.action,
        notificationPromptChannels: {
          email: notificationResult.emailQueued,
          sms: notificationResult.smsQueued,
        },
        notificationPromptQueued:
          notificationResult.emailQueued || notificationResult.smsQueued,
      },
      sender: {
        displayName: session.user.displayName,
        email: session.user.email,
        id: session.user.id,
        type: 'admin',
      },
      subject: 'AI feedback report review',
      supportCase: {
        documentId: body.supportCaseDocumentId,
      },
      visibility: 'public',
    });
    await supportCaseService(strapi).updateCaseState({
      caseState: 'resolved',
      metadata: {
        feedbackDocumentId: feedback.documentId,
        feedbackReportConcernAction: body.action,
        feedbackReportConcernResolvedAt: now,
        feedbackReportConcernResolvedByStaffEmail: session.user.email,
      },
      supportCase: supportCaseRecord,
    });
    await publishSupportChange(strapi, body.supportCaseDocumentId);
    await publishAdminRealtimeEvent(
      {
        channels: ['operations'],
        resourceKey: body.supportCaseDocumentId,
        resourceType: 'support_case',
        type: 'admin_tasks_changed',
      },
      (strapi as { log?: { error?: (message: string, error?: unknown) => void } }).log
    );
    const refreshedCaseRecord =
      (await findSupportCaseRecord(strapi, body.supportCaseDocumentId)) || supportCaseRecord;
    const supportCase = await supportCaseService(strapi).getCase({
      supportCaseDocumentId: body.supportCaseDocumentId,
    });

    return {
      action: actionState,
      feedbackReportReview: await feedbackReportReviewPayload(strapi, refreshedCaseRecord),
      notificationQueued: notificationResult.emailQueued || notificationResult.smsQueued,
      supportCase,
      updatedFeedbackDocumentId: updatedFeedback.documentId || feedback.documentId,
      user: session.user,
    };
  },
});

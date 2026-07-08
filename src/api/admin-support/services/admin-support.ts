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
  aiMetadata?: unknown;
  aiModel?: string;
  aiPromptVersion?: string;
  aiProvider?: string;
  candidate?: DocumentRecord;
  candidateReportConclusion?: string;
  candidateReportFailureCategory?: string;
  candidateReportFailureFirstDetectedAt?: string;
  candidateReportFailureReason?: string;
  candidateReportGeneratedAt?: string;
  candidateReportImprovements?: string;
  candidateReportIntro?: string;
  candidateReportLastAttemptAt?: string;
  candidateReportManualDraftSavedAt?: string;
  candidateReportManualDraftSavedByStaffEmail?: string;
  candidateReportNextRetryAt?: string;
  candidateReportRetryCount?: number;
  candidateReportState?: string;
  candidateReportStrengths?: string;
  candidateReportTakeaways?: unknown;
  candidateReportVisibleAt?: string;
  concerns?: string;
  createdAt?: string;
  documentId?: string;
  email?: string;
  employer?: DocumentRecord;
  employerContact?: DocumentRecord;
  firstName?: string;
  id?: number | string;
  interview?: DocumentRecord;
  lastName?: string;
  metadata?: unknown;
  nextStep?: string;
  notes?: string;
  notificationPreferences?: unknown;
  outcome?: string;
  phone?: string;
  previousTakeawayAssessment?: string;
  rating?: number | string;
  refund?: DocumentRecord;
  scheduledStartTime?: string;
  sourceType?: string;
  strengths?: string;
  submittedAt?: string;
  submittedByType?: string;
  title?: string;
  updatedAt?: string;
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
const updateCaseStateSchema = z
  .object({
    body: z.string().trim().min(1).max(12000),
    caseState: z.enum(['awaiting_staff', 'closed', 'in_progress', 'open', 'resolved']),
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
const feedbackReportFailureDetailSchema = z
  .object({
    feedbackDocumentId: z.string().trim().min(1).max(160),
    sessionToken: z.string().trim().min(32).max(512),
  })
  .strict();
const feedbackReportFailureActionSchema = feedbackReportFailureDetailSchema
  .extend({
    action: z.enum(['edit_approve', 'regenerate', 'save_draft']),
    report: generatedReportSchema.optional(),
    resolutionNote: z.string().trim().max(4000).optional(),
    reviewClaimToken: z.string().trim().min(32).max(160).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (['edit_approve', 'save_draft'].includes(value.action) && !value.report) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Report fields are required.',
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
const validateUpdateCaseState = validateZodSchema(updateCaseStateSchema);
const validateFeedbackReportConcernAction = validateZodSchema(feedbackReportConcernActionSchema);
const validateFeedbackReportFailureDetail = validateZodSchema(feedbackReportFailureDetailSchema);
const validateFeedbackReportFailureAction = validateZodSchema(feedbackReportFailureActionSchema);

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

const getAiMonthlySpendLimitGbp = async (strapi: StrapiService) => {
  const settings = await documents(strapi, 'api::platform-setting.platform-setting').findMany({
    filters: {
      settingKey: 'ai.monthly_spend_limit_gbp',
    },
    limit: 1,
  });
  const configured = Number(settings[0]?.numberValue);

  if (Number.isFinite(configured) && configured > 0) {
    return configured;
  }

  return getIntegerEnv('AI_MONTHLY_SPEND_LIMIT_GBP', 100);
};

const objectValue = (value: unknown) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const documentRecordValue = (value: unknown): DocumentRecord | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as DocumentRecord)
    : undefined;

const candidateDashboardInterviewsUrl = () =>
  `${trimTrailingSlash(process.env.CANDIDATE_DASHBOARD_BASE_URL || 'http://localhost:3001')}/interviews`;

const aiFeedbackTaskKey = (feedbackDocumentId: string) =>
  `ai-feedback-report:${feedbackDocumentId}:failed`;

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

const employerSupportCaseUrl = (supportCaseDocumentId: string) =>
  `${trimTrailingSlash(process.env.EMPLOYER_DASHBOARD_PUBLIC_URL || 'http://localhost:3004')}/support/${encodeURIComponent(supportCaseDocumentId)}`;

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
      if (response.status === 413) {
        throw new ValidationError(
          'The feedback payload is too large for AI regeneration. Save a manual draft or reduce the source feedback.'
        );
      }

      if (response.status === 429) {
        throw new ValidationError('AI report generation is temporarily busy. Try again shortly.');
      }

      const responseError =
        responseBody && typeof responseBody === 'object' && 'error' in responseBody
          ? String((responseBody as { error?: unknown }).error || '')
          : '';

      throw new ValidationError(responseError || 'AI service could not generate a valid feedback report.');
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
    populate: ['candidate', 'refund', 'payment', 'enrollment', 'employer', 'employerContact'],
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

const findFeedbackReportByDocumentId = async (
  strapi: StrapiService,
  feedbackDocumentId: string
) => {
  const feedbackRecords = await documents(strapi, 'api::interview-feedback.interview-feedback').findMany({
    filters: {
      documentId: feedbackDocumentId,
    },
    limit: 1,
    populate: {
      interview: {
        populate: ['candidate', 'employer'],
      },
    },
  });

  return feedbackRecords[0] || null;
};

const failureDetectedAt = (feedback: DocumentRecord) =>
  feedback.candidateReportFailureFirstDetectedAt ||
  feedback.candidateReportLastAttemptAt ||
  feedback.updatedAt ||
  feedback.createdAt ||
  null;

const aiFailureEscalatedAt = (feedback: DocumentRecord) => addBusinessHours(failureDetectedAt(feedback), 4);

const assertAiFeedbackFailureAccess = (feedback: DocumentRecord, session: AdminSession) => {
  const roleKeys = session.user.roleKeys;

  if (roleKeys.some((roleKey) => ['sales', 'support'].includes(roleKey))) {
    return;
  }

  const escalatedAt = aiFailureEscalatedAt(feedback);
  const escalated = Boolean(escalatedAt && Date.parse(escalatedAt) <= Date.now());

  if (escalated && roleKeys.some((roleKey) => ['admin', 'super_admin'].includes(roleKey))) {
    return;
  }

  throw new ForbiddenError('This AI feedback review has not escalated to your access level yet.');
};

const aiFeedbackFailureReviewPayload = async (
  strapi: StrapiService,
  feedback: DocumentRecord
) => {
  const populatedInterview = documentRecordValue(feedback.interview);
  const interview = populatedInterview || (await findInterviewForFeedbackReport(strapi, feedback));
  const interviewDocumentId = getDocumentId(interview);
  const rawFeedback = await findRawFeedbackForInterview(strapi, interviewDocumentId || undefined);
  const escalatedAt = aiFailureEscalatedAt(feedback);
  const failedAt = failureDetectedAt(feedback);

  return {
    ai: {
      metadata: objectValue(feedback.aiMetadata),
      model: feedback.aiModel || null,
      promptVersion: feedback.aiPromptVersion || null,
      provider: feedback.aiProvider || null,
    },
    candidateReason: null,
    concern: {
      flaggedAt: null,
      resolution: feedback.candidateReportFailureReason || null,
      resolvedAt: null,
      reviewedAt: null,
      state: 'generation_failed',
    },
    failure: {
      category: feedback.candidateReportFailureCategory || null,
      escalatedToAdminAt: escalatedAt,
      failedAt,
      lastAttemptAt: feedback.candidateReportLastAttemptAt || null,
      nextRetryAt: feedback.candidateReportNextRetryAt || null,
      reason: feedback.candidateReportFailureReason || null,
      retryCount: Number(feedback.candidateReportRetryCount || 0),
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

const queueEmployerSupportPrompt = async ({
  requestContext,
  strapi,
  supportCase,
}: {
  requestContext: RequestContext;
  strapi: StrapiService;
  supportCase: DocumentRecord;
}) => {
  const employerContact = documentRecordValue(supportCase.employerContact);
  const employerContactDocumentId = getDocumentId(employerContact);
  const supportCaseDocumentId = getDocumentId(supportCase);
  const employerContactEmail =
    typeof employerContact?.email === 'string' ? employerContact.email : null;

  if (!employerContactDocumentId || !supportCaseDocumentId || !employerContactEmail) {
    return {
      emailQueued: false,
      smsQueued: false,
    };
  }

  const url = employerSupportCaseUrl(supportCaseDocumentId);
  const subject = 'New reply on your HireFlip support request';
  const emailQueueResult = await requestNotificationServiceEmail({
    correlationId: supportCaseDocumentId,
    template: {
      key: 'generic_branded_message',
      variables: {
        bodyLines: [
          'There is a new reply to your HireFlip employer support request.',
          'Please open the support case in your employer dashboard to view and reply.',
        ],
        ctaLabel: 'Open support case',
        ctaUrl: url,
        heading: subject,
        subject,
      },
    },
    to: employerContactEmail,
    type: 'employer_support_case_updated',
  });
  const emailQueued = emailQueueResult?.data?.queued === true;

  await documents(strapi, 'api::notification-event.notification-event').create({
    data: {
      channel: 'email',
      deliveryState: emailQueued ? 'queued' : 'failed',
      ...(emailQueued ? {} : { failedAt: new Date().toISOString() }),
      employer: relationConnect(documentRecordValue(supportCase.employer)),
      eventType: 'employer.support_case_updated',
      metadata: {
        dashboardUrl: url,
        notificationServiceJobId:
          typeof emailQueueResult?.data?.jobId === 'undefined'
            ? null
            : String(emailQueueResult.data.jobId),
        requestId: requestContext.requestId,
        supportCaseDocumentId,
      },
      priority: 'normal',
      recipientEmail: employerContactEmail,
      recipientId: employerContactDocumentId,
      recipientType: 'employer_contact',
      relatedId: supportCaseDocumentId,
      relatedType: 'support_case',
      templateKey: 'generic_branded_message',
    },
  });

  return {
    emailQueued,
    smsQueued: false,
  };
};

const queueCandidateFeedbackReportReadyNotification = async ({
  feedback,
  interview,
  requestContext,
  strapi,
}: {
  feedback: DocumentRecord;
  interview: DocumentRecord;
  requestContext: RequestContext;
  strapi: StrapiService;
}) => {
  const candidate = documentRecordValue(interview.candidate);
  const candidateEmail = typeof candidate?.email === 'string' ? candidate.email : null;
  const candidateDocumentId = getDocumentId(candidate);
  const subject = 'Your interview feedback is ready';
  const dashboardUrl = candidateDashboardInterviewsUrl();
  const candidateName = candidateFirstName(candidate);
  const bodyLines = [
    `Hi ${candidateName},`,
    'Your HireFlip interview feedback report is ready to view in your dashboard.',
    'This report was generated from direct interviewer feedback and is designed to give you clear, constructive next steps.',
    'If anything does not look right, you can flag it for review from the dashboard.',
  ];
  let emailDeliveryState: 'queued' | 'failed' = 'failed';
  let emailJobId: unknown;
  let emailErrorMessage: string | undefined;

  if (candidateEmail) {
    try {
      const emailQueueResult = await requestNotificationServiceEmail({
        correlationId: getDocumentId(feedback) || getDocumentId(interview),
        template: {
          key: 'generic_branded_message',
          variables: {
            bodyLines,
            ctaLabel: 'View interview feedback',
            ctaUrl: dashboardUrl,
            heading: subject,
            subject,
          },
        },
        to: candidateEmail,
        type: 'candidate_interview_feedback_report_ready',
      });

      emailDeliveryState = emailQueueResult?.data?.queued === true ? 'queued' : 'failed';
      emailJobId = emailQueueResult?.data?.jobId;
    } catch (error) {
      emailErrorMessage =
        error instanceof Error ? error.message : 'Candidate feedback report notification could not be queued.';
    }
  }

  await Promise.all(
    [
      {
        channel: 'in_app',
        deliveryState: 'queued' as const,
        errorMessage: undefined,
        jobId: undefined,
      },
      ...(candidateEmail
        ? [
            {
              channel: 'email',
              deliveryState: emailDeliveryState,
              errorMessage: emailErrorMessage,
              jobId: emailJobId,
            },
          ]
        : []),
    ].map(({ channel, deliveryState, errorMessage, jobId }) =>
      documents(strapi, 'api::notification-event.notification-event').create({
        data: {
          candidate: relationConnect(candidate),
          channel,
          deliveryState,
          ...(deliveryState === 'failed' ? { failedAt: new Date().toISOString() } : {}),
          errorMessage: errorMessage || null,
          employer: relationConnect(interview.employer),
          eventType: 'candidate.interview_feedback_report_ready',
          interview: relationConnect(interview),
          metadata: {
            dashboardUrl,
            feedbackDocumentId: getDocumentId(feedback),
            notificationServiceJobId: typeof jobId === 'undefined' ? null : String(jobId),
            requestId: requestContext.requestId,
          },
          priority: 'high',
          recipientEmail: candidateEmail,
          recipientId: candidateDocumentId,
          recipientType: 'candidate',
          relatedId: getDocumentId(feedback),
          relatedType: 'interview_feedback',
          templateKey: channel === 'email' ? 'generic_branded_message' : undefined,
        },
      })
    )
  );

  return {
    emailQueued: emailDeliveryState === 'queued',
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
  Promise.all([
    publishAdminRealtimeEvent(
      {
        channels: ['support'],
        resourceKey: supportCaseDocumentId,
        resourceType: 'support_case',
        type: 'support_cases_changed',
      },
      (strapi as { log?: { error?: (message: string, error?: unknown) => void } }).log
    ),
    publishAdminRealtimeEvent(
      {
        channels: ['operations'],
        resourceKey: supportCaseDocumentId,
        resourceType: 'support_case',
        type: 'admin_tasks_changed',
      },
      (strapi as { log?: { error?: (message: string, error?: unknown) => void } }).log
    ),
  ]);

const publishAiFeedbackTaskChange = (strapi: StrapiService, feedbackDocumentId?: string) =>
  publishAdminRealtimeEvent(
    {
      channels: ['operations', 'support'],
      resourceKey: feedbackDocumentId ? aiFeedbackTaskKey(feedbackDocumentId) : undefined,
      resourceType: 'admin_task',
      type: 'admin_tasks_changed',
    },
    (strapi as { log?: { error?: (message: string, error?: unknown) => void } }).log
  );

export default ({ strapi }: { strapi: StrapiService }) => ({
  async getFeedbackReportFailure(input: unknown, requestContext: RequestContext = {}) {
    const body = validateFeedbackReportFailureDetail(input);
    const session = await adminAuthService(strapi).getSession({ sessionToken: body.sessionToken }, requestContext);
    const feedback = await findFeedbackReportByDocumentId(strapi, body.feedbackDocumentId);

    if (!feedback) {
      throw new ValidationError('Feedback report could not be found.');
    }

    if (String(feedback.candidateReportState || '') !== 'failed') {
      throw new ValidationError('Feedback report is not in failed generation state.');
    }

    assertAiFeedbackFailureAccess(feedback, session);

    const { reviewClaim } = await reviewClaimService(strapi).claimForSession(
      {
        resourceDocumentId: body.feedbackDocumentId,
        resourceKey: aiFeedbackTaskKey(body.feedbackDocumentId),
        resourceLabel: 'AI feedback report failed',
        resourceType: 'admin_task',
      },
      session,
      requestContext
    );

    return {
      feedbackReportReview: await aiFeedbackFailureReviewPayload(strapi, feedback),
      generatedAt: new Date().toISOString(),
      reviewClaim,
      user: session.user,
    };
  },

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

    const isEmployerCase = Boolean(supportCaseRecord.employerContact && !supportCaseRecord.candidate);
    const notificationResult = isEmployerCase
      ? await queueEmployerSupportPrompt({
          requestContext,
          strapi,
          supportCase: supportCaseRecord,
        })
      : await queueCandidateSupportPrompt({
          requestContext,
          strapi,
          supportCase: supportCaseRecord,
        });
    const dashboardUrl = isEmployerCase
      ? employerSupportCaseUrl(body.supportCaseDocumentId)
      : supportCaseUrl(body.supportCaseDocumentId);
    await supportCaseService(strapi).addMessage({
      body: body.body,
      candidate: supportCaseRecord.candidate,
      deliveryState:
        notificationResult.emailQueued || notificationResult.smsQueued ? 'queued' : 'not_required',
      direction: 'outbound',
      employer: supportCaseRecord.employer,
      employerContact: supportCaseRecord.employerContact,
      messageType: 'staff_reply',
      metadata: {
        dashboardUrl,
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

  async updateCaseState(input: unknown, requestContext: RequestContext = {}) {
    const body = validateUpdateCaseState(input);
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

    const previousState =
      typeof supportCaseRecord.caseState === 'string' ? supportCaseRecord.caseState : 'open';

    await supportCaseService(strapi).addMessage({
      body: body.body,
      candidate: supportCaseRecord.candidate,
      direction: 'internal',
      employer: supportCaseRecord.employer,
      employerContact: supportCaseRecord.employerContact,
      messageType: 'system_update',
      metadata: {
        changedByAdminEmail: session.user.email,
        changedByAdminId: session.user.id,
        nextState: body.caseState,
        previousState,
      },
      refund: supportCaseRecord.refund,
      sender: {
        displayName: session.user.displayName,
        email: session.user.email,
        id: session.user.id,
        type: 'admin',
      },
      subject: 'Support case state changed',
      supportCase: {
        documentId: body.supportCaseDocumentId,
      },
      visibility: 'internal',
    });
    const supportCase = await supportCaseService(strapi).updateCaseState({
      caseState: body.caseState,
      metadata: {
        lastStateChangedAt: new Date().toISOString(),
        lastStateChangedByAdminEmail: session.user.email,
        lastStateChangedByAdminId: session.user.id,
        lastStateTransition: `${previousState}:${body.caseState}`,
      },
      supportCase: supportCaseRecord,
    });
    await publishSupportChange(strapi, body.supportCaseDocumentId);

    return {
      stateUpdated: true,
      supportCase,
      user: session.user,
    };
  },

  async resolveFeedbackReportFailure(input: unknown, requestContext: RequestContext = {}) {
    const body = validateFeedbackReportFailureAction(input);
    const session = await adminAuthService(strapi).getSession({ sessionToken: body.sessionToken }, requestContext);
    const feedback = await findFeedbackReportByDocumentId(strapi, body.feedbackDocumentId);

    if (!feedback?.documentId) {
      throw new ValidationError('Feedback report could not be found.');
    }

    if (String(feedback.candidateReportState || '') !== 'failed') {
      throw new ValidationError('Feedback report is not in failed generation state.');
    }

    assertAiFeedbackFailureAccess(feedback, session);

    await reviewClaimService(strapi).assertActiveClaimForSession(
      {
        claimToken: body.reviewClaimToken,
        resourceDocumentId: body.feedbackDocumentId,
        resourceKey: aiFeedbackTaskKey(body.feedbackDocumentId),
        resourceLabel: 'AI feedback report failed',
        resourceType: 'admin_task',
      },
      session
    );

    const populatedInterview = documentRecordValue(feedback.interview);
    const interview = populatedInterview || (await findInterviewForFeedbackReport(strapi, feedback));

    if (!interview) {
      throw new ValidationError('Interview could not be found for this feedback report.');
    }

    const rawFeedback = await findRawFeedbackForInterview(strapi, getDocumentId(interview));
    const now = new Date().toISOString();
    let updatedFeedback: DocumentRecord;
    let notificationQueued = false;
    let actionState: 'draft_saved' | 'regenerated' | 'resolved';

    if (body.action === 'save_draft' && body.report) {
      updatedFeedback = await documents(strapi, 'api::interview-feedback.interview-feedback').update({
        documentId: feedback.documentId,
        data: {
          candidateReportConclusion: body.report.conclusion,
          candidateReportImprovements: body.report.improvements,
          candidateReportIntro: body.report.intro,
          candidateReportManualDraftSavedAt: now,
          candidateReportManualDraftSavedByStaffEmail: session.user.email,
          candidateReportStrengths: body.report.strengths,
          candidateReportTakeaways: body.report.takeaways,
          metadata: {
            ...objectValue(feedback.metadata),
            failedReportDraftSavedAt: now,
            failedReportDraftSavedByStaffEmail: session.user.email,
            failedReportDraftRequestId: requestContext.requestId,
          },
        },
        populate: {
          interview: {
            populate: ['candidate', 'employer'],
          },
        },
      });
      actionState = 'draft_saved';
    } else if (body.action === 'regenerate') {
      if (rawFeedback.length === 0) {
        throw new ValidationError('Raw interview feedback is required before regenerating the report.');
      }

      const aiReport = await requestAiFeedbackReport({
        correlationId: `interview-feedback-report:${feedback.documentId}:admin-retry:${Date.now()}`,
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

      const monthlySpendLimitGbp = await getAiMonthlySpendLimitGbp(strapi);
      updatedFeedback = await documents(strapi, 'api::interview-feedback.interview-feedback').update({
        documentId: feedback.documentId,
        data: {
          aiMetadata: {
            ...objectValue(feedback.aiMetadata),
            ...(aiReport.metadata || {}),
            adminRecoveredAt: now,
            adminRecoveredByStaffEmail: session.user.email,
            feedbackSourceDocumentIds: rawFeedback
              .map((item) => getDocumentId(item))
              .filter(Boolean),
            monthlySpendLimitGbp,
            requestId: requestContext.requestId,
          },
          aiModel: aiReport.model,
          aiPromptVersion: aiReport.promptVersion,
          aiProvider: aiReport.provider,
          candidateReportConclusion: aiReport.report.conclusion,
          candidateReportFailureCategory: null,
          candidateReportFailureFirstDetectedAt: null,
          candidateReportFailureReason: null,
          candidateReportGeneratedAt: now,
          candidateReportImprovements: aiReport.report.improvements,
          candidateReportIntro: aiReport.report.intro,
          candidateReportLastAttemptAt: now,
          candidateReportManualDraftSavedAt: null,
          candidateReportManualDraftSavedByStaffEmail: null,
          candidateReportNextRetryAt: null,
          candidateReportRetryCount: 0,
          candidateReportState: 'generated',
          candidateReportStrengths: aiReport.report.strengths,
          candidateReportTakeaways: aiReport.report.takeaways,
          candidateReportVisibleAt: now,
        },
        populate: {
          interview: {
            populate: ['candidate', 'employer'],
          },
        },
      });
      const notificationResult = await queueCandidateFeedbackReportReadyNotification({
        feedback: updatedFeedback,
        interview,
        requestContext,
        strapi,
      });
      notificationQueued = notificationResult.emailQueued;
      actionState = 'regenerated';
    } else if (body.action === 'edit_approve' && body.report) {
      updatedFeedback = await documents(strapi, 'api::interview-feedback.interview-feedback').update({
        documentId: feedback.documentId,
        data: {
          candidateReportConclusion: body.report.conclusion,
          candidateReportFailureCategory: null,
          candidateReportFailureFirstDetectedAt: null,
          candidateReportFailureReason: null,
          candidateReportGeneratedAt: feedback.candidateReportGeneratedAt || now,
          candidateReportImprovements: body.report.improvements,
          candidateReportIntro: body.report.intro,
          candidateReportLastAttemptAt: now,
          candidateReportManualDraftSavedAt: null,
          candidateReportManualDraftSavedByStaffEmail: null,
          candidateReportNextRetryAt: null,
          candidateReportRetryCount: 0,
          candidateReportState: 'manually_edited',
          candidateReportStrengths: body.report.strengths,
          candidateReportTakeaways: body.report.takeaways,
          candidateReportVisibleAt: now,
          metadata: {
            ...objectValue(feedback.metadata),
            failedReportManuallyApprovedAt: now,
            failedReportManuallyApprovedByStaffEmail: session.user.email,
            failedReportManualApprovalRequestId: requestContext.requestId,
            resolutionNote: body.resolutionNote || null,
          },
        },
        populate: {
          interview: {
            populate: ['candidate', 'employer'],
          },
        },
      });
      const notificationResult = await queueCandidateFeedbackReportReadyNotification({
        feedback: updatedFeedback,
        interview,
        requestContext,
        strapi,
      });
      notificationQueued = notificationResult.emailQueued;
      actionState = 'resolved';
    } else {
      throw new ValidationError('Unsupported feedback report failure action.');
    }

    await publishAiFeedbackTaskChange(strapi, feedback.documentId);

    return {
      action: actionState,
      feedbackReportReview: await aiFeedbackFailureReviewPayload(strapi, updatedFeedback),
      notificationQueued,
      updatedFeedbackDocumentId: updatedFeedback.documentId || feedback.documentId,
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

      const monthlySpendLimitGbp = await getAiMonthlySpendLimitGbp(strapi);
      updatedFeedback = await documents(strapi, 'api::interview-feedback.interview-feedback').update({
        documentId: feedback.documentId,
        data: {
          aiMetadata: {
            ...objectValue(feedback.aiMetadata),
            ...(aiReport.metadata || {}),
            feedbackSourceDocumentIds: rawFeedback
              .map((item) => getDocumentId(item))
              .filter(Boolean),
            monthlySpendLimitGbp,
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

import { factories } from '@strapi/strapi';
import { errors, validateZodSchema, z } from '@strapi/utils';

const { ApplicationError, ValidationError } = errors;

const optionalString = (maxLength: number) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().trim().max(maxLength).optional()
  );

const optionalInteger = z.preprocess(
  (value) => {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }

    return Number(value);
  },
  z.number().int().min(0).max(1000).optional()
);

const booleanValue = z.preprocess((value) => {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
  }

  return false;
}, z.boolean());

const registerInterestSchema = z
  .object({
    email: z
      .string()
      .trim()
      .email()
      .max(254)
      .transform((value) => value.toLowerCase()),
    leadType: z.enum(['candidate_interest', 'employer_enquiry', 'unsupported_region_sector', 'other']),
    name: optionalString(120),
    company: optionalString(160),
    candidateStatus: optionalString(120),
    employerInterviewCapacity: optionalInteger,
    region: optionalString(120),
    sector: optionalString(120),
    sourceForm: optionalString(80).default('public_homepage'),
    marketingOptIn: booleanValue.default(false),
    privacyNoticeAccepted: booleanValue.refine((value) => value, {
      message: 'Privacy notice acceptance is required.',
    }),
    consentWordingVersion: optionalString(80),
    privacyNoticeVersion: optionalString(80),
    turnstileToken: z.string().trim().min(1).max(2048),
    website: optionalString(240),
  })
  .strict();

const validateRegisterInterest = validateZodSchema(registerInterestSchema);
const syncPendingLeadsSchema = z
  .object({
    documentId: optionalString(80),
    includeFailed: booleanValue.default(false),
    limit: z.number().int().min(1).max(200).default(50),
  })
  .strict()
  .default({
    includeFailed: false,
    limit: 50,
  });
const validateSyncPendingLeads = validateZodSchema(syncPendingLeadsSchema);

type RegisterInterestPayload = z.infer<typeof registerInterestSchema>;
type SyncPendingLeadsPayload = z.infer<typeof syncPendingLeadsSchema>;

type TurnstileValidationResponse = {
  success: boolean;
  challenge_ts?: string;
  hostname?: string;
  action?: string;
  cdata?: string;
  'error-codes'?: string[];
};

type RegisterInterestRequestContext = {
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
};

type PublicInterestLeadData = {
  candidateStatus?: string;
  company?: string;
  consentCapturedAt: string;
  consentState: 'marketing_opted_in' | 'operational_only';
  consentWordingVersion: string;
  email: string;
  employerInterviewCapacity?: number;
  enquiryLawfulBasis: string;
  leadType: RegisterInterestPayload['leadType'];
  marketingChannels: {
    email: boolean;
  };
  marketingLawfulBasis?: 'consent';
  metadata: {
    request: {
      ipAddress?: string;
      userAgent?: string;
    };
    turnstile: {
      action?: string;
      challengeTs?: string;
      hostname?: string;
    };
  };
  name?: string;
  privacyNoticeVersion: string;
  region?: string;
  sector?: string;
  sourceForm: string;
  suppressionStatus: 'not_suppressed';
  syncStatus: 'pending' | 'not_required';
};

type PublicInterestLeadRecord = Partial<PublicInterestLeadData> &
  Record<string, unknown> & {
  documentId?: string;
  };

type PublicInterestLeadDocuments = {
  create(input: { data: PublicInterestLeadData }): Promise<PublicInterestLeadRecord>;
  findMany(input: Record<string, unknown>): Promise<PublicInterestLeadRecord[]>;
  update(input: {
    data: Record<string, unknown>;
    documentId: string;
  }): Promise<PublicInterestLeadRecord>;
};

type AuditEventService = {
  record(input: Record<string, unknown>): Promise<unknown>;
};

type StrapiDocumentService = {
  documents(uid: 'api::public-interest-lead.public-interest-lead'): unknown;
  service(uid: 'api::audit-event.audit-event'): unknown;
};

const publicInterestLeadDocuments = (strapi: StrapiDocumentService) =>
  strapi.documents('api::public-interest-lead.public-interest-lead') as PublicInterestLeadDocuments;

const auditEvents = (strapi: StrapiDocumentService) =>
  strapi.service('api::audit-event.audit-event') as AuditEventService;

const turnstileActionByLeadType = {
  candidate_interest: 'candidate_interest',
  employer_enquiry: 'employer_enquiry',
  other: 'other_interest',
  unsupported_region_sector: 'unsupported_region_sector',
};

const getAllowedTurnstileHostnames = () =>
  (process.env.TURNSTILE_ALLOWED_HOSTNAMES || '')
    .split(',')
    .map((hostname) => hostname.trim().toLowerCase())
    .filter(Boolean);

const turnstileTestSecrets = new Set([
  '1x0000000000000000000000000000000AA',
  '2x0000000000000000000000000000000AA',
  '3x0000000000000000000000000000000AA',
]);

class MailingPlatformSyncError extends Error {
  responseBody?: unknown;
  status?: number;
  transient: boolean;

  constructor(
    message: string,
    {
      responseBody,
      status,
      transient = false,
    }: {
      responseBody?: unknown;
      status?: number;
      transient?: boolean;
    } = {}
  ) {
    super(message);
    this.name = 'MailingPlatformSyncError';
    this.responseBody = responseBody;
    this.status = status;
    this.transient = transient;
  }
}

const getIntegerEnv = (name: string, fallback: number) => {
  const value = Number.parseInt(process.env[name] || '', 10);

  return Number.isFinite(value) ? value : fallback;
};

const objectValue = (value: unknown) => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
};

const stringValue = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const mailingPlatformSyncConfig = () => {
  const provider = process.env.PUBLIC_INTEREST_LEAD_SYNC_PROVIDER || 'webhook';
  const syncUrl = process.env.PUBLIC_INTEREST_LEAD_SYNC_URL || '';
  const token = process.env.PUBLIC_INTEREST_LEAD_SYNC_TOKEN || '';

  return {
    listId: process.env.PUBLIC_INTEREST_LEAD_SYNC_LIST_ID || '',
    provider,
    syncUrl,
    timeoutMs: getIntegerEnv('PUBLIC_INTEREST_LEAD_SYNC_TIMEOUT_MS', 10000),
    token,
  };
};

const isMailingPlatformSyncConfigured = () => {
  const config = mailingPlatformSyncConfig();

  return Boolean(config.syncUrl && config.token);
};

const leadSyncPayload = (lead: PublicInterestLeadRecord, listId: string) => ({
  candidateStatus: lead.candidateStatus || null,
  company: lead.company || null,
  consent: {
    capturedAt: lead.consentCapturedAt || null,
    channels: lead.marketingChannels || {},
    consentState: lead.consentState || null,
    consentWordingVersion: lead.consentWordingVersion || null,
    marketingLawfulBasis: lead.marketingLawfulBasis || null,
    privacyNoticeVersion: lead.privacyNoticeVersion || null,
  },
  email: lead.email,
  employerInterviewCapacity: lead.employerInterviewCapacity ?? null,
  leadType: lead.leadType,
  listId: listId || null,
  metadata: {
    publicInterestLeadDocumentId: lead.documentId,
    source: 'hireflip_core_api',
  },
  name: lead.name || null,
  region: lead.region || null,
  sector: lead.sector || null,
  sourceForm: lead.sourceForm || null,
});

const readResponseBody = async (response: Response) => {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text.slice(0, 2000);
  }
};

const responseContactId = (responseBody: unknown) => {
  const body = objectValue(responseBody);
  const data = objectValue(body.data);
  const contact = objectValue(body.contact);

  return (
    stringValue(body.contactId) ||
    stringValue(body.id) ||
    stringValue(data.contactId) ||
    stringValue(data.id) ||
    stringValue(contact.id)
  );
};

const responseListId = (responseBody: unknown, fallback: string) => {
  const body = objectValue(responseBody);
  const data = objectValue(body.data);

  return stringValue(body.listId) || stringValue(data.listId) || fallback || undefined;
};

const syncLeadToMailingPlatform = async (lead: PublicInterestLeadRecord) => {
  const config = mailingPlatformSyncConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(config.syncUrl, {
      body: JSON.stringify(leadSyncPayload(lead, config.listId)),
      headers: {
        authorization: `Bearer ${config.token}`,
        'content-type': 'application/json',
        'x-hireflip-source': 'core-api',
      },
      method: 'POST',
      signal: controller.signal,
    });
    const responseBody = await readResponseBody(response);

    if (!response.ok) {
      throw new MailingPlatformSyncError(
        `Mailing platform sync failed with status ${response.status}.`,
        {
          responseBody,
          status: response.status,
          transient:
            response.status === 408 ||
            response.status === 409 ||
            response.status === 429 ||
            response.status >= 500,
        }
      );
    }

    return {
      contactId: responseContactId(responseBody),
      listId: responseListId(responseBody, config.listId),
      provider: config.provider,
      responseBody,
    };
  } catch (error) {
    if (error instanceof MailingPlatformSyncError) {
      throw error;
    }

    if (
      error &&
      typeof error === 'object' &&
      'name' in error &&
      String((error as { name?: unknown }).name) === 'AbortError'
    ) {
      throw new MailingPlatformSyncError('Mailing platform sync timed out.', {
        transient: true,
      });
    }

    throw new MailingPlatformSyncError(
      error instanceof Error ? error.message : 'Mailing platform sync failed.',
      {
        transient: true,
      }
    );
  } finally {
    clearTimeout(timeout);
  }
};

const syncableLeadFilters = (includeFailed: boolean) => ({
  consentState: 'marketing_opted_in',
  suppressionStatus: 'not_suppressed',
  syncStatus: includeFailed
    ? {
        $in: ['pending', 'failed'],
      }
    : 'pending',
});

const syncAttemptCount = (lead: PublicInterestLeadRecord) => {
  const value = Number(objectValue(lead.metadata).mailingPlatformSyncAttemptCount || 0);

  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
};

async function validateTurnstileToken(token: string, expectedAction: string, remoteIp?: string) {
  const secret = process.env.TURNSTILE_SECRET_KEY;

  if (!secret) {
    throw new ApplicationError('Turnstile verification is not configured.');
  }

  const isTestSecret = turnstileTestSecrets.has(secret);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      body: JSON.stringify({
        remoteip: remoteIp,
        response: token,
        secret,
      }),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
      signal: controller.signal,
    });

    const result = (await response.json()) as TurnstileValidationResponse;

    if (!response.ok || !result.success) {
      throw new ValidationError('Verification failed.');
    }

    if (!isTestSecret && result.action && result.action !== expectedAction) {
      throw new ValidationError('Verification failed.');
    }

    const allowedHostnames = getAllowedTurnstileHostnames();
    const hostname = result.hostname?.toLowerCase();

    if (!isTestSecret && allowedHostnames.length > 0 && (!hostname || !allowedHostnames.includes(hostname))) {
      throw new ValidationError('Verification failed.');
    }

    return result;
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }

    throw new ApplicationError('Turnstile verification could not be completed.');
  } finally {
    clearTimeout(timeout);
  }
}

export default factories.createCoreService('api::public-interest-lead.public-interest-lead', ({ strapi }) => ({
  async syncPendingLeads(input: unknown = {}) {
    const payload: SyncPendingLeadsPayload = validateSyncPendingLeads(input);

    if (!isMailingPlatformSyncConfigured()) {
      return {
        configured: false,
        failed: 0,
        results: [],
        skipped: 0,
        synced: 0,
      };
    }

    const leads = await publicInterestLeadDocuments(strapi).findMany({
      filters: {
        ...syncableLeadFilters(payload.includeFailed),
        ...(payload.documentId ? { documentId: payload.documentId } : {}),
      },
      limit: payload.limit,
      sort: ['createdAt:asc'],
    });
    const results: Array<Record<string, unknown>> = [];
    let failed = 0;
    let skipped = 0;
    let synced = 0;

    for (const lead of leads) {
      const documentId = lead.documentId;
      const now = new Date().toISOString();
      const metadata = objectValue(lead.metadata);
      const nextAttemptCount = syncAttemptCount(lead) + 1;

      if (!documentId) {
        skipped += 1;
        results.push({
          documentId: null,
          status: 'skipped',
        });
        continue;
      }

      if (
        lead.consentState !== 'marketing_opted_in' ||
        lead.suppressionStatus !== 'not_suppressed' ||
        lead.unsubscribedAt
      ) {
        await publicInterestLeadDocuments(strapi).update({
          documentId,
          data: {
            metadata: {
              ...metadata,
              mailingPlatformSyncSkippedAt: now,
              mailingPlatformSyncSkipReason: 'not_marketable',
            },
            syncStatus: 'not_required',
          },
        });

        skipped += 1;
        results.push({
          documentId,
          status: 'skipped',
        });
        continue;
      }

      try {
        const syncResult = await syncLeadToMailingPlatform(lead);
        await publicInterestLeadDocuments(strapi).update({
          documentId,
          data: {
            mailingPlatformContactId: syncResult.contactId || lead.mailingPlatformContactId || null,
            mailingPlatformListId: syncResult.listId || lead.mailingPlatformListId || null,
            mailingPlatformProvider: syncResult.provider,
            metadata: {
              ...metadata,
              mailingPlatformLastResponse: syncResult.responseBody,
              mailingPlatformSyncedAt: now,
              mailingPlatformSyncAttemptCount: nextAttemptCount,
            },
            syncError: null,
            syncStatus: 'synced',
          },
        });

        await auditEvents(strapi).record({
          actorType: 'service',
          eventCategory: 'privacy',
          eventType: 'public_interest_lead.synced',
          metadata: {
            mailingPlatformContactId: syncResult.contactId || null,
            mailingPlatformListId: syncResult.listId || null,
            mailingPlatformProvider: syncResult.provider,
            syncAttemptCount: nextAttemptCount,
          },
          occurredAt: now,
          serviceName: 'core-api',
          source: 'core_api',
          subjectDisplayName: lead.email,
          subjectId: documentId,
          subjectType: 'public-interest-lead',
        });

        synced += 1;
        results.push({
          documentId,
          mailingPlatformContactId: syncResult.contactId || null,
          status: 'synced',
        });
      } catch (error) {
        const syncError =
          error instanceof MailingPlatformSyncError
            ? error
            : new MailingPlatformSyncError(
                error instanceof Error ? error.message : 'Mailing platform sync failed.',
                {
                  transient: true,
                }
              );
        const syncErrorMessage = syncError.message.slice(0, 2000);

        await publicInterestLeadDocuments(strapi).update({
          documentId,
          data: {
            metadata: {
              ...metadata,
              mailingPlatformLastErrorResponse: syncError.responseBody ?? null,
              mailingPlatformSyncAttemptCount: nextAttemptCount,
              mailingPlatformSyncFailedAt: now,
              mailingPlatformSyncStatus: syncError.status || null,
              mailingPlatformSyncTransient: syncError.transient,
            },
            syncError: syncErrorMessage,
            syncStatus: 'failed',
          },
        });

        await auditEvents(strapi).record({
          actorType: 'service',
          eventCategory: 'privacy',
          eventType: 'public_interest_lead.sync_failed',
          metadata: {
            errorMessage: syncErrorMessage,
            mailingPlatformProvider: mailingPlatformSyncConfig().provider,
            status: syncError.status || null,
            syncAttemptCount: nextAttemptCount,
            transient: syncError.transient,
          },
          occurredAt: now,
          serviceName: 'core-api',
          severity: syncError.transient ? 'warning' : 'error',
          source: 'core_api',
          subjectDisplayName: lead.email,
          subjectId: documentId,
          subjectType: 'public-interest-lead',
        });

        failed += 1;
        results.push({
          documentId,
          error: syncErrorMessage,
          status: 'failed',
          transient: syncError.transient,
        });
      }
    }

    return {
      configured: true,
      failed,
      results,
      skipped,
      synced,
    };
  },

  async registerInterest(input: unknown, requestContext: RegisterInterestRequestContext = {}) {
    const payload: RegisterInterestPayload = validateRegisterInterest(input);

    if (payload.website) {
      return { created: false, documentId: undefined };
    }

    const turnstileValidation = await validateTurnstileToken(
      payload.turnstileToken,
      turnstileActionByLeadType[payload.leadType],
      requestContext.ipAddress
    );

    const now = new Date().toISOString();
    const consentWordingVersion =
      payload.consentWordingVersion || process.env.PUBLIC_INTEREST_CONSENT_WORDING_VERSION || 'public-interest-v1';
    const privacyNoticeVersion =
      payload.privacyNoticeVersion || process.env.PRIVACY_NOTICE_VERSION || 'privacy-notice-v1';

    const data: PublicInterestLeadData = {
      email: payload.email,
      leadType: payload.leadType,
      name: payload.name,
      company: payload.company,
      candidateStatus: payload.candidateStatus,
      employerInterviewCapacity: payload.employerInterviewCapacity,
      region: payload.region,
      sector: payload.sector,
      sourceForm: payload.sourceForm,
      consentState: payload.marketingOptIn ? 'marketing_opted_in' : 'operational_only',
      marketingChannels: {
        email: payload.marketingOptIn,
      },
      consentCapturedAt: now,
      consentWordingVersion,
      privacyNoticeVersion,
      enquiryLawfulBasis: process.env.PUBLIC_INTEREST_ENQUIRY_LAWFUL_BASIS || 'legitimate_interests',
      marketingLawfulBasis: payload.marketingOptIn ? 'consent' : undefined,
      suppressionStatus: 'not_suppressed',
      syncStatus: payload.marketingOptIn ? 'pending' : 'not_required',
      metadata: {
        request: {
          ipAddress: requestContext.ipAddress,
          userAgent: requestContext.userAgent,
        },
        turnstile: {
          action: turnstileValidation.action,
          challengeTs: turnstileValidation.challenge_ts,
          hostname: turnstileValidation.hostname,
        },
      },
    };

    const lead = await publicInterestLeadDocuments(strapi).create({ data });

    await auditEvents(strapi).record({
      eventType: 'public_interest_lead.created',
      eventCategory: 'privacy',
      source: 'core_api',
      actorType: 'anonymous',
      actorEmail: payload.email,
      subjectType: 'public-interest-lead',
      subjectId: lead.documentId,
      subjectDisplayName: payload.email,
      occurredAt: now,
      requestId: requestContext.requestId,
      ipAddress: requestContext.ipAddress,
      userAgent: requestContext.userAgent,
      newState: {
        leadType: payload.leadType,
        sourceForm: payload.sourceForm,
        consentState: data.consentState,
        syncStatus: data.syncStatus,
      },
      metadata: {
        consentWordingVersion,
        privacyNoticeVersion,
      },
    });

    return {
      created: true,
      documentId: lead.documentId,
    };
  },
}));

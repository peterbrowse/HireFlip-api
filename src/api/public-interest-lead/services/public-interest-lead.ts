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

type RegisterInterestPayload = z.infer<typeof registerInterestSchema>;

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

type PublicInterestLeadRecord = {
  documentId?: string;
};

type PublicInterestLeadDocuments = {
  create(input: { data: PublicInterestLeadData }): Promise<PublicInterestLeadRecord>;
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

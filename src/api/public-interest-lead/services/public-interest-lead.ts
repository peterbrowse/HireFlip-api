import { factories } from '@strapi/strapi';
import { validateZodSchema, z } from '@strapi/utils';

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
    website: optionalString(240),
  })
  .strict();

const validateRegisterInterest = validateZodSchema(registerInterestSchema);

type RegisterInterestRequestContext = {
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
};

export default factories.createCoreService('api::public-interest-lead.public-interest-lead', ({ strapi }) => ({
  async registerInterest(input: unknown, requestContext: RegisterInterestRequestContext = {}) {
    const payload = validateRegisterInterest(input);

    if (payload.website) {
      return { created: false, documentId: undefined };
    }

    const now = new Date().toISOString();
    const consentWordingVersion =
      payload.consentWordingVersion || process.env.PUBLIC_INTEREST_CONSENT_WORDING_VERSION || 'public-interest-v1';
    const privacyNoticeVersion =
      payload.privacyNoticeVersion || process.env.PRIVACY_NOTICE_VERSION || 'privacy-notice-v1';

    const data = {
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
      },
    };

    const lead = await strapi.documents('api::public-interest-lead.public-interest-lead').create({ data: data as any });

    await (strapi.service('api::audit-event.audit-event') as any).record({
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

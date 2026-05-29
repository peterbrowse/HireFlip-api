import { factories } from '@strapi/strapi';
import { errors, validateZodSchema, z } from '@strapi/utils';
import { parsePhoneNumberFromString } from 'libphonenumber-js/max';

const { UnauthorizedError, ValidationError } = errors;

type Auth0State = {
  type: 'auth0';
  subject: string;
  email?: string;
  claims?: Record<string, unknown>;
};

type RequestContext = {
  ipAddress?: string;
  requestId?: string;
  userAgent?: string;
};

const communicationChannels = ['email', 'sms', 'phone'] as const;

const coercePhoneInput = (value: string) => {
  const trimmedValue = value.trim();
  const compactValue = trimmedValue.replace(/[\s().-]/g, '');

  if (/^00\d+$/.test(compactValue)) {
    return `+${compactValue.slice(2)}`;
  }

  if (/^44\d{9,}$/.test(compactValue)) {
    return `+${compactValue}`;
  }

  if (/^7\d{9}$/.test(compactValue)) {
    return `0${compactValue}`;
  }

  return trimmedValue;
};

const parseMobilePhone = (value: string) => {
  const phone = parsePhoneNumberFromString(coercePhoneInput(value), 'GB');

  if (!phone || !phone.isValid()) {
    return undefined;
  }

  const phoneType = phone.getType();

  if (phoneType !== 'MOBILE' && phoneType !== 'FIXED_LINE_OR_MOBILE') {
    return undefined;
  }

  return phone;
};

const optionalString = (maxLength: number) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().trim().max(maxLength).optional()
  );

const mobilePhoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .refine((value) => Boolean(parseMobilePhone(value)), {
    message: 'Enter a valid mobile number. UK numbers can be entered with or without +44.',
  })
  .transform((value) => parseMobilePhone(value)!.number);

const optionalMobilePhone = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  mobilePhoneSchema.optional()
);

const syncCandidateSchema = z
  .object({
    email: z
      .string()
      .trim()
      .email()
      .max(254)
      .transform((value) => value.toLowerCase())
      .optional(),
    firstName: optionalString(120),
    lastName: optionalString(120),
    name: optionalString(240),
    phone: optionalMobilePhone,
    region: optionalString(120),
    sector: optionalString(120),
  })
  .strict()
  .default({});

const validateSyncCandidate = validateZodSchema(syncCandidateSchema);

const updateCandidateAccountSchema = z
  .object({
    firstName: z.string().trim().min(1).max(120),
    lastName: optionalString(120),
    phone: mobilePhoneSchema,
    preferredCommunicationChannel: z.enum(communicationChannels),
    marketingConsent: z.boolean(),
    marketingConsentWordingVersion: optionalString(80),
  })
  .strict();

const validateUpdateCandidateAccount = validateZodSchema(updateCandidateAccountSchema);

const sanitizeCandidate = (candidate) => ({
  documentId: candidate.documentId,
  email: candidate.email,
  firstName: candidate.firstName,
  lastName: candidate.lastName,
  phone: candidate.phone,
  preferredCommunicationChannel: candidate.preferredCommunicationChannel,
  marketingConsentState: candidate.marketingConsentState,
  marketingConsentCapturedAt: candidate.marketingConsentCapturedAt,
  marketingConsentWordingVersion: candidate.marketingConsentWordingVersion,
  accountOnboardingCompletedAt: candidate.accountOnboardingCompletedAt,
  status: candidate.status,
  region: candidate.region,
  sector: candidate.sector,
  recruitmentPlatformVisibility: candidate.recruitmentPlatformVisibility,
  accountCreatedAt: candidate.accountCreatedAt,
});

const getClaimString = (claims: Record<string, unknown> | undefined, key: string) => {
  const value = claims?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
};

const splitDisplayName = (name?: string) => {
  if (!name) {
    return {};
  }

  const parts = name.trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return {};
  }

  if (parts.length === 1) {
    return { firstName: parts[0] };
  }

  return {
    firstName: parts.slice(0, -1).join(' '),
    lastName: parts[parts.length - 1],
  };
};

const buildProfile = (payload, auth: Auth0State) => {
  const claims = auth.claims;
  const displayNameParts = splitDisplayName(payload.name || getClaimString(claims, 'name'));

  return {
    email: (auth.email || getClaimString(claims, 'email') || payload.email)?.toLowerCase(),
    firstName: payload.firstName || getClaimString(claims, 'given_name') || displayNameParts.firstName,
    lastName: payload.lastName || getClaimString(claims, 'family_name') || displayNameParts.lastName,
    phone: payload.phone,
    region: payload.region,
    sector: payload.sector,
  };
};

const findCandidateByAuthIdentity = async (strapi, authIdentityId: string) => {
  const candidates = await strapi.documents('api::candidate.candidate').findMany({
    filters: {
      authIdentityId,
    },
    limit: 1,
  } as any);

  return candidates[0];
};

const fieldValuesMatch = (currentValue: unknown, nextValue: unknown) => {
  if (
    currentValue &&
    nextValue &&
    typeof currentValue === 'object' &&
    typeof nextValue === 'object'
  ) {
    return JSON.stringify(currentValue) === JSON.stringify(nextValue);
  }

  return currentValue === nextValue;
};

const diffDefinedFields = (current, next: Record<string, unknown>) =>
  Object.entries(next).reduce<Record<string, unknown>>((changes, [key, value]) => {
    if (value !== undefined && !fieldValuesMatch(current[key], value)) {
      changes[key] = value;
    }

    return changes;
  }, {});

const objectValue = (value: unknown) => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
};

export default factories.createCoreService('api::candidate.candidate', ({ strapi }) => ({
  async syncCurrentCandidate(auth: Auth0State | undefined, input: unknown, requestContext: RequestContext = {}) {
    if (!auth || auth.type !== 'auth0' || !auth.subject) {
      throw new UnauthorizedError('Auth0 authentication is required.');
    }

    const payload = validateSyncCandidate(input ?? {});
    const profile = buildProfile(payload, auth);

    if (!profile.email) {
      throw new ValidationError('An email address is required to create a candidate account.');
    }

    const now = new Date().toISOString();
    const existingCandidate = await findCandidateByAuthIdentity(strapi, auth.subject);

    if (!existingCandidate) {
      const candidate = await strapi.documents('api::candidate.candidate').create({
        data: {
          accountCreatedAt: now,
          authIdentityId: auth.subject,
          authProvider: 'auth0',
          email: profile.email,
          firstName: profile.firstName,
          lastName: profile.lastName,
          notificationPreferences: {},
          phone: profile.phone,
          preferredCommunicationChannel: 'not_set',
          profileSettings: {},
          marketingConsentState: 'not_asked',
          recruitmentPlatformVisibility: 'not_set',
          region: profile.region,
          sector: profile.sector,
          status: 'account_created',
        } as any,
      });

      await (strapi.service('api::audit-event.audit-event') as any).record({
        actorEmail: profile.email,
        actorId: auth.subject,
        actorType: 'candidate',
        eventCategory: 'candidate',
        eventType: 'candidate.account_created',
        ipAddress: requestContext.ipAddress,
        newState: sanitizeCandidate(candidate),
        occurredAt: now,
        requestId: requestContext.requestId,
        source: 'core_api',
        subjectDisplayName: profile.email,
        subjectId: candidate.documentId,
        subjectType: 'candidate',
        userAgent: requestContext.userAgent,
      });

      return sanitizeCandidate(candidate);
    }

    const changes = diffDefinedFields(existingCandidate, {
      accountCreatedAt: existingCandidate.accountCreatedAt || now,
      authProvider: 'auth0',
      email: profile.email,
      firstName: existingCandidate.firstName ? undefined : profile.firstName,
      lastName: existingCandidate.lastName ? undefined : profile.lastName,
      phone: existingCandidate.phone ? undefined : profile.phone,
      preferredCommunicationChannel: existingCandidate.preferredCommunicationChannel || 'not_set',
      marketingConsentState: existingCandidate.marketingConsentState || 'not_asked',
      region: existingCandidate.region ? undefined : profile.region,
      sector: existingCandidate.sector ? undefined : profile.sector,
    });

    if (Object.keys(changes).length === 0) {
      return sanitizeCandidate(existingCandidate);
    }

    const updatedCandidate = await strapi.documents('api::candidate.candidate').update({
      documentId: existingCandidate.documentId,
      data: changes as any,
    });

    await (strapi.service('api::audit-event.audit-event') as any).record({
      actorEmail: updatedCandidate.email,
      actorId: auth.subject,
      actorType: 'candidate',
      eventCategory: 'candidate',
      eventType: 'candidate.account_synced',
      ipAddress: requestContext.ipAddress,
      newState: changes,
      occurredAt: now,
      previousState: {
        email: existingCandidate.email,
        firstName: existingCandidate.firstName,
        lastName: existingCandidate.lastName,
        phone: existingCandidate.phone,
        region: existingCandidate.region,
        sector: existingCandidate.sector,
      },
      requestId: requestContext.requestId,
      source: 'core_api',
      subjectDisplayName: updatedCandidate.email,
      subjectId: updatedCandidate.documentId,
      subjectType: 'candidate',
      userAgent: requestContext.userAgent,
    });

    return sanitizeCandidate(updatedCandidate);
  },

  async updateCurrentCandidateAccount(
    auth: Auth0State | undefined,
    input: unknown,
    requestContext: RequestContext = {}
  ) {
    if (!auth || auth.type !== 'auth0' || !auth.subject) {
      throw new UnauthorizedError('Auth0 authentication is required.');
    }

    const payload = validateUpdateCandidateAccount(input ?? {});
    const existingCandidate = await findCandidateByAuthIdentity(strapi, auth.subject);

    if (!existingCandidate) {
      throw new ValidationError('Candidate account must be synced before account details can be updated.');
    }

    const now = new Date().toISOString();
    const marketingConsentState = payload.marketingConsent ? 'opted_in' : 'opted_out';
    const previousMarketingConsentState = existingCandidate.marketingConsentState || 'not_asked';
    const marketingConsentChanged = previousMarketingConsentState !== marketingConsentState;
    const consentCapturedAt =
      marketingConsentChanged || !existingCandidate.marketingConsentCapturedAt
        ? now
        : existingCandidate.marketingConsentCapturedAt;
    const onboardingCompletedAt = existingCandidate.accountOnboardingCompletedAt || now;

    const previousNotificationPreferences = objectValue(existingCandidate.notificationPreferences);
    const previousProfileSettings = objectValue(existingCandidate.profileSettings);

    const notificationPreferences = {
      ...previousNotificationPreferences,
      preferredCommunicationChannel: payload.preferredCommunicationChannel,
      channels: {
        ...(objectValue(previousNotificationPreferences.channels)),
        email: true,
        phone: payload.preferredCommunicationChannel === 'phone',
        sms: payload.preferredCommunicationChannel === 'sms',
      },
    };

    const profileSettings = {
      ...previousProfileSettings,
      accountOnboarding: {
        ...(objectValue(previousProfileSettings.accountOnboarding)),
        completedAt: onboardingCompletedAt,
      },
    };

    const changes = diffDefinedFields(existingCandidate, {
      accountOnboardingCompletedAt: onboardingCompletedAt,
      firstName: payload.firstName,
      lastName: payload.lastName,
      marketingConsentCapturedAt: consentCapturedAt,
      marketingConsentState,
      marketingConsentWordingVersion:
        payload.marketingConsentWordingVersion || process.env.CANDIDATE_ACCOUNT_CONSENT_WORDING_VERSION || 'candidate-account-v1',
      notificationPreferences,
      phone: payload.phone,
      preferredCommunicationChannel: payload.preferredCommunicationChannel,
      profileSettings,
    });

    if (Object.keys(changes).length === 0) {
      return sanitizeCandidate(existingCandidate);
    }

    const updatedCandidate = await strapi.documents('api::candidate.candidate').update({
      documentId: existingCandidate.documentId,
      data: changes as any,
    });

    const previousState = {
      accountOnboardingCompletedAt: existingCandidate.accountOnboardingCompletedAt,
      firstName: existingCandidate.firstName,
      lastName: existingCandidate.lastName,
      marketingConsentCapturedAt: existingCandidate.marketingConsentCapturedAt,
      marketingConsentState: previousMarketingConsentState,
      marketingConsentWordingVersion: existingCandidate.marketingConsentWordingVersion,
      phone: existingCandidate.phone,
      preferredCommunicationChannel: existingCandidate.preferredCommunicationChannel,
    };

    await (strapi.service('api::audit-event.audit-event') as any).record({
      actorEmail: updatedCandidate.email,
      actorId: auth.subject,
      actorType: 'candidate',
      eventCategory: 'candidate',
      eventType: existingCandidate.accountOnboardingCompletedAt
        ? 'candidate.account_updated'
        : 'candidate.account_onboarding_completed',
      ipAddress: requestContext.ipAddress,
      newState: sanitizeCandidate(updatedCandidate),
      occurredAt: now,
      previousState,
      requestId: requestContext.requestId,
      source: 'candidate_dashboard',
      subjectDisplayName: updatedCandidate.email,
      subjectId: updatedCandidate.documentId,
      subjectType: 'candidate',
      userAgent: requestContext.userAgent,
    });

    if (marketingConsentChanged) {
      await (strapi.service('api::audit-event.audit-event') as any).record({
        actorEmail: updatedCandidate.email,
        actorId: auth.subject,
        actorType: 'candidate',
        eventCategory: 'privacy',
        eventType: 'candidate.marketing_consent_updated',
        ipAddress: requestContext.ipAddress,
        metadata: {
          consentWordingVersion: updatedCandidate.marketingConsentWordingVersion,
          sourceForm: existingCandidate.accountOnboardingCompletedAt ? 'settings_account' : 'first_login_onboarding',
        },
        newState: {
          marketingConsentCapturedAt: updatedCandidate.marketingConsentCapturedAt,
          marketingConsentState: updatedCandidate.marketingConsentState,
          marketingConsentWordingVersion: updatedCandidate.marketingConsentWordingVersion,
        },
        occurredAt: now,
        previousState: {
          marketingConsentCapturedAt: existingCandidate.marketingConsentCapturedAt,
          marketingConsentState: previousMarketingConsentState,
          marketingConsentWordingVersion: existingCandidate.marketingConsentWordingVersion,
        },
        requestId: requestContext.requestId,
        source: 'candidate_dashboard',
        subjectDisplayName: updatedCandidate.email,
        subjectId: updatedCandidate.documentId,
        subjectType: 'candidate',
        userAgent: requestContext.userAgent,
      });
    }

    return sanitizeCandidate(updatedCandidate);
  },
}));

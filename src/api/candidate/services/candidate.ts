import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { factories } from '@strapi/strapi';
import { errors, validateZodSchema, z } from '@strapi/utils';
import { parsePhoneNumberFromString } from 'libphonenumber-js/max';
import sharp from 'sharp';

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
const notListedPreferenceValue = 'not_listed';
const candidatePopulate = ['profileImage'];
const profileImageFormats = ['webp', 'avif'] as const;
const visiblePreferenceStates = ['active', 'coming_soon'] as const;
const targetClassFallbacks = {
  capacity: 30,
  currency: 'GBP',
  discountedPricePence: 32000,
  interviewsGuaranteed: 2,
  pricePence: 80000,
  region: 'London',
  sector: 'Marketing',
};
const fallbackClassAreaOptions = [
  { label: 'London', state: 'active', value: 'london' },
  { label: 'Manchester', state: 'coming_soon', value: 'manchester' },
  { label: 'Birmingham', state: 'coming_soon', value: 'birmingham' },
  { label: 'Bristol', state: 'coming_soon', value: 'bristol' },
  { label: 'Leeds', state: 'coming_soon', value: 'leeds' },
  { label: 'Remote/online', state: 'coming_soon', value: 'remote_online' },
];
const fallbackWorkSectorOptions = [
  { label: 'Marketing', state: 'active', value: 'marketing' },
  { label: 'Sales', state: 'coming_soon', value: 'sales' },
  { label: 'Accounting', state: 'coming_soon', value: 'accounting' },
  { label: 'Finance', state: 'coming_soon', value: 'finance' },
  { label: 'HR', state: 'coming_soon', value: 'hr' },
  { label: 'Operations', state: 'coming_soon', value: 'operations' },
  { label: 'Technology', state: 'coming_soon', value: 'technology' },
];

const terminalEnrollmentStatuses = new Set(['withdrawn', 'expired', 'refunded', 'archived']);
const terminalClassStatuses = new Set(['cancelled', 'archived', 'completed']);
const placeSecuredCandidateStatuses = new Set(['paid', 'in_class', 'course_completed', 'passed', 'failed', 'interview_phase', 'hired']);

type UploadedFile = {
  filepath?: string;
  mimetype?: string;
  originalFilename?: string;
  path?: string;
  size?: number;
};

const getIntegerEnv = (name: string, fallback: number) => {
  const value = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const getProfileImageFormat = () => {
  const configuredFormat = (process.env.CANDIDATE_PROFILE_IMAGE_FORMAT || 'webp').toLowerCase();
  return profileImageFormats.includes(configuredFormat as (typeof profileImageFormats)[number])
    ? (configuredFormat as (typeof profileImageFormats)[number])
    : 'webp';
};

const getProfileImageMime = (format: (typeof profileImageFormats)[number]) =>
  format === 'avif' ? 'image/avif' : 'image/webp';

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

const normalizePreferenceValue = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

const preferenceValue = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .transform(normalizePreferenceValue);

const preferenceSelectionSchema = z
  .object({
    other: optionalString(160),
    selected: z.array(preferenceValue).min(1).max(12),
  })
  .strict()
  .refine(
    (value) => !value.selected.includes(notListedPreferenceValue) || Boolean(value.other?.trim()),
    {
      message: 'Tell us what is not listed.',
      path: ['other'],
    }
  )
  .transform((value) => ({
    other: value.other,
    selected: Array.from(new Set(value.selected)),
  }));

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
    classAreaPreferences: preferenceSelectionSchema,
    communicationChannels: z.array(z.enum(communicationChannels)).optional(),
    firstName: z.string().trim().min(1).max(120),
    lastName: optionalString(120),
    phone: mobilePhoneSchema,
    preferredCommunicationChannel: z.enum(communicationChannels).optional(),
    marketingConsent: z.boolean(),
    marketingConsentWordingVersion: optionalString(80),
    workSectorPreferences: preferenceSelectionSchema,
  })
  .strict();

const validateUpdateCandidateAccount = validateZodSchema(updateCandidateAccountSchema);

const signProfileImage = async (strapi, profileImage) => {
  if (!profileImage) {
    return null;
  }

  return strapi.plugin('upload').service('file').signFileUrls(withRecoveredUploadPath(profileImage));
};

const recoverUploadPath = (file) => {
  if (!file?.url || file.path || !file.hash) {
    return file;
  }

  try {
    const objectKey = decodeURIComponent(new URL(file.url).pathname.replace(/^\/+/, ''));
    const expectedFileName = `${file.hash}${file.ext || ''}`;

    if (!expectedFileName || !objectKey.endsWith(expectedFileName)) {
      return file;
    }

    const prefix = objectKey.slice(0, -expectedFileName.length).replace(/\/+$/, '');

    return prefix
      ? {
          ...file,
          path: prefix,
        }
      : file;
  } catch {
    return file;
  }
};

const withRecoveredUploadPath = (file) => {
  const recoveredFile = recoverUploadPath(file);

  if (!recoveredFile?.formats) {
    return recoveredFile;
  }

  return {
    ...recoveredFile,
    formats: Object.fromEntries(
      Object.entries(recoveredFile.formats).map(([key, format]) => [
        key,
        recoverUploadPath(format),
      ])
    ),
  };
};

const sanitizeProfileImage = async (strapi, profileImage) => {
  const signedProfileImage = await signProfileImage(strapi, profileImage);

  if (!signedProfileImage) {
    return null;
  }

  return {
    id: signedProfileImage.id,
    documentId: signedProfileImage.documentId,
    name: signedProfileImage.name,
    alternativeText: signedProfileImage.alternativeText,
    ext: signedProfileImage.ext,
    mime: signedProfileImage.mime,
    size: signedProfileImage.size,
    width: signedProfileImage.width,
    height: signedProfileImage.height,
    url: signedProfileImage.url,
  };
};

const sanitizeCandidate = async (strapi, candidate) => ({
  documentId: candidate.documentId,
  classAreaPreferences: candidate.classAreaPreferences,
  email: candidate.email,
  firstName: candidate.firstName,
  lastName: candidate.lastName,
  profileImage: await sanitizeProfileImage(strapi, candidate.profileImage),
  notificationPreferences: candidate.notificationPreferences,
  phone: candidate.phone,
  preferredCommunicationChannel: candidate.preferredCommunicationChannel,
  marketingConsentState: candidate.marketingConsentState,
  marketingConsentCapturedAt: candidate.marketingConsentCapturedAt,
  marketingConsentWordingVersion: candidate.marketingConsentWordingVersion,
  accountOnboardingCompletedAt: candidate.accountOnboardingCompletedAt,
  status: candidate.status,
  region: candidate.region,
  sector: candidate.sector,
  workSectorPreferences: candidate.workSectorPreferences,
  registeredInterestAt: candidate.registeredInterestAt,
  recruitmentPlatformVisibility: candidate.recruitmentPlatformVisibility,
  accountCreatedAt: candidate.accountCreatedAt,
});

const getUploadedFilePath = (file?: UploadedFile) => file?.filepath || file?.path;

const processProfileImage = async (file?: UploadedFile) => {
  const inputPath = getUploadedFilePath(file);

  if (!inputPath) {
    throw new ValidationError('A profile image file is required.');
  }

  const maxBytes = getIntegerEnv('CANDIDATE_PROFILE_IMAGE_MAX_BYTES', 6 * 1024 * 1024);

  if (file?.size && file.size > maxBytes) {
    throw new ValidationError('Profile image is too large.');
  }

  const format = getProfileImageFormat();
  const mime = getProfileImageMime(format);
  const size = getIntegerEnv('CANDIDATE_PROFILE_IMAGE_SIZE', 512);
  const quality = Math.min(
    100,
    Math.max(1, getIntegerEnv('CANDIDATE_PROFILE_IMAGE_QUALITY', format === 'avif' ? 58 : 82))
  );
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'hireflip-profile-image-'));
  const outputPath = path.join(tmpDir, `profile-image.${format}`);

  try {
    const transformer = sharp(inputPath, { failOn: 'error' })
      .rotate()
      .resize(size, size, {
        fit: 'cover',
        position: 'attention',
      });

    if (format === 'avif') {
      await transformer.avif({ quality }).toFile(outputPath);
    } else {
      await transformer.webp({ quality }).toFile(outputPath);
    }

    const outputStats = await stat(outputPath);

    return {
      format,
      mime,
      outputPath,
      sizeInBytes: outputStats.size,
      tmpDir,
    };
  } catch (error) {
    await rm(tmpDir, { force: true, recursive: true });

    throw new ValidationError(
      error instanceof Error ? `Profile image could not be processed: ${error.message}` : 'Profile image could not be processed.'
    );
  }
};

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
    populate: candidatePopulate,
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

const normalizeCommunicationChannels = (
  channels?: readonly (typeof communicationChannels)[number][],
  preferredChannel?: (typeof communicationChannels)[number]
) => {
  const selectedChannels = new Set<(typeof communicationChannels)[number]>(['email']);

  if (preferredChannel) {
    selectedChannels.add(preferredChannel);
  }

  channels?.forEach((channel) => selectedChannels.add(channel));

  return communicationChannels.filter((channel) => selectedChannels.has(channel));
};

const derivePreferredCommunicationChannel = (
  selectedChannels: readonly (typeof communicationChannels)[number][],
  currentPreferredChannel?: (typeof communicationChannels)[number]
) => {
  if (currentPreferredChannel && selectedChannels.includes(currentPreferredChannel)) {
    return currentPreferredChannel;
  }

  return selectedChannels.find((channel) => channel !== 'email') || 'email';
};

const toTitleCase = (value: string) =>
  value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');

const preferenceLabel = (value?: string) => {
  if (!value) {
    return undefined;
  }

  return value === 'remote_online' ? 'Remote/online' : toTitleCase(value);
};

const sanitizePreferenceOption = (record) => ({
  label: record.name,
  state: visiblePreferenceStates.includes(record.state) ? record.state : 'active',
  value: normalizePreferenceValue(record.slug || record.name),
});

const getVisiblePreferenceOptions = async (
  strapi,
  uid: string,
  fallbackOptions: { label: string; state: string; value: string }[]
) => {
  const records = await strapi.documents(uid).findMany({
    filters: {
      state: {
        $in: visiblePreferenceStates,
      },
    },
    limit: 100,
    sort: ['sortOrder:asc', 'name:asc'],
  } as any);

  return records.length > 0 ? records.map(sanitizePreferenceOption) : fallbackOptions;
};

const preferenceSelection = (value: unknown) => {
  const rawValue = objectValue(value);
  const selected = Array.isArray(rawValue.selected)
    ? rawValue.selected.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    : [];
  const other = typeof rawValue.other === 'string' && rawValue.other.trim() ? rawValue.other.trim() : undefined;

  return {
    other,
    selected,
  };
};

const selectedListedPreferences = (value: unknown) =>
  preferenceSelection(value).selected.filter((item) => item !== notListedPreferenceValue);

const firstPreferenceLabel = (value: unknown, fallback: string) => {
  const selection = preferenceSelection(value);
  const firstListedPreference = selection.selected.find((item) => item !== notListedPreferenceValue);

  if (firstListedPreference) {
    return preferenceLabel(firstListedPreference) || fallback;
  }

  return selection.other || fallback;
};

const getTargetClassRegion = () => process.env.FIRST_CLASS_REGION || targetClassFallbacks.region;
const getTargetClassSector = () => process.env.FIRST_CLASS_SECTOR || targetClassFallbacks.sector;

const normalizeComparableText = (value?: string) => value?.trim().toLowerCase();

const classRecordAreaValue = (classRecord) =>
  normalizePreferenceValue(classRecord.classArea?.slug || classRecord.classArea?.name || classRecord.region || targetClassFallbacks.region);

const classRecordSectorValue = (classRecord) =>
  normalizePreferenceValue(classRecord.workSector?.slug || classRecord.workSector?.name || classRecord.sector || targetClassFallbacks.sector);

const classMatchesTarget = (classRecord, candidate?) => {
  const classAreaPreference = preferenceSelection(candidate?.classAreaPreferences);
  const workSectorPreference = preferenceSelection(candidate?.workSectorPreferences);
  const selectedRegions = selectedListedPreferences(candidate?.classAreaPreferences).map(normalizeComparableText);
  const selectedSectors = selectedListedPreferences(candidate?.workSectorPreferences).map(normalizeComparableText);
  const targetRegion = normalizePreferenceValue(getTargetClassRegion());
  const targetSector = normalizePreferenceValue(getTargetClassSector());
  const classRegion = classRecordAreaValue(classRecord);
  const classSector = classRecordSectorValue(classRecord);
  const regionMatches =
    selectedRegions.length > 0
      ? selectedRegions.includes(classRegion)
      : classAreaPreference.selected.length > 0
        ? false
        : classRegion === targetRegion;
  const sectorMatches =
    selectedSectors.length > 0
      ? selectedSectors.includes(classSector)
      : workSectorPreference.selected.length > 0
        ? false
        : classSector === targetSector;

  return regionMatches && sectorMatches;
};

const findTargetClass = async (strapi, candidate?) => {
  const classes = await strapi.documents('api::class.class').findMany({
    limit: 100,
    populate: ['classArea', 'workSector'],
    sort: ['startDate:asc', 'createdAt:desc'],
  } as any);

  return classes
    .filter((classRecord) => classMatchesTarget(classRecord, candidate))
    .filter((classRecord) => !terminalClassStatuses.has(classRecord.status))
    .sort((firstClass, secondClass) => {
      const firstTime = firstClass.startDate ? Date.parse(firstClass.startDate) : Number.MAX_SAFE_INTEGER;
      const secondTime = secondClass.startDate ? Date.parse(secondClass.startDate) : Number.MAX_SAFE_INTEGER;

      return firstTime - secondTime;
    })[0];
};

const findCurrentEnrollment = async (strapi, candidate, targetClass?) => {
  const enrollments = await strapi.documents('api::enrollment.enrollment').findMany({
    filters: {
      candidate: {
        documentId: candidate.documentId,
      },
    },
    limit: 25,
    populate: ['class'],
    sort: ['createdAt:desc'],
  } as any);

  return enrollments.find((enrollment) => {
    if (terminalEnrollmentStatuses.has(enrollment.status)) {
      return false;
    }

    const enrolledClass = enrollment.class;

    if (!enrolledClass) {
      return false;
    }

    if (targetClass?.documentId) {
      return enrolledClass.documentId === targetClass.documentId;
    }

    return classMatchesTarget(enrolledClass, candidate);
  });
};

const buildTarget = (candidate?) => ({
  capacity: targetClassFallbacks.capacity,
  currency: targetClassFallbacks.currency,
  discountedPricePence: targetClassFallbacks.discountedPricePence,
  interviewsGuaranteed: targetClassFallbacks.interviewsGuaranteed,
  pricePence: targetClassFallbacks.pricePence,
  region: firstPreferenceLabel(candidate?.classAreaPreferences, getTargetClassRegion()),
  sector: firstPreferenceLabel(candidate?.workSectorPreferences, getTargetClassSector()),
});

const sanitizeClass = (classRecord) => {
  if (!classRecord) {
    return null;
  }

  const region = classRecord.classArea?.name || classRecord.region || targetClassFallbacks.region;
  const sector = classRecord.workSector?.name || classRecord.sector || targetClassFallbacks.sector;

  return {
    capacity: classRecord.capacity || targetClassFallbacks.capacity,
    currency: classRecord.currency || targetClassFallbacks.currency,
    discountedPricePence: classRecord.discountedPricePence ?? targetClassFallbacks.discountedPricePence,
    documentId: classRecord.documentId,
    endDate: classRecord.endDate,
    interviewsGuaranteed: targetClassFallbacks.interviewsGuaranteed,
    name:
      classRecord.name ||
      `First ${region} ${sector} class`,
    pricePence: classRecord.pricePence ?? targetClassFallbacks.pricePence,
    quarter: classRecord.quarter,
    region,
    sector,
    startDate: classRecord.startDate,
    status: classRecord.status,
    year: classRecord.year,
  };
};

const sanitizeEnrollment = (enrollment) => {
  if (!enrollment) {
    return null;
  }

  return {
    completionStatus: enrollment.completionStatus,
    documentId: enrollment.documentId,
    enrolledAt: enrollment.enrolledAt,
    paymentStatus: enrollment.paymentStatus,
    status: enrollment.status,
  };
};

const classHasPaymentAccess = (classRecord) => classRecord?.status === 'open';

const deriveClassInterestState = (candidate, enrollment, targetClass?) => {
  if (enrollment) {
    if (
      enrollment.paymentStatus === 'paid' ||
      ['enrolled', 'active', 'completed'].includes(enrollment.status)
    ) {
      return 'place_secured';
    }

    if (enrollment.status === 'slot_reserved') {
      return 'payment_available';
    }

    if (classHasPaymentAccess(enrollment.class || targetClass)) {
      return 'payment_available';
    }

    return 'waiting_for_class';
  }

  if (placeSecuredCandidateStatuses.has(candidate.status)) {
    return 'place_secured';
  }

  if (candidate.status === 'slot_reserved') {
    return 'payment_available';
  }

  if (candidate.status === 'waitlisted') {
    return 'waiting_for_class';
  }

  if (candidate.registeredInterestAt || candidate.status === 'interest_registered') {
    if (classHasPaymentAccess(targetClass)) {
      return 'payment_available';
    }

    return 'interest_registered';
  }

  return 'not_registered';
};

const buildClassInterestResponse = ({ candidate, enrollment, targetClass }) => {
  const state = deriveClassInterestState(candidate, enrollment, targetClass);
  const target = buildTarget(candidate);

  return {
    canRegisterInterest: state === 'not_registered',
    candidate: {
      documentId: candidate.documentId,
      registeredInterestAt: candidate.registeredInterestAt,
      status: candidate.status,
    },
    class: sanitizeClass(targetClass),
    enrollment: sanitizeEnrollment(enrollment),
    state,
    target,
  };
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
        newState: await sanitizeCandidate(strapi, candidate),
        occurredAt: now,
        requestId: requestContext.requestId,
        source: 'core_api',
        subjectDisplayName: profile.email,
        subjectId: candidate.documentId,
        subjectType: 'candidate',
        userAgent: requestContext.userAgent,
      });

      return sanitizeCandidate(strapi, candidate);
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
      return sanitizeCandidate(strapi, existingCandidate);
    }

    const updatedCandidate = await strapi.documents('api::candidate.candidate').update({
      documentId: existingCandidate.documentId,
      data: changes as any,
      populate: candidatePopulate,
    } as any);

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

    return sanitizeCandidate(strapi, updatedCandidate);
  },

  async getCandidatePreferenceOptions(auth: Auth0State | undefined) {
    if (!auth || auth.type !== 'auth0' || !auth.subject) {
      throw new UnauthorizedError('Auth0 authentication is required.');
    }

    const [classAreas, workSectors] = await Promise.all([
      getVisiblePreferenceOptions(strapi, 'api::class-area.class-area', fallbackClassAreaOptions),
      getVisiblePreferenceOptions(strapi, 'api::work-sector.work-sector', fallbackWorkSectorOptions),
    ]);

    return {
      classAreas,
      workSectors,
    };
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
    const selectedCommunicationChannels = normalizeCommunicationChannels(
      payload.communicationChannels,
      payload.preferredCommunicationChannel
    );
    const preferredCommunicationChannel = derivePreferredCommunicationChannel(
      selectedCommunicationChannels,
      payload.preferredCommunicationChannel || existingCandidate.preferredCommunicationChannel
    );

    const notificationPreferences = {
      ...previousNotificationPreferences,
      preferredCommunicationChannel,
      channels: {
        ...(objectValue(previousNotificationPreferences.channels)),
        email: true,
        phone: selectedCommunicationChannels.includes('phone'),
        sms: selectedCommunicationChannels.includes('sms'),
      },
    };
    const target = buildTarget({
      classAreaPreferences: payload.classAreaPreferences,
      workSectorPreferences: payload.workSectorPreferences,
    });

    const profileSettings = {
      ...previousProfileSettings,
      accountOnboarding: {
        ...(objectValue(previousProfileSettings.accountOnboarding)),
        completedAt: onboardingCompletedAt,
      },
    };

    const changes = diffDefinedFields(existingCandidate, {
      accountOnboardingCompletedAt: onboardingCompletedAt,
      classAreaPreferences: payload.classAreaPreferences,
      firstName: payload.firstName,
      lastName: payload.lastName,
      marketingConsentCapturedAt: consentCapturedAt,
      marketingConsentState,
      marketingConsentWordingVersion:
        payload.marketingConsentWordingVersion || process.env.CANDIDATE_ACCOUNT_CONSENT_WORDING_VERSION || 'candidate-account-v1',
      notificationPreferences,
      phone: payload.phone,
      preferredCommunicationChannel,
      profileSettings,
      region: target.region,
      sector: target.sector,
      workSectorPreferences: payload.workSectorPreferences,
    });

    if (Object.keys(changes).length === 0) {
      return sanitizeCandidate(strapi, existingCandidate);
    }

    const updatedCandidate = await strapi.documents('api::candidate.candidate').update({
      documentId: existingCandidate.documentId,
      data: changes as any,
      populate: candidatePopulate,
    } as any);

    const previousState = {
      accountOnboardingCompletedAt: existingCandidate.accountOnboardingCompletedAt,
      classAreaPreferences: existingCandidate.classAreaPreferences,
      firstName: existingCandidate.firstName,
      lastName: existingCandidate.lastName,
      marketingConsentCapturedAt: existingCandidate.marketingConsentCapturedAt,
      marketingConsentState: previousMarketingConsentState,
      marketingConsentWordingVersion: existingCandidate.marketingConsentWordingVersion,
      phone: existingCandidate.phone,
      preferredCommunicationChannel: existingCandidate.preferredCommunicationChannel,
      workSectorPreferences: existingCandidate.workSectorPreferences,
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
      newState: await sanitizeCandidate(strapi, updatedCandidate),
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

    return sanitizeCandidate(strapi, updatedCandidate);
  },

  async getCurrentCandidateClassInterest(auth: Auth0State | undefined) {
    if (!auth || auth.type !== 'auth0' || !auth.subject) {
      throw new UnauthorizedError('Auth0 authentication is required.');
    }

    const existingCandidate = await findCandidateByAuthIdentity(strapi, auth.subject);

    if (!existingCandidate) {
      throw new ValidationError('Candidate account must be synced before class interest can be checked.');
    }

    const targetClass = await findTargetClass(strapi, existingCandidate);
    const enrollment = await findCurrentEnrollment(strapi, existingCandidate, targetClass);

    return buildClassInterestResponse({
      candidate: existingCandidate,
      enrollment,
      targetClass,
    });
  },

  async registerCurrentCandidateClassInterest(
    auth: Auth0State | undefined,
    requestContext: RequestContext = {}
  ) {
    if (!auth || auth.type !== 'auth0' || !auth.subject) {
      throw new UnauthorizedError('Auth0 authentication is required.');
    }

    const existingCandidate = await findCandidateByAuthIdentity(strapi, auth.subject);

    if (!existingCandidate) {
      throw new ValidationError('Candidate account must be synced before class interest can be registered.');
    }

    const targetClass = await findTargetClass(strapi, existingCandidate);
    const existingEnrollment = await findCurrentEnrollment(strapi, existingCandidate, targetClass);
    const currentState = deriveClassInterestState(existingCandidate, existingEnrollment, targetClass);

    if (currentState !== 'not_registered') {
      return {
        created: false,
        data: buildClassInterestResponse({
          candidate: existingCandidate,
          enrollment: existingEnrollment,
          targetClass,
        }),
      };
    }

    const now = new Date().toISOString();
    let enrollment;
    const candidateUpdates: Record<string, unknown> = {
      registeredInterestAt: existingCandidate.registeredInterestAt || now,
      region: existingCandidate.region || buildTarget(existingCandidate).region,
      sector: existingCandidate.sector || buildTarget(existingCandidate).sector,
      status: targetClass ? 'waitlisted' : 'interest_registered',
    };

    if (targetClass) {
      enrollment = await strapi.documents('api::enrollment.enrollment').create({
        data: {
          candidate: {
            connect: [{ documentId: existingCandidate.documentId }],
          },
          class: {
            connect: [{ documentId: targetClass.documentId }],
          },
          completionStatus: 'not_started',
          metadata: {
            registeredInterestAt: now,
            source: 'candidate_dashboard',
          },
          passStatus: 'not_assessed',
          paymentStatus: 'pending',
          status: 'waitlisted',
        } as any,
        populate: ['class'],
      } as any);
    }

    const updatedCandidate = await strapi.documents('api::candidate.candidate').update({
      documentId: existingCandidate.documentId,
      data: candidateUpdates as any,
      populate: candidatePopulate,
    } as any);

    const response = buildClassInterestResponse({
      candidate: updatedCandidate,
      enrollment,
      targetClass,
    });

    await (strapi.service('api::audit-event.audit-event') as any).record({
      actorEmail: updatedCandidate.email,
      actorId: auth.subject,
      actorType: 'candidate',
      eventCategory: 'candidate',
      eventType: 'candidate.class_interest_registered',
      ipAddress: requestContext.ipAddress,
      metadata: {
        targetRegion: getTargetClassRegion(),
        targetSector: getTargetClassSector(),
      },
      newState: response,
      occurredAt: now,
      previousState: {
        registeredInterestAt: existingCandidate.registeredInterestAt,
        status: existingCandidate.status,
      },
      requestId: requestContext.requestId,
      source: 'candidate_dashboard',
      subjectDisplayName: updatedCandidate.email,
      subjectId: updatedCandidate.documentId,
      subjectType: 'candidate',
      userAgent: requestContext.userAgent,
    });

    return {
      created: true,
      data: response,
    };
  },

  async updateCurrentCandidateProfileImage(
    auth: Auth0State | undefined,
    file: UploadedFile | undefined,
    requestContext: RequestContext = {}
  ) {
    if (!auth || auth.type !== 'auth0' || !auth.subject) {
      throw new UnauthorizedError('Auth0 authentication is required.');
    }

    const existingCandidate = await findCandidateByAuthIdentity(strapi, auth.subject);

    if (!existingCandidate) {
      throw new ValidationError('Candidate account must be synced before a profile image can be updated.');
    }

    const previousProfileImage = existingCandidate.profileImage;
    const processedImage = await processProfileImage(file);

    try {
      const uploadedFiles = await strapi.plugin('upload').service('upload').upload({
        data: {
          fileInfo: {
            alternativeText: `${existingCandidate.firstName || existingCandidate.email} profile image`,
            name: `candidate-profile-${existingCandidate.documentId}.${processedImage.format}`,
          },
          field: 'profileImage',
          ref: 'api::candidate.candidate',
          refId: existingCandidate.id,
        },
        files: {
          filepath: processedImage.outputPath,
          mimetype: processedImage.mime,
          originalFilename: `candidate-profile-${existingCandidate.documentId}.${processedImage.format}`,
          size: processedImage.sizeInBytes,
        },
      });

      const uploadedFile = uploadedFiles[0];

      if (!uploadedFile?.id) {
        throw new ValidationError('Profile image upload did not return a stored file.');
      }

      const updatedCandidate = await strapi.documents('api::candidate.candidate').update({
        documentId: existingCandidate.documentId,
        data: {
          profileImage: uploadedFile.id,
        } as any,
        populate: candidatePopulate,
      } as any);
      const sanitizedCandidate = await sanitizeCandidate(strapi, updatedCandidate);
      const now = new Date().toISOString();

      await (strapi.service('api::audit-event.audit-event') as any).record({
        actorEmail: updatedCandidate.email,
        actorId: auth.subject,
        actorType: 'candidate',
        eventCategory: 'candidate',
        eventType: 'candidate.profile_image_updated',
        ipAddress: requestContext.ipAddress,
        newState: {
          profileImage: sanitizedCandidate.profileImage,
        },
        occurredAt: now,
        previousState: {
          profileImage: await sanitizeProfileImage(strapi, previousProfileImage),
        },
        requestId: requestContext.requestId,
        source: 'candidate_dashboard',
        subjectDisplayName: updatedCandidate.email,
        subjectId: updatedCandidate.documentId,
        subjectType: 'candidate',
        userAgent: requestContext.userAgent,
      });

      if (previousProfileImage?.id && previousProfileImage.id !== uploadedFile?.id) {
        await strapi.plugin('upload').service('upload').remove(previousProfileImage).catch((error) => {
          strapi.log.warn(
            `Could not remove previous candidate profile image ${previousProfileImage.id}: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        });
      }

      return sanitizedCandidate;
    } finally {
      await rm(processedImage.tmpDir, { force: true, recursive: true });
    }
  },
}));

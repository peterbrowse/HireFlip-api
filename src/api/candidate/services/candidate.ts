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
const unlistedInterestTypes = ['class_area', 'work_sector'] as const;
const unlistedInterestSources = ['class_page', 'onboarding', 'settings'] as const;
const candidatePopulate = ['profileImage'];
const profileImageFormats = ['webp', 'avif'] as const;
const visiblePreferenceStates = ['active', 'coming_soon'] as const;
const profileImageSignedUrlCache = new Map<
  string,
  {
    expiresAt: number;
    value: {
      alternativeText?: string;
      documentId?: string;
      ext?: string;
      height?: number;
      id?: number;
      mime?: string;
      name?: string;
      size?: number;
      url?: string;
      width?: number;
    };
  }
>();

const terminalEnrollmentStatuses = new Set(['withdrawn', 'expired', 'refunded', 'archived']);
const terminalClassStatuses = new Set(['cancelled', 'archived', 'completed']);
const candidateVisibleClassStates = new Set([
  'coming_soon',
  'waitlist_open',
  'open',
  'full',
  'in_progress',
  'completion_window',
  'interview_window',
]);
const paidEnrollmentStatuses = new Set(['enrolled', 'active']);
const completedEnrollmentStatuses = new Set(['completed']);
const interestCountEnrollmentStatuses = ['waitlisted', 'slot_reserved', 'enrolled', 'active', 'completed'];

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

const registerClassInterestSchema = z
  .object({
    classDocumentId: optionalString(80),
  })
  .strict()
  .default({});

const validateRegisterClassInterest = validateZodSchema(registerClassInterestSchema);

const createUnlistedInterestSchema = z
  .object({
    interestType: z.enum(unlistedInterestTypes),
    source: z.enum(unlistedInterestSources).default('settings'),
    suggestedValue: z.string().trim().min(1).max(160),
  })
  .strict();

const validateCreateUnlistedInterest = validateZodSchema(createUnlistedInterestSchema);

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

const getProfileImageCacheKey = (profileImage) => {
  const id = profileImage?.documentId || profileImage?.id;

  if (!id) {
    return undefined;
  }

  return [
    id,
    profileImage.hash,
    profileImage.ext,
    profileImage.updatedAt,
    profileImage.url,
  ]
    .filter(Boolean)
    .join(':');
};

const getProfileImageSignedUrlCacheTtlMs = () =>
  getIntegerEnv('CANDIDATE_PROFILE_IMAGE_SIGNED_URL_CACHE_TTL_SECONDS', 300) * 1000;

const pruneExpiredProfileImageCache = (now = Date.now()) => {
  for (const [key, entry] of profileImageSignedUrlCache.entries()) {
    if (entry.expiresAt <= now) {
      profileImageSignedUrlCache.delete(key);
    }
  }
};

const sanitizeProfileImage = async (strapi, profileImage) => {
  if (!profileImage) {
    return null;
  }

  const now = Date.now();
  const cacheKey = getProfileImageCacheKey(profileImage);
  const cachedProfileImage = cacheKey ? profileImageSignedUrlCache.get(cacheKey) : undefined;

  if (cachedProfileImage && cachedProfileImage.expiresAt > now) {
    return {
      ...cachedProfileImage.value,
    };
  }

  pruneExpiredProfileImageCache(now);

  const signedProfileImage = await strapi
    .plugin('upload')
    .service('file')
    .signFileUrls(withRecoveredUploadPath(profileImage));

  if (!signedProfileImage) {
    return null;
  }

  const sanitizedProfileImage = {
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

  if (cacheKey) {
    profileImageSignedUrlCache.set(cacheKey, {
      expiresAt: now + getProfileImageSignedUrlCacheTtlMs(),
      value: sanitizedProfileImage,
    });
  }

  return sanitizedProfileImage;
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
  uid: string
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

  return records.map(sanitizePreferenceOption);
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

const firstPreferenceLabel = (value: unknown) => {
  const selection = preferenceSelection(value);
  const firstListedPreference = selection.selected.find((item) => item !== notListedPreferenceValue);

  if (firstListedPreference) {
    return preferenceLabel(firstListedPreference);
  }

  return selection.other;
};

const buildCandidatePreferenceSnapshot = (candidateOrPayload) => ({
  region: firstPreferenceLabel(candidateOrPayload?.classAreaPreferences),
  sector: firstPreferenceLabel(candidateOrPayload?.workSectorPreferences),
});

const normalizeComparableText = (value?: string) => value?.trim().toLowerCase();

const classRecordAreaValue = (classRecord) => {
  const value = classRecord.classArea?.slug || classRecord.classArea?.name || classRecord.region;
  return value ? normalizePreferenceValue(value) : undefined;
};

const classRecordSectorValue = (classRecord) => {
  const value = classRecord.workSector?.slug || classRecord.workSector?.name || classRecord.sector;
  return value ? normalizePreferenceValue(value) : undefined;
};

const classMatchesTarget = (classRecord, candidate?) => {
  const classAreaPreference = preferenceSelection(candidate?.classAreaPreferences);
  const workSectorPreference = preferenceSelection(candidate?.workSectorPreferences);
  const selectedRegions = selectedListedPreferences(candidate?.classAreaPreferences)
    .map(normalizeComparableText)
    .filter((value): value is string => Boolean(value));
  const selectedSectors = selectedListedPreferences(candidate?.workSectorPreferences)
    .map(normalizeComparableText)
    .filter((value): value is string => Boolean(value));
  const classRegion = classRecordAreaValue(classRecord);
  const classSector = classRecordSectorValue(classRecord);
  const regionMatches =
    selectedRegions.length > 0 && classRegion
      ? selectedRegions.includes(classRegion)
      : false;
  const sectorMatches =
    selectedSectors.length > 0 && classSector
      ? selectedSectors.includes(classSector)
      : false;

  return (
    classAreaPreference.selected.length > 0 &&
    workSectorPreference.selected.length > 0 &&
    Boolean(classRegion) &&
    Boolean(classSector) &&
    regionMatches &&
    sectorMatches
  );
};

const findMatchingClasses = async (strapi, candidate?) => {
  const classes = await strapi.documents('api::class.class').findMany({
    limit: 100,
    populate: ['classArea', 'workSector'],
    sort: ['startDate:asc', 'createdAt:desc'],
  } as any);

  return classes
    .filter((classRecord) => classMatchesTarget(classRecord, candidate))
    .filter((classRecord) => !terminalClassStatuses.has(classRecord.state))
    .filter((classRecord) => candidateVisibleClassStates.has(classRecord.state))
    .sort((firstClass, secondClass) => {
      const firstTime = firstClass.startDate ? Date.parse(firstClass.startDate) : Number.MAX_SAFE_INTEGER;
      const secondTime = secondClass.startDate ? Date.parse(secondClass.startDate) : Number.MAX_SAFE_INTEGER;

      return firstTime - secondTime;
    });
};

const findCandidateEnrollments = async (strapi, candidate) =>
  strapi.documents('api::enrollment.enrollment').findMany({
    filters: {
      candidate: {
        documentId: candidate.documentId,
      },
    },
    limit: 100,
    populate: ['class'],
    sort: ['createdAt:desc'],
  } as any);

const enrollmentClassDocumentId = (enrollment) => enrollment?.class?.documentId;

const enrollmentsByClassDocumentId = (enrollments = []) =>
  enrollments.reduce((map, enrollment) => {
    const classDocumentId = enrollmentClassDocumentId(enrollment);

    if (classDocumentId && !map.has(classDocumentId)) {
      map.set(classDocumentId, enrollment);
    }

    return map;
  }, new Map<string, unknown>());

const findClassInterestCounts = async (strapi, classes = []) => {
  const classDocumentIds = classes
    .map((classRecord) => classRecord.documentId)
    .filter((documentId): documentId is string => Boolean(documentId));

  if (classDocumentIds.length === 0) {
    return new Map<string, number>();
  }

  const enrollments = await strapi.documents('api::enrollment.enrollment').findMany({
    filters: {
      class: {
        documentId: {
          $in: classDocumentIds,
        },
      },
      status: {
        $in: interestCountEnrollmentStatuses,
      },
    },
    limit: 1000,
    populate: ['class'],
  } as any);

  return enrollments.reduce((map, enrollment) => {
    const classDocumentId = enrollmentClassDocumentId(enrollment);

    if (classDocumentId) {
      map.set(classDocumentId, (map.get(classDocumentId) || 0) + 1);
    }

    return map;
  }, new Map<string, number>());
};

const slugify = (value?: string) =>
  value
    ?.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || undefined;

const sanitizeIncludedItems = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '') : [];

const sanitizeFaqs = (value: unknown) =>
  Array.isArray(value)
    ? value
        .map((item) => objectValue(item))
        .map((item) => ({
          answer: typeof item.answer === 'string' ? item.answer : '',
          question: typeof item.question === 'string' ? item.question : '',
        }))
        .filter((item) => item.answer && item.question)
    : [];

const sanitizeCandidatePreferences = (candidate) => {
  const toPreferenceSummary = (selection) => [
    ...selection.selected
      .filter((item) => item !== notListedPreferenceValue)
      .map((item) => ({
        label: preferenceLabel(item) || item,
        value: item,
      })),
  ];

  return {
    classAreas: toPreferenceSummary(preferenceSelection(candidate?.classAreaPreferences)),
    workSectors: toPreferenceSummary(preferenceSelection(candidate?.workSectorPreferences)),
  };
};

const summarizeUnsupportedPreferences = (value: unknown) => {
  const selection = preferenceSelection(value);
  const listedCount = selectedListedPreferences(value).length;
  const hasNotListed = selection.selected.includes(notListedPreferenceValue);

  return {
    hasNotListed,
    listedCount,
    onlyNotListed: hasNotListed && listedCount === 0,
  };
};

const deriveCandidateLifecycleState = (enrollments = []) => {
  const activeEnrollment = enrollments.find((enrollment) => {
    if (terminalEnrollmentStatuses.has(enrollment.status)) {
      return false;
    }

    return enrollment.paymentStatus === 'paid' || paidEnrollmentStatuses.has(enrollment.status);
  });

  if (activeEnrollment) {
    return 'enrolled';
  }

  const passedEnrollment = enrollments.find(
    (enrollment) =>
      enrollment.passStatus === 'passed' ||
      Boolean(enrollment.passedAt) ||
      (completedEnrollmentStatuses.has(enrollment.status) && enrollment.passStatus !== 'failed')
  );

  return passedEnrollment ? 'alumni' : 'unenrolled';
};

const findActiveEnrollment = (enrollments = []) =>
  enrollments.find((enrollment) => {
    if (terminalEnrollmentStatuses.has(enrollment.status)) {
      return false;
    }

    return enrollment.paymentStatus === 'paid' || paidEnrollmentStatuses.has(enrollment.status);
  });

const sanitizeClass = (classRecord) => {
  if (!classRecord) {
    return null;
  }

  const region = classRecord.classArea?.name || classRecord.region;
  const sector = classRecord.workSector?.name || classRecord.sector;

  return {
    capacity: classRecord.capacity,
    currency: classRecord.currency,
    discountedPricePence: classRecord.discountedPricePence,
    documentId: classRecord.documentId,
    endDate: classRecord.endDate,
    faqs: sanitizeFaqs(classRecord.faqs),
    includedItems: sanitizeIncludedItems(classRecord.includedItems),
    interviewsGuaranteed: classRecord.interviewsGuaranteed,
    moduleSummary: classRecord.moduleSummary,
    name: classRecord.name,
    overview: classRecord.overview,
    pricePence: classRecord.pricePence,
    quarter: classRecord.quarter,
    region,
    requirements: classRecord.requirements,
    scheduleNotes: classRecord.scheduleNotes,
    sector,
    slug: classRecord.slug || slugify(classRecord.name),
    startDate: classRecord.startDate,
    state: classRecord.state,
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
    interestRegisteredAt: enrollment.interestRegisteredAt || enrollment.metadata?.registeredInterestAt,
    invitedToJoinAt: enrollment.invitedToJoinAt,
    passStatus: enrollment.passStatus,
    paymentStatus: enrollment.paymentStatus,
    status: enrollment.status,
  };
};

const classHasPaymentAccess = (classRecord) => classRecord?.state === 'open';

const deriveClassRelationshipState = (enrollment, classRecord?) => {
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

    if (classHasPaymentAccess(enrollment.class || classRecord)) {
      return 'payment_available';
    }

    return 'waiting_for_class';
  }

  if (classHasPaymentAccess(classRecord)) {
    return 'payment_available';
  }

  return 'not_registered';
};

const buildClassTimeline = (classRecord, relationshipState) => {
  const enrollmentOpen =
    classHasPaymentAccess(classRecord) ||
    ['full', 'in_progress', 'completion_window', 'interview_window', 'completed'].includes(classRecord?.state);
  const classStarted =
    ['in_progress', 'completion_window', 'interview_window', 'completed'].includes(classRecord?.state);
  const interviewsActive = ['interview_window'].includes(classRecord?.state);
  const interviewsComplete = classRecord?.state === 'completed';
  const placeSecured = relationshipState === 'place_secured';
  const hasRegisteredInterest = relationshipState !== 'not_registered';

  return [
    {
      key: 'interest',
      label: 'Register Interest',
      state: hasRegisteredInterest ? 'complete' : 'current',
    },
    {
      key: 'enrollment_open',
      label: 'Enrollment open',
      state: placeSecured ? 'complete' : enrollmentOpen || hasRegisteredInterest ? 'current' : 'upcoming',
    },
    {
      key: 'place_secured',
      label: 'Place secured',
      state: placeSecured ? (classStarted ? 'complete' : 'current') : 'upcoming',
    },
    {
      key: 'class',
      label: 'Class starts',
      state: classStarted ? (interviewsActive || interviewsComplete ? 'complete' : 'current') : 'upcoming',
    },
    {
      key: 'interviews',
      label: 'Interviews',
      state: interviewsComplete ? 'complete' : interviewsActive ? 'current' : 'upcoming',
    },
  ];
};

const buildClassRelationship = ({ classRecord, enrollment, registeredInterestCount = 0 }) => {
  const state = deriveClassRelationshipState(enrollment, classRecord);

  return {
    canRegisterInterest: state === 'not_registered',
    canJoinClass: state === 'payment_available',
    class: sanitizeClass(classRecord),
    enrollment: sanitizeEnrollment(enrollment),
    registeredInterestCount,
    state,
    timeline: buildClassTimeline(classRecord, state),
  };
};

const summarizeClassInterestState = (classRelationships = [], activeEnrollment?) => {
  if (activeEnrollment) {
    return 'place_secured';
  }

  if (classRelationships.some((relationship) => relationship.state === 'payment_available')) {
    return 'payment_available';
  }

  if (classRelationships.some((relationship) => relationship.state === 'waiting_for_class')) {
    return 'waiting_for_class';
  }

  if (classRelationships.some((relationship) => relationship.state === 'interest_registered')) {
    return 'interest_registered';
  }

  return 'not_registered';
};

const buildClassInterestResponse = ({ candidate, enrollments, interestCounts, matchingClasses }) => {
  const enrollmentMap = enrollmentsByClassDocumentId(enrollments);
  const classRelationships = matchingClasses.map((classRecord) =>
    buildClassRelationship({
      classRecord,
      enrollment: enrollmentMap.get(classRecord.documentId),
      registeredInterestCount: interestCounts?.get(classRecord.documentId) || 0,
    })
  );
  const activeEnrollment = findActiveEnrollment(enrollments);
  const activeClass =
    activeEnrollment?.class &&
    (matchingClasses.find((classRecord) => classRecord.documentId === activeEnrollment.class.documentId) ||
      activeEnrollment.class);
  const state = summarizeClassInterestState(classRelationships, activeEnrollment);
  const firstRelationship = classRelationships[0];

  return {
    activeClass: sanitizeClass(activeClass),
    activeEnrollment: sanitizeEnrollment(activeEnrollment),
    canRegisterInterest: firstRelationship?.canRegisterInterest || false,
    candidate: {
      documentId: candidate.documentId,
      lifecycleState: deriveCandidateLifecycleState(enrollments),
      preferences: sanitizeCandidatePreferences(candidate),
      registeredInterestAt: candidate.registeredInterestAt,
      status: candidate.status,
      unsupportedPreferences: {
        classAreas: summarizeUnsupportedPreferences(candidate.classAreaPreferences),
        workSectors: summarizeUnsupportedPreferences(candidate.workSectorPreferences),
      },
    },
    class: firstRelationship?.class || null,
    classes: classRelationships,
    enrollment: firstRelationship?.enrollment || null,
    filters: sanitizeCandidatePreferences(candidate),
    state,
    target: firstRelationship?.class || null,
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
      getVisiblePreferenceOptions(strapi, 'api::class-area.class-area'),
      getVisiblePreferenceOptions(strapi, 'api::work-sector.work-sector'),
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
    const preferenceSnapshot = buildCandidatePreferenceSnapshot({
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
      region: preferenceSnapshot.region,
      sector: preferenceSnapshot.sector,
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

    const matchingClasses = await findMatchingClasses(strapi, existingCandidate);
    const [enrollments, interestCounts] = await Promise.all([
      findCandidateEnrollments(strapi, existingCandidate),
      findClassInterestCounts(strapi, matchingClasses),
    ]);

    return buildClassInterestResponse({
      candidate: existingCandidate,
      enrollments,
      interestCounts,
      matchingClasses,
    });
  },

  async registerCurrentCandidateClassInterest(
    auth: Auth0State | undefined,
    input: unknown = {},
    requestContext: RequestContext = {}
  ) {
    if (!auth || auth.type !== 'auth0' || !auth.subject) {
      throw new UnauthorizedError('Auth0 authentication is required.');
    }

    const existingCandidate = await findCandidateByAuthIdentity(strapi, auth.subject);

    if (!existingCandidate) {
      throw new ValidationError('Candidate account must be synced before class interest can be registered.');
    }

    const payload = validateRegisterClassInterest(input ?? {});
    const matchingClasses = await findMatchingClasses(strapi, existingCandidate);
    const targetClass = payload.classDocumentId
      ? matchingClasses.find((classRecord) => classRecord.documentId === payload.classDocumentId)
      : matchingClasses[0];

    if (!targetClass) {
      throw new ValidationError('No matching class is currently available for the selected preferences.');
    }

    const existingEnrollments = await findCandidateEnrollments(strapi, existingCandidate);
    const existingEnrollment = enrollmentsByClassDocumentId(existingEnrollments).get(targetClass.documentId);
    const currentState = deriveClassRelationshipState(existingEnrollment, targetClass);

    if (currentState !== 'not_registered') {
      const interestCounts = await findClassInterestCounts(strapi, matchingClasses);

      return {
        created: false,
        data: buildClassInterestResponse({
          candidate: existingCandidate,
          enrollments: existingEnrollments,
          interestCounts,
          matchingClasses,
        }),
      };
    }

    const now = new Date().toISOString();
    let enrollment;
    const preferenceSnapshot = buildCandidatePreferenceSnapshot(existingCandidate);
    const candidateUpdates: Record<string, unknown> = {
      registeredInterestAt: existingCandidate.registeredInterestAt || now,
      region: existingCandidate.region || preferenceSnapshot.region,
      sector: existingCandidate.sector || preferenceSnapshot.sector,
      status: existingCandidate.status === 'account_created' ? 'interest_registered' : existingCandidate.status,
    };

    enrollment = await strapi.documents('api::enrollment.enrollment').create({
      data: {
        candidate: {
          connect: [{ documentId: existingCandidate.documentId }],
        },
        class: {
          connect: [{ documentId: targetClass.documentId }],
        },
        completionStatus: 'not_started',
        interestRegisteredAt: now,
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

    const updatedCandidate = await strapi.documents('api::candidate.candidate').update({
      documentId: existingCandidate.documentId,
      data: candidateUpdates as any,
      populate: candidatePopulate,
    } as any);

    const nextEnrollments = [
      enrollment,
      ...existingEnrollments.filter((item) => item.documentId !== enrollment.documentId),
    ];
    const interestCounts = await findClassInterestCounts(strapi, matchingClasses);
    const response = buildClassInterestResponse({
      candidate: updatedCandidate,
      enrollments: nextEnrollments,
      interestCounts,
      matchingClasses,
    });

    await (strapi.service('api::audit-event.audit-event') as any).record({
      actorEmail: updatedCandidate.email,
      actorId: auth.subject,
      actorType: 'candidate',
      eventCategory: 'candidate',
      eventType: 'candidate.class_interest_registered',
      ipAddress: requestContext.ipAddress,
      metadata: {
        class: sanitizeClass(targetClass),
        preferences: preferenceSnapshot,
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

  async createCurrentCandidateUnlistedInterest(
    auth: Auth0State | undefined,
    input: unknown = {},
    requestContext: RequestContext = {}
  ) {
    if (!auth || auth.type !== 'auth0' || !auth.subject) {
      throw new UnauthorizedError('Auth0 authentication is required.');
    }

    const existingCandidate = await findCandidateByAuthIdentity(strapi, auth.subject);

    if (!existingCandidate) {
      throw new ValidationError('Candidate account must be synced before an unlisted interest can be submitted.');
    }

    const payload = validateCreateUnlistedInterest(input ?? {});
    const now = new Date().toISOString();
    const preferenceSnapshot = buildCandidatePreferenceSnapshot(existingCandidate);
    const unlistedInterest = await strapi.documents('api::unlisted-interest.unlisted-interest').create({
      data: {
        candidate: {
          connect: [{ documentId: existingCandidate.documentId }],
        },
        candidateEmail: existingCandidate.email,
        interestType: payload.interestType,
        metadata: {
          preferences: {
            classAreaPreferences: existingCandidate.classAreaPreferences,
            workSectorPreferences: existingCandidate.workSectorPreferences,
          },
          snapshot: preferenceSnapshot,
        },
        source: payload.source,
        status: 'new',
        suggestedValue: payload.suggestedValue,
      } as any,
    } as any);
    const response = {
      candidateEmail: unlistedInterest.candidateEmail,
      documentId: unlistedInterest.documentId,
      interestType: unlistedInterest.interestType,
      source: unlistedInterest.source,
      status: unlistedInterest.status,
      suggestedValue: unlistedInterest.suggestedValue,
    };

    await (strapi.service('api::audit-event.audit-event') as any).record({
      actorEmail: existingCandidate.email,
      actorId: auth.subject,
      actorType: 'candidate',
      eventCategory: 'candidate',
      eventType: 'candidate.unlisted_interest_created',
      ipAddress: requestContext.ipAddress,
      metadata: {
        interestType: payload.interestType,
        source: payload.source,
        suggestedValue: payload.suggestedValue,
      },
      newState: response,
      occurredAt: now,
      requestId: requestContext.requestId,
      source: 'candidate_dashboard',
      subjectDisplayName: payload.suggestedValue,
      subjectId: unlistedInterest.documentId,
      subjectType: 'unlisted_interest',
      userAgent: requestContext.userAgent,
    });

    return response;
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

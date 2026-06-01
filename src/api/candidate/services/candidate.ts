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

type StrapiDocumentService = {
  documents(uid: string): unknown;
  service(uid: string): unknown;
};

type DocumentRecord = Record<string, unknown> & {
  accountCreatedAt?: string;
  accountOnboardingCompletedAt?: string;
  accountRestrictionStatus?: string;
  amountPence?: number;
  authIdentityId?: string;
  candidate?: DocumentRecord;
  candidateEmail?: string;
  capacity?: number;
  class?: DocumentRecord;
  classArea?: DocumentRecord;
  classAreaPreferences?: unknown;
  completionStatus?: string;
  currency?: string;
  displayTitle?: string;
  documentId?: string;
  email?: string;
  enrollment?: DocumentRecord;
  expiresAt?: string;
  firstName?: string;
  id?: number;
  interestRegisteredAt?: string;
  interestType?: string;
  invitedToJoinAt?: string;
  lastName?: string;
  level?: string;
  marketingConsentCapturedAt?: string;
  marketingConsentState?: string;
  marketingConsentWordingVersion?: string;
  metadata?: unknown;
  name?: string;
  notificationPreferences?: unknown;
  passStatus?: string;
  paidAt?: string;
  paymentStatus?: string;
  paymentType?: string;
  phone?: string;
  pricePence?: number;
  discountedPricePence?: number;
  preferredCommunicationChannel?: (typeof communicationChannels)[number];
  profileImage?: DocumentRecord;
  profileSettings?: unknown;
  providerCheckoutSessionId?: string;
  providerCustomerId?: string;
  providerPaymentIntentId?: string;
  registeredInterestAt?: string;
  region?: string;
  reservationExpiresAt?: string;
  reservationDocumentId?: string;
  sector?: string;
  slug?: string;
  startDate?: string;
  source?: string;
  state?: string;
  status?: string;
  suggestedValue?: string;
  waitingListPosition?: number;
  workSector?: DocumentRecord;
  workSectorPreferences?: unknown;
};

type DocumentCollection = {
  create(input: Record<string, unknown>): Promise<DocumentRecord>;
  findMany(input: Record<string, unknown>): Promise<DocumentRecord[]>;
  update(input: Record<string, unknown>): Promise<DocumentRecord>;
};

type AuditEventService = {
  record(input: Record<string, unknown>): Promise<unknown>;
};

const documents = (strapi: StrapiDocumentService, uid: string) =>
  strapi.documents(uid) as unknown as DocumentCollection;
const auditEvents = (strapi: StrapiDocumentService) =>
  strapi.service('api::audit-event.audit-event') as unknown as AuditEventService;

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

const restrictedCandidateStatuses = new Set(['suspended', 'blacklisted']);
const terminalEnrollmentStatuses = new Set([
  'withdrawn',
  'refunded',
  'removed_no_refund',
  'removed_partial_refund',
  'removed_full_refund',
  'expired',
  'archived',
]);
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
const paidEnrollmentStatuses = new Set(['enrolled', 'in_class', 'interview_phase', 'completed', 'active']);
const completedEnrollmentStatuses = new Set(['completed']);
const capacityHoldingEnrollmentStatuses = new Set(['place_reserved', 'enrolled', 'in_class', 'interview_phase', 'completed']);
const candidateRelationshipClassStates = new Set(['coming_soon', 'waitlist_open', 'open']);
const candidateRelationshipEnrollmentStatuses = new Set([
  'interest_registered',
  'enrollment_open',
  'place_reserved',
  'waiting_list',
  'waitlisted',
]);
const interestCountEnrollmentStatuses = [
  'interest_registered',
  'enrollment_open',
  'place_reserved',
  'waiting_list',
  'enrolled',
  'in_class',
  'interview_phase',
  'completed',
  'waitlisted',
  'slot_reserved',
  'active',
];

const enrollmentStatusAliases: Record<string, string> = {
  active: 'in_class',
  archived: 'withdrawn',
  expired: 'waiting_list',
  slot_reserved: 'place_reserved',
  waitlisted: 'interest_registered',
};

const normalizeEnrollmentStatus = (status?: string) =>
  status ? enrollmentStatusAliases[status] || status : undefined;

const isCandidateRestricted = (candidate) =>
  restrictedCandidateStatuses.has(candidate?.accountRestrictionStatus) ||
  restrictedCandidateStatuses.has(candidate?.status);

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

const getReservationWindowMs = () => getIntegerEnv('CLASS_RESERVATION_WINDOW_SECONDS', 10 * 60) * 1000;

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

const reserveClassPlaceSchema = z
  .object({
    classDocumentId: z.string().trim().min(1).max(80),
  })
  .strict();

const validateReserveClassPlace = validateZodSchema(reserveClassPlaceSchema);

const confirmClassReservationPaymentSchema = z
  .object({
    checkoutSessionId: z.string().trim().min(1).max(255),
  })
  .strict();

const validateConfirmClassReservationPayment = validateZodSchema(confirmClassReservationPaymentSchema);

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
  accountRestrictionStatus: candidate.accountRestrictionStatus || 'active',
  accountRestrictionReason: candidate.accountRestrictionReason,
  accountRestrictionMessage: candidate.accountRestrictionMessage,
  accountRestrictionAppealStatus: candidate.accountRestrictionAppealStatus || 'not_applicable',
  accountRestrictedAt: candidate.accountRestrictedAt,
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

const findCandidateByAuthIdentity = async (strapi: StrapiDocumentService, authIdentityId: string) => {
  const candidates = await documents(strapi, 'api::candidate.candidate').findMany({
    filters: {
      authIdentityId,
    },
    limit: 1,
    populate: candidatePopulate,
  });

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

const sanitizePreferenceOption = (record: DocumentRecord) => {
  const label = record.name || 'Unnamed option';
  const state = visiblePreferenceStates.includes(record.state as (typeof visiblePreferenceStates)[number])
    ? record.state
    : 'active';

  return {
    label,
    state,
    value: normalizePreferenceValue(record.slug || label),
  };
};

const getVisiblePreferenceOptions = async (
  strapi: StrapiDocumentService,
  uid: string
) => {
  const records = await documents(strapi, uid).findMany({
    filters: {
      state: {
        $in: visiblePreferenceStates,
      },
    },
    limit: 100,
    sort: ['sortOrder:asc', 'name:asc'],
  });

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

const findMatchingClasses = async (strapi: StrapiDocumentService, candidate?: DocumentRecord) => {
  const classes = await documents(strapi, 'api::class.class').findMany({
    limit: 100,
    populate: ['classArea', 'workSector'],
    sort: ['startDate:asc', 'createdAt:desc'],
  });

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

const sortClassesByStartDate = (classes: DocumentRecord[] = []) =>
  [...classes].sort((firstClass, secondClass) => {
    const firstTime = firstClass.startDate ? Date.parse(firstClass.startDate) : Number.MAX_SAFE_INTEGER;
    const secondTime = secondClass.startDate ? Date.parse(secondClass.startDate) : Number.MAX_SAFE_INTEGER;

    return firstTime - secondTime;
  });

const mergeClassesByDocumentId = (...classGroups: DocumentRecord[][]) => {
  const classMap = new Map<string, DocumentRecord>();

  for (const classGroup of classGroups) {
    for (const classRecord of classGroup) {
      if (classRecord.documentId && !classMap.has(classRecord.documentId)) {
        classMap.set(classRecord.documentId, classRecord);
      }
    }
  }

  return sortClassesByStartDate([...classMap.values()]);
};

const findCandidateEnrollments = async (strapi: StrapiDocumentService, candidate: DocumentRecord) =>
  documents(strapi, 'api::enrollment.enrollment').findMany({
    filters: {
      candidate: {
        documentId: candidate.documentId,
      },
    },
    limit: 100,
    populate: ['class'],
    sort: ['createdAt:desc'],
  });

const enrollmentClassDocumentId = (enrollment) => enrollment?.class?.documentId;

const relationshipClassDocumentIds = (enrollments: DocumentRecord[] = []) =>
  enrollments
    .filter((enrollment) => candidateRelationshipEnrollmentStatuses.has(normalizeEnrollmentStatus(enrollment.status)))
    .map(enrollmentClassDocumentId)
    .filter((documentId): documentId is string => Boolean(documentId));

const findRelationshipClasses = async (strapi: StrapiDocumentService, enrollments: DocumentRecord[] = []) => {
  const classDocumentIds = [...new Set(relationshipClassDocumentIds(enrollments))];

  if (classDocumentIds.length === 0) {
    return [];
  }

  const classes = await documents(strapi, 'api::class.class').findMany({
    filters: {
      documentId: {
        $in: classDocumentIds,
      },
    },
    limit: 100,
    populate: ['classArea', 'workSector'],
    sort: ['startDate:asc', 'createdAt:desc'],
  });

  return sortClassesByStartDate(
    classes
      .filter((classRecord) => !terminalClassStatuses.has(classRecord.state))
      .filter((classRecord) => candidateRelationshipClassStates.has(classRecord.state))
  );
};

const enrollmentsByClassDocumentId = (enrollments: DocumentRecord[] = []) =>
  enrollments.reduce((map, enrollment) => {
    const classDocumentId = enrollmentClassDocumentId(enrollment);

    if (classDocumentId && !map.has(classDocumentId)) {
      map.set(classDocumentId, enrollment);
    }

    return map;
  }, new Map<string, DocumentRecord>());

const findClassInterestCounts = async (strapi: StrapiDocumentService, classes: DocumentRecord[] = []) => {
  const classDocumentIds = classes
    .map((classRecord) => classRecord.documentId)
    .filter((documentId): documentId is string => Boolean(documentId));

  if (classDocumentIds.length === 0) {
    return new Map<string, number>();
  }

  const enrollments = await documents(strapi, 'api::enrollment.enrollment').findMany({
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
  });

  return enrollments.reduce((map, enrollment) => {
    const classDocumentId = enrollmentClassDocumentId(enrollment);

    if (classDocumentId) {
      map.set(classDocumentId, (map.get(classDocumentId) || 0) + 1);
    }

    return map;
  }, new Map<string, number>());
};

const isPastDate = (value?: string) => Boolean(value && Date.parse(value) <= Date.now());

const getReservationExpiry = (now = new Date()) => new Date(now.getTime() + getReservationWindowMs()).toISOString();

type PaymentAction = {
  canCreateCheckoutSession: boolean;
  checkoutSessionId?: string;
  checkoutUrl?: string;
  kind: string;
  label: string;
  paymentDocumentId?: string;
};

type CheckoutSession = {
  checkoutSessionId: string;
  checkoutUrl: string;
  paymentProvider: string;
  status?: string;
};

type PaymentServiceCheckoutResponse = {
  data?: {
    checkoutSessionId?: unknown;
    checkoutUrl?: unknown;
    paymentProvider?: unknown;
    status?: unknown;
  };
};

type PaymentServiceCheckoutConfirmation = {
  amountTotal?: number;
  checkoutSessionId: string;
  checkoutUrl?: string | null;
  clientReferenceId?: string | null;
  currency?: string | null;
  customerId?: string;
  metadata: Record<string, unknown>;
  paymentIntentId?: string;
  paymentProvider: string;
  paymentStatus: string;
  status: string;
};

type PaymentServiceCheckoutConfirmationResponse = {
  data?: {
    amountTotal?: unknown;
    checkoutSessionId?: unknown;
    checkoutUrl?: unknown;
    clientReferenceId?: unknown;
    currency?: unknown;
    customerId?: unknown;
    metadata?: unknown;
    paymentIntentId?: unknown;
    paymentProvider?: unknown;
    paymentStatus?: unknown;
    status?: unknown;
  };
};

const classPaymentAmount = (classRecord?: DocumentRecord) =>
  classRecord?.discountedPricePence ?? classRecord?.pricePence ?? 0;

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

const optionalStringOrNull = (value: unknown): string | null | undefined => {
  if (typeof value === 'string') {
    return value;
  }

  if (value === null) {
    return null;
  }

  return undefined;
};

const buildDashboardCheckoutUrl = (reservationDocumentId: string, status: string) => {
  const baseUrl = trimTrailingSlash(process.env.CANDIDATE_DASHBOARD_BASE_URL || 'http://localhost:3001');
  const url = new URL(`${baseUrl}/class/checkout/${reservationDocumentId}`);

  url.searchParams.set('payment', status);

  if (status === 'success') {
    url.searchParams.set('session_id', '{CHECKOUT_SESSION_ID}');
  }

  return url.toString().replace('%7BCHECKOUT_SESSION_ID%7D', '{CHECKOUT_SESSION_ID}');
};

const buildDashboardOrderConfirmedUrl = (reservationDocumentId: string) => {
  const baseUrl = trimTrailingSlash(process.env.CANDIDATE_DASHBOARD_BASE_URL || 'http://localhost:3001');
  const url = new URL(`${baseUrl}/class/order-confirmed/${reservationDocumentId}`);

  url.searchParams.set('session_id', '{CHECKOUT_SESSION_ID}');

  return url.toString().replace('%7BCHECKOUT_SESSION_ID%7D', '{CHECKOUT_SESSION_ID}');
};

const getNextWaitingListPosition = async (strapi, classRecord, candidate?) => {
  const waitingListEnrollments = await documents(strapi, 'api::enrollment.enrollment').findMany({
    filters: {
      class: {
        documentId: classRecord.documentId,
      },
      status: 'waiting_list',
    },
    limit: 1000,
    sort: ['waitingListPosition:desc', 'createdAt:asc'],
    populate: ['candidate'],
  });

  const existingWaitingEnrollment = waitingListEnrollments.find(
    (enrollment) => enrollment.candidate?.documentId === candidate?.documentId
  );

  if (existingWaitingEnrollment?.waitingListPosition) {
    return existingWaitingEnrollment.waitingListPosition;
  }

  const highestPosition = waitingListEnrollments.reduce(
    (position, enrollment) => Math.max(position, enrollment.waitingListPosition || 0),
    0
  );

  return highestPosition + 1;
};

const hasWaitingListAhead = async (strapi, classRecord, candidate?) => {
  const waitingListEnrollments = await documents(strapi, 'api::enrollment.enrollment').findMany({
    filters: {
      class: {
        documentId: classRecord.documentId,
      },
      status: 'waiting_list',
    },
    limit: 1,
    populate: ['candidate'],
  });

  return waitingListEnrollments.some((enrollment) => enrollment.candidate?.documentId !== candidate?.documentId);
};

const findActiveReservationForEnrollment = async (strapi, enrollment) => {
  if (!enrollment?.documentId) {
    return undefined;
  }

  const reservations = await documents(strapi, 'api::reservation.reservation').findMany({
    filters: {
      enrollment: {
        documentId: enrollment.documentId,
      },
      status: 'active',
    },
    limit: 1,
    populate: ['candidate', 'class', 'enrollment'],
    sort: ['createdAt:desc'],
  });

  return reservations[0];
};

const findCandidateReservation = async (strapi, candidate, reservationDocumentId: string) => {
  const reservations = await documents(strapi, 'api::reservation.reservation').findMany({
    filters: {
      candidate: {
        documentId: candidate.documentId,
      },
      documentId: reservationDocumentId,
    },
    limit: 1,
    populate: ['candidate', 'class', 'enrollment'],
  });

  return reservations[0];
};

const countCapacityHeldPlaces = async (strapi, classRecord) => {
  const enrollments = await documents(strapi, 'api::enrollment.enrollment').findMany({
    filters: {
      class: {
        documentId: classRecord.documentId,
      },
      status: {
        $in: Array.from(capacityHoldingEnrollmentStatuses),
      },
    },
    limit: 1000,
    populate: ['class'],
  });

  return enrollments.filter((enrollment) => {
    if (normalizeEnrollmentStatus(enrollment.status) !== 'place_reserved') {
      return true;
    }

    return !isPastDate(enrollment.reservationExpiresAt);
  }).length;
};

const countPaidClassPlaces = async (
  strapi: StrapiDocumentService,
  classRecord?: DocumentRecord
) => {
  if (!classRecord?.documentId) {
    return 0;
  }

  const enrollments = await documents(strapi, 'api::enrollment.enrollment').findMany({
    filters: {
      class: {
        documentId: classRecord.documentId,
      },
      status: {
        $in: Array.from(paidEnrollmentStatuses),
      },
    },
    limit: 1000,
    populate: ['class'],
  });

  return enrollments.length;
};

const closeClassIfCapacityReached = async (
  strapi: StrapiDocumentService,
  classRecord?: DocumentRecord
) => {
  if (!classRecord?.documentId || classRecord.state !== 'open') {
    return classRecord;
  }

  const paidPlaces = await countPaidClassPlaces(strapi, classRecord);

  if (typeof classRecord.capacity !== 'number' || paidPlaces < classRecord.capacity) {
    return classRecord;
  }

  return documents(strapi, 'api::class.class').update({
    documentId: classRecord.documentId,
    data: {
      state: 'full',
    },
    populate: ['classArea', 'workSector'],
  });
};

const sanitizeReservation = (reservation) => {
  if (!reservation) {
    return null;
  }

  return {
    amountPence: reservation.amountPence,
    cancelledAt: reservation.cancelledAt,
    class: sanitizeClass(reservation.class),
    currency: reservation.currency,
    documentId: reservation.documentId,
    enrollment: sanitizeEnrollment(reservation.enrollment),
    expiredAt: reservation.expiredAt,
    expiresAt: reservation.expiresAt,
    paidAt: reservation.paidAt,
    reservationStartedAt: reservation.reservationStartedAt,
    status: reservation.status,
    termsAcceptedAt: reservation.termsAcceptedAt,
    termsVersion: reservation.termsVersion,
  };
};

const sanitizePayment = (payment) => {
  if (!payment) {
    return null;
  }

  return {
    amountPence: payment.amountPence,
    currency: payment.currency,
    documentId: payment.documentId,
    paidAt: payment.paidAt,
    paymentProvider: payment.paymentProvider,
    paymentType: payment.paymentType,
    providerCheckoutSessionId: payment.providerCheckoutSessionId,
    providerPaymentIntentId: payment.providerPaymentIntentId,
    status: payment.status,
  };
};

const disabledPaymentAction = (label: string, kind = 'unavailable'): PaymentAction => ({
  canCreateCheckoutSession: false,
  kind,
  label,
});

const stripeCheckoutAction = (payment: DocumentRecord, checkoutSession: CheckoutSession): PaymentAction => ({
  canCreateCheckoutSession: true,
  checkoutSessionId: checkoutSession.checkoutSessionId,
  checkoutUrl: checkoutSession.checkoutUrl,
  kind: 'stripe_checkout',
  label: 'Pay here',
  paymentDocumentId: payment.documentId,
});

const findCheckoutPaymentForReservation = async (
  strapi: StrapiDocumentService,
  reservation?: DocumentRecord
) => {
  if (!reservation?.documentId) {
    return undefined;
  }

  const payments = await documents(strapi, 'api::payment.payment').findMany({
    filters: {
      reservation: {
        documentId: reservation.documentId,
      },
      status: {
        $in: ['checkout_created', 'pending'],
      },
    },
    limit: 1,
    sort: ['createdAt:desc'],
  });

  return payments[0];
};

const findPaymentForCheckoutSession = async (
  strapi: StrapiDocumentService,
  checkoutSessionId: string
) => {
  const payments = await documents(strapi, 'api::payment.payment').findMany({
    filters: {
      providerCheckoutSessionId: checkoutSessionId,
    },
    limit: 1,
    sort: ['createdAt:desc'],
  });

  return payments[0];
};

const checkoutSessionFromPayment = (payment?: DocumentRecord): CheckoutSession | undefined => {
  const metadata = objectValue(payment?.metadata);
  const checkoutUrl = typeof metadata.checkoutUrl === 'string' ? metadata.checkoutUrl : undefined;
  const checkoutSessionId =
    typeof payment?.providerCheckoutSessionId === 'string' ? payment.providerCheckoutSessionId : undefined;

  if (!checkoutUrl || !checkoutSessionId) {
    return undefined;
  }

  return {
    checkoutSessionId,
    checkoutUrl,
    paymentProvider: 'stripe',
  };
};

const requestPaymentServiceCheckoutSession = async ({
  candidate,
  reservation,
}: {
  candidate: DocumentRecord;
  reservation: DocumentRecord;
}): Promise<CheckoutSession | undefined> => {
  const baseUrl = process.env.PAYMENT_SERVICE_URL;
  const serviceToken = process.env.PAYMENT_SERVICE_TOKEN;

  if (!baseUrl || !serviceToken) {
    return undefined;
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    getIntegerEnv('PAYMENT_SERVICE_TIMEOUT_MS', 5000)
  );
  const classRecord = reservation.class;
  const className = classRecord?.displayTitle || classRecord?.name || 'HireFlip class';

  try {
    const response = await fetch(`${trimTrailingSlash(baseUrl)}/internal/checkout-sessions`, {
      body: JSON.stringify({
        amountPence: reservation.amountPence,
        cancelUrl: buildDashboardCheckoutUrl(reservation.documentId, 'cancelled'),
        candidateDocumentId: candidate.documentId,
        candidateEmail: candidate.email,
        classDocumentId: classRecord?.documentId,
        className,
        currency: reservation.currency,
        enrollmentDocumentId: reservation.enrollment?.documentId,
        expiresAt: reservation.expiresAt,
        reservationDocumentId: reservation.documentId,
        successUrl: buildDashboardOrderConfirmedUrl(reservation.documentId),
      }),
      headers: {
        'content-type': 'application/json',
        'x-hireflip-service-name': 'core-api',
        'x-hireflip-service-token': serviceToken,
      },
      method: 'POST',
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => null)) as PaymentServiceCheckoutResponse | null;

    if (
      !response.ok ||
      typeof payload?.data?.checkoutUrl !== 'string' ||
      typeof payload?.data?.checkoutSessionId !== 'string'
    ) {
      return undefined;
    }

    return {
      checkoutSessionId: payload.data.checkoutSessionId,
      checkoutUrl: payload.data.checkoutUrl,
      paymentProvider: typeof payload.data.paymentProvider === 'string' ? payload.data.paymentProvider : 'stripe',
      status: typeof payload.data.status === 'string' ? payload.data.status : undefined,
    };
  } finally {
    clearTimeout(timeout);
  }
};

const requestPaymentServiceCheckoutConfirmation = async (
  checkoutSessionId: string
): Promise<PaymentServiceCheckoutConfirmation | undefined> => {
  const baseUrl = process.env.PAYMENT_SERVICE_URL;
  const serviceToken = process.env.PAYMENT_SERVICE_TOKEN;

  if (!baseUrl || !serviceToken) {
    return undefined;
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    getIntegerEnv('PAYMENT_SERVICE_TIMEOUT_MS', 5000)
  );

  try {
    const response = await fetch(
      `${trimTrailingSlash(baseUrl)}/internal/checkout-sessions/${encodeURIComponent(checkoutSessionId)}`,
      {
        headers: {
          'x-hireflip-service-name': 'core-api',
          'x-hireflip-service-token': serviceToken,
        },
        method: 'GET',
        signal: controller.signal,
      }
    );
    const payload = (await response.json().catch(() => null)) as
      | PaymentServiceCheckoutConfirmationResponse
      | null;
    const data = payload?.data;

    if (
      !response.ok ||
      typeof data?.checkoutSessionId !== 'string' ||
      typeof data?.paymentStatus !== 'string' ||
      typeof data?.status !== 'string'
    ) {
      return undefined;
    }

    return {
      amountTotal: typeof data.amountTotal === 'number' ? data.amountTotal : undefined,
      checkoutSessionId: data.checkoutSessionId,
      checkoutUrl: optionalStringOrNull(data.checkoutUrl),
      clientReferenceId: optionalStringOrNull(data.clientReferenceId),
      currency: optionalStringOrNull(data.currency),
      customerId: typeof data.customerId === 'string' ? data.customerId : undefined,
      metadata: objectValue(data.metadata),
      paymentIntentId: typeof data.paymentIntentId === 'string' ? data.paymentIntentId : undefined,
      paymentProvider: typeof data.paymentProvider === 'string' ? data.paymentProvider : 'stripe',
      paymentStatus: data.paymentStatus,
      status: data.status,
    };
  } finally {
    clearTimeout(timeout);
  }
};

const getPaymentActionForReservation = async ({
  candidate,
  requestContext,
  reservation,
  strapi,
}: {
  candidate: DocumentRecord;
  requestContext: RequestContext;
  reservation?: DocumentRecord;
  strapi: StrapiDocumentService;
}): Promise<PaymentAction> => {
  if (!reservation) {
    return disabledPaymentAction('Reservation could not be found.');
  }

  if (reservation.status !== 'active') {
    return disabledPaymentAction('This reservation is no longer active.', 'reservation_inactive');
  }

  if (isPastDate(reservation.expiresAt)) {
    return disabledPaymentAction('This reservation has expired.', 'reservation_expired');
  }

  const existingPayment = await findCheckoutPaymentForReservation(strapi, reservation);
  const existingCheckoutSession = checkoutSessionFromPayment(existingPayment);

  if (existingPayment && existingCheckoutSession) {
    return stripeCheckoutAction(existingPayment, existingCheckoutSession);
  }

  const checkoutSession = await requestPaymentServiceCheckoutSession({
    candidate,
    reservation,
  });

  if (!checkoutSession) {
    return disabledPaymentAction(
      'Payment is not available yet while HireFlip finishes setting up checkout.',
      'payment_service_unavailable'
    );
  }

  const payment = await documents(strapi, 'api::payment.payment').create({
    data: {
      amountPence: reservation.amountPence,
      candidate: {
        connect: [{ documentId: candidate.documentId }],
      },
      createdByService: 'payment-service',
      currency: reservation.currency,
      enrollment: {
        connect: [{ documentId: reservation.enrollment?.documentId }],
      },
      metadata: {
        checkoutUrl: checkoutSession.checkoutUrl,
        providerSessionStatus: checkoutSession.status,
        reservationDocumentId: reservation.documentId,
      },
      paymentProvider: 'stripe',
      paymentType: 'course_payment',
      providerCheckoutSessionId: checkoutSession.checkoutSessionId,
      reservation: {
        connect: [{ documentId: reservation.documentId }],
      },
      slotReservationExpiresAt: reservation.expiresAt,
      status: 'checkout_created',
    },
  });

  const now = new Date().toISOString();

  await auditEvents(strapi).record({
    actorEmail: candidate.email,
    actorId: candidate.authIdentityId,
    actorType: 'candidate',
    eventCategory: 'payment',
    eventType: 'candidate.checkout_session_created',
    ipAddress: requestContext.ipAddress,
    metadata: {
      checkoutSessionId: checkoutSession.checkoutSessionId,
      paymentDocumentId: payment.documentId,
      reservation: sanitizeReservation(reservation),
    },
    newState: {
      payment,
    },
    occurredAt: now,
    requestId: requestContext.requestId,
    source: 'core_api',
    subjectDisplayName: candidate.email,
    subjectId: candidate.documentId,
    subjectType: 'candidate',
    userAgent: requestContext.userAgent,
  });

  return stripeCheckoutAction(payment, checkoutSession);
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
    level: classRecord.level,
    moduleSummary: classRecord.moduleSummary,
    displayTitle: classRecord.displayTitle || classRecord.name,
    name: classRecord.displayTitle || classRecord.name,
    officialClassCode: classRecord.officialClassCode,
    overview: classRecord.overview,
    pricePence: classRecord.pricePence,
    region,
    requirements: classRecord.requirements,
    scheduleNotes: classRecord.scheduleNotes,
    sector,
    slug: classRecord.slug || slugify(`${classRecord.officialClassCode || ''} ${classRecord.displayTitle || classRecord.name}`),
    startDate: classRecord.startDate,
    state: classRecord.state,
    year: classRecord.year,
  };
};

const sanitizeEnrollment = (enrollment) => {
  if (!enrollment) {
    return null;
  }

  const metadata = objectValue(enrollment.metadata);
  const reservationDocumentId =
    typeof metadata.activeReservationDocumentId === 'string'
      ? metadata.activeReservationDocumentId
      : undefined;

  return {
    completionStatus: enrollment.completionStatus,
    documentId: enrollment.documentId,
    enrolledAt: enrollment.enrolledAt,
    interestRegisteredAt: enrollment.interestRegisteredAt || enrollment.metadata?.registeredInterestAt,
    invitedToJoinAt: enrollment.invitedToJoinAt,
    passStatus: enrollment.passStatus,
    paymentStatus: enrollment.paymentStatus,
    status: enrollment.status,
    reservationExpiresAt: enrollment.reservationExpiresAt,
    reservationDocumentId,
    waitingListPosition: enrollment.waitingListPosition,
  };
};

const classHasPaymentAccess = (classRecord) => classRecord?.state === 'open';

const deriveClassRelationshipState = (enrollment, classRecord?) => {
  if (enrollment) {
    const normalizedStatus = normalizeEnrollmentStatus(enrollment.status);
    const hasPaymentAccess = classHasPaymentAccess(enrollment.class || classRecord);

    if (normalizedStatus === 'interest_withdrawn') {
      return hasPaymentAccess ? 'enrollment_open' : 'not_registered';
    }

    if (
      [
        'waiting_list',
        'missed_out',
        'withdrawn',
        'refunded',
        'removed_no_refund',
        'removed_partial_refund',
        'removed_full_refund',
        'failed',
      ].includes(normalizedStatus)
    ) {
      return normalizedStatus;
    }

    if (
      enrollment.paymentStatus === 'paid' ||
      ['enrolled', 'in_class', 'interview_phase', 'completed'].includes(normalizedStatus)
    ) {
      return normalizedStatus === 'enrolled' ? 'enrolled' : normalizedStatus;
    }

    if (normalizedStatus === 'place_reserved') {
      if (!hasPaymentAccess) {
        return 'interest_registered';
      }

      return isPastDate(enrollment.reservationExpiresAt) ? 'enrollment_open' : 'place_reserved';
    }

    if (normalizedStatus === 'enrollment_open') {
      return hasPaymentAccess ? 'enrollment_open' : 'interest_registered';
    }

    if (hasPaymentAccess) {
      return 'enrollment_open';
    }

    return 'interest_registered';
  }

  if (classHasPaymentAccess(classRecord)) {
    return 'enrollment_open';
  }

  return 'not_registered';
};

const buildClassTimeline = (classRecord, relationshipState) => {
  const completedInterest = relationshipState !== 'not_registered';
  const completedEnrollmentOpen = [
    'place_reserved',
    'enrolled',
    'in_class',
    'interview_phase',
    'completed',
    'refunded',
  ].includes(relationshipState);
  const completedPlaceSecured = ['enrolled', 'in_class', 'interview_phase', 'completed'].includes(relationshipState);
  const enrollmentOpen =
    classHasPaymentAccess(classRecord) ||
    ['full', 'in_progress', 'completion_window', 'interview_window', 'completed'].includes(classRecord?.state);
  const classStarted =
    ['in_class', 'interview_phase', 'completed'].includes(relationshipState) ||
    ['in_progress', 'completion_window', 'interview_window', 'completed'].includes(classRecord?.state);
  const interviewsActive = relationshipState === 'interview_phase' || ['interview_window'].includes(classRecord?.state);
  const interviewsComplete = relationshipState === 'completed' || classRecord?.state === 'completed';

  return [
    {
      key: 'interest',
      label: 'Interest Registered',
      state: completedInterest ? 'complete' : 'current',
    },
    {
      key: 'enrollment_open',
      label: 'Enrolled',
      state: completedEnrollmentOpen ? 'complete' : enrollmentOpen ? 'current' : 'upcoming',
    },
    {
      key: 'place_secured',
      label: 'Place secured',
      state: completedPlaceSecured ? (classStarted ? 'complete' : 'current') : relationshipState === 'place_reserved' ? 'current' : 'upcoming',
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
    canWithdrawInterest: state === 'interest_registered',
    canJoinClass: state === 'enrollment_open',
    class: sanitizeClass(classRecord),
    enrollment: sanitizeEnrollment(enrollment),
    registeredInterestCount,
    state,
    timeline: buildClassTimeline(classRecord, state),
  };
};

const summarizeClassInterestState = (classRelationships = [], activeEnrollment?) => {
  if (activeEnrollment) {
    return deriveClassRelationshipState(activeEnrollment, activeEnrollment.class);
  }

  if (classRelationships.some((relationship) => relationship.state === 'enrollment_open')) {
    return 'enrollment_open';
  }

  if (classRelationships.some((relationship) => relationship.state === 'place_reserved')) {
    return 'place_reserved';
  }

  if (classRelationships.some((relationship) => relationship.state === 'waiting_list')) {
    return 'waiting_list';
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
      accountRestrictionStatus: candidate.accountRestrictionStatus || 'active',
      accountRestrictionReason: candidate.accountRestrictionReason,
      accountRestrictionMessage: candidate.accountRestrictionMessage,
      accountRestrictionAppealStatus: candidate.accountRestrictionAppealStatus || 'not_applicable',
      accountRestrictedAt: candidate.accountRestrictedAt,
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

const buildCandidateClassInterestForCandidate = async (strapi, candidate) => {
  const enrollments = await findCandidateEnrollments(strapi, candidate);
  const [matchingClasses, relationshipClasses] = isCandidateRestricted(candidate)
    ? [[], []]
    : await Promise.all([
        findMatchingClasses(strapi, candidate),
        findRelationshipClasses(strapi, enrollments),
      ]);
  const visibleClasses = mergeClassesByDocumentId(matchingClasses, relationshipClasses);
  const interestCounts = await findClassInterestCounts(strapi, visibleClasses);

  return buildClassInterestResponse({
    candidate,
    enrollments,
    interestCounts,
    matchingClasses: visibleClasses,
  });
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
      const candidate = await documents(strapi, 'api::candidate.candidate').create({
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
        },
      });

      await auditEvents(strapi).record({
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

    const updatedCandidate = await documents(strapi, 'api::candidate.candidate').update({
      documentId: existingCandidate.documentId,
      data: changes,
      populate: candidatePopulate,
    });

    await auditEvents(strapi).record({
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

    const updatedCandidate = await documents(strapi, 'api::candidate.candidate').update({
      documentId: existingCandidate.documentId,
      data: changes,
      populate: candidatePopulate,
    });

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

    await auditEvents(strapi).record({
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
      await auditEvents(strapi).record({
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

    return buildCandidateClassInterestForCandidate(strapi, existingCandidate);
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

    if (isCandidateRestricted(existingCandidate)) {
      throw new ValidationError('This account is currently restricted and cannot register interest in classes.');
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

    enrollment = existingEnrollment?.documentId
      ? await documents(strapi, 'api::enrollment.enrollment').update({
          documentId: existingEnrollment.documentId,
          data: {
            completionStatus: existingEnrollment.completionStatus || 'not_started',
            interestRegisteredAt: now,
            metadata: {
              ...(objectValue(existingEnrollment.metadata)),
              registeredInterestAt: now,
              registeredInterestSource: 'candidate_dashboard',
              reRegisteredInterestAt: existingEnrollment.interestRegisteredAt ? now : undefined,
            },
            passStatus: existingEnrollment.passStatus || 'not_assessed',
            paymentStatus: 'not_required',
            status: 'interest_registered',
          },
          populate: ['class'],
        })
      : await documents(strapi, 'api::enrollment.enrollment').create({
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
            paymentStatus: 'not_required',
            status: 'interest_registered',
          },
          populate: ['class'],
        });

    const updatedCandidate = await documents(strapi, 'api::candidate.candidate').update({
      documentId: existingCandidate.documentId,
      data: candidateUpdates,
      populate: candidatePopulate,
    });

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

    await auditEvents(strapi).record({
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

  async withdrawCurrentCandidateClassInterest(
    auth: Auth0State | undefined,
    input: unknown = {},
    requestContext: RequestContext = {}
  ) {
    if (!auth || auth.type !== 'auth0' || !auth.subject) {
      throw new UnauthorizedError('Auth0 authentication is required.');
    }

    const existingCandidate = await findCandidateByAuthIdentity(strapi, auth.subject);

    if (!existingCandidate) {
      throw new ValidationError('Candidate account must be synced before class interest can be removed.');
    }

    if (isCandidateRestricted(existingCandidate)) {
      throw new ValidationError('This account is currently restricted and cannot update class interest.');
    }

    const payload = validateRegisterClassInterest(input ?? {});

    if (!payload.classDocumentId) {
      throw new ValidationError('A class document ID is required to remove class interest.');
    }

    const existingEnrollments = await findCandidateEnrollments(strapi, existingCandidate);
    const existingEnrollment = enrollmentsByClassDocumentId(existingEnrollments).get(payload.classDocumentId);

    if (!existingEnrollment) {
      return {
        created: false,
        data: await buildCandidateClassInterestForCandidate(strapi, existingCandidate),
      };
    }

    const targetClass = existingEnrollment.class;
    const currentState = deriveClassRelationshipState(existingEnrollment, targetClass);

    if (currentState === 'not_registered') {
      return {
        created: false,
        data: await buildCandidateClassInterestForCandidate(strapi, existingCandidate),
      };
    }

    if (currentState !== 'interest_registered') {
      throw new ValidationError('Class interest can only be removed before enrollment opens.');
    }

    const now = new Date().toISOString();
    const updatedEnrollment = await documents(strapi, 'api::enrollment.enrollment').update({
      documentId: existingEnrollment.documentId,
      data: {
        metadata: {
          ...(objectValue(existingEnrollment.metadata)),
          interestWithdrawnAt: now,
          interestWithdrawnSource: 'candidate_dashboard',
          previousStatus: existingEnrollment.status,
        },
        paymentStatus: 'not_required',
        status: 'interest_withdrawn',
      },
      populate: ['class'],
    });

    await auditEvents(strapi).record({
      actorEmail: existingCandidate.email,
      actorId: auth.subject,
      actorType: 'candidate',
      eventCategory: 'candidate',
      eventType: 'candidate.class_interest_withdrawn',
      ipAddress: requestContext.ipAddress,
      metadata: {
        class: sanitizeClass(targetClass),
      },
      newState: sanitizeEnrollment(updatedEnrollment),
      occurredAt: now,
      previousState: sanitizeEnrollment(existingEnrollment),
      requestId: requestContext.requestId,
      source: 'candidate_dashboard',
      subjectDisplayName: existingCandidate.email,
      subjectId: existingCandidate.documentId,
      subjectType: 'candidate',
      userAgent: requestContext.userAgent,
    });

    return {
      created: false,
      data: await buildCandidateClassInterestForCandidate(strapi, existingCandidate),
    };
  },

  async reserveCurrentCandidateClassPlace(
    auth: Auth0State | undefined,
    input: unknown = {},
    requestContext: RequestContext = {}
  ) {
    if (!auth || auth.type !== 'auth0' || !auth.subject) {
      throw new UnauthorizedError('Auth0 authentication is required.');
    }

    const existingCandidate = await findCandidateByAuthIdentity(strapi, auth.subject);

    if (!existingCandidate) {
      throw new ValidationError('Candidate account must be synced before a place can be reserved.');
    }

    if (isCandidateRestricted(existingCandidate)) {
      throw new ValidationError('This account is currently restricted and cannot reserve class places.');
    }

    const payload = validateReserveClassPlace(input ?? {});
    const existingEnrollments = await findCandidateEnrollments(strapi, existingCandidate);
    const [matchingClasses, relationshipClasses] = await Promise.all([
      findMatchingClasses(strapi, existingCandidate),
      findRelationshipClasses(strapi, existingEnrollments),
    ]);
    const reservableClasses = mergeClassesByDocumentId(matchingClasses, relationshipClasses);
    const targetClass = reservableClasses.find((classRecord) => classRecord.documentId === payload.classDocumentId);

    if (!targetClass) {
      throw new ValidationError('No matching class is currently available for the selected preferences.');
    }

    if (!classHasPaymentAccess(targetClass)) {
      throw new ValidationError('Enrollment is not open for this class yet.');
    }

    const nowDate = new Date();
    const now = nowDate.toISOString();
    let existingEnrollment = enrollmentsByClassDocumentId(existingEnrollments).get(
      targetClass.documentId
    ) as DocumentRecord | undefined;
    let existingReservation = await findActiveReservationForEnrollment(strapi, existingEnrollment);

    if (existingReservation && isPastDate(existingReservation.expiresAt)) {
      const fallbackStatus = (await hasWaitingListAhead(strapi, targetClass, existingCandidate))
        ? 'waiting_list'
        : 'enrollment_open';
      const waitingListPosition =
        fallbackStatus === 'waiting_list'
          ? await getNextWaitingListPosition(strapi, targetClass, existingCandidate)
          : null;

      existingReservation = await documents(strapi, 'api::reservation.reservation').update({
        documentId: existingReservation.documentId,
        data: {
          expiredAt: now,
          status: 'expired',
        },
        populate: ['candidate', 'class', 'enrollment'],
      });

      if (existingEnrollment?.documentId && normalizeEnrollmentStatus(existingEnrollment.status) === 'place_reserved') {
        existingEnrollment = await documents(strapi, 'api::enrollment.enrollment').update({
          documentId: existingEnrollment.documentId,
          data: {
            metadata: {
              ...(objectValue(existingEnrollment.metadata)),
              activeReservationDocumentId: null,
              lastReservationExpiredAt: now,
            },
            reservationExpiresAt: null,
            status: fallbackStatus,
            waitingListPosition,
          },
          populate: ['class'],
        });
      }

      await auditEvents(strapi).record({
        actorEmail: existingCandidate.email,
        actorId: auth.subject,
        actorType: 'candidate',
        eventCategory: 'payment',
        eventType: 'candidate.reservation_expired',
        ipAddress: requestContext.ipAddress,
        metadata: {
          class: sanitizeClass(targetClass),
          reservation: sanitizeReservation(existingReservation),
        },
        newState: {
          enrollment: sanitizeEnrollment(existingEnrollment),
          reservation: sanitizeReservation(existingReservation),
        },
        occurredAt: now,
        requestId: requestContext.requestId,
        source: 'candidate_dashboard',
        subjectDisplayName: existingCandidate.email,
        subjectId: existingCandidate.documentId,
        subjectType: 'candidate',
        userAgent: requestContext.userAgent,
      });
    }

    const currentState = deriveClassRelationshipState(existingEnrollment, targetClass);

    if (currentState === 'place_reserved') {
      const activeReservation = await findActiveReservationForEnrollment(strapi, existingEnrollment);

      if (activeReservation && !isPastDate(activeReservation.expiresAt)) {
        const enrollmentMetadata = objectValue(existingEnrollment?.metadata);

        if (
          existingEnrollment?.documentId &&
          enrollmentMetadata.activeReservationDocumentId !== activeReservation.documentId
        ) {
          existingEnrollment = await documents(strapi, 'api::enrollment.enrollment').update({
            documentId: existingEnrollment.documentId,
            data: {
              metadata: {
                ...enrollmentMetadata,
                activeReservationDocumentId: activeReservation.documentId,
              },
            },
            populate: ['class'],
          });
        }

        return {
          classInterest: await buildCandidateClassInterestForCandidate(strapi, existingCandidate),
          created: false,
          reservation: sanitizeReservation(activeReservation),
          reserved: true,
        };
      }
    }

    if (currentState !== 'enrollment_open') {
      throw new ValidationError('This class cannot currently be reserved from the current candidate state.');
    }

    const heldPlaces = await countCapacityHeldPlaces(strapi, targetClass);

    if (heldPlaces >= targetClass.capacity) {
      const waitingListPosition = await getNextWaitingListPosition(strapi, targetClass, existingCandidate);
      const metadata = {
        ...(objectValue(existingEnrollment?.metadata)),
        joinedWaitingListAt: now,
        waitingListSource: 'candidate_dashboard',
      };
      const enrollment = existingEnrollment?.documentId
        ? await documents(strapi, 'api::enrollment.enrollment').update({
            documentId: existingEnrollment.documentId,
            data: {
              metadata,
              paymentStatus: 'pending',
              status: 'waiting_list',
              waitingListPosition,
            },
            populate: ['class'],
          })
        : await documents(strapi, 'api::enrollment.enrollment').create({
            data: {
              candidate: {
                connect: [{ documentId: existingCandidate.documentId }],
              },
              class: {
                connect: [{ documentId: targetClass.documentId }],
              },
              completionStatus: 'not_started',
              interestRegisteredAt: now,
              metadata,
              passStatus: 'not_assessed',
              paymentStatus: 'pending',
              status: 'waiting_list',
              waitingListPosition,
            },
            populate: ['class'],
          });

      await auditEvents(strapi).record({
        actorEmail: existingCandidate.email,
        actorId: auth.subject,
        actorType: 'candidate',
        eventCategory: 'payment',
        eventType: 'candidate.waiting_list_joined',
        ipAddress: requestContext.ipAddress,
        metadata: {
          class: sanitizeClass(targetClass),
          heldPlaces,
          waitingListPosition,
        },
        newState: {
          enrollment: sanitizeEnrollment(enrollment),
        },
        occurredAt: now,
        previousState: sanitizeEnrollment(existingEnrollment),
        requestId: requestContext.requestId,
        source: 'candidate_dashboard',
        subjectDisplayName: existingCandidate.email,
        subjectId: existingCandidate.documentId,
        subjectType: 'candidate',
        userAgent: requestContext.userAgent,
      });

      return {
        classInterest: await buildCandidateClassInterestForCandidate(strapi, existingCandidate),
        created: !existingEnrollment?.documentId,
        reservation: null,
        reserved: false,
      };
    }

    const reservationExpiresAt = getReservationExpiry(nowDate);
    const enrollmentMetadata = {
      ...(objectValue(existingEnrollment?.metadata)),
      lastReservationStartedAt: now,
      lastReservationSource: 'candidate_dashboard',
    };
    const enrollment = existingEnrollment?.documentId
      ? await documents(strapi, 'api::enrollment.enrollment').update({
          documentId: existingEnrollment.documentId,
          data: {
            invitedToJoinAt: existingEnrollment.invitedToJoinAt || now,
            metadata: enrollmentMetadata,
            paymentStatus: 'pending',
            reservationExpiresAt,
            status: 'place_reserved',
            waitingListPosition: null,
          },
          populate: ['class'],
        })
      : await documents(strapi, 'api::enrollment.enrollment').create({
          data: {
            candidate: {
              connect: [{ documentId: existingCandidate.documentId }],
            },
            class: {
              connect: [{ documentId: targetClass.documentId }],
            },
            completionStatus: 'not_started',
            interestRegisteredAt: now,
            invitedToJoinAt: now,
            metadata: enrollmentMetadata,
            passStatus: 'not_assessed',
            paymentStatus: 'pending',
            reservationExpiresAt,
            status: 'place_reserved',
          },
          populate: ['class'],
        });

    const reservation = await documents(strapi, 'api::reservation.reservation').create({
      data: {
        amountPence: classPaymentAmount(targetClass),
        candidate: {
          connect: [{ documentId: existingCandidate.documentId }],
        },
        class: {
          connect: [{ documentId: targetClass.documentId }],
        },
        currency: targetClass.currency || 'GBP',
        enrollment: {
          connect: [{ documentId: enrollment.documentId }],
        },
        expiresAt: reservationExpiresAt,
        metadata: {
          class: sanitizeClass(targetClass),
          source: 'candidate_dashboard',
        },
        reservationStartedAt: now,
        source: 'candidate_dashboard',
        status: 'active',
      },
      populate: ['candidate', 'class', 'enrollment'],
    });
    const reservedEnrollment = await documents(strapi, 'api::enrollment.enrollment').update({
      documentId: enrollment.documentId,
      data: {
        metadata: {
          ...enrollmentMetadata,
          activeReservationDocumentId: reservation.documentId,
        },
      },
      populate: ['class'],
    });

    await auditEvents(strapi).record({
      actorEmail: existingCandidate.email,
      actorId: auth.subject,
      actorType: 'candidate',
      eventCategory: 'payment',
      eventType: 'candidate.reservation_created',
      ipAddress: requestContext.ipAddress,
      metadata: {
        class: sanitizeClass(targetClass),
        heldPlacesBeforeReservation: heldPlaces,
      },
      newState: {
        enrollment: sanitizeEnrollment(reservedEnrollment),
        reservation: sanitizeReservation(reservation),
      },
      occurredAt: now,
      previousState: sanitizeEnrollment(existingEnrollment),
      requestId: requestContext.requestId,
      source: 'candidate_dashboard',
      subjectDisplayName: existingCandidate.email,
      subjectId: existingCandidate.documentId,
      subjectType: 'candidate',
      userAgent: requestContext.userAgent,
    });

    return {
      classInterest: await buildCandidateClassInterestForCandidate(strapi, existingCandidate),
      created: true,
      reservation: sanitizeReservation(reservation),
      reserved: true,
    };
  },

  async getCurrentCandidateClassReservation(
    auth: Auth0State | undefined,
    reservationDocumentId: string,
    requestContext: RequestContext = {}
  ) {
    if (!auth || auth.type !== 'auth0' || !auth.subject) {
      throw new UnauthorizedError('Auth0 authentication is required.');
    }

    const existingCandidate = await findCandidateByAuthIdentity(strapi, auth.subject);

    if (!existingCandidate) {
      throw new ValidationError('Candidate account must be synced before a reservation can be checked.');
    }

    const reservation = await findCandidateReservation(strapi, existingCandidate, reservationDocumentId);

    if (!reservation) {
      throw new ValidationError('Reservation could not be found.');
    }

    const paymentAction = await getPaymentActionForReservation({
      candidate: existingCandidate,
      requestContext,
      reservation,
      strapi,
    });

    return {
      classInterest: await buildCandidateClassInterestForCandidate(strapi, existingCandidate),
      paymentAction,
      reservation: sanitizeReservation(reservation),
    };
  },

  async confirmCurrentCandidateClassReservationPayment(
    auth: Auth0State | undefined,
    reservationDocumentId: string,
    input: unknown = {},
    requestContext: RequestContext = {}
  ) {
    if (!auth || auth.type !== 'auth0' || !auth.subject) {
      throw new UnauthorizedError('Auth0 authentication is required.');
    }

    const existingCandidate = await findCandidateByAuthIdentity(strapi, auth.subject);

    if (!existingCandidate) {
      throw new ValidationError('Candidate account must be synced before a payment can be confirmed.');
    }

    const payload = validateConfirmClassReservationPayment(input ?? {});
    const reservation = await findCandidateReservation(strapi, existingCandidate, reservationDocumentId);

    if (!reservation) {
      throw new ValidationError('Reservation could not be found.');
    }

    const confirmation = await requestPaymentServiceCheckoutConfirmation(payload.checkoutSessionId);

    if (!confirmation) {
      throw new ValidationError('Payment confirmation is not available yet.');
    }

    const confirmationMetadata = objectValue(confirmation.metadata);
    const metadataReservationDocumentId =
      typeof confirmationMetadata.reservationDocumentId === 'string'
        ? confirmationMetadata.reservationDocumentId
        : undefined;
    const metadataCandidateDocumentId =
      typeof confirmationMetadata.candidateDocumentId === 'string'
        ? confirmationMetadata.candidateDocumentId
        : undefined;
    const metadataClassDocumentId =
      typeof confirmationMetadata.classDocumentId === 'string'
        ? confirmationMetadata.classDocumentId
        : undefined;
    const metadataEnrollmentDocumentId =
      typeof confirmationMetadata.enrollmentDocumentId === 'string'
        ? confirmationMetadata.enrollmentDocumentId
        : undefined;

    if (
      metadataReservationDocumentId !== reservation.documentId ||
      metadataCandidateDocumentId !== existingCandidate.documentId ||
      metadataClassDocumentId !== reservation.class?.documentId ||
      metadataEnrollmentDocumentId !== reservation.enrollment?.documentId ||
      confirmation.clientReferenceId !== reservation.documentId
    ) {
      throw new ValidationError('Payment confirmation does not match this reservation.');
    }

    if (confirmation.status !== 'complete' || confirmation.paymentStatus !== 'paid') {
      throw new ValidationError('Stripe has not confirmed this payment as paid yet.');
    }

    if (
      typeof confirmation.amountTotal === 'number' &&
      typeof reservation.amountPence === 'number' &&
      confirmation.amountTotal !== reservation.amountPence
    ) {
      throw new ValidationError('Payment amount does not match this reservation.');
    }

    if (
      typeof confirmation.currency === 'string' &&
      typeof reservation.currency === 'string' &&
      confirmation.currency.toUpperCase() !== reservation.currency.toUpperCase()
    ) {
      throw new ValidationError('Payment currency does not match this reservation.');
    }

    const now = new Date().toISOString();
    const previousReservation = sanitizeReservation(reservation);
    const previousEnrollment = sanitizeEnrollment(reservation.enrollment);
    const existingPayment =
      (await findPaymentForCheckoutSession(strapi, confirmation.checkoutSessionId)) ||
      (await findCheckoutPaymentForReservation(strapi, reservation));
    const paymentMetadata = {
      ...(objectValue(existingPayment?.metadata)),
      amountTotal: confirmation.amountTotal,
      checkoutUrl: confirmation.checkoutUrl,
      confirmedAt: now,
      providerSessionStatus: confirmation.status,
      providerPaymentStatus: confirmation.paymentStatus,
      reservationDocumentId: reservation.documentId,
    };
    const paymentData = {
      amountPence: reservation.amountPence,
      candidate: {
        connect: [{ documentId: existingCandidate.documentId }],
      },
      createdByService: 'payment-service',
      currency: reservation.currency,
      enrollment: {
        connect: [{ documentId: reservation.enrollment?.documentId }],
      },
      metadata: paymentMetadata,
      paidAt: existingPayment?.paidAt || now,
      paymentProvider: 'stripe',
      paymentType: 'course_payment',
      providerCheckoutSessionId: confirmation.checkoutSessionId,
      ...(confirmation.customerId ? { providerCustomerId: confirmation.customerId } : {}),
      ...(confirmation.paymentIntentId ? { providerPaymentIntentId: confirmation.paymentIntentId } : {}),
      reservation: {
        connect: [{ documentId: reservation.documentId }],
      },
      slotReservationExpiresAt: reservation.expiresAt,
      status: 'paid',
    };
    const payment = existingPayment?.documentId
      ? await documents(strapi, 'api::payment.payment').update({
          documentId: existingPayment.documentId,
          data: paymentData,
        })
      : await documents(strapi, 'api::payment.payment').create({
          data: paymentData,
        });
    const updatedReservation = await documents(strapi, 'api::reservation.reservation').update({
      documentId: reservation.documentId,
      data: {
        metadata: {
          ...(objectValue(reservation.metadata)),
          paymentConfirmedAt: now,
          providerCheckoutSessionId: confirmation.checkoutSessionId,
          ...(confirmation.paymentIntentId ? { providerPaymentIntentId: confirmation.paymentIntentId } : {}),
        },
        paidAt: reservation.paidAt || now,
        status: 'paid',
      },
      populate: ['candidate', 'class', 'enrollment'],
    });
    const updatedEnrollment = reservation.enrollment?.documentId
      ? await documents(strapi, 'api::enrollment.enrollment').update({
          documentId: reservation.enrollment.documentId,
          data: {
            enrolledAt: reservation.enrollment.enrolledAt || now,
            metadata: {
              ...(objectValue(reservation.enrollment.metadata)),
              activeReservationDocumentId: null,
              paidReservationDocumentId: reservation.documentId,
              paymentConfirmedAt: now,
              providerCheckoutSessionId: confirmation.checkoutSessionId,
              ...(confirmation.paymentIntentId ? { providerPaymentIntentId: confirmation.paymentIntentId } : {}),
            },
            paymentStatus: 'paid',
            reservationExpiresAt: null,
            status: 'enrolled',
            waitingListPosition: null,
          },
          populate: ['class'],
        })
      : null;
    const updatedClass = await closeClassIfCapacityReached(strapi, reservation.class);

    await auditEvents(strapi).record({
      actorEmail: existingCandidate.email,
      actorId: auth.subject,
      actorType: 'candidate',
      eventCategory: 'payment',
      eventType: 'candidate.payment_confirmed',
      ipAddress: requestContext.ipAddress,
      metadata: {
        checkoutSessionId: confirmation.checkoutSessionId,
        class: sanitizeClass(updatedClass || reservation.class),
        payment: sanitizePayment(payment),
      },
      newState: {
        enrollment: sanitizeEnrollment(updatedEnrollment),
        payment: sanitizePayment(payment),
        reservation: sanitizeReservation(updatedReservation),
      },
      occurredAt: now,
      previousState: {
        enrollment: previousEnrollment,
        reservation: previousReservation,
      },
      requestId: requestContext.requestId,
      source: 'core_api',
      subjectDisplayName: existingCandidate.email,
      subjectId: existingCandidate.documentId,
      subjectType: 'candidate',
      userAgent: requestContext.userAgent,
    });

    return {
      classInterest: await buildCandidateClassInterestForCandidate(strapi, existingCandidate),
      payment: sanitizePayment(payment),
      reservation: sanitizeReservation(updatedReservation),
    };
  },

  async cancelCurrentCandidateClassReservation(
    auth: Auth0State | undefined,
    reservationDocumentId: string,
    requestContext: RequestContext = {}
  ) {
    if (!auth || auth.type !== 'auth0' || !auth.subject) {
      throw new UnauthorizedError('Auth0 authentication is required.');
    }

    const existingCandidate = await findCandidateByAuthIdentity(strapi, auth.subject);

    if (!existingCandidate) {
      throw new ValidationError('Candidate account must be synced before a reservation can be cancelled.');
    }

    const reservation = await findCandidateReservation(strapi, existingCandidate, reservationDocumentId);

    if (!reservation) {
      throw new ValidationError('Reservation could not be found.');
    }

    const now = new Date().toISOString();
    const previousReservation = sanitizeReservation(reservation);
    const previousEnrollment = sanitizeEnrollment(reservation.enrollment);
    const classRecord = reservation.class;
    const fallbackStatus = (await hasWaitingListAhead(strapi, classRecord, existingCandidate))
      ? 'waiting_list'
      : 'enrollment_open';
    const waitingListPosition =
      fallbackStatus === 'waiting_list'
        ? await getNextWaitingListPosition(strapi, classRecord, existingCandidate)
        : null;
    const updatedReservation =
      reservation.status === 'active'
        ? await documents(strapi, 'api::reservation.reservation').update({
            documentId: reservation.documentId,
            data: {
              cancelledAt: now,
              status: 'cancelled',
            },
            populate: ['candidate', 'class', 'enrollment'],
          })
        : reservation;
    const updatedEnrollment =
      reservation.enrollment?.documentId &&
      normalizeEnrollmentStatus(reservation.enrollment.status) === 'place_reserved'
        ? await documents(strapi, 'api::enrollment.enrollment').update({
            documentId: reservation.enrollment.documentId,
            data: {
              metadata: {
                ...(objectValue(reservation.enrollment.metadata)),
                activeReservationDocumentId: null,
                lastReservationCancelledAt: now,
              },
              reservationExpiresAt: null,
              status: fallbackStatus,
              waitingListPosition,
            },
            populate: ['class'],
          })
        : reservation.enrollment;

    await auditEvents(strapi).record({
      actorEmail: existingCandidate.email,
      actorId: auth.subject,
      actorType: 'candidate',
      eventCategory: 'payment',
      eventType: 'candidate.reservation_cancelled',
      ipAddress: requestContext.ipAddress,
      metadata: {
        class: sanitizeClass(classRecord),
      },
      newState: {
        enrollment: sanitizeEnrollment(updatedEnrollment),
        reservation: sanitizeReservation(updatedReservation),
      },
      occurredAt: now,
      previousState: {
        enrollment: previousEnrollment,
        reservation: previousReservation,
      },
      requestId: requestContext.requestId,
      source: 'candidate_dashboard',
      subjectDisplayName: existingCandidate.email,
      subjectId: existingCandidate.documentId,
      subjectType: 'candidate',
      userAgent: requestContext.userAgent,
    });

    return {
      classInterest: await buildCandidateClassInterestForCandidate(strapi, existingCandidate),
      reservation: sanitizeReservation(updatedReservation),
    };
  },

  async expireCurrentCandidateClassReservation(
    auth: Auth0State | undefined,
    reservationDocumentId: string,
    requestContext: RequestContext = {}
  ) {
    if (!auth || auth.type !== 'auth0' || !auth.subject) {
      throw new UnauthorizedError('Auth0 authentication is required.');
    }

    const existingCandidate = await findCandidateByAuthIdentity(strapi, auth.subject);

    if (!existingCandidate) {
      throw new ValidationError('Candidate account must be synced before a reservation can expire.');
    }

    const reservation = await findCandidateReservation(strapi, existingCandidate, reservationDocumentId);

    if (!reservation) {
      throw new ValidationError('Reservation could not be found.');
    }

    if (reservation.status !== 'active') {
      return {
        classInterest: await buildCandidateClassInterestForCandidate(strapi, existingCandidate),
        reservation: sanitizeReservation(reservation),
      };
    }

    if (!isPastDate(reservation.expiresAt)) {
      return {
        classInterest: await buildCandidateClassInterestForCandidate(strapi, existingCandidate),
        reservation: sanitizeReservation(reservation),
      };
    }

    const now = new Date().toISOString();
    const previousReservation = sanitizeReservation(reservation);
    const previousEnrollment = sanitizeEnrollment(reservation.enrollment);
    const classRecord = reservation.class;
    const fallbackStatus = (await hasWaitingListAhead(strapi, classRecord, existingCandidate))
      ? 'waiting_list'
      : 'enrollment_open';
    const waitingListPosition =
      fallbackStatus === 'waiting_list'
        ? await getNextWaitingListPosition(strapi, classRecord, existingCandidate)
        : null;
    const updatedReservation = await documents(strapi, 'api::reservation.reservation').update({
      documentId: reservation.documentId,
      data: {
        expiredAt: now,
        status: 'expired',
      },
      populate: ['candidate', 'class', 'enrollment'],
    });
    const updatedEnrollment =
      reservation.enrollment?.documentId &&
      normalizeEnrollmentStatus(reservation.enrollment.status) === 'place_reserved'
        ? await documents(strapi, 'api::enrollment.enrollment').update({
            documentId: reservation.enrollment.documentId,
            data: {
              metadata: {
                ...(objectValue(reservation.enrollment.metadata)),
                activeReservationDocumentId: null,
                lastReservationExpiredAt: now,
              },
              reservationExpiresAt: null,
              status: fallbackStatus,
              waitingListPosition,
            },
            populate: ['class'],
          })
        : reservation.enrollment;

    await auditEvents(strapi).record({
      actorEmail: existingCandidate.email,
      actorId: auth.subject,
      actorType: 'candidate',
      eventCategory: 'payment',
      eventType: 'candidate.reservation_expired',
      ipAddress: requestContext.ipAddress,
      metadata: {
        class: sanitizeClass(classRecord),
      },
      newState: {
        enrollment: sanitizeEnrollment(updatedEnrollment),
        reservation: sanitizeReservation(updatedReservation),
      },
      occurredAt: now,
      previousState: {
        enrollment: previousEnrollment,
        reservation: previousReservation,
      },
      requestId: requestContext.requestId,
      source: 'candidate_dashboard',
      subjectDisplayName: existingCandidate.email,
      subjectId: existingCandidate.documentId,
      subjectType: 'candidate',
      userAgent: requestContext.userAgent,
    });

    return {
      classInterest: await buildCandidateClassInterestForCandidate(strapi, existingCandidate),
      reservation: sanitizeReservation(updatedReservation),
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
    const unlistedInterest = await documents(strapi, 'api::unlisted-interest.unlisted-interest').create({
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
      },
    });
    const response = {
      candidateEmail: unlistedInterest.candidateEmail,
      documentId: unlistedInterest.documentId,
      interestType: unlistedInterest.interestType,
      source: unlistedInterest.source,
      status: unlistedInterest.status,
      suggestedValue: unlistedInterest.suggestedValue,
    };

    await auditEvents(strapi).record({
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

      const updatedCandidate = await documents(strapi, 'api::candidate.candidate').update({
        documentId: existingCandidate.documentId,
        data: {
          profileImage: uploadedFile.id,
        },
        populate: candidatePopulate,
      });
      const sanitizedCandidate = await sanitizeCandidate(strapi, updatedCandidate);
      const now = new Date().toISOString();

      await auditEvents(strapi).record({
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

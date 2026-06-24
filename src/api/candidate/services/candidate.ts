import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { factories } from '@strapi/strapi';
import { errors, validateZodSchema, z } from '@strapi/utils';
import { parsePhoneNumberFromString } from 'libphonenumber-js/max';
import sharp from 'sharp';
import {
  allocateClassPlace,
  isClassAllocationReady,
  markClassPlaceAllocationPaid,
  releaseClassPlaceAllocation,
  replaceClassAllocationSnapshot,
  tryAcquireClassAllocationSyncLock,
  waitForClassAllocationReady,
} from '../../../utils/class-allocation-redis';
import { addWaitingListOfferExpiryJob } from '../../../utils/class-workflow-queue';
import {
  publishCandidateClassRealtimeEvent,
  publishClassRealtimeEvent,
} from '../../../utils/class-realtime-events';
import { publishAdminRealtimeEvent } from '../../../utils/admin-realtime-events';
import { addWorkingDays, workingDayWindow } from '../../../utils/working-days';

const { ApplicationError, UnauthorizedError, ValidationError } = errors;

type Auth0State = {
  type: 'auth0';
  subject: string;
  email?: string;
  claims?: Record<string, unknown>;
};

type RequestContext = {
  ipAddress?: string;
  requestId?: string;
  serviceName?: string;
  userAgent?: string;
};

type StrapiDocumentService = {
  documents(uid: string): unknown;
  log?: {
    error?: (message: string, error?: unknown) => void;
  };
  service(uid: string): unknown;
};

type DocumentRecord = Record<string, unknown> & {
  accountCreatedAt?: string;
  accountOnboardingCompletedAt?: string;
  accountRestrictionStatus?: string;
  amountPence?: number;
  announcementState?: string;
  appealState?: string;
  attemptNumber?: number;
  attemptState?: string;
  authIdentityId?: string;
  candidate?: DocumentRecord;
  candidateResponseDeadline?: string;
  candidateNotifiedAt?: string;
  candidateResponseReminderCount?: number;
  candidateRespondedAt?: string;
  candidateState?: string;
  candidateEmail?: string;
  candidateReportConclusion?: string;
  candidateReportGeneratedAt?: string;
  candidateReportImprovements?: string;
  candidateReportIntro?: string;
  candidateReportState?: string;
  candidateReportStrengths?: string;
  candidateReportTakeaways?: unknown;
  candidateReportVisibleAt?: string;
  candidateWarningSentAt?: string;
  candidateWarningState?: string;
  capacity?: number;
  class?: DocumentRecord;
  classArea?: DocumentRecord;
  claimedAt?: string;
  classAreaPreferences?: unknown;
  acceptedTermsPolicyDocument?: DocumentRecord;
  acceptanceLabel?: string;
  beganClassAt?: string;
  body?: string;
  completedAt?: string;
  completionMode?: string;
  completionStatus?: string;
  course?: DocumentRecord;
  courseCompletionDeadline?: string;
  courseDeadlineExtensionSeconds?: number;
  courseMaterial?: DocumentRecord;
  courseModule?: DocumentRecord;
  courseQuestion?: DocumentRecord;
  courseSection?: DocumentRecord;
  courseTest?: DocumentRecord;
  courseTestAttempt?: DocumentRecord;
  correctAnswerPayload?: unknown;
  createdAt?: string;
  currency?: string;
  declinedAt?: string;
  decidedAt?: string;
  displayTitle?: string;
  documentId?: string;
  deliveryState?: string;
  email?: string;
  enrollment?: DocumentRecord;
  enrollmentState?: string;
  expiredAt?: string;
  expiresAt?: string;
  firstName?: string;
  dateOfBirth?: string;
  gender?: string;
  genderSelfDescription?: string;
  id?: number;
  interestRegisteredAt?: string;
  interestType?: string;
  invitedToJoinAt?: string;
  introCopy?: string;
  lastName?: string;
  lastCandidateResponseReminderSentAt?: string;
  level?: string;
  lastMessageAt?: string;
  marketingConsentCapturedAt?: string;
  marketingConsentState?: string;
  marketingConsentWordingVersion?: string;
  maxScore?: number;
  metadata?: unknown;
  name?: string;
  notificationPreferences?: unknown;
  offerState?: string;
  offeredAt?: string;
  ownerRoleKey?: string;
  ownerStaffDisplayName?: string;
  ownerStaffEmail?: string;
  ownerStaffUserId?: string;
  passStatus?: string;
  paidAt?: string;
  paymentState?: string;
  paymentStatus?: string;
  paymentType?: string;
  phone?: string;
  policyKey?: string;
  policyState?: string;
  policyType?: string;
  priority?: string;
  pricePence?: number;
  discountedPricePence?: number;
  preferredCommunicationChannel?: (typeof communicationChannels)[number];
  profileImage?: DocumentRecord;
  profileSettings?: unknown;
  providerCheckoutSessionId?: string;
  providerCustomerId?: string;
  providerPaymentIntentId?: string;
  options?: unknown;
  passed?: boolean;
  passMark?: number;
  prompt?: string;
  questionState?: string;
  questionType?: string;
  registeredInterestAt?: string;
  required?: boolean;
  requiredCompletionPercentage?: number;
  retryEligibilityState?: string;
  reservation?: DocumentRecord;
  reservationState?: string;
  region?: string;
  reviewState?: string;
  reservationExpiresAt?: string;
  reservationDocumentId?: string;
  score?: number;
  scoringRubric?: unknown;
  sector?: string;
  sectionState?: string;
  skippedAt?: string;
  slug?: string;
  sortOrder?: number;
  startDate?: string;
  startedAt?: string;
  source?: string;
  sourceTrigger?: string;
  state?: string;
  status?: string;
  submittedAt?: string;
  suggestedValue?: string;
  supersededAt?: string;
  testState?: string;
  title?: string;
  updatedAt?: string;
  version?: string;
  visibleFrom?: string;
  waitingListPosition?: number;
  waitingListJoinedAt?: string;
  waitingListOffer?: DocumentRecord;
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

type InterviewRequestService = {
  ensureForEnrollment(input: unknown, context: RequestContext): Promise<unknown>;
  reconcileReusableInterviewSlots(limit?: number, context?: RequestContext): Promise<unknown>;
};

type SupportCaseService = {
  addMessage(input: unknown): Promise<DocumentRecord>;
  casesForCandidate(candidateDocumentId: string): Promise<unknown[]>;
  ensureFeedbackReportConcernCase(input: unknown): Promise<{
    created: boolean;
    supportCase: DocumentRecord;
  }>;
  getCaseForCandidate(input: {
    candidateDocumentId: string;
    supportCaseDocumentId: string;
  }): Promise<unknown | null>;
  updateCaseState(input: unknown): Promise<DocumentRecord>;
};

const documents = (strapi: StrapiDocumentService, uid: string) =>
  strapi.documents(uid) as unknown as DocumentCollection;
const auditEvents = (strapi: StrapiDocumentService) =>
  strapi.service('api::audit-event.audit-event') as unknown as AuditEventService;
const interviewRequestService = (strapi: StrapiDocumentService) =>
  strapi.service('api::interview-request.interview-request') as unknown as InterviewRequestService;
const supportCaseService = (strapi: StrapiDocumentService) =>
  strapi.service('api::support-case.support-case') as unknown as SupportCaseService;

const communicationChannels = ['email', 'sms', 'phone'] as const;
const candidateGenderValues = [
  'man',
  'woman',
  'non_binary',
  'self_describe',
  'prefer_not_to_say',
] as const;
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
const assessmentAppealSubmissionWorkingDays = 5;
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
const candidateRefundDecisionEnrollmentStatuses = new Set([
  'refunded',
  'removed_no_refund',
  'removed_partial_refund',
  'removed_full_refund',
]);
const candidateVisibleRelationshipEnrollmentStatuses = new Set([
  ...candidateRelationshipEnrollmentStatuses,
  ...candidateRefundDecisionEnrollmentStatuses,
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

const candidateState = (candidate?: DocumentRecord) => candidate?.candidateState || candidate?.status;
const enrollmentState = (enrollment?: DocumentRecord) => enrollment?.enrollmentState || enrollment?.status;
const reservationState = (reservation?: DocumentRecord) => reservation?.reservationState || reservation?.status;
const paymentState = (payment?: DocumentRecord) => payment?.paymentState || payment?.status;
const offerState = (offer?: DocumentRecord) => offer?.offerState || offer?.status;
const unlistedInterestState = (interest?: DocumentRecord) => interest?.reviewState || interest?.status;

const normalizeEnrollmentStatus = (status?: string) =>
  status ? enrollmentStatusAliases[status] || status : undefined;

const normalizedEnrollmentState = (enrollment?: DocumentRecord) =>
  normalizeEnrollmentStatus(enrollmentState(enrollment));

const isCandidateRestricted = (candidate) =>
  restrictedCandidateStatuses.has(candidate?.accountRestrictionStatus) ||
  restrictedCandidateStatuses.has(candidateState(candidate));

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

const positiveNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

const getReservationWindowMs = () => getIntegerEnv('CLASS_RESERVATION_WINDOW_SECONDS', 10 * 60) * 1000;
const getWaitingListOfferWindowMs = () => getIntegerEnv('WAITING_LIST_OFFER_WINDOW_SECONDS', 15 * 60) * 1000;
const classCheckoutPolicyType = 'class_checkout_terms';

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

const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;

const parseDateOnly = (value: string) => {
  if (!dateOnlyPattern.test(value)) {
    return undefined;
  }

  const [year, month, day] = value.split('-').map((part) => Number.parseInt(part, 10));
  const parsedDate = new Date(Date.UTC(year, month - 1, day));

  if (
    parsedDate.getUTCFullYear() !== year ||
    parsedDate.getUTCMonth() !== month - 1 ||
    parsedDate.getUTCDate() !== day
  ) {
    return undefined;
  }

  return { day, month, year };
};

const getAgeFromDateOfBirth = (dateOfBirth: string, now = new Date()) => {
  const parsedDate = parseDateOnly(dateOfBirth);

  if (!parsedDate) {
    return undefined;
  }

  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth() + 1;
  const currentDay = now.getUTCDate();
  let age = currentYear - parsedDate.year;

  if (
    currentMonth < parsedDate.month ||
    (currentMonth === parsedDate.month && currentDay < parsedDate.day)
  ) {
    age -= 1;
  }

  return age;
};

const dateOfBirthSchema = z
  .string()
  .trim()
  .refine((value) => {
    const age = getAgeFromDateOfBirth(value);
    return typeof age === 'number' && age >= 16 && age <= 120;
  }, {
    message: 'Enter a valid date of birth. Candidates must be between 16 and 120.',
  });

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
    dateOfBirth: dateOfBirthSchema.optional(),
    firstName: z.string().trim().min(1).max(120),
    gender: z.enum(candidateGenderValues),
    genderSelfDescription: optionalString(120),
    lastName: optionalString(120),
    phone: mobilePhoneSchema,
    preferredCommunicationChannel: z.enum(communicationChannels).optional(),
    marketingConsent: z.boolean(),
    marketingConsentWordingVersion: optionalString(80),
    workSectorPreferences: preferenceSelectionSchema,
  })
  .strict()
  .transform((value) => ({
    ...value,
    genderSelfDescription:
      value.gender === 'self_describe' ? value.genderSelfDescription : undefined,
  }));

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
    waitingListOfferDocumentId: optionalString(80),
  })
  .strict();

const validateReserveClassPlace = validateZodSchema(reserveClassPlaceSchema);

const acceptReservationTermsSchema = z
  .object({
    termsVersion: optionalString(120),
  })
  .strict()
  .default({});

const validateAcceptReservationTerms = validateZodSchema(acceptReservationTermsSchema);

const createUnlistedInterestSchema = z
  .object({
    interestType: z.enum(unlistedInterestTypes),
    source: z.enum(unlistedInterestSources).default('settings'),
    suggestedValue: z.string().trim().min(1).max(160),
  })
  .strict();

const validateCreateUnlistedInterest = validateZodSchema(createUnlistedInterestSchema);

const supportCaseReplySchema = z
  .object({
    body: z.string().trim().min(1).max(12000),
  })
  .strict();

const validateSupportCaseReply = validateZodSchema(supportCaseReplySchema);

const feedbackReportConcernSchema = z
  .object({
    reason: z.string().trim().min(10).max(4000),
  })
  .strict();

const validateFeedbackReportConcern = validateZodSchema(feedbackReportConcernSchema);

const materialProgressSchema = z
  .object({
    completionPercentage: z.number().min(0).max(100).optional(),
    eventType: z.enum(['read_progress', 'video_progress', 'completed']).default('completed'),
    reachedEnd: z.boolean().optional(),
    watchedSeconds: z.number().nonnegative().optional(),
  })
  .strict()
  .default({ eventType: 'completed' });

const validateMaterialProgress = validateZodSchema(materialProgressSchema);

const testAnswerSchema = z
  .object({
    questionDocumentId: z.string().trim().min(1).max(160),
    selectedOptionIds: z.array(z.string().trim().min(1).max(120)).min(1).max(20),
  })
  .strict();

const submitCourseTestSchema = z
  .object({
    answers: z.array(testAnswerSchema).min(1).max(200),
  })
  .strict();

const validateSubmitCourseTest = validateZodSchema(submitCourseTestSchema);

const courseAppealSchema = z
  .object({
    reason: z.string().trim().min(20).max(4000),
  })
  .strict();

const validateCourseAppeal = validateZodSchema(courseAppealSchema);

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
  dateOfBirth: candidate.dateOfBirth,
  email: candidate.email,
  firstName: candidate.firstName,
  gender: candidate.gender,
  genderSelfDescription: candidate.genderSelfDescription,
  lastName: candidate.lastName,
  profileImage: await sanitizeProfileImage(strapi, candidate.profileImage),
  notificationPreferences: candidate.notificationPreferences,
  phone: candidate.phone,
  preferredCommunicationChannel: candidate.preferredCommunicationChannel,
  marketingConsentState: candidate.marketingConsentState,
  marketingConsentCapturedAt: candidate.marketingConsentCapturedAt,
  marketingConsentWordingVersion: candidate.marketingConsentWordingVersion,
  accountOnboardingCompletedAt: candidate.accountOnboardingCompletedAt,
  status: candidateState(candidate),
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

const candidateMessageDisplayName = (candidate: DocumentRecord) => {
  const firstName = typeof candidate.firstName === 'string' ? candidate.firstName.trim() : '';
  const lastName = typeof candidate.lastName === 'string' ? candidate.lastName.trim() : '';
  const fullName = `${firstName} ${lastName}`.trim();

  return fullName || candidate.email || 'Candidate';
};

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

const candidateInterviewDeclineReasons = [
  'health_or_family_emergency',
  'another_interview',
  'travel_disruption',
  'other',
] as const;
const candidateInterviewFormatPreferences = [
  'in_person',
  'remote',
  'no_preference',
] as const;
const openInterviewSlotOfferStates = new Set(['submitted', 'sent']);

const candidateInterviewSlotAcceptSchema = z
  .object({
    formatPreference: z
      .enum(candidateInterviewFormatPreferences)
      .default('no_preference'),
    slotDocumentId: z.string().trim().min(1).max(120),
  })
  .strict();

const candidateInterviewSlotDeclineSchema = z
  .object({
    declineNote: z.string().trim().min(1, 'A note is required.').max(2000),
    declineReason: z.enum(candidateInterviewDeclineReasons),
  })
  .strict();

const validateCandidateInterviewSlotAccept = validateZodSchema(candidateInterviewSlotAcceptSchema);
const validateCandidateInterviewSlotDecline = validateZodSchema(candidateInterviewSlotDeclineSchema);

const providerCheckoutConfirmationSchema = z
  .object({
    amountTotal: z.number().int().nonnegative().optional(),
    checkoutSessionId: z.string().trim().min(1).max(255),
    checkoutUrl: z.string().trim().url().nullable().optional(),
    clientReferenceId: z.string().trim().max(255).nullable().optional(),
    currency: z.string().trim().min(3).max(3).nullable().optional(),
    customerId: z.string().trim().max(255).optional(),
    metadata: z.unknown().optional(),
    paymentIntentId: z.string().trim().max(255).optional(),
    paymentProvider: z.string().trim().min(1).max(80).default('stripe'),
    paymentStatus: z.string().trim().min(1).max(80),
    status: z.string().trim().min(1).max(80),
  })
  .strict()
  .transform((value) => ({
    ...value,
    metadata: objectValue(value.metadata),
  }));

const validateProviderCheckoutConfirmation = validateZodSchema(providerCheckoutConfirmationSchema);

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

const findCandidateEnrollmentForClass = async (
  strapi: StrapiDocumentService,
  candidate: DocumentRecord,
  classRecord: DocumentRecord
) => {
  if (!candidate.documentId || !classRecord.documentId) {
    return undefined;
  }

  const enrollments = await documents(strapi, 'api::enrollment.enrollment').findMany({
    filters: {
      candidate: {
        documentId: candidate.documentId,
      },
      class: {
        documentId: classRecord.documentId,
      },
    },
    limit: 1,
    populate: ['class'],
    sort: ['createdAt:desc'],
  });

  return enrollments[0];
};

const findClassByDocumentId = async (
  strapi: StrapiDocumentService,
  classDocumentId: string
) => {
  const classes = await documents(strapi, 'api::class.class').findMany({
    filters: {
      documentId: classDocumentId,
    },
    limit: 1,
    populate: ['classArea', 'workSector'],
  });

  return classes[0];
};

const enrollmentClassDocumentId = (enrollment) => enrollment?.class?.documentId;

const relationshipClassDocumentIds = (enrollments: DocumentRecord[] = []) =>
  enrollments
    .filter((enrollment) => candidateVisibleRelationshipEnrollmentStatuses.has(normalizedEnrollmentState(enrollment)))
    .map(enrollmentClassDocumentId)
    .filter((documentId): documentId is string => Boolean(documentId));

const findRelationshipClasses = async (strapi: StrapiDocumentService, enrollments: DocumentRecord[] = []) => {
  const classDocumentIds = [...new Set(relationshipClassDocumentIds(enrollments))];
  const refundDecisionClassDocumentIds = new Set(
    enrollments
      .filter((enrollment) => candidateRefundDecisionEnrollmentStatuses.has(normalizedEnrollmentState(enrollment)))
      .map(enrollmentClassDocumentId)
      .filter((documentId): documentId is string => Boolean(documentId))
  );

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
      .filter(
        (classRecord) =>
          refundDecisionClassDocumentIds.has(classRecord.documentId) ||
          (!terminalClassStatuses.has(classRecord.state) && candidateRelationshipClassStates.has(classRecord.state))
      )
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
      enrollmentState: {
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
const getWaitingListOfferExpiry = (now = new Date()) =>
  new Date(now.getTime() + getWaitingListOfferWindowMs()).toISOString();

const waitingListOfferPopulate = ['candidate', 'class', 'enrollment', 'reservation'];
const waitingListOfferTerminalStatuses = new Set([
  'claimed',
  'declined',
  'expired',
  'skipped_ineligible',
  'superseded',
]);

type WaitingListOfferSourceTrigger =
  | 'expired_reservation'
  | 'cancelled_reservation'
  | 'enrolled_candidate_withdrawal'
  | 'admin_released_place'
  | 'payment_failure_after_expiry'
  | 'payment_exception_release'
  | 'admin_ineligibility_removal'
  | 'waiting_list_offer_declined'
  | 'waiting_list_offer_expired'
  | 'system_reconciliation';

const classAllowsWaitingListOffers = (classRecord?: DocumentRecord) =>
  classRecord?.state === 'open' || classRecord?.state === 'full';

const waitingListOfferEligibility = (enrollment?: DocumentRecord) => {
  const metadata = objectValue(enrollment?.metadata);

  return metadata.waitingListOfferEligible !== false;
};

const findActiveWaitingListOfferForClass = async (
  strapi: StrapiDocumentService,
  classRecord?: DocumentRecord
) => {
  if (!classRecord?.documentId) {
    return undefined;
  }

  const offers = await documents(strapi, 'api::waiting-list-offer.waiting-list-offer').findMany({
    filters: {
      class: {
        documentId: classRecord.documentId,
      },
      expiresAt: {
        $gt: new Date().toISOString(),
      },
      offerState: 'active',
    },
    limit: 1,
    populate: waitingListOfferPopulate,
    sort: ['offeredAt:asc', 'createdAt:asc'],
  });

  return offers[0];
};

const findActiveWaitingListOfferForEnrollment = async (
  strapi: StrapiDocumentService,
  enrollment?: DocumentRecord
) => {
  if (!enrollment?.documentId) {
    return undefined;
  }

  const offers = await documents(strapi, 'api::waiting-list-offer.waiting-list-offer').findMany({
    filters: {
      enrollment: {
        documentId: enrollment.documentId,
      },
      expiresAt: {
        $gt: new Date().toISOString(),
      },
      offerState: 'active',
    },
    limit: 1,
    populate: waitingListOfferPopulate,
    sort: ['offeredAt:desc', 'createdAt:desc'],
  });

  return offers[0];
};

const findCandidateWaitingListOffer = async (
  strapi: StrapiDocumentService,
  candidate: DocumentRecord,
  offerDocumentId: string
) => {
  const offers = await documents(strapi, 'api::waiting-list-offer.waiting-list-offer').findMany({
    filters: {
      candidate: {
        documentId: candidate.documentId,
      },
      documentId: offerDocumentId,
    },
    limit: 1,
    populate: waitingListOfferPopulate,
  });

  return offers[0];
};

const sanitizeWaitingListOffer = (offer?: DocumentRecord | null) => {
  if (!offer) {
    return null;
  }

  return {
    claimedAt: offer.claimedAt,
    declinedAt: offer.declinedAt,
    documentId: offer.documentId,
    enrollmentDocumentId: offer.enrollment?.documentId,
    expiredAt: offer.expiredAt,
    expiresAt: offer.expiresAt,
    offeredAt: offer.offeredAt,
    reservationDocumentId: offer.reservation?.documentId,
    skippedAt: offer.skippedAt,
    sourceTrigger: offer.sourceTrigger,
    status: offerState(offer),
    supersededAt: offer.supersededAt,
    waitingListJoinedAt: offer.waitingListJoinedAt,
    waitingListPositionAtOffer: offer.waitingListPositionAtOffer,
  };
};

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
        priority: 'critical',
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
  } catch {
    return undefined;
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
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
};

const buildWaitingListOfferEmail = (offer: DocumentRecord) => {
  const claimUrl = buildDashboardClassOfferUrl(offer);
  const candidateName =
    typeof offer.candidate?.firstName === 'string' && offer.candidate.firstName.trim()
      ? offer.candidate.firstName.trim()
      : 'there';
  const className =
    offer.class?.displayTitle ||
    offer.class?.name ||
    'your HireFlip class';
  const expiresAt = offer.expiresAt
    ? new Intl.DateTimeFormat('en-GB', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Europe/London',
      }).format(new Date(offer.expiresAt))
    : 'soon';
  const bodyLines = [
    `Hi ${candidateName},`,
    `A place may be available on ${className}.`,
    `You have until ${expiresAt} to claim it. The place is not reserved until you click through and complete the checkout reservation step.`,
    'If you do not want the place, you can decline it from your dashboard and we will offer it to the next person on the waiting list.',
  ];

  return {
    bodyLines,
    ctaLabel: 'Claim your place',
    ctaUrl: claimUrl,
    subject: 'A HireFlip class place may be available',
    text: [
      ...bodyLines,
      '',
      `Claim your place: ${claimUrl}`,
      '',
      'HireFlip',
    ].join('\n'),
  };
};

const updateEnrollmentWaitingListOfferEligibility = async ({
  eligible,
  enrollment,
  reason,
  strapi,
}: {
  eligible: boolean;
  enrollment?: DocumentRecord;
  reason: string;
  strapi: StrapiDocumentService;
}) => {
  if (!enrollment?.documentId) {
    return enrollment;
  }

  const now = new Date().toISOString();

  return documents(strapi, 'api::enrollment.enrollment').update({
    documentId: enrollment.documentId,
    data: {
      metadata: {
        ...(objectValue(enrollment.metadata)),
        waitingListOfferEligibilityChangedAt: now,
        waitingListOfferEligibilityReason: reason,
        waitingListOfferEligible: eligible,
      },
    },
    populate: ['candidate', 'class'],
  });
};

const queueWaitingListOfferNotifications = async (
  strapi: StrapiDocumentService,
  offer: DocumentRecord,
  requestContext: RequestContext
) => {
  const candidate = offer.candidate;
  const classRecord = offer.class;
  const notificationPreferences = objectValue(candidate?.notificationPreferences);
  const channelPreferences = objectValue(notificationPreferences.channels);
  const emailContent =
    typeof candidate?.email === 'string' ? buildWaitingListOfferEmail(offer) : undefined;
  const emailQueueResult =
    candidate?.email && emailContent
      ? await requestNotificationServiceEmail({
          correlationId: offer.documentId,
          subject: emailContent.subject,
          template: {
            key: 'generic_branded_message',
            variables: {
              bodyLines: emailContent.bodyLines,
              ctaLabel: emailContent.ctaLabel,
              ctaUrl: emailContent.ctaUrl,
              heading: emailContent.subject,
              subject: emailContent.subject,
            },
          },
          to: candidate.email,
          type: 'candidate_waiting_list_offer_created',
        })
      : undefined;
  const notificationChannels = [
    'in_app',
    ...(candidate?.email ? ['email'] : []),
    ...(candidate?.phone && channelPreferences.sms === true ? ['sms'] : []),
  ] as const;

  await Promise.all(
    notificationChannels.map((channel) =>
      documents(strapi, 'api::notification-event.notification-event').create({
        data: {
          candidate: candidate?.documentId
            ? {
                connect: [{ documentId: candidate.documentId }],
              }
            : undefined,
          channel,
          class: classRecord?.documentId
            ? {
                connect: [{ documentId: classRecord.documentId }],
              }
            : undefined,
          eventType: 'candidate.waiting_list_offer_created',
          metadata: {
            class: sanitizeClass(classRecord),
            expiresAt: offer.expiresAt,
            notificationServiceJobId:
              channel === 'email' && typeof emailQueueResult?.data?.jobId === 'string'
                ? emailQueueResult.data.jobId
                : undefined,
            notificationServiceQueued:
              channel === 'email' && typeof emailQueueResult?.data?.queued === 'boolean'
                ? emailQueueResult.data.queued
                : undefined,
            requestId: requestContext.requestId,
            url: buildDashboardClassOfferUrl(offer),
            waitingListOffer: sanitizeWaitingListOffer(offer),
          },
          priority: 'urgent',
          recipientEmail: candidate?.email,
          recipientId: candidate?.documentId,
          recipientPhone: channel === 'sms' ? candidate?.phone : undefined,
          recipientType: 'candidate',
          relatedId: offer.documentId,
          relatedType: 'waiting_list_offer',
          deliveryState:
            channel === 'email'
              ? emailQueueResult?.data?.queued === true
                ? 'queued'
                : 'failed'
              : channel === 'sms'
                ? 'scheduled'
                : 'queued',
          templateKey: 'candidate_waiting_list_offer_created',
        },
      })
    )
  );
};

const recordWaitingListOfferAudit = async ({
  eventType,
  newState,
  offer,
  previousState,
  requestContext,
  severity = 'info',
  source = 'core_api',
  strapi,
}: {
  eventType: string;
  newState?: unknown;
  offer: DocumentRecord;
  previousState?: unknown;
  requestContext: RequestContext;
  severity?: 'info' | 'warning' | 'error' | 'critical';
  source?: 'core_api' | 'candidate_dashboard' | 'payment_service' | 'system';
  strapi: StrapiDocumentService;
}) => {
  const candidate = offer.candidate;

  await auditEvents(strapi).record({
    actorEmail: candidate?.email,
    actorId: source === 'candidate_dashboard' ? candidate?.authIdentityId : requestContext.serviceName,
    actorType: source === 'candidate_dashboard' ? 'candidate' : 'service',
    eventCategory: 'payment',
    eventType,
    ipAddress: requestContext.ipAddress,
    metadata: {
      class: sanitizeClass(offer.class),
      enrollment: sanitizeEnrollment(offer.enrollment),
      sourceTrigger: offer.sourceTrigger,
      waitingListPositionAtOffer: offer.waitingListPositionAtOffer,
    },
    newState,
    occurredAt: new Date().toISOString(),
    previousState,
    requestId: requestContext.requestId,
    serviceName: requestContext.serviceName,
    severity,
    source,
    subjectDisplayName: candidate?.email,
    subjectId: candidate?.documentId,
    subjectType: 'candidate',
    userAgent: requestContext.userAgent,
  });
};

const realtimeLogger = (strapi: StrapiDocumentService) =>
  (strapi as unknown as { log?: { error?: (message: string, error?: unknown) => void } }).log;

const publishClassRelationshipEvent = async ({
  candidate,
  classRecord,
  eventType = 'class_relationship_updated',
  strapi,
}: {
  candidate?: DocumentRecord;
  classRecord?: DocumentRecord;
  eventType?:
    | 'class_relationship_updated'
    | 'reservation_cancelled'
    | 'reservation_created'
    | 'reservation_expired'
    | 'waiting_list_joined';
  strapi: StrapiDocumentService;
}) => {
  const logger = realtimeLogger(strapi);

  if (candidate?.documentId) {
    await publishCandidateClassRealtimeEvent(
      {
        candidateDocumentId: candidate.documentId,
        classDocumentId: classRecord?.documentId,
        type: eventType,
      },
      logger
    );
  }

  if (classRecord?.documentId) {
    await publishClassRealtimeEvent(
      {
        candidateDocumentId: candidate?.documentId,
        classDocumentId: classRecord.documentId,
        type: eventType,
      },
      logger
    );
  }
};

const publishWaitingListOfferEvent = async ({
  offer,
  strapi,
  type,
}: {
  offer?: DocumentRecord;
  strapi: StrapiDocumentService;
  type:
    | 'waiting_list_offer_claimed'
    | 'waiting_list_offer_created'
    | 'waiting_list_offer_declined'
    | 'waiting_list_offer_expired'
    | 'waiting_list_offer_superseded';
}) => {
  const candidateDocumentId = offer?.candidate?.documentId;

  if (!candidateDocumentId) {
    return;
  }

  await publishCandidateClassRealtimeEvent(
    {
      candidateDocumentId,
      classDocumentId: offer.class?.documentId,
      offerDocumentId: offer.documentId,
      type,
    },
    realtimeLogger(strapi)
  );

  await publishClassRealtimeEvent(
    {
      candidateDocumentId,
      classDocumentId: offer.class?.documentId,
      offerDocumentId: offer.documentId,
      type,
    },
    realtimeLogger(strapi)
  );
};

const createSkippedWaitingListOffer = async ({
  classRecord,
  enrollment,
  reason,
  requestContext,
  sourceTrigger,
  strapi,
}: {
  classRecord: DocumentRecord;
  enrollment: DocumentRecord;
  reason: string;
  requestContext: RequestContext;
  sourceTrigger: WaitingListOfferSourceTrigger;
  strapi: StrapiDocumentService;
}) => {
  const now = new Date().toISOString();
  const skippedOffer = await documents(strapi, 'api::waiting-list-offer.waiting-list-offer').create({
    data: {
      candidate: enrollment.candidate?.documentId
        ? {
            connect: [{ documentId: enrollment.candidate.documentId }],
          }
        : undefined,
      class: {
        connect: [{ documentId: classRecord.documentId }],
      },
      enrollment: {
        connect: [{ documentId: enrollment.documentId }],
      },
      expiresAt: now,
      metadata: {
        reason,
      },
      offeredAt: now,
      skippedAt: now,
      sourceTrigger,
      offerState: 'skipped_ineligible',
      waitingListJoinedAt: enrollment.interestRegisteredAt,
      waitingListPositionAtOffer: enrollment.waitingListPosition,
    },
    populate: waitingListOfferPopulate,
  });

  await updateEnrollmentWaitingListOfferEligibility({
    eligible: false,
    enrollment,
    reason,
    strapi,
  });

  await recordWaitingListOfferAudit({
    eventType: 'candidate.waiting_list_offer_skipped',
    newState: sanitizeWaitingListOffer(skippedOffer),
    offer: skippedOffer,
    requestContext,
    severity: 'warning',
    source: 'system',
    strapi,
  });

  return skippedOffer;
};

const createWaitingListOffer = async ({
  classRecord,
  enrollment,
  requestContext,
  sourceTrigger,
  strapi,
}: {
  classRecord: DocumentRecord;
  enrollment: DocumentRecord;
  requestContext: RequestContext;
  sourceTrigger: WaitingListOfferSourceTrigger;
  strapi: StrapiDocumentService;
}) => {
  const existingOffer = await findActiveWaitingListOfferForEnrollment(strapi, enrollment);

  if (existingOffer) {
    return existingOffer;
  }

  const nowDate = new Date();
  const now = nowDate.toISOString();
  const offer = await documents(strapi, 'api::waiting-list-offer.waiting-list-offer').create({
    data: {
      candidate: {
        connect: [{ documentId: enrollment.candidate?.documentId }],
      },
      class: {
        connect: [{ documentId: classRecord.documentId }],
      },
      enrollment: {
        connect: [{ documentId: enrollment.documentId }],
      },
      expiresAt: getWaitingListOfferExpiry(nowDate),
      metadata: {
        class: sanitizeClass(classRecord),
        sourceTrigger,
      },
      offeredAt: now,
      sourceTrigger,
      offerState: 'active',
      waitingListJoinedAt: enrollment.interestRegisteredAt,
      waitingListPositionAtOffer: enrollment.waitingListPosition,
    },
    populate: waitingListOfferPopulate,
  });

  await addWaitingListOfferExpiryJob({
    classDocumentId: classRecord.documentId,
    expiresAt: offer.expiresAt!,
    offerDocumentId: offer.documentId!,
  });
  await queueWaitingListOfferNotifications(strapi, offer, requestContext);
  await recordWaitingListOfferAudit({
    eventType: 'candidate.waiting_list_offer_created',
    newState: sanitizeWaitingListOffer(offer),
    offer,
    requestContext,
    source: 'system',
    strapi,
  });
  await publishWaitingListOfferEvent({
    offer,
    strapi,
    type: 'waiting_list_offer_created',
  });

  return offer;
};

const promoteNextWaitingListOffer = async ({
  classRecord,
  excludeEnrollmentDocumentIds = [],
  requestContext = {},
  sourceTrigger,
  strapi,
}: {
  classRecord?: DocumentRecord;
  excludeEnrollmentDocumentIds?: string[];
  requestContext?: RequestContext;
  sourceTrigger: WaitingListOfferSourceTrigger;
  strapi: StrapiDocumentService;
}) => {
  if (!classRecord?.documentId || !classAllowsWaitingListOffers(classRecord)) {
    return undefined;
  }

  return withDatabaseTransaction(strapi, async (transactionContext) => {
    await lockClassForCapacityCheck(strapi, classRecord, transactionContext?.trx);

    const lockedClass = (await findClassByDocumentId(strapi, classRecord.documentId!)) || classRecord;

    if (!classAllowsWaitingListOffers(lockedClass)) {
      return undefined;
    }

    const activeOffer = await findActiveWaitingListOfferForClass(strapi, lockedClass);

    if (activeOffer) {
      return activeOffer;
    }

    const classCapacity = Number(lockedClass.capacity || 0);

    if (classCapacity <= 0 || (await countCapacityHeldPlaces(strapi, lockedClass)) >= classCapacity) {
      return undefined;
    }

    const waitingListEnrollments = await documents(strapi, 'api::enrollment.enrollment').findMany({
      filters: {
        class: {
          documentId: lockedClass.documentId,
        },
        enrollmentState: 'waiting_list',
      },
      limit: 1000,
      populate: ['candidate', 'class'],
      sort: ['waitingListPosition:asc', 'createdAt:asc'],
    });
    const excludedEnrollments = new Set(excludeEnrollmentDocumentIds);

    for (const enrollment of waitingListEnrollments) {
      if (!enrollment.documentId || excludedEnrollments.has(enrollment.documentId)) {
        continue;
      }

      if (!waitingListOfferEligibility(enrollment)) {
        continue;
      }

      if (!enrollment.candidate?.documentId || isCandidateRestricted(enrollment.candidate)) {
        await createSkippedWaitingListOffer({
          classRecord: lockedClass,
          enrollment,
          reason: isCandidateRestricted(enrollment.candidate)
            ? 'candidate_restricted'
            : 'candidate_missing',
          requestContext,
          sourceTrigger,
          strapi,
        });
        continue;
      }

      return createWaitingListOffer({
        classRecord: lockedClass,
        enrollment,
        requestContext,
        sourceTrigger,
        strapi,
      });
    }

    return undefined;
  });
};

const expireWaitingListOffer = async ({
  offer,
  requestContext,
  source = 'system',
  strapi,
}: {
  offer: DocumentRecord;
  requestContext: RequestContext;
  source?: 'candidate_dashboard' | 'system';
  strapi: StrapiDocumentService;
}) => {
  if (!offer.documentId || offerState(offer) !== 'active') {
    return offer;
  }

  const now = new Date().toISOString();
  const previousState = sanitizeWaitingListOffer(offer);
  const expiredOffer = await documents(strapi, 'api::waiting-list-offer.waiting-list-offer').update({
    documentId: offer.documentId,
    data: {
      expiredAt: now,
      metadata: {
        ...(objectValue(offer.metadata)),
        expiredBy: source,
      },
      offerState: 'expired',
    },
    populate: waitingListOfferPopulate,
  });

  await updateEnrollmentWaitingListOfferEligibility({
    eligible: false,
    enrollment: offer.enrollment,
    reason: 'waiting_list_offer_expired',
    strapi,
  });

  if (offer.candidate?.documentId && offer.class?.documentId) {
    await releaseClassPlaceAllocation({
      candidateDocumentId: offer.candidate.documentId,
      classDocumentId: offer.class.documentId,
      removeWaitlist: true,
    }).catch((error) => {
      const logger = (strapi as unknown as { log?: { error?: (message: string, error?: unknown) => void } }).log;
      logger?.error?.('Class allocation Redis waiting-list offer expiry cleanup failed.', error);
    });
  }

  await recordWaitingListOfferAudit({
    eventType: 'candidate.waiting_list_offer_expired',
    newState: sanitizeWaitingListOffer(expiredOffer),
    offer: expiredOffer,
    previousState,
    requestContext,
    severity: 'warning',
    source,
    strapi,
  });
  await publishWaitingListOfferEvent({
    offer: expiredOffer,
    strapi,
    type: 'waiting_list_offer_expired',
  });

  return expiredOffer;
};

const supersedeWaitingListOffer = async ({
  offer,
  reason,
  requestContext,
  strapi,
}: {
  offer?: DocumentRecord;
  reason: string;
  requestContext: RequestContext;
  strapi: StrapiDocumentService;
}) => {
  if (!offer?.documentId || offerState(offer) !== 'active') {
    return offer;
  }

  const now = new Date().toISOString();
  const previousState = sanitizeWaitingListOffer(offer);
  const supersededOffer = await documents(strapi, 'api::waiting-list-offer.waiting-list-offer').update({
    documentId: offer.documentId,
    data: {
      metadata: {
        ...(objectValue(offer.metadata)),
        supersededReason: reason,
      },
      offerState: 'superseded',
      supersededAt: now,
    },
    populate: waitingListOfferPopulate,
  });

  await recordWaitingListOfferAudit({
    eventType: 'candidate.waiting_list_offer_skipped',
    newState: sanitizeWaitingListOffer(supersededOffer),
    offer: supersededOffer,
    previousState,
    requestContext,
    severity: 'warning',
    source: 'system',
    strapi,
  });
  await publishWaitingListOfferEvent({
    offer: supersededOffer,
    strapi,
    type: 'waiting_list_offer_superseded',
  });

  return supersededOffer;
};

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

type PaymentServiceCheckoutLookupResponse = {
  data?: unknown;
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

type PaymentConfirmationActor = {
  actorEmail?: string;
  actorId?: string;
  actorType: 'candidate' | 'service';
  eventType: string;
  source: 'core_api' | 'payment_service';
};

type PaymentExceptionReason =
  | 'class_capacity_conflict'
  | 'reservation_cancelled'
  | 'reservation_released';

type ProviderPaymentOutcome = 'expired' | 'failed';

const classPaymentAmount = (classRecord?: DocumentRecord) =>
  classRecord?.discountedPricePence ?? classRecord?.pricePence ?? 0;

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

const adminDashboardSupportCaseUrl = (supportCaseDocumentId: string) =>
  `${trimTrailingSlash(process.env.ADMIN_DASHBOARD_PUBLIC_URL || 'http://localhost:3003')}/support/${encodeURIComponent(supportCaseDocumentId)}`;

const findSupportCaseRecordForCandidate = async ({
  candidateDocumentId,
  strapi,
  supportCaseDocumentId,
}: {
  candidateDocumentId: string;
  strapi: StrapiDocumentService;
  supportCaseDocumentId: string;
}) => {
  const cases = await documents(strapi, 'api::support-case.support-case').findMany({
    filters: {
      candidate: {
        documentId: candidateDocumentId,
      },
      documentId: supportCaseDocumentId,
    },
    limit: 1,
    populate: ['candidate', 'refund', 'payment', 'enrollment'],
  });

  return cases[0];
};

const buildAssignedOwnerSupportEmail = ({
  candidate,
  supportCase,
}: {
  candidate: DocumentRecord;
  supportCase: DocumentRecord;
}) => {
  const supportCaseDocumentId = String(supportCase.documentId);
  const url = adminDashboardSupportCaseUrl(supportCaseDocumentId);
  const ownerName =
    typeof supportCase.ownerStaffDisplayName === 'string' && supportCase.ownerStaffDisplayName.trim()
      ? supportCase.ownerStaffDisplayName.trim().split(/\s+/)[0]
      : 'there';
  const candidateName = candidateMessageDisplayName(candidate);
  const caseTitle = typeof supportCase.title === 'string' && supportCase.title.trim()
    ? supportCase.title.trim()
    : 'Support case';
  const subject = 'New reply on an assigned HireFlip support case';
  const bodyLines = [
    `Hi ${ownerName},`,
    `${candidateName} has replied to an assigned support case.`,
    caseTitle,
  ];

  return {
    bodyLines,
    ctaLabel: 'Open the support case',
    ctaUrl: url,
    subject,
    text: [
      ...bodyLines,
      '',
      `Open the support case: ${url}`,
      '',
      'HireFlip',
    ].join('\n'),
    url,
  };
};

const queueAssignedOwnerSupportNotification = async ({
  candidate,
  requestContext,
  strapi,
  supportCase,
}: {
  candidate: DocumentRecord;
  requestContext: RequestContext;
  strapi: StrapiDocumentService;
  supportCase: DocumentRecord;
}) => {
  const supportCaseDocumentId = supportCase.documentId;

  if (!supportCaseDocumentId || !supportCase.ownerStaffEmail) {
    return {
      emailQueued: false,
    };
  }

  try {
    const content = buildAssignedOwnerSupportEmail({ candidate, supportCase });
    const emailQueueResult = await requestNotificationServiceEmail({
      correlationId: supportCaseDocumentId,
      subject: content.subject,
      template: {
        key: 'generic_branded_message',
        variables: {
          bodyLines: content.bodyLines,
          ctaLabel: content.ctaLabel,
          ctaUrl: content.ctaUrl,
          heading: content.subject,
          subject: content.subject,
        },
      },
      to: supportCase.ownerStaffEmail,
      type: 'admin_support_case_candidate_reply',
    });
    const emailQueued = emailQueueResult?.data?.queued === true;

    await documents(strapi, 'api::notification-event.notification-event').create({
      data: {
        channel: 'email',
        deliveryState: emailQueued ? 'queued' : 'failed',
        eventType: 'admin.support_case_candidate_reply',
        metadata: {
          candidateDocumentId: candidate.documentId,
          notificationServiceJobId:
            typeof emailQueueResult?.data?.jobId === 'string'
              ? emailQueueResult.data.jobId
              : undefined,
          ownerStaffUserId: supportCase.ownerStaffUserId,
          requestId: requestContext.requestId,
          supportCaseDocumentId,
          url: content.url,
        },
        priority: 'normal',
        recipientEmail: supportCase.ownerStaffEmail,
        recipientId: supportCase.ownerStaffUserId,
        recipientType: 'admin',
        relatedId: supportCaseDocumentId,
        relatedType: 'support_case',
        templateKey: 'admin_support_case_candidate_reply',
      },
    });

    return {
      emailQueued,
    };
  } catch (error) {
    strapi.log?.error?.('Assigned support owner notification failed.', error);

    return {
      emailQueued: false,
    };
  }
};

const splitPolicyBodyIntoParagraphs = (body?: string) =>
  (body || '')
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean);

const sanitizePolicyDocument = (policyDocument?: DocumentRecord) => {
  if (!policyDocument) {
    return null;
  }

  return {
    acceptanceLabel: policyDocument.acceptanceLabel,
    documentId: policyDocument.documentId,
    introCopy: policyDocument.introCopy,
    paragraphs: splitPolicyBodyIntoParagraphs(policyDocument.body),
    policyType: policyDocument.policyType,
    title: policyDocument.title,
    version: policyDocument.version,
  };
};

const findActivePolicyDocument = async (
  strapi: StrapiDocumentService,
  policyType: string
) => {
  const policyDocuments = await documents(strapi, 'api::policy-document.policy-document').findMany({
    filters: {
      policyState: 'active',
      policyType,
    },
    limit: 1,
    sort: ['effectiveFrom:desc', 'createdAt:desc'],
  });

  return policyDocuments[0];
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

const buildDashboardClassOfferUrl = (offer: DocumentRecord) => {
  const baseUrl = trimTrailingSlash(process.env.CANDIDATE_DASHBOARD_BASE_URL || 'http://localhost:3001');
  const url = new URL(`${baseUrl}/class`);

  if (offer.documentId) {
    url.searchParams.set('waitingListOffer', offer.documentId);
  }

  return url.toString();
};

const buildDashboardInterviewsUrl = () =>
  `${trimTrailingSlash(process.env.CANDIDATE_DASHBOARD_BASE_URL || 'http://localhost:3001')}/interviews`;

const buildEmployerDashboardInterviewsUrl = () =>
  `${trimTrailingSlash(process.env.EMPLOYER_DASHBOARD_BASE_URL || 'http://localhost:3004')}/interviews`;

const candidateInterviewSlotReminderIntervalMs = () =>
  getIntegerEnv('CANDIDATE_INTERVIEW_SLOT_REMINDER_INTERVAL_HOURS', 12) * 60 * 60 * 1000;

const candidateInterviewSlotReminderMax = () =>
  getIntegerEnv('CANDIDATE_INTERVIEW_SLOT_REMINDER_MAX', 4);

const buildDashboardOrderProcessingUrl = (reservationDocumentId: string) => {
  const baseUrl = trimTrailingSlash(process.env.CANDIDATE_DASHBOARD_BASE_URL || 'http://localhost:3001');
  const url = new URL(`${baseUrl}/order-processing/${reservationDocumentId}`);

  url.searchParams.set('session_id', '{CHECKOUT_SESSION_ID}');

  return url.toString().replace('%7BCHECKOUT_SESSION_ID%7D', '{CHECKOUT_SESSION_ID}');
};

const candidateInterviewSlotOfferPopulate = {
  capacityClaim: true,
  candidate: true,
  employer: true,
  employerContact: true,
  enrollment: {
    populate: ['class'],
  },
  interviewRequest: {
    populate: {
      class: {
        populate: ['workSector'],
      },
      region: true,
    },
  },
  selectedInterview: {
    populate: ['employer', 'employerContact'],
  },
  selectedSlot: {
    populate: ['employerContact'],
  },
  slots: {
    populate: ['employer', 'employerContact'],
  },
};

const documentRecordValue = (value: unknown): DocumentRecord | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as DocumentRecord)
    : undefined;

const stringValue = (value: unknown) => (typeof value === 'string' ? value : undefined);

const relationConnect = (record?: unknown) => {
  const documentRecord = documentRecordValue(record);

  return documentRecord?.documentId
    ? {
        connect: [{ documentId: documentRecord.documentId }],
      }
    : undefined;
};

const sortSlotsByStartTime = (slots: unknown) =>
  (Array.isArray(slots) ? slots : [])
    .filter((slot): slot is DocumentRecord => Boolean(slot && typeof slot === 'object'))
    .sort((left, right) => String(left.startTime || '').localeCompare(String(right.startTime || '')));

const snapshotInterviewSlot = (slot: DocumentRecord) => ({
  documentId: slot.documentId || null,
  endTime: slot.endTime || null,
  locationDetails: slot.locationDetails || null,
  locationType: slot.locationType || 'to_be_confirmed',
  meetingUrl: slot.meetingUrl || null,
  slotState: slot.slotState || null,
  startTime: slot.startTime || null,
});

const reusableSlotRelationData = (slot: DocumentRecord, offer: DocumentRecord) => {
  const interviewRequest = documentRecordValue(offer.interviewRequest);
  const region = documentRecordValue(interviewRequest?.region);
  const workSector = documentRecordValue(documentRecordValue(interviewRequest?.class)?.workSector);

  return {
    ...(slot.region || !region?.documentId ? {} : { region: relationConnect(region) }),
    ...(slot.workSector || !workSector?.documentId ? {} : { workSector: relationConnect(workSector) }),
  };
};

const historicalSlotSnapshot = (offer?: DocumentRecord | null) => {
  const snapshot = objectValue(offer?.metadata).historicalSlotsSnapshot;

  return Array.isArray(snapshot)
    ? snapshot.filter((slot): slot is DocumentRecord => Boolean(slot && typeof slot === 'object'))
    : [];
};

const publicLocationTypeLabel = (value?: unknown) => {
  const rawValue = String(value || '').trim();

  if (rawValue === 'in_person') {
    return 'In person';
  }

  if (rawValue === 'online') {
    return 'Remote';
  }

  if (rawValue === 'phone') {
    return 'Phone';
  }

  return 'To be confirmed';
};

const employerContactDisplayName = (contact?: DocumentRecord | null) =>
  [contact?.firstName, contact?.lastName].filter(Boolean).join(' ') ||
  contact?.email ||
  null;

const candidateReportVisibleStates = new Set(['generated', 'approved', 'manually_edited']);

const normalizeCandidateReportTakeaways = (value: unknown) =>
  (Array.isArray(value) ? value : [])
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .slice(0, 3);

const sanitizeCandidateFeedbackReport = (feedback?: DocumentRecord | null) => {
  if (!feedback) {
    return null;
  }

  const state = String(feedback.candidateReportState || 'pending');
  const visible = candidateReportVisibleStates.has(state);
  const concernState = String(feedback.candidateReportConcernState || 'none');
  const supportCase = documentRecordValue(feedback.candidateReportConcernSupportCase);

  return {
    conclusion: visible ? feedback.candidateReportConclusion || null : null,
    concern: {
      flaggedAt: feedback.candidateReportConcernFlaggedAt || null,
      reason: feedback.candidateReportConcernReason || null,
      resolvedAt: feedback.candidateReportConcernResolvedAt || null,
      state: concernState,
      supportCaseDocumentId: supportCase?.documentId || null,
    },
    generatedAt: visible ? feedback.candidateReportGeneratedAt || null : null,
    improvements: visible ? feedback.candidateReportImprovements || null : null,
    intro: visible ? feedback.candidateReportIntro || null : null,
    state,
    strengths: visible ? feedback.candidateReportStrengths || null : null,
    submittedAt: feedback.submittedAt || feedback.createdAt || null,
    takeaways: visible ? normalizeCandidateReportTakeaways(feedback.candidateReportTakeaways) : [],
    visibleAt: visible ? feedback.candidateReportVisibleAt || null : null,
  };
};

const sanitizeCandidateInterviewSlot = (slot?: DocumentRecord | null, revealDetails = false) => {
  if (!slot) {
    return null;
  }

  return {
    documentId: slot.documentId,
    endTime: slot.endTime,
    locationDetails: revealDetails ? slot.locationDetails || null : null,
    locationLabel: publicLocationTypeLabel(slot.locationType),
    locationType: slot.locationType || 'to_be_confirmed',
    meetingUrl: revealDetails ? slot.meetingUrl || null : null,
    startTime: slot.startTime,
    state: slot.slotState || 'offered',
  };
};

const sanitizeCandidateInterviewRecord = (
  interview?: DocumentRecord | null,
  feedback?: DocumentRecord | null
) => {
  if (!interview) {
    return null;
  }

  const detailsVisible = ['confirmed', 'completed'].includes(String(interview.interviewState || ''));
  const employerContact = documentRecordValue(interview.employerContact);

  return {
    arrivalInstructions: detailsVisible ? interview.arrivalInstructions || null : null,
    candidateInstructions: detailsVisible ? interview.candidateInstructions || null : null,
    countsTowardGuarantee: Boolean(interview.countsTowardGuarantee),
    detailsPending: !detailsVisible,
    documentId: interview.documentId,
    interviewerName: detailsVisible
      ? interview.interviewerName || employerContactDisplayName(employerContact)
      : null,
    locationDetails: detailsVisible ? interview.locationDetails || null : null,
    locationLabel: detailsVisible ? publicLocationTypeLabel(interview.locationType) : null,
    locationType: detailsVisible ? interview.locationType || 'to_be_confirmed' : null,
    meetingUrl: detailsVisible ? interview.meetingUrl || null : null,
    scheduledEndTime: interview.scheduledEndTime,
    scheduledStartTime: interview.scheduledStartTime,
    state: interview.interviewState || 'awaiting_employer_details',
    feedbackReport: sanitizeCandidateFeedbackReport(feedback),
  };
};

const sanitizeCandidateInterviewSlotOffer = (
  offer?: DocumentRecord | null,
  feedbackByInterviewId = new Map<string, DocumentRecord>()
) => {
  if (!offer) {
    return null;
  }

  const selectedInterviewRecord = documentRecordValue(offer.selectedInterview);
  const selectedInterviewDocumentId =
    typeof selectedInterviewRecord?.documentId === 'string' ? selectedInterviewRecord.documentId : null;
  const selectedInterview = sanitizeCandidateInterviewRecord(
    selectedInterviewRecord,
    selectedInterviewDocumentId ? feedbackByInterviewId.get(selectedInterviewDocumentId) : null
  );
  const detailsVisible = selectedInterview?.detailsPending === false;
  const employer = detailsVisible
    ? documentRecordValue(selectedInterviewRecord?.employer) || documentRecordValue(offer.employer)
    : null;
  const selectedSlot = documentRecordValue(offer.selectedSlot);
  const candidateResponseDeadline =
    typeof offer.candidateResponseDeadline === 'string'
      ? offer.candidateResponseDeadline
      : null;

  return {
    candidateInterviewFormatPreference: offer.candidateInterviewFormatPreference || null,
    candidateResponseDeadline,
    candidateRespondedAt: offer.candidateRespondedAt || null,
    candidateWarningSentAt: offer.candidateWarningSentAt || null,
    candidateWarningState: offer.candidateWarningState || 'none',
    declineNote: offer.declineNote || null,
    declineReason: offer.declineReason || null,
    documentId: offer.documentId,
    employer: employer
      ? {
          companyName: employer.companyName || employer.name || null,
          documentId: employer.documentId || null,
        }
      : null,
    offerState: offer.offerState || 'submitted',
    responseExpired: Boolean(isPastDate(candidateResponseDeadline || undefined)),
    selectedInterview,
    selectedSlot: sanitizeCandidateInterviewSlot(selectedSlot, detailsVisible),
    slots: (sortSlotsByStartTime(offer.slots).length
      ? sortSlotsByStartTime(offer.slots)
      : historicalSlotSnapshot(offer)
    ).map((slot) => sanitizeCandidateInterviewSlot(slot, false)),
  };
};

const findCandidateInterviewSlotOffer = async (
  strapi: StrapiDocumentService,
  candidate: DocumentRecord,
  offerDocumentId: string
) => {
  const offers = await documents(strapi, 'api::interview-slot-offer.interview-slot-offer').findMany({
    filters: {
      candidate: {
        documentId: candidate.documentId,
      },
      documentId: offerDocumentId,
    },
    limit: 1,
    populate: candidateInterviewSlotOfferPopulate,
  });

  return offers[0] || null;
};

const findCandidateInterviewSlotOffers = async (
  strapi: StrapiDocumentService,
  candidate: DocumentRecord
) =>
  documents(strapi, 'api::interview-slot-offer.interview-slot-offer').findMany({
    filters: {
      candidate: {
        documentId: candidate.documentId,
      },
    },
    limit: 50,
    populate: candidateInterviewSlotOfferPopulate,
    sort: ['candidateResponseDeadline:asc', 'createdAt:desc'],
  });

const findCandidateFeedbackReportsByInterviewId = async (
  strapi: StrapiDocumentService,
  interviewDocumentIds: string[]
) => {
  if (!interviewDocumentIds.length) {
    return new Map<string, DocumentRecord>();
  }

  const feedbackRecords = await documents(strapi, 'api::interview-feedback.interview-feedback').findMany({
    filters: {
      interview: {
        documentId: {
          $in: interviewDocumentIds,
        },
      },
      submittedByType: 'employer_contact',
    },
    limit: 100,
    populate: ['candidateReportConcernSupportCase', 'interview'],
    sort: ['candidateReportVisibleAt:desc', 'candidateReportGeneratedAt:desc', 'submittedAt:desc'],
  });
  const feedbackByInterviewId = new Map<string, DocumentRecord>();

  feedbackRecords.forEach((feedback) => {
    const interview = documentRecordValue(feedback.interview);
    const interviewDocumentId = typeof interview?.documentId === 'string' ? interview.documentId : null;

    if (interviewDocumentId && !feedbackByInterviewId.has(interviewDocumentId)) {
      feedbackByInterviewId.set(interviewDocumentId, feedback);
    }
  });

  return feedbackByInterviewId;
};

const findCandidateFeedbackReportForInterview = async ({
  candidate,
  interviewDocumentId,
  strapi,
}: {
  candidate: DocumentRecord;
  interviewDocumentId: string;
  strapi: StrapiDocumentService;
}) => {
  const interviews = await documents(strapi, 'api::interview.interview').findMany({
    filters: {
      candidate: {
        documentId: candidate.documentId,
      },
      documentId: interviewDocumentId,
    },
    limit: 1,
  });

  if (!interviews[0]) {
    return null;
  }

  const feedbackRecords = await documents(strapi, 'api::interview-feedback.interview-feedback').findMany({
    filters: {
      candidateReportState: {
        $in: Array.from(candidateReportVisibleStates),
      },
      interview: {
        documentId: interviewDocumentId,
      },
      submittedByType: 'employer_contact',
    },
    limit: 1,
    populate: ['candidateReportConcernSupportCase', 'interview'],
    sort: ['candidateReportVisibleAt:desc', 'candidateReportGeneratedAt:desc', 'submittedAt:desc'],
  });

  return feedbackRecords[0] || null;
};

const hasPriorCandidateSlotWarning = async (
  strapi: StrapiDocumentService,
  candidate: DocumentRecord,
  currentOfferDocumentId?: string
) => {
  const offers = await documents(strapi, 'api::interview-slot-offer.interview-slot-offer').findMany({
    filters: {
      candidate: {
        documentId: candidate.documentId,
      },
      candidateWarningState: {
        $in: ['warning_sent', 'strike_applied'],
      },
    },
    limit: 25,
    sort: ['candidateWarningSentAt:desc', 'candidateRespondedAt:desc', 'createdAt:desc'],
  });

  return offers.some((offer) => offer.documentId !== currentOfferDocumentId);
};

const nextCandidateInterviewStrikeNumber = async (
  strapi: StrapiDocumentService,
  candidate: DocumentRecord
) => {
  const strikes = await documents(strapi, 'api::candidate-interview-strike.candidate-interview-strike').findMany({
    filters: {
      candidate: {
        documentId: candidate.documentId,
      },
      strikeState: {
        $in: ['active', 'appealed', 'upheld'],
      },
    },
    limit: 100,
  });

  return strikes.length + 1;
};

const queueCandidateSlotOutcomeNotification = async ({
  candidate,
  eventType,
  offer,
  requestContext,
  strapi,
  subject,
  type,
}: {
  candidate: DocumentRecord;
  eventType: string;
  offer: DocumentRecord;
  requestContext: RequestContext;
  strapi: StrapiDocumentService;
  subject: string;
  type: 'strike' | 'warning';
}) => {
  const dashboardUrl = buildDashboardInterviewsUrl();
  const candidateName = candidate.firstName || 'there';
  const bodyLines =
    type === 'warning'
      ? [
          `Hi ${candidateName},`,
          'You declined or missed all of the interview slot options we sent you.',
          "This is a warning. Future missed or declined slot sets may add an interview strike under HireFlip's terms.",
        ]
      : [
          `Hi ${candidateName},`,
          'An interview strike has been added because another interview slot set was missed or declined.',
          'You can review your interview status in your HireFlip dashboard.',
        ];
  const emailAllowed = Boolean(candidate.email);
  const emailQueueResult =
    emailAllowed && typeof candidate.email === 'string'
      ? await requestNotificationServiceEmail({
          correlationId: offer.documentId,
          subject,
          template: {
            key: 'generic_branded_message',
            variables: {
              bodyLines,
              ctaLabel: 'Review interview status',
              ctaUrl: dashboardUrl,
              heading: subject,
              subject,
            },
          },
          to: candidate.email,
          type: eventType.replace(/\./g, '_'),
        })
      : undefined;

  await Promise.all(
    [
      {
        channel: 'in_app',
        deliveryState: 'queued',
        jobId: undefined,
      },
      ...(emailAllowed
        ? [
            {
              channel: 'email',
              deliveryState: emailQueueResult?.data?.queued === true ? 'queued' : 'failed',
              jobId: emailQueueResult?.data?.jobId,
            },
          ]
        : []),
    ].map(({ channel, deliveryState, jobId }) =>
      documents(strapi, 'api::notification-event.notification-event').create({
        data: {
          candidate: relationConnect(candidate),
          channel,
          class: relationConnect(documentRecordValue(offer.enrollment)?.class),
          deliveryState,
          eventType,
          metadata: {
            dashboardUrl,
            interviewSlotOfferDocumentId: offer.documentId,
            notificationServiceJobId: typeof jobId === 'string' ? jobId : undefined,
            requestId: requestContext.requestId,
            warningType: type,
          },
          priority: 'urgent',
          recipientEmail: candidate.email,
          recipientId: candidate.documentId,
          recipientType: 'candidate',
          relatedId: offer.documentId,
          relatedType: 'interview_slot_offer',
          templateKey: channel === 'email' ? 'generic_branded_message' : undefined,
        },
      })
    )
  );
};

const queueCandidateSlotOfferReminderNotification = async ({
  candidate,
  offer,
  requestContext,
  strapi,
}: {
  candidate: DocumentRecord;
  offer: DocumentRecord;
  requestContext: RequestContext;
  strapi: StrapiDocumentService;
}) => {
  const dashboardUrl = buildDashboardInterviewsUrl();
  const candidateName = candidate.firstName || 'there';
  const deadline = stringValue(offer.candidateResponseDeadline);
  const notificationPreferences = objectValue(candidate.notificationPreferences);
  const channelPreferences = objectValue(notificationPreferences.channels);
  const emailAllowed = Boolean(candidate.email) && channelPreferences.email !== false;
  const smsAllowed = Boolean(candidate.phone) && channelPreferences.sms === true;
  const subject = 'Reminder: your interview slots need a response';
  const bodyLines = [
    `Hi ${candidateName},`,
    'Your interview slot options are still waiting for your response.',
    'Please review all available options in your HireFlip dashboard before the response window closes.',
  ];
  const emailQueueResult =
    emailAllowed && typeof candidate.email === 'string'
      ? await requestNotificationServiceEmail({
          correlationId: offer.documentId,
          subject,
          template: {
            key: 'generic_branded_message',
            variables: {
              bodyLines,
              ctaLabel: 'Review interview slots',
              ctaUrl: dashboardUrl,
              heading: subject,
              subject,
            },
          },
          to: candidate.email,
          type: 'candidate_interview_slot_response_reminder',
        })
      : undefined;
  const smsQueueResult =
    smsAllowed && typeof candidate.phone === 'string'
      ? await requestNotificationServiceSms({
          body: `HireFlip: reminder, your interview slots need a response. Review them here: ${dashboardUrl}`,
          correlationId: offer.documentId,
          to: candidate.phone,
          type: 'candidate_interview_slot_response_reminder',
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
          candidate: relationConnect(candidate),
          channel,
          class: relationConnect(documentRecordValue(offer.enrollment)?.class),
          deliveryState,
          eventType: 'candidate.interview_slot_response_reminder',
          metadata: {
            candidateResponseDeadline: deadline,
            dashboardUrl,
            interviewSlotOfferDocumentId: offer.documentId,
            notificationServiceJobId: typeof jobId === 'string' ? jobId : undefined,
            reminderCount: positiveNumber(offer.candidateResponseReminderCount) + 1,
            requestId: requestContext.requestId,
          },
          priority: 'urgent',
          recipientEmail: candidate.email,
          recipientId: candidate.documentId,
          recipientPhone,
          recipientType: 'candidate',
          relatedId: offer.documentId,
          relatedType: 'interview_slot_offer',
          templateKey: channel === 'email' ? 'generic_branded_message' : undefined,
        },
      })
    )
  );
};

const queueEmployerInterviewSetupNotification = async ({
  candidate,
  employerContact,
  interview,
  offer,
  requestContext,
  strapi,
}: {
  candidate: DocumentRecord;
  employerContact?: DocumentRecord | null;
  interview: DocumentRecord;
  offer: DocumentRecord;
  requestContext: RequestContext;
  strapi: StrapiDocumentService;
}) => {
  if (!employerContact?.email) {
    return;
  }

  const subject = 'Interview details need confirming';
  const dashboardUrl = buildEmployerDashboardInterviewsUrl();
  const candidateName = candidateMessageDisplayName(candidate);
  const bodyLines = [
    `${candidateName} has selected one of your proposed interview slots.`,
    'Please confirm the interview details in your HireFlip employer dashboard so the candidate can receive the final location or joining instructions.',
  ];
  const emailQueueResult = await requestNotificationServiceEmail({
    correlationId: interview.documentId,
    subject,
    template: {
      key: 'generic_branded_message',
      variables: {
        bodyLines,
        ctaLabel: 'Confirm interview details',
        ctaUrl: dashboardUrl,
        heading: subject,
        subject,
      },
    },
    to: String(employerContact.email),
    type: 'employer_interview_details_required',
  });

  await documents(strapi, 'api::notification-event.notification-event').create({
    data: {
      channel: 'email',
      deliveryState: emailQueueResult?.data?.queued === true ? 'queued' : 'failed',
      employer: relationConnect(offer.employer),
      eventType: 'employer.interview_details_required',
      interview: relationConnect(interview),
      metadata: {
        dashboardUrl,
        interviewSlotOfferDocumentId: offer.documentId,
        notificationServiceJobId:
          typeof emailQueueResult?.data?.jobId === 'string'
            ? emailQueueResult.data.jobId
            : undefined,
        requestId: requestContext.requestId,
      },
      priority: 'urgent',
      recipientEmail: String(employerContact.email),
      recipientId: employerContact.documentId,
      recipientType: 'employer_contact',
      relatedId: interview.documentId,
      relatedType: 'interview',
      templateKey: 'generic_branded_message',
    },
  });
};

const releaseCandidateDeclinedSlotOfferSlots = async ({
  offer,
  outcome,
  requestContext,
  strapi,
}: {
  offer: DocumentRecord;
  outcome: 'candidate_declined' | 'expired';
  requestContext: RequestContext;
  strapi: StrapiDocumentService;
}) => {
  const reusableThreshold = addWorkingDays(new Date(), 4);
  const slots = sortSlotsByStartTime(offer.slots);
  const existingMetadata = objectValue(offer.metadata);

  if (offer.documentId && !Array.isArray(existingMetadata.historicalSlotsSnapshot)) {
    await documents(strapi, 'api::interview-slot-offer.interview-slot-offer').update({
      documentId: offer.documentId,
      data: {
        metadata: {
          ...existingMetadata,
          historicalSlotsSnapshot: slots.map(snapshotInterviewSlot),
          historicalSlotsSnapshotAt: new Date().toISOString(),
          historicalSlotsSnapshotRequestId: requestContext.requestId,
        },
      },
    });
  }

  await Promise.all(
    slots.map((slot) => {
      const startTime = slot.startTime ? new Date(String(slot.startTime)) : undefined;
      const reusable = Boolean(startTime && startTime >= reusableThreshold);

      return documents(strapi, 'api::interview-slot.interview-slot').update({
        documentId: slot.documentId,
        data: {
          metadata: {
            ...(objectValue(slot.metadata)),
            candidateOutcome: outcome,
            candidateOutcomeAt: new Date().toISOString(),
            previousOfferDocumentId: offer.documentId,
            requestId: requestContext.requestId,
          },
          ...reusableSlotRelationData(slot, offer),
          slotState: reusable ? 'available' : 'expired',
        },
      });
    })
  );
};

const releaseCandidateOfferCapacityClaim = async ({
  offer,
  outcome,
  requestContext,
  strapi,
}: {
  offer: DocumentRecord;
  outcome: 'candidate_declined' | 'expired';
  requestContext: RequestContext;
  strapi: StrapiDocumentService;
}) => {
  const capacityClaim = documentRecordValue(offer.capacityClaim);

  if (!capacityClaim?.documentId) {
    return;
  }

  await documents(strapi, 'api::employer-capacity-claim.employer-capacity-claim').update({
    documentId: capacityClaim.documentId,
    data: {
      claimState: outcome === 'expired' ? 'expired' : 'released',
      releaseNote: outcome === 'expired' ? 'Candidate missed the response deadline.' : offer.declineNote || null,
      releaseReason: outcome === 'expired' ? 'expired' : 'candidate_declined_slots',
      releasedAt: new Date().toISOString(),
      metadata: {
        ...(objectValue(capacityClaim.metadata)),
        candidateOutcome: outcome,
        candidateOutcomeOfferDocumentId: offer.documentId,
        requestId: requestContext.requestId,
      },
    },
  });
};

const updateRequestAfterCandidateSlotOutcome = async ({
  offer,
  requestContext,
  strapi,
}: {
  offer: DocumentRecord;
  requestContext: RequestContext;
  strapi: StrapiDocumentService;
}) => {
  const interviewRequest = documentRecordValue(offer.interviewRequest);

  if (interviewRequest?.documentId) {
    await documents(strapi, 'api::interview-request.interview-request').update({
      documentId: interviewRequest.documentId,
      data: {
        candidateVisibleState: 'arranging_interviews',
        claimedInterviewCount: 0,
        fulfilledInterviewCount: 0,
        lastCapacityCheckAt: new Date().toISOString(),
        requestState: 'pending_capacity',
      },
    });
  }

  const enrollment = documentRecordValue(offer.enrollment);

  if (enrollment?.documentId) {
    await interviewRequestService(strapi)
      .ensureForEnrollment(
        {
          enrollmentDocumentId: enrollment.documentId,
          source: 'candidate_slot_offer_outcome',
        },
        requestContext
      )
      .catch((error) => {
        strapi.log?.error?.('Interview request reroute failed after candidate slot outcome.', error);
      });
  }
};

const applyCandidateSlotOfferMissedOrDeclined = async ({
  candidate,
  declineNote,
  declineReason,
  offer,
  outcome,
  outcomeSource,
  requestContext,
  strapi,
}: {
  candidate: DocumentRecord;
  declineNote?: string;
  declineReason?: (typeof candidateInterviewDeclineReasons)[number];
  offer: DocumentRecord;
  outcome: 'candidate_declined' | 'expired';
  outcomeSource?: string;
  requestContext: RequestContext;
  strapi: StrapiDocumentService;
}) => {
  const now = new Date().toISOString();
  const priorWarning = await hasPriorCandidateSlotWarning(strapi, candidate, offer.documentId);
  const warningState = priorWarning ? 'strike_applied' : 'warning_sent';
  const previousState = sanitizeCandidateInterviewSlotOffer(offer);
  let strike: DocumentRecord | undefined;

  const updatedOffer = await documents(strapi, 'api::interview-slot-offer.interview-slot-offer').update({
    documentId: offer.documentId,
    data: {
      candidateRespondedAt: outcome === 'candidate_declined' ? now : offer.candidateRespondedAt || null,
      candidateWarningSentAt: priorWarning ? offer.candidateWarningSentAt || null : now,
      candidateWarningState: warningState,
      declineNote: outcome === 'candidate_declined' ? declineNote : offer.declineNote || null,
      declineReason: outcome === 'candidate_declined' ? declineReason : offer.declineReason || null,
      metadata: {
        ...(objectValue(offer.metadata)),
        candidateOutcomeAt: now,
        candidateOutcomeSource:
          outcomeSource ||
          (outcome === 'expired' ? 'candidate_dashboard_expiry_check' : 'candidate_dashboard'),
        requestId: requestContext.requestId,
      },
      offerState: outcome === 'expired' ? 'expired' : 'candidate_declined',
    },
    populate: candidateInterviewSlotOfferPopulate,
  });

  if (priorWarning) {
    const strikeNumber = await nextCandidateInterviewStrikeNumber(strapi, candidate);

    strike = await documents(strapi, 'api::candidate-interview-strike.candidate-interview-strike').create({
      data: {
        appliedAt: now,
        candidate: relationConnect(candidate),
        enrollment: relationConnect(offer.enrollment),
        metadata: {
          declineNote: declineNote || null,
          declineReason: declineReason || null,
          interviewSlotOfferDocumentId: offer.documentId,
          outcome,
          requestId: requestContext.requestId,
        },
        reason:
          outcome === 'expired'
            ? 'candidate_missed_slot_response_deadline'
            : 'candidate_declined_all_slots',
        strikeNumber,
        strikeState: 'active',
      },
    });

    await queueCandidateSlotOutcomeNotification({
      candidate,
      eventType: 'candidate.interview_slot_strike_created',
      offer: updatedOffer,
      requestContext,
      strapi,
      subject: 'An interview strike has been added',
      type: 'strike',
    });

    if (strikeNumber >= 3) {
      await auditEvents(strapi).record({
        actorType: 'system',
        eventCategory: 'interview',
        eventType: 'candidate.interview_strike_review_required',
        ipAddress: requestContext.ipAddress,
        metadata: {
          interviewSlotOfferDocumentId: offer.documentId,
          requestId: requestContext.requestId,
          strikeNumber,
        },
        requestId: requestContext.requestId,
        serviceName: requestContext.serviceName,
        severity: 'error',
        source: 'core_api',
        subjectDisplayName: candidateMessageDisplayName(candidate),
        subjectId: candidate.documentId,
        subjectType: 'candidate',
        userAgent: requestContext.userAgent,
      });
      await publishAdminRealtimeEvent(
        {
          channels: ['operations'],
          resourceKey: candidate.documentId,
          resourceType: 'candidate',
          type: 'admin_tasks_changed',
        },
        strapi.log
      );
    }
  } else {
    await queueCandidateSlotOutcomeNotification({
      candidate,
      eventType: 'candidate.interview_slot_warning_sent',
      offer: updatedOffer,
      requestContext,
      strapi,
      subject: 'Interview slot warning',
      type: 'warning',
    });
  }

  await releaseCandidateDeclinedSlotOfferSlots({
    offer: updatedOffer,
    outcome,
    requestContext,
    strapi,
  });
  await releaseCandidateOfferCapacityClaim({
    offer: updatedOffer,
    outcome,
    requestContext,
    strapi,
  });
  await updateRequestAfterCandidateSlotOutcome({
    offer: updatedOffer,
    requestContext,
    strapi,
  });
  void interviewRequestService(strapi)
    .reconcileReusableInterviewSlots(25, {
      ...requestContext,
      serviceName: requestContext.serviceName || 'candidate-slot-outcome',
    })
    .catch((error) => {
      strapi.log?.error?.('Reusable interview slot assignment failed after candidate slot outcome.', error);
    });
  await auditEvents(strapi).record({
    actorId: candidate.documentId,
    actorType: outcome === 'expired' ? 'system' : 'candidate',
    eventCategory: 'interview',
    eventType:
      outcome === 'expired'
        ? 'candidate.interview_slot_offer_expired'
        : 'candidate.interview_slot_offer_declined',
    ipAddress: requestContext.ipAddress,
    metadata: {
      declineNote: declineNote || null,
      declineReason: declineReason || null,
      newState: sanitizeCandidateInterviewSlotOffer(updatedOffer),
      previousState,
      requestId: requestContext.requestId,
      strikeDocumentId: strike?.documentId || null,
      warningState,
    },
    requestId: requestContext.requestId,
    serviceName: requestContext.serviceName,
    severity: priorWarning ? 'warning' : 'info',
    source: outcome === 'expired' ? 'core_api' : 'candidate_dashboard',
    subjectDisplayName: candidateMessageDisplayName(candidate),
    subjectId: offer.documentId,
    subjectType: 'interview_slot_offer',
    userAgent: requestContext.userAgent,
  });

  return {
    offer: updatedOffer,
    outcome,
    strike: strike
      ? {
          documentId: strike.documentId,
          strikeNumber: strike.strikeNumber,
        }
      : null,
    warningState,
  };
};

const getNextWaitingListPosition = async (strapi, classRecord, candidate?) => {
  const waitingListEnrollments = await documents(strapi, 'api::enrollment.enrollment').findMany({
    filters: {
      class: {
        documentId: classRecord.documentId,
      },
      enrollmentState: 'waiting_list',
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
      enrollmentState: 'waiting_list',
    },
    limit: 1000,
    populate: ['candidate'],
    sort: ['waitingListPosition:asc', 'createdAt:asc'],
  });

  const candidateIndex = waitingListEnrollments.findIndex(
    (enrollment) => enrollment.candidate?.documentId === candidate?.documentId
  );

  if (candidateIndex === -1) {
    return waitingListEnrollments.length > 0;
  }

  return waitingListEnrollments
    .slice(0, candidateIndex)
    .some((enrollment) => enrollment.candidate?.documentId !== candidate?.documentId);
};

const reservationPopulate = ['acceptedTermsPolicyDocument', 'candidate', 'class', 'enrollment'];

const findActiveReservationForEnrollment = async (strapi, enrollment) => {
  if (!enrollment?.documentId) {
    return undefined;
  }

  const reservations = await documents(strapi, 'api::reservation.reservation').findMany({
    filters: {
      enrollment: {
        documentId: enrollment.documentId,
      },
      reservationState: 'active',
    },
    limit: 1,
    populate: reservationPopulate,
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
    populate: reservationPopulate,
  });

  return reservations[0];
};

const findReservationByDocumentId = async (
  strapi: StrapiDocumentService,
  reservationDocumentId: string
) => {
  const reservations = await documents(strapi, 'api::reservation.reservation').findMany({
    filters: {
      documentId: reservationDocumentId,
    },
    limit: 1,
    populate: reservationPopulate,
  });

  return reservations[0];
};

const countCapacityHeldPlaces = async (strapi, classRecord) => {
  const enrollments = await documents(strapi, 'api::enrollment.enrollment').findMany({
    filters: {
      class: {
        documentId: classRecord.documentId,
      },
      enrollmentState: {
        $in: Array.from(capacityHoldingEnrollmentStatuses),
      },
    },
    limit: 1000,
    populate: ['class'],
  });

  return enrollments.filter((enrollment) => {
    if (normalizedEnrollmentState(enrollment) !== 'place_reserved') {
      return true;
    }

    return !isPastDate(enrollment.reservationExpiresAt);
  }).length;
};

const waitlistedCandidateCanReserveOpenPlace = async ({
  candidate,
  classRecord,
  enrollment,
  strapi,
}: {
  candidate?: DocumentRecord;
  classRecord?: DocumentRecord;
  enrollment?: DocumentRecord;
  strapi: StrapiDocumentService;
}) => {
  if (
    !candidate?.documentId ||
    !classRecord?.documentId ||
    !enrollment?.documentId ||
    normalizedEnrollmentState(enrollment) !== 'waiting_list' ||
    !classHasPaymentAccess(classRecord)
  ) {
    return false;
  }

  const capacity = Number(classRecord.capacity || 0);

  if (!Number.isFinite(capacity) || capacity <= 0) {
    return false;
  }

  const activeWaitingListOffer = await findActiveWaitingListOfferForClass(strapi, classRecord);

  if (activeWaitingListOffer?.documentId) {
    return false;
  }

  if (await hasWaitingListAhead(strapi, classRecord, candidate)) {
    return false;
  }

  const heldPlaces = await countCapacityHeldPlaces(strapi, classRecord);

  return heldPlaces < capacity;
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
      enrollmentState: {
        $in: Array.from(paidEnrollmentStatuses),
      },
    },
    limit: 1000,
    populate: ['class'],
  });

  return enrollments.length;
};

const findActiveClassReservationsForAllocation = async (
  strapi: StrapiDocumentService,
  classRecord: DocumentRecord
) => {
  const now = new Date().toISOString();

  return documents(strapi, 'api::reservation.reservation').findMany({
    filters: {
      class: {
        documentId: classRecord.documentId,
      },
      expiresAt: {
        $gt: now,
      },
      reservationState: 'active',
    },
    limit: 1000,
    populate: ['candidate'],
  });
};

const findPaidClassEnrollmentsForAllocation = async (
  strapi: StrapiDocumentService,
  classRecord: DocumentRecord
) =>
  documents(strapi, 'api::enrollment.enrollment').findMany({
    filters: {
      class: {
        documentId: classRecord.documentId,
      },
      enrollmentState: {
        $in: Array.from(paidEnrollmentStatuses),
      },
    },
    limit: 1000,
    populate: ['candidate'],
  });

const findWaitingListClassEnrollmentsForAllocation = async (
  strapi: StrapiDocumentService,
  classRecord: DocumentRecord
) =>
  (await documents(strapi, 'api::enrollment.enrollment').findMany({
      filters: {
        class: {
          documentId: classRecord.documentId,
        },
        enrollmentState: 'waiting_list',
      },
      limit: 1000,
      populate: ['candidate'],
      sort: ['waitingListPosition:asc', 'createdAt:asc'],
    })).filter(waitingListOfferEligibility);

const ensureClassAllocationSnapshot = async (
  strapi: StrapiDocumentService,
  classRecord: DocumentRecord
) => {
  if (!classRecord.documentId) {
    throw new ValidationError('Class document ID is required before reserving a place.');
  }

  try {
    if (await isClassAllocationReady(classRecord.documentId)) {
      return;
    }

    if (!(await tryAcquireClassAllocationSyncLock(classRecord.documentId))) {
      if (await waitForClassAllocationReady(classRecord.documentId)) {
        return;
      }

      throw new Error('Timed out waiting for class allocation Redis snapshot.');
    }

    const [activeReservations, paidEnrollments, waitingListEnrollments] = await Promise.all([
      findActiveClassReservationsForAllocation(strapi, classRecord),
      findPaidClassEnrollmentsForAllocation(strapi, classRecord),
      findWaitingListClassEnrollmentsForAllocation(strapi, classRecord),
    ]);

    await replaceClassAllocationSnapshot(classRecord.documentId, {
      holds: activeReservations
        .filter((reservation) => reservation.candidate?.documentId && reservation.expiresAt)
        .map((reservation) => {
          const metadata = objectValue(reservation.metadata);
          const allocationId =
            typeof metadata.allocationId === 'string'
              ? metadata.allocationId
              : reservation.documentId || randomUUID();

          return {
            allocationId,
            candidateDocumentId: reservation.candidate!.documentId!,
            expiresAt: reservation.expiresAt!,
            reservationDocumentId: reservation.documentId,
          };
        }),
      paidCandidateDocumentIds: paidEnrollments
        .map((enrollment) => enrollment.candidate?.documentId)
        .filter((documentId): documentId is string => Boolean(documentId)),
      waitlist: waitingListEnrollments
        .map((enrollment, index) => ({
          candidateDocumentId: enrollment.candidate?.documentId,
          position: enrollment.waitingListPosition || index + 1,
        }))
        .filter(
          (item): item is { candidateDocumentId: string; position: number } =>
            Boolean(item.candidateDocumentId) && Number.isFinite(item.position)
        ),
    });
  } catch (error) {
    const logger = (strapi as unknown as { log?: { error?: (message: string, error?: unknown) => void } }).log;
    logger?.error?.('Class allocation Redis snapshot failed.', error);
    throw new ApplicationError('Class allocation is temporarily unavailable. Please try again.');
  }
};

type LockableClassQuery = {
  first(): Promise<unknown>;
  forUpdate?: () => { first(): Promise<unknown> };
};

type LockableDatabaseConnection = {
  (tableName: string): {
    where(input: Record<string, unknown>): LockableClassQuery;
  };
  client?: {
    config?: {
      client?: string;
    };
  };
  raw?: (query: string, bindings?: unknown[]) => Promise<unknown>;
};

const databaseClientName = (connection?: LockableDatabaseConnection) =>
  connection?.client?.config?.client?.toLowerCase() || '';

const acquirePostgresClassAdvisoryLock = async (
  connection: LockableDatabaseConnection,
  classDocumentId: string
) => {
  const clientName = databaseClientName(connection);

  if (
    (!clientName.includes('pg') && !clientName.includes('postgres')) ||
    typeof connection.raw !== 'function'
  ) {
    return;
  }

  await connection.raw('select pg_advisory_xact_lock(hashtext(?))', [
    `hireflip:class-allocation:${classDocumentId}`,
  ]);
};

const lockClassForCapacityCheck = async (
  strapi: StrapiDocumentService,
  classRecord?: DocumentRecord,
  transactionConnection?: unknown
) => {
  const connection = (transactionConnection ||
    (strapi as unknown as { db?: { connection?: unknown } }).db?.connection) as
    | undefined
    | LockableDatabaseConnection;

  if (!connection || !classRecord?.documentId) {
    return;
  }

  await acquirePostgresClassAdvisoryLock(connection, classRecord.documentId);

  const query = connection('classes').where({ document_id: classRecord.documentId });

  if (typeof query.forUpdate === 'function' && !databaseClientName(connection).includes('sqlite')) {
    await query.forUpdate().first();
    return;
  }

  await query.first();
};

const withDatabaseTransaction = async <TResult>(
  strapi: StrapiDocumentService,
  callback: (context?: { trx?: unknown }) => Promise<TResult>
) => {
  const database = (strapi as unknown as {
    db?: {
      transaction?: <TCallbackResult>(
        callback: (context?: { trx?: unknown }) => Promise<TCallbackResult>
      ) => Promise<TCallbackResult>;
    };
  }).db;

  return database?.transaction ? database.transaction(callback) : callback();
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

  const metadata = objectValue(reservation.metadata);

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
    paymentExceptionReason:
      typeof metadata.paymentExceptionReason === 'string'
        ? metadata.paymentExceptionReason
        : undefined,
    reservationStartedAt: reservation.reservationStartedAt,
    status: reservationState(reservation),
    termsAcceptedAt: reservation.termsAcceptedAt,
    termsPolicyDocumentId: reservation.acceptedTermsPolicyDocument?.documentId,
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
    expiredAt: payment.expiredAt,
    failedAt: payment.failedAt,
    paidAt: payment.paidAt,
    paymentProvider: payment.paymentProvider,
    paymentType: payment.paymentType,
    providerCheckoutSessionId: payment.providerCheckoutSessionId,
    providerPaymentIntentId: payment.providerPaymentIntentId,
    status: paymentState(payment),
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
      paymentState: {
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

const findConfirmedPaymentForReservationOrEnrollment = async (
  strapi: StrapiDocumentService,
  reservation?: DocumentRecord
) => {
  if (!reservation?.documentId && !reservation?.enrollment?.documentId) {
    return undefined;
  }

  if (reservation?.documentId) {
    const reservationPayments = await documents(strapi, 'api::payment.payment').findMany({
      filters: {
        reservation: {
          documentId: reservation.documentId,
        },
        paymentState: {
          $in: ['paid', 'requires_review'],
        },
      },
      limit: 1,
      sort: ['paidAt:desc', 'createdAt:desc'],
    });

    if (reservationPayments[0]) {
      return reservationPayments[0];
    }
  }

  if (reservation?.enrollment?.documentId) {
    const enrollmentPayments = await documents(strapi, 'api::payment.payment').findMany({
      filters: {
        enrollment: {
          documentId: reservation.enrollment.documentId,
        },
        paymentState: {
          $in: ['paid', 'requires_review'],
        },
      },
      limit: 1,
      sort: ['paidAt:desc', 'createdAt:desc'],
    });

    return enrollmentPayments[0];
  }

  return undefined;
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
        successUrl: buildDashboardOrderProcessingUrl(reservation.documentId),
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

const requestPaymentServiceCheckoutSessionStatus = async (
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
    const payload = (await response.json().catch(() => null)) as PaymentServiceCheckoutLookupResponse | null;

    if (!response.ok || !payload?.data) {
      return undefined;
    }

    return validateProviderCheckoutConfirmation(payload.data);
  } finally {
    clearTimeout(timeout);
  }
};

const requestPaymentServiceExpireCheckoutSession = async (
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
      `${trimTrailingSlash(baseUrl)}/internal/checkout-sessions/${encodeURIComponent(checkoutSessionId)}/expire`,
      {
        headers: {
          'content-type': 'application/json',
          'x-hireflip-service-name': 'core-api',
          'x-hireflip-service-token': serviceToken,
        },
        method: 'POST',
        signal: controller.signal,
      }
    );
    const payload = (await response.json().catch(() => null)) as PaymentServiceCheckoutLookupResponse | null;

    if (!response.ok || !payload?.data) {
      return undefined;
    }

    return validateProviderCheckoutConfirmation(payload.data);
  } finally {
    clearTimeout(timeout);
  }
};

const recordPaymentException = async ({
  actor,
  candidate,
  confirmation,
  existingPayment,
  reason,
  requestContext,
  reservation,
  strapi,
}: {
  actor: PaymentConfirmationActor;
  candidate: DocumentRecord;
  confirmation: PaymentServiceCheckoutConfirmation;
  existingPayment?: DocumentRecord;
  reason: PaymentExceptionReason;
  requestContext: RequestContext;
  reservation: DocumentRecord;
  strapi: StrapiDocumentService;
}) => {
  const now = new Date().toISOString();
  const previousReservation = sanitizeReservation(reservation);
  const previousEnrollment = sanitizeEnrollment(reservation.enrollment);
  const paymentMetadata = {
    ...(objectValue(existingPayment?.metadata)),
    amountTotal: confirmation.amountTotal,
    checkoutUrl: confirmation.checkoutUrl,
    exceptionReason: reason,
    providerPaymentStatus: confirmation.paymentStatus,
    providerSessionStatus: confirmation.status,
    recordedAt: now,
    reservationDocumentId: reservation.documentId,
  };
  const paymentData = {
    amountPence: reservation.amountPence,
    candidate: {
      connect: [{ documentId: candidate.documentId }],
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
    paymentState: 'requires_review',
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
        paymentExceptionAt: now,
        paymentExceptionReason: reason,
        providerCheckoutSessionId: confirmation.checkoutSessionId,
        ...(confirmation.paymentIntentId ? { providerPaymentIntentId: confirmation.paymentIntentId } : {}),
      },
      paidAt: reservation.paidAt || now,
      reservationState: 'payment_exception',
    },
    populate: ['candidate', 'class', 'enrollment'],
  });
  const updatedEnrollment = reservation.enrollment?.documentId
    ? await documents(strapi, 'api::enrollment.enrollment').update({
        documentId: reservation.enrollment.documentId,
        data: {
          metadata: {
            ...(objectValue(reservation.enrollment.metadata)),
            activeCheckoutSessionId: null,
            activePaymentDocumentId: null,
            activeReservationDocumentId: null,
            paymentExceptionAt: now,
            paymentExceptionReason: reason,
            providerCheckoutSessionId: confirmation.checkoutSessionId,
            ...(confirmation.paymentIntentId ? { providerPaymentIntentId: confirmation.paymentIntentId } : {}),
          },
          paymentStatus: 'requires_review',
          reservationExpiresAt: null,
          enrollmentState: 'payment_exception',
          waitingListPosition: null,
        },
        populate: ['class'],
      })
    : null;

  await auditEvents(strapi).record({
    actorEmail: actor.actorEmail,
    actorId: actor.actorId,
    actorType: actor.actorType,
    eventCategory: 'payment',
    eventType:
      reason === 'class_capacity_conflict'
        ? 'candidate.payment_capacity_conflict'
        : 'candidate.payment_reservation_state_conflict',
    ipAddress: requestContext.ipAddress,
    metadata: {
      checkoutSessionId: confirmation.checkoutSessionId,
      class: sanitizeClass(reservation.class),
      payment: sanitizePayment(payment),
      reason,
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
    serviceName: requestContext.serviceName,
    severity: 'critical',
    source: actor.source,
    subjectDisplayName: candidate.email,
    subjectId: candidate.documentId,
    subjectType: 'candidate',
    userAgent: requestContext.userAgent,
  });

  return {
    classInterest: await buildCandidateClassInterestForCandidate(strapi, candidate),
    payment: sanitizePayment(payment),
    paymentException: {
      reason,
    },
    reservation: sanitizeReservation(updatedReservation),
  };
};

const confirmReservationPaymentWithProvider = async ({
  actor,
  candidate,
  confirmation,
  requestContext,
  reservation,
  strapi,
}: {
  actor: PaymentConfirmationActor;
  candidate: DocumentRecord;
  confirmation: PaymentServiceCheckoutConfirmation;
  requestContext: RequestContext;
  reservation: DocumentRecord;
  strapi: StrapiDocumentService;
}) => {
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
    metadataCandidateDocumentId !== candidate.documentId ||
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

  const result = await withDatabaseTransaction(strapi, async (transactionContext) => {
    await lockClassForCapacityCheck(strapi, reservation.class, transactionContext?.trx);

    const currentReservation =
      (await findReservationByDocumentId(strapi, reservation.documentId!)) || reservation;
    const existingPayment =
      (await findPaymentForCheckoutSession(strapi, confirmation.checkoutSessionId)) ||
      (await findCheckoutPaymentForReservation(strapi, currentReservation));

    if (
      reservationState(currentReservation) === 'paid' &&
      normalizedEnrollmentState(currentReservation.enrollment) === 'enrolled'
    ) {
      return {
        classInterest: await buildCandidateClassInterestForCandidate(strapi, candidate),
        payment: sanitizePayment(existingPayment),
        reservation: sanitizeReservation(currentReservation),
      };
    }

    if (reservationState(currentReservation) === 'payment_exception') {
      return {
        classInterest: await buildCandidateClassInterestForCandidate(strapi, candidate),
        payment: sanitizePayment(existingPayment),
        reservation: sanitizeReservation(currentReservation),
      };
    }

    if (reservationState(currentReservation) === 'cancelled' || reservationState(currentReservation) === 'released') {
      return recordPaymentException({
        actor,
        candidate,
        confirmation,
        existingPayment,
        reason:
          reservationState(currentReservation) === 'cancelled'
            ? 'reservation_cancelled'
            : 'reservation_released',
        requestContext,
        reservation: currentReservation,
        strapi,
      });
    }

    const paidPlaces = await countPaidClassPlaces(strapi, currentReservation.class);

    if (
      typeof currentReservation.class?.capacity === 'number' &&
      paidPlaces >= currentReservation.class.capacity
    ) {
      return recordPaymentException({
        actor,
        candidate,
        confirmation,
        existingPayment,
        reason: 'class_capacity_conflict',
        requestContext,
        reservation: currentReservation,
        strapi,
      });
    }

    if (candidate.documentId && currentReservation.class?.documentId) {
      await markClassPlaceAllocationPaid({
        candidateDocumentId: candidate.documentId,
        classDocumentId: currentReservation.class.documentId,
      });
    }

    const now = new Date().toISOString();
    const previousReservation = sanitizeReservation(currentReservation);
    const previousEnrollment = sanitizeEnrollment(currentReservation.enrollment);
    const paymentMetadata = {
      ...(objectValue(existingPayment?.metadata)),
      amountTotal: confirmation.amountTotal,
      checkoutUrl: confirmation.checkoutUrl,
      confirmedAt: now,
      providerPaymentStatus: confirmation.paymentStatus,
      providerSessionStatus: confirmation.status,
      reservationDocumentId: currentReservation.documentId,
    };
    const paymentData = {
      amountPence: currentReservation.amountPence,
      candidate: {
        connect: [{ documentId: candidate.documentId }],
      },
      createdByService: 'payment-service',
      currency: currentReservation.currency,
      enrollment: {
        connect: [{ documentId: currentReservation.enrollment?.documentId }],
      },
      metadata: paymentMetadata,
      paidAt: existingPayment?.paidAt || now,
      paymentProvider: 'stripe',
      paymentType: 'course_payment',
      providerCheckoutSessionId: confirmation.checkoutSessionId,
      ...(confirmation.customerId ? { providerCustomerId: confirmation.customerId } : {}),
      ...(confirmation.paymentIntentId ? { providerPaymentIntentId: confirmation.paymentIntentId } : {}),
      reservation: {
        connect: [{ documentId: currentReservation.documentId }],
      },
      slotReservationExpiresAt: currentReservation.expiresAt,
      paymentState: 'paid',
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
      documentId: currentReservation.documentId,
      data: {
        metadata: {
          ...(objectValue(currentReservation.metadata)),
          paymentConfirmedAt: now,
          providerCheckoutSessionId: confirmation.checkoutSessionId,
          ...(confirmation.paymentIntentId ? { providerPaymentIntentId: confirmation.paymentIntentId } : {}),
        },
        paidAt: currentReservation.paidAt || now,
        reservationState: 'paid',
      },
      populate: ['candidate', 'class', 'enrollment'],
    });
    const updatedEnrollment = currentReservation.enrollment?.documentId
      ? await documents(strapi, 'api::enrollment.enrollment').update({
          documentId: currentReservation.enrollment.documentId,
          data: {
            enrolledAt: currentReservation.enrollment.enrolledAt || now,
            metadata: {
              ...(objectValue(currentReservation.enrollment.metadata)),
              activeCheckoutSessionId: null,
              activePaymentDocumentId: null,
              activeReservationDocumentId: null,
              paidReservationDocumentId: currentReservation.documentId,
              paymentConfirmedAt: now,
              providerCheckoutSessionId: confirmation.checkoutSessionId,
              ...(confirmation.paymentIntentId ? { providerPaymentIntentId: confirmation.paymentIntentId } : {}),
            },
            paymentStatus: 'paid',
            reservationExpiresAt: null,
            enrollmentState: 'enrolled',
            waitingListPosition: null,
          },
          populate: ['class'],
        })
      : null;
    const updatedClass = await closeClassIfCapacityReached(strapi, currentReservation.class);

    await auditEvents(strapi).record({
      actorEmail: actor.actorEmail,
      actorId: actor.actorId,
      actorType: actor.actorType,
      eventCategory: 'payment',
      eventType: actor.eventType,
      ipAddress: requestContext.ipAddress,
      metadata: {
        checkoutSessionId: confirmation.checkoutSessionId,
        class: sanitizeClass(updatedClass || currentReservation.class),
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
      serviceName: requestContext.serviceName,
      source: actor.source,
      subjectDisplayName: candidate.email,
      subjectId: candidate.documentId,
      subjectType: 'candidate',
      userAgent: requestContext.userAgent,
    });

    return {
      classInterest: await buildCandidateClassInterestForCandidate(strapi, candidate),
      payment: sanitizePayment(payment),
      reservation: sanitizeReservation(updatedReservation),
    };
  });

  const resultReservation =
    result.reservation && typeof result.reservation === 'object'
      ? (result.reservation as { status?: string })
      : undefined;
  const resultPayment =
    result.payment && typeof result.payment === 'object'
      ? (result.payment as { status?: string })
      : undefined;

  if (candidate.documentId && reservation.class?.documentId) {
    if (resultReservation?.status === 'payment_exception') {
      await releaseClassPlaceAllocation({
        candidateDocumentId: candidate.documentId,
        classDocumentId: reservation.class.documentId,
      }).catch((error) => {
        const logger = (strapi as unknown as { log?: { error?: (message: string, error?: unknown) => void } }).log;
        logger?.error?.('Class allocation Redis exception release failed.', error);
      });

      await promoteNextWaitingListOffer({
        classRecord: reservation.class,
        excludeEnrollmentDocumentIds: [reservation.enrollment?.documentId].filter(
          (documentId): documentId is string => Boolean(documentId)
        ),
        requestContext,
        sourceTrigger: 'payment_exception_release',
        strapi,
      });
    }
  }

  return result;
};

const providerPaymentOutcomeFromEvent = (
  eventType: string,
  confirmation: PaymentServiceCheckoutConfirmation
): ProviderPaymentOutcome | undefined => {
  if (eventType === 'checkout.session.expired' || confirmation.status === 'expired') {
    return 'expired';
  }

  if (eventType === 'checkout.session.async_payment_failed') {
    return 'failed';
  }

  return undefined;
};

const recordProviderPaymentOutcome = async ({
  actor,
  candidate,
  confirmation,
  eventType,
  outcome,
  requestContext,
  reservation,
  strapi,
}: {
  actor: PaymentConfirmationActor;
  candidate: DocumentRecord;
  confirmation: PaymentServiceCheckoutConfirmation;
  eventType: string;
  outcome: ProviderPaymentOutcome;
  requestContext: RequestContext;
  reservation: DocumentRecord;
  strapi: StrapiDocumentService;
}) => {
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
    metadataCandidateDocumentId !== candidate.documentId ||
    metadataClassDocumentId !== reservation.class?.documentId ||
    metadataEnrollmentDocumentId !== reservation.enrollment?.documentId ||
    confirmation.clientReferenceId !== reservation.documentId
  ) {
    throw new ValidationError('Payment provider outcome does not match this reservation.');
  }

  const existingPayment =
    (await findPaymentForCheckoutSession(strapi, confirmation.checkoutSessionId)) ||
    (await findCheckoutPaymentForReservation(strapi, reservation));
  const now = new Date().toISOString();
  const previousReservation = sanitizeReservation(reservation);
  const previousEnrollment = sanitizeEnrollment(reservation.enrollment);
  const previousPayment = sanitizePayment(existingPayment);
  const paymentStatus = outcome === 'expired' ? 'expired' : 'failed';
  const paymentMetadata = {
    ...(objectValue(existingPayment?.metadata)),
    amountTotal: confirmation.amountTotal,
    checkoutUrl: confirmation.checkoutUrl,
    eventType,
    outcome,
    providerPaymentStatus: confirmation.paymentStatus,
    providerSessionStatus: confirmation.status,
    recordedAt: now,
    reservationDocumentId: reservation.documentId,
  };
  const paymentData = {
    amountPence: reservation.amountPence,
    candidate: {
      connect: [{ documentId: candidate.documentId }],
    },
    createdByService: 'payment-service',
    currency: reservation.currency,
    enrollment: {
      connect: [{ documentId: reservation.enrollment?.documentId }],
    },
    ...(outcome === 'expired' ? { expiredAt: existingPayment?.expiredAt || now } : {}),
    ...(outcome === 'failed' ? { failedAt: existingPayment?.failedAt || now } : {}),
    metadata: paymentMetadata,
    paymentProvider: 'stripe',
    paymentType: 'course_payment',
    providerCheckoutSessionId: confirmation.checkoutSessionId,
    ...(confirmation.customerId ? { providerCustomerId: confirmation.customerId } : {}),
    ...(confirmation.paymentIntentId ? { providerPaymentIntentId: confirmation.paymentIntentId } : {}),
    reservation: {
      connect: [{ documentId: reservation.documentId }],
    },
    slotReservationExpiresAt: reservation.expiresAt,
    paymentState: paymentStatus,
  };
  const payment = existingPayment?.documentId
    ? await documents(strapi, 'api::payment.payment').update({
        documentId: existingPayment.documentId,
        data: paymentData,
      })
    : await documents(strapi, 'api::payment.payment').create({
        data: paymentData,
      });
  const shouldReleaseReservation =
    outcome === 'expired' ||
    (outcome === 'failed' && reservationState(reservation) === 'active' && isPastDate(reservation.expiresAt));
  let updatedReservation = reservation;
  let updatedEnrollment = reservation.enrollment;

  if (shouldReleaseReservation && reservationState(reservation) === 'active') {
    const fallbackStatus = (await hasWaitingListAhead(strapi, reservation.class, candidate))
      ? 'waiting_list'
      : 'enrollment_open';
    const waitingListPosition =
      fallbackStatus === 'waiting_list'
        ? await getNextWaitingListPosition(strapi, reservation.class, candidate)
        : null;

    updatedReservation = await documents(strapi, 'api::reservation.reservation').update({
      documentId: reservation.documentId,
      data: {
        expiredAt: reservation.expiredAt || now,
        metadata: {
          ...(objectValue(reservation.metadata)),
          providerCheckoutSessionExpiredAt: outcome === 'expired' ? now : undefined,
          providerCheckoutSessionFailedAt: outcome === 'failed' ? now : undefined,
          providerCheckoutSessionId: confirmation.checkoutSessionId,
          providerPaymentStatus: confirmation.paymentStatus,
          providerSessionStatus: confirmation.status,
        },
        reservationState: 'expired',
      },
      populate: ['candidate', 'class', 'enrollment'],
    });

    updatedEnrollment = reservation.enrollment?.documentId
      ? await documents(strapi, 'api::enrollment.enrollment').update({
          documentId: reservation.enrollment.documentId,
          data: {
            metadata: {
              ...(objectValue(reservation.enrollment.metadata)),
              activeCheckoutSessionId: null,
              activePaymentDocumentId: null,
              activeReservationDocumentId: null,
              lastReservationExpiredAt: now,
              providerCheckoutSessionId: confirmation.checkoutSessionId,
            },
            paymentStatus: 'pending',
            reservationExpiresAt: null,
            enrollmentState: fallbackStatus,
            waitingListPosition,
          },
          populate: ['class'],
        })
      : reservation.enrollment;

    if (candidate.documentId && reservation.class?.documentId) {
      await releaseClassPlaceAllocation({
        candidateDocumentId: candidate.documentId,
        classDocumentId: reservation.class.documentId,
      }).catch((error) => {
        const logger = (strapi as unknown as { log?: { error?: (message: string, error?: unknown) => void } }).log;
        logger?.error?.('Class allocation Redis provider outcome release failed.', error);
      });
    }

    await promoteNextWaitingListOffer({
      classRecord: reservation.class,
      excludeEnrollmentDocumentIds: [updatedEnrollment?.documentId].filter(
        (documentId): documentId is string => Boolean(documentId)
      ),
      requestContext,
      sourceTrigger: 'payment_failure_after_expiry',
      strapi,
    });
  } else if (reservation.enrollment?.documentId) {
    updatedEnrollment = await documents(strapi, 'api::enrollment.enrollment').update({
      documentId: reservation.enrollment.documentId,
      data: {
        metadata: {
          ...(objectValue(reservation.enrollment.metadata)),
          activeCheckoutSessionId: null,
          activePaymentDocumentId: null,
          lastPaymentFailedAt: outcome === 'failed' ? now : undefined,
          providerCheckoutSessionId: confirmation.checkoutSessionId,
        },
        paymentStatus: reservation.enrollment.paymentStatus || 'pending',
      },
      populate: ['class'],
    });
  }

  await auditEvents(strapi).record({
    actorEmail: actor.actorEmail,
    actorId: actor.actorId,
    actorType: actor.actorType,
    eventCategory: 'payment',
    eventType: outcome === 'expired' || shouldReleaseReservation
      ? 'candidate.reservation_expired'
      : 'candidate.payment_failed',
    ipAddress: requestContext.ipAddress,
    metadata: {
      checkoutSessionId: confirmation.checkoutSessionId,
      class: sanitizeClass(reservation.class),
      eventType,
      outcome,
      payment: sanitizePayment(payment),
      providerPaymentStatus: confirmation.paymentStatus,
      providerSessionStatus: confirmation.status,
    },
    newState: {
      enrollment: sanitizeEnrollment(updatedEnrollment),
      payment: sanitizePayment(payment),
      reservation: sanitizeReservation(updatedReservation),
    },
    occurredAt: now,
    previousState: {
      enrollment: previousEnrollment,
      payment: previousPayment,
      reservation: previousReservation,
    },
    requestId: requestContext.requestId,
    serviceName: requestContext.serviceName,
    source: actor.source,
    subjectDisplayName: candidate.email,
    subjectId: candidate.documentId,
    subjectType: 'candidate',
    userAgent: requestContext.userAgent,
  });

  return {
    classInterest: await buildCandidateClassInterestForCandidate(strapi, candidate),
    payment: sanitizePayment(payment),
    reservation: sanitizeReservation(updatedReservation),
  };
};

const getPaymentActionForReservation = async ({
  candidate,
  classCheckoutPolicyDocument,
  requestContext,
  reservation,
  strapi,
}: {
  candidate: DocumentRecord;
  classCheckoutPolicyDocument?: DocumentRecord;
  requestContext: RequestContext;
  reservation?: DocumentRecord;
  strapi: StrapiDocumentService;
}): Promise<PaymentAction> => {
  if (!reservation) {
    return disabledPaymentAction('Reservation could not be found.');
  }

  if (reservationState(reservation) !== 'active') {
    return disabledPaymentAction('This reservation is no longer active.', 'reservation_inactive');
  }

  if (isPastDate(reservation.expiresAt)) {
    return disabledPaymentAction('This reservation has expired.', 'reservation_expired');
  }

  const activeClassCheckoutPolicyDocument =
    classCheckoutPolicyDocument ||
    (await findActivePolicyDocument(strapi, classCheckoutPolicyType));

  if (!activeClassCheckoutPolicyDocument?.version) {
    return disabledPaymentAction(
      'Checkout terms are not available yet. Please try again later.',
      'checkout_terms_unavailable'
    );
  }

  if (
    !reservation.termsAcceptedAt ||
    reservation.termsVersion !== activeClassCheckoutPolicyDocument.version
  ) {
    return disabledPaymentAction('Accept terms to unlock payment.', 'terms_not_accepted');
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
        termsPolicyDocumentId: reservation.acceptedTermsPolicyDocument?.documentId,
        termsVersion: reservation.termsVersion,
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
      paymentState: 'checkout_created',
    },
  });
  const updatedEnrollment =
    reservation.enrollment?.documentId
      ? await documents(strapi, 'api::enrollment.enrollment').update({
          documentId: reservation.enrollment.documentId,
          data: {
            metadata: {
              ...(objectValue(reservation.enrollment.metadata)),
              activeCheckoutSessionId: checkoutSession.checkoutSessionId,
              activePaymentDocumentId: payment.documentId,
            },
          },
        })
      : undefined;

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
      enrollment: sanitizeEnrollment(updatedEnrollment || reservation.enrollment),
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
    if (terminalEnrollmentStatuses.has(enrollmentState(enrollment))) {
      return false;
    }

    return enrollment.paymentStatus === 'paid' || paidEnrollmentStatuses.has(enrollmentState(enrollment));
  });

  if (activeEnrollment) {
    return 'enrolled';
  }

  const passedEnrollment = enrollments.find(
    (enrollment) =>
      enrollment.passStatus === 'passed' ||
      Boolean(enrollment.passedAt) ||
      (completedEnrollmentStatuses.has(enrollmentState(enrollment)) && enrollment.passStatus !== 'failed')
  );

  return passedEnrollment ? 'alumni' : 'unenrolled';
};

const findActiveEnrollment = (enrollments = []) =>
  enrollments.find((enrollment) => {
    if (terminalEnrollmentStatuses.has(enrollmentState(enrollment))) {
      return false;
    }

    return enrollment.paymentStatus === 'paid' || paidEnrollmentStatuses.has(enrollmentState(enrollment));
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
  const hasProviderCheckoutSession =
    typeof metadata.activeCheckoutSessionId === 'string' ||
    typeof metadata.activePaymentDocumentId === 'string';

  return {
    completionStatus: enrollment.completionStatus,
    documentId: enrollment.documentId,
    enrolledAt: enrollment.enrolledAt,
    hasProviderCheckoutSession,
    interestRegisteredAt: enrollment.interestRegisteredAt || enrollment.metadata?.registeredInterestAt,
    invitedToJoinAt: enrollment.invitedToJoinAt,
    passStatus: enrollment.passStatus,
    paymentStatus: enrollment.paymentStatus,
    status: enrollmentState(enrollment),
    reservationExpiresAt: enrollment.reservationExpiresAt,
    reservationDocumentId,
    waitingListPosition: enrollment.waitingListPosition,
  };
};

const classHasPaymentAccess = (classRecord) => classRecord?.state === 'open';
const classHasJoinOrWaitlistAccess = (classRecord) =>
  classRecord?.state === 'open' || classRecord?.state === 'full';

const deriveClassRelationshipState = (enrollment, classRecord?) => {
  if (enrollment) {
    const normalizedStatus = normalizedEnrollmentState(enrollment);
    const hasPaymentAccess = classHasPaymentAccess(enrollment.class || classRecord);
    const hasJoinOrWaitlistAccess = classHasJoinOrWaitlistAccess(enrollment.class || classRecord);

    if (normalizedStatus === 'interest_withdrawn') {
      return hasJoinOrWaitlistAccess ? 'enrollment_open' : 'not_registered';
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
      if (!hasJoinOrWaitlistAccess) {
        return 'interest_registered';
      }

      return isPastDate(enrollment.reservationExpiresAt) ? 'enrollment_open' : 'place_reserved';
    }

    if (normalizedStatus === 'enrollment_open') {
      return hasJoinOrWaitlistAccess ? 'enrollment_open' : 'interest_registered';
    }

    if (hasJoinOrWaitlistAccess) {
      return 'enrollment_open';
    }

    return 'interest_registered';
  }

  if (classHasJoinOrWaitlistAccess(classRecord)) {
    return 'enrollment_open';
  }

  return 'not_registered';
};

const buildClassTimeline = (classRecord, relationshipState) => {
  const refundDecisionTimelineMeta: Record<string, { label: string; state: 'complete' | 'current' }> = {
    refunded: {
      label: 'Refund completed',
      state: 'complete',
    },
    removed_full_refund: {
      label: 'Full refund approved',
      state: 'current',
    },
    removed_no_refund: {
      label: 'Refund not approved',
      state: 'current',
    },
    removed_partial_refund: {
      label: 'Partial refund approved',
      state: 'current',
    },
  };
  const refundDecisionMeta = refundDecisionTimelineMeta[relationshipState];

  if (refundDecisionMeta) {
    return [
      {
        key: 'interest',
        label: 'Interest Registered',
        state: 'complete',
      },
      {
        key: 'enrollment_open',
        label: 'Enrolled',
        state: 'complete',
      },
      {
        key: 'place_secured',
        label: 'Place secured',
        state: 'complete',
      },
      {
        key: 'refund_decision',
        label: refundDecisionMeta.label,
        state: refundDecisionMeta.state,
      },
    ];
  }

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

const sanitizeClassAnnouncement = (announcement: DocumentRecord) => ({
  body: announcement.body,
  documentId: announcement.documentId,
  expiresAt: announcement.expiresAt,
  priority: announcement.priority || 'normal',
  title: announcement.title,
  visibleFrom: announcement.visibleFrom,
});

const isVisibleClassAnnouncement = (announcement: DocumentRecord, now: number) => {
  if (announcement.announcementState !== 'published') {
    return false;
  }

  if (announcement.visibleFrom && Date.parse(announcement.visibleFrom) > now) {
    return false;
  }

  if (announcement.expiresAt && Date.parse(announcement.expiresAt) <= now) {
    return false;
  }

  return true;
};

const findVisibleClassAnnouncements = async (strapi: StrapiDocumentService, classDocumentId?: string) => {
  if (!classDocumentId) {
    return [];
  }

  const announcements = await documents(strapi, 'api::class-announcement.class-announcement').findMany({
    filters: {
      announcementState: 'published',
      class: {
        documentId: classDocumentId,
      },
    },
    limit: 50,
    sort: ['visibleFrom:desc', 'createdAt:desc'],
  });
  const now = Date.now();

  return announcements
    .filter((announcement) => isVisibleClassAnnouncement(announcement, now))
    .map(sanitizeClassAnnouncement);
};

const buildClassRelationship = async ({ candidate, classRecord, enrollment, registeredInterestCount = 0, strapi }) => {
  const derivedState = deriveClassRelationshipState(enrollment, classRecord);
  const activeWaitingListOffer =
    derivedState === 'waiting_list'
      ? await findActiveWaitingListOfferForEnrollment(strapi, enrollment)
      : undefined;
  const waitlistedCanReserveOpenPlace =
    derivedState === 'waiting_list' &&
    !activeWaitingListOffer &&
    await waitlistedCandidateCanReserveOpenPlace({
      candidate,
      classRecord,
      enrollment,
      strapi,
    });
  const state = waitlistedCanReserveOpenPlace ? 'enrollment_open' : derivedState;
  const announcements = await findVisibleClassAnnouncements(strapi, classRecord?.documentId);

  return {
    activeWaitingListOffer: sanitizeWaitingListOffer(activeWaitingListOffer),
    announcements,
    canClaimWaitingListOffer: Boolean(activeWaitingListOffer),
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

const buildClassInterestResponse = async ({ candidate, enrollments, interestCounts, matchingClasses, strapi }) => {
  const enrollmentMap = enrollmentsByClassDocumentId(enrollments);
  const classRelationships = await Promise.all(
    matchingClasses.map((classRecord) =>
      buildClassRelationship({
        candidate,
        classRecord,
        enrollment: enrollmentMap.get(classRecord.documentId),
        registeredInterestCount: interestCounts?.get(classRecord.documentId) || 0,
        strapi,
      })
    )
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
      status: candidateState(candidate),
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
    strapi,
  });
};

const courseAccessEnrollmentStates = new Set(['enrolled', 'in_class', 'interview_phase', 'completed']);
const courseStartedClassStates = new Set(['in_progress', 'completion_window']);
const activeCourseContentStates = new Set(['active']);
const courseCompletionMonths = 3;

const addCalendarMonths = (value: Date, months: number) => {
  const next = new Date(value.getTime());
  next.setMonth(next.getMonth() + months);
  return next;
};

const latestByTimestamp = (records: DocumentRecord[]) =>
  records.reduce<DocumentRecord | undefined>((latest, record) => {
    const latestTime = latest?.completedAt || latest?.submittedAt || latest?.startedAt || latest?.updatedAt || latest?.createdAt;
    const recordTime = record.completedAt || record.submittedAt || record.startedAt || record.updatedAt || record.createdAt;

    if (!latestTime) {
      return record;
    }

    if (!recordTime) {
      return latest;
    }

    return Date.parse(recordTime) >= Date.parse(latestTime) ? record : latest;
  }, undefined);

const courseProgressItemDocumentId = (progressRecord: DocumentRecord) => {
  if (progressRecord.progressType === 'section') {
    return progressRecord.courseSection?.documentId;
  }

  if (progressRecord.progressType === 'module') {
    return progressRecord.courseModule?.documentId;
  }

  if (progressRecord.progressType === 'material') {
    return progressRecord.courseMaterial?.documentId;
  }

  if (progressRecord.progressType === 'test') {
    return progressRecord.courseTest?.documentId;
  }

  if (progressRecord.progressType === 'question') {
    return progressRecord.courseQuestion?.documentId;
  }

  return undefined;
};

const latestCourseProgressByKey = (progressRecords: DocumentRecord[]) => {
  const map = new Map<string, DocumentRecord[]>();

  progressRecords.forEach((progressRecord) => {
    const documentId = courseProgressItemDocumentId(progressRecord);
    const key = documentId ? `${progressRecord.progressType}:${documentId}` : progressRecord.progressType === 'class' ? 'class' : undefined;

    if (!key) {
      return;
    }

    map.set(key, [...(map.get(key) || []), progressRecord]);
  });

  return new Map([...map.entries()].map(([key, records]) => [key, latestByTimestamp(records)!]));
};

const findCurrentCourseEnrollment = async (strapi: StrapiDocumentService, candidate: DocumentRecord) => {
  if (!candidate.documentId) {
    return undefined;
  }

  const enrollments = await documents(strapi, 'api::enrollment.enrollment').findMany({
    filters: {
      candidate: {
        documentId: candidate.documentId,
      },
      enrollmentState: {
        $in: [...courseAccessEnrollmentStates],
      },
    },
    limit: 20,
    populate: ['class'],
    sort: ['beganClassAt:desc', 'enrolledAt:desc', 'createdAt:desc'],
  });

  return enrollments.find((enrollment) =>
    enrollment.paymentStatus === 'paid' || ['in_class', 'interview_phase', 'completed'].includes(String(enrollment.enrollmentState || ''))
  );
};

const findClassWithCourse = async (strapi: StrapiDocumentService, classDocumentId?: string) => {
  if (!classDocumentId) {
    return undefined;
  }

  const classes = await documents(strapi, 'api::class.class').findMany({
    filters: {
      documentId: classDocumentId,
    },
    limit: 1,
    populate: ['classArea', 'course', 'workSector'],
  });

  return classes[0];
};

const activeContentRecord = (record: DocumentRecord, stateKey: string) =>
  activeCourseContentStates.has(String(record[stateKey] || 'active'));

const findCourseBundle = async (
  strapi: StrapiDocumentService,
  enrollment: DocumentRecord
) => {
  const classRecord = await findClassWithCourse(strapi, enrollment.class?.documentId);
  const course = classRecord?.course;

  if (!classRecord || !course?.documentId) {
    return undefined;
  }

  const sections = (await documents(strapi, 'api::course-section.course-section').findMany({
    filters: {
      course: {
        documentId: course.documentId,
      },
    },
    limit: 200,
    sort: ['sortOrder:asc', 'createdAt:asc'],
  })).filter((section) => activeContentRecord(section, 'sectionState'));
  const sectionDocumentIds = sections.map((section) => section.documentId).filter((documentId): documentId is string => Boolean(documentId));
  const modules = sectionDocumentIds.length
    ? (await documents(strapi, 'api::course-module.course-module').findMany({
        filters: {
          courseSection: {
            documentId: {
              $in: sectionDocumentIds,
            },
          },
        },
        limit: 1000,
        populate: ['courseSection'],
        sort: ['sortOrder:asc', 'createdAt:asc'],
      })).filter((module) => activeContentRecord(module, 'moduleState'))
    : [];
  const moduleDocumentIds = modules.map((module) => module.documentId).filter((documentId): documentId is string => Boolean(documentId));
  const [materials, courseTests, moduleTests, progressRecords, attempts, appeals, testResults] = await Promise.all([
    moduleDocumentIds.length
      ? documents(strapi, 'api::course-material.course-material').findMany({
          filters: {
            module: {
              documentId: {
                $in: moduleDocumentIds,
              },
            },
          },
          limit: 2000,
          populate: ['module'],
          sort: ['sortOrder:asc', 'createdAt:asc'],
        })
      : [],
    documents(strapi, 'api::course-test.course-test').findMany({
      filters: {
        course: {
          documentId: course.documentId,
        },
      },
      limit: 500,
      sort: ['createdAt:asc'],
    }),
    moduleDocumentIds.length
      ? documents(strapi, 'api::course-test.course-test').findMany({
          filters: {
            courseModule: {
              documentId: {
                $in: moduleDocumentIds,
              },
            },
          },
          limit: 1000,
          populate: ['courseModule'],
          sort: ['createdAt:asc'],
        })
      : [],
    documents(strapi, 'api::course-progress.course-progress').findMany({
      filters: {
        enrollment: {
          documentId: enrollment.documentId,
        },
      },
      limit: 5000,
      populate: ['courseSection', 'courseModule', 'courseMaterial', 'courseTest', 'courseQuestion', 'enrollment'],
      sort: ['createdAt:asc'],
    }),
    documents(strapi, 'api::course-test-attempt.course-test-attempt').findMany({
      filters: {
        enrollment: {
          documentId: enrollment.documentId,
        },
      },
      limit: 1000,
      populate: ['courseTest'],
      sort: ['attemptNumber:desc', 'createdAt:desc'],
    }),
    documents(strapi, 'api::assessment-appeal.assessment-appeal').findMany({
      filters: {
        enrollment: {
          documentId: enrollment.documentId,
        },
      },
      limit: 500,
      populate: ['courseTestAttempt'],
      sort: ['createdAt:desc'],
    }),
    documents(strapi, 'api::course-test-result.course-test-result').findMany({
      filters: {
        enrollment: {
          documentId: enrollment.documentId,
        },
      },
      limit: 1000,
      populate: ['courseTest', 'courseTestAttempt'],
      sort: ['decidedAt:desc', 'createdAt:desc'],
    }),
  ]);
  const tests = [...courseTests, ...moduleTests].filter((test) => activeContentRecord(test, 'testState'));
  const testDocumentIds = tests.map((test) => test.documentId).filter((documentId): documentId is string => Boolean(documentId));
  const questions = testDocumentIds.length
    ? (await documents(strapi, 'api::course-question.course-question').findMany({
        filters: {
          courseTest: {
            documentId: {
              $in: testDocumentIds,
            },
          },
        },
        limit: 2000,
        populate: ['courseTest'],
        sort: ['sortOrder:asc', 'createdAt:asc'],
      })).filter((question) => activeContentRecord(question, 'questionState'))
    : [];

  return {
    appeals,
    attempts,
    classRecord,
    course,
    enrollment,
    materials: materials.filter((material) => activeContentRecord(material, 'materialState')),
    modules,
    progressRecords,
    questions,
    sections,
    testResults,
    tests,
  };
};

const progressCompleted = (progress?: DocumentRecord) => progress?.progressState === 'completed';

const expectedCompletionPercentage = (material: DocumentRecord) => {
  if (typeof material.requiredCompletionPercentage === 'number') {
    return material.requiredCompletionPercentage;
  }

  return material.completionMode === 'watch_percentage' ? 90 : 100;
};

const sanitizeQuestionForCandidate = (question: DocumentRecord) => ({
  documentId: question.documentId,
  options: Array.isArray(question.options) ? question.options : [],
  prompt: question.prompt,
  questionType: question.questionType,
  sortOrder: question.sortOrder ?? 0,
});

const selectedIds = (value: unknown) =>
  Array.isArray(value)
    ? Array.from(new Set(value.filter((item): item is string => typeof item === 'string' && item.trim() !== '').map((item) => item.trim()))).sort()
    : [];

const correctIdsForQuestion = (question: DocumentRecord) => {
  const payload = objectValue(question.correctAnswerPayload);
  return selectedIds(payload.correctOptionIds);
};

const answerIsCorrect = (question: DocumentRecord, selectedOptionIds: string[]) => {
  const correctIds = correctIdsForQuestion(question);
  const selected = selectedIds(selectedOptionIds);

  return correctIds.length > 0 &&
    selected.length === correctIds.length &&
    selected.every((optionId, index) => optionId === correctIds[index]);
};

const questionPoints = (question: DocumentRecord) => {
  const rubric = objectValue(question.scoringRubric);
  const rawPoints = Number(rubric.points);

  return Number.isFinite(rawPoints) && rawPoints > 0 ? rawPoints : 1;
};

const latestAttemptForTest = (attempts: DocumentRecord[], testDocumentId?: string) =>
  latestByTimestamp(attempts.filter((attempt) => attempt.courseTest?.documentId === testDocumentId));

const latestTestResultForAttempt = (testResults: DocumentRecord[], attemptDocumentId?: string) =>
  latestByTimestamp(
    testResults.filter((result) => result.courseTestAttempt?.documentId === attemptDocumentId)
  );

const activeAppealForAttempt = (appeals: DocumentRecord[], attemptDocumentId?: string) =>
  appeals.find((appeal) =>
    appeal.courseTestAttempt?.documentId === attemptDocumentId &&
    ['submitted', 'under_review'].includes(String(appeal.appealState || ''))
  );

const latestAppealForAttempt = (appeals: DocumentRecord[], attemptDocumentId?: string) =>
  latestByTimestamp(
    appeals.filter((appeal) =>
      appeal.courseTestAttempt?.documentId === attemptDocumentId &&
      appeal.appealState !== 'withdrawn'
    )
  );

const hasAdminOverrideRetry = (attempt?: DocumentRecord) => {
  const metadata = objectValue(attempt?.metadata);

  return Boolean(
    attempt &&
    metadata.adminOverrideRetryGrantedAt &&
    metadata.assessmentAppealDocumentId &&
    attempt.retryEligibilityState === 'eligible_conditional_retry'
  );
};

const appealDecisionTimestamp = (attempt?: DocumentRecord, testResult?: DocumentRecord) =>
  testResult?.decidedAt || testResult?.createdAt || attempt?.submittedAt || attempt?.createdAt || null;

const appealSubmissionWindow = (attempt?: DocumentRecord, testResult?: DocumentRecord) =>
  workingDayWindow({
    days: assessmentAppealSubmissionWorkingDays,
    from: appealDecisionTimestamp(attempt, testResult),
  });

const buildCandidateCourseState = async (
  strapi: StrapiDocumentService,
  candidate: DocumentRecord,
  enrollment: DocumentRecord
) => {
  const bundle = await findCourseBundle(strapi, enrollment);

  if (!bundle) {
    return {
      candidate: {
        documentId: candidate.documentId,
        email: candidate.email,
      },
      course: null,
      state: 'not_configured',
    };
  }

  const progressMap = latestCourseProgressByKey(bundle.progressRecords);
  const testsByModule = new Map<string, DocumentRecord[]>();
  const materialsByModule = new Map<string, DocumentRecord[]>();
  const questionsByTest = new Map<string, DocumentRecord[]>();

  bundle.materials.forEach((material) => {
    const moduleDocumentId = material.module?.documentId;

    if (moduleDocumentId) {
      materialsByModule.set(moduleDocumentId, [...(materialsByModule.get(moduleDocumentId) || []), material]);
    }
  });
  bundle.tests.forEach((test) => {
    const moduleDocumentId = test.courseModule?.documentId;

    if (moduleDocumentId) {
      testsByModule.set(moduleDocumentId, [...(testsByModule.get(moduleDocumentId) || []), test]);
    }
  });
  bundle.questions.forEach((question) => {
    const testDocumentId = question.courseTest?.documentId;

    if (testDocumentId) {
      questionsByTest.set(testDocumentId, [...(questionsByTest.get(testDocumentId) || []), question]);
    }
  });

  const courseStarted = Boolean(enrollment.beganClassAt);
  let previousRequiredSectionPassed = true;
  const sections = bundle.sections.map((section) => {
    const sectionUnlocked = courseStarted && previousRequiredSectionPassed;
    const sectionModules = bundle.modules
      .filter((module) => module.courseSection?.documentId === section.documentId)
      .sort((first, second) => Number(first.sortOrder || 0) - Number(second.sortOrder || 0));
    let previousRequiredModulePassed = true;
    const modules = sectionModules.map((module) => {
      const moduleRequired = module.required !== false;
      const moduleUnlocked = sectionUnlocked && previousRequiredModulePassed;
      const moduleMaterials = (materialsByModule.get(module.documentId || '') || [])
        .sort((first, second) => Number(first.sortOrder || 0) - Number(second.sortOrder || 0));
      const moduleTests = testsByModule.get(module.documentId || '') || [];
      const materials = moduleMaterials.map((material) => {
        const progress = progressMap.get(`material:${material.documentId}`);
        const completionPercentage = Number(objectValue(progress?.metadata).completionPercentage || 0);
        const completed = progressCompleted(progress);
        const materialRequired = material.required !== false;

        return {
          body: moduleUnlocked ? material.body || null : null,
          completionMode: material.completionMode || 'read_to_end',
          completionPercentage: completed ? 100 : Math.min(100, Math.max(0, completionPercentage)),
          documentId: material.documentId,
          estimatedDurationMinutes: material.estimatedDurationMinutes ?? null,
          required: materialRequired,
          requiredCompletionPercentage: expectedCompletionPercentage(material),
          sortOrder: material.sortOrder ?? 0,
          state: completed ? 'completed' : progress ? 'in_progress' : 'not_started',
          title: material.title || 'Course material',
          type: material.materialType || 'text',
          url: moduleUnlocked ? material.url || null : null,
        };
      });
      const tests = moduleTests.map((test) => {
        const latestAttempt = latestAttemptForTest(bundle.attempts, test.documentId);
        const latestTestResult = latestTestResultForAttempt(bundle.testResults, latestAttempt?.documentId);
        const activeAppeal = activeAppealForAttempt(bundle.appeals, latestAttempt?.documentId);
        const latestAppeal = latestAppealForAttempt(bundle.appeals, latestAttempt?.documentId);
        const questions = questionsByTest.get(test.documentId || '') || [];
        const testPassed = latestAttempt?.passed === true || latestAttempt?.attemptState === 'passed';
        const testFailed = latestAttempt?.attemptState === 'failed';
        const retryEligibilityState = latestAttempt?.retryEligibilityState || 'not_assessed';
        const adminOverrideRetryAvailable = hasAdminOverrideRetry(latestAttempt);
        const submissionWindow = testFailed && retryEligibilityState === 'exhausted'
          ? appealSubmissionWindow(latestAttempt, latestTestResult)
          : null;

        return {
          activeAppeal: activeAppeal
            ? {
                documentId: activeAppeal.documentId,
                state: activeAppeal.appealState,
                submittedAt: activeAppeal.submittedAt,
              }
            : null,
          appealWindow: submissionWindow,
          attemptLimit: test.attemptLimit ?? 3,
          canAppeal: Boolean(testFailed && retryEligibilityState === 'exhausted' && !latestAppeal && submissionWindow?.isOpen),
          canSubmit:
            moduleUnlocked &&
            !testPassed &&
            !activeAppeal &&
            (retryEligibilityState !== 'exhausted' || adminOverrideRetryAvailable),
          description: test.description || null,
          documentId: test.documentId,
          latestAttempt: latestAttempt
            ? {
                attemptNumber: latestAttempt.attemptNumber,
                documentId: latestAttempt.documentId,
                passed: latestAttempt.passed === true,
                retryEligibilityState,
                score: latestAttempt.score ?? null,
                state: latestAttempt.attemptState,
                submittedAt: latestAttempt.submittedAt,
              }
            : null,
          latestAppeal: latestAppeal
            ? {
                decision: latestAppeal.decision || null,
                documentId: latestAppeal.documentId,
                reviewedAt: latestAppeal.reviewedAt || null,
                state: latestAppeal.appealState,
                submittedAt: latestAppeal.submittedAt,
              }
            : null,
          maxScore: test.maxScore ?? questions.reduce((total, question) => total + questionPoints(question), 0),
          passMark: test.passMark ?? 70,
          questions: moduleUnlocked ? questions.map(sanitizeQuestionForCandidate) : [],
          state: testPassed ? 'passed' : testFailed ? 'failed' : latestAttempt ? 'in_progress' : 'not_started',
          timeLimitMinutes: test.timeLimitMinutes ?? null,
          title: test.title || 'Course test',
        };
      });
      const requiredMaterialsComplete = materials
        .filter((material) => material.required)
        .every((material) => material.state === 'completed');
      const requiredTestsPassed = tests.every((test) => test.state === 'passed');
      const modulePassed =
        moduleUnlocked &&
        requiredMaterialsComplete &&
        requiredTestsPassed &&
        (materials.some((material) => material.required) || tests.length > 0);

      if (moduleRequired) {
        previousRequiredModulePassed = modulePassed;
      }

      return {
        description: module.description || null,
        documentId: module.documentId,
        materials,
        required: moduleRequired,
        sortOrder: module.sortOrder ?? 0,
        state: modulePassed ? 'passed' : moduleUnlocked ? 'in_progress' : 'locked',
        tests,
        title: module.title || 'Course module',
        unlocked: moduleUnlocked,
      };
    });
    const sectionRequired = section.required !== false;
    const requiredModules = modules.filter((module) => module.required);
    const sectionPassed =
      sectionUnlocked &&
      requiredModules.length > 0 &&
      requiredModules.every((module) => module.state === 'passed');

    if (sectionRequired) {
      previousRequiredSectionPassed = sectionPassed;
    }

    return {
      description: section.description || null,
      documentId: section.documentId,
      modules,
      required: sectionRequired,
      sortOrder: section.sortOrder ?? 0,
      state: sectionPassed ? 'passed' : sectionUnlocked ? 'in_progress' : 'locked',
      title: section.title || 'Course section',
      unlocked: sectionUnlocked,
    };
  });
  const requiredSections = sections.filter((section) => section.required);
  const coursePassed = requiredSections.length > 0 && requiredSections.every((section) => section.state === 'passed');
  const totalItems = sections.reduce(
    (total, section) =>
      total + section.modules.reduce(
        (moduleTotal, module) =>
          moduleTotal +
          module.materials.filter((material) => material.required).length +
          module.tests.length,
        0
      ),
    0
  );
  const completedItems = sections.reduce(
    (total, section) =>
      total + section.modules.reduce(
        (moduleTotal, module) =>
          moduleTotal +
          module.materials.filter((material) => material.required && material.state === 'completed').length +
          module.tests.filter((test) => test.state === 'passed').length,
        0
      ),
    0
  );

  return {
    candidate: {
      documentId: candidate.documentId,
      email: candidate.email,
    },
    class: sanitizeClass(bundle.classRecord),
    course: {
      description: bundle.course.description || null,
      documentId: bundle.course.documentId,
      name: bundle.course.name,
      sourceType: bundle.course.sourceType,
      state: bundle.course.courseState,
      version: bundle.course.version,
    },
    enrollment: {
      ...sanitizeEnrollment(enrollment),
      beganClassAt: enrollment.beganClassAt || null,
      courseCompletionDeadline: enrollment.courseCompletionDeadline || null,
      courseDeadlineExtensionSeconds: enrollment.courseDeadlineExtensionSeconds || 0,
    },
    progress: {
      completedItems,
      percentageComplete: totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0,
      totalItems,
    },
    rules: {
      appealAvailableAfterRetriesExhausted: true,
      conditionalRetryThresholdPercentBelowPassMark: 15,
      openRetriesAfterFirstFailure: 1,
      passRequiresRequiredMaterialsAndTests: true,
    },
    sections,
    state: coursePassed
      ? 'passed'
      : courseStarted
        ? 'in_progress'
        : courseStartedClassStates.has(String(bundle.classRecord.state || ''))
          ? 'ready_to_begin'
          : 'waiting_for_class_start',
  };
};

const recordCourseAudit = async ({
  candidate,
  eventType,
  metadata,
  newState,
  previousState,
  requestContext,
  strapi,
  subjectId,
  subjectType = 'course',
}: {
  candidate: DocumentRecord;
  eventType: string;
  metadata?: unknown;
  newState?: unknown;
  previousState?: unknown;
  requestContext: RequestContext;
  strapi: StrapiDocumentService;
  subjectId?: string;
  subjectType?: string;
}) => {
  await auditEvents(strapi).record({
    actorEmail: candidate.email,
    actorId: candidate.authIdentityId,
    actorType: 'candidate',
    eventCategory: 'course',
    eventType,
    ipAddress: requestContext.ipAddress,
    metadata,
    newState,
    occurredAt: new Date().toISOString(),
    previousState,
    requestId: requestContext.requestId,
    source: 'candidate_dashboard',
    subjectDisplayName: candidate.email,
    subjectId: subjectId || candidate.documentId,
    subjectType,
    userAgent: requestContext.userAgent,
  });
};

const createCourseProgress = async (
  strapi: StrapiDocumentService,
  input: {
    candidate: DocumentRecord;
    completedAt?: string;
    courseMaterial?: DocumentRecord;
    courseModule?: DocumentRecord;
    courseQuestion?: DocumentRecord;
    courseSection?: DocumentRecord;
    courseTest?: DocumentRecord;
    enrollment: DocumentRecord;
    metadata?: unknown;
    progressState: 'not_started' | 'in_progress' | 'completed' | 'failed' | 'skipped';
    progressType: 'class' | 'section' | 'module' | 'material' | 'test' | 'question';
    score?: number;
    startedAt?: string;
  }
) =>
  documents(strapi, 'api::course-progress.course-progress').create({
    data: {
      candidate: {
        connect: [{ documentId: input.candidate.documentId }],
      },
      completedAt: input.completedAt,
      courseMaterial: input.courseMaterial?.documentId
        ? { connect: [{ documentId: input.courseMaterial.documentId }] }
        : undefined,
      courseModule: input.courseModule?.documentId
        ? { connect: [{ documentId: input.courseModule.documentId }] }
        : undefined,
      courseQuestion: input.courseQuestion?.documentId
        ? { connect: [{ documentId: input.courseQuestion.documentId }] }
        : undefined,
      courseSection: input.courseSection?.documentId
        ? { connect: [{ documentId: input.courseSection.documentId }] }
        : undefined,
      courseTest: input.courseTest?.documentId
        ? { connect: [{ documentId: input.courseTest.documentId }] }
        : undefined,
      enrollment: {
        connect: [{ documentId: input.enrollment.documentId }],
      },
      metadata: input.metadata,
      progressState: input.progressState,
      progressType: input.progressType,
      score: input.score,
      startedAt: input.startedAt,
    },
  });

const updateCourseOutcomeIfPassed = async (
  strapi: StrapiDocumentService,
  candidate: DocumentRecord,
  enrollment: DocumentRecord,
  requestContext: RequestContext
) => {
  const courseState = await buildCandidateCourseState(strapi, candidate, enrollment);
  const now = new Date();
  const nowIso = now.toISOString();
  const [
    completedProgressRecords,
    existingModuleResults,
    existingSectionResults,
    existingCourseResults,
  ] = await Promise.all([
    documents(strapi, 'api::course-progress.course-progress').findMany({
      filters: {
        enrollment: {
          documentId: enrollment.documentId,
        },
        progressState: 'completed',
        progressType: {
          $in: ['class', 'section', 'module'],
        },
      },
      limit: 5000,
      populate: ['courseModule', 'courseSection', 'enrollment'],
      sort: ['createdAt:asc'],
    }),
    documents(strapi, 'api::course-module-result.course-module-result').findMany({
      filters: {
        enrollment: {
          documentId: enrollment.documentId,
        },
        resultState: 'passed',
      },
      limit: 1000,
      populate: ['courseModule', 'enrollment'],
      sort: ['createdAt:asc'],
    }),
    documents(strapi, 'api::course-section-result.course-section-result').findMany({
      filters: {
        enrollment: {
          documentId: enrollment.documentId,
        },
        resultState: 'passed',
      },
      limit: 1000,
      populate: ['courseSection', 'enrollment'],
      sort: ['createdAt:asc'],
    }),
    documents(strapi, 'api::course-result.course-result').findMany({
      filters: {
        enrollment: {
          documentId: enrollment.documentId,
        },
      },
      limit: 10,
      populate: ['course', 'enrollment'],
      sort: ['updatedAt:desc', 'createdAt:desc'],
    }),
  ]);
  const completedProgressKeys = new Set([...latestCourseProgressByKey(completedProgressRecords).keys()]);
  const passedModuleResultKeys = new Set(
    existingModuleResults
      .map((result) => result.courseModule?.documentId)
      .filter((documentId): documentId is string => Boolean(documentId))
  );
  const passedSectionResultKeys = new Set(
    existingSectionResults
      .map((result) => result.courseSection?.documentId)
      .filter((documentId): documentId is string => Boolean(documentId))
  );
  const existingCourseResult = latestByTimestamp(existingCourseResults);

  for (const section of courseState.sections || []) {
    for (const module of section.modules || []) {
      if (module.state === 'passed' && module.documentId) {
        if (!completedProgressKeys.has(`module:${module.documentId}`)) {
          await createCourseProgress(strapi, {
            candidate,
            completedAt: nowIso,
            courseModule: { documentId: module.documentId },
            enrollment,
            progressState: 'completed',
            progressType: 'module',
            startedAt: enrollment.beganClassAt || undefined,
          });
          completedProgressKeys.add(`module:${module.documentId}`);
        }

        if (!passedModuleResultKeys.has(module.documentId)) {
          await documents(strapi, 'api::course-module-result.course-module-result').create({
            data: {
              candidate: {
                connect: [{ documentId: candidate.documentId }],
              },
              courseModule: {
                connect: [{ documentId: module.documentId }],
              },
              decidedAt: nowIso,
              enrollment: {
                connect: [{ documentId: enrollment.documentId }],
              },
              metadata: {
                source: 'candidate_course_progress',
              },
              requiredItemsCompleted:
                module.materials.filter((material) => material.required && material.state === 'completed').length +
                module.tests.filter((test) => test.state === 'passed').length,
              requiredItemsTotal:
                module.materials.filter((material) => material.required).length +
                module.tests.length,
              resultState: 'passed',
            },
          });
          passedModuleResultKeys.add(module.documentId);
        }
      }
    }

    if (section.state === 'passed' && section.documentId) {
      if (!completedProgressKeys.has(`section:${section.documentId}`)) {
        await createCourseProgress(strapi, {
          candidate,
          completedAt: nowIso,
          courseSection: { documentId: section.documentId },
          enrollment,
          progressState: 'completed',
          progressType: 'section',
          startedAt: enrollment.beganClassAt || undefined,
        });
        completedProgressKeys.add(`section:${section.documentId}`);
      }

      if (!passedSectionResultKeys.has(section.documentId)) {
        await documents(strapi, 'api::course-section-result.course-section-result').create({
          data: {
            candidate: {
              connect: [{ documentId: candidate.documentId }],
            },
            courseSection: {
              connect: [{ documentId: section.documentId }],
            },
            decidedAt: nowIso,
            enrollment: {
              connect: [{ documentId: enrollment.documentId }],
            },
            metadata: {
              source: 'candidate_course_progress',
            },
            requiredModulesPassed: section.modules.filter((module) => module.required && module.state === 'passed').length,
            requiredModulesTotal: section.modules.filter((module) => module.required).length,
            resultState: 'passed',
          },
        });
        passedSectionResultKeys.add(section.documentId);
      }
    }
  }

  if (courseState.state !== 'passed' || !courseState.course?.documentId) {
    return courseState;
  }

  const alreadyPassed = enrollment.passStatus === 'passed' && enrollment.enrollmentState === 'interview_phase';

  if (alreadyPassed) {
    return courseState;
  }

  const interviewGuaranteeDeadline = addCalendarMonths(now, 3).toISOString();
  const updatedEnrollment = await documents(strapi, 'api::enrollment.enrollment').update({
    documentId: enrollment.documentId,
    data: {
      completedAt: enrollment.completedAt || nowIso,
      completionStatus: 'completed',
      enrollmentState: 'interview_phase',
      interviewGuaranteeDeadline,
      interviewGuaranteeWindowStartsAt: nowIso,
      passStatus: 'passed',
      passedAt: nowIso,
    },
    populate: ['class'],
  });

  const courseResultData = {
    completedAt: nowIso,
    completionDeadline: enrollment.courseCompletionDeadline,
    course: {
      connect: [{ documentId: courseState.course.documentId }],
    },
    metadata: {
      source: 'candidate_course_submission',
    },
    passedAt: nowIso,
    requiredSectionsPassed: courseState.sections.filter((section) => section.required && section.state === 'passed').length,
    requiredSectionsTotal: courseState.sections.filter((section) => section.required).length,
    resultState: 'passed',
    startedAt: enrollment.beganClassAt,
  };

  if (existingCourseResult?.documentId) {
    await documents(strapi, 'api::course-result.course-result').update({
      documentId: existingCourseResult.documentId,
      data: courseResultData,
    });
  } else {
    await documents(strapi, 'api::course-result.course-result').create({
      data: {
        ...courseResultData,
        candidate: {
          connect: [{ documentId: candidate.documentId }],
        },
        enrollment: {
          connect: [{ documentId: enrollment.documentId }],
        },
      },
    });
  }

  if (!completedProgressKeys.has('class')) {
    await createCourseProgress(strapi, {
      candidate,
      completedAt: nowIso,
      enrollment: updatedEnrollment,
      progressState: 'completed',
      progressType: 'class',
      startedAt: enrollment.beganClassAt || nowIso,
    });
  }

  await recordCourseAudit({
    candidate,
    eventType: 'candidate.course_passed',
    metadata: {
      course: courseState.course,
      progress: courseState.progress,
    },
    newState: sanitizeEnrollment(updatedEnrollment),
    previousState: sanitizeEnrollment(enrollment),
    requestContext,
    strapi,
    subjectId: enrollment.documentId,
    subjectType: 'enrollment',
  });
  await publishClassRelationshipEvent({
    candidate,
    classRecord: updatedEnrollment.class || enrollment.class,
    eventType: 'class_relationship_updated',
    strapi,
  });
  await interviewRequestService(strapi)
    .ensureForEnrollment(
      {
        enrollmentDocumentId: updatedEnrollment.documentId || enrollment.documentId,
        source: 'candidate_course_passed',
      },
      requestContext
    )
    .catch((error) => {
      strapi.log?.error?.('Interview request bootstrap failed after course pass.', error);
    });

  return buildCandidateCourseState(strapi, candidate, updatedEnrollment);
};

export default factories.createCoreService('api::candidate.candidate', ({ strapi }) => ({
  async reconcileCandidateInterviewSlotOffers(limit = 100, requestContext: RequestContext = {}) {
    const now = Date.now();
    const reminderIntervalMs = candidateInterviewSlotReminderIntervalMs();
    const reminderMax = candidateInterviewSlotReminderMax();
    const offers = await documents(strapi, 'api::interview-slot-offer.interview-slot-offer').findMany({
      filters: {
        candidateResponseDeadline: {
          $notNull: true,
        },
        offerState: {
          $in: Array.from(openInterviewSlotOfferStates),
        },
      },
      limit,
      populate: candidateInterviewSlotOfferPopulate,
      sort: ['candidateResponseDeadline:asc', 'createdAt:asc'],
    });
    const summary = {
      checked: offers.length,
      errors: [] as Array<{ error: string; offerDocumentId?: string }>,
      expired: 0,
      reminded: 0,
      skipped: 0,
    };

    for (const offer of offers) {
      try {
        const candidate = documentRecordValue(offer.candidate);
        const deadline = stringValue(offer.candidateResponseDeadline);
        const deadlineMs = deadline ? Date.parse(deadline) : Number.NaN;

        if (!candidate?.documentId || Number.isNaN(deadlineMs)) {
          summary.skipped += 1;
          continue;
        }

        if (deadlineMs <= now) {
          await applyCandidateSlotOfferMissedOrDeclined({
            candidate,
            offer,
            outcome: 'expired',
            outcomeSource: 'candidate_interview_slot_reconciliation',
            requestContext,
            strapi,
          });
          summary.expired += 1;
          continue;
        }

        const reminderCount = positiveNumber(offer.candidateResponseReminderCount);

        if (reminderCount >= reminderMax) {
          summary.skipped += 1;
          continue;
        }

        const lastReminderMs = offer.lastCandidateResponseReminderSentAt
          ? Date.parse(String(offer.lastCandidateResponseReminderSentAt))
          : Number.NaN;
        const firstNotificationMs = offer.candidateNotifiedAt
          ? Date.parse(String(offer.candidateNotifiedAt))
          : Number.NaN;
        const createdMs = offer.createdAt ? Date.parse(String(offer.createdAt)) : now;
        const referenceMs = Number.isNaN(lastReminderMs)
          ? Number.isNaN(firstNotificationMs)
            ? createdMs
            : firstNotificationMs
          : lastReminderMs;

        if (now - referenceMs < reminderIntervalMs) {
          summary.skipped += 1;
          continue;
        }

        await queueCandidateSlotOfferReminderNotification({
          candidate,
          offer,
          requestContext,
          strapi,
        });
        await documents(strapi, 'api::interview-slot-offer.interview-slot-offer').update({
          documentId: offer.documentId,
          data: {
            candidateResponseReminderCount: reminderCount + 1,
            lastCandidateResponseReminderSentAt: new Date(now).toISOString(),
            metadata: {
              ...objectValue(offer.metadata),
              lastReminderRequestId: requestContext.requestId,
              lastReminderSource: 'candidate_interview_slot_reconciliation',
            },
          },
        });
        summary.reminded += 1;
      } catch (error) {
        summary.errors.push({
          error: error instanceof Error ? error.message : String(error),
          offerDocumentId: offer.documentId,
        });
      }
    }

    return summary;
  },

  async getCurrentCandidateInterviewSlotOffers(
    auth: Auth0State | undefined,
    requestContext: RequestContext = {}
  ) {
    if (!auth || auth.type !== 'auth0' || !auth.subject) {
      throw new UnauthorizedError('Auth0 authentication is required.');
    }

    const existingCandidate = await findCandidateByAuthIdentity(strapi, auth.subject);

    if (!existingCandidate) {
      throw new ValidationError('Candidate account must be synced before interview offers can be checked.');
    }

    const offers = await findCandidateInterviewSlotOffers(strapi, existingCandidate);
    const resolvedOffers: DocumentRecord[] = [];

    for (const offer of offers) {
      if (
        openInterviewSlotOfferStates.has(String(offer.offerState || '')) &&
        isPastDate(stringValue(offer.candidateResponseDeadline))
      ) {
        const result = await applyCandidateSlotOfferMissedOrDeclined({
          candidate: existingCandidate,
          offer,
          outcome: 'expired',
          requestContext,
          strapi,
        });

        resolvedOffers.push(result.offer);
      } else {
        resolvedOffers.push(offer);
      }
    }

    const selectedInterviewDocumentIds = resolvedOffers
      .map((offer) => documentRecordValue(offer.selectedInterview)?.documentId)
      .filter((documentId): documentId is string => Boolean(documentId));
    const feedbackByInterviewId = await findCandidateFeedbackReportsByInterviewId(
      strapi,
      selectedInterviewDocumentIds
    );
    const sanitizedOffers = resolvedOffers
      .map((offer) => sanitizeCandidateInterviewSlotOffer(offer, feedbackByInterviewId))
      .filter((offer): offer is NonNullable<typeof offer> => Boolean(offer));
    const activeOffer =
      sanitizedOffers.find((offer) => openInterviewSlotOfferStates.has(String(offer.offerState || ''))) ||
      sanitizedOffers.find(
        (offer) =>
          offer.offerState === 'candidate_selected' &&
          Boolean(offer.selectedInterview) &&
          !['completed', 'candidate_no_show', 'candidate_declined', 'employer_cancelled', 'cancelled'].includes(
            String(offer.selectedInterview?.state || '')
          )
      ) ||
      null;

    return {
      activeOffer,
      candidate: {
        documentId: existingCandidate.documentId,
        email: existingCandidate.email,
        firstName: existingCandidate.firstName,
      },
      generatedAt: new Date().toISOString(),
      offers: sanitizedOffers,
      rules: {
        candidateResponseSlaWorkingDays: 2,
        declineAllNoteRequired: true,
        firstDeclineOrExpiryWarningOnly: true,
        remoteOptionRequiresCandidatePreference: true,
      },
    };
  },

  async acceptCurrentCandidateInterviewSlotOffer(
    auth: Auth0State | undefined,
    offerDocumentId: string,
    input: unknown = {},
    requestContext: RequestContext = {}
  ) {
    if (!auth || auth.type !== 'auth0' || !auth.subject) {
      throw new UnauthorizedError('Auth0 authentication is required.');
    }

    const existingCandidate = await findCandidateByAuthIdentity(strapi, auth.subject);

    if (!existingCandidate) {
      throw new ValidationError('Candidate account must be synced before interview offers can be accepted.');
    }

    const payload = validateCandidateInterviewSlotAccept(input ?? {});
    const offer = await findCandidateInterviewSlotOffer(strapi, existingCandidate, offerDocumentId);

    if (!offer) {
      throw new ValidationError('Interview slot offer could not be found.');
    }

    if (!openInterviewSlotOfferStates.has(String(offer.offerState || ''))) {
      throw new ValidationError('This interview slot offer is no longer open for selection.');
    }

    if (isPastDate(stringValue(offer.candidateResponseDeadline))) {
      await applyCandidateSlotOfferMissedOrDeclined({
        candidate: existingCandidate,
        offer,
        outcome: 'expired',
        requestContext,
        strapi,
      });
      throw new ValidationError('This interview slot offer has expired.');
    }

    const selectedSlot = sortSlotsByStartTime(offer.slots).find(
      (slot) => slot.documentId === payload.slotDocumentId
    );

    if (!selectedSlot?.documentId) {
      throw new ValidationError('Selected interview slot could not be found.');
    }

    if (!['offered', 'available'].includes(String(selectedSlot.slotState || ''))) {
      throw new ValidationError('Selected interview slot is no longer available.');
    }

    const now = new Date().toISOString();
    const selectedSlotEmployer =
      documentRecordValue(selectedSlot.employer) ||
      documentRecordValue(offer.employer);
    const employerContact =
      documentRecordValue(selectedSlot.employerContact) ||
      documentRecordValue(offer.employerContact);
    const interview = await documents(strapi, 'api::interview.interview').create({
      data: {
        candidate: relationConnect(existingCandidate),
        countsTowardGuarantee: false,
        employer: relationConnect(selectedSlotEmployer),
        employerContact: relationConnect(employerContact),
        enrollment: relationConnect(offer.enrollment),
        interviewSlot: relationConnect(selectedSlot),
        interviewState: 'awaiting_employer_details',
        metadata: {
          candidateInterviewFormatPreference: payload.formatPreference,
          candidateSelectedAt: now,
          interviewSlotOfferDocumentId: offer.documentId,
          requestId: requestContext.requestId,
          source: 'candidate_dashboard',
        },
        scheduledEndTime: selectedSlot.endTime || null,
        scheduledStartTime: selectedSlot.startTime || null,
      },
    });

    await documents(strapi, 'api::interview-slot.interview-slot').update({
      documentId: selectedSlot.documentId,
      data: {
        metadata: {
          ...(objectValue(selectedSlot.metadata)),
          candidateAcceptedAt: now,
          candidateDocumentId: existingCandidate.documentId,
          requestId: requestContext.requestId,
        },
        slotState: 'booked',
      },
    });
    await Promise.all(
      sortSlotsByStartTime(offer.slots)
        .filter((slot) => slot.documentId && slot.documentId !== selectedSlot.documentId)
        .map((slot) => {
          const reusableThreshold = addWorkingDays(new Date(), 4);
          const startTime = slot.startTime ? new Date(String(slot.startTime)) : undefined;
          const reusable = Boolean(startTime && startTime >= reusableThreshold);

          return documents(strapi, 'api::interview-slot.interview-slot').update({
            documentId: slot.documentId,
            data: {
              metadata: {
                ...(objectValue(slot.metadata)),
                releasedBecauseCandidateSelectedSlotDocumentId: selectedSlot.documentId,
                candidateOutcomeAt: now,
                requestId: requestContext.requestId,
              },
              ...reusableSlotRelationData(slot, offer),
              slotState: reusable ? 'available' : 'expired',
            },
          });
        })
    );
    const updatedOffer = await documents(strapi, 'api::interview-slot-offer.interview-slot-offer').update({
      documentId: offer.documentId,
      data: {
        candidateInterviewFormatPreference: payload.formatPreference,
        candidateRespondedAt: now,
        metadata: {
          ...(objectValue(offer.metadata)),
          candidateAcceptedAt: now,
          candidateInterviewFormatPreference: payload.formatPreference,
          requestId: requestContext.requestId,
          selectedSlotDocumentId: selectedSlot.documentId,
        },
        offerState: 'candidate_selected',
        selectedInterview: relationConnect(interview),
        selectedSlot: relationConnect(selectedSlot),
      },
      populate: candidateInterviewSlotOfferPopulate,
    });

    const interviewRequest = documentRecordValue(offer.interviewRequest);

    if (interviewRequest?.documentId) {
      await documents(strapi, 'api::interview-request.interview-request').update({
        documentId: interviewRequest.documentId,
        data: {
          candidateVisibleState: 'confirmed',
          lastCapacityCheckAt: now,
          requestState: 'candidate_selected',
        },
      });
    }
    void interviewRequestService(strapi)
      .reconcileReusableInterviewSlots(25, {
        ...requestContext,
        serviceName: requestContext.serviceName || 'candidate-slot-acceptance',
      })
      .catch((error) => {
        strapi.log?.error?.('Reusable interview slot assignment failed after candidate slot acceptance.', error);
      });

    await auditEvents(strapi).record({
      actorId: existingCandidate.documentId,
      actorType: 'candidate',
      eventCategory: 'interview',
      eventType: 'candidate.interview_slot_offer_accepted',
      ipAddress: requestContext.ipAddress,
      metadata: {
        formatPreference: payload.formatPreference,
        interviewDocumentId: interview.documentId,
        interviewSlotOfferDocumentId: offer.documentId,
        requestId: requestContext.requestId,
        selectedSlotDocumentId: selectedSlot.documentId,
      },
      requestId: requestContext.requestId,
      serviceName: requestContext.serviceName,
      severity: 'info',
      source: 'candidate_dashboard',
      subjectDisplayName: candidateMessageDisplayName(existingCandidate),
      subjectId: offer.documentId,
      subjectType: 'interview_slot_offer',
      userAgent: requestContext.userAgent,
    });
    await queueEmployerInterviewSetupNotification({
      candidate: existingCandidate,
      employerContact,
      interview,
      offer: updatedOffer,
      requestContext,
      strapi,
    });

    return {
      accepted: true,
      interview: sanitizeCandidateInterviewRecord(interview),
      offer: sanitizeCandidateInterviewSlotOffer(updatedOffer),
    };
  },

  async declineCurrentCandidateInterviewSlotOffer(
    auth: Auth0State | undefined,
    offerDocumentId: string,
    input: unknown = {},
    requestContext: RequestContext = {}
  ) {
    if (!auth || auth.type !== 'auth0' || !auth.subject) {
      throw new UnauthorizedError('Auth0 authentication is required.');
    }

    const existingCandidate = await findCandidateByAuthIdentity(strapi, auth.subject);

    if (!existingCandidate) {
      throw new ValidationError('Candidate account must be synced before interview offers can be declined.');
    }

    const payload = validateCandidateInterviewSlotDecline(input ?? {});
    const offer = await findCandidateInterviewSlotOffer(strapi, existingCandidate, offerDocumentId);

    if (!offer) {
      throw new ValidationError('Interview slot offer could not be found.');
    }

    if (!openInterviewSlotOfferStates.has(String(offer.offerState || ''))) {
      throw new ValidationError('This interview slot offer is no longer open for decline.');
    }

    const result = await applyCandidateSlotOfferMissedOrDeclined({
      candidate: existingCandidate,
      declineNote: payload.declineNote,
      declineReason: payload.declineReason,
      offer,
      outcome: isPastDate(stringValue(offer.candidateResponseDeadline)) ? 'expired' : 'candidate_declined',
      requestContext,
      strapi,
    });

    return {
      declined: result.outcome === 'candidate_declined',
      expired: result.outcome === 'expired',
      offer: sanitizeCandidateInterviewSlotOffer(result.offer),
      strike: result.strike,
      warningState: result.warningState,
    };
  },

  async getCurrentCandidateCourse(auth: Auth0State | undefined) {
    if (!auth || auth.type !== 'auth0' || !auth.subject) {
      throw new UnauthorizedError('Auth0 authentication is required.');
    }

    const existingCandidate = await findCandidateByAuthIdentity(strapi, auth.subject);

    if (!existingCandidate) {
      throw new ValidationError('Candidate account must be synced before course access can be checked.');
    }

    const enrollment = await findCurrentCourseEnrollment(strapi, existingCandidate);

    if (!enrollment) {
      return {
        candidate: {
          documentId: existingCandidate.documentId,
          email: existingCandidate.email,
        },
        course: null,
        state: 'no_active_course',
      };
    }

    return buildCandidateCourseState(strapi, existingCandidate, enrollment);
  },

  async beginCurrentCandidateCourse(
    auth: Auth0State | undefined,
    requestContext: RequestContext = {}
  ) {
    if (!auth || auth.type !== 'auth0' || !auth.subject) {
      throw new UnauthorizedError('Auth0 authentication is required.');
    }

    const existingCandidate = await findCandidateByAuthIdentity(strapi, auth.subject);

    if (!existingCandidate) {
      throw new ValidationError('Candidate account must be synced before course access can begin.');
    }

    const enrollment = await findCurrentCourseEnrollment(strapi, existingCandidate);

    if (!enrollment) {
      throw new ValidationError('No paid class enrollment is available for course access.');
    }

    const classRecord = await findClassWithCourse(strapi, enrollment.class?.documentId);

    if (!classRecord?.course?.documentId) {
      throw new ValidationError('This class does not have course content attached yet.');
    }

    if (!courseStartedClassStates.has(String(classRecord.state || '')) && enrollment.enrollmentState !== 'in_class') {
      throw new ValidationError('This class has not started yet.');
    }

    if (enrollment.beganClassAt) {
      return buildCandidateCourseState(strapi, existingCandidate, enrollment);
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const deadline = addCalendarMonths(now, courseCompletionMonths).toISOString();
    const updatedEnrollment = await documents(strapi, 'api::enrollment.enrollment').update({
      documentId: enrollment.documentId,
      data: {
        beganClassAt: nowIso,
        completionStatus: 'in_progress',
        courseCompletionDeadline: deadline,
        enrollmentState: 'in_class',
      },
      populate: ['class'],
    });

    await documents(strapi, 'api::course-result.course-result').create({
      data: {
        candidate: {
          connect: [{ documentId: existingCandidate.documentId }],
        },
        completionDeadline: deadline,
        course: {
          connect: [{ documentId: classRecord.course.documentId }],
        },
        enrollment: {
          connect: [{ documentId: updatedEnrollment.documentId }],
        },
        metadata: {
          classDocumentId: classRecord.documentId,
          source: 'candidate_begin_class',
        },
        resultState: 'in_progress',
        startedAt: nowIso,
      },
    });
    await createCourseProgress(strapi, {
      candidate: existingCandidate,
      enrollment: updatedEnrollment,
      progressState: 'in_progress',
      progressType: 'class',
      startedAt: nowIso,
    });
    await recordCourseAudit({
      candidate: existingCandidate,
      eventType: 'candidate.course_started',
      metadata: {
        class: sanitizeClass(classRecord),
        course: {
          documentId: classRecord.course.documentId,
          name: classRecord.course.name,
          version: classRecord.course.version,
        },
        deadline,
      },
      newState: sanitizeEnrollment(updatedEnrollment),
      previousState: sanitizeEnrollment(enrollment),
      requestContext,
      strapi,
      subjectId: updatedEnrollment.documentId,
      subjectType: 'enrollment',
    });
    await publishClassRelationshipEvent({
      candidate: existingCandidate,
      classRecord,
      eventType: 'class_relationship_updated',
      strapi,
    });

    return buildCandidateCourseState(strapi, existingCandidate, updatedEnrollment);
  },

  async recordCurrentCandidateCourseMaterialProgress(
    auth: Auth0State | undefined,
    materialDocumentId: string,
    input: unknown = {},
    requestContext: RequestContext = {}
  ) {
    if (!auth || auth.type !== 'auth0' || !auth.subject) {
      throw new UnauthorizedError('Auth0 authentication is required.');
    }

    const existingCandidate = await findCandidateByAuthIdentity(strapi, auth.subject);

    if (!existingCandidate) {
      throw new ValidationError('Candidate account must be synced before course progress can be recorded.');
    }

    const enrollment = await findCurrentCourseEnrollment(strapi, existingCandidate);

    if (!enrollment?.beganClassAt) {
      throw new ValidationError('Begin the class before recording course progress.');
    }

    const payload = validateMaterialProgress(input ?? {});
    const courseState = await buildCandidateCourseState(strapi, existingCandidate, enrollment);
    const materialState = courseState.sections
      ?.flatMap((section) => section.modules)
      .flatMap((module) => module.materials.map((material) => ({ material, module })))
      .find((item) => item.material.documentId === materialDocumentId);

    if (!materialState) {
      throw new ValidationError('Course material was not found for this enrollment.');
    }

    if (!materialState.module.unlocked) {
      throw new ValidationError('This module is not unlocked yet.');
    }

    if (materialState.material.state === 'completed') {
      return courseState;
    }

    const bundle = await findCourseBundle(strapi, enrollment);
    const material = bundle?.materials.find((record) => record.documentId === materialDocumentId);

    if (!material) {
      throw new ValidationError('Course material was not found for this enrollment.');
    }

    const completionPercentage = Math.max(0, Math.min(100, payload.completionPercentage ?? (payload.reachedEnd ? 100 : 0)));
    const threshold = expectedCompletionPercentage(material);
    const completed =
      material.completionMode === 'read_to_end'
        ? payload.reachedEnd === true || completionPercentage >= threshold
        : material.completionMode === 'watch_percentage'
          ? completionPercentage >= threshold
          : material.completionMode === 'not_required'
            ? true
            : completionPercentage >= threshold;
    const now = new Date().toISOString();

    await createCourseProgress(strapi, {
      candidate: existingCandidate,
      completedAt: completed ? now : undefined,
      courseMaterial: material,
      enrollment,
      metadata: {
        completionMode: material.completionMode,
        completionPercentage,
        eventType: payload.eventType,
        reachedEnd: payload.reachedEnd === true,
        requiredCompletionPercentage: threshold,
        watchedSeconds: payload.watchedSeconds,
      },
      progressState: completed ? 'completed' : 'in_progress',
      progressType: 'material',
      startedAt: now,
    });
    await recordCourseAudit({
      candidate: existingCandidate,
      eventType: completed ? 'candidate.course_material_completed' : 'candidate.course_material_progressed',
      metadata: {
        completionPercentage,
        materialDocumentId,
        threshold,
      },
      requestContext,
      strapi,
      subjectId: materialDocumentId,
      subjectType: 'course_material',
    });

    return updateCourseOutcomeIfPassed(strapi, existingCandidate, enrollment, requestContext);
  },

  async submitCurrentCandidateCourseTest(
    auth: Auth0State | undefined,
    testDocumentId: string,
    input: unknown = {},
    requestContext: RequestContext = {}
  ) {
    if (!auth || auth.type !== 'auth0' || !auth.subject) {
      throw new UnauthorizedError('Auth0 authentication is required.');
    }

    const existingCandidate = await findCandidateByAuthIdentity(strapi, auth.subject);

    if (!existingCandidate) {
      throw new ValidationError('Candidate account must be synced before submitting a course test.');
    }

    const enrollment = await findCurrentCourseEnrollment(strapi, existingCandidate);

    if (!enrollment?.beganClassAt) {
      throw new ValidationError('Begin the class before submitting course tests.');
    }

    const payload = validateSubmitCourseTest(input ?? {});
    const courseState = await buildCandidateCourseState(strapi, existingCandidate, enrollment);
    const testState = courseState.sections
      ?.flatMap((section) => section.modules)
      .flatMap((module) => module.tests.map((test) => ({ module, test })))
      .find((item) => item.test.documentId === testDocumentId);

    if (!testState) {
      throw new ValidationError('Course test was not found for this enrollment.');
    }

    if (!testState.module.unlocked) {
      throw new ValidationError('This module is not unlocked yet.');
    }

    if (!testState.test.canSubmit) {
      throw new ValidationError('This test is not available for submission.');
    }

    const bundle = await findCourseBundle(strapi, enrollment);
    const test = bundle?.tests.find((record) => record.documentId === testDocumentId);
    const questions = (bundle?.questions || []).filter((question) => question.courseTest?.documentId === testDocumentId);

    if (!test || questions.length === 0) {
      throw new ValidationError('Course test questions are not configured.');
    }

    const previousAttempts = (bundle?.attempts || [])
      .filter((attempt) => attempt.courseTest?.documentId === testDocumentId)
      .sort((first, second) => Number(first.attemptNumber || 0) - Number(second.attemptNumber || 0));
    const latestAttempt = previousAttempts[previousAttempts.length - 1];
    const attemptLimit = Number(test.attemptLimit || 3);
    const adminOverrideRetryAvailable = hasAdminOverrideRetry(latestAttempt);

    if (latestAttempt?.passed === true || latestAttempt?.attemptState === 'passed') {
      throw new ValidationError('This test has already been passed.');
    }

    if (
      (previousAttempts.length >= attemptLimit || latestAttempt?.retryEligibilityState === 'exhausted') &&
      !adminOverrideRetryAvailable
    ) {
      throw new ValidationError('No retries are available for this test.');
    }

    if (
      previousAttempts.length >= 2 &&
      latestAttempt?.retryEligibilityState !== 'eligible_conditional_retry' &&
      !adminOverrideRetryAvailable
    ) {
      throw new ValidationError('The conditional retry is not available for this test.');
    }

    const answersByQuestion = new Map(payload.answers.map((answer) => [answer.questionDocumentId, answer.selectedOptionIds]));
    const missingQuestion = questions.find((question) => !answersByQuestion.has(question.documentId || ''));

    if (missingQuestion) {
      throw new ValidationError('Every test question must be answered before submission.');
    }

    const score = questions.reduce((total, question) => {
      const selectedOptionIds = answersByQuestion.get(question.documentId || '') || [];
      return total + (answerIsCorrect(question, selectedOptionIds) ? questionPoints(question) : 0);
    }, 0);
    const maxScore = Number(test.maxScore || questions.reduce((total, question) => total + questionPoints(question), 0));
    const passMark = Number(test.passMark || 70);
    const scorePercent = maxScore > 0 ? (score / maxScore) * 100 : 0;
    const passed = scorePercent >= passMark;
    const attemptNumber = previousAttempts.length + 1;
    const retryEligibilityState = passed
      ? 'not_eligible'
      : adminOverrideRetryAvailable
        ? 'exhausted'
        : attemptNumber === 1 && attemptLimit >= 2
        ? 'eligible_open_retry'
        : attemptNumber === 2 && attemptLimit >= 3 && scorePercent >= passMark - 15
          ? 'eligible_conditional_retry'
          : 'exhausted';
    const now = new Date().toISOString();
    const attempt = await documents(strapi, 'api::course-test-attempt.course-test-attempt').create({
      data: {
        attemptNumber,
        attemptState: passed ? 'passed' : 'failed',
        candidate: {
          connect: [{ documentId: existingCandidate.documentId }],
        },
        courseTest: {
          connect: [{ documentId: test.documentId }],
        },
        enrollment: {
          connect: [{ documentId: enrollment.documentId }],
        },
        maxScore,
        metadata: {
          ...(adminOverrideRetryAvailable
            ? {
                adminOverrideRetrySourceAttemptDocumentId: latestAttempt?.documentId,
                assessmentAppealDocumentId: objectValue(latestAttempt?.metadata).assessmentAppealDocumentId,
              }
            : {}),
          scorePercent,
        },
        passed,
        passMarkSnapshot: passMark,
        retryEligibilityState,
        retryType:
          adminOverrideRetryAvailable
            ? 'admin_override'
            : attemptNumber === 1
            ? 'first_attempt'
            : attemptNumber === 2
              ? 'open_retry'
              : 'conditional_retry',
        score,
        startedAt: now,
        submittedAt: now,
      },
      populate: ['courseTest'],
    });

    await Promise.all(questions.map((question) =>
      documents(strapi, 'api::course-answer-submission.course-answer-submission').create({
        data: {
          answerPayload: {
            selectedOptionIds: answersByQuestion.get(question.documentId || '') || [],
          },
          candidate: {
            connect: [{ documentId: existingCandidate.documentId }],
          },
          courseQuestion: {
            connect: [{ documentId: question.documentId }],
          },
          courseTestAttempt: {
            connect: [{ documentId: attempt.documentId }],
          },
          feedback: answerIsCorrect(question, answersByQuestion.get(question.documentId || '') || [])
            ? 'Correct'
            : 'Incorrect',
          flagState: 'none',
          score: answerIsCorrect(question, answersByQuestion.get(question.documentId || '') || [])
            ? questionPoints(question)
            : 0,
          submittedAt: now,
        },
      })
    ));
    await documents(strapi, 'api::course-test-result.course-test-result').create({
      data: {
        attemptNumber,
        candidate: {
          connect: [{ documentId: existingCandidate.documentId }],
        },
        courseTest: {
          connect: [{ documentId: test.documentId }],
        },
        courseTestAttempt: {
          connect: [{ documentId: attempt.documentId }],
        },
        decidedAt: now,
        enrollment: {
          connect: [{ documentId: enrollment.documentId }],
        },
        maxScore,
        metadata: {
          scorePercent,
        },
        passed,
        passMarkSnapshot: passMark,
        resultState: passed ? 'passed' : 'failed',
        retryEligibilityState,
        score,
      },
    });
    await createCourseProgress(strapi, {
      candidate: existingCandidate,
      completedAt: now,
      courseTest: test,
      enrollment,
      metadata: {
        attemptDocumentId: attempt.documentId,
        attemptNumber,
        maxScore,
        passMark,
        retryEligibilityState,
        scorePercent,
      },
      progressState: passed ? 'completed' : 'failed',
      progressType: 'test',
      score,
      startedAt: now,
    });
    await recordCourseAudit({
      candidate: existingCandidate,
      eventType: passed ? 'candidate.course_test_passed' : 'candidate.course_test_failed',
      metadata: {
        attemptNumber,
        maxScore,
        passMark,
        retryEligibilityState,
        score,
        scorePercent,
        testDocumentId,
      },
      newState: {
        attemptDocumentId: attempt.documentId,
        passed,
        retryEligibilityState,
        score,
      },
      requestContext,
      strapi,
      subjectId: testDocumentId,
      subjectType: 'course_test',
    });

    return updateCourseOutcomeIfPassed(strapi, existingCandidate, enrollment, requestContext);
  },

  async createCurrentCandidateCourseAppeal(
    auth: Auth0State | undefined,
    testDocumentId: string,
    input: unknown = {},
    requestContext: RequestContext = {}
  ) {
    if (!auth || auth.type !== 'auth0' || !auth.subject) {
      throw new UnauthorizedError('Auth0 authentication is required.');
    }

    const existingCandidate = await findCandidateByAuthIdentity(strapi, auth.subject);

    if (!existingCandidate) {
      throw new ValidationError('Candidate account must be synced before creating a course appeal.');
    }

    const enrollment = await findCurrentCourseEnrollment(strapi, existingCandidate);

    if (!enrollment?.beganClassAt) {
      throw new ValidationError('Begin the class before creating a course appeal.');
    }

    const payload = validateCourseAppeal(input ?? {});
    const bundle = await findCourseBundle(strapi, enrollment);
    const latestAttempt = latestAttemptForTest(bundle?.attempts || [], testDocumentId);
    const latestTestResult = latestTestResultForAttempt(bundle?.testResults || [], latestAttempt?.documentId);

    if (!latestAttempt || latestAttempt.attemptState !== 'failed' || latestAttempt.retryEligibilityState !== 'exhausted') {
      throw new ValidationError('An appeal can only be submitted after retries are exhausted for a failed test.');
    }

    const submissionWindow = appealSubmissionWindow(latestAttempt, latestTestResult);

    if (!submissionWindow.isOpen) {
      throw new ValidationError('The 5-working-day appeal window for this failed assessment has closed.');
    }

    const existingAppeal = latestAppealForAttempt(bundle?.appeals || [], latestAttempt.documentId);

    if (existingAppeal) {
      throw new ValidationError('This failed attempt already has an appeal.');
    }

    const now = new Date().toISOString();
    const appeal = await documents(strapi, 'api::assessment-appeal.assessment-appeal').create({
      data: {
        appealState: 'submitted',
        candidate: {
          connect: [{ documentId: existingCandidate.documentId }],
        },
        courseTestAttempt: {
          connect: [{ documentId: latestAttempt.documentId }],
        },
        enrollment: {
          connect: [{ documentId: enrollment.documentId }],
        },
        metadata: {
          appealSubmissionDueAt: submissionWindow.dueAt,
          failedDecisionAt: submissionWindow.startedAt,
          workingDaysToSubmit: assessmentAppealSubmissionWorkingDays,
          testDocumentId,
        },
        reason: payload.reason,
        submittedAt: now,
      },
    });

    await documents(strapi, 'api::course-test-attempt.course-test-attempt').update({
      documentId: latestAttempt.documentId,
      data: {
        attemptState: 'appealed',
      },
    });
    await recordCourseAudit({
      candidate: existingCandidate,
      eventType: 'candidate.course_assessment_appeal_submitted',
      metadata: {
        appealDocumentId: appeal.documentId,
        attemptDocumentId: latestAttempt.documentId,
        testDocumentId,
      },
      newState: {
        appealDocumentId: appeal.documentId,
        appealState: appeal.appealState,
      },
      requestContext,
      strapi,
      subjectId: appeal.documentId,
      subjectType: 'assessment_appeal',
    });

    return buildCandidateCourseState(strapi, existingCandidate, enrollment);
  },

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
          candidateState: 'account_created',
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

  async flagCurrentCandidateInterviewFeedbackReport(
    auth: Auth0State | undefined,
    interviewDocumentId: string,
    input: unknown,
    requestContext: RequestContext = {}
  ) {
    if (!auth || auth.type !== 'auth0' || !auth.subject) {
      throw new UnauthorizedError('Auth0 authentication is required.');
    }

    const existingCandidate = await findCandidateByAuthIdentity(strapi, auth.subject);

    if (!existingCandidate?.documentId) {
      throw new ValidationError('Candidate account must be synced before feedback reports can be flagged.');
    }

    const payload = validateFeedbackReportConcern(input ?? {});
    const feedback = await findCandidateFeedbackReportForInterview({
      candidate: existingCandidate,
      interviewDocumentId,
      strapi,
    });

    if (!feedback?.documentId) {
      throw new ValidationError('Feedback report could not be found.');
    }

    const existingSupportCase = documentRecordValue(feedback.candidateReportConcernSupportCase);
    const alreadyOpen = String(feedback.candidateReportConcernState || 'none') === 'open';

    if (alreadyOpen && existingSupportCase?.documentId) {
      const supportCase = await supportCaseService(strapi).getCaseForCandidate({
        candidateDocumentId: existingCandidate.documentId,
        supportCaseDocumentId: existingSupportCase.documentId,
      });

      return {
        feedbackReport: sanitizeCandidateFeedbackReport(feedback),
        flagged: false,
        supportCase,
      };
    }

    const now = new Date().toISOString();
    const concernCaseResult = await supportCaseService(strapi).ensureFeedbackReportConcernCase({
      candidate: existingCandidate,
      feedbackDocumentId: feedback.documentId,
      flaggedAt: now,
      interviewDocumentId,
      reason: payload.reason,
    });
    const supportCase = concernCaseResult.supportCase;

    await supportCaseService(strapi).addMessage({
      body: payload.reason,
      candidate: existingCandidate,
      direction: 'inbound',
      messageType: 'candidate_message',
      metadata: {
        feedbackDocumentId: feedback.documentId,
        interviewDocumentId,
        kind: 'ai_feedback_report_concern',
      },
      sender: {
        displayName: candidateMessageDisplayName(existingCandidate),
        email: existingCandidate.email,
        id: existingCandidate.documentId,
        type: 'candidate',
      },
      subject: 'Candidate concern about AI feedback report',
      supportCase,
      visibility: 'public',
    });

    const updatedFeedback = await documents(strapi, 'api::interview-feedback.interview-feedback').update({
      documentId: feedback.documentId,
      data: {
        candidateReportConcernFlaggedAt: now,
        candidateReportConcernReason: payload.reason,
        candidateReportConcernResolution: null,
        candidateReportConcernResolvedAt: null,
        candidateReportConcernResolvedByStaffEmail: null,
        candidateReportConcernReviewedAt: null,
        candidateReportConcernState: 'open',
        candidateReportConcernSupportCase: relationConnect(supportCase),
        metadata: {
          ...objectValue(feedback.metadata),
          lastCandidateReportConcernRequestId: requestContext.requestId,
        },
      },
      populate: ['candidateReportConcernSupportCase', 'interview'],
    });

    await auditEvents(strapi).record({
      actorEmail: existingCandidate.email,
      actorId: auth.subject,
      actorType: 'candidate',
      eventCategory: 'interview',
      eventType: 'candidate.interview_feedback_report_flagged',
      ipAddress: requestContext.ipAddress,
      metadata: {
        feedbackDocumentId: feedback.documentId,
        interviewDocumentId,
        supportCaseCreated: concernCaseResult.created,
        supportCaseDocumentId: supportCase.documentId,
      },
      occurredAt: now,
      requestId: requestContext.requestId,
      source: 'candidate_dashboard',
      subjectDisplayName: candidateMessageDisplayName(existingCandidate),
      subjectId: feedback.documentId,
      subjectType: 'interview_feedback',
      userAgent: requestContext.userAgent,
    });

    await Promise.all([
      publishAdminRealtimeEvent(
        {
          channels: ['support'],
          resourceKey: supportCase.documentId,
          resourceType: 'support_case',
          type: 'support_cases_changed',
        },
        strapi.log
      ),
      publishAdminRealtimeEvent(
        {
          channels: ['operations'],
          resourceKey: supportCase.documentId,
          resourceType: 'support_case',
          type: 'admin_tasks_changed',
        },
        strapi.log
      ),
    ]);

    const candidateSupportCase = supportCase.documentId
      ? await supportCaseService(strapi).getCaseForCandidate({
          candidateDocumentId: existingCandidate.documentId,
          supportCaseDocumentId: supportCase.documentId,
        })
      : null;

    return {
      feedbackReport: sanitizeCandidateFeedbackReport(updatedFeedback),
      flagged: true,
      supportCase: candidateSupportCase,
    };
  },

  async getCurrentCandidateSupportCases(auth: Auth0State | undefined) {
    if (!auth || auth.type !== 'auth0' || !auth.subject) {
      throw new UnauthorizedError('Auth0 authentication is required.');
    }

    const existingCandidate = await findCandidateByAuthIdentity(strapi, auth.subject);

    if (!existingCandidate?.documentId) {
      throw new ValidationError('Candidate account must be synced before support cases can be viewed.');
    }

    const cases = await supportCaseService(strapi).casesForCandidate(existingCandidate.documentId);

    return {
      cases,
      counts: {
        total: cases.length,
      },
      generatedAt: new Date().toISOString(),
    };
  },

  async getCurrentCandidateSupportCase(
    auth: Auth0State | undefined,
    supportCaseDocumentId: string
  ) {
    if (!auth || auth.type !== 'auth0' || !auth.subject) {
      throw new UnauthorizedError('Auth0 authentication is required.');
    }

    const existingCandidate = await findCandidateByAuthIdentity(strapi, auth.subject);

    if (!existingCandidate?.documentId) {
      throw new ValidationError('Candidate account must be synced before support cases can be viewed.');
    }

    const supportCase = await supportCaseService(strapi).getCaseForCandidate({
      candidateDocumentId: existingCandidate.documentId,
      supportCaseDocumentId,
    });

    if (!supportCase) {
      throw new ValidationError('Support case could not be found.');
    }

    return {
      generatedAt: new Date().toISOString(),
      supportCase,
    };
  },

  async replyToCurrentCandidateSupportCase(
    auth: Auth0State | undefined,
    supportCaseDocumentId: string,
    input: unknown,
    requestContext: RequestContext = {}
  ) {
    if (!auth || auth.type !== 'auth0' || !auth.subject) {
      throw new UnauthorizedError('Auth0 authentication is required.');
    }

    const existingCandidate = await findCandidateByAuthIdentity(strapi, auth.subject);

    if (!existingCandidate?.documentId) {
      throw new ValidationError('Candidate account must be synced before support cases can be replied to.');
    }

    const payload = validateSupportCaseReply(input ?? {});
    const existingCase = await findSupportCaseRecordForCandidate({
      candidateDocumentId: existingCandidate.documentId,
      strapi,
      supportCaseDocumentId,
    });

    if (!existingCase) {
      throw new ValidationError('Support case could not be found.');
    }

    const now = new Date().toISOString();
    const message = await supportCaseService(strapi).addMessage({
      body: payload.body,
      candidate: existingCandidate,
      direction: 'inbound',
      messageType: 'candidate_message',
      sender: {
        displayName: candidateMessageDisplayName(existingCandidate),
        email: existingCandidate.email,
        id: existingCandidate.documentId,
        type: 'candidate',
      },
      supportCase: {
        documentId: supportCaseDocumentId,
      },
      visibility: 'public',
    });
    await supportCaseService(strapi).updateCaseState({
      caseState: 'awaiting_staff',
      metadata: {
        lastCandidateReplyAt: now,
      },
      supportCase: {
        documentId: supportCaseDocumentId,
      },
    });
    const ownerNotificationResult = await queueAssignedOwnerSupportNotification({
      candidate: existingCandidate,
      requestContext,
      strapi,
      supportCase: existingCase,
    });
    await auditEvents(strapi).record({
      actorEmail: existingCandidate.email,
      actorId: auth.subject,
      actorType: 'candidate',
      eventCategory: 'support',
      eventType: 'candidate.support_case_replied',
      ipAddress: requestContext.ipAddress,
      metadata: {
        assignedOwnerNotificationQueued: ownerNotificationResult.emailQueued,
        ownerStaffUserId: existingCase.ownerStaffUserId,
        messageDocumentId: message.documentId,
        supportCaseDocumentId,
      },
      occurredAt: now,
      requestId: requestContext.requestId,
      source: 'candidate_dashboard',
      subjectDisplayName: (existingCase as DocumentRecord).title || existingCandidate.email,
      subjectId: supportCaseDocumentId,
      subjectType: 'support_case',
      userAgent: requestContext.userAgent,
    });
    await publishAdminRealtimeEvent(
      {
        channels: ['support'],
        resourceKey: supportCaseDocumentId,
        resourceType: 'support_case',
        type: 'support_cases_changed',
      },
      strapi.log
    );

    const supportCase = await supportCaseService(strapi).getCaseForCandidate({
      candidateDocumentId: existingCandidate.documentId,
      supportCaseDocumentId,
    });

    return {
      replied: true,
      supportCase,
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
    const existingDateOfBirth =
      typeof existingCandidate.dateOfBirth === 'string' ? existingCandidate.dateOfBirth : undefined;
    const nextDateOfBirth = existingDateOfBirth || payload.dateOfBirth;

    if (!nextDateOfBirth) {
      throw new ValidationError('Date of birth is required to complete candidate onboarding.');
    }

    if (
      existingDateOfBirth &&
      payload.dateOfBirth &&
      payload.dateOfBirth !== existingDateOfBirth
    ) {
      throw new ValidationError('Date of birth cannot be updated after onboarding.');
    }

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
    const nextGenderSelfDescription =
      payload.gender === 'self_describe' ? (payload.genderSelfDescription ?? null) : null;

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
      dateOfBirth: nextDateOfBirth,
      firstName: payload.firstName,
      gender: payload.gender,
      genderSelfDescription: nextGenderSelfDescription,
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
      dateOfBirth: existingCandidate.dateOfBirth,
      firstName: existingCandidate.firstName,
      gender: existingCandidate.gender,
      genderSelfDescription: existingCandidate.genderSelfDescription,
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
        data: await buildClassInterestResponse({
          candidate: existingCandidate,
          enrollments: existingEnrollments,
          interestCounts,
          matchingClasses,
          strapi,
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
      candidateState: candidateState(existingCandidate) === 'account_created'
        ? 'interest_registered'
        : candidateState(existingCandidate),
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
            enrollmentState: 'interest_registered',
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
            enrollmentState: 'interest_registered',
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
    const response = await buildClassInterestResponse({
      candidate: updatedCandidate,
      enrollments: nextEnrollments,
      interestCounts,
      matchingClasses,
      strapi,
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
        status: candidateState(existingCandidate),
      },
      requestId: requestContext.requestId,
      source: 'candidate_dashboard',
      subjectDisplayName: updatedCandidate.email,
      subjectId: updatedCandidate.documentId,
      subjectType: 'candidate',
      userAgent: requestContext.userAgent,
    });
    await publishClassRelationshipEvent({
      candidate: updatedCandidate,
      classRecord: targetClass,
      strapi,
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
          previousStatus: enrollmentState(existingEnrollment),
        },
        paymentStatus: 'not_required',
        enrollmentState: 'interest_withdrawn',
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
    await publishClassRelationshipEvent({
      candidate: existingCandidate,
      classRecord: targetClass,
      strapi,
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

    if (!classHasJoinOrWaitlistAccess(targetClass)) {
      throw new ValidationError('Enrollment is not open for this class yet.');
    }

    await ensureClassAllocationSnapshot(strapi, targetClass);

    let redisCleanup:
      | {
          classDocumentId: string;
          removeWaitlist: boolean;
        }
      | undefined;

    try {
      const allocationResult = await withDatabaseTransaction(strapi, async (transactionContext) => {
      await lockClassForCapacityCheck(strapi, targetClass, transactionContext?.trx);

      const lockedTargetClass = await findClassByDocumentId(strapi, payload.classDocumentId);

      if (!lockedTargetClass) {
        throw new ValidationError('Class could not be found.');
      }

      if (!classHasJoinOrWaitlistAccess(lockedTargetClass)) {
        throw new ValidationError('Enrollment is not open for this class yet.');
      }

      const nowDate = new Date();
      const now = nowDate.toISOString();
      let existingEnrollment = await findCandidateEnrollmentForClass(
        strapi,
        existingCandidate,
        lockedTargetClass
      );
      let existingReservation = await findActiveReservationForEnrollment(strapi, existingEnrollment);

      if (existingReservation && isPastDate(existingReservation.expiresAt)) {
        const fallbackStatus = (await hasWaitingListAhead(strapi, lockedTargetClass, existingCandidate))
          ? 'waiting_list'
          : 'enrollment_open';
        const waitingListPosition =
          fallbackStatus === 'waiting_list'
            ? await getNextWaitingListPosition(strapi, lockedTargetClass, existingCandidate)
            : null;

        existingReservation = await documents(strapi, 'api::reservation.reservation').update({
          documentId: existingReservation.documentId,
          data: {
            expiredAt: now,
            reservationState: 'expired',
          },
          populate: ['candidate', 'class', 'enrollment'],
        });

        if (
          existingEnrollment?.documentId &&
          normalizedEnrollmentState(existingEnrollment) === 'place_reserved'
        ) {
          existingEnrollment = await documents(strapi, 'api::enrollment.enrollment').update({
            documentId: existingEnrollment.documentId,
            data: {
              metadata: {
                ...(objectValue(existingEnrollment.metadata)),
                activeReservationDocumentId: null,
                lastReservationExpiredAt: now,
              },
              reservationExpiresAt: null,
              enrollmentState: fallbackStatus,
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
            class: sanitizeClass(lockedTargetClass),
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

      const currentState = deriveClassRelationshipState(existingEnrollment, lockedTargetClass);
      let waitingListOffer: DocumentRecord | undefined;
      let reservableState = currentState;

      if (currentState === 'waiting_list') {
        if (!payload.waitingListOfferDocumentId) {
          if (
            !(await waitlistedCandidateCanReserveOpenPlace({
              candidate: existingCandidate,
              classRecord: lockedTargetClass,
              enrollment: existingEnrollment,
              strapi,
            }))
          ) {
            throw new ValidationError('A waiting-list offer is required before this waiting-list place can be claimed.');
          }
        } else {
          waitingListOffer = await findCandidateWaitingListOffer(
            strapi,
            existingCandidate,
            payload.waitingListOfferDocumentId
          );

          if (
            !waitingListOffer ||
            offerState(waitingListOffer) !== 'active' ||
            waitingListOffer.class?.documentId !== lockedTargetClass.documentId ||
            waitingListOffer.enrollment?.documentId !== existingEnrollment?.documentId
          ) {
            throw new ValidationError('This waiting-list offer is not available for this class.');
          }

          if (isPastDate(waitingListOffer.expiresAt)) {
            const expiredOffer = await expireWaitingListOffer({
              offer: waitingListOffer,
              requestContext,
              source: 'candidate_dashboard',
              strapi,
            });

            await promoteNextWaitingListOffer({
              classRecord: lockedTargetClass,
              excludeEnrollmentDocumentIds: [expiredOffer.enrollment?.documentId].filter(
                (documentId): documentId is string => Boolean(documentId)
              ),
              requestContext,
              sourceTrigger: 'waiting_list_offer_expired',
              strapi,
            });

            throw new ValidationError('This waiting-list offer has expired.');
          }
        }

        reservableState = 'enrollment_open';
      }

      if (reservableState === 'place_reserved') {
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
            created: false,
            reservation: sanitizeReservation(activeReservation),
            reserved: true,
          };
        }
      }

      if (reservableState !== 'enrollment_open') {
        throw new ValidationError('This class cannot currently be reserved from the current candidate state.');
      }

      const heldPlaces = await countCapacityHeldPlaces(strapi, lockedTargetClass);
      const reservationExpiresAt = getReservationExpiry(nowDate);
      const allocationId = randomUUID();
      const allocationCapacity =
        (!waitingListOffer && lockedTargetClass.state === 'full') || heldPlaces >= lockedTargetClass.capacity
          ? 0
          : lockedTargetClass.capacity || 0;
      const allocation = await allocateClassPlace({
        allocationId,
        candidateDocumentId: existingCandidate.documentId!,
        capacity: allocationCapacity,
        classDocumentId: lockedTargetClass.documentId!,
        expiresAt: reservationExpiresAt,
      });
      const allocationWaitlisted =
        allocation.status === 'waitlisted_new' || allocation.status === 'waitlisted_existing';

      if (allocation.status === 'paid') {
        throw new ValidationError('This class place has already been paid for.');
      }

      if (allocation.status === 'reserved_existing') {
        const activeReservation = await findActiveReservationForEnrollment(strapi, existingEnrollment);

        if (activeReservation && !isPastDate(activeReservation.expiresAt)) {
          return {
            created: false,
            reservation: sanitizeReservation(activeReservation),
            reserved: true,
          };
        }

        redisCleanup = {
          classDocumentId: lockedTargetClass.documentId!,
          removeWaitlist: false,
        };
        throw new ApplicationError('Class allocation state was stale. Please try again.');
      }

      if (allocationWaitlisted) {
        if (waitingListOffer) {
          await supersedeWaitingListOffer({
            offer: waitingListOffer,
            reason: 'capacity_unavailable_at_claim',
            requestContext,
            strapi,
          });
        }

        if (allocation.waitlistCreated) {
          redisCleanup = {
            classDocumentId: lockedTargetClass.documentId!,
            removeWaitlist: true,
          };
        }

        const waitingListPosition =
          allocation.waitlistPosition ||
          (await getNextWaitingListPosition(strapi, lockedTargetClass, existingCandidate));
        const metadata = {
          ...(objectValue(existingEnrollment?.metadata)),
          joinedWaitingListAt: now,
          waitingListSource: 'candidate_dashboard',
          waitingListSourceSystem: 'redis_allocation',
        };
        const enrollment = existingEnrollment?.documentId
          ? await documents(strapi, 'api::enrollment.enrollment').update({
              documentId: existingEnrollment.documentId,
              data: {
                metadata,
                paymentStatus: 'pending',
                enrollmentState: 'waiting_list',
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
                  connect: [{ documentId: lockedTargetClass.documentId }],
                },
                completionStatus: 'not_started',
                interestRegisteredAt: now,
                metadata,
                passStatus: 'not_assessed',
                paymentStatus: 'pending',
                enrollmentState: 'waiting_list',
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
            class: sanitizeClass(lockedTargetClass),
            heldPlaces,
            redisHeldPlaces: allocation.heldPlaces,
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
        await publishClassRelationshipEvent({
          candidate: existingCandidate,
          classRecord: lockedTargetClass,
          eventType: 'waiting_list_joined',
          strapi,
        });

        redisCleanup = undefined;

        return {
          created: !existingEnrollment?.documentId,
          reservation: null,
          reserved: false,
        };
      }

      redisCleanup = {
        classDocumentId: lockedTargetClass.documentId!,
        removeWaitlist: false,
      };
      const enrollmentMetadata = {
        ...(objectValue(existingEnrollment?.metadata)),
        allocationId,
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
              enrollmentState: 'place_reserved',
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
                connect: [{ documentId: lockedTargetClass.documentId }],
              },
              completionStatus: 'not_started',
              interestRegisteredAt: now,
              invitedToJoinAt: now,
              metadata: enrollmentMetadata,
              passStatus: 'not_assessed',
              paymentStatus: 'pending',
              reservationExpiresAt,
              enrollmentState: 'place_reserved',
            },
            populate: ['class'],
          });

      const reservation = await documents(strapi, 'api::reservation.reservation').create({
        data: {
          amountPence: classPaymentAmount(lockedTargetClass),
          candidate: {
            connect: [{ documentId: existingCandidate.documentId }],
          },
          class: {
            connect: [{ documentId: lockedTargetClass.documentId }],
          },
          currency: lockedTargetClass.currency || 'GBP',
          enrollment: {
            connect: [{ documentId: enrollment.documentId }],
          },
          expiresAt: reservationExpiresAt,
          metadata: {
            allocationId,
            allocationLockedAt: now,
            class: sanitizeClass(lockedTargetClass),
            heldPlacesBeforeReservation: heldPlaces,
            redisHeldPlacesBeforeReservation: allocation.heldPlaces,
            source: waitingListOffer ? 'waiting_list_offer' : 'candidate_dashboard',
            waitingListOfferDocumentId: waitingListOffer?.documentId,
          },
          idempotencyKey: allocationId,
          reservationStartedAt: now,
          source: waitingListOffer ? 'waiting_list_offer' : 'candidate_dashboard',
          reservationState: 'active',
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
      let claimedWaitingListOffer: DocumentRecord | undefined;

      if (waitingListOffer?.documentId) {
        const previousOfferState = sanitizeWaitingListOffer(waitingListOffer);

        claimedWaitingListOffer = await documents(strapi, 'api::waiting-list-offer.waiting-list-offer').update({
          documentId: waitingListOffer.documentId,
          data: {
            claimedAt: now,
            metadata: {
              ...(objectValue(waitingListOffer.metadata)),
              claimedReservationDocumentId: reservation.documentId,
            },
            reservation: {
              connect: [{ documentId: reservation.documentId }],
            },
            offerState: 'claimed',
          },
          populate: waitingListOfferPopulate,
        });

        await recordWaitingListOfferAudit({
          eventType: 'candidate.waiting_list_offer_claimed',
          newState: sanitizeWaitingListOffer(claimedWaitingListOffer),
          offer: claimedWaitingListOffer,
          previousState: previousOfferState,
          requestContext,
          source: 'candidate_dashboard',
          strapi,
        });
        await publishWaitingListOfferEvent({
          offer: claimedWaitingListOffer,
          strapi,
          type: 'waiting_list_offer_claimed',
        });
      }

        await auditEvents(strapi).record({
          actorEmail: existingCandidate.email,
        actorId: auth.subject,
        actorType: 'candidate',
        eventCategory: 'payment',
        eventType: 'candidate.reservation_created',
        ipAddress: requestContext.ipAddress,
        metadata: {
          allocationId,
          class: sanitizeClass(lockedTargetClass),
          heldPlacesBeforeReservation: heldPlaces,
          redisHeldPlacesBeforeReservation: allocation.heldPlaces,
          waitingListOffer: sanitizeWaitingListOffer(claimedWaitingListOffer),
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
        await publishClassRelationshipEvent({
          candidate: existingCandidate,
          classRecord: lockedTargetClass,
          eventType: 'reservation_created',
          strapi,
        });

        redisCleanup = undefined;

        return {
          created: true,
          reservation: sanitizeReservation(reservation),
          reserved: true,
        };
      });

      return {
        classInterest: await buildCandidateClassInterestForCandidate(strapi, existingCandidate),
        ...allocationResult,
      };
    } catch (error) {
      if (redisCleanup) {
        await releaseClassPlaceAllocation({
          candidateDocumentId: existingCandidate.documentId!,
          classDocumentId: redisCleanup.classDocumentId,
          removeWaitlist: redisCleanup.removeWaitlist,
        }).catch((cleanupError) => {
          const logger = (strapi as unknown as { log?: { error?: (message: string, error?: unknown) => void } }).log;
          logger?.error?.('Class allocation Redis cleanup failed.', cleanupError);
        });
      }

      throw error;
    }
  },

  async declineCurrentCandidateWaitingListOffer(
    auth: Auth0State | undefined,
    offerDocumentId: string,
    requestContext: RequestContext = {}
  ) {
    if (!auth || auth.type !== 'auth0' || !auth.subject) {
      throw new UnauthorizedError('Auth0 authentication is required.');
    }

    const existingCandidate = await findCandidateByAuthIdentity(strapi, auth.subject);

    if (!existingCandidate) {
      throw new ValidationError('Candidate account must be synced before a waiting-list offer can be declined.');
    }

    const offer = await findCandidateWaitingListOffer(strapi, existingCandidate, offerDocumentId);

    if (!offer) {
      throw new ValidationError('Waiting-list offer could not be found.');
    }

    if (waitingListOfferTerminalStatuses.has(String(offerState(offer)))) {
      return {
        classInterest: await buildCandidateClassInterestForCandidate(strapi, existingCandidate),
        waitingListOffer: sanitizeWaitingListOffer(offer),
      };
    }

    if (offerState(offer) !== 'active') {
      throw new ValidationError('This waiting-list offer cannot be declined.');
    }

    if (isPastDate(offer.expiresAt)) {
      const expiredOffer = await expireWaitingListOffer({
        offer,
        requestContext,
        source: 'candidate_dashboard',
        strapi,
      });

      await promoteNextWaitingListOffer({
        classRecord: offer.class,
        excludeEnrollmentDocumentIds: [offer.enrollment?.documentId].filter(
          (documentId): documentId is string => Boolean(documentId)
        ),
        requestContext,
        sourceTrigger: 'waiting_list_offer_expired',
        strapi,
      });

      return {
        classInterest: await buildCandidateClassInterestForCandidate(strapi, existingCandidate),
        waitingListOffer: sanitizeWaitingListOffer(expiredOffer),
      };
    }

    const now = new Date().toISOString();
    const previousOfferState = sanitizeWaitingListOffer(offer);
    const declinedOffer = await documents(strapi, 'api::waiting-list-offer.waiting-list-offer').update({
      documentId: offer.documentId,
      data: {
        declinedAt: now,
        metadata: {
          ...(objectValue(offer.metadata)),
          declinedBy: 'candidate_dashboard',
        },
        offerState: 'declined',
      },
      populate: waitingListOfferPopulate,
    });

    await updateEnrollmentWaitingListOfferEligibility({
      eligible: false,
      enrollment: offer.enrollment,
      reason: 'waiting_list_offer_declined',
      strapi,
    });

    if (offer.candidate?.documentId && offer.class?.documentId) {
      await releaseClassPlaceAllocation({
        candidateDocumentId: offer.candidate.documentId,
        classDocumentId: offer.class.documentId,
        removeWaitlist: true,
      }).catch((error) => {
        const logger = (strapi as unknown as { log?: { error?: (message: string, error?: unknown) => void } }).log;
        logger?.error?.('Class allocation Redis waiting-list offer decline cleanup failed.', error);
      });
    }

    await recordWaitingListOfferAudit({
      eventType: 'candidate.waiting_list_offer_declined',
      newState: sanitizeWaitingListOffer(declinedOffer),
      offer: declinedOffer,
      previousState: previousOfferState,
      requestContext,
      source: 'candidate_dashboard',
      strapi,
    });
    await publishWaitingListOfferEvent({
      offer: declinedOffer,
      strapi,
      type: 'waiting_list_offer_declined',
    });

    await promoteNextWaitingListOffer({
      classRecord: offer.class,
      excludeEnrollmentDocumentIds: [offer.enrollment?.documentId].filter(
        (documentId): documentId is string => Boolean(documentId)
      ),
      requestContext,
      sourceTrigger: 'waiting_list_offer_declined',
      strapi,
    });

    return {
      classInterest: await buildCandidateClassInterestForCandidate(strapi, existingCandidate),
      waitingListOffer: sanitizeWaitingListOffer(declinedOffer),
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

    const classCheckoutPolicyDocument = await findActivePolicyDocument(strapi, classCheckoutPolicyType);
    const confirmedPayment = await findConfirmedPaymentForReservationOrEnrollment(strapi, reservation);
    const paymentAction = confirmedPayment
      ? disabledPaymentAction(
          paymentState(confirmedPayment) === 'paid'
            ? 'Payment has been confirmed.'
            : 'Payment needs HireFlip review.',
          paymentState(confirmedPayment) === 'paid' ? 'payment_confirmed' : 'payment_requires_review'
        )
      : await getPaymentActionForReservation({
          candidate: existingCandidate,
          classCheckoutPolicyDocument,
          requestContext,
          reservation,
          strapi,
        });

    return {
      classInterest: await buildCandidateClassInterestForCandidate(strapi, existingCandidate),
      payment: sanitizePayment(confirmedPayment),
      paymentAction,
      reservation: sanitizeReservation(reservation),
      terms: sanitizePolicyDocument(classCheckoutPolicyDocument),
    };
  },

  async acceptCurrentCandidateClassReservationTerms(
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
      throw new ValidationError('Candidate account must be synced before reservation terms can be accepted.');
    }

    const payload = validateAcceptReservationTerms(input ?? {});
    const reservation = await findCandidateReservation(strapi, existingCandidate, reservationDocumentId);

    if (!reservation) {
      throw new ValidationError('Reservation could not be found.');
    }

    if (reservationState(reservation) !== 'active') {
      throw new ValidationError('Only an active reservation can accept terms.');
    }

    if (isPastDate(reservation.expiresAt)) {
      throw new ValidationError('This reservation has expired.');
    }

    const classCheckoutPolicyDocument = await findActivePolicyDocument(strapi, classCheckoutPolicyType);

    if (!classCheckoutPolicyDocument?.documentId || !classCheckoutPolicyDocument.version) {
      throw new ValidationError('Checkout terms are not available yet. Please try again later.');
    }

    if (
      payload.termsVersion &&
      payload.termsVersion !== classCheckoutPolicyDocument.version
    ) {
      throw new ValidationError('Checkout terms have changed. Refresh this checkout and review the latest terms.');
    }

    const now = new Date().toISOString();
    const termsVersion = classCheckoutPolicyDocument.version;
    const previousReservation = sanitizeReservation(reservation);
    const updatedReservation = await documents(strapi, 'api::reservation.reservation').update({
      documentId: reservation.documentId,
      data: {
        acceptedTermsPolicyDocument: {
          connect: [{ documentId: classCheckoutPolicyDocument.documentId }],
        },
        metadata: {
          ...(objectValue(reservation.metadata)),
          termsAcceptedPolicyDocumentId: classCheckoutPolicyDocument.documentId,
          termsAcceptedPolicyKey: classCheckoutPolicyDocument.policyKey,
          termsAcceptedPolicyType: classCheckoutPolicyDocument.policyType,
          termsAcceptedSource: 'candidate_dashboard',
          termsScrollConfirmed: true,
        },
        termsAcceptedAt: now,
        termsVersion,
      },
      populate: reservationPopulate,
    });
    const paymentAction = await getPaymentActionForReservation({
      candidate: existingCandidate,
      classCheckoutPolicyDocument,
      requestContext,
      reservation: updatedReservation,
      strapi,
    });

    await auditEvents(strapi).record({
      actorEmail: existingCandidate.email,
      actorId: auth.subject,
      actorType: 'candidate',
      eventCategory: 'payment',
      eventType: 'candidate.reservation_terms_accepted',
      ipAddress: requestContext.ipAddress,
      metadata: {
        reservation: sanitizeReservation(updatedReservation),
        termsPolicyDocumentId: classCheckoutPolicyDocument.documentId,
        termsPolicyKey: classCheckoutPolicyDocument.policyKey,
        termsPolicyType: classCheckoutPolicyDocument.policyType,
        termsVersion,
      },
      newState: {
        reservation: sanitizeReservation(updatedReservation),
      },
      occurredAt: now,
      previousState: {
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
      paymentAction,
      reservation: sanitizeReservation(updatedReservation),
      terms: sanitizePolicyDocument(classCheckoutPolicyDocument),
    };
  },

  async confirmClassReservationPaymentFromProvider(
    input: unknown,
    requestContext: RequestContext = {}
  ) {
    const confirmation = validateProviderCheckoutConfirmation(input ?? {});
    const confirmationMetadata = objectValue(confirmation.metadata);
    const reservationDocumentId =
      typeof confirmationMetadata.reservationDocumentId === 'string'
        ? confirmationMetadata.reservationDocumentId
        : undefined;

    if (!reservationDocumentId) {
      throw new ValidationError('A reservation document ID is required before a payment can be confirmed.');
    }

    const reservation = await findReservationByDocumentId(strapi, reservationDocumentId);

    if (!reservation) {
      throw new ValidationError('Reservation could not be found.');
    }

    if (!reservation.candidate?.documentId) {
      throw new ValidationError('Reservation is not linked to a candidate.');
    }

    return confirmReservationPaymentWithProvider({
      actor: {
        actorId: requestContext.serviceName || 'payment-service',
        actorType: 'service',
        eventType: 'candidate.payment_confirmed_by_webhook',
        source: 'payment_service',
      },
      candidate: reservation.candidate,
      confirmation,
      requestContext: {
        ...requestContext,
        serviceName: requestContext.serviceName || 'payment-service',
      },
      reservation,
      strapi,
    });
  },

  async recordClassReservationPaymentProviderOutcome(
    input: unknown,
    eventType: string,
    requestContext: RequestContext = {}
  ) {
    const confirmation = validateProviderCheckoutConfirmation(input ?? {});
    const outcome = providerPaymentOutcomeFromEvent(eventType, confirmation);

    if (!outcome) {
      return {
        ignored: true,
      };
    }

    const confirmationMetadata = objectValue(confirmation.metadata);
    const reservationDocumentId =
      typeof confirmationMetadata.reservationDocumentId === 'string'
        ? confirmationMetadata.reservationDocumentId
        : undefined;

    if (!reservationDocumentId) {
      throw new ValidationError('A reservation document ID is required before a payment outcome can be recorded.');
    }

    const reservation = await findReservationByDocumentId(strapi, reservationDocumentId);

    if (!reservation) {
      throw new ValidationError('Reservation could not be found.');
    }

    if (!reservation.candidate?.documentId) {
      throw new ValidationError('Reservation is not linked to a candidate.');
    }

    return recordProviderPaymentOutcome({
      actor: {
        actorId: requestContext.serviceName || 'payment-service',
        actorType: 'service',
        eventType: outcome === 'expired' ? 'candidate.reservation_expired' : 'candidate.payment_failed',
        source: 'payment_service',
      },
      candidate: reservation.candidate,
      confirmation,
      eventType,
      outcome,
      requestContext: {
        ...requestContext,
        serviceName: requestContext.serviceName || 'payment-service',
      },
      reservation,
      strapi,
    });
  },

  async reconcileProviderCheckoutPayments(limit = 50, requestContext: RequestContext = {}) {
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const payments = await documents(strapi, 'api::payment.payment').findMany({
      filters: {
        paymentProvider: 'stripe',
        paymentState: {
          $in: ['checkout_created', 'pending'],
        },
      },
      limit: safeLimit,
      populate: ['reservation'],
      sort: ['createdAt:asc'],
    });
    const summary = {
      failed: 0,
      processed: 0,
      providerUnavailable: 0,
      skipped: 0,
      total: payments.length,
      unpaidSkipped: 0,
    };

    for (const payment of payments) {
      const checkoutSessionId = payment.providerCheckoutSessionId;

      if (typeof checkoutSessionId !== 'string') {
        summary.skipped += 1;
        continue;
      }

      const confirmation = await requestPaymentServiceCheckoutSessionStatus(checkoutSessionId);

      if (!confirmation) {
        summary.providerUnavailable += 1;
        continue;
      }

      const confirmationMetadata = objectValue(confirmation.metadata);
      const reservationDocumentId =
        (typeof confirmationMetadata.reservationDocumentId === 'string'
          ? confirmationMetadata.reservationDocumentId
          : undefined) || payment.reservation?.documentId;

      if (!reservationDocumentId) {
        summary.failed += 1;
        continue;
      }

      const reservation = await findReservationByDocumentId(strapi, reservationDocumentId);

      if (!reservation?.candidate?.documentId) {
        summary.failed += 1;
        continue;
      }

      try {
        if (confirmation.status === 'complete' && confirmation.paymentStatus === 'paid') {
          await confirmReservationPaymentWithProvider({
            actor: {
              actorId: requestContext.serviceName || 'payment-reconciliation',
              actorType: 'service',
              eventType: 'candidate.payment_confirmed_by_reconciliation',
              source: 'payment_service',
            },
            candidate: reservation.candidate,
            confirmation,
            requestContext: {
              ...requestContext,
              serviceName: requestContext.serviceName || 'payment-reconciliation',
            },
            reservation,
            strapi,
          });
          summary.processed += 1;
          continue;
        }

        if (confirmation.status === 'expired') {
          await recordProviderPaymentOutcome({
            actor: {
              actorId: requestContext.serviceName || 'payment-reconciliation',
              actorType: 'service',
              eventType: 'candidate.reservation_expired',
              source: 'payment_service',
            },
            candidate: reservation.candidate,
            confirmation,
            eventType: 'checkout.session.expired',
            outcome: 'expired',
            requestContext: {
              ...requestContext,
              serviceName: requestContext.serviceName || 'payment-reconciliation',
            },
            reservation,
            strapi,
          });
          summary.processed += 1;
          continue;
        }

        if (confirmation.status === 'open' && isPastDate(reservation.expiresAt)) {
          const expiredProviderSession = await requestPaymentServiceExpireCheckoutSession(checkoutSessionId);

          if (!expiredProviderSession) {
            summary.providerUnavailable += 1;
            continue;
          }

          await recordProviderPaymentOutcome({
            actor: {
              actorId: requestContext.serviceName || 'payment-reconciliation',
              actorType: 'service',
              eventType: 'candidate.reservation_expired',
              source: 'payment_service',
            },
            candidate: reservation.candidate,
            confirmation: expiredProviderSession,
            eventType: 'checkout.session.expired',
            outcome: 'expired',
            requestContext: {
              ...requestContext,
              serviceName: requestContext.serviceName || 'payment-reconciliation',
            },
            reservation,
            strapi,
          });
          summary.processed += 1;
          continue;
        }

        summary.unpaidSkipped += 1;
      } catch {
        summary.failed += 1;
      }
    }

    return summary;
  },

  async processWaitingListOffers(limit = 50, requestContext: RequestContext = {}) {
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const now = new Date().toISOString();
    const expiredOffers = await documents(strapi, 'api::waiting-list-offer.waiting-list-offer').findMany({
      filters: {
        expiresAt: {
          $lte: now,
        },
        offerState: 'active',
      },
      limit: safeLimit,
      populate: waitingListOfferPopulate,
      sort: ['expiresAt:asc', 'createdAt:asc'],
    });
    const summary = {
      expired: 0,
      failed: 0,
      promoted: 0,
      skipped: 0,
      total: expiredOffers.length,
    };

    for (const offer of expiredOffers) {
      try {
        const expiredOffer = await expireWaitingListOffer({
          offer,
          requestContext: {
            ...requestContext,
            serviceName: requestContext.serviceName || 'class-workflow-manual',
          },
          source: 'system',
          strapi,
        });
        summary.expired += 1;

        const nextOffer = await promoteNextWaitingListOffer({
          classRecord: expiredOffer.class,
          excludeEnrollmentDocumentIds: [expiredOffer.enrollment?.documentId].filter(
            (documentId): documentId is string => Boolean(documentId)
          ),
          requestContext: {
            ...requestContext,
            serviceName: requestContext.serviceName || 'class-workflow-manual',
          },
          sourceTrigger: 'waiting_list_offer_expired',
          strapi,
        });

        if (nextOffer) {
          summary.promoted += 1;
        } else {
          summary.skipped += 1;
        }
      } catch {
        summary.failed += 1;
      }
    }

    return summary;
  },

  async syncWaitingListOfferExpiryJobs(limit = 1000, requestContext: RequestContext = {}) {
    const safeLimit = Math.min(Math.max(Number(limit) || 1000, 1), 5000);
    const now = new Date();
    const activeOffers = await documents(strapi, 'api::waiting-list-offer.waiting-list-offer').findMany({
      filters: {
        offerState: 'active',
      },
      limit: safeLimit,
      populate: waitingListOfferPopulate,
      sort: ['expiresAt:asc', 'createdAt:asc'],
    });
    const summary = {
      expired: 0,
      failed: 0,
      promoted: 0,
      rescheduled: 0,
      total: activeOffers.length,
    };
    const serviceName = requestContext.serviceName || 'class-workflow-bootstrap';

    for (const offer of activeOffers) {
      if (!offer.documentId || !offer.expiresAt) {
        summary.failed += 1;
        continue;
      }

      try {
        if (Date.parse(offer.expiresAt) <= now.getTime()) {
          const expiredOffer = await expireWaitingListOffer({
            offer,
            requestContext: {
              ...requestContext,
              serviceName,
            },
            source: 'system',
            strapi,
          });
          const nextOffer = await promoteNextWaitingListOffer({
            classRecord: expiredOffer.class,
            excludeEnrollmentDocumentIds: [expiredOffer.enrollment?.documentId].filter(
              (documentId): documentId is string => Boolean(documentId)
            ),
            requestContext: {
              ...requestContext,
              serviceName,
            },
            sourceTrigger: 'waiting_list_offer_expired',
            strapi,
          });

          summary.expired += 1;

          if (nextOffer) {
            summary.promoted += 1;
          }

          continue;
        }

        await addWaitingListOfferExpiryJob({
          classDocumentId: offer.class?.documentId,
          expiresAt: offer.expiresAt,
          offerDocumentId: offer.documentId,
        });
        summary.rescheduled += 1;
      } catch {
        summary.failed += 1;
      }
    }

    return summary;
  },

  async expireWaitingListOfferByDocumentId(
    offerDocumentId: string,
    requestContext: RequestContext = {}
  ) {
    if (!offerDocumentId) {
      throw new ValidationError('Waiting-list offer document ID is required.');
    }

    const offers = await documents(strapi, 'api::waiting-list-offer.waiting-list-offer').findMany({
      filters: {
        documentId: offerDocumentId,
      },
      limit: 1,
      populate: waitingListOfferPopulate,
    });
    const offer = offers[0];

    if (!offer || offerState(offer) !== 'active') {
      return {
        skipped: true,
        waitingListOffer: sanitizeWaitingListOffer(offer),
      };
    }

    if (!isPastDate(offer.expiresAt)) {
      await addWaitingListOfferExpiryJob({
        classDocumentId: offer.class?.documentId,
        expiresAt: offer.expiresAt!,
        offerDocumentId: offer.documentId!,
      });

      return {
        rescheduled: true,
        waitingListOffer: sanitizeWaitingListOffer(offer),
      };
    }

    const expiredOffer = await expireWaitingListOffer({
      offer,
      requestContext: {
        ...requestContext,
        serviceName: requestContext.serviceName || 'class-workflow-worker',
      },
      source: 'system',
      strapi,
    });
    const nextOffer = await promoteNextWaitingListOffer({
      classRecord: expiredOffer.class,
      excludeEnrollmentDocumentIds: [expiredOffer.enrollment?.documentId].filter(
        (documentId): documentId is string => Boolean(documentId)
      ),
      requestContext: {
        ...requestContext,
        serviceName: requestContext.serviceName || 'class-workflow-worker',
      },
      sourceTrigger: 'waiting_list_offer_expired',
      strapi,
    });

    return {
      promoted: Boolean(nextOffer),
      waitingListOffer: sanitizeWaitingListOffer(expiredOffer),
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

    const confirmedPayment = await findConfirmedPaymentForReservationOrEnrollment(strapi, reservation);

    if (confirmedPayment) {
      throw new ValidationError('This payment is already being processed and cannot be cancelled.');
    }

    const existingCheckoutPayment = await findCheckoutPaymentForReservation(strapi, reservation);
    const existingCheckoutSession = checkoutSessionFromPayment(existingCheckoutPayment);

    if (existingCheckoutSession) {
      const providerSession = await requestPaymentServiceExpireCheckoutSession(
        existingCheckoutSession.checkoutSessionId
      );

      if (!providerSession) {
        throw new ApplicationError('Checkout could not be cancelled safely because the provider session could not be expired.');
      }

      return recordProviderPaymentOutcome({
        actor: {
          actorEmail: existingCandidate.email,
          actorId: auth.subject,
          actorType: 'candidate',
          eventType: 'candidate.reservation_expired',
          source: 'core_api',
        },
        candidate: existingCandidate,
        confirmation: providerSession,
        eventType: 'checkout.session.expired',
        outcome: 'expired',
        requestContext,
        reservation,
        strapi,
      });
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
      reservationState(reservation) === 'active'
        ? await documents(strapi, 'api::reservation.reservation').update({
            documentId: reservation.documentId,
            data: {
              cancelledAt: now,
              reservationState: 'cancelled',
            },
            populate: ['candidate', 'class', 'enrollment'],
          })
        : reservation;
    const updatedEnrollment =
      reservation.enrollment?.documentId &&
      normalizedEnrollmentState(reservation.enrollment) === 'place_reserved'
        ? await documents(strapi, 'api::enrollment.enrollment').update({
            documentId: reservation.enrollment.documentId,
            data: {
              metadata: {
                ...(objectValue(reservation.enrollment.metadata)),
                activeReservationDocumentId: null,
                lastReservationCancelledAt: now,
              },
              reservationExpiresAt: null,
              enrollmentState: fallbackStatus,
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
    await publishClassRelationshipEvent({
      candidate: existingCandidate,
      classRecord,
      eventType: 'reservation_cancelled',
      strapi,
    });

    if (existingCandidate.documentId && classRecord?.documentId) {
      await releaseClassPlaceAllocation({
        candidateDocumentId: existingCandidate.documentId,
        classDocumentId: classRecord.documentId,
      }).catch((error) => {
        const logger = (strapi as unknown as { log?: { error?: (message: string, error?: unknown) => void } }).log;
        logger?.error?.('Class allocation Redis cancel release failed.', error);
      });
    }

    await promoteNextWaitingListOffer({
      classRecord,
      excludeEnrollmentDocumentIds: [updatedEnrollment?.documentId].filter(
        (documentId): documentId is string => Boolean(documentId)
      ),
      requestContext,
      sourceTrigger: 'cancelled_reservation',
      strapi,
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

    const confirmedPayment = await findConfirmedPaymentForReservationOrEnrollment(strapi, reservation);

    if (confirmedPayment) {
      return {
        classInterest: await buildCandidateClassInterestForCandidate(strapi, existingCandidate),
        payment: sanitizePayment(confirmedPayment),
        reservation: sanitizeReservation(reservation),
      };
    }

    const existingCheckoutPayment = await findCheckoutPaymentForReservation(strapi, reservation);

    if (checkoutSessionFromPayment(existingCheckoutPayment)) {
      return {
        classInterest: await buildCandidateClassInterestForCandidate(strapi, existingCandidate),
        payment: sanitizePayment(existingCheckoutPayment),
        paymentAction: await getPaymentActionForReservation({
          candidate: existingCandidate,
          requestContext,
          reservation,
          strapi,
        }),
        reservation: sanitizeReservation(reservation),
      };
    }

    if (reservationState(reservation) !== 'active') {
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
        reservationState: 'expired',
      },
      populate: ['candidate', 'class', 'enrollment'],
    });
    const updatedEnrollment =
      reservation.enrollment?.documentId &&
      normalizedEnrollmentState(reservation.enrollment) === 'place_reserved'
        ? await documents(strapi, 'api::enrollment.enrollment').update({
            documentId: reservation.enrollment.documentId,
            data: {
              metadata: {
                ...(objectValue(reservation.enrollment.metadata)),
                activeReservationDocumentId: null,
                lastReservationExpiredAt: now,
              },
              reservationExpiresAt: null,
              enrollmentState: fallbackStatus,
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
    await publishClassRelationshipEvent({
      candidate: existingCandidate,
      classRecord,
      eventType: 'reservation_expired',
      strapi,
    });

    if (existingCandidate.documentId && classRecord?.documentId) {
      await releaseClassPlaceAllocation({
        candidateDocumentId: existingCandidate.documentId,
        classDocumentId: classRecord.documentId,
      }).catch((error) => {
        const logger = (strapi as unknown as { log?: { error?: (message: string, error?: unknown) => void } }).log;
        logger?.error?.('Class allocation Redis expiry release failed.', error);
      });
    }

    await promoteNextWaitingListOffer({
      classRecord,
      excludeEnrollmentDocumentIds: [updatedEnrollment?.documentId].filter(
        (documentId): documentId is string => Boolean(documentId)
      ),
      requestContext,
      sourceTrigger: 'expired_reservation',
      strapi,
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
        reviewState: 'new',
        suggestedValue: payload.suggestedValue,
      },
    });
    const response = {
      candidateEmail: unlistedInterest.candidateEmail,
      documentId: unlistedInterest.documentId,
      interestType: unlistedInterest.interestType,
      source: unlistedInterest.source,
      status: unlistedInterestState(unlistedInterest),
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

import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { errors, validateZodSchema, z } from '@strapi/utils';
import sharp from 'sharp';
import { getAuth0ManagementClient, type Auth0User } from '../../../utils/auth0-management';
import { publishAdminRealtimeEvent } from '../../../utils/admin-realtime-events';

const { ValidationError } = errors;

type RequestContext = {
  ipAddress?: string;
  requestId?: string;
  serviceName?: string;
  userAgent?: string;
};

type DocumentRecord = Record<string, unknown> & {
  accountCreatedAt?: string;
  assignmentMode?: string;
  authIdentityId?: string;
  authPasswordTicketExpiresAt?: string;
  authPasswordTicketUrl?: string;
  acceptanceLabel?: string;
  body?: string;
  candidate?: DocumentRecord;
  candidateDeclineReason?: string;
  candidateFollowUpDueAt?: string;
  candidateMessage?: string;
  candidateNotifiedAt?: string;
  candidateResponse?: string;
  candidateResponseDeadline?: string;
  candidateRespondedAt?: string;
  arrivalInstructions?: string;
  capacityClaim?: DocumentRecord;
  capacityChangeRequestStatus?: string;
  class?: DocumentRecord;
  claimCount?: number;
  claimState?: string;
  companyName?: string;
  contactState?: string;
  completedAt?: string;
  contactRole?: string;
  createdAt?: string;
  createdByEmployerContactEmail?: string;
  createdByEmployerContactName?: string;
  createdByStaffDisplayName?: string;
  createdByStaffEmail?: string;
  currentlyOpenAt?: string;
  currentlyOpenByContact?: DocumentRecord;
  currentlyOpenExpiresAt?: string;
  coverageRegions?: DocumentRecord[];
  coverageConfirmedAt?: string;
  coverageConfirmedByEmail?: string;
  dashboardOnboardingCompletedAt?: string;
  dashboardOnboardingMetadata?: unknown;
  dashboardOnboardingState?: string;
  declinedAt?: string;
  displayTitle?: string;
  documentId?: string;
  email?: string;
  employerTermsAcceptedAt?: string;
  employerTermsAcceptedByEmail?: string;
  employerTermsPolicyDocumentId?: string;
  employerTermsPolicyVersion?: string;
  employerFollowUpDueAt?: string;
  employer?: DocumentRecord;
  employerContact?: DocumentRecord;
  employerState?: string;
  endTime?: string;
  enrollment?: DocumentRecord;
  expiresAt?: string;
  firstName?: string;
  fulfilledAt?: string;
  id?: number | string;
  internalNote?: string;
  introCopy?: string;
  detailsProvidedAt?: string;
  detailsUpdatedAt?: string;
  initialInterviewCommitmentCadence?: string;
  initialInterviewCommitmentVolume?: number;
  interview?: DocumentRecord;
  interviewRequest?: DocumentRecord;
  interviewCommitmentCadence?: string;
  interviewCommitmentVolume?: number;
  interviewerName?: string;
  interviewCoverageOverrideAt?: string;
  interviewCoverageOverrideByEmail?: string;
  interviewCoverageOverrideByName?: string;
  interviewCoverageOverrideReason?: string;
  interviewSlot?: DocumentRecord;
  interviewState?: string;
  inviteeName?: string;
  inviteeRoleTitle?: string;
  lastName?: string;
  lastSentAt?: string;
  locationDetails?: string;
  locationType?: string;
  meetingUrl?: string;
  candidateInstructions?: string;
  deliveryFailureMessage?: string;
  deliveryState?: string;
  feedback?: DocumentRecord;
  offerState?: string;
  requestState?: string;
  inviteEmail?: string;
  inviteState?: string;
  operatingRegions?: DocumentRecord[];
  policyState?: string;
  policyType?: string;
  progressionState?: string;
  progressionType?: string;
  metadata?: unknown;
  region?: string;
  regionCommitments?: DocumentRecord[];
  requestedDetailsAt?: string;
  requiredSlotCount?: number;
  releaseNote?: string;
  releaseReason?: string;
  revocationReason?: string;
  revokedAt?: string;
  roleTitle?: string;
  slug?: string;
  phone?: string;
  profileImage?: DocumentRecord;
  scheduledEndTime?: string;
  scheduledStartTime?: string;
  slotState?: string;
  state?: string;
  slots?: DocumentRecord[];
  startTime?: string;
  submittedAt?: string;
  notificationServiceJobId?: string;
  title?: string;
  updatedAt?: string;
  version?: string;
  workSector?: DocumentRecord;
};

type DocumentCollection = {
  create(input: Record<string, unknown>): Promise<DocumentRecord>;
  findMany(input: Record<string, unknown>): Promise<DocumentRecord[]>;
  update(input: Record<string, unknown>): Promise<DocumentRecord>;
};

type StrapiDocumentService = {
  documents(uid: string): unknown;
  log?: { warn(message: string): void };
  plugin(uid: string): { service(uid: string): any };
  service(uid: string): unknown;
};

type AuditEventService = {
  record(input: unknown): Promise<unknown>;
};

type InterviewRequestService = {
  markSlotOptionsSubmitted(input: unknown, context: RequestContext): Promise<unknown>;
  reconcileReusableInterviewSlots(limit?: number, context?: RequestContext): Promise<unknown>;
  releaseCapacityClaim(input: unknown, context: RequestContext): Promise<unknown>;
};

type EmployerReliabilityEventService = {
  summaryForEmployer(employerDocumentId: string): Promise<unknown>;
};

type SupportCaseService = {
  addMessage(input: unknown): Promise<DocumentRecord>;
  casesForEmployerContact(input: {
    employerContactDocumentId: string;
    employerDocumentId?: string;
  }): Promise<unknown[]>;
  createDashboardSupportCase(input: unknown): Promise<{
    created: boolean;
    supportCase: unknown;
  }>;
  getCaseForEmployerContact(input: {
    employerContactDocumentId: string;
    employerDocumentId?: string;
    supportCaseDocumentId: string;
  }): Promise<unknown | null>;
  updateCaseState(input: unknown): Promise<DocumentRecord>;
};

type UploadedFile = {
  filepath?: string;
  mimetype?: string;
  originalFilename?: string;
  path?: string;
  size?: number;
};

type EmployerInviteAcceptanceIdentity = {
  authIdentityId: string;
  email: string;
  name?: string;
};

const identitySchema = z
  .object({
    authIdentityId: z.string().trim().min(1).max(160).optional(),
    email: z.string().trim().email().max(254).optional().transform((value) => value?.toLowerCase()),
  })
  .strict()
  .refine((value) => Boolean(value.authIdentityId || value.email), {
    message: 'Employer identity is required.',
  });

const locationTypeSchema = z.enum(['online', 'phone', 'in_person', 'to_be_confirmed']);
const cadenceSchema = z.enum(['quarterly', 'biannually', 'annually']);
const commitmentModeSchema = z.enum(['global', 'per_region']);
const employerDeclineReasonSchema = z.enum([
  'contact_reschedule_requested',
  'no_availability',
  'wrong_region',
  'role_paused',
  'contact_unavailable',
  'capacity_changed',
  'other',
]);

const regionCommitmentSchema = z
  .object({
    interviewCommitmentCadence: cadenceSchema,
    interviewCommitmentVolume: z.number().int().min(1).max(1000),
    regionDocumentId: z.string().trim().min(1).max(120),
  })
  .strict();

const teamContactSchema = z
  .object({
    coverageRegionDocumentIds: z
      .array(z.string().trim().min(1).max(120))
      .max(100)
      .optional()
      .transform((value) => Array.from(new Set(value || []))),
    email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
    firstName: z.string().trim().max(120).optional().transform((value) => value || undefined),
    lastName: z.string().trim().max(120).optional().transform((value) => value || undefined),
    roleTitle: z.string().trim().max(160).optional().transform((value) => value || undefined),
  })
  .strict();

const slotSchema = z
  .object({
    endTime: z.string().trim().min(1).max(80),
    employerContactDocumentId: z.string().trim().min(1).max(120).optional(),
    locationDetails: z.string().trim().max(500).optional().transform((value) => value || undefined),
    locationType: locationTypeSchema.default('online'),
    meetingUrl: z.string().trim().url().max(500).optional().or(z.literal('')).transform((value) => value || undefined),
    startTime: z.string().trim().min(1).max(80),
  })
  .strict();

const createInterviewSlotOfferSchema = identitySchema
  .extend({
    capacityClaimDocumentId: z.string().trim().min(1).max(120).optional(),
    candidateDocumentId: z.string().trim().min(1).max(80),
    enrollmentDocumentId: z.string().trim().min(1).max(80),
    internalNote: z.string().trim().max(1000).optional().transform((value) => value || undefined),
    interviewRequestDocumentId: z.string().trim().min(1).max(120).optional(),
    slots: z.array(slotSchema).min(1).max(3),
  })
  .strict();

const interviewDetailSchema = identitySchema
  .extend({
    interviewDocumentId: z.string().trim().min(1).max(120),
  })
  .strict();

const interviewSetupSchema = identitySchema
  .extend({
    arrivalInstructions: z.string().trim().max(2000).optional().transform((value) => value || undefined),
    candidateInstructions: z.string().trim().max(2000).optional().transform((value) => value || undefined),
    employerContactDocumentId: z.string().trim().min(1).max(120).optional(),
    interviewDocumentId: z.string().trim().min(1).max(120),
    interviewerName: z.string().trim().max(160).optional().transform((value) => value || undefined),
    locationDetails: z.string().trim().max(2000).optional().transform((value) => value || undefined),
    locationType: locationTypeSchema,
    meetingUrl: z.string().trim().url().max(500).optional().or(z.literal('')).transform((value) => value || undefined),
  })
  .strict();

const interviewFeedbackOutcomeSchema = z.enum([
  'positive',
  'neutral',
  'negative',
  'progressing',
  'not_progressing',
  'offer_expected',
  'unknown',
]);

const interviewFeedbackDetailSchema = identitySchema
  .extend({
    interviewDocumentId: z.string().trim().min(1).max(120),
  })
  .strict();

const submitInterviewFeedbackSchema = identitySchema
  .extend({
    concerns: z.string().trim().min(1).max(4000),
    interviewDocumentId: z.string().trim().min(1).max(120),
    nextStep: z.string().trim().min(1).max(4000),
    notes: z.string().trim().min(1).max(4000),
    outcome: interviewFeedbackOutcomeSchema,
    previousTakeawayAssessment: z.string().trim().max(4000).optional().transform((value) => value || undefined),
    rating: z.number().int().min(1).max(5),
    strengths: z.string().trim().min(1).max(4000),
  })
  .strict();

const interviewProgressionTypeSchema = z.enum([
  'second_interview',
  'final_interview',
  'practical_task',
  'introductory_call',
  'offer_discussion',
  'other',
]);

const interviewProgressionDetailSchema = identitySchema
  .extend({
    interviewDocumentId: z.string().trim().min(1).max(120),
  })
  .strict();

const submitInterviewProgressionSchema = identitySchema
  .extend({
    candidateMessage: z.string().trim().min(10).max(4000),
    employerContactDocumentId: z.string().trim().min(1).max(120).optional(),
    internalNote: z.string().trim().max(2000).optional().transform((value) => value || undefined),
    interviewDocumentId: z.string().trim().min(1).max(120),
    progressionType: interviewProgressionTypeSchema,
    responseDeadline: z.string().trim().datetime({ offset: true }).optional(),
  })
  .strict();

const inviteInterviewFeedbackContributorSchema = identitySchema
  .extend({
    interviewDocumentId: z.string().trim().min(1).max(120),
    inviteEmail: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
    inviteeName: z.string().trim().max(160).optional().transform((value) => value || undefined),
    inviteeRoleTitle: z.string().trim().max(160).optional().transform((value) => value || undefined),
  })
  .strict();

const revokeInterviewFeedbackInviteSchema = identitySchema
  .extend({
    feedbackInviteDocumentId: z.string().trim().min(1).max(120),
    interviewDocumentId: z.string().trim().min(1).max(120),
    reason: z.string().trim().max(1000).optional().transform((value) => value || undefined),
  })
  .strict();

const feedbackInviteTokenSchema = z
  .object({
    inviteToken: z.string().trim().min(24).max(256),
  })
  .strict();

const submitInvitedInterviewFeedbackSchema = feedbackInviteTokenSchema
  .extend({
    concerns: z.string().trim().min(1).max(4000),
    nextStep: z.string().trim().min(1).max(4000),
    notes: z.string().trim().min(1).max(4000),
    outcome: interviewFeedbackOutcomeSchema,
    previousTakeawayAssessment: z.string().trim().max(4000).optional().transform((value) => value || undefined),
    rating: z.number().int().min(1).max(5),
    strengths: z.string().trim().min(1).max(4000),
    submitterName: z.string().trim().max(160).optional().transform((value) => value || undefined),
    submitterRoleTitle: z.string().trim().max(160).optional().transform((value) => value || undefined),
  })
  .strict();

const capacityClaimDetailSchema = identitySchema
  .extend({
    capacityClaimDocumentId: z.string().trim().min(1).max(120),
  })
  .strict();

const declineCapacityClaimSchema = capacityClaimDetailSchema
  .extend({
    declineNote: z.string().trim().max(1000).optional().transform((value) => value || undefined),
    declineReason: employerDeclineReasonSchema,
  })
  .strict();

const completeOnboardingSchema = identitySchema
  .extend({
    acceptedTerms: z.literal(true),
    acceptedTermsPolicyDocumentId: z.string().trim().min(1).max(120),
    acceptedTermsPolicyVersion: z.string().trim().min(1).max(120),
    commitmentMode: commitmentModeSchema.default('global'),
    companyName: z.string().trim().min(1).max(200),
    contactFirstName: z.string().trim().min(1).max(120),
    contactLastName: z.string().trim().min(1).max(120),
    contactPhone: z.string().trim().max(40).optional().transform((value) => value || undefined),
    contactRoleTitle: z.string().trim().max(160).optional().transform((value) => value || undefined),
    interviewCommitmentCadence: cadenceSchema,
    interviewCommitmentVolume: z.number().int().min(1).max(1000),
    operatingRegionDocumentIds: z
      .array(z.string().trim().min(1).max(120))
      .min(1)
      .max(100)
      .transform((value) => Array.from(new Set(value))),
    teamContacts: z.array(teamContactSchema).max(10).default([]),
  })
  .strict();

const updateSettingsSchema = identitySchema
  .extend({
    commitmentMode: commitmentModeSchema.default('global'),
    companyName: z.string().trim().min(1).max(200),
    coverageConfirmed: z.boolean().default(false),
    coverageRegionDocumentIds: z
      .array(z.string().trim().min(1).max(120))
      .min(1)
      .max(100)
      .transform((value) => Array.from(new Set(value))),
    interviewCommitmentCadence: cadenceSchema,
    interviewCommitmentVolume: z.number().int().min(1).max(1000),
    operatingRegionDocumentIds: z
      .array(z.string().trim().min(1).max(120))
      .min(1)
      .max(100)
      .transform((value) => Array.from(new Set(value))),
    regionCommitments: z.array(regionCommitmentSchema).max(100).default([]),
    reviewNote: z.string().trim().max(1000).optional().transform((value) => value || undefined),
  })
  .strict();

const updateProfileSchema = identitySchema
  .extend({
    firstName: z.string().trim().min(1).max(120),
    lastName: z.string().trim().min(1).max(120),
    phone: z.string().trim().max(40).optional().transform((value) => value || null),
    roleTitle: z.string().trim().max(160).optional().transform((value) => value || null),
  })
  .strict();

const inviteTeamContactSchema = identitySchema
  .extend({
    coverageRegionDocumentIds: z
      .array(z.string().trim().min(1).max(120))
      .min(1)
      .max(100)
      .transform((value) => Array.from(new Set(value))),
    inviteEmail: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
    firstName: z.string().trim().max(120).optional().transform((value) => value || undefined),
    lastName: z.string().trim().max(120).optional().transform((value) => value || undefined),
    roleTitle: z.string().trim().max(160).optional().transform((value) => value || undefined),
  })
  .strict();

const supportCaseCreateSchema = identitySchema
  .extend({
    body: z.string().trim().min(10).max(12000),
    title: z.string().trim().min(3).max(180),
  })
  .strict();

const supportCaseDetailSchema = identitySchema
  .extend({
    supportCaseDocumentId: z.string().trim().min(1).max(120),
  })
  .strict();

const supportCaseReplySchema = supportCaseDetailSchema
  .extend({
    body: z.string().trim().min(1).max(12000),
  })
  .strict();

const inviteTokenSchema = z
  .object({
    inviteToken: z.string().trim().min(24).max(256),
  })
  .strict();

const acceptInviteSchema = inviteTokenSchema
  .extend({
    authIdentityId: z.string().trim().min(1).max(160),
    email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
    name: z.string().trim().max(240).optional().transform((value) => value || undefined),
  })
  .strict();

const validateIdentity = validateZodSchema(identitySchema);
const validateCompleteOnboarding = validateZodSchema(completeOnboardingSchema);
const validateCapacityClaimDetail = validateZodSchema(capacityClaimDetailSchema);
const validateCreateInterviewSlotOffer = validateZodSchema(createInterviewSlotOfferSchema);
const validateInterviewFeedbackDetail = validateZodSchema(interviewFeedbackDetailSchema);
const validateInterviewDetail = validateZodSchema(interviewDetailSchema);
const validateInterviewProgressionDetail = validateZodSchema(interviewProgressionDetailSchema);
const validateInterviewSetup = validateZodSchema(interviewSetupSchema);
const validateInviteInterviewFeedbackContributor = validateZodSchema(inviteInterviewFeedbackContributorSchema);
const validateFeedbackInviteToken = validateZodSchema(feedbackInviteTokenSchema);
const validateRevokeInterviewFeedbackInvite = validateZodSchema(revokeInterviewFeedbackInviteSchema);
const validateSubmitInterviewFeedback = validateZodSchema(submitInterviewFeedbackSchema);
const validateSubmitInterviewProgression = validateZodSchema(submitInterviewProgressionSchema);
const validateSubmitInvitedInterviewFeedback = validateZodSchema(submitInvitedInterviewFeedbackSchema);
const validateDeclineCapacityClaim = validateZodSchema(declineCapacityClaimSchema);
const validateInviteTeamContact = validateZodSchema(inviteTeamContactSchema);
const validateSupportCaseCreate = validateZodSchema(supportCaseCreateSchema);
const validateSupportCaseDetail = validateZodSchema(supportCaseDetailSchema);
const validateSupportCaseReply = validateZodSchema(supportCaseReplySchema);
const validateInviteToken = validateZodSchema(inviteTokenSchema);
const validateAcceptInvite = validateZodSchema(acceptInviteSchema);
const validateUpdateProfile = validateZodSchema(updateProfileSchema);
const validateUpdateSettings = validateZodSchema(updateSettingsSchema);

const documents = (strapi: StrapiDocumentService, uid: string) =>
  strapi.documents(uid) as DocumentCollection;

const auditEvents = (strapi: StrapiDocumentService) =>
  strapi.service('api::audit-event.audit-event') as AuditEventService;
const interviewRequestService = (strapi: StrapiDocumentService) =>
  strapi.service('api::interview-request.interview-request') as InterviewRequestService;
const employerReliabilityEventService = (strapi: StrapiDocumentService) =>
  strapi.service(
    'api::employer-reliability-event.employer-reliability-event'
  ) as EmployerReliabilityEventService;
const supportCaseService = (strapi: StrapiDocumentService) =>
  strapi.service('api::support-case.support-case') as SupportCaseService;

const getDocumentId = (record?: DocumentRecord | null) =>
  typeof record?.documentId === 'string' ? record.documentId : null;

const hashInviteToken = (token: string) => createHash('sha256').update(token).digest('hex');

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

const employerDashboardBaseUrl = () =>
  trimTrailingSlash(process.env.EMPLOYER_DASHBOARD_BASE_URL || 'http://localhost:3004');

const candidateDashboardBaseUrl = () =>
  trimTrailingSlash(process.env.CANDIDATE_DASHBOARD_BASE_URL || 'http://localhost:3001');

const candidateDashboardInterviewsUrl = () =>
  `${candidateDashboardBaseUrl()}/interviews`;

const employerInviteUrl = (token: string) =>
  `${employerDashboardBaseUrl()}/invite/${encodeURIComponent(token)}`;

const employerInviteSetupUrl = (token: string) =>
  `${employerInviteUrl(token)}/setup`;

const interviewFeedbackInviteUrl = (token: string) =>
  `${employerDashboardBaseUrl()}/feedback/invite/${encodeURIComponent(token)}`;

const compact = <T>(items: Array<T | false | null | undefined>) =>
  items.filter((item): item is T => Boolean(item));

const objectValue = (value: unknown) => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
};

const documentRecordValue = (value: unknown) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as DocumentRecord)
    : undefined;

const relationConnect = (record?: unknown) => {
  const documentRecord = documentRecordValue(record);

  return documentRecord?.documentId
    ? {
        connect: [{ documentId: documentRecord.documentId }],
      }
    : undefined;
};

const generateInviteToken = () => randomBytes(32).toString('base64url');

const getIntegerEnv = (key: string, fallback: number) => {
  const value = Number.parseInt(process.env[key] || '', 10);

  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const positiveIntegerValue = (value: unknown, fallback = 0) => {
  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

const boundedSlotCount = (value: unknown, fallback = 3) =>
  Math.min(3, Math.max(1, positiveIntegerValue(value, fallback) || fallback));

const profileImageFormats = ['webp', 'avif'] as const;

const getEmployerProfileImageFormat = () => {
  const configuredFormat = (process.env.EMPLOYER_PROFILE_IMAGE_FORMAT || 'webp').toLowerCase();

  return profileImageFormats.includes(configuredFormat as (typeof profileImageFormats)[number])
    ? (configuredFormat as (typeof profileImageFormats)[number])
    : 'webp';
};

const getEmployerProfileImageMime = (format: (typeof profileImageFormats)[number]) =>
  format === 'avif' ? 'image/avif' : 'image/webp';

const getUploadedFilePath = (file?: UploadedFile) => file?.filepath || file?.path;

const processEmployerProfileImage = async (file?: UploadedFile) => {
  const inputPath = getUploadedFilePath(file);

  if (!inputPath) {
    throw new ValidationError('A profile image file is required.');
  }

  const maxBytes = getIntegerEnv('EMPLOYER_PROFILE_IMAGE_MAX_BYTES', 6 * 1024 * 1024);

  if (file?.size && file.size > maxBytes) {
    throw new ValidationError('Profile image is too large.');
  }

  const format = getEmployerProfileImageFormat();
  const mime = getEmployerProfileImageMime(format);
  const size = getIntegerEnv('EMPLOYER_PROFILE_IMAGE_SIZE', 512);
  const quality = Math.min(
    100,
    Math.max(1, getIntegerEnv('EMPLOYER_PROFILE_IMAGE_QUALITY', format === 'avif' ? 58 : 82))
  );
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'hireflip-employer-profile-image-'));
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

const sanitizeEmployerProfileImage = async (strapi: StrapiDocumentService, profileImage?: DocumentRecord | null) => {
  if (!profileImage) {
    return null;
  }

  const signedProfileImage = await strapi
    .plugin('upload')
    .service('file')
    .signFileUrls(withRecoveredUploadPath(profileImage));

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

const addCalendarDays = (days: number) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
};

const cadencePeriodsPerYear: Record<string, number> = {
  annually: 1,
  biannually: 2,
  quarterly: 4,
};

const annualizedCommitment = (volume?: number | null, cadence?: string | null) =>
  typeof volume === 'number' && volume > 0 ? volume * (cadencePeriodsPerYear[String(cadence)] || 0) : 0;

const activeRegionCommitments = (employer?: DocumentRecord | null) =>
  (Array.isArray(employer?.regionCommitments) ? employer.regionCommitments : []).filter(
    (commitment) => commitment.commitmentState !== 'archived'
  );

const employerAnnualizedCommitment = (employer?: DocumentRecord | null) => {
  const activeCommitments = activeRegionCommitments(employer);

  if (employer?.commitmentMode === 'per_region' && activeCommitments.length > 0) {
    return activeCommitments.reduce(
      (total, commitment) =>
        total +
        annualizedCommitment(
          commitment.interviewCommitmentVolume,
          commitment.interviewCommitmentCadence
        ),
      0
    );
  }

  return annualizedCommitment(
    employer?.interviewCommitmentVolume,
    employer?.interviewCommitmentCadence
  );
};

const requestedSettingsAnnualizedCommitment = (
  body: z.infer<typeof updateSettingsSchema>
) => {
  if (body.commitmentMode === 'per_region') {
    const commitments = body.regionCommitments.length
      ? body.regionCommitments
      : body.operatingRegionDocumentIds.map((regionDocumentId) => ({
          interviewCommitmentCadence: body.interviewCommitmentCadence,
          interviewCommitmentVolume: body.interviewCommitmentVolume,
          regionDocumentId,
        }));

    return commitments.reduce(
      (total, commitment) =>
        total +
        annualizedCommitment(
          commitment.interviewCommitmentVolume,
          commitment.interviewCommitmentCadence
        ),
      0
    );
  }

  return annualizedCommitment(
    body.interviewCommitmentVolume,
    body.interviewCommitmentCadence
  );
};

const formatDateTime = (value?: string | null) => {
  if (!value) {
    return 'Not recorded';
  }

  const timestamp = Date.parse(value);

  if (Number.isNaN(timestamp)) {
    return 'Not recorded';
  }

  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(timestamp));
};

const formatDate = (value?: string | null) => {
  if (!value) {
    return 'Not recorded';
  }

  const timestamp = Date.parse(value);

  if (Number.isNaN(timestamp)) {
    return 'Not recorded';
  }

  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(timestamp));
};

const humanize = (value?: string | null) =>
  String(value || 'not recorded')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const contactDisplayName = (contact: DocumentRecord) =>
  compact([contact.firstName, contact.lastName]).join(' ') ||
  contact.email ||
  'Employer contact';

const firstNameFrom = (value?: string | null) => {
  const name = String(value || '').trim();

  if (!name) {
    return null;
  }

  return name.split(/\s+/)[0] || null;
};

const candidateDisplayName = (candidate?: DocumentRecord | null) =>
  compact([candidate?.firstName, candidate?.lastName]).join(' ') ||
  candidate?.email ||
  'Candidate';

const commitmentLabel = (employer?: DocumentRecord | null) => {
  const volume = employer?.interviewCommitmentVolume;
  const cadence = employer?.interviewCommitmentCadence;

  if (typeof volume !== 'number' || volume <= 0) {
    return null;
  }

  return `${volume} interview${volume === 1 ? '' : 's'} per ${humanize(String(cadence || 'cadence')).toLowerCase()}`;
};

const splitPolicyBodyIntoParagraphs = (body?: string) =>
  (body || '')
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean);

const sanitizePolicyDocument = (policyDocument?: DocumentRecord | null) => {
  if (!policyDocument) {
    return null;
  }

  return {
    acceptanceLabel: policyDocument.acceptanceLabel || null,
    documentId: getDocumentId(policyDocument) || String(policyDocument.id || ''),
    introCopy: policyDocument.introCopy || null,
    paragraphs: splitPolicyBodyIntoParagraphs(policyDocument.body),
    policyType: policyDocument.policyType || null,
    title: policyDocument.title || 'Employer terms',
    version: policyDocument.version || null,
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

  return policyDocuments[0] || null;
};

const locationLabel = (record: DocumentRecord) => {
  if (record.locationType === 'online') {
    return record.meetingUrl ? 'Online meeting link recorded' : 'Online';
  }

  if (record.locationType === 'in_person') {
    return record.locationDetails || 'In person';
  }

  if (record.locationType === 'phone') {
    return 'Phone';
  }

  return 'To be confirmed';
};

const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

const interviewFeedbackDeadline = (interview: DocumentRecord) =>
  addDays(interview.completedAt ? new Date(interview.completedAt) : new Date(), 7).toISOString();

const additionalFeedbackInviteDeadline = (interview: DocumentRecord) => {
  const mainDeadline = new Date(interviewFeedbackDeadline(interview));
  const inviteDeadline = addWorkingDays(new Date(), getIntegerEnv('EMPLOYER_ADDITIONAL_FEEDBACK_INVITE_WORKING_DAYS', 3));

  return new Date(Math.min(mainDeadline.getTime(), inviteDeadline.getTime())).toISOString();
};

const isWeekend = (date: Date) => {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
};

const addWorkingDays = (date: Date, days: number) => {
  const next = new Date(date);
  let remaining = days;

  while (remaining > 0) {
    next.setUTCDate(next.getUTCDate() + 1);

    if (!isWeekend(next)) {
      remaining -= 1;
    }
  }

  return next;
};

const londonDatePartsFormatter = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  hour: '2-digit',
  hour12: false,
  minute: '2-digit',
  month: '2-digit',
  timeZone: 'Europe/London',
  weekday: 'short',
  year: 'numeric',
});

const londonDateParts = (date: Date) =>
  Object.fromEntries(
    londonDatePartsFormatter
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  ) as Record<string, string>;

const localBusinessMinutes = (parts: Record<string, string>) =>
  Number.parseInt(parts.hour || '0', 10) * 60 + Number.parseInt(parts.minute || '0', 10);

const assertBusinessHoursSlot = (startTime: Date, endTime: Date) => {
  const start = londonDateParts(startTime);
  const end = londonDateParts(endTime);
  const weekday = start.weekday;
  const sameLocalDay =
    start.year === end.year && start.month === end.month && start.day === end.day;

  if (weekday === 'Sat' || weekday === 'Sun') {
    throw new ValidationError('Interview slots must be on working days.');
  }

  if (!sameLocalDay) {
    throw new ValidationError('Interview slots must start and end on the same working day.');
  }

  if (localBusinessMinutes(start) < 9 * 60 || localBusinessMinutes(end) > 17 * 60) {
    throw new ValidationError('Interview slots must be within business hours, 09:00 to 17:00.');
  }
};

const assertIsoDate = (value: string, message: string) => {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new ValidationError(message);
  }

  return date;
};

const employerContactFilters = (identity: { authIdentityId?: string; email?: string }) => {
  const filters = compact([
    identity.authIdentityId ? { authIdentityId: identity.authIdentityId } : null,
    identity.email ? { email: identity.email } : null,
  ]);

  return filters.length === 1 ? filters[0] : { $or: filters };
};

const findEmployerContact = async (
  strapi: StrapiDocumentService,
  identity: { authIdentityId?: string; email?: string }
) => {
  const contacts = await documents(strapi, 'api::employer-contact.employer-contact').findMany({
    filters: employerContactFilters(identity),
    limit: 1,
    populate: {
      coverageRegions: true,
      profileImage: true,
      employer: {
        populate: {
          contacts: {
            populate: ['coverageRegions', 'profileImage'],
          },
          operatingRegions: true,
          regionCommitments: {
            populate: ['region'],
          },
        },
      },
    },
  });

  const contact = contacts[0];

  if (!contact || !contact.employer) {
    throw new ValidationError('Employer contact could not be found.');
  }

  if (contact.contactState !== 'active') {
    throw new ValidationError('Employer contact is not active.');
  }

  if (
    identity.authIdentityId &&
    contact.authIdentityId &&
    contact.authIdentityId !== identity.authIdentityId
  ) {
    throw new ValidationError('Employer contact is linked to another Auth0 account.');
  }

  return contact;
};

const findDocumentById = async (
  strapi: StrapiDocumentService,
  uid: string,
  documentId: string,
  populate?: unknown
) => {
  const records = await documents(strapi, uid).findMany({
    filters: {
      documentId,
    },
    limit: 1,
    ...(populate ? { populate } : {}),
  });

  return records[0] || null;
};

const getOperationalClassAreas = async (strapi: StrapiDocumentService) => {
  const classAreas = await documents(strapi, 'api::class-area.class-area').findMany({
    limit: 500,
    sort: ['sortOrder:asc', 'name:asc'],
  });

  return classAreas.filter((classArea) => String(classArea.state) === 'active');
};

const assertOperationalRegionsByDocumentId = async (
  strapi: StrapiDocumentService,
  documentIds: string[]
) => {
  const classAreas = await getOperationalClassAreas(strapi);
  const classAreasByDocumentId = new Map(
    classAreas.map((classArea) => [getDocumentId(classArea), classArea])
  );
  const regions = documentIds.map((documentId) => classAreasByDocumentId.get(documentId) || null);

  if (classAreas.length === 0) {
    throw new ValidationError('At least one active HireFlip operating area is required before onboarding employers.');
  }

  if (regions.some((region) => !region)) {
    throw new ValidationError('Operating regions must match current HireFlip operating areas.');
  }

  return regions.filter((region): region is DocumentRecord => Boolean(region));
};

const regionConnectPayload = (regions: DocumentRecord[]) =>
  regions
    .map((region) => getDocumentId(region))
    .filter((documentId): documentId is string => Boolean(documentId))
    .map((documentId) => ({ documentId }));

const regionSetRelationData = (regions: DocumentRecord[]) => ({
  set: regionConnectPayload(regions),
});

const publicClassAreaOption = (classArea: DocumentRecord) => ({
  documentId: getDocumentId(classArea) || String(classArea.id || ''),
  label: classArea.name || 'Region',
  name: classArea.name || null,
  slug: classArea.slug || null,
  state: classArea.state || 'active',
});

const publicRegionOptions = (regions?: DocumentRecord[] | null) =>
  (Array.isArray(regions) ? regions : [])
    .map(publicClassAreaOption)
    .filter((region) => Boolean(region.name || region.label));

const legacyRegionOption = (region?: unknown) => {
  const label = String(region || '').trim();

  if (!label) {
    return null;
  }

  return {
    documentId: '',
    label,
    name: label,
    slug: null,
    state: 'legacy',
  };
};

const employerRegions = (employer?: DocumentRecord | null) => {
  const regions = publicRegionOptions(employer?.operatingRegions);
  const fallback = legacyRegionOption(employer?.region);

  return regions.length ? regions : fallback ? [fallback] : [];
};

const regionNames = (regions: Array<{ label?: unknown; name?: unknown }>) =>
  regions.map((region) => String(region.name || region.label || '').trim()).filter(Boolean);

const regionLabel = (regions: Array<{ label?: unknown; name?: unknown }>) =>
  regionNames(regions).join(', ') || null;

const regionDocumentIds = (regions?: DocumentRecord[] | null) =>
  (Array.isArray(regions) ? regions : [])
    .map((region) => getDocumentId(region))
    .filter((documentId): documentId is string => Boolean(documentId));

const coverageStatus = (employer?: DocumentRecord | null) => {
  const regions = employerRegions(employer);
  const operatingRegionIds = regionDocumentIds(employer?.operatingRegions);
  const operatingRegionsById = new Map(
    regions
      .map((region): [string, typeof region] | null =>
        region.documentId ? [region.documentId, region] : null
      )
      .filter((entry): entry is [string, typeof regions[number]] => Boolean(entry))
  );
  const contacts = Array.isArray(employer?.contacts) ? employer.contacts : [];
  const activeContacts = contacts.filter((contact) =>
    ['active'].includes(String(contact.contactState || ''))
  );
  const coveredRegionIds = new Set<string>();

  for (const contact of activeContacts) {
    for (const documentId of regionDocumentIds(contact.coverageRegions)) {
      coveredRegionIds.add(documentId);
    }
  }

  const uncoveredRegionIds = operatingRegionIds.filter((documentId) => !coveredRegionIds.has(documentId));
  const uncoveredRegions = uncoveredRegionIds
    .map((documentId) => operatingRegionsById.get(documentId))
    .filter((region): region is typeof regions[number] => Boolean(region));
  const overrideActive = Boolean(employer?.interviewCoverageOverrideAt);

  return {
    coveredRegionNames: regionNames(
      operatingRegionIds
        .filter((documentId) => coveredRegionIds.has(documentId))
        .map((documentId) => operatingRegionsById.get(documentId))
        .filter(Boolean) as Array<{ label?: unknown; name?: unknown }>
    ),
    gateOpen: uncoveredRegionIds.length === 0 || overrideActive,
    isComplete: uncoveredRegionIds.length === 0,
    override: {
      active: overrideActive,
      at: employer?.interviewCoverageOverrideAt || null,
      byEmail: employer?.interviewCoverageOverrideByEmail || null,
      byName: employer?.interviewCoverageOverrideByName || null,
      reason: employer?.interviewCoverageOverrideReason || null,
    },
    uncoveredRegionDocumentIds: uncoveredRegionIds,
    uncoveredRegionNames: regionNames(uncoveredRegions),
    uncoveredRegions,
  };
};

const publicRegionCommitment = (commitment: DocumentRecord) => {
  const region =
    commitment.region && typeof commitment.region === 'object'
      ? (commitment.region as DocumentRecord)
      : null;

  return {
    cadence: commitment.interviewCommitmentCadence || 'quarterly',
    documentId: getDocumentId(commitment) || String(commitment.id || ''),
    label: commitmentLabel({
      interviewCommitmentCadence: commitment.interviewCommitmentCadence,
      interviewCommitmentVolume: commitment.interviewCommitmentVolume,
    }),
    region: region ? publicClassAreaOption(region) : null,
    state: commitment.commitmentState || 'active',
    volume: commitment.interviewCommitmentVolume || null,
  };
};

const clearReliabilitySummary = {
  latestEventAt: null,
  recentEvents: [],
  state: 'clear',
  strikeCount: 0,
  warningCount: 0,
};

const employerReliabilitySummary = async (
  strapi: StrapiDocumentService,
  employerDocumentId?: string | null
) => {
  if (!employerDocumentId) {
    return clearReliabilitySummary;
  }

  try {
    return await employerReliabilityEventService(strapi).summaryForEmployer(employerDocumentId);
  } catch {
    return clearReliabilitySummary;
  }
};

const cadenceWindow = (cadence?: string | null, now = new Date()) => {
  const cadenceValue = String(cadence || '').toLowerCase();
  const months = cadenceValue === 'annually' ? 12 : cadenceValue === 'biannually' ? 6 : 3;
  const currentMonth = now.getUTCMonth();
  const startMonth = Math.floor(currentMonth / months) * months;
  const start = new Date(Date.UTC(now.getUTCFullYear(), startMonth, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(now.getUTCFullYear(), startMonth + months, 0, 23, 59, 59, 999));
  const startIso = start.toISOString();
  const endIso = end.toISOString();

  return {
    end: endIso,
    endLabel: formatDate(endIso),
    label: `${formatDate(startIso)} - ${formatDate(endIso)}`,
    start: startIso,
    startLabel: formatDate(startIso),
  };
};

const commitmentCapacity = (employer?: DocumentRecord | null) => {
  const commitments = activeRegionCommitments(employer);

  if (employer?.commitmentMode === 'per_region' && commitments.length > 0) {
    return commitments.reduce(
      (total, commitment) => total + positiveIntegerValue(commitment.interviewCommitmentVolume),
      0
    );
  }

  return positiveIntegerValue(employer?.interviewCommitmentVolume);
};

const buildCommitmentWindowSummary = ({
  capacityClaims,
  completedInterviews,
  employer,
  scheduledInterviews,
}: {
  capacityClaims: DocumentRecord[];
  completedInterviews: DocumentRecord[];
  employer?: DocumentRecord | null;
  scheduledInterviews: DocumentRecord[];
}) => {
  const commitments = activeRegionCommitments(employer);
  const committed = commitmentCapacity(employer);
  const claimed = capacityClaims.reduce(
    (total, claim) => total + positiveIntegerValue(claim.claimCount, 1),
    0
  );
  const scheduled = scheduledInterviews.length;
  const completed = completedInterviews.length;
  const cadence =
    employer?.interviewCommitmentCadence ||
    commitments.find((commitment) => commitment.interviewCommitmentCadence)?.interviewCommitmentCadence ||
    'not_set';
  const window = cadenceWindow(String(cadence));
  const claimsByRegion = capacityClaims.reduce((map, claim) => {
    const regionDocumentId = getDocumentId(documentRecordValue(claim.region));

    if (!regionDocumentId) {
      return map;
    }

    map.set(regionDocumentId, (map.get(regionDocumentId) || 0) + positiveIntegerValue(claim.claimCount, 1));
    return map;
  }, new Map<string, number>());
  const regionBreakdown =
    employer?.commitmentMode === 'per_region'
      ? commitments
          .map((commitment) => {
            const region = documentRecordValue(commitment.region);
            const regionDocumentId = getDocumentId(region);
            const regionCommitted = positiveIntegerValue(commitment.interviewCommitmentVolume);
            const regionClaimed = regionDocumentId ? claimsByRegion.get(regionDocumentId) || 0 : 0;
            const regionLabel =
              (region ? publicClassAreaOption(region).label : null) || 'Region not recorded';

            return {
              claimed: regionClaimed,
              committed: regionCommitted,
              label: regionLabel,
              remaining: Math.max(0, regionCommitted - regionClaimed),
            };
          })
          .filter((region) => region.committed > 0 || region.claimed > 0)
      : [];

  return {
    cadenceLabel: humanize(String(cadence || 'not_set')),
    claimed,
    committed,
    completed,
    regionBreakdown,
    remaining: Math.max(0, committed - claimed - scheduled - completed),
    scheduled,
    windowEnd: window.end,
    windowEndLabel: window.endLabel,
    windowLabel: window.label,
    windowStart: window.start,
    windowStartLabel: window.startLabel,
  };
};

const publicContactPayload = async (strapi: StrapiDocumentService, contact: DocumentRecord) => ({
  contactState: contact.contactState || 'listed',
  contactStateLabel: humanize(String(contact.contactState || 'listed')),
  contactRole: contact.contactRole || 'team_contact',
  contactRoleLabel: humanize(String(contact.contactRole || 'team_contact')),
  coverageConfirmedAt: contact.coverageConfirmedAt || null,
  coverageConfirmedByEmail: contact.coverageConfirmedByEmail || null,
  coverageRegionNames: regionNames(publicRegionOptions(contact.coverageRegions)),
  coverageRegions: publicRegionOptions(contact.coverageRegions),
  documentId: getDocumentId(contact) || String(contact.id || ''),
  email: contact.email || null,
  firstName: contact.firstName || null,
  lastName: contact.lastName || null,
  name: contactDisplayName(contact),
  phone: contact.phone || null,
  profileImage: await sanitizeEmployerProfileImage(strapi, contact.profileImage),
  roleTitle: contact.roleTitle || null,
});

const dashboardOnboardingState = (employer?: DocumentRecord | null) => {
  if (employer?.dashboardOnboardingState) {
    return String(employer.dashboardOnboardingState);
  }

  if (employer?.dashboardOnboardingCompletedAt && employer?.employerTermsAcceptedAt) {
    return 'complete';
  }

  return 'not_started';
};

const isDashboardOnboardingComplete = (employer?: DocumentRecord | null) =>
  dashboardOnboardingState(employer) === 'complete' &&
  Boolean(employer?.dashboardOnboardingCompletedAt) &&
  Boolean(employer?.employerTermsAcceptedAt);

const onboardingCurrentStep = (contact: DocumentRecord) => {
  const employer = contact.employer;

  if (isDashboardOnboardingComplete(employer)) {
    return 'complete';
  }

  if (!contact.firstName || !contact.lastName) {
    return 'lead_contact';
  }

  if (!employer?.companyName || employerRegions(employer).length === 0) {
    return 'company_profile';
  }

  if (!commitmentLabel(employer)) {
    return 'commitment';
  }

  return 'terms';
};

const onboardingPayload = async (
  strapi: StrapiDocumentService,
  contact: DocumentRecord,
  {
    availableRegions = [],
    termsPolicy = null,
  }: {
    availableRegions?: DocumentRecord[];
    termsPolicy?: DocumentRecord | null;
  } = {}
) => {
  const employer = contact.employer;
  const regions = employerRegions(employer);
  const contacts = Array.isArray(employer?.contacts) ? employer.contacts : [];
  const teamContacts = await Promise.all(
    contacts
      .filter((teamContact) => getDocumentId(teamContact) !== getDocumentId(contact))
      .filter((teamContact) => !['archived', 'disabled'].includes(String(teamContact.contactState || '')))
      .map((teamContact) => publicContactPayload(strapi, teamContact))
  );

  return {
    availableRegions: publicRegionOptions(availableRegions),
    coverage: coverageStatus(employer),
    commitment: {
      cadence: employer?.interviewCommitmentCadence || employer?.initialInterviewCommitmentCadence || 'not_set',
      label: commitmentLabel(employer),
      mode: employer?.commitmentMode || 'global',
      regionCommitments: (Array.isArray(employer?.regionCommitments)
        ? employer.regionCommitments
        : [])
        .filter((commitment) => commitment.commitmentState !== 'archived')
        .map(publicRegionCommitment),
      volume: employer?.interviewCommitmentVolume || employer?.initialInterviewCommitmentVolume || null,
    },
    company: {
      documentId: getDocumentId(employer) || String(employer?.id || ''),
      name: employer?.companyName || null,
      operatingRegionDocumentIds: regions.map((region) => region.documentId).filter(Boolean),
      regionNames: regionNames(regions),
      regions,
    },
    completedAt: employer?.dashboardOnboardingCompletedAt || null,
    currentStep: onboardingCurrentStep(contact),
    isComplete: isDashboardOnboardingComplete(employer),
    leadContact: await publicContactPayload(strapi, contact),
    state: dashboardOnboardingState(employer),
    teamContacts,
    terms: {
      acceptedAt: employer?.employerTermsAcceptedAt || null,
      acceptedByEmail: employer?.employerTermsAcceptedByEmail || null,
      acceptedPolicyDocumentId: employer?.employerTermsPolicyDocumentId || null,
      acceptedPolicyVersion: employer?.employerTermsPolicyVersion || null,
      policy: sanitizePolicyDocument(termsPolicy),
    },
  };
};

const accountPayload = async (strapi: StrapiDocumentService, contact: DocumentRecord) => {
  const employer = contact.employer;
  const regions = employerRegions(employer);
  const regionsLabel = regionLabel(regions);
  const contacts = Array.isArray(employer?.contacts) ? employer.contacts : [];
  const employerDocumentId = getDocumentId(employer);
  const publicContacts = await Promise.all(
    contacts
      .filter((teamContact) => !['archived', 'disabled'].includes(String(teamContact.contactState || '')))
      .map((teamContact) => publicContactPayload(strapi, teamContact))
  );

  return {
    assignmentModeLabel: humanize(String(employer?.assignmentMode || 'automatic')),
    cadenceLabel: humanize(String(employer?.interviewCommitmentCadence || 'not_set')),
    commitment: {
      cadence: employer?.interviewCommitmentCadence || 'not_set',
      label: commitmentLabel(employer),
      mode: employer?.commitmentMode || 'global',
      regionCommitments: (Array.isArray(employer?.regionCommitments)
        ? employer.regionCommitments
        : [])
        .filter((commitment) => commitment.commitmentState !== 'archived')
        .map(publicRegionCommitment),
      volume: employer?.interviewCommitmentVolume || null,
    },
    commitmentLabel: commitmentLabel(employer),
    companyName: employer?.companyName || 'Employer dashboard',
    contactEmail: contact.email || 'Not recorded',
    contactName: contactDisplayName(contact),
    contactRole: contact.contactRole || 'team_contact',
    contacts: publicContacts,
    coverage: coverageStatus(employer),
    leadContact: await publicContactPayload(strapi, contact),
    onboarding: await onboardingPayload(strapi, contact),
    reliability: await employerReliabilitySummary(strapi, employerDocumentId),
    region: regionsLabel,
    regionNames: regionNames(regions),
    regions,
    statusLabel: humanize(String(employer?.employerState || contact.contactState || 'not_connected')),
  };
};

const publicInvitePayload = (invite: DocumentRecord) => {
  const regions = employerRegions(invite.employer);
  const regionsLabel = regionLabel(regions);

  return {
    companyName: invite.employer?.companyName || 'Employer',
    contactEmail: invite.inviteEmail || invite.employerContact?.email || null,
    contactName: contactDisplayName(invite.employerContact || {}),
    createdByFirstName: firstNameFrom(invite.createdByStaffDisplayName) || 'HireFlip',
    employerState: invite.employer?.employerState || null,
    expiresAt: invite.expiresAt || null,
    inviteState: invite.inviteState || 'pending',
    region: regionsLabel,
    regionNames: regionNames(regions),
    regions,
    roleTitle: invite.employerContact?.roleTitle || null,
  };
};

const invitePopulate = {
  employer: {
    populate: ['operatingRegions'],
  },
  employerContact: true,
};

const requestNotificationServiceEmail = async ({
  correlationId,
  template,
  to,
  type,
}: {
  correlationId?: string;
  template: {
    key: string;
    variables?: Record<string, unknown>;
  };
  to: string;
  type: string;
}) => {
  const baseUrl = process.env.NOTIFICATION_SERVICE_URL;
  const serviceToken = process.env.NOTIFICATION_SERVICE_TOKEN;

  if (!baseUrl || !serviceToken) {
    throw new Error('Notification service is not configured.');
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
        priority: 'transactional',
        source: 'core-api',
        template,
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
    const payload = (await response.json().catch(() => null)) as
      | { data?: { jobId?: string | number; queued?: boolean; type?: string } }
      | null;

    if (!response.ok || !payload?.data) {
      throw new Error('Employer invite notification could not be queued.');
    }

    return payload;
  } finally {
    clearTimeout(timeout);
  }
};

const aiFeedbackReportResponseSchema = z
  .object({
    data: z.object({
      metadata: z.record(z.string(), z.unknown()).optional(),
      model: z.string().min(1),
      promptVersion: z.string().min(1),
      provider: z.string().min(1),
      report: z.object({
        conclusion: z.string().min(1),
        improvements: z.string().min(1),
        intro: z.string().min(1),
        strengths: z.string().min(1),
        takeaways: z.array(z.string().min(1)).length(3),
      }),
    }),
  })
  .strict();

type AiFeedbackReportResponse = z.infer<typeof aiFeedbackReportResponseSchema>['data'];

class AiFeedbackReportGenerationError extends Error {
  category: 'configuration' | 'input' | 'provider' | 'service_unavailable' | 'timeout' | 'validation' | 'unknown';
  status?: number;
  transient: boolean;

  constructor(
    message: string,
    {
      category = 'unknown',
      status,
      transient = false,
    }: {
      category?: AiFeedbackReportGenerationError['category'];
      status?: number;
      transient?: boolean;
    } = {}
  ) {
    super(message);
    this.name = 'AiFeedbackReportGenerationError';
    this.category = category;
    this.status = status;
    this.transient = transient;
  }
}

const aiFeedbackRetryDelaysMs = [
  5 * 60 * 1000,
  30 * 60 * 1000,
  2 * 60 * 60 * 1000,
];
const aiFeedbackMaxAttempts = () =>
  getIntegerEnv('AI_FEEDBACK_REPORT_MAX_ATTEMPTS', aiFeedbackRetryDelaysMs.length);

const getAiMonthlySpendLimitGbp = async (strapi: StrapiDocumentService) => {
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

const aiFeedbackFailure = (error: unknown) => {
  if (error instanceof AiFeedbackReportGenerationError) {
    return {
      category: error.category,
      message: error.message,
      status: error.status,
      transient: error.transient,
    };
  }

  return {
    category: 'unknown' as const,
    message: error instanceof Error ? error.message : 'AI feedback report generation failed.',
    status: undefined,
    transient: false,
  };
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
    throw new AiFeedbackReportGenerationError('AI service is not configured.', {
      category: 'configuration',
      transient: false,
    });
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
      const responseError =
        responseBody && typeof responseBody === 'object' && 'error' in responseBody
          ? String((responseBody as { error?: unknown }).error || '')
          : '';
      const status = response.status;
      const category =
        status === 401 || status === 403
          ? 'configuration'
          : status === 400
            ? 'input'
            : !parsed.success
              ? 'validation'
              : status >= 500
                ? 'service_unavailable'
                : 'provider';
      const transient = status === 408 || status === 429 || status >= 500 || !parsed.success;

      throw new AiFeedbackReportGenerationError(
        responseError || 'AI service could not generate a valid feedback report.',
        {
          category,
          status,
          transient,
        }
      );
    }

    return parsed.data.data;
  } catch (error) {
    if (error instanceof AiFeedbackReportGenerationError) {
      throw error;
    }

    if (
      error &&
      typeof error === 'object' &&
      'name' in error &&
      String((error as { name?: unknown }).name) === 'AbortError'
    ) {
      throw new AiFeedbackReportGenerationError('AI service request timed out.', {
        category: 'timeout',
        transient: true,
      });
    }

    throw new AiFeedbackReportGenerationError(
      error instanceof Error ? error.message : 'AI service request failed.',
      {
        category: 'service_unavailable',
        transient: true,
      }
    );
  } finally {
    clearTimeout(timeout);
  }
};

const createEmployerInviteNotificationEvent = async (
  strapi: StrapiDocumentService,
  {
    deliveryState,
    errorMessage,
    eventType,
    invite,
    jobId,
  }: {
    deliveryState: 'queued' | 'failed';
    errorMessage?: string;
    eventType: string;
    invite: DocumentRecord;
    jobId?: string | number;
  }
) => {
  const employerDocumentId = getDocumentId(invite.employer);
  const inviteDocumentId = getDocumentId(invite);
  const contactDocumentId = getDocumentId(invite.employerContact);
  const now = new Date().toISOString();

  return documents(strapi, 'api::notification-event.notification-event').create({
    data: {
      channel: 'email',
      deliveryState,
      ...(deliveryState === 'failed' ? { failedAt: now } : {}),
      errorMessage: errorMessage || null,
      eventType,
      ...(employerDocumentId
        ? {
            employer: {
              connect: [{ documentId: employerDocumentId }],
            },
          }
        : {}),
      metadata: {
        notificationServiceJobId: typeof jobId === 'undefined' ? null : String(jobId),
      },
      priority: deliveryState === 'failed' ? 'high' : 'normal',
      recipientEmail: invite.inviteEmail || invite.employerContact?.email || null,
      recipientId: contactDocumentId || undefined,
      recipientType: 'employer_contact',
      relatedId: inviteDocumentId || undefined,
      relatedType: 'employer_invite',
      templateKey: 'employer_invite',
    },
  });
};

const queueEmployerInviteEmail = async (
  strapi: StrapiDocumentService,
  {
    eventType,
    invite,
    rawToken,
  }: {
    eventType: 'employer_invite_created' | 'employer_invite_resent';
    invite: DocumentRecord;
    rawToken: string;
  }
) => {
  const inviteDocumentId = getDocumentId(invite);
  const contact = invite.employerContact || {};
  const email = String(invite.inviteEmail || contact.email || '').trim().toLowerCase();
  const now = new Date().toISOString();

  if (!inviteDocumentId) {
    throw new ValidationError('Employer invite could not be updated.');
  }

  if (!email) {
    throw new ValidationError('Employer invite is missing an email address.');
  }

  try {
    const response = await requestNotificationServiceEmail({
      correlationId: `employer-team-invite:${inviteDocumentId}:${Date.now()}`,
      template: {
        key: 'employer_invite',
        variables: {
          companyName: invite.employer?.companyName || 'your company',
          contactFirstName: contact.firstName || undefined,
          expiresAt: invite.expiresAt || undefined,
          inviteUrl: employerInviteSetupUrl(rawToken),
          reviewInviteUrl: employerInviteUrl(rawToken),
        },
      },
      to: email,
      type: eventType,
    });
    const jobId = response.data?.jobId;

    await createEmployerInviteNotificationEvent(strapi, {
      deliveryState: 'queued',
      eventType,
      invite,
      jobId,
    });

    return documents(strapi, 'api::employer-invite.employer-invite').update({
      documentId: inviteDocumentId,
      data: {
        deliveryFailureMessage: null,
        deliveryState: 'queued',
        lastSentAt: now,
        notificationServiceJobId: typeof jobId === 'undefined' ? null : String(jobId),
      },
      populate: invitePopulate,
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Employer invite notification could not be queued.';

    await createEmployerInviteNotificationEvent(strapi, {
      deliveryState: 'failed',
      errorMessage,
      eventType,
      invite,
    });

    return documents(strapi, 'api::employer-invite.employer-invite').update({
      documentId: inviteDocumentId,
      data: {
        deliveryFailureMessage: errorMessage,
        deliveryState: 'failed',
        lastSentAt: null,
        notificationServiceJobId: null,
      },
      populate: invitePopulate,
    });
  }
};

const createInterviewFeedbackInviteNotificationEvent = async (
  strapi: StrapiDocumentService,
  {
    deliveryState,
    errorMessage,
    eventType,
    invite,
    jobId,
  }: {
    deliveryState: 'queued' | 'failed';
    errorMessage?: string;
    eventType: string;
    invite: DocumentRecord;
    jobId?: string | number;
  }
) => {
  const employerDocumentId = getDocumentId(invite.employer);
  const inviteDocumentId = getDocumentId(invite);
  const interviewDocumentId = getDocumentId(invite.interview);
  const now = new Date().toISOString();

  return documents(strapi, 'api::notification-event.notification-event').create({
    data: {
      channel: 'email',
      deliveryState,
      ...(deliveryState === 'failed' ? { failedAt: now } : {}),
      errorMessage: errorMessage || null,
      eventType,
      ...(employerDocumentId
        ? {
            employer: {
              connect: [{ documentId: employerDocumentId }],
            },
          }
        : {}),
      ...(interviewDocumentId
        ? {
            interview: {
              connect: [{ documentId: interviewDocumentId }],
            },
          }
        : {}),
      metadata: {
        notificationServiceJobId: typeof jobId === 'undefined' ? null : String(jobId),
      },
      priority: deliveryState === 'failed' ? 'high' : 'normal',
      recipientEmail: invite.inviteEmail || null,
      recipientId: inviteDocumentId || undefined,
      recipientType: 'other',
      relatedId: inviteDocumentId || undefined,
      relatedType: 'interview_feedback_invite',
      templateKey: 'employer_interview_feedback_invite',
    },
  });
};

const queueInterviewFeedbackInviteEmail = async (
  strapi: StrapiDocumentService,
  {
    invite,
    rawToken,
  }: {
    invite: DocumentRecord;
    rawToken: string;
  }
) => {
  const inviteDocumentId = getDocumentId(invite);
  const email = String(invite.inviteEmail || '').trim().toLowerCase();
  const now = new Date().toISOString();
  const interview = documentRecordValue(invite.interview) || {};
  const employer = documentRecordValue(invite.employer || interview.employer) || {};
  const createdBy = documentRecordValue(invite.createdByEmployerContact) || {};

  if (!inviteDocumentId) {
    throw new ValidationError('Feedback invite could not be updated.');
  }

  if (!email) {
    throw new ValidationError('Feedback invite is missing an email address.');
  }

  try {
    const response = await requestNotificationServiceEmail({
      correlationId: `interview-feedback-invite:${inviteDocumentId}:${Date.now()}`,
      template: {
        key: 'employer_interview_feedback_invite',
        variables: {
          candidateName: candidateDisplayName(interview.candidate),
          companyName: employer.companyName || 'the employer',
          createdByName: contactDisplayName(createdBy),
          expiresAt: invite.expiresAt || undefined,
          feedbackUrl: interviewFeedbackInviteUrl(rawToken),
          inviteeName: invite.inviteeName || undefined,
          interviewLabel: formatDateTime(interview.scheduledStartTime || interview.completedAt),
        },
      },
      to: email,
      type: 'employer_interview_feedback_invite',
    });
    const jobId = response.data?.jobId;

    await createInterviewFeedbackInviteNotificationEvent(strapi, {
      deliveryState: 'queued',
      eventType: 'employer_interview_feedback_invite',
      invite,
      jobId,
    });

    return documents(strapi, 'api::interview-feedback-invite.interview-feedback-invite').update({
      documentId: inviteDocumentId,
      data: {
        deliveryFailureMessage: null,
        deliveryState: 'queued',
        lastSentAt: now,
        notificationServiceJobId: typeof jobId === 'undefined' ? null : String(jobId),
      },
      populate: feedbackInvitePopulate,
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Feedback invite notification could not be queued.';

    await createInterviewFeedbackInviteNotificationEvent(strapi, {
      deliveryState: 'failed',
      errorMessage,
      eventType: 'employer_interview_feedback_invite',
      invite,
    });

    return documents(strapi, 'api::interview-feedback-invite.interview-feedback-invite').update({
      documentId: inviteDocumentId,
      data: {
        deliveryFailureMessage: errorMessage,
        deliveryState: 'failed',
        lastSentAt: null,
        notificationServiceJobId: null,
      },
      populate: feedbackInvitePopulate,
    });
  }
};

const findInviteByToken = async (strapi: StrapiDocumentService, inviteToken: string) => {
  const invites = await documents(strapi, 'api::employer-invite.employer-invite').findMany({
    filters: {
      tokenHash: hashInviteToken(inviteToken),
    },
    limit: 1,
    populate: invitePopulate,
  });

  return invites[0] || null;
};

const assertValidInvite = async (strapi: StrapiDocumentService, inviteToken: string) => {
  const invite = await findInviteByToken(strapi, inviteToken);

  if (!invite) {
    throw new ValidationError('Employer invite could not be found.');
  }

  if (invite.inviteState !== 'pending') {
    throw new ValidationError('Employer invite is no longer active.');
  }

  if (invite.expiresAt && Date.parse(invite.expiresAt) <= Date.now()) {
    const inviteDocumentId = getDocumentId(invite);

    if (!inviteDocumentId) {
      throw new ValidationError('Employer invite could not be updated.');
    }

    await documents(strapi, 'api::employer-invite.employer-invite').update({
      documentId: inviteDocumentId,
      data: {
        inviteState: 'expired',
      },
    });
    throw new ValidationError('Employer invite has expired.');
  }

  if (!invite.employer || !invite.employerContact) {
    throw new ValidationError('Employer invite is missing linked account records.');
  }

  return invite;
};

const normalizedEmailValue = (value?: unknown) =>
  String(value || '').trim().toLowerCase();

const normalizedInviteEmail = (invite: DocumentRecord) =>
  normalizedEmailValue(invite.inviteEmail || invite.employerContact?.email);

const linkedInviteAuthIdentityId = (invite: DocumentRecord) =>
  String(invite.authIdentityId || invite.employerContact?.authIdentityId || '').trim();

const expireInviteRecord = async (strapi: StrapiDocumentService, invite: DocumentRecord) => {
  const inviteDocumentId = getDocumentId(invite);

  if (!inviteDocumentId) {
    return;
  }

  await documents(strapi, 'api::employer-invite.employer-invite').update({
    documentId: inviteDocumentId,
    data: {
      inviteState: 'expired',
    },
  });
};

const assertNoAuthIdentityContactConflict = async (
  strapi: StrapiDocumentService,
  identity: EmployerInviteAcceptanceIdentity,
  employerContactDocumentId: string
) => {
  const existingContacts = await documents(strapi, 'api::employer-contact.employer-contact').findMany({
    filters: {
      authIdentityId: identity.authIdentityId,
    },
    limit: 5,
  });
  const conflictingContact = existingContacts.find(
    (contact) => getDocumentId(contact) !== employerContactDocumentId
  );

  if (conflictingContact) {
    throw new ValidationError('This Auth0 account is already linked to another employer contact.');
  }
};

const assertVerifiedEmployerAuthIdentity = async (
  identity: EmployerInviteAcceptanceIdentity,
  inviteEmail: string
) => {
  let auth0User: Auth0User | null;

  try {
    auth0User = await getAuth0ManagementClient().getEmployerUser({
      userId: identity.authIdentityId,
    });
  } catch {
    throw new ValidationError('Employer sign-in could not be verified for this invite.');
  }

  const auth0Email = normalizedEmailValue(auth0User?.email);

  if (!auth0User || !auth0Email || auth0Email !== inviteEmail || auth0Email !== identity.email) {
    throw new ValidationError('This invite must be accepted using the invited email address.');
  }

  if (auth0User.email_verified === false) {
    throw new ValidationError(
      'Employer sign-in email must be verified before this invite can be accepted.'
    );
  }
};

const recoverInviteIdentityForVerifiedUser = async (
  strapi: StrapiDocumentService,
  invite: DocumentRecord,
  identity: EmployerInviteAcceptanceIdentity,
  requestContext: RequestContext = {}
) => {
  const inviteDocumentId = getDocumentId(invite);
  const employerContactDocumentId = getDocumentId(invite.employerContact);
  const inviteEmail = normalizedInviteEmail(invite);
  const previousInviteAuthIdentityId =
    typeof invite.authIdentityId === 'string' ? invite.authIdentityId : null;
  const previousContactAuthIdentityId =
    typeof invite.employerContact?.authIdentityId === 'string'
      ? invite.employerContact.authIdentityId
      : null;

  if (!inviteDocumentId || !employerContactDocumentId || !inviteEmail) {
    throw new ValidationError('Employer invite is missing linked account records.');
  }

  if (
    invite.employerContact?.contactState === 'active' &&
    previousContactAuthIdentityId &&
    previousContactAuthIdentityId !== identity.authIdentityId
  ) {
    throw new ValidationError('This employer contact is already linked to another Auth0 account.');
  }

  await assertVerifiedEmployerAuthIdentity(identity, inviteEmail);
  await assertNoAuthIdentityContactConflict(strapi, identity, employerContactDocumentId);

  await documents(strapi, 'api::employer-contact.employer-contact').update({
    documentId: employerContactDocumentId,
    data: {
      authIdentityId: identity.authIdentityId,
      authProvider: 'auth0',
    },
  });

  return documents(strapi, 'api::employer-invite.employer-invite').update({
    documentId: inviteDocumentId,
    data: {
      authIdentityId: identity.authIdentityId,
      metadata: {
        ...(invite.metadata && typeof invite.metadata === 'object' ? invite.metadata : {}),
        recoveredAuthIdentityAt: new Date().toISOString(),
        recoveredByEmail: identity.email,
        recoveredPreviousContactAuthIdentityId: previousContactAuthIdentityId,
        recoveredPreviousInviteAuthIdentityId: previousInviteAuthIdentityId,
        recoveredRequestId: requestContext.requestId,
        recoveredUserAgent: requestContext.userAgent,
      },
    },
    populate: invitePopulate,
  });
};

const ensureInviteMatchesIdentity = async (
  strapi: StrapiDocumentService,
  invite: DocumentRecord,
  identity: EmployerInviteAcceptanceIdentity,
  requestContext: RequestContext = {}
) => {
  const linkedAuthIdentityId = linkedInviteAuthIdentityId(invite);

  if (linkedAuthIdentityId === identity.authIdentityId) {
    return invite;
  }

  return recoverInviteIdentityForVerifiedUser(strapi, invite, identity, requestContext);
};

const findPendingInviteForIdentity = async (
  strapi: StrapiDocumentService,
  identity: EmployerInviteAcceptanceIdentity,
  requestContext: RequestContext = {}
) => {
  const filters = compact([
    identity.email ? { inviteEmail: identity.email } : null,
    identity.email ? { employerContact: { email: identity.email } } : null,
    identity.authIdentityId ? { authIdentityId: identity.authIdentityId } : null,
    identity.authIdentityId ? { employerContact: { authIdentityId: identity.authIdentityId } } : null,
  ]);
  const invites = await documents(strapi, 'api::employer-invite.employer-invite').findMany({
    filters: {
      inviteState: 'pending',
      ...(filters.length > 0 ? { $or: filters } : {}),
    },
    limit: 10,
    populate: invitePopulate,
    sort: ['createdAt:desc'],
  });
  const recoveryCandidates: DocumentRecord[] = [];

  for (const invite of invites) {
    if (normalizedInviteEmail(invite) !== identity.email) {
      continue;
    }

    if (invite.expiresAt && Date.parse(invite.expiresAt) <= Date.now()) {
      await expireInviteRecord(strapi, invite);
      continue;
    }

    if (!invite.employer || !invite.employerContact) {
      continue;
    }

    const linkedAuthIdentityId = linkedInviteAuthIdentityId(invite);

    if (linkedAuthIdentityId === identity.authIdentityId) {
      return invite;
    }

    recoveryCandidates.push(invite);
  }

  if (recoveryCandidates.length === 1) {
    return recoverInviteIdentityForVerifiedUser(
      strapi,
      recoveryCandidates[0],
      identity,
      requestContext
    );
  }

  if (recoveryCandidates.length > 1) {
    throw new ValidationError(
      'Multiple pending employer invites were found for this email address. Ask your HireFlip contact to resend the latest invite.'
    );
  }

  throw new ValidationError('No pending employer invite was found for this signed-in account.');
};

const acceptInviteRecord = async (
  strapi: StrapiDocumentService,
  invite: DocumentRecord,
  identity: EmployerInviteAcceptanceIdentity,
  requestContext: RequestContext = {}
) => {
  const inviteEmail = normalizedInviteEmail(invite);
  const employerDocumentId = getDocumentId(invite.employer);
  const employerContactDocumentId = getDocumentId(invite.employerContact);
  const inviteDocumentId = getDocumentId(invite);

  if (!inviteEmail || inviteEmail !== identity.email) {
    throw new ValidationError('This invite must be accepted using the invited email address.');
  }

  if (!employerDocumentId || !employerContactDocumentId || !inviteDocumentId) {
    throw new ValidationError('Employer invite is missing linked account records.');
  }

  await assertNoAuthIdentityContactConflict(strapi, identity, employerContactDocumentId);

  if (
    invite.employerContact.authIdentityId &&
    invite.employerContact.authIdentityId !== identity.authIdentityId
  ) {
    throw new ValidationError('This employer contact is already linked to another Auth0 account.');
  }

	  const now = new Date().toISOString();
	  const updatedContact = await documents(strapi, 'api::employer-contact.employer-contact').update({
	    documentId: employerContactDocumentId,
	    data: {
	      accountCreatedAt: invite.employerContact.accountCreatedAt || now,
	      authIdentityId: identity.authIdentityId,
	      authProvider: 'auth0',
	      contactState: 'active',
	    },
	    populate: {
	      coverageRegions: true,
	      employer: {
	        populate: {
	          contacts: {
	            populate: ['coverageRegions'],
	          },
	          operatingRegions: true,
	        },
	      },
	    },
	  });
	  await documents(strapi, 'api::employer.employer').update({
	    documentId: employerDocumentId,
	    data: {
	      dashboardOnboardingState: isDashboardOnboardingComplete(invite.employer)
	        ? 'complete'
	        : 'in_progress',
	      employerState: 'active',
	    },
	  });
  const acceptedInvite = await documents(strapi, 'api::employer-invite.employer-invite').update({
    documentId: inviteDocumentId,
    data: {
      acceptedAt: now,
      acceptedByAuthIdentityId: identity.authIdentityId,
      acceptedByEmail: identity.email,
      inviteState: 'accepted',
      metadata: {
        ...(invite.metadata && typeof invite.metadata === 'object' ? invite.metadata : {}),
        acceptedRequestId: requestContext.requestId,
        acceptedUserAgent: requestContext.userAgent,
      },
    },
    populate: invitePopulate,
  });

	  return {
	    accepted: true,
	    account: await accountPayload(strapi, updatedContact),
	    invite: publicInvitePayload(acceptedInvite),
	  };
	};

const findEmployerContactByEmail = async (strapi: StrapiDocumentService, email: string) => {
  const contacts = await documents(strapi, 'api::employer-contact.employer-contact').findMany({
    filters: {
      email,
    },
    limit: 5,
    populate: {
      coverageRegions: true,
      employer: {
        populate: ['operatingRegions'],
      },
    },
  });

  return contacts;
};

const revokePendingInvitesForContact = async (
  strapi: StrapiDocumentService,
  employerContactDocumentId: string
) => {
  const invites = await documents(strapi, 'api::employer-invite.employer-invite').findMany({
    filters: {
      employerContact: {
        documentId: employerContactDocumentId,
      },
      inviteState: 'pending',
    },
    limit: 100,
  });

  await Promise.all(
    invites.map((invite) => {
      const inviteDocumentId = getDocumentId(invite);

      if (!inviteDocumentId) {
        return Promise.resolve(invite);
      }

      return documents(strapi, 'api::employer-invite.employer-invite').update({
        documentId: inviteDocumentId,
        data: {
          inviteState: 'revoked',
          revokedAt: new Date().toISOString(),
        },
      });
    })
  );
};

const upsertListedTeamContacts = async (
  strapi: StrapiDocumentService,
  {
    employerDocumentId,
    leadContactDocumentId,
    operatingRegions,
    teamContacts,
  }: {
    employerDocumentId: string;
    leadContactDocumentId: string;
    operatingRegions: DocumentRecord[];
    teamContacts: z.infer<typeof teamContactSchema>[];
  }
) => {
  const operatingRegionDocumentIds = new Set(
    operatingRegions.map((region) => getDocumentId(region)).filter(Boolean)
  );
  const createdOrUpdated: DocumentRecord[] = [];

	  for (const teamContact of teamContacts) {
	    const coverageDocumentIds = teamContact.coverageRegionDocumentIds?.length
	      ? teamContact.coverageRegionDocumentIds
	      : Array.from(operatingRegionDocumentIds);

	    if (coverageDocumentIds.some((documentId) => !operatingRegionDocumentIds.has(documentId))) {
	      throw new ValidationError('Team contact coverage must use selected operating regions.');
	    }

	    const coverageRegions = operatingRegions.filter((region) =>
	      coverageDocumentIds.includes(getDocumentId(region) || '')
	    );
    const existingContacts = await findEmployerContactByEmail(strapi, teamContact.email);
    const conflictingContact = existingContacts.find((existingContact) => {
      const existingEmployerDocumentId = getDocumentId(existingContact.employer);
      const existingContactDocumentId = getDocumentId(existingContact);

      return (
        existingContactDocumentId !== leadContactDocumentId &&
        existingEmployerDocumentId &&
        existingEmployerDocumentId !== employerDocumentId
      );
    });

    if (conflictingContact) {
      throw new ValidationError('A team contact email is already linked to another employer.');
    }

    const existingContact = existingContacts.find(
      (candidate) => getDocumentId(candidate.employer) === employerDocumentId
    );

    if (getDocumentId(existingContact) === leadContactDocumentId) {
      continue;
    }

    const data = {
      authProvider: existingContact?.authProvider || 'unknown',
      contactRole: 'team_contact',
      contactState: existingContact?.contactState === 'active' ? 'active' : 'listed',
      coverageRegions: regionSetRelationData(coverageRegions),
      email: teamContact.email,
      employer: {
        connect: [{ documentId: employerDocumentId }],
      },
      firstName: teamContact.firstName || existingContact?.firstName || null,
      lastName: teamContact.lastName || existingContact?.lastName || null,
      roleTitle: teamContact.roleTitle || existingContact?.roleTitle || null,
    };

    if (existingContact) {
      const existingContactDocumentId = getDocumentId(existingContact);

      if (!existingContactDocumentId) {
        continue;
      }

      createdOrUpdated.push(
        await documents(strapi, 'api::employer-contact.employer-contact').update({
          documentId: existingContactDocumentId,
          data,
          populate: ['coverageRegions'],
        })
      );
    } else {
      createdOrUpdated.push(
        await documents(strapi, 'api::employer-contact.employer-contact').create({
          data,
          populate: ['coverageRegions'],
        })
      );
    }
  }

  return createdOrUpdated;
};

const createCapacityChangeRequestIfNeeded = async (
  strapi: StrapiDocumentService,
  {
    employer,
    employerDocumentId,
    contactDocumentId,
    requestContext,
    requestedCadence,
    requestedVolume,
  }: {
    contactDocumentId: string;
    employer: DocumentRecord;
    employerDocumentId: string;
    requestContext: RequestContext;
    requestedCadence: string;
    requestedVolume: number;
  }
) => {
  const initialVolume = employer.initialInterviewCommitmentVolume;
  const initialCadence = String(employer.initialInterviewCommitmentCadence || 'not_set');
  const hadInitialCommitment =
    typeof initialVolume === 'number' && initialVolume > 0 && initialCadence !== 'not_set';
  const changed =
    hadInitialCommitment &&
    annualizedCommitment(requestedVolume, requestedCadence) <
      annualizedCommitment(initialVolume, initialCadence);

  if (!changed) {
    return null;
  }

  return documents(strapi, 'api::employer-capacity-change-request.employer-capacity-change-request').create({
    data: {
      currentInterviewCommitmentCadence: initialCadence,
      currentInterviewCommitmentVolume: initialVolume,
      changeScope: 'global',
      currentAnnualizedInterviewSlots: annualizedCommitment(initialVolume, initialCadence),
      currentCommitmentMode: String(employer.commitmentMode || 'global'),
      employer: {
        connect: [{ documentId: employerDocumentId }],
      },
      metadata: {
        changedDuringOnboarding: true,
        requestId: requestContext.requestId,
        source: 'employer_dashboard_onboarding',
      },
      reason: 'Changed during employer onboarding.',
      requestedByEmployerContact: {
        connect: [{ documentId: contactDocumentId }],
      },
      requestedAnnualizedInterviewSlots: annualizedCommitment(requestedVolume, requestedCadence),
      requestedCommitmentMode: String(employer.commitmentMode || 'global'),
      requestedInterviewCommitmentCadence: requestedCadence,
      requestedInterviewCommitmentVolume: requestedVolume,
      requestState: 'pending',
    },
  });
};

const isLeadContact = (contact: DocumentRecord) => {
  if (contact.contactRole === 'lead_contact') {
    return true;
  }

  const employerContacts = Array.isArray(contact.employer?.contacts) ? contact.employer.contacts : [];
  const activeContacts = employerContacts.filter((candidate) => candidate.contactState === 'active');
  const currentDocumentId = getDocumentId(contact);
  const firstActiveContactDocumentId = getDocumentId(activeContacts[0]);

  return Boolean(currentDocumentId && firstActiveContactDocumentId === currentDocumentId);
};

const assertLeadContact = (contact: DocumentRecord) => {
  if (!isLeadContact(contact)) {
    throw new ValidationError('Lead contact access is required for this employer action.');
  }
};

const createEmployerReviewAuditEvent = async (
  strapi: StrapiDocumentService,
  {
    contact,
    eventType,
    metadata,
    requestContext,
    summary,
  }: {
    contact: DocumentRecord;
    eventType: string;
    metadata: Record<string, unknown>;
    requestContext: RequestContext;
    summary: string;
  }
) => {
  const employer = contact.employer;

  return auditEvents(strapi).record({
    actorDisplayName: contactDisplayName(contact),
    actorEmail: contact.email || undefined,
    actorId: getDocumentId(contact) || undefined,
    actorType: 'employer_contact',
    eventCategory: 'employer',
    eventType,
    ipAddress: requestContext.ipAddress,
    metadata,
    requestId: requestContext.requestId,
    serviceName: requestContext.serviceName,
    severity: 'error',
    source: 'employer_dashboard',
    subjectDisplayName: employer?.companyName || summary,
    subjectId: getDocumentId(employer) || undefined,
    subjectType: 'employer',
    userAgent: requestContext.userAgent,
  });
};

const syncRegionCommitments = async (
  strapi: StrapiDocumentService,
  {
    commitmentMode,
    employerDocumentId,
    operatingRegions,
    regionCommitments,
    requestedCadence,
    requestedVolume,
    updatedByEmail,
  }: {
    commitmentMode: string;
    employerDocumentId: string;
    operatingRegions: DocumentRecord[];
    regionCommitments: z.infer<typeof regionCommitmentSchema>[];
    requestedCadence: string;
    requestedVolume: number;
    updatedByEmail?: string;
  }
) => {
  const operatingRegionDocumentIds = new Set(regionDocumentIds(operatingRegions));
  const requestedByRegion = new Map<string, z.infer<typeof regionCommitmentSchema>>();

  if (commitmentMode === 'per_region') {
    const sourceCommitments = regionCommitments.length
      ? regionCommitments
      : operatingRegions.map((region) => ({
          interviewCommitmentCadence: requestedCadence as z.infer<typeof cadenceSchema>,
          interviewCommitmentVolume: requestedVolume,
          regionDocumentId: getDocumentId(region) || '',
        }));

    for (const commitment of sourceCommitments) {
      if (!operatingRegionDocumentIds.has(commitment.regionDocumentId)) {
        throw new ValidationError('Per-region commitments must match selected operating regions.');
      }

      requestedByRegion.set(commitment.regionDocumentId, commitment);
    }

    if (requestedByRegion.size !== operatingRegionDocumentIds.size) {
      throw new ValidationError('Every operating region must have an interview commitment.');
    }
  }

  const existingCommitments = await documents(
    strapi,
    'api::employer-region-commitment.employer-region-commitment'
  ).findMany({
    filters: {
      employer: {
        documentId: employerDocumentId,
      },
    },
    limit: 500,
    populate: ['region'],
  });
  const existingByRegion = new Map(
    existingCommitments
      .map((commitment) => {
        const region =
          commitment.region && typeof commitment.region === 'object'
            ? (commitment.region as DocumentRecord)
            : null;

        return [getDocumentId(region), commitment] as const;
      })
      .filter(([documentId]) => Boolean(documentId))
  );
  const now = new Date().toISOString();
  const updated: DocumentRecord[] = [];

  for (const [regionDocumentId, existingCommitment] of existingByRegion.entries()) {
    if (!requestedByRegion.has(regionDocumentId || '')) {
      const existingDocumentId = getDocumentId(existingCommitment);

      if (existingDocumentId && existingCommitment.commitmentState !== 'archived') {
        updated.push(
          await documents(
            strapi,
            'api::employer-region-commitment.employer-region-commitment'
          ).update({
            documentId: existingDocumentId,
            data: {
              commitmentState: 'archived',
            },
            populate: ['region'],
          })
        );
      }
    }
  }

  for (const [regionDocumentId, requested] of requestedByRegion.entries()) {
    const existingCommitment = existingByRegion.get(regionDocumentId);
    const existingDocumentId = getDocumentId(existingCommitment);
    const data = {
      commitmentState: 'active',
      effectiveFrom: existingCommitment?.effectiveFrom || now,
      employer: {
        connect: [{ documentId: employerDocumentId }],
      },
      interviewCommitmentCadence: requested.interviewCommitmentCadence,
      interviewCommitmentVolume: requested.interviewCommitmentVolume,
      region: {
        connect: [{ documentId: regionDocumentId }],
      },
      updatedByEmployerContactEmail: updatedByEmail || null,
    };

    updated.push(
      existingDocumentId
        ? await documents(
            strapi,
            'api::employer-region-commitment.employer-region-commitment'
          ).update({
            documentId: existingDocumentId,
            data,
            populate: ['region'],
          })
        : await documents(
            strapi,
            'api::employer-region-commitment.employer-region-commitment'
          ).create({
            data,
            populate: ['region'],
          })
    );
  }

  return updated;
};

const createSettingsCapacityReviewIfNeeded = async (
  strapi: StrapiDocumentService,
  {
    contact,
    changeScope,
    currentCadence,
    currentAnnualized,
    currentCommitmentMode,
    currentVolume,
    employerDocumentId,
    metadata,
    reason,
    requestedAnnualized,
    requestedCadence,
    requestedCommitmentMode,
    requestedVolume,
    requestContext,
  }: {
    contact: DocumentRecord;
    changeScope?: 'global' | 'per_region' | 'operating_regions';
    currentCadence: string;
    currentAnnualized?: number;
    currentCommitmentMode?: string;
    currentVolume: number;
    employerDocumentId: string;
    metadata?: Record<string, unknown>;
    reason?: string;
    requestedAnnualized?: number;
    requestedCadence: string;
    requestedCommitmentMode?: string;
    requestedVolume: number;
    requestContext: RequestContext;
  }
) => {
  const currentAnnualizedValue =
    typeof currentAnnualized === 'number'
      ? currentAnnualized
      : annualizedCommitment(currentVolume, currentCadence);
  const requestedAnnualizedValue =
    typeof requestedAnnualized === 'number'
      ? requestedAnnualized
      : annualizedCommitment(requestedVolume, requestedCadence);

  if (requestedAnnualizedValue >= currentAnnualizedValue) {
    return null;
  }

  const review = await documents(
    strapi,
    'api::employer-capacity-change-request.employer-capacity-change-request'
  ).create({
    data: {
      changeScope: changeScope || 'global',
      currentInterviewCommitmentCadence: currentCadence,
      currentInterviewCommitmentVolume: currentVolume,
      currentAnnualizedInterviewSlots: currentAnnualizedValue,
      currentCommitmentMode: currentCommitmentMode || String(contact.employer?.commitmentMode || 'global'),
      employer: {
        connect: [{ documentId: employerDocumentId }],
      },
      metadata: {
        appliedImmediately: true,
        currentAnnualized: currentAnnualizedValue,
        requestedAnnualized: requestedAnnualizedValue,
        requestId: requestContext.requestId,
        source: 'employer_dashboard_settings',
        ...(metadata || {}),
      },
      reason: reason || 'Employer reduced interview commitment from settings.',
      requestedByEmployerContact: {
        connect: [{ documentId: getDocumentId(contact) }],
      },
      requestedAnnualizedInterviewSlots: requestedAnnualizedValue,
      requestedCommitmentMode: requestedCommitmentMode || String(contact.employer?.commitmentMode || 'global'),
      requestedInterviewCommitmentCadence: requestedCadence,
      requestedInterviewCommitmentVolume: requestedVolume,
      requestState: 'pending',
    },
  });

  await createEmployerReviewAuditEvent(strapi, {
    contact,
    eventType: 'employer.commitment_decreased',
    metadata: {
      currentCadence,
      currentVolume,
      requestedCadence,
      requestedVolume,
      currentAnnualized: currentAnnualizedValue,
      requestedAnnualized: requestedAnnualizedValue,
      reviewDocumentId: getDocumentId(review),
      reviewNote: reason || null,
    },
    requestContext,
    summary: 'Employer commitment decreased',
  });

  return review;
};

const availabilityRequestPayload = (claim: DocumentRecord) => {
  const request = claim.interviewRequest;
  const classRecord = request?.class;

  return {
    candidateDocumentId: getDocumentId(request?.candidate) || null,
    candidateName: candidateDisplayName(request?.candidate),
    courseLabel: classRecord?.displayTitle || classRecord?.name || 'Interview phase',
    documentId: getDocumentId(claim) || String(claim.id || ''),
    earliestSlotLabel: '4 working days notice required',
    enrollmentDocumentId: getDocumentId(request?.enrollment) || null,
    interviewRequestDocumentId: getDocumentId(request) || null,
    requiredSlotCount: boundedSlotCount(claim.requiredSlotCount),
    responseLabel: claim.expiresAt ? formatDateTime(claim.expiresAt) : '2 working days',
    statusLabel: humanize(String(claim.claimState || request?.requestState || 'notified')),
  };
};

const interviewPayload = (interview: DocumentRecord) => ({
  candidateName: candidateDisplayName(interview.candidate),
  documentId: getDocumentId(interview) || String(interview.id || ''),
  detailsPending: String(interview.interviewState || '') === 'awaiting_employer_details',
  locationLabel: interview.interviewSlot
    ? locationLabel(interview.interviewSlot)
    : 'Location not recorded',
  scheduledEndTime: interview.scheduledEndTime || null,
  scheduledStartTime: interview.scheduledStartTime || null,
  scheduledLabel: formatDateTime(interview.scheduledStartTime),
  state: interview.interviewState || 'awaiting_employer_details',
  statusLabel: humanize(String(interview.interviewState || 'offered')),
});

const feedbackPayload = (interview: DocumentRecord) => ({
  candidateName: candidateDisplayName(interview.candidate),
  documentId: getDocumentId(interview) || String(interview.id || ''),
  dueLabel: interview.completedAt
    ? formatDateTime(addDays(new Date(interview.completedAt), 7).toISOString())
    : 'Due 7 days after interview',
  interviewLabel: formatDateTime(interview.scheduledStartTime || interview.completedAt),
  statusLabel: 'Awaiting employer feedback',
});

const candidateReportVisibleStates = new Set(['generated', 'approved', 'manually_edited']);

const normalizeTakeaways = (value: unknown) =>
  (Array.isArray(value) ? value : [])
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .slice(0, 3);

const employerFeedbackPayload = (feedback?: DocumentRecord | null) => {
  if (!feedback) {
    return null;
  }

  const reportState = String(feedback.candidateReportState || 'pending');
  const reportVisible = candidateReportVisibleStates.has(reportState);

  return {
    candidateReport: {
      conclusion: reportVisible ? feedback.candidateReportConclusion || null : null,
      generatedAt: reportVisible ? feedback.candidateReportGeneratedAt || null : null,
      improvements: reportVisible ? feedback.candidateReportImprovements || null : null,
      intro: reportVisible ? feedback.candidateReportIntro || null : null,
      state: reportState,
      strengths: reportVisible ? feedback.candidateReportStrengths || null : null,
      takeaways: reportVisible ? normalizeTakeaways(feedback.candidateReportTakeaways) : [],
      visibleAt: reportVisible ? feedback.candidateReportVisibleAt || null : null,
    },
    concerns: feedback.concerns || null,
    documentId: getDocumentId(feedback) || String(feedback.id || ''),
    nextStep: feedback.nextStep || null,
    notes: feedback.notes || null,
    outcome: feedback.outcome || 'unknown',
    previousTakeawayAssessment: feedback.previousTakeawayAssessment || null,
    rating: typeof feedback.rating === 'number' ? feedback.rating : null,
    strengths: feedback.strengths || null,
    submittedAt: feedback.submittedAt || feedback.createdAt || null,
    submittedById: feedback.submittedById || null,
    submittedByType: feedback.submittedByType || null,
  };
};

const findEmployerFeedbackForInterview = async (
  strapi: StrapiDocumentService,
  interviewDocumentId: string
) => {
  const feedbackRecords = await documents(strapi, 'api::interview-feedback.interview-feedback').findMany({
    filters: {
      interview: {
        documentId: interviewDocumentId,
      },
      submittedByType: 'employer_contact',
    },
    limit: 1,
    populate: ['interview'],
    sort: ['submittedAt:desc', 'createdAt:desc'],
  });

  return feedbackRecords[0] || null;
};

const findPreviousCandidateReportTakeaways = async (
  strapi: StrapiDocumentService,
  interview: DocumentRecord
) => {
  const candidateDocumentId = getDocumentId(interview.candidate);
  const enrollmentDocumentId = getDocumentId(interview.enrollment);

  if (!candidateDocumentId || !enrollmentDocumentId) {
    return [];
  }

  const currentStartTime = String(interview.scheduledStartTime || interview.completedAt || '');
  const previousInterviews = await documents(strapi, 'api::interview.interview').findMany({
    filters: {
      candidate: {
        documentId: candidateDocumentId,
      },
      enrollment: {
        documentId: enrollmentDocumentId,
      },
      interviewState: 'completed',
      ...(currentStartTime
        ? {
            scheduledStartTime: {
              $lt: currentStartTime,
            },
          }
        : {}),
    },
    limit: 10,
    sort: ['scheduledStartTime:desc', 'completedAt:desc', 'createdAt:desc'],
  });
  const previousInterviewIds = previousInterviews
    .map((record) => getDocumentId(record))
    .filter((documentId): documentId is string => Boolean(documentId));

  if (!previousInterviewIds.length) {
    return [];
  }

  const feedbackRecords = await documents(strapi, 'api::interview-feedback.interview-feedback').findMany({
    filters: {
      candidateReportState: {
        $in: Array.from(candidateReportVisibleStates),
      },
      interview: {
        documentId: {
          $in: previousInterviewIds,
        },
      },
      submittedByType: 'employer_contact',
    },
    limit: 10,
    populate: ['interview'],
    sort: ['candidateReportVisibleAt:desc', 'candidateReportGeneratedAt:desc', 'submittedAt:desc'],
  });

  for (const feedback of feedbackRecords) {
    const takeaways = normalizeTakeaways(feedback.candidateReportTakeaways);

    if (takeaways.length) {
      return takeaways;
    }
  }

  return [];
};

const feedbackInvitePopulate = {
  createdByEmployerContact: true,
  employer: true,
  feedback: true,
  interview: {
    populate: ['candidate', 'employer', 'employerContact', 'interviewSlot'],
  },
};

const feedbackInvitePayload = (invite: DocumentRecord) => {
  const expiresAt = invite.expiresAt || null;
  const isExpired =
    invite.inviteState === 'pending' && expiresAt ? Date.parse(expiresAt) <= Date.now() : false;
  const state = isExpired ? 'expired' : invite.inviteState || 'pending';

  return {
    canRevoke: state === 'pending',
    deliveryFailureMessage: invite.deliveryFailureMessage || null,
    deliveryState: invite.deliveryState || 'not_required',
    documentId: getDocumentId(invite) || String(invite.id || ''),
    expiresAt,
    expiresAtLabel: formatDateTime(expiresAt),
    inviteEmail: invite.inviteEmail || null,
    inviteeName: invite.inviteeName || null,
    inviteeRoleTitle: invite.inviteeRoleTitle || null,
    inviteState: state,
    lastSentAt: invite.lastSentAt || null,
    revokedAt: invite.revokedAt || null,
    submittedAt: invite.submittedAt || null,
  };
};

const feedbackInvitePublicPayload = (invite: DocumentRecord) => {
  const interview = documentRecordValue(invite.interview) || {};
  const employer = documentRecordValue(invite.employer || interview.employer) || {};
  const createdBy = documentRecordValue(invite.createdByEmployerContact) || {};
  const slot = documentRecordValue(interview.interviewSlot);

  return {
    companyName: employer.companyName || 'the employer',
    createdByName: contactDisplayName(createdBy),
    expiresAt: invite.expiresAt || null,
    expiresAtLabel: formatDateTime(invite.expiresAt),
    interview: {
      candidateName: candidateDisplayName(interview.candidate),
      completedAt: interview.completedAt || null,
      completedAtLabel: formatDateTime(interview.completedAt),
      scheduledStartTime: interview.scheduledStartTime || slot?.startTime || null,
      scheduledStartTimeLabel: formatDateTime(interview.scheduledStartTime || slot?.startTime),
    },
    inviteEmail: invite.inviteEmail || null,
    inviteeName: invite.inviteeName || null,
    inviteeRoleTitle: invite.inviteeRoleTitle || null,
    valid: true,
  };
};

const findFeedbackInvitesForInterview = async (
  strapi: StrapiDocumentService,
  interviewDocumentId: string
) =>
  documents(strapi, 'api::interview-feedback-invite.interview-feedback-invite').findMany({
    filters: {
      interview: {
        documentId: interviewDocumentId,
      },
    },
    limit: 50,
    populate: ['feedback'],
    sort: ['createdAt:asc'],
  });

const feedbackReportReadinessPayload = (
  primaryFeedback: DocumentRecord | null | undefined,
  invites: DocumentRecord[]
) => {
  const pendingInvites = invites.filter((invite) => {
    if (invite.inviteState !== 'pending') {
      return false;
    }

    return !invite.expiresAt || Date.parse(invite.expiresAt) > Date.now();
  });
  const submittedInvites = invites.filter((invite) => invite.inviteState === 'submitted');

  return {
    pendingInviteCount: pendingInvites.length,
    primaryFeedbackSubmitted: Boolean(primaryFeedback),
    state: !primaryFeedback
      ? 'waiting_for_primary_feedback'
      : pendingInvites.length
        ? 'waiting_for_additional_feedback'
        : 'ready_for_ai',
    submittedInviteCount: submittedInvites.length,
    totalInviteCount: invites.length,
    waitingUntil:
      pendingInvites
        .map((invite) => invite.expiresAt)
        .filter((value): value is string => Boolean(value))
        .sort()[0] || null,
    waitingUntilLabel: formatDateTime(
      pendingInvites
        .map((invite) => invite.expiresAt)
        .filter((value): value is string => Boolean(value))
        .sort()[0] || null
    ),
  };
};

const findSubmittedFeedbackForInterview = async (
  strapi: StrapiDocumentService,
  interviewDocumentId: string
) =>
  documents(strapi, 'api::interview-feedback.interview-feedback').findMany({
    filters: {
      interview: {
        documentId: interviewDocumentId,
      },
      submittedByType: {
        $in: ['employer_contact', 'external_interviewer'],
      },
    },
    limit: 50,
    populate: ['feedbackInvite'],
    sort: ['submittedAt:asc', 'createdAt:asc'],
  });

const feedbackSourcePayload = (feedback: DocumentRecord, interview: DocumentRecord) => {
  const metadata = objectValue(feedback.metadata);
  const feedbackInvite = documentRecordValue(feedback.feedbackInvite);
  const isExternal = feedback.submittedByType === 'external_interviewer';

  return {
    concerns: String(feedback.concerns || ''),
    feedbackDocumentId: getDocumentId(feedback) || String(feedback.id || ''),
    nextStep: String(feedback.nextStep || ''),
    notes: String(feedback.notes || ''),
    outcome: String(feedback.outcome || 'unknown'),
    previousTakeawayAssessment:
      typeof feedback.previousTakeawayAssessment === 'string'
        ? feedback.previousTakeawayAssessment
        : null,
    rating: typeof feedback.rating === 'number' ? feedback.rating : null,
    sourceType: isExternal ? 'external_interviewer' : 'employer_contact',
    strengths: String(feedback.strengths || ''),
    submittedAt: typeof feedback.submittedAt === 'string' ? feedback.submittedAt : null,
    submitterDisplayName: isExternal
      ? String(metadata.submitterName || feedbackInvite?.inviteeName || feedbackInvite?.inviteEmail || '').trim() ||
        null
      : contactDisplayName(documentRecordValue(interview.employerContact) || {}),
    submitterRoleTitle: isExternal
      ? String(metadata.submitterRoleTitle || feedbackInvite?.inviteeRoleTitle || '').trim() || null
      : String(documentRecordValue(interview.employerContact)?.roleTitle || '').trim() || null,
  };
};

const queueCandidateFeedbackReportNotification = async ({
  feedback,
  interview,
  requestContext,
  strapi,
}: {
  feedback: DocumentRecord;
  interview: DocumentRecord;
  requestContext: RequestContext;
  strapi: StrapiDocumentService;
}) => {
  const candidate = documentRecordValue(interview.candidate);
  const candidateEmail = typeof candidate?.email === 'string' ? candidate.email : null;
  const subject = 'Your interview feedback is ready';
  const dashboardUrl = candidateDashboardInterviewsUrl();
  const candidateName = candidate?.firstName || 'there';
  const bodyLines = [
    `Hi ${candidateName},`,
    'Your HireFlip interview feedback report is ready to view in your dashboard.',
    'This report was generated by AI from direct interviewer feedback and is designed to give you clear, constructive next steps.',
    'If anything does not look right, you can flag it for review from the dashboard.',
  ];
  let emailDeliveryState: 'queued' | 'failed' = 'failed';
  let emailJobId: string | number | undefined;
  let emailErrorMessage: string | undefined;

  if (candidateEmail) {
    try {
      const emailQueueResult = await requestNotificationServiceEmail({
        correlationId: getDocumentId(feedback) || getDocumentId(interview) || undefined,
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

      emailDeliveryState = emailQueueResult.data?.queued === true ? 'queued' : 'failed';
      emailJobId = emailQueueResult.data?.jobId;
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
          recipientId: getDocumentId(candidate) || undefined,
          recipientType: 'candidate',
          relatedId: getDocumentId(feedback) || undefined,
          relatedType: 'interview_feedback',
          templateKey: channel === 'email' ? 'generic_branded_message' : undefined,
        },
      })
    )
  );
};

const shouldAttemptCandidateFeedbackReport = (feedback: DocumentRecord) => {
  const state = String(feedback.candidateReportState || 'pending');

  if (state !== 'pending') {
    return false;
  }

  const nextRetryAt = typeof feedback.candidateReportNextRetryAt === 'string'
    ? Date.parse(feedback.candidateReportNextRetryAt)
    : Number.NaN;

  return Number.isNaN(nextRetryAt) || nextRetryAt <= Date.now();
};

const retryCountForFeedback = (feedback: DocumentRecord) => {
  const value = Number(feedback.candidateReportRetryCount || 0);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
};

const recordCandidateFeedbackReportFailure = async ({
  error,
  feedback,
  feedbackRecords,
  interview,
  requestContext,
  strapi,
}: {
  error: unknown;
  feedback: DocumentRecord;
  feedbackRecords: DocumentRecord[];
  interview: DocumentRecord;
  requestContext: RequestContext;
  strapi: StrapiDocumentService;
}) => {
  const feedbackDocumentId = getDocumentId(feedback);
  const interviewDocumentId = getDocumentId(interview);

  if (!feedbackDocumentId) {
    return feedback;
  }

  const failure = aiFeedbackFailure(error);
  const now = new Date();
  const nowIso = now.toISOString();
  const previousRetryCount = retryCountForFeedback(feedback);
  const nextRetryCount = previousRetryCount + 1;
  const maxAttempts = aiFeedbackMaxAttempts();
  const shouldRetry = failure.transient && nextRetryCount < maxAttempts;
  const retryDelay = aiFeedbackRetryDelaysMs[Math.min(nextRetryCount - 1, aiFeedbackRetryDelaysMs.length - 1)];
  const nextRetryAt = shouldRetry ? new Date(now.getTime() + retryDelay).toISOString() : null;
  const previousMetadata = objectValue(feedback.aiMetadata);
  const retryHistory = Array.isArray(previousMetadata.retryHistory)
    ? previousMetadata.retryHistory.slice(-9)
    : [];
  const candidateReportState = shouldRetry ? 'pending' : 'failed';

  const updatedFeedback = await documents(strapi, 'api::interview-feedback.interview-feedback').update({
    documentId: feedbackDocumentId,
    data: {
      aiMetadata: {
        ...previousMetadata,
        feedbackSourceCount: feedbackRecords.length,
        lastGenerationError: {
          category: failure.category,
          message: failure.message,
          nextRetryAt,
          retryCount: nextRetryCount,
          status: failure.status || null,
          transient: failure.transient,
        },
        requestId: requestContext.requestId,
        retryHistory: [
          ...retryHistory,
          {
            at: nowIso,
            category: failure.category,
            message: failure.message,
            nextRetryAt,
            retryCount: nextRetryCount,
            status: failure.status || null,
            transient: failure.transient,
          },
        ],
      },
      candidateReportFailureCategory: shouldRetry ? null : failure.category,
      candidateReportFailureFirstDetectedAt:
        feedback.candidateReportFailureFirstDetectedAt || nowIso,
      candidateReportFailureReason: shouldRetry ? null : failure.message,
      candidateReportLastAttemptAt: nowIso,
      candidateReportNextRetryAt: nextRetryAt,
      candidateReportRetryCount: nextRetryCount,
      candidateReportState,
    },
  });

  await auditEvents(strapi).record({
    actorType: 'service',
    eventCategory: 'interview',
    eventType: shouldRetry
      ? 'ai.interview_feedback_report_retry_scheduled'
      : 'ai.interview_feedback_report_failed',
    metadata: {
      errorCategory: failure.category,
      errorMessage: failure.message,
      feedbackDocumentId,
      feedbackSourceCount: feedbackRecords.length,
      nextRetryAt,
      requestId: requestContext.requestId,
      retryCount: nextRetryCount,
      status: failure.status || null,
      transient: failure.transient,
    },
    requestId: requestContext.requestId,
    serviceName: 'core-api',
    severity: shouldRetry ? 'warning' : 'error',
    source: 'ai_service',
    subjectDisplayName: candidateDisplayName(interview.candidate),
    subjectId: interviewDocumentId,
    subjectType: 'interview',
  });

  return updatedFeedback;
};

const maybeGenerateCandidateFeedbackReport = async ({
  interview,
  requestContext,
  strapi,
}: {
  interview: DocumentRecord;
  requestContext: RequestContext;
  strapi: StrapiDocumentService;
}) => {
  const interviewDocumentId = getDocumentId(interview);

  if (!interviewDocumentId) {
    return undefined;
  }

  const [primaryFeedback, invites] = await Promise.all([
    findEmployerFeedbackForInterview(strapi, interviewDocumentId),
    findFeedbackInvitesForInterview(strapi, interviewDocumentId),
  ]);
  const readiness = feedbackReportReadinessPayload(primaryFeedback, invites);

  if (!primaryFeedback || readiness.state !== 'ready_for_ai') {
    return primaryFeedback;
  }

  if (!shouldAttemptCandidateFeedbackReport(primaryFeedback)) {
    return primaryFeedback;
  }

  const feedbackRecords = await findSubmittedFeedbackForInterview(strapi, interviewDocumentId);
  const payload = {
    candidate: {
      displayName: candidateDisplayName(interview.candidate),
    },
    company: {
      name: String(interview.employer?.companyName || 'the employer'),
    },
    feedback: feedbackRecords.map((feedback) => feedbackSourcePayload(feedback, interview)),
    interview: {
      completedAt: interview.completedAt || null,
      documentId: interviewDocumentId,
      interviewerName: interview.interviewerName || null,
      scheduledStartTime: interview.scheduledStartTime || null,
    },
    previousTakeaways: await findPreviousCandidateReportTakeaways(strapi, interview),
  };
  const primaryFeedbackDocumentId = getDocumentId(primaryFeedback);

  if (!primaryFeedbackDocumentId) {
    return primaryFeedback;
  }

  try {
    const aiReport = await requestAiFeedbackReport({
      correlationId: `interview-feedback-report:${primaryFeedbackDocumentId}`,
      payload,
    });

    if (!aiReport) {
      return primaryFeedback;
    }

    const now = new Date().toISOString();
    const monthlySpendLimitGbp = await getAiMonthlySpendLimitGbp(strapi);
    const updatedFeedback = await documents(strapi, 'api::interview-feedback.interview-feedback').update({
      documentId: primaryFeedbackDocumentId,
      data: {
        aiMetadata: {
          ...(aiReport.metadata || {}),
          feedbackSourceDocumentIds: feedbackRecords
            .map((feedback) => getDocumentId(feedback))
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
      populate: ['interview'],
    });

    await auditEvents(strapi).record({
      actorType: 'service',
      eventCategory: 'interview',
      eventType: 'ai.interview_feedback_report_generated',
      metadata: {
        feedbackDocumentId: primaryFeedbackDocumentId,
        feedbackSourceCount: feedbackRecords.length,
        model: aiReport.model,
        promptVersion: aiReport.promptVersion,
        provider: aiReport.provider,
        requestId: requestContext.requestId,
      },
      requestId: requestContext.requestId,
      serviceName: 'core-api',
      severity: 'info',
      source: 'ai_service',
      subjectDisplayName: candidateDisplayName(interview.candidate),
      subjectId: interviewDocumentId,
      subjectType: 'interview',
    });

    await queueCandidateFeedbackReportNotification({
      feedback: updatedFeedback,
      interview,
      requestContext,
      strapi,
    });

    return updatedFeedback;
  } catch (error) {
    return recordCandidateFeedbackReportFailure({
      error,
      feedback: primaryFeedback,
      feedbackRecords,
      interview,
      requestContext,
      strapi,
    });
  }
};

const findFeedbackInviteByToken = async (strapi: StrapiDocumentService, inviteToken: string) => {
  const invites = await documents(strapi, 'api::interview-feedback-invite.interview-feedback-invite').findMany({
    filters: {
      tokenHash: hashInviteToken(inviteToken),
    },
    limit: 1,
    populate: feedbackInvitePopulate,
  });

  return invites[0] || null;
};

const expireFeedbackInvite = async (strapi: StrapiDocumentService, invite: DocumentRecord) => {
  const inviteDocumentId = getDocumentId(invite);

  if (!inviteDocumentId || invite.inviteState !== 'pending') {
    return;
  }

  await documents(strapi, 'api::interview-feedback-invite.interview-feedback-invite').update({
    documentId: inviteDocumentId,
    data: {
      inviteState: 'expired',
    },
  });
};

const assertValidFeedbackInvite = async (strapi: StrapiDocumentService, inviteToken: string) => {
  const invite = await findFeedbackInviteByToken(strapi, inviteToken);

  if (!invite) {
    throw new ValidationError('Feedback invite could not be found.');
  }

  if (invite.inviteState !== 'pending') {
    throw new ValidationError('Feedback invite is no longer active.');
  }

  if (invite.expiresAt && Date.parse(invite.expiresAt) <= Date.now()) {
    await expireFeedbackInvite(strapi, invite);
    throw new ValidationError('Feedback invite has expired.');
  }

  if (!invite.interview || !invite.employer) {
    throw new ValidationError('Feedback invite is missing linked interview records.');
  }

  return invite;
};

const activeProgressionStates = ['requested', 'candidate_notified'];

const progressionRequestPopulate = {
  candidate: true,
  employer: {
    populate: ['contacts'],
  },
  interview: {
    populate: ['candidate', 'employer', 'employerContact', 'interviewSlot'],
  },
  requestedByEmployerContact: {
    populate: ['coverageRegions', 'profileImage'],
  },
};

const progressionTypeLabel = (value?: string | null) => {
  const labels: Record<string, string> = {
    final_interview: 'Final interview',
    introductory_call: 'Introductory call',
    offer_discussion: 'Offer discussion',
    other: 'Other',
    practical_task: 'Practical task',
    second_interview: 'Second interview',
  };

  return labels[String(value || '')] || 'Next step';
};

const responseDeadlineForProgression = (input?: string) => {
  if (input) {
    const parsed = Date.parse(input);

    if (!Number.isNaN(parsed) && parsed > Date.now()) {
      return new Date(parsed).toISOString();
    }
  }

  return addWorkingDays(new Date(), 5).toISOString();
};

const followUpDueDate = (date = new Date()) => {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return next.toISOString();
};

const progressionPayload = (offer: DocumentRecord) => ({
  candidateName: candidateDisplayName(offer.candidate),
  documentId: getDocumentId(offer) || String(offer.id || ''),
  progressionType: offer.progressionType || null,
  progressionTypeLabel: progressionTypeLabel(offer.progressionType),
  responseDeadline: offer.candidateResponseDeadline || null,
  responseDeadlineLabel: formatDateTime(offer.candidateResponseDeadline),
  requestedLabel: formatDateTime(offer.requestedDetailsAt || offer.createdAt),
  state: offer.progressionState || 'requested',
  statusLabel: humanize(String(offer.progressionState || 'requested')),
});

const progressionDetailPayload = async (
  strapi: StrapiDocumentService,
  interview: DocumentRecord,
  contact: DocumentRecord,
  progressionRequest?: DocumentRecord | null
) => {
  const interviewDocumentId = getDocumentId(interview) || String(interview.id || '');
  const feedback = interviewDocumentId
    ? await findEmployerFeedbackForInterview(strapi, interviewDocumentId)
    : null;
  const employer = documentRecordValue(contact.employer) || documentRecordValue(interview.employer) || {};
  const contacts = await Promise.all(
    (Array.isArray(employer.contacts) ? employer.contacts : [contact])
      .filter((item) => !['archived', 'disabled'].includes(String(item.contactState || '')))
      .map((item) => publicContactPayload(strapi, item))
  );
  const assignedContact =
    documentRecordValue(progressionRequest?.requestedByEmployerContact) ||
    documentRecordValue(interview.employerContact) ||
    contact;
  const defaultMessage = [
    `We would like to continue the interview journey with ${candidateDisplayName(interview.candidate)}.`,
    'Please confirm whether you are happy for us to contact you directly about the next step.',
  ].join('\n\n');

  return {
    account: await accountPayload(strapi, contact),
    contacts,
    generatedAt: new Date().toISOString(),
    interview: {
      candidateEmail: interview.candidate?.email || null,
      candidateName: candidateDisplayName(interview.candidate),
      completedAt: interview.completedAt || null,
      completedAtLabel: formatDateTime(interview.completedAt),
      documentId: interviewDocumentId,
      employerContactName: interview.employerContact
        ? contactDisplayName(documentRecordValue(interview.employerContact) || {})
        : null,
      scheduledEndTime: interview.scheduledEndTime || null,
      scheduledEndTimeLabel: formatDateTime(interview.scheduledEndTime),
      scheduledStartTime: interview.scheduledStartTime || null,
      scheduledStartTimeLabel: formatDateTime(interview.scheduledStartTime),
      state: interview.interviewState || 'completed',
      statusLabel: humanize(String(interview.interviewState || 'completed')),
    },
    progressionRequest: progressionRequest
      ? {
          ...progressionPayload(progressionRequest),
          candidateDeclineReason: progressionRequest.candidateDeclineReason || null,
          candidateMessage: progressionRequest.candidateMessage || null,
          candidateResponse: progressionRequest.candidateResponse || null,
          candidateRespondedAt: progressionRequest.candidateRespondedAt || null,
          employerContactDocumentId: getDocumentId(assignedContact),
          employerContactName: contactDisplayName(assignedContact),
          internalNote: progressionRequest.internalProcessNotes || null,
          requestedAt: progressionRequest.requestedDetailsAt || progressionRequest.createdAt || null,
        }
      : null,
    rules: {
      canCreateProgressionRequest:
        String(interview.interviewState || '') === 'completed' && Boolean(feedback),
      defaultCandidateMessage: defaultMessage,
      defaultResponseDeadline: responseDeadlineForProgression(),
      feedbackRequired: true,
    },
  };
};

const findProgressionRequestForInterview = async (
  strapi: StrapiDocumentService,
  interviewDocumentId: string
) => {
  const progressionRequests = await documents(strapi, 'api::offer.offer').findMany({
    filters: {
      interview: {
        documentId: interviewDocumentId,
      },
    },
    limit: 1,
    populate: progressionRequestPopulate,
    sort: ['requestedDetailsAt:desc', 'createdAt:desc'],
  });

  return progressionRequests[0] || null;
};

const queueCandidateProgressionRequestNotification = async ({
  contact,
  progressionRequest,
  requestContext,
  strapi,
}: {
  contact: DocumentRecord;
  progressionRequest: DocumentRecord;
  requestContext: RequestContext;
  strapi: StrapiDocumentService;
}) => {
  const candidate = documentRecordValue(progressionRequest.candidate);
  const employer = documentRecordValue(progressionRequest.employer);
  const interview = documentRecordValue(progressionRequest.interview);
  const candidateEmail = typeof candidate?.email === 'string' ? candidate.email : null;
  const subject = 'Good news from your interview';
  const dashboardUrl = candidateDashboardInterviewsUrl();
  const candidateName = candidate?.firstName || 'there';
  const bodyLines = [
    `Hi ${candidateName},`,
    `Good news, your interview with ${employer?.companyName || 'the employer'} went so well that they want your interview journey to continue with them.`,
    'Click below to see what actions you can take next.',
  ];
  let emailDeliveryState: 'queued' | 'failed' = 'failed';
  let emailJobId: string | number | undefined;
  let emailErrorMessage: string | undefined;

  if (candidateEmail) {
    try {
      const emailQueueResult = await requestNotificationServiceEmail({
        correlationId: getDocumentId(progressionRequest) || getDocumentId(interview) || undefined,
        template: {
          key: 'generic_branded_message',
          variables: {
            bodyLines,
            ctaLabel: 'View next steps',
            ctaUrl: dashboardUrl,
            heading: subject,
            subject,
          },
        },
        to: candidateEmail,
        type: 'candidate_interview_progression_requested',
      });

      emailDeliveryState = emailQueueResult.data?.queued === true ? 'queued' : 'failed';
      emailJobId = emailQueueResult.data?.jobId;
    } catch (error) {
      emailErrorMessage =
        error instanceof Error ? error.message : 'Candidate progression notification could not be queued.';
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
          employer: relationConnect(employer),
          eventType: 'candidate.interview_progression_requested',
          interview: relationConnect(interview),
          metadata: {
            dashboardUrl,
            notificationServiceJobId: typeof jobId === 'undefined' ? null : String(jobId),
            progressionRequestDocumentId: getDocumentId(progressionRequest),
            progressionType: progressionRequest.progressionType || null,
            requestId: requestContext.requestId,
            requestedByEmployerContactDocumentId: getDocumentId(contact),
          },
          priority: 'high',
          recipientEmail: candidateEmail,
          recipientId: getDocumentId(candidate) || undefined,
          recipientType: 'candidate',
          relatedId: getDocumentId(progressionRequest) || undefined,
          relatedType: 'progression_request',
          templateKey: channel === 'email' ? 'generic_branded_message' : undefined,
        },
      })
    )
  );
};

const queueEmployerProgressionExpiredNotification = async ({
  progressionRequest,
  requestContext,
  strapi,
}: {
  progressionRequest: DocumentRecord;
  requestContext: RequestContext;
  strapi: StrapiDocumentService;
}) => {
  const employer = documentRecordValue(progressionRequest.employer);
  const contact = documentRecordValue(progressionRequest.requestedByEmployerContact);
  const candidate = documentRecordValue(progressionRequest.candidate);

  if (!contact?.email) {
    return;
  }

  const subject = 'No response received';
  const dashboardUrl = employerDashboardBaseUrl() + '/interviews';
  const bodyLines = [
    `${candidateDisplayName(candidate)} did not respond to your progression request before the deadline.`,
    'The request has been marked as expired and kept in the interview history.',
  ];
  let emailDeliveryState: 'queued' | 'failed' = 'failed';
  let emailJobId: string | number | undefined;
  let emailErrorMessage: string | undefined;

  try {
    const emailQueueResult = await requestNotificationServiceEmail({
      correlationId: getDocumentId(progressionRequest) || undefined,
      template: {
        key: 'generic_branded_message',
        variables: {
          bodyLines,
          ctaLabel: 'Open interviews',
          ctaUrl: dashboardUrl,
          heading: subject,
          subject,
        },
      },
      to: String(contact.email),
      type: 'employer_interview_progression_expired',
    });

    emailDeliveryState = emailQueueResult.data?.queued === true ? 'queued' : 'failed';
    emailJobId = emailQueueResult.data?.jobId;
  } catch (error) {
    emailErrorMessage =
      error instanceof Error ? error.message : 'Employer progression expiry notification could not be queued.';
  }

  await documents(strapi, 'api::notification-event.notification-event').create({
    data: {
      candidate: relationConnect(candidate),
      channel: 'email',
      deliveryState: emailDeliveryState,
      ...(emailDeliveryState === 'failed' ? { failedAt: new Date().toISOString() } : {}),
      errorMessage: emailErrorMessage || null,
      employer: relationConnect(employer),
      eventType: 'employer.interview_progression_expired',
      interview: relationConnect(progressionRequest.interview),
      metadata: {
        dashboardUrl,
        notificationServiceJobId: typeof emailJobId === 'undefined' ? null : String(emailJobId),
        progressionRequestDocumentId: getDocumentId(progressionRequest),
        requestId: requestContext.requestId,
      },
      priority: 'high',
      recipientEmail: String(contact.email),
      recipientId: getDocumentId(contact) || undefined,
      recipientType: 'employer_contact',
      relatedId: getDocumentId(progressionRequest) || undefined,
      relatedType: 'progression_request',
      templateKey: 'generic_branded_message',
    },
  });
};

const claimOpenLockMinutes = 15;
const reusableSlotTopUpPurpose = 'reusable_slot_top_up';

const addMinutes = (date: Date, minutes: number) => {
  const next = new Date(date);
  next.setUTCMinutes(next.getUTCMinutes() + minutes);
  return next;
};

const activeClaimOpenLock = (
  claim: DocumentRecord,
  currentContactDocumentId: string,
  now = new Date()
) => {
  const openByDocumentId = getDocumentId(claim.currentlyOpenByContact);
  const expiresAt = claim.currentlyOpenExpiresAt
    ? Date.parse(claim.currentlyOpenExpiresAt)
    : Number.NaN;

  if (
    !openByDocumentId ||
    openByDocumentId === currentContactDocumentId ||
    Number.isNaN(expiresAt) ||
    expiresAt <= now.getTime()
  ) {
    return null;
  }

  return {
    contact: claim.currentlyOpenByContact,
    expiresAt: claim.currentlyOpenExpiresAt,
  };
};

const claimOpenByPayload = (claim: DocumentRecord, currentContactDocumentId: string) => {
  const openByContact = claim.currentlyOpenByContact;
  const openByDocumentId = getDocumentId(openByContact);
  const active = Boolean(activeClaimOpenLock(claim, currentContactDocumentId));

  return {
    active,
    contactDocumentId: openByDocumentId,
    email: openByContact?.email || null,
    expiresAt: claim.currentlyOpenExpiresAt || null,
    isCurrentContact: Boolean(openByDocumentId && openByDocumentId === currentContactDocumentId),
    name: openByContact ? contactDisplayName(openByContact) : null,
    openedAt: claim.currentlyOpenAt || null,
  };
};

const slotPayload = (slot: DocumentRecord) => ({
  assignedContactDocumentId: getDocumentId(slot.employerContact),
  assignedContactName: slot.employerContact ? contactDisplayName(slot.employerContact) : null,
  documentId: getDocumentId(slot) || String(slot.id || ''),
  endTime: slot.endTime || null,
  endTimeLabel: formatDateTime(slot.endTime),
  locationLabel: locationLabel(slot),
  locationType: slot.locationType || 'to_be_confirmed',
  slotState: slot.slotState || 'offered',
  startTime: slot.startTime || null,
  startTimeLabel: formatDateTime(slot.startTime),
});

const slotOfferPayload = (offer: DocumentRecord) => ({
  documentId: getDocumentId(offer) || String(offer.id || ''),
  internalNote: offer.internalNote || null,
  offerState: offer.offerState || 'submitted',
  slots: (Array.isArray(offer.slots) ? offer.slots : []).map(slotPayload),
  submittedAt: offer.createdAt || offer.submittedAt || null,
});

const activeEmployerContacts = (employer?: DocumentRecord | null) =>
  (Array.isArray(employer?.contacts) ? employer.contacts : []).filter(
    (contact) => !['archived', 'disabled'].includes(String(contact.contactState || ''))
  );

const capacityClaimDetailPayload = async (
  strapi: StrapiDocumentService,
  claim: DocumentRecord,
  contact: DocumentRecord
) => {
  const request = claim.interviewRequest;
  const classRecord = request?.class;
  const claimRegion = documentRecordValue(claim.region);
  const requestRegion = documentRecordValue(request?.region);
  const contactDocumentId = getDocumentId(contact) || '';
  const contacts = await Promise.all(
    activeEmployerContacts(claim.employer).map((employerContact) =>
      publicContactPayload(strapi, employerContact)
    )
  );
  const lockedByOther = Boolean(activeClaimOpenLock(claim, contactDocumentId));
  const isReusableTopUpClaim = objectValue(claim.metadata).purpose === reusableSlotTopUpPurpose;
  const openClaimStates = isReusableTopUpClaim
    ? ['held', 'notified', 'accepted']
    : ['held', 'notified', 'accepted', 'fulfilled'];

  return {
    assignedContact: claim.employerContact
      ? await publicContactPayload(strapi, claim.employerContact)
      : null,
    canAct: openClaimStates.includes(String(claim.claimState || '')) && !lockedByOther,
    candidateDocumentId: getDocumentId(request?.candidate) || null,
    candidateName: candidateDisplayName(request?.candidate),
    contacts,
    courseLabel: classRecord?.displayTitle || classRecord?.name || 'Interview phase',
    currentlyOpenBy: claimOpenByPayload(claim, contactDocumentId),
    declinedAt: claim.declinedAt || null,
    documentId: getDocumentId(claim) || String(claim.id || ''),
    earliestSlotLabel: '4 working days notice required',
    enrollmentDocumentId: getDocumentId(request?.enrollment) || null,
    expiresAt: claim.expiresAt || null,
    fulfilledAt: claim.fulfilledAt || null,
    interviewRequestDocumentId: getDocumentId(request) || null,
    regionLabel:
      publicClassAreaOption(claimRegion || requestRegion)?.label ||
      'Region not recorded',
    releaseNote: claim.releaseNote || null,
    releaseReason: claim.releaseReason || null,
    requiredSlotCount: boundedSlotCount(claim.requiredSlotCount),
    responseLabel: claim.expiresAt ? formatDateTime(claim.expiresAt) : '2 working days',
    slotOffers: (Array.isArray(claim.slotOffers) ? claim.slotOffers : []).map(slotOfferPayload),
    state: claim.claimState || 'notified',
    statusLabel: humanize(String(claim.claimState || request?.requestState || 'notified')),
  };
};

const findScopedCapacityClaim = async (
  strapi: StrapiDocumentService,
  contact: DocumentRecord,
  capacityClaimDocumentId: string
) => {
  const employerDocumentId = getDocumentId(contact.employer);
  const contactDocumentId = getDocumentId(contact);

  if (!employerDocumentId || !contactDocumentId) {
    throw new ValidationError('Employer contact is not linked to an active employer.');
  }

  const claims = await documents(strapi, 'api::employer-capacity-claim.employer-capacity-claim').findMany({
    filters: {
      documentId: capacityClaimDocumentId,
      employer: {
        documentId: employerDocumentId,
      },
      ...(isLeadContact(contact)
        ? {}
        : {
            employerContact: {
              documentId: contactDocumentId,
            },
          }),
    },
    limit: 1,
    populate: {
      currentlyOpenByContact: true,
      employer: {
        populate: {
          contacts: {
            populate: ['coverageRegions', 'profileImage'],
          },
        },
      },
      employerContact: {
        populate: ['coverageRegions', 'profileImage'],
      },
      interviewRequest: {
        populate: {
          candidate: true,
          class: {
            populate: ['workSector'],
          },
          enrollment: true,
          region: true,
        },
      },
      region: true,
      slotOffers: {
        populate: {
          slots: {
            populate: ['employerContact'],
          },
        },
      },
    },
  });

  const claim = claims[0];

  if (!claim) {
    throw new ValidationError('Interview capacity claim could not be found.');
  }

  return claim;
};

const assertClaimNotLockedByAnother = (claim: DocumentRecord, contactDocumentId: string) => {
  const lock = activeClaimOpenLock(claim, contactDocumentId);

  if (lock) {
    throw new ValidationError(`This request is currently open by ${contactDisplayName(lock.contact || {})}.`);
  }
};

const openCapacityClaimForContact = async (
  strapi: StrapiDocumentService,
  claim: DocumentRecord,
  contactDocumentId: string
) => {
  const now = new Date();
  const claimDocumentId = getDocumentId(claim);

  if (!claimDocumentId) {
    throw new ValidationError('Interview capacity claim could not be updated.');
  }

  assertClaimNotLockedByAnother(claim, contactDocumentId);

  return documents(strapi, 'api::employer-capacity-claim.employer-capacity-claim').update({
    documentId: claimDocumentId,
    data: {
      currentlyOpenAt: now.toISOString(),
      currentlyOpenByContact: {
        connect: [{ documentId: contactDocumentId }],
      },
      currentlyOpenExpiresAt: addMinutes(now, claimOpenLockMinutes).toISOString(),
    },
    populate: {
      currentlyOpenByContact: true,
      employer: {
        populate: {
          contacts: {
            populate: ['coverageRegions', 'profileImage'],
          },
        },
      },
      employerContact: {
        populate: ['coverageRegions', 'profileImage'],
      },
      interviewRequest: {
        populate: {
          candidate: true,
          class: {
            populate: ['workSector'],
          },
          enrollment: true,
          region: true,
        },
      },
      region: true,
      slotOffers: {
        populate: {
          slots: {
            populate: ['employerContact'],
          },
        },
      },
    },
  });
};

const activeSlotOfferStates = ['draft', 'submitted', 'sent'];
const selectedSlotOfferStates = ['candidate_selected', 'completed'];

const cancelSupersededSlotOffers = async (
  strapi: StrapiDocumentService,
  capacityClaim: DocumentRecord,
  requestContext: RequestContext,
  contactDocumentId: string
) => {
  const offers = Array.isArray(capacityClaim.slotOffers) ? capacityClaim.slotOffers : [];

  if (offers.some((offer) => selectedSlotOfferStates.includes(String(offer.offerState || '')))) {
    throw new ValidationError('Slot options cannot be edited after the candidate has responded.');
  }

  await Promise.all(
    offers
      .filter((offer) => activeSlotOfferStates.includes(String(offer.offerState || '')))
      .map(async (offer) => {
        const offerDocumentId = getDocumentId(offer);

        if (!offerDocumentId) {
          return;
        }

        await Promise.all(
          (Array.isArray(offer.slots) ? offer.slots : [])
            .filter((slot) => ['available', 'offered', 'held'].includes(String(slot.slotState || '')))
            .map((slot) => {
              const slotDocumentId = getDocumentId(slot);

              return slotDocumentId
                ? documents(strapi, 'api::interview-slot.interview-slot').update({
                    documentId: slotDocumentId,
                    data: {
                      metadata: {
                        ...objectValue(slot.metadata),
                        cancelledByEmployerContactDocumentId: contactDocumentId,
                        cancelledRequestId: requestContext.requestId,
                        cancelledSource: 'employer_dashboard_offer_edit',
                      },
                      slotState: 'cancelled',
                    },
                  })
                : Promise.resolve({});
            })
        );

        await documents(strapi, 'api::interview-slot-offer.interview-slot-offer').update({
          documentId: offerDocumentId,
          data: {
            metadata: {
              ...objectValue(offer.metadata),
              cancelledByEmployerContactDocumentId: contactDocumentId,
              cancelledRequestId: requestContext.requestId,
              cancelledSource: 'employer_dashboard_offer_edit',
            },
            offerState: 'cancelled',
          },
        });
      })
  );
};

const contactMapForEmployer = (employer?: DocumentRecord | null) =>
  new Map(
    activeEmployerContacts(employer)
      .map((contact) => [getDocumentId(contact), contact] as const)
      .filter((entry): entry is readonly [string, DocumentRecord] => Boolean(entry[0]))
  );

const assertSlotContact = ({
  actorContact,
  contactMap,
  fallbackContactDocumentId,
  regionDocumentId,
  requestedContactDocumentId,
}: {
  actorContact: DocumentRecord;
  contactMap: Map<string, DocumentRecord>;
  fallbackContactDocumentId: string;
  regionDocumentId?: string | null;
  requestedContactDocumentId?: string;
}) => {
  const assignedContactDocumentId = requestedContactDocumentId || fallbackContactDocumentId;
  const assignedContact = contactMap.get(assignedContactDocumentId);

  if (!assignedContact) {
    throw new ValidationError('Assigned interview contact is not linked to this employer.');
  }

  if (!isLeadContact(actorContact) && assignedContactDocumentId !== fallbackContactDocumentId) {
    throw new ValidationError('Team contacts can only assign interview slots to themselves.');
  }

  if (
    regionDocumentId &&
    !isLeadContact(assignedContact) &&
    !regionDocumentIds(assignedContact.coverageRegions).includes(regionDocumentId)
  ) {
    throw new ValidationError('Assigned interview contact does not cover this request region.');
  }

  return {
    assignedContact,
    assignedContactDocumentId,
  };
};

const interviewContactPayloads = async (strapi: StrapiDocumentService, employer?: DocumentRecord | null) =>
  Promise.all(activeEmployerContacts(employer).map((contact) => publicContactPayload(strapi, contact)));

const interviewDetailPayload = async (
  strapi: StrapiDocumentService,
  interview: DocumentRecord,
  contact: DocumentRecord
) => {
  const slot = documentRecordValue(interview.interviewSlot);
  const assignedContact = documentRecordValue(interview.employerContact);
  const locationType = interview.locationType || slot?.locationType || 'to_be_confirmed';
  const locationRecord = {
    locationDetails: interview.locationDetails || slot?.locationDetails,
    locationType,
    meetingUrl: interview.meetingUrl || slot?.meetingUrl,
  } as DocumentRecord;
  const closedStates = ['completed', 'candidate_no_show', 'candidate_declined', 'employer_cancelled', 'cancelled'];

  return {
    account: await accountPayload(strapi, contact),
    interview: {
      assignedContactDocumentId: getDocumentId(assignedContact) || null,
      assignedContactName: assignedContact ? contactDisplayName(assignedContact) : null,
      arrivalInstructions: interview.arrivalInstructions || null,
      canEdit: !closedStates.includes(String(interview.interviewState || '')),
      candidateEmail: interview.candidate?.email || null,
      candidateInstructions: interview.candidateInstructions || null,
      candidateName: candidateDisplayName(interview.candidate),
      contacts: await interviewContactPayloads(strapi, contact.employer),
      detailsProvidedAt: interview.detailsProvidedAt || null,
      detailsUpdatedAt: interview.detailsUpdatedAt || null,
      documentId: getDocumentId(interview) || String(interview.id || ''),
      interviewerName: interview.interviewerName || (assignedContact ? contactDisplayName(assignedContact) : null),
      locationDetails: interview.locationDetails || slot?.locationDetails || null,
      locationLabel: locationLabel(locationRecord),
      locationType,
      meetingUrl: interview.meetingUrl || slot?.meetingUrl || null,
      scheduledEndTime: interview.scheduledEndTime || slot?.endTime || null,
      scheduledEndTimeLabel: formatDateTime(interview.scheduledEndTime || slot?.endTime),
      scheduledStartTime: interview.scheduledStartTime || slot?.startTime || null,
      scheduledStartTimeLabel: formatDateTime(interview.scheduledStartTime || slot?.startTime),
      state: interview.interviewState || 'awaiting_employer_details',
      statusLabel: humanize(String(interview.interviewState || 'awaiting_employer_details')),
    },
    generatedAt: new Date().toISOString(),
  };
};

const interviewFeedbackDetailPayload = async (
  strapi: StrapiDocumentService,
  interview: DocumentRecord,
  contact: DocumentRecord,
  feedback?: DocumentRecord | null
) => {
  const slot = documentRecordValue(interview.interviewSlot);
  const previousTakeaways = await findPreviousCandidateReportTakeaways(strapi, interview);
  const interviewDocumentId = getDocumentId(interview) || String(interview.id || '');
  const additionalFeedbackInvites = interviewDocumentId
    ? await findFeedbackInvitesForInterview(strapi, interviewDocumentId)
    : [];

  return {
    account: await accountPayload(strapi, contact),
    additionalFeedbackInvites: additionalFeedbackInvites.map(feedbackInvitePayload),
    feedback: employerFeedbackPayload(feedback),
    generatedAt: new Date().toISOString(),
    interview: {
      candidateEmail: interview.candidate?.email || null,
      candidateName: candidateDisplayName(interview.candidate),
      completedAt: interview.completedAt || null,
      completedAtLabel: formatDateTime(interview.completedAt),
      documentId: interviewDocumentId,
      employerContactName: interview.employerContact
        ? contactDisplayName(documentRecordValue(interview.employerContact) || {})
        : null,
      locationLabel: locationLabel({
        locationDetails: interview.locationDetails || slot?.locationDetails,
        locationType: interview.locationType || slot?.locationType || 'to_be_confirmed',
        meetingUrl: interview.meetingUrl || slot?.meetingUrl,
      } as DocumentRecord),
      scheduledEndTime: interview.scheduledEndTime || slot?.endTime || null,
      scheduledEndTimeLabel: formatDateTime(interview.scheduledEndTime || slot?.endTime),
      scheduledStartTime: interview.scheduledStartTime || slot?.startTime || null,
      scheduledStartTimeLabel: formatDateTime(interview.scheduledStartTime || slot?.startTime),
      state: interview.interviewState || 'completed',
      statusLabel: humanize(String(interview.interviewState || 'completed')),
    },
    previousTakeaways,
    reportReadiness: feedbackReportReadinessPayload(feedback, additionalFeedbackInvites),
    rules: {
      previousTakeawayAssessmentRequired: previousTakeaways.length > 0,
      rawFeedbackCandidateVisible: false,
    },
  };
};

const findScopedInterview = async (
  strapi: StrapiDocumentService,
  contact: DocumentRecord,
  interviewDocumentId: string
) => {
  const employerDocumentId = getDocumentId(contact.employer);
  const contactDocumentId = getDocumentId(contact);

  if (!employerDocumentId || !contactDocumentId) {
    throw new ValidationError('Employer contact is not linked to an active employer.');
  }

  const interviews = await documents(strapi, 'api::interview.interview').findMany({
    filters: {
      documentId: interviewDocumentId,
      employer: {
        documentId: employerDocumentId,
      },
      ...(isLeadContact(contact)
        ? {}
        : {
            employerContact: {
              documentId: contactDocumentId,
            },
          }),
    },
    limit: 1,
    populate: {
      candidate: true,
      employer: {
        populate: {
          contacts: {
            populate: ['coverageRegions', 'profileImage'],
          },
          operatingRegions: true,
        },
      },
      employerContact: {
        populate: ['coverageRegions', 'profileImage'],
      },
      enrollment: {
        populate: ['class'],
      },
      interviewSlot: {
        populate: ['employerContact'],
      },
    },
  });
  const interview = interviews[0];

  if (!interview) {
    throw new ValidationError('Interview could not be found.');
  }

  return interview;
};

const assertInterviewSetupDetails = (body: ReturnType<typeof validateInterviewSetup>) => {
  if (body.locationType === 'to_be_confirmed') {
    throw new ValidationError('Select an interview type before confirming details.');
  }

  if (body.locationType === 'online' && !body.meetingUrl) {
    throw new ValidationError('Online interviews need a meeting link.');
  }

  if (body.locationType === 'in_person' && !body.locationDetails) {
    throw new ValidationError('In-person interviews need location details.');
  }

  if (
    body.locationType === 'phone' &&
    !body.locationDetails &&
    !body.candidateInstructions
  ) {
    throw new ValidationError('Phone interviews need call details or candidate instructions.');
  }
};

const resolveInterviewAssignedContact = ({
  actorContact,
  interview,
  requestedContactDocumentId,
}: {
  actorContact: DocumentRecord;
  interview: DocumentRecord;
  requestedContactDocumentId?: string;
}) => {
  const actorContactDocumentId = getDocumentId(actorContact);
  const currentContactDocumentId = getDocumentId(interview.employerContact);
  const employerContactMap = contactMapForEmployer(actorContact.employer);
  const assignedContactDocumentId =
    requestedContactDocumentId || currentContactDocumentId || actorContactDocumentId;

  if (!actorContactDocumentId || !assignedContactDocumentId) {
    throw new ValidationError('Employer contact record could not be found.');
  }

  const assignedContact = employerContactMap.get(assignedContactDocumentId);

  if (!assignedContact) {
    throw new ValidationError('Assigned interview contact is not linked to this employer.');
  }

  if (!isLeadContact(actorContact) && assignedContactDocumentId !== actorContactDocumentId) {
    throw new ValidationError('Team contacts can only confirm their own interviews.');
  }

  return {
    assignedContact,
    assignedContactDocumentId,
  };
};

const queueCandidateInterviewDetailsNotification = async ({
  contact,
  interview,
  requestContext,
  strapi,
}: {
  contact: DocumentRecord;
  interview: DocumentRecord;
  requestContext: RequestContext;
  strapi: StrapiDocumentService;
}) => {
  const candidate = documentRecordValue(interview.candidate);
  const candidateEmail = typeof candidate?.email === 'string' ? candidate.email : null;
  const subject = 'Your interview details are ready';
  const dashboardUrl = candidateDashboardInterviewsUrl();
  const candidateName = candidate?.firstName || 'there';
  const bodyLines = [
    `Hi ${candidateName},`,
    `${contact.employer?.companyName || 'Your employer'} has confirmed the details for your interview.`,
    'Review the final location, joining instructions, and interviewer details in your HireFlip dashboard.',
  ];
  let emailDeliveryState: 'queued' | 'failed' = 'failed';
  let emailJobId: string | number | undefined;
  let emailErrorMessage: string | undefined;

  if (candidateEmail) {
    try {
      const emailQueueResult = await requestNotificationServiceEmail({
        correlationId: getDocumentId(interview) || undefined,
        template: {
          key: 'generic_branded_message',
          variables: {
            bodyLines,
            ctaLabel: 'View interview details',
            ctaUrl: dashboardUrl,
            heading: subject,
            subject,
          },
        },
        to: candidateEmail,
        type: 'candidate_interview_details_updated',
      });

      emailDeliveryState = emailQueueResult.data?.queued === true ? 'queued' : 'failed';
      emailJobId = emailQueueResult.data?.jobId;
    } catch (error) {
      emailErrorMessage =
        error instanceof Error ? error.message : 'Candidate interview detail notification could not be queued.';
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
          eventType: 'candidate.interview_details_updated',
          interview: relationConnect(interview),
          metadata: {
            dashboardUrl,
            notificationServiceJobId: typeof jobId === 'undefined' ? null : String(jobId),
            requestId: requestContext.requestId,
            updatedByEmployerContactDocumentId: getDocumentId(contact),
          },
          priority: 'urgent',
          recipientEmail: candidateEmail,
          recipientId: getDocumentId(candidate) || undefined,
          recipientType: 'candidate',
          relatedId: getDocumentId(interview) || undefined,
          relatedType: 'interview',
          templateKey: channel === 'email' ? 'generic_branded_message' : undefined,
        },
      })
    )
  );
};

export default ({ strapi }) => ({
  async reconcileCandidateFeedbackReports(limit = 100, requestContext: RequestContext = {}) {
    const dueFeedback = await documents(strapi, 'api::interview-feedback.interview-feedback').findMany({
      filters: {
        candidateReportNextRetryAt: {
          $lte: new Date().toISOString(),
        },
        candidateReportState: 'pending',
      },
      limit,
      populate: {
        interview: {
          populate: ['candidate', 'employer'],
        },
      },
      sort: ['candidateReportNextRetryAt:asc', 'updatedAt:asc'],
    });
    const summary = {
      checked: dueFeedback.length,
      errors: [] as Array<{ error: string; feedbackDocumentId?: string }>,
      generated: 0,
      rescheduled: 0,
      skipped: 0,
      failed: 0,
    };

    for (const feedback of dueFeedback) {
      const feedbackDocumentId = getDocumentId(feedback);

      try {
        const interview = documentRecordValue(feedback.interview);

        if (!feedbackDocumentId || !interview?.documentId) {
          summary.skipped += 1;
          continue;
        }

        const result = await maybeGenerateCandidateFeedbackReport({
          interview,
          requestContext: {
            ...requestContext,
            serviceName: requestContext.serviceName || 'class-workflow-worker',
          },
          strapi,
        });
        const state = String(result?.candidateReportState || 'pending');

        if (state === 'generated') {
          summary.generated += 1;
        } else if (state === 'failed') {
          summary.failed += 1;
        } else if (result?.candidateReportNextRetryAt) {
          summary.rescheduled += 1;
        } else {
          summary.skipped += 1;
        }
      } catch (error) {
        summary.errors.push({
          error: error instanceof Error ? error.message : String(error),
          feedbackDocumentId,
        });
      }
    }

    return summary;
  },

  async reconcileInterviewProgressionRequests(limit = 100, requestContext: RequestContext = {}) {
    const now = new Date().toISOString();
    const progressionRequests = await documents(strapi, 'api::offer.offer').findMany({
      filters: {
        candidateResponseDeadline: {
          $lte: now,
        },
        progressionState: {
          $in: activeProgressionStates,
        },
      },
      limit,
      populate: progressionRequestPopulate,
      sort: ['candidateResponseDeadline:asc', 'updatedAt:asc'],
    });
    const summary = {
      checked: progressionRequests.length,
      errors: [] as Array<{ error: string; progressionRequestDocumentId?: string }>,
      expired: 0,
      skipped: 0,
    };

    for (const progressionRequest of progressionRequests) {
      const progressionRequestDocumentId = getDocumentId(progressionRequest);

      try {
        if (!progressionRequestDocumentId) {
          summary.skipped += 1;
          continue;
        }

        const expiredRequest = await documents(strapi, 'api::offer.offer').update({
          documentId: progressionRequestDocumentId,
          data: {
            candidateResponse: 'expired',
            candidateRespondedAt: now,
            metadata: {
              ...objectValue(progressionRequest.metadata),
              expiredBy: requestContext.serviceName || 'class-workflow-worker',
              expiredReason: 'No response received',
              requestId: requestContext.requestId,
            },
            progressionState: 'expired',
          },
          populate: progressionRequestPopulate,
        });

        await auditEvents(strapi).record({
          actorId: 'system',
          actorType: 'system',
          eventCategory: 'interview',
          eventType: 'candidate.interview_progression_expired',
          metadata: {
            progressionRequestDocumentId,
            reason: 'No response received',
            requestId: requestContext.requestId,
          },
          requestId: requestContext.requestId,
          serviceName: requestContext.serviceName || 'class-workflow-worker',
          severity: 'warning',
          source: 'core_api',
          subjectDisplayName: candidateDisplayName(progressionRequest.candidate),
          subjectId: progressionRequestDocumentId,
          subjectType: 'progression_request',
        });

        await queueEmployerProgressionExpiredNotification({
          progressionRequest: expiredRequest,
          requestContext,
          strapi,
        });
        await publishAdminRealtimeEvent(
          {
            channels: ['operations'],
            resourceKey: progressionRequestDocumentId,
            resourceType: 'progression_request',
            type: 'admin_tasks_changed',
          },
          strapi.log
        );
        summary.expired += 1;
      } catch (error) {
        summary.errors.push({
          error: error instanceof Error ? error.message : String(error),
          progressionRequestDocumentId,
        });
      }
    }

    return summary;
  },

  async validateInvite(input: unknown) {
    const body = validateInviteToken(input);
    const invite = await assertValidInvite(strapi, body.inviteToken);

    return {
      invite: publicInvitePayload(invite),
      valid: true,
    };
  },

  async createInviteSetupTicket(input: unknown) {
    const body = validateInviteToken(input);
    const invite = await assertValidInvite(strapi, body.inviteToken);
    const inviteDocumentId = getDocumentId(invite);
    const authIdentityId = invite.authIdentityId || invite.employerContact?.authIdentityId;

    if (!inviteDocumentId) {
      throw new ValidationError('Employer invite could not be updated.');
    }

    if (!authIdentityId) {
      throw new ValidationError('Employer invite has not been provisioned for sign-in yet.');
    }

    if (
      invite.authPasswordTicketUrl &&
      invite.authPasswordTicketExpiresAt &&
      Date.parse(invite.authPasswordTicketExpiresAt) > Date.now() + 300_000
    ) {
      return {
        setupUrl: invite.authPasswordTicketUrl,
      };
    }

    const ticket = await getAuth0ManagementClient().createPasswordSetupTicket({
      inviteUrl: employerInviteUrl(body.inviteToken),
      userId: authIdentityId,
    });

    await documents(strapi, 'api::employer-invite.employer-invite').update({
      documentId: inviteDocumentId,
      data: {
        authPasswordTicketCreatedAt: new Date().toISOString(),
        authPasswordTicketExpiresAt: ticket.expiresAt,
        authPasswordTicketUrl: ticket.ticketUrl,
        metadata: {
          ...(invite.metadata && typeof invite.metadata === 'object' ? invite.metadata : {}),
          setupTicketRefreshedAt: new Date().toISOString(),
        },
      },
    });

    return {
      setupUrl: ticket.ticketUrl,
    };
  },

  async acceptInvite(input: unknown, requestContext: RequestContext = {}) {
    const body = validateAcceptInvite(input);
    const invite = await assertValidInvite(strapi, body.inviteToken);

    if (!body.email) {
      throw new ValidationError('Employer sign-in did not include a verified identity and email.');
    }

    const identity = {
      authIdentityId: body.authIdentityId,
      email: body.email,
      name: body.name,
    };
    const verifiedInvite = await ensureInviteMatchesIdentity(
      strapi,
      invite,
      identity,
      requestContext
    );

    return acceptInviteRecord(
      strapi,
      verifiedInvite,
      identity,
      requestContext
    );
  },

	  async acceptPendingInvite(input: unknown, requestContext: RequestContext = {}) {
	    const identity = validateIdentity(input);

    if (!identity.authIdentityId || !identity.email) {
      throw new ValidationError('Employer sign-in did not include a verified identity and email.');
    }

    const invite = await findPendingInviteForIdentity(
      strapi,
      {
        authIdentityId: identity.authIdentityId,
        email: identity.email,
      },
      requestContext
    );

    return acceptInviteRecord(
      strapi,
      invite,
      {
        authIdentityId: identity.authIdentityId,
        email: identity.email,
      },
      requestContext
	    );
	  },

	  async getOnboarding(input: unknown) {
	    const identity = validateIdentity(input);
	    const contact = await findEmployerContact(strapi, identity);
	    const [availableRegions, termsPolicy] = await Promise.all([
	      getOperationalClassAreas(strapi),
	      findActivePolicyDocument(strapi, 'employer_terms'),
	    ]);

	    return {
	      account: await accountPayload(strapi, contact),
	      generatedAt: new Date().toISOString(),
	      onboarding: await onboardingPayload(strapi, contact, {
	        availableRegions,
	        termsPolicy,
	      }),
	    };
	  },

	  async completeOnboarding(input: unknown, requestContext: RequestContext = {}) {
	    const body = validateCompleteOnboarding(input);
	    const contact = await findEmployerContact(strapi, body);
	    const employer = contact.employer;
	    const employerDocumentId = getDocumentId(employer);
	    const contactDocumentId = getDocumentId(contact);

	    if (!employerDocumentId) {
	      throw new ValidationError('Employer record could not be found.');
	    }

	    if (!contactDocumentId) {
	      throw new ValidationError('Employer contact record could not be found.');
	    }

	    const termsPolicy = await findActivePolicyDocument(strapi, 'employer_terms');

	    if (!termsPolicy?.documentId || !termsPolicy.version) {
	      throw new ValidationError('Active employer terms are not configured.');
	    }

	    if (
	      body.acceptedTermsPolicyDocumentId !== termsPolicy.documentId ||
	      body.acceptedTermsPolicyVersion !== termsPolicy.version
	    ) {
	      throw new ValidationError('Employer terms have changed. Refresh and accept the latest terms.');
	    }

	    const operatingRegions = await assertOperationalRegionsByDocumentId(
	      strapi,
	      body.operatingRegionDocumentIds
	    );
	    const now = new Date().toISOString();
	    const requestedCadence = body.interviewCommitmentCadence;
	    const requestedVolume = body.interviewCommitmentVolume;
	    const initialVolume = employer?.initialInterviewCommitmentVolume;
	    const initialCadence = String(employer?.initialInterviewCommitmentCadence || 'not_set');
	    const capacityReviewNeeded =
	      typeof initialVolume === 'number' &&
	      initialVolume > 0 &&
	      initialCadence !== 'not_set' &&
	      annualizedCommitment(requestedVolume, requestedCadence) <
	        annualizedCommitment(initialVolume, initialCadence);
	    const leadContactUpdate = await documents(strapi, 'api::employer-contact.employer-contact').update({
	      documentId: contactDocumentId,
	      data: {
	        contactRole: 'lead_contact',
	        coverageConfirmedAt: now,
	        coverageConfirmedByEmail: body.email || contact.email || null,
	        coverageRegions: regionSetRelationData(operatingRegions),
	        firstName: body.contactFirstName,
	        lastName: body.contactLastName,
	        phone: body.contactPhone || null,
	        roleTitle: body.contactRoleTitle || null,
	      },
	      populate: ['coverageRegions'],
	    });

	    await upsertListedTeamContacts(strapi, {
	      employerDocumentId,
	      leadContactDocumentId: contactDocumentId,
	      operatingRegions,
	      teamContacts: body.teamContacts.filter((teamContact) => teamContact.email !== contact.email),
	    });

	    const updatedEmployer = await documents(strapi, 'api::employer.employer').update({
	      documentId: employerDocumentId,
	      data: {
	        capacityChangeRequestStatus: capacityReviewNeeded
	          ? 'pending'
	          : employer?.capacityChangeRequestStatus || 'none',
	        commitmentMode: body.commitmentMode,
	        companyName: body.companyName,
	        dashboardOnboardingCompletedAt: now,
	        dashboardOnboardingMetadata: {
	          ...(employer?.dashboardOnboardingMetadata &&
	          typeof employer.dashboardOnboardingMetadata === 'object'
	            ? employer.dashboardOnboardingMetadata
	            : {}),
	          completedRequestId: requestContext.requestId,
	          completedUserAgent: requestContext.userAgent,
	          initialInterviewCommitmentCadence: initialCadence,
	          initialInterviewCommitmentVolume: initialVolume ?? null,
	          teamContactsSubmitted: body.teamContacts.length,
	        },
	        dashboardOnboardingState: 'complete',
	        employerState: 'active',
	        employerTermsAcceptedAt: now,
	        employerTermsAcceptedByEmail: body.email || contact.email || null,
	        employerTermsPolicyDocumentId: termsPolicy.documentId,
	        employerTermsPolicyVersion: termsPolicy.version,
	        interviewCommitmentCadence: requestedCadence,
	        interviewCommitmentVolume: requestedVolume,
	        operatingRegions: regionSetRelationData(operatingRegions),
	        region: String(operatingRegions[0]?.name || '').trim() || null,
	      },
	      populate: {
	        contacts: {
	          populate: ['coverageRegions'],
	        },
	        operatingRegions: true,
	      },
	    });

	    await syncRegionCommitments(strapi, {
	      commitmentMode: body.commitmentMode,
	      employerDocumentId,
	      operatingRegions,
	      regionCommitments: [],
	      requestedCadence,
	      requestedVolume,
	      updatedByEmail: body.email || contact.email || undefined,
	    });

	    if (capacityReviewNeeded) {
	      await createCapacityChangeRequestIfNeeded(strapi, {
	        contactDocumentId,
	        employer: employer || {},
	        employerDocumentId,
	        requestContext,
	        requestedCadence,
	        requestedVolume,
	      });
	    }

	    await auditEvents(strapi).record({
	      actorDisplayName: contactDisplayName(leadContactUpdate),
	      actorEmail: body.email || contact.email || undefined,
	      actorId: contactDocumentId,
	      actorType: 'employer_contact',
	      eventCategory: 'employer',
	      eventType: 'employer.onboarding.completed',
	      ipAddress: requestContext.ipAddress,
	      metadata: {
	        acceptedTermsPolicyDocumentId: termsPolicy.documentId,
	        acceptedTermsPolicyVersion: termsPolicy.version,
	        capacityReviewNeeded,
	        operatingRegionDocumentIds: body.operatingRegionDocumentIds,
	        teamContactsSubmitted: body.teamContacts.length,
	      },
	      requestId: requestContext.requestId,
	      serviceName: requestContext.serviceName,
	      severity: capacityReviewNeeded ? 'warning' : 'info',
	      source: 'employer_dashboard',
	      subjectDisplayName: updatedEmployer.companyName || body.companyName,
	      subjectId: employerDocumentId,
	      subjectType: 'employer',
	      userAgent: requestContext.userAgent,
	    });

	    const refreshedContact = await findEmployerContact(strapi, body);

	    return {
	      account: await accountPayload(strapi, refreshedContact),
	      completed: true,
	      onboarding: await onboardingPayload(strapi, refreshedContact, {
	        availableRegions: await getOperationalClassAreas(strapi),
	        termsPolicy,
	      }),
	    };
	  },

	  async updateSettings(input: unknown, requestContext: RequestContext = {}) {
	    const body = validateUpdateSettings(input);
	    const contact = await findEmployerContact(strapi, body);
	    assertLeadContact(contact);

	    const employer = contact.employer;
	    const employerDocumentId = getDocumentId(employer);
	    const contactDocumentId = getDocumentId(contact);

	    if (!employerDocumentId) {
	      throw new ValidationError('Employer record could not be found.');
	    }

	    if (!contactDocumentId) {
	      throw new ValidationError('Employer contact record could not be found.');
	    }

	    const operatingRegions = await assertOperationalRegionsByDocumentId(
	      strapi,
	      body.operatingRegionDocumentIds
	    );
	    const operatingRegionDocumentIds = new Set(regionDocumentIds(operatingRegions));
	    const coverageRegions = operatingRegions.filter((region) =>
	      body.coverageRegionDocumentIds.includes(getDocumentId(region) || '')
	    );

	    if (coverageRegions.length !== body.coverageRegionDocumentIds.length) {
	      throw new ValidationError('Interview Region Coverage must use selected operating regions.');
	    }

	    const previousRegionIds = new Set(regionDocumentIds(employer?.operatingRegions));
	    const requestedRegionIds = new Set(body.operatingRegionDocumentIds);
	    const removedRegionIds = Array.from(previousRegionIds).filter(
	      (documentId) => !requestedRegionIds.has(documentId)
	    );
	    const removedRegions = (employer?.operatingRegions || []).filter((region) =>
	      removedRegionIds.includes(getDocumentId(region) || '')
	    );
	    const currentVolume =
	      typeof employer?.interviewCommitmentVolume === 'number'
	        ? employer.interviewCommitmentVolume
	        : 0;
	    const currentCadence = String(employer?.interviewCommitmentCadence || 'not_set');
	    const currentCommitmentMode =
	      employer?.commitmentMode === 'per_region' ? 'per_region' : 'global';
	    const currentAnnualized = employerAnnualizedCommitment(employer);
	    const requestedAnnualized = requestedSettingsAnnualizedCommitment(body);
	    const capacityReductionNeeded = requestedAnnualized < currentAnnualized;
	    const reviewNoteRequired = capacityReductionNeeded || removedRegionIds.length > 0;

	    if (reviewNoteRequired && !body.reviewNote) {
	      throw new ValidationError('A reason is required when reducing interview commitment or removing operating regions.');
	    }

	    const capacityReview = await createSettingsCapacityReviewIfNeeded(strapi, {
	      contact,
	      changeScope:
	        currentCommitmentMode === 'per_region' || body.commitmentMode === 'per_region'
	          ? 'per_region'
	          : 'global',
	      currentCadence,
	      currentAnnualized,
	      currentCommitmentMode,
	      currentVolume,
	      employerDocumentId,
	      metadata: {
	        requestedRegionCommitments: body.regionCommitments,
	      },
	      reason: body.reviewNote,
	      requestedAnnualized,
	      requestedCadence: body.interviewCommitmentCadence,
	      requestedCommitmentMode: body.commitmentMode,
	      requestedVolume: body.interviewCommitmentVolume,
	      requestContext,
	    });
	    const reviewNeeded = Boolean(capacityReview || removedRegionIds.length > 0);
	    const now = new Date().toISOString();

	    await syncRegionCommitments(strapi, {
	      commitmentMode: body.commitmentMode,
	      employerDocumentId,
	      operatingRegions,
	      regionCommitments: body.regionCommitments,
	      requestedCadence: body.interviewCommitmentCadence,
	      requestedVolume: body.interviewCommitmentVolume,
	      updatedByEmail: body.email || contact.email || undefined,
	    });

	    await documents(strapi, 'api::employer-contact.employer-contact').update({
	      documentId: contactDocumentId,
	      data: {
	        coverageConfirmedAt: body.coverageConfirmed
	          ? now
	          : contact.coverageConfirmedAt || null,
	        coverageConfirmedByEmail: body.coverageConfirmed
	          ? body.email || contact.email || null
	          : contact.coverageConfirmedByEmail || null,
	        coverageRegions: regionSetRelationData(coverageRegions),
	      },
	    });

	    const updatedEmployer = await documents(strapi, 'api::employer.employer').update({
	      documentId: employerDocumentId,
	      data: {
	        capacityChangeRequestStatus: reviewNeeded
	          ? 'pending'
	          : employer?.capacityChangeRequestStatus || 'none',
	        commitmentMode: body.commitmentMode,
	        companyName: body.companyName,
	        interviewCommitmentCadence: body.interviewCommitmentCadence,
	        interviewCommitmentVolume: body.interviewCommitmentVolume,
	        operatingRegions: regionSetRelationData(operatingRegions),
	        region: String(operatingRegions[0]?.name || '').trim() || null,
	      },
	      populate: {
	        contacts: {
	          populate: ['coverageRegions'],
	        },
	        operatingRegions: true,
	        regionCommitments: {
	          populate: ['region'],
	        },
	      },
	    });

	    if (removedRegionIds.length > 0) {
	      await createEmployerReviewAuditEvent(strapi, {
	        contact,
	        eventType: 'employer.operating_regions_removed',
	        metadata: {
	          removedRegionDocumentIds: removedRegionIds,
	          removedRegionNames: regionNames(publicRegionOptions(removedRegions)),
	          requestedOperatingRegionDocumentIds: body.operatingRegionDocumentIds,
	          reviewNote: body.reviewNote || null,
	        },
	        requestContext,
	        summary: 'Employer operating regions removed',
	      });
	    }

	    await auditEvents(strapi).record({
	      actorDisplayName: contactDisplayName(contact),
	      actorEmail: body.email || contact.email || undefined,
	      actorId: contactDocumentId,
	      actorType: 'employer_contact',
	      eventCategory: 'employer',
	      eventType: 'employer.settings.updated',
	      ipAddress: requestContext.ipAddress,
	      metadata: {
	        commitmentMode: body.commitmentMode,
	        coverageConfirmed: body.coverageConfirmed,
	        operatingRegionDocumentIds: body.operatingRegionDocumentIds,
	        reviewNeeded,
	      },
	      requestId: requestContext.requestId,
	      serviceName: requestContext.serviceName,
	      severity: reviewNeeded ? 'warning' : 'info',
	      source: 'employer_dashboard',
	      subjectDisplayName: updatedEmployer.companyName || body.companyName,
	      subjectId: employerDocumentId,
	      subjectType: 'employer',
	      userAgent: requestContext.userAgent,
	    });

	    const refreshedContact = await findEmployerContact(strapi, body);

	    return {
	      account: await accountPayload(strapi, refreshedContact),
	      settings: {
	        reviewNeeded,
	        updated: true,
	      },
	    };
	  },

	  async updateProfile(input: unknown, requestContext: RequestContext = {}) {
	    const body = validateUpdateProfile(input);
	    const contact = await findEmployerContact(strapi, body);
	    const contactDocumentId = getDocumentId(contact);

	    if (!contactDocumentId) {
	      throw new ValidationError('Employer contact record could not be found.');
	    }

	    await documents(strapi, 'api::employer-contact.employer-contact').update({
	      documentId: contactDocumentId,
	      data: {
	        firstName: body.firstName,
	        lastName: body.lastName,
	        phone: body.phone,
	        roleTitle: body.roleTitle,
	      },
	    });

	    await auditEvents(strapi).record({
	      actorDisplayName: contactDisplayName(contact),
	      actorEmail: body.email || contact.email || undefined,
	      actorId: contactDocumentId,
	      actorType: 'employer_contact',
	      eventCategory: 'employer',
	      eventType: 'employer.contact_profile_updated',
	      ipAddress: requestContext.ipAddress,
	      metadata: {
	        changedFields: ['firstName', 'lastName', 'phone', 'roleTitle'],
	      },
	      requestId: requestContext.requestId,
	      serviceName: requestContext.serviceName,
	      severity: 'info',
	      source: 'employer_dashboard',
	      subjectDisplayName: `${body.firstName} ${body.lastName}`.trim(),
	      subjectId: contactDocumentId,
	      subjectType: 'employer_contact',
	      userAgent: requestContext.userAgent,
	    });

	    const refreshedContact = await findEmployerContact(strapi, body);

	    return {
	      account: await accountPayload(strapi, refreshedContact),
	      onboarding: await onboardingPayload(strapi, refreshedContact, {
	        availableRegions: await getOperationalClassAreas(strapi),
	        termsPolicy: await findActivePolicyDocument(strapi, 'employer_terms'),
	      }),
	      profile: await publicContactPayload(strapi, refreshedContact),
	      updated: true,
	    };
	  },

	  async updateProfileImage(input: unknown, file: UploadedFile | undefined, requestContext: RequestContext = {}) {
	    const identity = validateIdentity(input);
	    const contact = await findEmployerContact(strapi, identity);
	    const contactDocumentId = getDocumentId(contact);

	    if (!contactDocumentId || !contact.id) {
	      throw new ValidationError('Employer contact record could not be found.');
	    }

	    const previousProfileImage = contact.profileImage;
	    const processedImage = await processEmployerProfileImage(file);

	    try {
	      const uploadedFiles = await strapi.plugin('upload').service('upload').upload({
	        data: {
	          fileInfo: {
	            alternativeText: `${contactDisplayName(contact)} profile image`,
	            name: `employer-contact-profile-${contactDocumentId}.${processedImage.format}`,
	          },
	          field: 'profileImage',
	          ref: 'api::employer-contact.employer-contact',
	          refId: contact.id,
	        },
	        files: {
	          filepath: processedImage.outputPath,
	          mimetype: processedImage.mime,
	          originalFilename: `employer-contact-profile-${contactDocumentId}.${processedImage.format}`,
	          size: processedImage.sizeInBytes,
	        },
	      });

	      const uploadedFile = uploadedFiles[0];

	      if (!uploadedFile?.id) {
	        throw new ValidationError('Profile image upload did not return a stored file.');
	      }

	      await documents(strapi, 'api::employer-contact.employer-contact').update({
	        documentId: contactDocumentId,
	        data: {
	          profileImage: uploadedFile.id,
	        },
	      });

	      const refreshedContact = await findEmployerContact(strapi, identity);
	      const sanitizedProfileImage = await sanitizeEmployerProfileImage(
	        strapi,
	        refreshedContact.profileImage
	      );

	      await auditEvents(strapi).record({
	        actorDisplayName: contactDisplayName(refreshedContact),
	        actorEmail: identity.email || refreshedContact.email || undefined,
	        actorId: contactDocumentId,
	        actorType: 'employer_contact',
	        eventCategory: 'employer',
	        eventType: 'employer.contact_profile_image_updated',
	        ipAddress: requestContext.ipAddress,
	        newState: {
	          profileImage: sanitizedProfileImage,
	        },
	        requestId: requestContext.requestId,
	        serviceName: requestContext.serviceName,
	        severity: 'info',
	        source: 'employer_dashboard',
	        subjectDisplayName: contactDisplayName(refreshedContact),
	        subjectId: contactDocumentId,
	        subjectType: 'employer_contact',
	        userAgent: requestContext.userAgent,
	      });

	      if (previousProfileImage?.id && previousProfileImage.id !== uploadedFile.id) {
	        await strapi.plugin('upload').service('upload').remove(previousProfileImage).catch((error) => {
	          strapi.log?.warn(
	            `Could not remove previous employer contact profile image ${previousProfileImage.id}: ${
	              error instanceof Error ? error.message : String(error)
	            }`
	          );
	        });
	      }

	      return {
	        account: await accountPayload(strapi, refreshedContact),
	        profile: await publicContactPayload(strapi, refreshedContact),
	        profileImage: sanitizedProfileImage,
	        updated: true,
	      };
	    } finally {
	      await rm(processedImage.tmpDir, { force: true, recursive: true });
	    }
	  },

	  async inviteTeamContact(input: unknown, requestContext: RequestContext = {}) {
	    const body = validateInviteTeamContact(input);
	    const leadContact = await findEmployerContact(strapi, body);
	    assertLeadContact(leadContact);

	    const employer = leadContact.employer;
	    const employerDocumentId = getDocumentId(employer);

	    if (!employerDocumentId) {
	      throw new ValidationError('Employer record could not be found.');
	    }

	    const operatingRegionIds = new Set(regionDocumentIds(employer?.operatingRegions));
	    const coverageRegions = (employer?.operatingRegions || []).filter((region) =>
	      body.coverageRegionDocumentIds.includes(getDocumentId(region) || '')
	    );

	    if (
	      body.coverageRegionDocumentIds.some((documentId) => !operatingRegionIds.has(documentId)) ||
	      coverageRegions.length === 0
	    ) {
	      throw new ValidationError('Team contact coverage must use employer operating regions.');
	    }

	    if (body.inviteEmail === normalizedEmailValue(leadContact.email)) {
	      throw new ValidationError('Lead contact is already connected to this employer.');
	    }

	    const existingContacts = await findEmployerContactByEmail(strapi, body.inviteEmail);
	    const conflictingContact = existingContacts.find((existingContact) => {
	      const existingEmployerDocumentId = getDocumentId(existingContact.employer);

	      return existingEmployerDocumentId && existingEmployerDocumentId !== employerDocumentId;
	    });

	    if (conflictingContact) {
	      throw new ValidationError('A team contact email is already linked to another employer.');
	    }

	    const existingContact = existingContacts.find(
	      (candidate) => getDocumentId(candidate.employer) === employerDocumentId
	    );
	    const now = new Date().toISOString();
	    let teamContact: DocumentRecord;

	    if (existingContact?.contactState === 'active') {
	      const existingContactDocumentId = getDocumentId(existingContact);

	      if (!existingContactDocumentId) {
	        throw new ValidationError('Employer contact could not be updated.');
	      }

	      teamContact = await documents(strapi, 'api::employer-contact.employer-contact').update({
	        documentId: existingContactDocumentId,
	        data: {
	          contactRole: 'team_contact',
	          coverageRegions: regionSetRelationData(coverageRegions),
	          firstName: body.firstName || existingContact.firstName || null,
	          lastName: body.lastName || existingContact.lastName || null,
	          roleTitle: body.roleTitle || existingContact.roleTitle || null,
	        },
	        populate: ['coverageRegions'],
	      });

	      return {
	        contact: await publicContactPayload(strapi, teamContact),
	        invited: false,
	        message: 'Existing active team contact coverage was updated.',
	      };
	    }

	    if (existingContact) {
	      const existingContactDocumentId = getDocumentId(existingContact);

	      if (!existingContactDocumentId) {
	        throw new ValidationError('Employer contact could not be updated.');
	      }

	      teamContact = await documents(strapi, 'api::employer-contact.employer-contact').update({
	        documentId: existingContactDocumentId,
	        data: {
	          authProvider: 'auth0',
	          contactRole: 'team_contact',
	          contactState: 'invited',
	          coverageRegions: regionSetRelationData(coverageRegions),
	          firstName: body.firstName || existingContact.firstName || null,
	          invitedAt: existingContact.invitedAt || now,
	          lastName: body.lastName || existingContact.lastName || null,
	          roleTitle: body.roleTitle || existingContact.roleTitle || null,
	        },
	        populate: ['coverageRegions'],
	      });
	    } else {
	      teamContact = await documents(strapi, 'api::employer-contact.employer-contact').create({
	        data: {
	          authProvider: 'auth0',
	          contactRole: 'team_contact',
	          contactState: 'invited',
	          coverageRegions: regionSetRelationData(coverageRegions),
	          email: body.inviteEmail,
	          employer: {
	            connect: [{ documentId: employerDocumentId }],
	          },
	          firstName: body.firstName || null,
	          invitedAt: now,
	          lastName: body.lastName || null,
	          roleTitle: body.roleTitle || null,
	        },
	        populate: ['coverageRegions'],
	      });
	    }

	    const teamContactDocumentId = getDocumentId(teamContact);

	    if (!teamContactDocumentId) {
	      throw new ValidationError('Employer team contact could not be created.');
	    }

	    await revokePendingInvitesForContact(strapi, teamContactDocumentId);

	    const rawToken = generateInviteToken();
	    const authProvision = await getAuth0ManagementClient().ensureEmployerUser({
	      email: body.inviteEmail,
	      firstName: body.firstName || null,
	      lastName: body.lastName || null,
	      name: compact([body.firstName, body.lastName]).join(' ') || body.inviteEmail,
	    });
	    const ticket = await getAuth0ManagementClient().createPasswordSetupTicket({
	      inviteUrl: employerInviteUrl(rawToken),
	      userId: authProvision.userId,
	    });
	    const authProvisionedAt = new Date().toISOString();

	    teamContact = await documents(strapi, 'api::employer-contact.employer-contact').update({
	      documentId: teamContactDocumentId,
	      data: {
	        authIdentityId: authProvision.userId,
	        authProvider: 'auth0',
	      },
	      populate: ['coverageRegions'],
	    });

	    const invite = await documents(strapi, 'api::employer-invite.employer-invite').create({
	      data: {
	        authIdentityId: authProvision.userId,
	        authPasswordTicketCreatedAt: authProvisionedAt,
	        authPasswordTicketExpiresAt: ticket.expiresAt,
	        authPasswordTicketUrl: ticket.ticketUrl,
	        authProvisionedAt,
	        createdByEmployerContactEmail: leadContact.email || null,
	        createdByEmployerContactName: contactDisplayName(leadContact),
	        deliveryState: 'not_required',
	        employer: {
	          connect: [{ documentId: employerDocumentId }],
	        },
	        employerContact: {
	          connect: [{ documentId: teamContactDocumentId }],
	        },
	        expiresAt: addCalendarDays(14),
	        inviteEmail: body.inviteEmail,
	        inviteState: 'pending',
	        metadata: {
	          authUserCreated: authProvision.created,
	          requestId: requestContext.requestId,
	          source: 'employer_dashboard_team_invite',
	        },
	        tokenHash: hashInviteToken(rawToken),
	      },
	      populate: invitePopulate,
	    });
	    const deliveredInvite = await queueEmployerInviteEmail(strapi, {
	      eventType: 'employer_invite_created',
	      invite,
	      rawToken,
	    });

	    await auditEvents(strapi).record({
	      actorDisplayName: contactDisplayName(leadContact),
	      actorEmail: leadContact.email || undefined,
	      actorId: getDocumentId(leadContact) || undefined,
	      actorType: 'employer_contact',
	      eventCategory: 'employer',
	      eventType: 'employer.team_contact_invited',
	      ipAddress: requestContext.ipAddress,
	      metadata: {
	        coverageRegionDocumentIds: body.coverageRegionDocumentIds,
	        inviteDocumentId: getDocumentId(deliveredInvite),
	        inviteEmail: body.inviteEmail,
	      },
	      requestId: requestContext.requestId,
	      serviceName: requestContext.serviceName,
	      severity: deliveredInvite.deliveryState === 'queued' ? 'info' : 'error',
	      source: 'employer_dashboard',
	      subjectDisplayName: employer?.companyName || 'Employer',
	      subjectId: employerDocumentId,
	      subjectType: 'employer',
	      userAgent: requestContext.userAgent,
	    });

	    return {
	      contact: await publicContactPayload(strapi, teamContact),
	      invite: publicInvitePayload(deliveredInvite),
	      inviteSent: deliveredInvite.deliveryState === 'queued',
	      invited: true,
	    };
	  },

  async getCapacityClaim(input: unknown) {
    const body = validateCapacityClaimDetail(input);
    const contact = await findEmployerContact(strapi, body);
    const contactDocumentId = getDocumentId(contact);

    if (!contactDocumentId) {
      throw new ValidationError('Employer contact record could not be found.');
    }

    const claim = await findScopedCapacityClaim(strapi, contact, body.capacityClaimDocumentId);
    const openedClaim = activeClaimOpenLock(claim, contactDocumentId)
      ? claim
      : await openCapacityClaimForContact(strapi, claim, contactDocumentId);

    return {
      account: await accountPayload(strapi, contact),
      claim: await capacityClaimDetailPayload(strapi, openedClaim, contact),
      generatedAt: new Date().toISOString(),
    };
  },

  async declineCapacityClaim(input: unknown, requestContext: RequestContext = {}) {
    const body = validateDeclineCapacityClaim(input);
    const contact = await findEmployerContact(strapi, body);
    const contactDocumentId = getDocumentId(contact);

    if (!contactDocumentId) {
      throw new ValidationError('Employer contact record could not be found.');
    }

    const claim = await findScopedCapacityClaim(strapi, contact, body.capacityClaimDocumentId);

    assertClaimNotLockedByAnother(claim, contactDocumentId);

    const result = await interviewRequestService(strapi).releaseCapacityClaim(
      {
        capacityClaimDocumentId: body.capacityClaimDocumentId,
        releaseNote: body.declineNote,
        releaseReason: body.declineReason,
        releasedByEmployerContactDocumentId: contactDocumentId,
      },
      requestContext
    );

    await auditEvents(strapi).record({
      actorDisplayName: contactDisplayName(contact),
      actorEmail: body.email || contact.email || undefined,
      actorId: contactDocumentId,
      actorType: 'employer_contact',
      eventCategory: 'employer',
      eventType: 'employer.capacity_claim_declined',
      ipAddress: requestContext.ipAddress,
      metadata: {
        capacityClaimDocumentId: body.capacityClaimDocumentId,
        declineNote: body.declineNote || null,
        declineReason: body.declineReason,
        requestId: requestContext.requestId,
      },
      requestId: requestContext.requestId,
      serviceName: requestContext.serviceName,
      severity: 'warning',
      source: 'employer_dashboard',
      subjectDisplayName: contact.employer?.companyName || 'Employer',
      subjectId: getDocumentId(contact.employer) || undefined,
      subjectType: 'employer',
      userAgent: requestContext.userAgent,
    });

    return result;
  },
	
  async getOverview(input: unknown) {
	    const identity = validateIdentity(input);
    const contact = await findEmployerContact(strapi, identity);
    const employerDocumentId = getDocumentId(contact.employer);
    const contactDocumentId = getDocumentId(contact);

    if (!employerDocumentId) {
      throw new ValidationError('Employer record could not be found.');
    }

    if (!contactDocumentId) {
      throw new ValidationError('Employer contact record could not be found.');
    }

    const scopedEmployerContactFilter = isLeadContact(contact)
      ? {}
      : {
          employerContact: {
            documentId: contactDocumentId,
          },
        };

    const [
      capacityClaims,
      availableSlots,
      scheduledInterviews,
      completedInterviews,
      progressionRequests,
    ] = await Promise.all([
      documents(strapi, 'api::employer-capacity-claim.employer-capacity-claim').findMany({
        filters: {
          employer: {
            documentId: employerDocumentId,
          },
          ...scopedEmployerContactFilter,
          claimState: {
            $in: ['held', 'notified', 'accepted'],
          },
        },
        limit: 50,
        populate: {
          employerContact: true,
          interviewRequest: {
            populate: {
              candidate: true,
              class: true,
              enrollment: true,
              region: true,
            },
          },
          region: true,
        },
        sort: ['expiresAt:asc', 'createdAt:asc'],
      }),
      documents(strapi, 'api::interview-slot.interview-slot').findMany({
        filters: {
          employer: {
            documentId: employerDocumentId,
          },
          ...scopedEmployerContactFilter,
          slotState: {
            $in: ['available', 'offered', 'held'],
          },
        },
        limit: 500,
      }),
      documents(strapi, 'api::interview.interview').findMany({
        filters: {
          employer: {
            documentId: employerDocumentId,
          },
          ...scopedEmployerContactFilter,
          interviewState: {
            $in: ['awaiting_employer_details', 'candidate_selected', 'confirmed'],
          },
        },
        limit: 100,
        populate: ['candidate', 'interviewSlot'],
        sort: ['scheduledStartTime:asc', 'createdAt:asc'],
      }),
      documents(strapi, 'api::interview.interview').findMany({
        filters: {
          employer: {
            documentId: employerDocumentId,
          },
          ...scopedEmployerContactFilter,
          interviewState: 'completed',
        },
        limit: 100,
        populate: ['candidate', 'interviewSlot'],
        sort: ['completedAt:desc', 'scheduledStartTime:desc'],
      }),
      documents(strapi, 'api::offer.offer').findMany({
        filters: {
          employer: {
            documentId: employerDocumentId,
          },
          ...scopedEmployerContactFilter,
          progressionState: {
            $in: ['requested', 'candidate_notified', 'details_released'],
          },
        },
        limit: 100,
        populate: ['candidate', 'interview'],
        sort: ['requestedDetailsAt:desc', 'createdAt:desc'],
      }),
    ]);
    const completedInterviewIds = completedInterviews
      .map((interview) => getDocumentId(interview))
      .filter((documentId): documentId is string => Boolean(documentId));
    const feedbackRecords = completedInterviewIds.length
      ? await documents(strapi, 'api::interview-feedback.interview-feedback').findMany({
          filters: {
            interview: {
              documentId: {
                $in: completedInterviewIds,
              },
            },
          },
          limit: 100,
          populate: ['interview'],
        })
      : [];
    const feedbackInterviewIds = new Set(
      feedbackRecords
        .map((feedback) => getDocumentId(feedback.interview))
        .filter((documentId): documentId is string => Boolean(documentId))
    );
    const feedbackDue = completedInterviews.filter(
      (interview) => !feedbackInterviewIds.has(getDocumentId(interview) || '')
    );
    const account = await accountPayload(strapi, contact);

    return {
      account,
      availabilityRequests: capacityClaims.map(availabilityRequestPayload),
      feedbackRequests: feedbackDue.map(feedbackPayload),
      generatedAt: new Date().toISOString(),
      interviews: scheduledInterviews.map(interviewPayload),
      progressionRequests: progressionRequests.map(progressionPayload),
      summary: {
        availableSlots: availableSlots.length,
        commitmentWindow: buildCommitmentWindowSummary({
          capacityClaims,
          completedInterviews,
          employer: contact.employer,
          scheduledInterviews,
        }),
        feedbackDue: feedbackDue.length,
        interviewsScheduled: scheduledInterviews.length,
        progressionRequests: progressionRequests.length,
      },
    };
  },

  async listSupportCases(input: unknown) {
    const identity = validateIdentity(input);
    const contact = await findEmployerContact(strapi, identity);
    const contactDocumentId = getDocumentId(contact);
    const employerDocumentId = getDocumentId(contact.employer);

    if (!contactDocumentId || !employerDocumentId) {
      throw new ValidationError('Employer support case ownership could not be verified.');
    }

    const cases = await supportCaseService(strapi).casesForEmployerContact({
      employerContactDocumentId: contactDocumentId,
      employerDocumentId,
    });

    return {
      cases,
      counts: {
        total: cases.length,
      },
      generatedAt: new Date().toISOString(),
    };
  },

  async getSupportCase(input: unknown) {
    const body = validateSupportCaseDetail(input);
    const contact = await findEmployerContact(strapi, body);
    const contactDocumentId = getDocumentId(contact);
    const employerDocumentId = getDocumentId(contact.employer);

    if (!contactDocumentId || !employerDocumentId) {
      throw new ValidationError('Employer support case ownership could not be verified.');
    }

    const supportCase = await supportCaseService(strapi).getCaseForEmployerContact({
      employerContactDocumentId: contactDocumentId,
      employerDocumentId,
      supportCaseDocumentId: body.supportCaseDocumentId,
    });

    if (!supportCase) {
      throw new ValidationError('Support case could not be found.');
    }

    return {
      generatedAt: new Date().toISOString(),
      supportCase,
    };
  },

  async createSupportCase(input: unknown, requestContext: RequestContext = {}) {
    const body = validateSupportCaseCreate(input);
    const contact = await findEmployerContact(strapi, body);
    const contactDocumentId = getDocumentId(contact);
    const employerDocumentId = getDocumentId(contact.employer);

    if (!contactDocumentId || !employerDocumentId) {
      throw new ValidationError('Employer support case ownership could not be verified.');
    }

    const caseResult = await supportCaseService(strapi).createDashboardSupportCase({
      body: body.body,
      caseType: 'general',
      employer: contact.employer,
      employerContact: contact,
      openedBy: {
        displayName: contactDisplayName(contact),
        email: contact.email,
        id: contactDocumentId,
        type: 'employer_contact',
      },
      priority: 'normal',
      source: 'employer_dashboard',
      title: body.title,
    });
    const supportCaseDocumentId =
      typeof caseResult.supportCase === 'object' && caseResult.supportCase
        ? (caseResult.supportCase as DocumentRecord).documentId
        : undefined;
    const now = new Date().toISOString();

    await auditEvents(strapi).record({
      actorEmail: contact.email,
      actorId: body.authIdentityId,
      actorType: 'employer_contact',
      eventCategory: 'support',
      eventType: 'employer.support_case_created',
      ipAddress: requestContext.ipAddress,
      metadata: {
        employerContactDocumentId: contactDocumentId,
        employerDocumentId,
        supportCaseDocumentId,
        title: body.title,
      },
      occurredAt: now,
      requestId: requestContext.requestId,
      source: 'employer_dashboard',
      subjectDisplayName: body.title,
      subjectId: supportCaseDocumentId,
      subjectType: 'support_case',
      userAgent: requestContext.userAgent,
    });
    await Promise.all([
      publishAdminRealtimeEvent(
        {
          channels: ['support'],
          resourceKey: supportCaseDocumentId,
          resourceType: 'support_case',
          type: 'support_cases_changed',
        },
        strapi.log
      ),
      publishAdminRealtimeEvent(
        {
          channels: ['operations'],
          resourceKey: supportCaseDocumentId,
          resourceType: 'support_case',
          type: 'admin_tasks_changed',
        },
        strapi.log
      ),
    ]);

    return caseResult;
  },

  async replyToSupportCase(input: unknown, requestContext: RequestContext = {}) {
    const body = validateSupportCaseReply(input);
    const contact = await findEmployerContact(strapi, body);
    const contactDocumentId = getDocumentId(contact);
    const employerDocumentId = getDocumentId(contact.employer);

    if (!contactDocumentId || !employerDocumentId) {
      throw new ValidationError('Employer support case ownership could not be verified.');
    }

    const existingCase = await supportCaseService(strapi).getCaseForEmployerContact({
      employerContactDocumentId: contactDocumentId,
      employerDocumentId,
      supportCaseDocumentId: body.supportCaseDocumentId,
    });

    if (!existingCase) {
      throw new ValidationError('Support case could not be found.');
    }

    await supportCaseService(strapi).addMessage({
      body: body.body,
      direction: 'inbound',
      employer: contact.employer,
      employerContact: contact,
      messageType: 'candidate_message',
      sender: {
        displayName: contactDisplayName(contact),
        email: contact.email,
        id: contactDocumentId,
        type: 'employer_contact',
      },
      supportCase: {
        documentId: body.supportCaseDocumentId,
      },
      visibility: 'public',
    });
    await supportCaseService(strapi).updateCaseState({
      caseState: 'awaiting_staff',
      metadata: {
        lastEmployerReplyAt: new Date().toISOString(),
      },
      supportCase: {
        documentId: body.supportCaseDocumentId,
      },
    });
    await auditEvents(strapi).record({
      actorEmail: contact.email,
      actorId: body.authIdentityId,
      actorType: 'employer_contact',
      eventCategory: 'support',
      eventType: 'employer.support_case_replied',
      ipAddress: requestContext.ipAddress,
      metadata: {
        employerContactDocumentId: contactDocumentId,
        employerDocumentId,
        supportCaseDocumentId: body.supportCaseDocumentId,
      },
      occurredAt: new Date().toISOString(),
      requestId: requestContext.requestId,
      source: 'employer_dashboard',
      subjectDisplayName: (existingCase as DocumentRecord).title || 'Support case',
      subjectId: body.supportCaseDocumentId,
      subjectType: 'support_case',
      userAgent: requestContext.userAgent,
    });
    await Promise.all([
      publishAdminRealtimeEvent(
        {
          channels: ['support'],
          resourceKey: body.supportCaseDocumentId,
          resourceType: 'support_case',
          type: 'support_cases_changed',
        },
        strapi.log
      ),
      publishAdminRealtimeEvent(
        {
          channels: ['operations'],
          resourceKey: body.supportCaseDocumentId,
          resourceType: 'support_case',
          type: 'admin_tasks_changed',
        },
        strapi.log
      ),
    ]);

    return {
      replied: true,
      supportCase: await supportCaseService(strapi).getCaseForEmployerContact({
        employerContactDocumentId: contactDocumentId,
        employerDocumentId,
        supportCaseDocumentId: body.supportCaseDocumentId,
      }),
    };
  },

  async getInterviewFeedbackDetail(input: unknown) {
    const body = validateInterviewFeedbackDetail(input);
    const contact = await findEmployerContact(strapi, body);
    const interview = await findScopedInterview(strapi, contact, body.interviewDocumentId);
    const interviewDocumentId = getDocumentId(interview);

    if (String(interview.interviewState || '') !== 'completed') {
      throw new ValidationError('Feedback can only be submitted after the interview is completed.');
    }

    if (!interviewDocumentId) {
      throw new ValidationError('Interview could not be found.');
    }

    const feedback = await findEmployerFeedbackForInterview(strapi, interviewDocumentId);

    return interviewFeedbackDetailPayload(strapi, interview, contact, feedback);
  },

  async getInterviewProgressionDetail(input: unknown) {
    const body = validateInterviewProgressionDetail(input);
    const contact = await findEmployerContact(strapi, body);
    const interview = await findScopedInterview(strapi, contact, body.interviewDocumentId);
    const interviewDocumentId = getDocumentId(interview);

    if (!interviewDocumentId) {
      throw new ValidationError('Interview could not be found.');
    }

    const progressionRequest = await findProgressionRequestForInterview(strapi, interviewDocumentId);

    return progressionDetailPayload(strapi, interview, contact, progressionRequest);
  },

  async submitInterviewFeedback(input: unknown, requestContext: RequestContext = {}) {
    const body = validateSubmitInterviewFeedback(input);
    const contact = await findEmployerContact(strapi, body);
    const interview = await findScopedInterview(strapi, contact, body.interviewDocumentId);
    const interviewDocumentId = getDocumentId(interview);
    const contactDocumentId = getDocumentId(contact);

    if (String(interview.interviewState || '') !== 'completed') {
      throw new ValidationError('Feedback can only be submitted after the interview is completed.');
    }

    if (!interviewDocumentId || !contactDocumentId) {
      throw new ValidationError('Interview feedback could not be submitted.');
    }

    const previousTakeaways = await findPreviousCandidateReportTakeaways(strapi, interview);

    if (previousTakeaways.length && !body.previousTakeawayAssessment) {
      throw new ValidationError('Review how the candidate performed against the previous feedback points.');
    }

    const existingFeedback = await findEmployerFeedbackForInterview(strapi, interviewDocumentId);

    if (existingFeedback) {
      throw new ValidationError('Employer feedback has already been submitted for this interview.');
    }

    const now = new Date().toISOString();
    const feedback = await documents(strapi, 'api::interview-feedback.interview-feedback').create({
      data: {
        candidateReportState: 'pending',
        concerns: body.concerns,
        interview: relationConnect(interview),
        metadata: {
          previousTakeawaysReviewed: previousTakeaways,
          rawFeedbackCandidateVisible: false,
          requestId: requestContext.requestId,
          source: 'employer_dashboard',
        },
        nextStep: body.nextStep,
        notes: body.notes,
        outcome: body.outcome,
        previousTakeawayAssessment: body.previousTakeawayAssessment || null,
        rating: body.rating,
        strengths: body.strengths,
        submittedAt: now,
        submittedById: contactDocumentId,
        submittedByType: 'employer_contact',
      },
      populate: ['interview'],
    });

    await auditEvents(strapi).record({
      actorDisplayName: contactDisplayName(contact),
      actorId: contactDocumentId,
      actorType: 'employer_contact',
      eventCategory: 'interview',
      eventType: 'employer.interview_feedback_submitted',
      ipAddress: requestContext.ipAddress,
      metadata: {
        candidateReportState: 'pending',
        interviewDocumentId,
        previousTakeawayAssessmentProvided: Boolean(body.previousTakeawayAssessment),
        previousTakeawaysCount: previousTakeaways.length,
        requestId: requestContext.requestId,
      },
      requestId: requestContext.requestId,
      serviceName: requestContext.serviceName,
      severity: 'info',
      source: 'employer_dashboard',
      subjectDisplayName: candidateDisplayName(interview.candidate),
      subjectId: interviewDocumentId,
      subjectType: 'interview',
      userAgent: requestContext.userAgent,
    });

    const generatedFeedback = await maybeGenerateCandidateFeedbackReport({
      interview,
      requestContext,
      strapi,
    });

    return interviewFeedbackDetailPayload(strapi, interview, contact, generatedFeedback || feedback);
  },

  async submitInterviewProgression(input: unknown, requestContext: RequestContext = {}) {
    const body = validateSubmitInterviewProgression(input);
    const contact = await findEmployerContact(strapi, body);
    const interview = await findScopedInterview(strapi, contact, body.interviewDocumentId);
    const interviewDocumentId = getDocumentId(interview);
    const contactDocumentId = getDocumentId(contact);

    if (String(interview.interviewState || '') !== 'completed') {
      throw new ValidationError('Progression requests can only be created after the interview is completed.');
    }

    if (!interviewDocumentId || !contactDocumentId) {
      throw new ValidationError('Progression request could not be created.');
    }

    const feedback = await findEmployerFeedbackForInterview(strapi, interviewDocumentId);

    if (!feedback) {
      throw new ValidationError('Submit interview feedback before requesting progression.');
    }

    const existingProgression = await findProgressionRequestForInterview(strapi, interviewDocumentId);

    if (
      existingProgression &&
      !['declined', 'expired', 'cancelled'].includes(String(existingProgression.progressionState || ''))
    ) {
      throw new ValidationError('A progression request already exists for this interview.');
    }

    const employer = documentRecordValue(interview.employer) || documentRecordValue(contact.employer);
    const employerContacts = Array.isArray(employer?.contacts)
      ? employer.contacts.map(documentRecordValue).filter((record): record is DocumentRecord => Boolean(record))
      : [contact];
    const assignedContact =
      (body.employerContactDocumentId
        ? employerContacts.find((item) => getDocumentId(item) === body.employerContactDocumentId)
        : undefined) || documentRecordValue(interview.employerContact) || contact;

    if (!assignedContact?.documentId) {
      throw new ValidationError('Select an employer contact for the next step.');
    }

    const now = new Date().toISOString();
    const responseDeadline = responseDeadlineForProgression(body.responseDeadline);
    const progressionRequest = await documents(strapi, 'api::offer.offer').create({
      data: {
        candidate: relationConnect(interview.candidate),
        candidateMessage: body.candidateMessage,
        candidateNotifiedAt: now,
        candidateResponseDeadline: responseDeadline,
        employer: relationConnect(employer),
        followUpState: 'not_due',
        internalProcessNotes: body.internalNote || null,
        interview: relationConnect(interview),
        metadata: {
          feedbackDocumentId: getDocumentId(feedback),
          requestId: requestContext.requestId,
          source: 'employer_dashboard',
        },
        progressionState: 'candidate_notified',
        progressionType: body.progressionType,
        requestedByEmployerContact: relationConnect(assignedContact),
        requestedDetailsAt: now,
      },
      populate: progressionRequestPopulate,
    });

    await queueCandidateProgressionRequestNotification({
      contact: assignedContact,
      progressionRequest,
      requestContext,
      strapi,
    });

    await auditEvents(strapi).record({
      actorDisplayName: contactDisplayName(contact),
      actorId: contactDocumentId,
      actorType: 'employer_contact',
      eventCategory: 'interview',
      eventType: 'employer.interview_progression_requested',
      ipAddress: requestContext.ipAddress,
      metadata: {
        assignedEmployerContactDocumentId: getDocumentId(assignedContact),
        interviewDocumentId,
        progressionRequestDocumentId: getDocumentId(progressionRequest),
        progressionType: body.progressionType,
        requestId: requestContext.requestId,
        responseDeadline,
      },
      requestId: requestContext.requestId,
      serviceName: requestContext.serviceName,
      severity: 'info',
      source: 'employer_dashboard',
      subjectDisplayName: candidateDisplayName(interview.candidate),
      subjectId: getDocumentId(progressionRequest) || interviewDocumentId,
      subjectType: 'progression_request',
      userAgent: requestContext.userAgent,
    });

    await publishAdminRealtimeEvent(
      {
        channels: ['operations'],
        resourceKey: getDocumentId(progressionRequest) || interviewDocumentId,
        resourceType: 'progression_request',
        type: 'admin_tasks_changed',
      },
      strapi.log
    );

    return progressionDetailPayload(strapi, interview, contact, progressionRequest);
  },

  async inviteInterviewFeedbackContributor(input: unknown, requestContext: RequestContext = {}) {
    const body = validateInviteInterviewFeedbackContributor(input);
    const contact = await findEmployerContact(strapi, body);
    const interview = await findScopedInterview(strapi, contact, body.interviewDocumentId);
    const interviewDocumentId = getDocumentId(interview);
    const contactDocumentId = getDocumentId(contact);
    const employerDocumentId = getDocumentId(contact.employer);

    if (String(interview.interviewState || '') !== 'completed') {
      throw new ValidationError('Additional feedback can only be requested after the interview is completed.');
    }

    const primaryFeedback = await findEmployerFeedbackForInterview(strapi, interviewDocumentId);

    if (
      primaryFeedback &&
      String(primaryFeedback.candidateReportState || 'pending') !== 'pending'
    ) {
      throw new ValidationError('Additional feedback cannot be requested after the candidate report has been generated.');
    }

    if (!interviewDocumentId || !contactDocumentId || !employerDocumentId) {
      throw new ValidationError('Feedback invite could not be created.');
    }

    const expiresAt = additionalFeedbackInviteDeadline(interview);

    if (Date.parse(expiresAt) <= Date.now()) {
      throw new ValidationError('The feedback invite deadline has passed.');
    }

    const existingInvites = await documents(strapi, 'api::interview-feedback-invite.interview-feedback-invite').findMany({
      filters: {
        interview: {
          documentId: interviewDocumentId,
        },
        inviteEmail: body.inviteEmail,
        inviteState: {
          $in: ['pending', 'submitted'],
        },
      },
      limit: 1,
    });

    if (existingInvites.length) {
      throw new ValidationError('A feedback invite already exists for that email address.');
    }

    const rawToken = generateInviteToken();
    const invite = await documents(strapi, 'api::interview-feedback-invite.interview-feedback-invite').create({
      data: {
        createdByEmployerContact: {
          connect: [{ documentId: contactDocumentId }],
        },
        deliveryState: 'not_required',
        employer: {
          connect: [{ documentId: employerDocumentId }],
        },
        expiresAt,
        interview: {
          connect: [{ documentId: interviewDocumentId }],
        },
        inviteEmail: body.inviteEmail,
        inviteState: 'pending',
        inviteeName: body.inviteeName || null,
        inviteeRoleTitle: body.inviteeRoleTitle || null,
        metadata: {
          requestId: requestContext.requestId,
          source: 'employer_dashboard_feedback_invite',
        },
        tokenHash: hashInviteToken(rawToken),
      },
      populate: feedbackInvitePopulate,
    });
    const deliveredInvite = await queueInterviewFeedbackInviteEmail(strapi, {
      invite,
      rawToken,
    });

    await auditEvents(strapi).record({
      actorDisplayName: contactDisplayName(contact),
      actorEmail: contact.email || undefined,
      actorId: contactDocumentId,
      actorType: 'employer_contact',
      eventCategory: 'interview',
      eventType: 'employer.interview_feedback_invite_created',
      ipAddress: requestContext.ipAddress,
      metadata: {
        deliveryState: deliveredInvite.deliveryState,
        feedbackInviteDocumentId: getDocumentId(deliveredInvite),
        inviteEmail: body.inviteEmail,
        inviteeName: body.inviteeName || null,
        requestId: requestContext.requestId,
      },
      requestId: requestContext.requestId,
      serviceName: requestContext.serviceName,
      severity: deliveredInvite.deliveryState === 'queued' ? 'info' : 'error',
      source: 'employer_dashboard',
      subjectDisplayName: candidateDisplayName(interview.candidate),
      subjectId: interviewDocumentId,
      subjectType: 'interview',
      userAgent: requestContext.userAgent,
    });

    const feedback =
      (await maybeGenerateCandidateFeedbackReport({
        interview,
        requestContext,
        strapi,
      })) || (await findEmployerFeedbackForInterview(strapi, interviewDocumentId));

    return interviewFeedbackDetailPayload(strapi, interview, contact, feedback);
  },

  async revokeInterviewFeedbackInvite(input: unknown, requestContext: RequestContext = {}) {
    const body = validateRevokeInterviewFeedbackInvite(input);
    const contact = await findEmployerContact(strapi, body);
    const interview = await findScopedInterview(strapi, contact, body.interviewDocumentId);
    const interviewDocumentId = getDocumentId(interview);
    const contactDocumentId = getDocumentId(contact);

    if (!interviewDocumentId || !contactDocumentId) {
      throw new ValidationError('Feedback invite could not be revoked.');
    }

    const invites = await documents(strapi, 'api::interview-feedback-invite.interview-feedback-invite').findMany({
      filters: {
        documentId: body.feedbackInviteDocumentId,
        interview: {
          documentId: interviewDocumentId,
        },
      },
      limit: 1,
      populate: feedbackInvitePopulate,
    });
    const invite = invites[0];

    if (!invite) {
      throw new ValidationError('Feedback invite could not be found.');
    }

    if (invite.inviteState !== 'pending') {
      throw new ValidationError('Only pending feedback invites can be revoked.');
    }

    await documents(strapi, 'api::interview-feedback-invite.interview-feedback-invite').update({
      documentId: body.feedbackInviteDocumentId,
      data: {
        inviteState: 'revoked',
        revocationReason: body.reason || null,
        revokedAt: new Date().toISOString(),
      },
    });

    await auditEvents(strapi).record({
      actorDisplayName: contactDisplayName(contact),
      actorEmail: contact.email || undefined,
      actorId: contactDocumentId,
      actorType: 'employer_contact',
      eventCategory: 'interview',
      eventType: 'employer.interview_feedback_invite_revoked',
      ipAddress: requestContext.ipAddress,
      metadata: {
        feedbackInviteDocumentId: body.feedbackInviteDocumentId,
        inviteEmail: invite.inviteEmail || null,
        reason: body.reason || null,
        requestId: requestContext.requestId,
      },
      requestId: requestContext.requestId,
      serviceName: requestContext.serviceName,
      severity: 'info',
      source: 'employer_dashboard',
      subjectDisplayName: candidateDisplayName(interview.candidate),
      subjectId: interviewDocumentId,
      subjectType: 'interview',
      userAgent: requestContext.userAgent,
    });

    const feedback =
      (await maybeGenerateCandidateFeedbackReport({
        interview,
        requestContext,
        strapi,
      })) || (await findEmployerFeedbackForInterview(strapi, interviewDocumentId));

    return interviewFeedbackDetailPayload(strapi, interview, contact, feedback);
  },

  async validateInterviewFeedbackInvite(input: unknown) {
    const body = validateFeedbackInviteToken(input);
    const invite = await assertValidFeedbackInvite(strapi, body.inviteToken);

    return {
      invite: feedbackInvitePublicPayload(invite),
    };
  },

  async submitInvitedInterviewFeedback(input: unknown, requestContext: RequestContext = {}) {
    const body = validateSubmitInvitedInterviewFeedback(input);
    const invite = await assertValidFeedbackInvite(strapi, body.inviteToken);
    const inviteDocumentId = getDocumentId(invite);
    const interview = documentRecordValue(invite.interview);
    const interviewDocumentId = getDocumentId(interview);

    if (!inviteDocumentId || !interview || !interviewDocumentId) {
      throw new ValidationError('Feedback invite could not be submitted.');
    }

    if (String(interview.interviewState || '') !== 'completed') {
      throw new ValidationError('Feedback can only be submitted after the interview is completed.');
    }

    const now = new Date().toISOString();
    const feedback = await documents(strapi, 'api::interview-feedback.interview-feedback').create({
      data: {
        candidateReportState: 'pending',
        concerns: body.concerns,
        feedbackInvite: {
          connect: [{ documentId: inviteDocumentId }],
        },
        interview: relationConnect(interview),
        metadata: {
          invitedEmail: invite.inviteEmail || null,
          inviteeName: invite.inviteeName || null,
          inviteeRoleTitle: invite.inviteeRoleTitle || null,
          previousTakeawayAssessmentProvided: Boolean(body.previousTakeawayAssessment),
          rawFeedbackCandidateVisible: false,
          requestId: requestContext.requestId,
          source: 'feedback_invite',
          submitterName: body.submitterName || null,
          submitterRoleTitle: body.submitterRoleTitle || null,
        },
        nextStep: body.nextStep,
        notes: body.notes,
        outcome: body.outcome,
        previousTakeawayAssessment: body.previousTakeawayAssessment || null,
        rating: body.rating,
        strengths: body.strengths,
        submittedAt: now,
        submittedById: inviteDocumentId,
        submittedByType: 'external_interviewer',
      },
      populate: ['interview'],
    });

    await documents(strapi, 'api::interview-feedback-invite.interview-feedback-invite').update({
      documentId: inviteDocumentId,
      data: {
        feedback: relationConnect(feedback),
        inviteState: 'submitted',
        submittedAt: now,
      },
    });

    await auditEvents(strapi).record({
      actorDisplayName: body.submitterName || invite.inviteeName || invite.inviteEmail || 'Interview attendee',
      actorEmail: invite.inviteEmail || undefined,
      actorId: inviteDocumentId,
      actorType: 'anonymous',
      eventCategory: 'interview',
      eventType: 'employer.interview_feedback_invite_submitted',
      ipAddress: requestContext.ipAddress,
      metadata: {
        feedbackDocumentId: getDocumentId(feedback),
        feedbackInviteDocumentId: inviteDocumentId,
        inviteEmail: invite.inviteEmail || null,
        requestId: requestContext.requestId,
      },
      requestId: requestContext.requestId,
      serviceName: requestContext.serviceName,
      severity: 'info',
      source: 'employer_dashboard',
      subjectDisplayName: candidateDisplayName(interview.candidate),
      subjectId: interviewDocumentId,
      subjectType: 'interview',
      userAgent: requestContext.userAgent,
    });

    await maybeGenerateCandidateFeedbackReport({
      interview,
      requestContext,
      strapi,
    });

    return {
      invite: feedbackInvitePublicPayload({
        ...invite,
        feedback,
        inviteState: 'submitted',
        submittedAt: now,
      }),
      submitted: true,
    };
  },

  async getInterviewDetail(input: unknown) {
    const body = validateInterviewDetail(input);
    const contact = await findEmployerContact(strapi, body);
    const interview = await findScopedInterview(strapi, contact, body.interviewDocumentId);

    return interviewDetailPayload(strapi, interview, contact);
  },

  async updateInterviewSetup(input: unknown, requestContext: RequestContext = {}) {
    const body = validateInterviewSetup(input);
    const contact = await findEmployerContact(strapi, body);
    const interview = await findScopedInterview(strapi, contact, body.interviewDocumentId);
    const interviewDocumentId = getDocumentId(interview);

    if (!interviewDocumentId) {
      throw new ValidationError('Interview could not be updated.');
    }

    if (
      ['completed', 'candidate_no_show', 'candidate_declined', 'employer_cancelled', 'cancelled'].includes(
        String(interview.interviewState || '')
      )
    ) {
      throw new ValidationError('Interview details cannot be edited after this interview is closed.');
    }

    assertInterviewSetupDetails(body);

    const now = new Date().toISOString();
    const { assignedContact, assignedContactDocumentId } = resolveInterviewAssignedContact({
      actorContact: contact,
      interview,
      requestedContactDocumentId: body.employerContactDocumentId,
    });
    const updatedInterview = await documents(strapi, 'api::interview.interview').update({
      documentId: interviewDocumentId,
      data: {
        arrivalInstructions: body.arrivalInstructions || null,
        candidateInstructions: body.candidateInstructions || null,
        confirmedAt: interview.confirmedAt || now,
        detailsProvidedAt: interview.detailsProvidedAt || now,
        detailsUpdatedAt: now,
        employerContact: {
          connect: [{ documentId: assignedContactDocumentId }],
        },
        interviewerName: body.interviewerName || contactDisplayName(assignedContact),
        interviewState: 'confirmed',
        locationDetails: body.locationDetails || null,
        locationType: body.locationType,
        meetingUrl: body.meetingUrl || null,
        metadata: {
          ...objectValue(interview.metadata),
          detailsLastUpdatedAt: now,
          detailsLastUpdatedByEmployerContactDocumentId: getDocumentId(contact),
          detailsLastUpdatedRequestId: requestContext.requestId,
          source: 'employer_dashboard',
        },
      },
      populate: {
        candidate: true,
        employer: true,
        employerContact: {
          populate: ['coverageRegions', 'profileImage'],
        },
        enrollment: {
          populate: ['class'],
        },
        interviewSlot: {
          populate: ['employerContact'],
        },
      },
    });

    await auditEvents(strapi).record({
      actorDisplayName: contactDisplayName(contact),
      actorId: getDocumentId(contact) || undefined,
      actorType: 'employer_contact',
      eventCategory: 'interview',
      eventType: 'employer.interview_details_confirmed',
      ipAddress: requestContext.ipAddress,
      metadata: {
        assignedContactDocumentId,
        interviewDocumentId,
        locationType: body.locationType,
        requestId: requestContext.requestId,
      },
      requestId: requestContext.requestId,
      serviceName: requestContext.serviceName,
      severity: 'info',
      source: 'employer_dashboard',
      subjectDisplayName: candidateDisplayName(updatedInterview.candidate),
      subjectId: interviewDocumentId,
      subjectType: 'interview',
      userAgent: requestContext.userAgent,
    });

    await queueCandidateInterviewDetailsNotification({
      contact,
      interview: updatedInterview,
      requestContext,
      strapi,
    });

    return interviewDetailPayload(strapi, updatedInterview, contact);
  },

  async createInterviewSlotOffer(input: unknown, requestContext: RequestContext = {}) {
    const body = validateCreateInterviewSlotOffer(input);
    const contact = await findEmployerContact(strapi, body);
    const employerDocumentId = getDocumentId(contact.employer);
    const contactDocumentId = getDocumentId(contact);

    if (!employerDocumentId) {
      throw new ValidationError('Employer record could not be found.');
    }

    if (!contactDocumentId) {
      throw new ValidationError('Employer contact record could not be found.');
    }

    const [candidate, enrollment] = await Promise.all([
      findDocumentById(strapi, 'api::candidate.candidate', body.candidateDocumentId),
      findDocumentById(strapi, 'api::enrollment.enrollment', body.enrollmentDocumentId, ['candidate']),
    ]);

    if (!candidate) {
      throw new ValidationError('Candidate could not be found.');
    }

    if (!enrollment) {
      throw new ValidationError('Enrollment could not be found.');
    }

    const enrollmentCandidateDocumentId = getDocumentId(enrollment.candidate);

    if (enrollmentCandidateDocumentId && enrollmentCandidateDocumentId !== body.candidateDocumentId) {
      throw new ValidationError('Enrollment does not belong to the selected candidate.');
    }

    let interviewRequestDocumentId = body.interviewRequestDocumentId;
    let capacityClaim: DocumentRecord | null = null;

    if (body.capacityClaimDocumentId) {
      const capacityClaims = await documents(
        strapi,
        'api::employer-capacity-claim.employer-capacity-claim'
      ).findMany({
        filters: {
          documentId: body.capacityClaimDocumentId,
        },
        limit: 1,
        populate: {
          currentlyOpenByContact: true,
          employer: {
            populate: ['contacts'],
          },
          employerContact: true,
          interviewRequest: {
            populate: {
              class: {
                populate: ['workSector'],
              },
              region: true,
            },
          },
          region: true,
          slotOffers: {
            populate: ['slots'],
          },
        },
      });

      capacityClaim = capacityClaims[0] || null;

      if (!capacityClaim) {
        throw new ValidationError('Interview capacity claim could not be found.');
      }

      if (getDocumentId(capacityClaim.employer) !== employerDocumentId) {
        throw new ValidationError('Interview capacity claim does not belong to this employer.');
      }

      if (
        !isLeadContact(contact) &&
        getDocumentId(capacityClaim.employerContact) !== contactDocumentId
      ) {
        throw new ValidationError('Interview capacity claim is assigned to another employer contact.');
      }

      assertClaimNotLockedByAnother(capacityClaim, contactDocumentId);

      if (!['held', 'notified', 'accepted', 'fulfilled'].includes(String(capacityClaim.claimState || ''))) {
        throw new ValidationError('Interview capacity claim is not open for slot options.');
      }

      const claimInterviewRequestDocumentId = getDocumentId(capacityClaim.interviewRequest);

      if (
        interviewRequestDocumentId &&
        claimInterviewRequestDocumentId &&
        interviewRequestDocumentId !== claimInterviewRequestDocumentId
      ) {
        throw new ValidationError('Interview request does not match the capacity claim.');
      }

      interviewRequestDocumentId = claimInterviewRequestDocumentId || interviewRequestDocumentId;
    }

    const now = new Date();
    const earliestAllowed = addWorkingDays(now, 4);
    const regionDocumentId = getDocumentId(
      documentRecordValue(capacityClaim?.region) ||
        documentRecordValue(capacityClaim?.interviewRequest?.region)
    );
    const workSectorDocumentId = getDocumentId(
      documentRecordValue(documentRecordValue(capacityClaim?.interviewRequest?.class)?.workSector)
    );
    const requiredSlotCount = boundedSlotCount(capacityClaim?.requiredSlotCount);
    const capacityClaimPurpose = String(objectValue(capacityClaim?.metadata).purpose || '');
    const isReusableTopUpClaim = capacityClaimPurpose === reusableSlotTopUpPurpose;

    if (isReusableTopUpClaim && capacityClaim?.claimState === 'fulfilled') {
      throw new ValidationError('Reusable slot top-up options have already been submitted.');
    }

    const employerContactMap = contactMapForEmployer(capacityClaim?.employer || contact.employer);
    const normalizedSlots = body.slots.map((slot) => {
      const startTime = assertIsoDate(slot.startTime, 'Slot start time is invalid.');
      const endTime = assertIsoDate(slot.endTime, 'Slot end time is invalid.');

      if (endTime <= startTime) {
        throw new ValidationError('Slot end time must be after the start time.');
      }

      if (startTime < earliestAllowed) {
        throw new ValidationError('The earliest slot must allow at least 4 working days notice.');
      }
      assertBusinessHoursSlot(startTime, endTime);
      const assignedContact = assertSlotContact({
        actorContact: contact,
        contactMap: employerContactMap,
        fallbackContactDocumentId: contactDocumentId,
        regionDocumentId,
        requestedContactDocumentId: slot.employerContactDocumentId,
      });

      return {
        ...slot,
        employerContactDocumentId: assignedContact.assignedContactDocumentId,
        endTime: endTime.toISOString(),
        startTime: startTime.toISOString(),
      };
    });
    const uniqueStarts = new Set(normalizedSlots.map((slot) => slot.startTime));

    if (uniqueStarts.size !== normalizedSlots.length) {
      throw new ValidationError('Slot options must use different start times.');
    }

    if (normalizedSlots.length !== requiredSlotCount) {
      throw new ValidationError(
        `This request needs exactly ${requiredSlotCount} slot option${requiredSlotCount === 1 ? '' : 's'}.`
      );
    }

    if (capacityClaim) {
      await cancelSupersededSlotOffers(strapi, capacityClaim, requestContext, contactDocumentId);
    }

    const offerData: Record<string, unknown> = {
      candidate: {
        connect: [{ documentId: body.candidateDocumentId }],
      },
      ...(body.capacityClaimDocumentId
        ? {
            capacityClaim: {
              connect: [{ documentId: body.capacityClaimDocumentId }],
            },
          }
        : {}),
      employer: {
        connect: [{ documentId: employerDocumentId }],
      },
      employerContact: {
        connect: [{ documentId: contactDocumentId }],
      },
      enrollment: {
        connect: [{ documentId: body.enrollmentDocumentId }],
      },
      internalNote: body.internalNote || null,
      ...(interviewRequestDocumentId
        ? {
            interviewRequest: {
              connect: [{ documentId: interviewRequestDocumentId }],
            },
          }
        : {}),
      metadata: {
        capacityClaimDocumentId: body.capacityClaimDocumentId || null,
        earliestAllowedStartTime: earliestAllowed.toISOString(),
        interviewRequestDocumentId: interviewRequestDocumentId || null,
        requestId: requestContext.requestId,
        reusableSlotTopUp: isReusableTopUpClaim,
        source: 'employer_dashboard',
        submittedByEmployerContactDocumentId: contactDocumentId,
      },
      offerState: isReusableTopUpClaim ? 'draft' : 'submitted',
      requiredSlotCount,
    };
    const offer = await documents(strapi, 'api::interview-slot-offer.interview-slot-offer').create({
      data: offerData,
    });
    const offerDocumentId = getDocumentId(offer);

    if (!offerDocumentId) {
      throw new ValidationError('Interview slot offer could not be created.');
    }

    const slots = await Promise.all(
      normalizedSlots.map((slot) =>
        documents(strapi, 'api::interview-slot.interview-slot').create({
          data: {
            capacity: 1,
            employer: {
              connect: [{ documentId: employerDocumentId }],
            },
            employerContact: {
              connect: [{ documentId: slot.employerContactDocumentId }],
            },
            endTime: slot.endTime,
            locationDetails: slot.locationDetails || null,
            locationType: slot.locationType,
            meetingUrl: slot.meetingUrl || null,
            metadata: {
              requestId: requestContext.requestId,
              source: 'employer_dashboard',
            },
            slotOffer: {
              connect: [{ documentId: offerDocumentId }],
            },
            ...(regionDocumentId
              ? {
                  region: {
                    connect: [{ documentId: regionDocumentId }],
                  },
                }
              : {}),
            slotState: isReusableTopUpClaim ? 'available' : 'offered',
            startTime: slot.startTime,
            ...(workSectorDocumentId
              ? {
                  workSector: {
                    connect: [{ documentId: workSectorDocumentId }],
                  },
                }
              : {}),
          },
        })
      )
    );

    if (body.capacityClaimDocumentId && isReusableTopUpClaim) {
      const now = new Date().toISOString();

      await documents(strapi, 'api::employer-capacity-claim.employer-capacity-claim').update({
        documentId: body.capacityClaimDocumentId,
        data: {
          claimState: 'fulfilled',
          fulfilledAt: now,
          releaseReason: 'slot_options_submitted',
          metadata: {
            ...objectValue(capacityClaim?.metadata),
            fulfilledByEmployerContactDocumentId: contactDocumentId,
            fulfilledRequestId: requestContext.requestId,
            fulfilledSource: 'employer_dashboard_reusable_slot_top_up',
            reusableSlotDocumentIds: slots.map((slot) => getDocumentId(slot)).filter(Boolean),
          },
        },
      });
      await auditEvents(strapi).record({
        actorDisplayName: contactDisplayName(contact),
        actorId: contactDocumentId,
        actorType: 'employer_contact',
        eventCategory: 'interview',
        eventType: 'interview_request.reusable_slot_top_up_submitted',
        metadata: {
          capacityClaimDocumentId: body.capacityClaimDocumentId,
          interviewSlotOfferDocumentId: offerDocumentId,
          requestId: requestContext.requestId,
          reusableSlotDocumentIds: slots.map((slot) => getDocumentId(slot)).filter(Boolean),
        },
        requestId: requestContext.requestId,
        serviceName: requestContext.serviceName,
        severity: 'info',
        source: 'employer_dashboard',
        subjectId: interviewRequestDocumentId || body.capacityClaimDocumentId,
        subjectType: interviewRequestDocumentId ? 'interview_request' : 'employer_capacity_claim',
      });
      await interviewRequestService(strapi).reconcileReusableInterviewSlots(25, {
        ...requestContext,
        serviceName: requestContext.serviceName || 'employer-dashboard-top-up',
      });
    } else if (body.capacityClaimDocumentId) {
      await interviewRequestService(strapi).markSlotOptionsSubmitted(
        {
          capacityClaimDocumentId: body.capacityClaimDocumentId,
          interviewSlotOfferDocumentId: offerDocumentId,
        },
        requestContext
      );
    }

    return {
      created: true,
      offer: {
        documentId: offerDocumentId,
        offerState: offer.offerState || 'submitted',
        slots: slots.map((slot) => ({
          documentId: getDocumentId(slot),
          endTime: slot.endTime,
          locationLabel: locationLabel(slot),
          slotState: slot.slotState || (isReusableTopUpClaim ? 'available' : 'offered'),
          startTime: slot.startTime,
        })),
      },
    };
  },
});

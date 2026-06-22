import { createHash } from 'node:crypto';
import { errors, validateZodSchema, z } from '@strapi/utils';
import { getAuth0ManagementClient, type Auth0User } from '../../../utils/auth0-management';

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
  candidateNotifiedAt?: string;
  candidateResponseDeadline?: string;
  capacityChangeRequestStatus?: string;
  companyName?: string;
  contactState?: string;
  completedAt?: string;
  createdAt?: string;
  createdByStaffDisplayName?: string;
  createdByStaffEmail?: string;
  coverageRegions?: DocumentRecord[];
  dashboardOnboardingCompletedAt?: string;
  dashboardOnboardingMetadata?: unknown;
  dashboardOnboardingState?: string;
  documentId?: string;
  email?: string;
  employerTermsAcceptedAt?: string;
  employerTermsAcceptedByEmail?: string;
  employerTermsPolicyDocumentId?: string;
  employerTermsPolicyVersion?: string;
  employer?: DocumentRecord;
  employerContact?: DocumentRecord;
  endTime?: string;
  enrollment?: DocumentRecord;
  expiresAt?: string;
  firstName?: string;
  id?: number | string;
  introCopy?: string;
  initialInterviewCommitmentCadence?: string;
  initialInterviewCommitmentVolume?: number;
  interview?: DocumentRecord;
  interviewCommitmentCadence?: string;
  interviewCommitmentVolume?: number;
  interviewSlot?: DocumentRecord;
  interviewState?: string;
  lastName?: string;
  locationDetails?: string;
  locationType?: string;
  meetingUrl?: string;
  offerState?: string;
  inviteEmail?: string;
  inviteState?: string;
  operatingRegions?: DocumentRecord[];
  policyState?: string;
  policyType?: string;
  progressionState?: string;
  metadata?: unknown;
  region?: string;
  requestedDetailsAt?: string;
  roleTitle?: string;
  phone?: string;
  scheduledEndTime?: string;
  scheduledStartTime?: string;
  slotState?: string;
  slots?: DocumentRecord[];
  startTime?: string;
  submittedAt?: string;
  title?: string;
  updatedAt?: string;
  version?: string;
};

type DocumentCollection = {
  create(input: Record<string, unknown>): Promise<DocumentRecord>;
  findMany(input: Record<string, unknown>): Promise<DocumentRecord[]>;
  update(input: Record<string, unknown>): Promise<DocumentRecord>;
};

type StrapiDocumentService = {
  documents(uid: string): unknown;
  service(uid: string): unknown;
};

type AuditEventService = {
  record(input: unknown): Promise<unknown>;
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
    locationDetails: z.string().trim().max(500).optional().transform((value) => value || undefined),
    locationType: locationTypeSchema.default('online'),
    meetingUrl: z.string().trim().url().max(500).optional().or(z.literal('')).transform((value) => value || undefined),
    startTime: z.string().trim().min(1).max(80),
  })
  .strict();

const createInterviewSlotOfferSchema = identitySchema
  .extend({
    candidateDocumentId: z.string().trim().min(1).max(80),
    enrollmentDocumentId: z.string().trim().min(1).max(80),
    internalNote: z.string().trim().max(1000).optional().transform((value) => value || undefined),
    slots: z.array(slotSchema).length(3, 'Exactly 3 slot options are required.'),
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
const validateCreateInterviewSlotOffer = validateZodSchema(createInterviewSlotOfferSchema);
const validateInviteToken = validateZodSchema(inviteTokenSchema);
const validateAcceptInvite = validateZodSchema(acceptInviteSchema);

const documents = (strapi: StrapiDocumentService, uid: string) =>
  strapi.documents(uid) as DocumentCollection;

const auditEvents = (strapi: StrapiDocumentService) =>
  strapi.service('api::audit-event.audit-event') as AuditEventService;

const getDocumentId = (record?: DocumentRecord | null) =>
  typeof record?.documentId === 'string' ? record.documentId : null;

const hashInviteToken = (token: string) => createHash('sha256').update(token).digest('hex');

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

const employerDashboardBaseUrl = () =>
  trimTrailingSlash(process.env.EMPLOYER_DASHBOARD_BASE_URL || 'http://localhost:3004');

const employerInviteUrl = (token: string) =>
  `${employerDashboardBaseUrl()}/invite/${encodeURIComponent(token)}`;

const compact = <T>(items: Array<T | false | null | undefined>) =>
  items.filter((item): item is T => Boolean(item));

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

const publicContactPayload = (contact: DocumentRecord) => ({
  contactState: contact.contactState || 'listed',
  contactStateLabel: humanize(String(contact.contactState || 'listed')),
  coverageRegionNames: regionNames(publicRegionOptions(contact.coverageRegions)),
  coverageRegions: publicRegionOptions(contact.coverageRegions),
  documentId: getDocumentId(contact) || String(contact.id || ''),
  email: contact.email || null,
  firstName: contact.firstName || null,
  lastName: contact.lastName || null,
  name: contactDisplayName(contact),
  phone: contact.phone || null,
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

const onboardingPayload = (
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

  return {
    availableRegions: publicRegionOptions(availableRegions),
    commitment: {
      cadence: employer?.interviewCommitmentCadence || employer?.initialInterviewCommitmentCadence || 'not_set',
      label: commitmentLabel(employer),
      mode: employer?.commitmentMode || 'global',
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
    leadContact: publicContactPayload(contact),
    state: dashboardOnboardingState(employer),
    teamContacts: contacts
      .filter((teamContact) => getDocumentId(teamContact) !== getDocumentId(contact))
      .filter((teamContact) => !['archived', 'disabled'].includes(String(teamContact.contactState || '')))
      .map(publicContactPayload),
    terms: {
      acceptedAt: employer?.employerTermsAcceptedAt || null,
      acceptedByEmail: employer?.employerTermsAcceptedByEmail || null,
      acceptedPolicyDocumentId: employer?.employerTermsPolicyDocumentId || null,
      acceptedPolicyVersion: employer?.employerTermsPolicyVersion || null,
      policy: sanitizePolicyDocument(termsPolicy),
    },
  };
};

const accountPayload = (contact: DocumentRecord) => {
  const employer = contact.employer;
  const regions = employerRegions(employer);
  const regionsLabel = regionLabel(regions);

  return {
    assignmentModeLabel: humanize(String(employer?.assignmentMode || 'automatic')),
    cadenceLabel: humanize(String(employer?.interviewCommitmentCadence || 'not_set')),
    commitmentLabel: commitmentLabel(employer),
    companyName: employer?.companyName || 'Employer dashboard',
    contactEmail: contact.email || 'Not recorded',
    contactName: contactDisplayName(contact),
    onboarding: onboardingPayload(contact),
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
	    account: accountPayload(updatedContact),
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
    (initialVolume !== requestedVolume || initialCadence !== requestedCadence);

  if (!changed) {
    return null;
  }

  return documents(strapi, 'api::employer-capacity-change-request.employer-capacity-change-request').create({
    data: {
      currentInterviewCommitmentCadence: initialCadence,
      currentInterviewCommitmentVolume: initialVolume,
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
      requestedInterviewCommitmentCadence: requestedCadence,
      requestedInterviewCommitmentVolume: requestedVolume,
      requestState: 'pending',
    },
  });
};

const availabilityRequestPayload = (offer: DocumentRecord) => ({
  candidateName: candidateDisplayName(offer.candidate),
  courseLabel: 'Interview phase',
  documentId: getDocumentId(offer) || String(offer.id || ''),
  earliestSlotLabel: offer.slots?.[0]?.startTime
    ? formatDateTime(String(offer.slots[0].startTime))
    : '4 working days notice required',
  responseLabel: offer.candidateResponseDeadline
    ? formatDateTime(offer.candidateResponseDeadline)
    : 'Response deadline starts once sent',
  statusLabel: humanize(String(offer.offerState || 'submitted')),
});

const interviewPayload = (interview: DocumentRecord) => ({
  candidateName: candidateDisplayName(interview.candidate),
  documentId: getDocumentId(interview) || String(interview.id || ''),
  locationLabel: interview.interviewSlot
    ? locationLabel(interview.interviewSlot)
    : 'Location not recorded',
  scheduledLabel: formatDateTime(interview.scheduledStartTime),
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

const progressionPayload = (offer: DocumentRecord) => ({
  candidateName: candidateDisplayName(offer.candidate),
  documentId: getDocumentId(offer) || String(offer.id || ''),
  requestedLabel: formatDateTime(offer.requestedDetailsAt || offer.createdAt),
  statusLabel: humanize(String(offer.progressionState || 'requested')),
});

export default ({ strapi }) => ({
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
	      account: accountPayload(contact),
	      generatedAt: new Date().toISOString(),
	      onboarding: onboardingPayload(contact, {
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
	      (initialVolume !== requestedVolume || initialCadence !== requestedCadence);
	    const leadContactUpdate = await documents(strapi, 'api::employer-contact.employer-contact').update({
	      documentId: contactDocumentId,
	      data: {
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
	      account: accountPayload(refreshedContact),
	      completed: true,
	      onboarding: onboardingPayload(refreshedContact, {
	        availableRegions: await getOperationalClassAreas(strapi),
	        termsPolicy,
	      }),
	    };
	  },
	
	  async getOverview(input: unknown) {
	    const identity = validateIdentity(input);
    const contact = await findEmployerContact(strapi, identity);
    const employerDocumentId = getDocumentId(contact.employer);

    if (!employerDocumentId) {
      throw new ValidationError('Employer record could not be found.');
    }

    const [
      slotOffers,
      availableSlots,
      scheduledInterviews,
      completedInterviews,
      progressionRequests,
    ] = await Promise.all([
      documents(strapi, 'api::interview-slot-offer.interview-slot-offer').findMany({
        filters: {
          employer: {
            documentId: employerDocumentId,
          },
          offerState: {
            $in: ['draft', 'submitted', 'sent'],
          },
        },
        limit: 50,
        populate: ['candidate', 'slots'],
        sort: ['createdAt:desc'],
      }),
      documents(strapi, 'api::interview-slot.interview-slot').findMany({
        filters: {
          employer: {
            documentId: employerDocumentId,
          },
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
          interviewState: {
            $in: ['candidate_selected', 'confirmed'],
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

    return {
      account: accountPayload(contact),
      availabilityRequests: slotOffers.map(availabilityRequestPayload),
      feedbackRequests: feedbackDue.map(feedbackPayload),
      generatedAt: new Date().toISOString(),
      interviews: scheduledInterviews.map(interviewPayload),
      progressionRequests: progressionRequests.map(progressionPayload),
      summary: {
        availableSlots: availableSlots.length,
        feedbackDue: feedbackDue.length,
        interviewsScheduled: scheduledInterviews.length,
        progressionRequests: progressionRequests.length,
      },
    };
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

    const now = new Date();
    const earliestAllowed = addWorkingDays(now, 4);
    const normalizedSlots = body.slots.map((slot) => {
      const startTime = assertIsoDate(slot.startTime, 'Slot start time is invalid.');
      const endTime = assertIsoDate(slot.endTime, 'Slot end time is invalid.');

      if (endTime <= startTime) {
        throw new ValidationError('Slot end time must be after the start time.');
      }

      if (startTime < earliestAllowed) {
        throw new ValidationError('The earliest slot must allow at least 4 working days notice.');
      }

      return {
        ...slot,
        endTime: endTime.toISOString(),
        startTime: startTime.toISOString(),
      };
    });
    const uniqueStarts = new Set(normalizedSlots.map((slot) => slot.startTime));

    if (uniqueStarts.size !== normalizedSlots.length) {
      throw new ValidationError('Slot options must use different start times.');
    }

    const offer = await documents(strapi, 'api::interview-slot-offer.interview-slot-offer').create({
      data: {
        candidate: {
          connect: [{ documentId: body.candidateDocumentId }],
        },
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
        metadata: {
          earliestAllowedStartTime: earliestAllowed.toISOString(),
          requestId: requestContext.requestId,
          source: 'employer_dashboard',
          submittedByEmployerContactDocumentId: contactDocumentId,
        },
        offerState: 'submitted',
      },
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
              connect: [{ documentId: contactDocumentId }],
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
            slotState: 'offered',
            startTime: slot.startTime,
          },
        })
      )
    );

    return {
      created: true,
      offer: {
        documentId: offerDocumentId,
        offerState: offer.offerState || 'submitted',
        slots: slots.map((slot) => ({
          documentId: getDocumentId(slot),
          endTime: slot.endTime,
          locationLabel: locationLabel(slot),
          slotState: slot.slotState || 'offered',
          startTime: slot.startTime,
        })),
      },
    };
  },
});

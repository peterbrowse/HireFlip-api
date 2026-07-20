import { errors, validateZodSchema, z } from '@strapi/utils';
import PDFDocument from 'pdfkit';
import { getAuth0ManagementClient } from '../../../utils/auth0-management';

const { ForbiddenError, ValidationError } = errors;

type RequestContext = {
  ipAddress?: string;
  requestId?: string;
  serviceName?: string;
  userAgent?: string;
};

type AdminSession = {
  user: {
    displayName: string;
    email: string;
    id: string;
    roleKeys: string[];
    roles: string[];
  };
};

type AdminAuthService = {
  getSession(input: unknown, context: RequestContext): Promise<AdminSession>;
};

type AuditEventService = {
  record(input: unknown): Promise<unknown>;
};

type DocumentRecord = Record<string, unknown> & {
  accountCreatedAt?: string;
  accountOnboardingCompletedAt?: string;
  accountRestrictionStatus?: string;
  appliedAt?: string;
  actorDisplayName?: string;
  actorEmail?: string;
  actorId?: string;
  actorType?: string;
  authIdentityId?: string;
  candidate?: DocumentRecord;
  candidateState?: string;
  caseState?: string;
  caseType?: string;
  class?: DocumentRecord;
  completedAt?: string;
  completionStatus?: string;
  createdAt?: string;
  candidateResponse?: string;
  candidateResponseDeadline?: string;
  dateOfBirth?: string;
  documentId?: string;
  email?: string;
  employer?: DocumentRecord;
  employerContact?: DocumentRecord;
  enrollment?: DocumentRecord;
  enrollmentState?: string;
  eventCategory?: string;
  eventType?: string;
  firstName?: string;
  gender?: string;
  genderSelfDescription?: string;
  id?: number | string;
  interview?: DocumentRecord;
  interviewState?: string;
  lastMessageAt?: string;
  lastName?: string;
  metadata?: unknown;
  openedAt?: string;
  passStatus?: string;
  paymentStatus?: string;
  phone?: string;
  priority?: string;
  profileImage?: DocumentRecord;
  progressionState?: string;
  progressionType?: string;
  profileState?: string;
  requestedDetailsAt?: string;
  recruitmentPlatformVisibility?: string;
  region?: string;
  reviewedAt?: string;
  reviewedByAdminId?: string;
  reviewDecision?: string;
  salesOwnerStaffEmail?: string;
  salesOwnerStaffDisplayName?: string;
  salesOwnerStaffUserId?: string;
  scheduledEndTime?: string;
  scheduledStartTime?: string;
  sector?: string;
  strikeNumber?: number;
  strikeState?: string;
  subjectDisplayName?: string;
  subjectId?: string;
  subjectType?: string;
  title?: string;
  updatedAt?: string;
  userAgent?: string;
};

type DocumentCollection = {
  count(input: Record<string, unknown>): Promise<number>;
  create(input: Record<string, unknown>): Promise<DocumentRecord>;
  findMany(input: Record<string, unknown>): Promise<DocumentRecord[]>;
  update(input: Record<string, unknown>): Promise<DocumentRecord>;
};

type StrapiService = {
  documents(uid: string): unknown;
  service(uid: string): unknown;
};

type NotificationServiceQueueResponse = {
  data?: {
    jobId?: unknown;
    queued?: unknown;
    type?: unknown;
  };
};

const sessionTokenSchema = z
  .object({
    sessionToken: z.string().trim().min(32).max(512),
  })
  .strict();

const listCandidatesSchema = sessionTokenSchema
  .extend({
    classDocumentId: z.string().trim().max(120).optional().transform((value) => value || undefined),
    readiness: z
      .enum(['all', 'availability_expired', 'complete', 'incomplete', 'ready'])
      .default('all'),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(10).max(100).default(25),
    region: z.string().trim().max(120).optional().transform((value) => value || undefined),
    search: z.string().trim().max(160).optional().transform((value) => value || undefined),
    sector: z.string().trim().max(120).optional().transform((value) => value || undefined),
    sortBy: z
      .enum(['class', 'candidateState', 'displayName', 'email', 'readiness', 'region', 'sector', 'updatedAt'])
      .default('updatedAt'),
    sortDirection: z.enum(['asc', 'desc']).default('desc'),
    state: z.string().trim().max(120).optional().transform((value) => value || undefined),
  })
  .strict();

const candidateDetailSchema = sessionTokenSchema
  .extend({
    candidateDocumentId: z.string().trim().min(1).max(120),
  })
  .strict();
const candidateActivitySchema = candidateDetailSchema
  .extend({
    actorType: z.string().trim().max(80).optional().transform((value) => value || undefined),
    category: z.string().trim().max(120).optional().transform((value) => value || undefined),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(5).max(100).default(5),
    search: z.string().trim().max(180).optional().transform((value) => value || undefined),
    severity: z.string().trim().max(80).optional().transform((value) => value || undefined),
    source: z.string().trim().max(120).optional().transform((value) => value || undefined),
  })
  .strict();
const candidateActivityReportSchema = candidateDetailSchema
  .extend({
    redaction: z.enum(['full', 'redacted']).default('redacted'),
  })
  .strict();

const candidateProfileUpdateSchema = candidateDetailSchema
  .extend({
    candidateNote: z.string().trim().max(4000).optional().transform((value) => value || undefined),
    dateOfBirth: z.string().trim().max(10).optional().transform((value) => value || undefined),
    profile: z
      .object({
        education: z.unknown().optional(),
        experience: z.unknown().optional(),
        linkedinUrl: z.string().trim().max(300).nullable().optional(),
        location: z.string().trim().max(180).nullable().optional(),
        portfolioUrl: z.string().trim().max(300).nullable().optional(),
        preferredWorkStyle: z.enum(['in_person', 'hybrid', 'remote', 'no_preference']).nullable().optional(),
        projects: z.unknown().optional(),
        skills: z.unknown().optional(),
        summary: z.string().trim().max(5000).nullable().optional(),
        targetRoleTitle: z.string().trim().max(180).nullable().optional(),
        targetRoleType: z
          .enum(['full_time', 'part_time', 'apprenticeship_internship', 'flexible'])
          .nullable()
          .optional(),
        targetSector: z.string().trim().max(180).nullable().optional(),
        targetSectorLabel: z.string().trim().max(180).nullable().optional(),
      })
      .strict(),
    reasonNote: z.string().trim().min(3).max(4000),
  })
  .strict();

const candidateAccountActionSchema = candidateDetailSchema
  .extend({
    action: z.enum(['archive', 'blacklist', 'reactivate', 'suspend']),
    candidateNote: z.string().trim().max(4000).optional().transform((value) => value || undefined),
    reasonNote: z.string().trim().min(3).max(4000),
  })
  .strict();

const supportCreateSchema = candidateDetailSchema
  .extend({
    assignedTo: z
      .object({
        displayName: z.string().trim().min(1).max(240),
        email: z.string().trim().email().max(254),
        id: z.string().trim().min(1).max(160),
        roleKey: z.enum(['admin', 'sales', 'super_admin', 'support']).optional(),
      })
      .optional(),
    caseType: z
      .enum(['general', 'refund', 'payment', 'course', 'interview', 'account', 'privacy', 'other'])
      .default('general'),
    initialNote: z.string().trim().min(1).max(12000),
    ownerRoleKey: z.enum(['admin', 'sales', 'super_admin', 'support']).optional(),
    priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
    title: z.string().trim().min(1).max(180),
  })
  .strict();

const strikeActionSchema = candidateDetailSchema
  .extend({
    action: z.enum(['apply', 'expire', 'remove', 'reset_all', 'uphold']),
    reason: z.enum(['admin_applied', 'other']).default('admin_applied'),
    reasonNote: z.string().trim().min(3).max(4000),
    strikeDocumentId: z.string().trim().max(120).optional().transform((value) => value || undefined),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (['expire', 'remove', 'uphold'].includes(value.action) && !value.strikeDocumentId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Strike document ID is required for this action.',
        path: ['strikeDocumentId'],
      });
    }
  });

const validateListCandidates = validateZodSchema(listCandidatesSchema);
const validateCandidateDetail = validateZodSchema(candidateDetailSchema);
const validateCandidateActivity = validateZodSchema(candidateActivitySchema);
const validateCandidateActivityReport = validateZodSchema(candidateActivityReportSchema);
const validateCandidateAccountAction = validateZodSchema(candidateAccountActionSchema);
const validateCandidateProfileUpdate = validateZodSchema(candidateProfileUpdateSchema);
const validateSupportCreate = validateZodSchema(supportCreateSchema);
const validateStrikeAction = validateZodSchema(strikeActionSchema);

const documents = (strapi: StrapiService, uid: string) =>
  strapi.documents(uid) as DocumentCollection;

const findAllDocuments = async (
  strapi: StrapiService,
  uid: string,
  input: Record<string, unknown>,
  pageSize = 100
) => {
  const collection = documents(strapi, uid);
  const filters = (input.filters || {}) as Record<string, unknown>;
  const total = await collection.count({ filters });
  const records: DocumentRecord[] = [];

  for (let start = 0; start < total; start += pageSize) {
    records.push(
      ...(await collection.findMany({
        ...input,
        limit: pageSize,
        start,
      }))
    );
  }

  return records;
};

const adminAuthService = (strapi: StrapiService): AdminAuthService =>
  strapi.service('api::admin-auth.admin-auth') as unknown as AdminAuthService;

const auditEvents = (strapi: StrapiService) =>
  strapi.service('api::audit-event.audit-event') as AuditEventService;

const hasAnyRole = (session: AdminSession, roles: string[]) =>
  roles.some((role) => session.user.roleKeys.includes(role));

const compact = <T>(items: Array<T | false | null | undefined>) =>
  items.filter((item): item is T => Boolean(item));

const objectValue = (value: unknown) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const stringValue = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const getDocumentId = (record?: DocumentRecord | null) => {
  if (!record) {
    return null;
  }

  return typeof record.documentId === 'string'
    ? record.documentId
    : typeof record.id === 'number' || typeof record.id === 'string'
      ? String(record.id)
      : null;
};

const relationConnect = (record?: DocumentRecord | null) =>
  getDocumentId(record) ? { connect: [{ documentId: getDocumentId(record) }] } : undefined;

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

const getIntegerEnv = (key: string, fallback: number) => {
  const value = Number.parseInt(process.env[key] || '', 10);

  return Number.isFinite(value) ? value : fallback;
};

const displayName = (candidate?: DocumentRecord | null) => {
  const fullName = [candidate?.firstName, candidate?.lastName].filter(Boolean).join(' ').trim();

  return fullName || candidate?.email || 'Candidate';
};

const jsonClone = (value: unknown) => JSON.parse(JSON.stringify(value ?? null));

const renderCandidateExportPdf = ({
  candidate,
  data,
}: {
  candidate: DocumentRecord;
  data: Record<string, unknown>;
}) =>
  new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({
      margins: {
        bottom: 48,
        left: 48,
        right: 48,
        top: 48,
      },
      size: 'A4',
    });

    doc.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    doc.fontSize(20).text('HireFlip Candidate Data Export');
    doc.moveDown(0.5);
    doc.fontSize(10).text(`Generated: ${new Date().toISOString()}`);
    doc.text(`Candidate: ${displayName(candidate)} (${candidate.email || 'No email'})`);
    doc.text(`Candidate ID: ${getDocumentId(candidate) || 'Not recorded'}`);
    doc.moveDown();
    doc.fontSize(14).text('Export Data');
    doc.moveDown(0.5);
    doc.fontSize(8).text(JSON.stringify(jsonClone(data), null, 2), {
      lineGap: 2,
    });
    doc.end();
  });

const redactedValue = '[redacted]';
const normalizedSensitiveActivityFieldNames = new Set([
  'address',
  'actordisplayname',
  'actoremail',
  'actorid',
  'authidentityid',
  'authorization',
  'candidateaddress',
  'candidatedisplayname',
  'candidateemail',
  'candidatefirstname',
  'candidateid',
  'candidatelastname',
  'candidatephone',
  'checkoutsessionid',
  'checkouturl',
  'cookie',
  'cvurl',
  'dateofbirth',
  'displayname',
  'email',
  'firstname',
  'gender',
  'genderselfdescription',
  'ipaddress',
  'lastname',
  'linkedinurl',
  'location',
  'meetingurl',
  'name',
  'phone',
  'portfoliourl',
  'postcode',
  'profileimage',
  'providercheckoutsessionid',
  'providerpaymentintentid',
  'providerreceipturl',
  'providerrefundid',
  'receipturl',
  'sessiontoken',
  'stripeaccountid',
  'stripereceipturl',
  'subjectdisplayname',
  'token',
  'url',
  'useragent',
]);

const normalizedActivityFieldName = (key: string) => key.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

const shouldRedactActivityField = (key: string) => {
  const normalizedKey = normalizedActivityFieldName(key);

  return (
    normalizedSensitiveActivityFieldNames.has(normalizedKey) ||
    normalizedKey.endsWith('email') ||
    normalizedKey.endsWith('phone') ||
    normalizedKey.endsWith('token') ||
    normalizedKey.endsWith('secret') ||
    normalizedKey.endsWith('password') ||
    normalizedKey.endsWith('receipturl')
  );
};

const redactActivityString = (value: string) =>
  value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, redactedValue)
    .replace(/https:\/\/pay\.stripe\.com\/[^\s"')]+/gi, redactedValue)
    .replace(/\+?\d[\d\s().-]{7,}\d/g, redactedValue);

const redactActivityValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(redactActivityValue);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => [
        key,
        shouldRedactActivityField(key) ? redactedValue : redactActivityValue(child),
      ])
    );
  }

  if (typeof value === 'string') {
    return redactActivityString(value);
  }

  return value;
};

const safeFileNamePart = (value?: string | null) =>
  (value || 'candidate').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) ||
  'candidate';

const activityReportEventPayload = (event: DocumentRecord, redaction: 'full' | 'redacted') => {
  const shouldRedact = redaction === 'redacted';

  return {
    actorDisplayName: shouldRedact ? redactedValue : event.actorDisplayName || null,
    actorEmail: shouldRedact ? redactedValue : event.actorEmail || null,
    actorId: shouldRedact ? redactedValue : event.actorId || null,
    actorType: event.actorType || null,
    eventCategory: event.eventCategory || null,
    eventType: event.eventType || null,
    ipAddress: shouldRedact ? redactedValue : event.ipAddress || null,
    metadata: shouldRedact ? redactActivityValue(event.metadata) : event.metadata || null,
    newState: shouldRedact ? redactActivityValue(event.newState) : event.newState || null,
    occurredAt: event.occurredAt || event.createdAt || null,
    previousState: shouldRedact ? redactActivityValue(event.previousState) : event.previousState || null,
    requestId: event.requestId || null,
    serviceName: event.serviceName || null,
    severity: event.severity || null,
    source: event.source || null,
    subjectDisplayName: shouldRedact ? redactedValue : event.subjectDisplayName || null,
    subjectId: event.subjectId || null,
    subjectType: event.subjectType || null,
    userAgent: shouldRedact ? redactedValue : event.userAgent || null,
  };
};

const renderCandidateActivityReportPdf = ({
  candidate,
  report,
}: {
  candidate: DocumentRecord;
  report: Record<string, unknown>;
}) =>
  new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({
      margins: {
        bottom: 48,
        left: 48,
        right: 48,
        top: 48,
      },
      size: 'A4',
    });

    doc.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    doc.fontSize(20).text('HireFlip Candidate Activity Report');
    doc.moveDown(0.5);
    doc.fontSize(10).text(`Generated: ${String(report.generatedAt || new Date().toISOString())}`);
    doc.text(`Candidate: ${String(report.candidateDisplayName || displayName(candidate))}`);
    doc.text(`Candidate ID: ${getDocumentId(candidate) || 'Not recorded'}`);
    doc.text(`Redaction: ${String(report.redaction || 'redacted')}`);
    doc.text(`Events: ${Array.isArray(report.auditEvents) ? report.auditEvents.length : 0}`);
    doc.moveDown();
    doc.fontSize(14).text('Activity Events');
    doc.moveDown(0.5);
    doc.fontSize(8).text(JSON.stringify(jsonClone(report), null, 2), {
      lineGap: 2,
    });
    doc.end();
  });

const humanize = (value?: string | null) =>
  value
    ? value
        .split('_')
        .filter(Boolean)
        .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
        .join(' ')
    : 'Not recorded';

const formatDate = (value?: string | null) => {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};

const assertCandidateSession = async (
  strapi: StrapiService,
  sessionToken: string,
  context: RequestContext
) => {
  const session = await adminAuthService(strapi).getSession({ sessionToken }, context);

  if (!hasAnyRole(session, ['admin', 'sales', 'super_admin', 'support'])) {
    throw new ForbiddenError('Candidate Management access is required.');
  }

  return session;
};

const candidatePermissions = (session: AdminSession) => ({
  canCreateSupportCase: hasAnyRole(session, ['admin', 'sales', 'super_admin', 'support']),
  canEditDateOfBirth: hasAnyRole(session, ['super_admin']),
  canEditProfile: hasAnyRole(session, ['admin', 'super_admin', 'support']),
  canExportActivityReport: hasAnyRole(session, ['admin', 'super_admin']),
  canExportGdpr: hasAnyRole(session, ['super_admin']),
  canManageAccount: hasAnyRole(session, ['admin', 'super_admin']),
  canReactivateBlacklisted: hasAnyRole(session, ['super_admin']),
  canManageStrikes: hasAnyRole(session, ['admin', 'super_admin']),
  canViewSensitiveFields: hasAnyRole(session, ['admin', 'super_admin']),
  canViewAllCandidates: hasAnyRole(session, ['admin', 'super_admin', 'support']),
});

const findCandidateByDocumentId = async (strapi: StrapiService, candidateDocumentId: string) => {
  const candidates = await documents(strapi, 'api::candidate.candidate').findMany({
    filters: {
      documentId: candidateDocumentId,
    },
    limit: 1,
    populate: ['profileImage'],
  });

  return candidates[0] || null;
};

const latestCandidateProfile = async (strapi: StrapiService, candidateDocumentId: string) => {
  const profiles = await documents(strapi, 'api::candidate-profile.candidate-profile').findMany({
    filters: {
      candidate: {
        documentId: candidateDocumentId,
      },
    },
    limit: 1,
    sort: ['updatedAt:desc'],
  });

  return profiles[0] || null;
};

const candidateEnrollments = async (strapi: StrapiService, candidateDocumentId: string) =>
  findAllDocuments(strapi, 'api::enrollment.enrollment', {
    filters: {
      candidate: {
        documentId: candidateDocumentId,
      },
    },
    populate: {
      class: {
        populate: ['classArea', 'course', 'workSector'],
      },
    },
    sort: ['updatedAt:desc'],
  });

const candidateInterviewRequests = async (strapi: StrapiService, candidateDocumentId: string) =>
  findAllDocuments(strapi, 'api::interview-request.interview-request', {
    filters: {
      candidate: {
        documentId: candidateDocumentId,
      },
    },
    populate: ['class', 'region'],
    sort: ['updatedAt:desc'],
  });

const candidateSlotOffers = async (strapi: StrapiService, candidateDocumentId: string) =>
  findAllDocuments(strapi, 'api::interview-slot-offer.interview-slot-offer', {
    filters: {
      candidate: {
        documentId: candidateDocumentId,
      },
    },
    populate: ['employer', 'employerContact', 'selectedInterview'],
    sort: ['updatedAt:desc'],
  });

const candidateInterviews = async (strapi: StrapiService, candidateDocumentId: string) =>
  findAllDocuments(strapi, 'api::interview.interview', {
    filters: {
      candidate: {
        documentId: candidateDocumentId,
      },
    },
    populate: ['employer', 'employerContact', 'interviewSlot'],
    sort: ['scheduledStartTime:desc', 'updatedAt:desc'],
  });

const candidateProgressionRequests = async (strapi: StrapiService, candidateDocumentId: string) =>
  findAllDocuments(strapi, 'api::offer.offer', {
    filters: {
      candidate: {
        documentId: candidateDocumentId,
      },
    },
    populate: ['employer', 'interview', 'requestedByEmployerContact'],
    sort: ['requestedDetailsAt:desc', 'createdAt:desc'],
  });

const candidateStrikes = async (strapi: StrapiService, candidateDocumentId: string) =>
  findAllDocuments(strapi, 'api::candidate-interview-strike.candidate-interview-strike', {
    filters: {
      candidate: {
        documentId: candidateDocumentId,
      },
    },
    populate: ['interview'],
    sort: ['appliedAt:desc', 'updatedAt:desc'],
  });

const candidateSupportCases = async (strapi: StrapiService, candidateDocumentId: string) =>
  findAllDocuments(strapi, 'api::support-case.support-case', {
    filters: {
      candidate: {
        documentId: candidateDocumentId,
      },
    },
    sort: ['lastMessageAt:desc', 'updatedAt:desc'],
  });

const candidateAuditBaseFilter = (candidate: DocumentRecord) => ({
  $or: compact([
    getDocumentId(candidate)
      ? {
          subjectId: getDocumentId(candidate),
          subjectType: 'candidate',
        }
      : null,
    candidate.authIdentityId
      ? {
          actorId: candidate.authIdentityId,
          actorType: 'candidate',
        }
      : null,
    candidate.email
      ? {
          actorEmail: candidate.email,
          actorType: 'candidate',
        }
      : null,
  ]),
});

const candidateAuditFilters = (
  candidate: DocumentRecord,
  filters: {
    actorType?: string;
    category?: string;
    search?: string;
    severity?: string;
    source?: string;
  } = {}
) => {
  const andFilters: Record<string, unknown>[] = [candidateAuditBaseFilter(candidate)];

  if (filters.actorType) {
    andFilters.push({ actorType: filters.actorType });
  }

  if (filters.category) {
    andFilters.push({
      $or: [
        { eventCategory: filters.category },
        { eventType: { $containsi: filters.category } },
      ],
    });
  }

  if (filters.severity) {
    andFilters.push({ severity: filters.severity });
  }

  if (filters.source) {
    andFilters.push({ source: filters.source });
  }

  if (filters.search) {
    andFilters.push({
      $or: [
        { actorDisplayName: { $containsi: filters.search } },
        { actorEmail: { $containsi: filters.search } },
        { actorId: { $containsi: filters.search } },
        { actorType: { $containsi: filters.search } },
        { eventCategory: { $containsi: filters.search } },
        { eventType: { $containsi: filters.search } },
        { ipAddress: { $containsi: filters.search } },
        { requestId: { $containsi: filters.search } },
        { serviceName: { $containsi: filters.search } },
        { severity: { $containsi: filters.search } },
        { source: { $containsi: filters.search } },
        { subjectDisplayName: { $containsi: filters.search } },
        { subjectId: { $containsi: filters.search } },
        { subjectType: { $containsi: filters.search } },
      ],
    });
  }

  return { $and: andFilters };
};

const candidateAuditEvents = async (strapi: StrapiService, candidate: DocumentRecord) =>
  findAllDocuments(strapi, 'api::audit-event.audit-event', {
    filters: candidateAuditFilters(candidate),
    sort: ['occurredAt:desc', 'createdAt:desc'],
  });

const candidateAuditCount = (strapi: StrapiService, candidate: DocumentRecord) =>
  documents(strapi, 'api::audit-event.audit-event').count({
    filters: candidateAuditFilters(candidate),
  });

const candidateActivityOption = (value: string) => ({
  label: value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase()),
  value,
});

const candidateActivityOptions = async (strapi: StrapiService, candidate: DocumentRecord) => {
  const records = await candidateAuditEvents(strapi, candidate);
  const unique = (values: unknown[]) =>
    Array.from(new Set(values.filter((value): value is string => typeof value === 'string' && Boolean(value)))).sort();

  return {
    actorTypes: unique(records.map((event) => event.actorType)).map(candidateActivityOption),
    categories: unique(
      records.map((event) =>
        typeof event.eventCategory === 'string' && event.eventCategory
          ? event.eventCategory
          : typeof event.eventType === 'string'
            ? event.eventType.split('.')[0]
            : null
      )
    ).map(candidateActivityOption),
    severities: unique(records.map((event) => event.severity)).map(candidateActivityOption),
    sources: unique(records.map((event) => event.source)).map(candidateActivityOption),
  };
};

const findOwnedEmployerIds = async (strapi: StrapiService, session: AdminSession) => {
  const employers = await findAllDocuments(strapi, 'api::employer.employer', {
    filters: {
      $or: [
        {
          salesOwnerStaffUserId: session.user.id,
        },
        {
          salesOwnerStaffEmail: session.user.email,
        },
      ],
    },
  });

  return new Set(compact(employers.map(getDocumentId)));
};

const findSalesScopedCandidateIds = async (strapi: StrapiService, session: AdminSession) => {
  const ownedEmployerIds = await findOwnedEmployerIds(strapi, session);
  const candidateIds = new Set<string>();

  if (ownedEmployerIds.size === 0) {
    return candidateIds;
  }

  const [interviews, slotOffers, capacityClaims] = await Promise.all([
    findAllDocuments(strapi, 'api::interview.interview', {
      populate: ['candidate', 'employer'],
    }),
    findAllDocuments(strapi, 'api::interview-slot-offer.interview-slot-offer', {
      populate: ['candidate', 'employer'],
    }),
    findAllDocuments(strapi, 'api::employer-capacity-claim.employer-capacity-claim', {
      populate: {
        employer: true,
        interviewRequest: {
          populate: ['candidate'],
        },
      },
    }),
  ]);

  for (const interview of interviews) {
    if (ownedEmployerIds.has(getDocumentId(interview.employer) || '')) {
      const candidateId = getDocumentId(interview.candidate);

      if (candidateId) {
        candidateIds.add(candidateId);
      }
    }
  }

  for (const offer of slotOffers) {
    if (ownedEmployerIds.has(getDocumentId(offer.employer) || '')) {
      const candidateId = getDocumentId(offer.candidate);

      if (candidateId) {
        candidateIds.add(candidateId);
      }
    }
  }

  for (const claim of capacityClaims) {
    if (ownedEmployerIds.has(getDocumentId(claim.employer) || '')) {
      const candidateId = getDocumentId((claim.interviewRequest as DocumentRecord | undefined)?.candidate);

      if (candidateId) {
        candidateIds.add(candidateId);
      }
    }
  }

  return candidateIds;
};

const salesScopeFilter = (session: AdminSession) => ({
  $or: [
    {
      interviews: {
        employer: {
          salesOwnerStaffUserId: session.user.id,
        },
      },
    },
    {
      interviews: {
        employer: {
          salesOwnerStaffEmail: session.user.email,
        },
      },
    },
    {
      interviewSlotOffers: {
        employer: {
          salesOwnerStaffUserId: session.user.id,
        },
      },
    },
    {
      interviewSlotOffers: {
        employer: {
          salesOwnerStaffEmail: session.user.email,
        },
      },
    },
    {
      interviewRequests: {
        claims: {
          employer: {
            salesOwnerStaffUserId: session.user.id,
          },
        },
      },
    },
    {
      interviewRequests: {
        claims: {
          employer: {
            salesOwnerStaffEmail: session.user.email,
          },
        },
      },
    },
  ],
});

type CandidateListInput = z.infer<typeof listCandidatesSchema>;

const candidateReadinessFilter = (readiness: CandidateListInput['readiness']) => {
  const now = new Date().toISOString();

  if (readiness === 'all') {
    return null;
  }

  if (readiness === 'ready') {
    return {
      profiles: {
        availabilityConfirmedAt: {
          $notNull: true,
        },
        availabilityExpiresAt: {
          $gt: now,
        },
        profileState: 'completed',
      },
    };
  }

  if (readiness === 'complete') {
    return {
      profiles: {
        profileState: 'completed',
      },
    };
  }

  if (readiness === 'availability_expired') {
    return {
      profiles: {
        profileState: 'completed',
        $or: [
          {
            availabilityExpiresAt: {
              $null: true,
            },
          },
          {
            availabilityExpiresAt: {
              $lte: now,
            },
          },
        ],
      },
    };
  }

  return {
    profiles: {
      profileState: {
        $ne: 'completed',
      },
    },
  };
};

const candidateSearchFilter = (search?: string) => {
  if (!search) {
    return null;
  }

  return {
    $or: [
      { documentId: { $containsi: search } },
      { email: { $containsi: search } },
      { firstName: { $containsi: search } },
      { lastName: { $containsi: search } },
      { phone: { $containsi: search } },
      { region: { $containsi: search } },
      { sector: { $containsi: search } },
      { profiles: { targetRoleTitle: { $containsi: search } } },
      { profiles: { targetSectorLabel: { $containsi: search } } },
      { enrollments: { class: { displayTitle: { $containsi: search } } } },
      { enrollments: { class: { name: { $containsi: search } } } },
      { enrollments: { class: { officialClassCode: { $containsi: search } } } },
    ],
  };
};

const candidateListFilters = ({
  body,
  includeSearch,
  session,
}: {
  body: CandidateListInput;
  includeSearch: boolean;
  session: AdminSession;
}) => {
  const permissions = candidatePermissions(session);
  const filters: Record<string, unknown> = {};
  const andFilters: Record<string, unknown>[] = [];
  const stateFilter = body.state || 'all';

  if (stateFilter !== 'all') {
    filters.candidateState = stateFilter;
  } else {
    filters.candidateState = {
      $ne: 'archived',
    };
  }

  if (body.region) {
    filters.region = body.region;
  }

  if (body.sector) {
    filters.sector = body.sector;
  }

  if (body.classDocumentId) {
    andFilters.push({
      enrollments: {
        class: {
          documentId: body.classDocumentId,
        },
      },
    });
  }

  const readiness = candidateReadinessFilter(body.readiness);

  if (readiness) {
    andFilters.push(readiness);
  }

  const search = includeSearch ? candidateSearchFilter(body.search) : null;

  if (search) {
    andFilters.push(search);
  }

  if (!permissions.canViewAllCandidates) {
    andFilters.push(salesScopeFilter(session));
  }

  return andFilters.length ? { ...filters, $and: andFilters } : filters;
};

const candidateListSort = (sortBy: CandidateListInput['sortBy'], sortDirection: CandidateListInput['sortDirection']) => {
  const direction = sortDirection;

  if (sortBy === 'displayName') {
    return [`lastName:${direction}`, `firstName:${direction}`, `email:${direction}`];
  }

  if (['candidateState', 'email', 'region', 'sector', 'updatedAt'].includes(sortBy)) {
    return [`${sortBy}:${direction}`];
  }

  return [`updatedAt:${direction}`, `lastName:${direction}`, `firstName:${direction}`];
};

const assertCandidateAccess = async (
  strapi: StrapiService,
  session: AdminSession,
  candidateDocumentId: string
) => {
  const permissions = candidatePermissions(session);

  if (permissions.canViewAllCandidates) {
    return;
  }

  const scopedCandidateIds = await findSalesScopedCandidateIds(strapi, session);

  if (!scopedCandidateIds.has(candidateDocumentId)) {
    throw new ForbiddenError('This candidate is not in your employer funnel.');
  }
};

const readinessState = (profile?: DocumentRecord | null) => {
  const profileComplete = profile?.profileState === 'completed';
  const availabilityExpiresAt = stringValue(profile?.availabilityExpiresAt);
  const availabilityConfirmedAt = stringValue(profile?.availabilityConfirmedAt);
  const availabilityFresh =
    Boolean(availabilityConfirmedAt) &&
    Boolean(availabilityExpiresAt) &&
    new Date(availabilityExpiresAt!).getTime() > Date.now();

  if (profileComplete && availabilityFresh) {
    return 'ready';
  }

  if (profileComplete) {
    return 'availability_expired';
  }

  return 'incomplete';
};

const profilePayload = (profile?: DocumentRecord | null) => {
  if (!profile) {
    return null;
  }

  return {
    availabilityConfirmedAt: profile.availabilityConfirmedAt || null,
    availabilityExpiresAt: profile.availabilityExpiresAt || null,
    availabilityNote: profile.availabilityNote || null,
    completedAt: profile.completedAt || null,
    documentId: getDocumentId(profile),
    education: profile.education || [],
    experience: profile.experience || [],
    interviewFormatPreference: profile.interviewFormatPreference || null,
    linkedinUrl: profile.linkedinUrl || null,
    location: profile.location || null,
    portfolioUrl: profile.portfolioUrl || null,
    preferredWorkStyle: profile.preferredWorkStyle || null,
    profileState: profile.profileState || 'draft',
    projects: profile.projects || [],
    recruitmentPlatformVisibility: profile.recruitmentPlatformVisibility || 'not_set',
    readinessOverviewAcknowledgedAt: profile.readinessOverviewAcknowledgedAt || null,
    readinessState: readinessState(profile),
    skills: profile.skills || {
      certifications: [],
      languages: [],
      strengths: [],
      tools: [],
    },
    summary: profile.summary || null,
    targetRoleTitle: profile.targetRoleTitle || null,
    targetRoleType: profile.targetRoleType || null,
    targetSector: profile.targetSector || null,
    targetSectorLabel: profile.targetSectorLabel || null,
    unavailableDates: profile.unavailableDates || [],
    updatedAt: profile.updatedAt || null,
  };
};

const candidatePayload = (
  candidate: DocumentRecord,
  permissions: ReturnType<typeof candidatePermissions>,
  profile?: DocumentRecord | null,
  context?: {
    classLabel?: string | null;
    openSupportCount?: number;
    strikeCount?: number;
  }
) => ({
  accountCreatedAt: candidate.accountCreatedAt || null,
  accountOnboardingCompletedAt: candidate.accountOnboardingCompletedAt || null,
  accountRestrictionStatus: candidate.accountRestrictionStatus || null,
  candidateState: candidate.candidateState || null,
  classLabel: context?.classLabel || null,
  dateOfBirth: permissions.canViewSensitiveFields ? candidate.dateOfBirth || null : null,
  displayName: displayName(candidate),
  documentId: getDocumentId(candidate),
  email: permissions.canViewSensitiveFields ? candidate.email || null : null,
  firstName: candidate.firstName || null,
  gender: permissions.canViewSensitiveFields ? candidate.gender || null : null,
  genderSelfDescription: permissions.canViewSensitiveFields ? candidate.genderSelfDescription || null : null,
  lastName: candidate.lastName || null,
  openSupportCount: context?.openSupportCount || 0,
  phone: permissions.canViewSensitiveFields ? candidate.phone || null : null,
  readinessState: readinessState(profile),
  recruitmentPlatformVisibility: candidate.recruitmentPlatformVisibility || null,
  region: candidate.region || null,
  sector: candidate.sector || null,
  strikeCount: context?.strikeCount || 0,
  updatedAt: candidate.updatedAt || null,
});

const enrollmentPayload = (enrollment: DocumentRecord) => {
  const classRecord = enrollment.class as DocumentRecord | undefined;

  return {
    class: classRecord
      ? {
          area: (classRecord.classArea as DocumentRecord | undefined)?.name || classRecord.region || null,
          documentId: getDocumentId(classRecord),
          sector: (classRecord.workSector as DocumentRecord | undefined)?.name || classRecord.sector || null,
          title: classRecord.displayTitle || classRecord.name || null,
        }
      : null,
    completedAt: enrollment.completedAt || null,
    completionStatus: enrollment.completionStatus || null,
    documentId: getDocumentId(enrollment),
    enrollmentState: enrollment.enrollmentState || null,
    interviewGuaranteeDeadline: enrollment.interviewGuaranteeDeadline || null,
    passStatus: enrollment.passStatus || null,
    paymentStatus: enrollment.paymentStatus || null,
    qualifyingInterviewsDeliveredCount: enrollment.qualifyingInterviewsDeliveredCount || 0,
    refundEligibilityState: enrollment.refundEligibilityState || null,
  };
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

  return labels[String(value || '')] || null;
};

const interviewPayload = (
  interview: DocumentRecord,
  progressionRequest?: DocumentRecord | null,
  feedbackConcernCase?: DocumentRecord | null
) => {
  const candidateDocumentId = getDocumentId(interview.candidate as DocumentRecord | undefined);
  const feedbackConcernCaseDocumentId = getDocumentId(feedbackConcernCase);

  return {
    actionPath: `/interviews?search=${encodeURIComponent(displayName(interview.candidate as DocumentRecord | undefined) || '')}`,
    completedAt: interview.completedAt || null,
    documentId: getDocumentId(interview),
    employer: (interview.employer as DocumentRecord | undefined)?.companyName || null,
    employerContact: displayName(interview.employerContact as DocumentRecord | undefined),
    feedbackReviewPath:
      candidateDocumentId && feedbackConcernCaseDocumentId
        ? `/candidates/${encodeURIComponent(candidateDocumentId)}/feedback/${encodeURIComponent(feedbackConcernCaseDocumentId)}`
        : null,
    interviewState: interview.interviewState || null,
    locationType: interview.locationType || null,
    progressionRequest: progressionRequest
      ? {
          candidateResponse: progressionRequest.candidateResponse || null,
          documentId: getDocumentId(progressionRequest),
          followUp: {
            candidate: {
              completedAt: progressionRequest.candidateFollowUpCompletedAt || null,
              outcome: progressionRequest.candidateFollowUpOutcome || null,
              outcomeLabel: progressionRequest.candidateFollowUpOutcome
                ? humanize(String(progressionRequest.candidateFollowUpOutcome))
                : null,
              state: progressionRequest.candidateFollowUpState || progressionRequest.followUpState || 'not_due',
            },
            employer: {
              completedAt: progressionRequest.employerFollowUpCompletedAt || null,
              outcome: progressionRequest.employerFollowUpOutcome || null,
              outcomeLabel: progressionRequest.employerFollowUpOutcome
                ? humanize(String(progressionRequest.employerFollowUpOutcome))
                : null,
              state: progressionRequest.employerFollowUpState || progressionRequest.followUpState || 'not_due',
            },
          },
          progressionState: progressionRequest.progressionState || null,
          progressionType: progressionRequest.progressionType || null,
          progressionTypeLabel: progressionTypeLabel(progressionRequest.progressionType),
          requestedAt: progressionRequest.requestedDetailsAt || progressionRequest.createdAt || null,
          responseDeadline: progressionRequest.candidateResponseDeadline || null,
        }
      : null,
    scheduledEndTime: interview.scheduledEndTime || null,
    scheduledStartTime: interview.scheduledStartTime || null,
  };
};

const supportCasePayload = (supportCase: DocumentRecord) => ({
  caseState: supportCase.caseState || null,
  caseType: supportCase.caseType || null,
  detailPath: getDocumentId(supportCase) ? `/support/${getDocumentId(supportCase)}` : null,
  documentId: getDocumentId(supportCase),
  lastMessageAt: supportCase.lastMessageAt || null,
  owner: {
    displayName: supportCase.ownerStaffDisplayName || null,
    email: supportCase.ownerStaffEmail || null,
    roleKey: supportCase.ownerRoleKey || null,
  },
  priority: supportCase.priority || null,
  title: supportCase.title || null,
  updatedAt: supportCase.updatedAt || null,
});

const strikePayload = (strike: DocumentRecord) => ({
  appliedAt: strike.appliedAt || null,
  appealedAt: strike.appealedAt || null,
  documentId: getDocumentId(strike),
  interviewDocumentId: getDocumentId(strike.interview as DocumentRecord | undefined),
  reason: strike.reason || null,
  reasonLabel: humanize(stringValue(strike.reason)),
  reviewDecision: strike.reviewDecision || null,
  reviewedAt: strike.reviewedAt || null,
  strikeNumber: strike.strikeNumber || null,
  strikeState: strike.strikeState || null,
  strikeStateLabel: humanize(stringValue(strike.strikeState)),
});

const auditPayload = (event: DocumentRecord) => ({
  actorDisplayName: event.actorDisplayName || null,
  actorEmail: event.actorEmail || null,
  actorType: event.actorType || null,
  eventCategory: event.eventCategory || null,
  eventType: event.eventType || null,
  metadata: event.metadata || null,
  newState: event.newState || null,
  occurredAt: event.occurredAt || null,
  previousState: event.previousState || null,
  severity: event.severity || null,
  source: event.source || null,
});

const candidateListClassLabel = (enrollments: DocumentRecord[]) => {
  const enrollment = enrollments[0];
  const classRecord = enrollment?.class as DocumentRecord | undefined;

  return classRecord ? String(classRecord.displayTitle || classRecord.name || '').trim() || null : null;
};

const requestNotificationServiceEmail = async ({
  correlationId,
  subject,
  template,
  text,
  to,
  type,
}: {
  correlationId?: string;
  subject: string;
  template?: {
    key: string;
    variables?: Record<string, unknown>;
  };
  text: string;
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
        priority: 'transactional',
        source: 'core-api',
        subject,
        template,
        text,
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
  } finally {
    clearTimeout(timeout);
  }
};

const queueCandidateAmendmentNote = async ({
  candidate,
  note,
  requestContext,
  strapi,
}: {
  candidate: DocumentRecord;
  note: string;
  requestContext: RequestContext;
  strapi: StrapiService;
}) => {
  const candidateEmail = stringValue(candidate.email);
  const candidateDocumentId = getDocumentId(candidate);

  if (!candidateEmail || !candidateDocumentId) {
    return {
      queued: false,
    };
  }

  const subject = 'Your HireFlip profile has been updated';
  const text = [
    `Hi ${candidate.firstName || 'there'},`,
    '',
    'A member of the HireFlip team has made an update to your profile.',
    '',
    note,
    '',
    'You can review your dashboard at any time.',
  ].join('\n');
  const notificationResult = await requestNotificationServiceEmail({
    correlationId: requestContext.requestId,
    subject,
    template: {
      key: 'candidate_profile_amendment_note',
      variables: {
        candidateFirstName: candidate.firstName || 'there',
        dashboardUrl: trimTrailingSlash(process.env.CANDIDATE_DASHBOARD_BASE_URL || 'http://localhost:3001'),
        note,
      },
    },
    text,
    to: candidateEmail,
    type: 'candidate_profile_amendment_note',
  });
  const jobId = notificationResult?.data?.jobId;

  await documents(strapi, 'api::notification-event.notification-event').create({
    data: {
      candidate: relationConnect(candidate),
      channel: 'email',
      deliveryState: notificationResult?.data ? 'queued' : 'failed',
      errorMessage: notificationResult?.data ? null : 'Notification service did not queue the profile amendment note.',
      eventType: 'candidate_profile_amendment_note',
      metadata: {
        notificationServiceJobId: typeof jobId === 'undefined' ? null : String(jobId),
        requestId: requestContext.requestId,
      },
      priority: 'normal',
      recipientEmail: candidateEmail,
      recipientId: candidateDocumentId,
      recipientType: 'candidate',
      relatedId: candidateDocumentId,
      relatedType: 'candidate',
      templateKey: 'candidate_profile_amendment_note',
    },
  });

  return {
    queued: Boolean(notificationResult?.data),
  };
};

const accountActionStatusLabel = (action: 'archive' | 'blacklist' | 'reactivate' | 'suspend') => ({
  archive: 'Archived',
  blacklist: 'Suspended',
  reactivate: 'Reactivated',
  suspend: 'Suspended',
})[action];

const candidateDashboardUrl = () =>
  trimTrailingSlash(process.env.CANDIDATE_DASHBOARD_BASE_URL || 'http://localhost:3001');

const queueCandidateAccountStatusNotification = async ({
  action,
  candidate,
  candidateNote,
  requestContext,
  strapi,
}: {
  action: 'archive' | 'blacklist' | 'reactivate' | 'suspend';
  candidate: DocumentRecord;
  candidateNote?: string;
  requestContext: RequestContext;
  strapi: StrapiService;
}) => {
  const candidateEmail = stringValue(candidate.email);
  const candidateDocumentId = getDocumentId(candidate);

  if (!candidateEmail || !candidateDocumentId) {
    return {
      queued: false,
    };
  }

  const statusLabel = accountActionStatusLabel(action);
  const restricted = action !== 'reactivate';
  const subject = restricted
    ? 'Your HireFlip account access has changed'
    : 'Your HireFlip account has been reactivated';
  const bodyLines = restricted
    ? [
        action === 'archive'
          ? 'Your HireFlip dashboard access has been archived.'
          : 'Your HireFlip account has been suspended.',
        'You can still sign in to view the account status page.',
        'If you believe this decision is incorrect, you can submit an appeal from your dashboard.',
      ]
    : [
        'Your HireFlip account access has been restored.',
        'You can sign in to your dashboard again and continue from the next available path shown there.',
      ];
  const text = [
    `Hi ${candidate.firstName || 'there'},`,
    '',
    ...bodyLines,
    ...(candidateNote ? ['', candidateNote] : []),
    '',
    `Open your dashboard: ${candidateDashboardUrl()}`,
    '',
    'HireFlip',
  ].join('\n');
  const notificationResult = await requestNotificationServiceEmail({
    correlationId: requestContext.requestId,
    subject,
    template: {
      key: 'candidate_account_status_updated',
      variables: {
        candidateFirstName: candidate.firstName || 'there',
        dashboardUrl: candidateDashboardUrl(),
        message: candidateNote || '',
        statusLabel,
        subject,
      },
    },
    text,
    to: candidateEmail,
    type: 'candidate_account_status_updated',
  }).catch(() => undefined);
  const jobId = notificationResult?.data?.jobId;

  await documents(strapi, 'api::notification-event.notification-event').create({
    data: {
      candidate: relationConnect(candidate),
      channel: 'email',
      deliveryState: notificationResult?.data ? 'queued' : 'failed',
      errorMessage: notificationResult?.data ? null : 'Notification service did not queue the account status update.',
      eventType: 'candidate_account_status_updated',
      metadata: {
        action,
        notificationServiceJobId: typeof jobId === 'undefined' ? null : String(jobId),
        requestId: requestContext.requestId,
      },
      priority: 'high',
      recipientEmail: candidateEmail,
      recipientId: candidateDocumentId,
      recipientType: 'candidate',
      relatedId: candidateDocumentId,
      relatedType: 'candidate',
      templateKey: 'candidate_account_status_updated',
    },
  });

  return {
    queued: Boolean(notificationResult?.data),
  };
};

const formatInterviewTime = (interview: DocumentRecord) => {
  const value = stringValue(interview.scheduledStartTime);

  if (!value) {
    return 'the scheduled interview';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 'the scheduled interview';
  }

  return date.toLocaleString('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/London',
  });
};

const queueEmployerCandidateRestrictionCancellation = async ({
  interview,
  requestContext,
  strapi,
}: {
  interview: DocumentRecord;
  requestContext: RequestContext;
  strapi: StrapiService;
}) => {
  const employerContact = interview.employerContact as DocumentRecord | undefined;
  const employer = interview.employer as DocumentRecord | undefined;
  const recipientEmail = stringValue(employerContact?.email);
  const interviewDocumentId = getDocumentId(interview);

  if (!recipientEmail || !interviewDocumentId) {
    return {
      queued: false,
    };
  }

  const subject = 'HireFlip has cancelled an interview';
  const message = 'Unfortunately, HireFlip has had to cancel this interview on behalf of the candidate.';
  const dashboardUrl = trimTrailingSlash(process.env.EMPLOYER_DASHBOARD_PUBLIC_URL || 'http://localhost:3004');
  const notificationResult = await requestNotificationServiceEmail({
    correlationId: requestContext.requestId,
    subject,
    template: {
      key: 'employer_interview_cancelled_by_hireflip',
      variables: {
        companyName: employer?.companyName || 'your organisation',
        contactFirstName: employerContact?.firstName || 'there',
        dashboardUrl,
        interviewLabel: formatInterviewTime(interview),
        message,
        subject,
      },
    },
    text: [
      `Hi ${employerContact?.firstName || 'there'},`,
      '',
      message,
      '',
      `Interview: ${formatInterviewTime(interview)}`,
      '',
      `Open your dashboard: ${dashboardUrl}`,
      '',
      'HireFlip',
    ].join('\n'),
    to: recipientEmail,
    type: 'employer_interview_cancelled_by_hireflip',
  }).catch(() => undefined);
  const jobId = notificationResult?.data?.jobId;

  await documents(strapi, 'api::notification-event.notification-event').create({
    data: {
      channel: 'email',
      deliveryState: notificationResult?.data ? 'queued' : 'failed',
      employer: relationConnect(employer),
      errorMessage: notificationResult?.data ? null : 'Notification service did not queue the employer cancellation email.',
      eventType: 'employer_interview_cancelled_by_hireflip',
      interview: relationConnect(interview),
      metadata: {
        notificationServiceJobId: typeof jobId === 'undefined' ? null : String(jobId),
        requestId: requestContext.requestId,
      },
      priority: 'high',
      recipientEmail,
      recipientId: getDocumentId(employerContact),
      recipientType: 'employer_contact',
      relatedId: interviewDocumentId,
      relatedType: 'interview',
      templateKey: 'employer_interview_cancelled_by_hireflip',
    },
  });

  return {
    queued: Boolean(notificationResult?.data),
  };
};

const openEnrollmentStates = new Set([
  'interest_registered',
  'enrollment_open',
  'place_reserved',
  'waiting_list',
  'enrolled',
  'in_class',
  'interview_phase',
  'completed',
  'failed',
]);
const paidEnrollmentStates = new Set(['enrolled', 'in_class', 'interview_phase', 'completed', 'failed']);
const openInterviewRequestStates = new Set([
  'pending_profile',
  'pending_availability',
  'pending_capacity',
  'capacity_claimed',
  'employer_notified',
  'slot_options_submitted',
  'candidate_reviewing',
  'candidate_selected',
  'manual_review',
]);
const openCapacityClaimStates = new Set(['held', 'notified', 'accepted']);
const openSlotOfferStates = new Set(['draft', 'submitted', 'sent', 'candidate_selected', 'replacement_required']);
const openInterviewStates = new Set(['offered', 'candidate_selected', 'awaiting_employer_details', 'confirmed']);
const reusableSlotStates = new Set(['offered', 'held', 'booked']);

const restrictionWorkflowMetadata = ({
  action,
  existingMetadata,
  reasonNote,
  timestamp,
}: {
  action: string;
  existingMetadata: unknown;
  reasonNote: string;
  timestamp: string;
}) => ({
  ...objectValue(existingMetadata),
  accountRestriction: {
    action,
    appliedAt: timestamp,
    reasonNote,
  },
});

const applyCandidateRestrictionWorkflowEffects = async ({
  action,
  candidate,
  reasonNote,
  requestContext,
  strapi,
  timestamp,
}: {
  action: 'archive' | 'blacklist' | 'suspend';
  candidate: DocumentRecord;
  reasonNote: string;
  requestContext: RequestContext;
  strapi: StrapiService;
  timestamp: string;
}) => {
  const candidateDocumentId = getDocumentId(candidate);

  if (!candidateDocumentId) {
    return {
      cancelledInterviews: 0,
      releasedClaims: 0,
      releasedReservations: 0,
      updatedEnrollments: 0,
      updatedRequests: 0,
      updatedSlotOffers: 0,
    };
  }

  const [reservations, enrollments, interviewRequests, slotOffers, interviews] = await Promise.all([
    findAllDocuments(strapi, 'api::reservation.reservation', {
      filters: {
        candidate: {
          documentId: candidateDocumentId,
        },
        reservationState: 'active',
      },
      populate: ['candidate', 'class', 'enrollment'],
    }),
    findAllDocuments(strapi, 'api::enrollment.enrollment', {
      filters: {
        candidate: {
          documentId: candidateDocumentId,
        },
      },
      populate: ['candidate', 'class'],
    }),
    findAllDocuments(strapi, 'api::interview-request.interview-request', {
      filters: {
        candidate: {
          documentId: candidateDocumentId,
        },
      },
      populate: ['candidate', 'enrollment', 'class', 'claims'],
    }),
    findAllDocuments(strapi, 'api::interview-slot-offer.interview-slot-offer', {
      filters: {
        candidate: {
          documentId: candidateDocumentId,
        },
      },
      populate: ['candidate', 'enrollment', 'employer', 'employerContact', 'interviewRequest', 'capacityClaim', 'slots', 'selectedSlot'],
    }),
    findAllDocuments(strapi, 'api::interview.interview', {
      filters: {
        candidate: {
          documentId: candidateDocumentId,
        },
      },
      populate: ['candidate', 'employer', 'employerContact', 'enrollment', 'interviewSlot'],
    }),
  ]);

  let releasedReservations = 0;
  let updatedEnrollments = 0;
  let updatedRequests = 0;
  let releasedClaims = 0;
  let updatedSlotOffers = 0;
  let cancelledInterviews = 0;

  await Promise.all(
    reservations.map(async (reservation) => {
      const reservationDocumentId = getDocumentId(reservation);

      if (!reservationDocumentId) {
        return;
      }

      await documents(strapi, 'api::reservation.reservation').update({
        documentId: reservationDocumentId,
        data: {
          cancelledAt: timestamp,
          metadata: restrictionWorkflowMetadata({
            action,
            existingMetadata: reservation.metadata,
            reasonNote,
            timestamp,
          }),
          reservationState: 'released',
        },
      });
      releasedReservations += 1;
    })
  );

  await Promise.all(
    enrollments.map(async (enrollment) => {
      const enrollmentDocumentId = getDocumentId(enrollment);
      const state = String(enrollment.enrollmentState || '');

      if (!enrollmentDocumentId || !openEnrollmentStates.has(state)) {
        return;
      }

      const paidOrActive = paidEnrollmentStates.has(state) || enrollment.paymentStatus === 'paid';
      const removesAccessWithoutRefund = action !== 'archive' && paidOrActive;

      await documents(strapi, 'api::enrollment.enrollment').update({
        documentId: enrollmentDocumentId,
        data: {
          enrollmentState: removesAccessWithoutRefund ? 'removed_no_refund' : 'withdrawn',
          ...(removesAccessWithoutRefund ? { refundEligibilityState: 'forfeited' } : {}),
          metadata: {
            ...restrictionWorkflowMetadata({
              action,
              existingMetadata: enrollment.metadata,
              reasonNote,
              timestamp,
            }),
            courseCompletionDeadlineBeforeRestriction: enrollment.courseCompletionDeadline || null,
            courseDeadlinePausedAt: timestamp,
            previousEnrollmentState: state,
          },
        },
      });
      updatedEnrollments += 1;
    })
  );

  for (const request of interviewRequests) {
    const requestDocumentId = getDocumentId(request);
    const requestState = String(request.requestState || '');

    if (!requestDocumentId || !openInterviewRequestStates.has(requestState)) {
      continue;
    }

    const claims = await findAllDocuments(strapi, 'api::employer-capacity-claim.employer-capacity-claim', {
      filters: {
        interviewRequest: {
          documentId: requestDocumentId,
        },
      },
      populate: ['interviewRequest', 'employer', 'employerContact'],
    });

    await Promise.all(
      claims.map(async (claim) => {
        const claimDocumentId = getDocumentId(claim);

        if (!claimDocumentId || !openCapacityClaimStates.has(String(claim.claimState || ''))) {
          return;
        }

        await documents(strapi, 'api::employer-capacity-claim.employer-capacity-claim').update({
          documentId: claimDocumentId,
          data: {
            claimState: 'released',
            releaseReason: 'request_cancelled',
            releaseNote: 'Candidate account was restricted by HireFlip.',
            releasedAt: timestamp,
            metadata: restrictionWorkflowMetadata({
              action,
              existingMetadata: claim.metadata,
              reasonNote,
              timestamp,
            }),
          },
        });
        releasedClaims += 1;
      })
    );

    await documents(strapi, 'api::interview-request.interview-request').update({
      documentId: requestDocumentId,
      data: {
        candidateVisibleState: 'blocked',
        claimedInterviewCount: 0,
        metadata: {
          ...restrictionWorkflowMetadata({
            action,
            existingMetadata: request.metadata,
            reasonNote,
            timestamp,
          }),
          previousRequestState: requestState,
        },
        requestState: 'cancelled',
      },
    });
    updatedRequests += 1;
  }

  await Promise.all(
    slotOffers.map(async (offer) => {
      const offerDocumentId = getDocumentId(offer);

      if (!offerDocumentId || !openSlotOfferStates.has(String(offer.offerState || ''))) {
        return;
      }

      const slots = Array.isArray(offer.slots) ? (offer.slots as DocumentRecord[]) : [];

      await Promise.all(
        slots.map(async (slot) => {
          const slotDocumentId = getDocumentId(slot);

          if (!slotDocumentId || !reusableSlotStates.has(String(slot.slotState || ''))) {
            return;
          }

          await documents(strapi, 'api::interview-slot.interview-slot').update({
            documentId: slotDocumentId,
            data: {
              metadata: restrictionWorkflowMetadata({
                action,
                existingMetadata: slot.metadata,
                reasonNote,
                timestamp,
              }),
              slotState: 'available',
            },
          });
        })
      );

      await documents(strapi, 'api::interview-slot-offer.interview-slot-offer').update({
        documentId: offerDocumentId,
        data: {
          internalNote: 'Cancelled because the candidate account was restricted by HireFlip.',
          metadata: restrictionWorkflowMetadata({
            action,
            existingMetadata: offer.metadata,
            reasonNote,
            timestamp,
          }),
          offerState: 'cancelled',
        },
      });
      updatedSlotOffers += 1;
    })
  );

  await Promise.all(
    interviews.map(async (interview) => {
      const interviewDocumentId = getDocumentId(interview);

      if (!interviewDocumentId || !openInterviewStates.has(String(interview.interviewState || ''))) {
        return;
      }

      const interviewSlot = interview.interviewSlot as DocumentRecord | undefined;
      const interviewSlotDocumentId = getDocumentId(interviewSlot);

      if (interviewSlotDocumentId && reusableSlotStates.has(String(interviewSlot?.slotState || ''))) {
        await documents(strapi, 'api::interview-slot.interview-slot').update({
          documentId: interviewSlotDocumentId,
          data: {
            metadata: restrictionWorkflowMetadata({
              action,
              existingMetadata: interviewSlot?.metadata,
              reasonNote,
              timestamp,
            }),
            slotState: 'available',
          },
        });
      }

      const employerNotification = await queueEmployerCandidateRestrictionCancellation({
        interview,
        requestContext,
        strapi,
      });

      await documents(strapi, 'api::interview.interview').update({
        documentId: interviewDocumentId,
        data: {
          employerDetailsReleaseNotificationSentAt: employerNotification.queued ? timestamp : null,
          employerDetailsReleasedAt: timestamp,
          employerDetailsReleaseReason: 'other',
          interviewState: 'cancelled',
          metadata: {
            ...restrictionWorkflowMetadata({
              action,
              existingMetadata: interview.metadata,
              reasonNote,
              timestamp,
            }),
            candidateRestrictionCancelledAt: timestamp,
            candidateRestrictionEmployerNotificationQueued: employerNotification.queued,
            candidateSafeCancellationReason:
              'Unfortunately, HireFlip has had to cancel this interview on behalf of the candidate.',
            previousInterviewState: interview.interviewState || null,
          },
        },
      });
      cancelledInterviews += 1;
    })
  );

  return {
    cancelledInterviews,
    releasedClaims,
    releasedReservations,
    updatedEnrollments,
    updatedRequests,
    updatedSlotOffers,
  };
};

const recordAdminCandidateAudit = (
  strapi: StrapiService,
  session: AdminSession,
  candidate: DocumentRecord,
  eventType: string,
  requestContext: RequestContext,
  payload: {
    metadata?: Record<string, unknown>;
    newState?: unknown;
    previousState?: unknown;
    severity?: 'info' | 'warning' | 'error' | 'critical';
  } = {}
) =>
  auditEvents(strapi).record({
    actorDisplayName: session.user.displayName,
    actorEmail: session.user.email,
    actorId: session.user.id,
    actorType: 'admin',
    eventCategory: eventType.includes('privacy') ? 'privacy' : 'admin',
    eventType,
    ipAddress: requestContext.ipAddress,
    metadata: payload.metadata,
    newState: payload.newState,
    occurredAt: new Date().toISOString(),
    previousState: payload.previousState,
    requestId: requestContext.requestId,
    severity: payload.severity || 'info',
    source: 'admin_dashboard',
    subjectDisplayName: displayName(candidate),
    subjectId: getDocumentId(candidate),
    subjectType: 'candidate',
    userAgent: requestContext.userAgent,
  });

const buildCandidateDetail = async (
  strapi: StrapiService,
  session: AdminSession,
  candidate: DocumentRecord
) => {
  const candidateDocumentId = getDocumentId(candidate);

  if (!candidateDocumentId) {
    throw new ValidationError('Candidate record is missing a document ID.');
  }

  const [
    profile,
    enrollments,
    requests,
    slotOffers,
    interviews,
    progressionRequests,
    strikes,
    supportCases,
    activityCount,
  ] =
    await Promise.all([
      latestCandidateProfile(strapi, candidateDocumentId),
      candidateEnrollments(strapi, candidateDocumentId),
      candidateInterviewRequests(strapi, candidateDocumentId),
      candidateSlotOffers(strapi, candidateDocumentId),
      candidateInterviews(strapi, candidateDocumentId),
      candidateProgressionRequests(strapi, candidateDocumentId),
      candidateStrikes(strapi, candidateDocumentId),
      candidateSupportCases(strapi, candidateDocumentId),
      candidateAuditCount(strapi, candidate),
    ]);
  const progressionByInterviewId = new Map<string, DocumentRecord>();
  const feedbackConcernCaseByInterviewId = new Map<string, DocumentRecord>();

  progressionRequests.forEach((request) => {
    const interview = request.interview as DocumentRecord | undefined;
    const interviewDocumentId = getDocumentId(interview);

    if (interviewDocumentId && !progressionByInterviewId.has(interviewDocumentId)) {
      progressionByInterviewId.set(interviewDocumentId, request);
    }
  });
  if (hasAnyRole(session, ['admin', 'super_admin', 'support'])) {
    supportCases.forEach((supportCase) => {
      const metadata = objectValue(supportCase.metadata);
      const interviewDocumentId = stringValue(metadata.interviewDocumentId);

      if (
        metadata.kind === 'ai_feedback_report_concern' &&
        interviewDocumentId &&
        !feedbackConcernCaseByInterviewId.has(interviewDocumentId)
      ) {
        feedbackConcernCaseByInterviewId.set(interviewDocumentId, supportCase);
      }
    });
  }
  const permissions = candidatePermissions(session);
  const openSupportCount = supportCases.filter((supportCase) =>
    ['awaiting_candidate', 'awaiting_staff', 'in_progress', 'open'].includes(String(supportCase.caseState || ''))
  ).length;
  const activeStrikeCount = strikes.filter((strike) =>
    ['active', 'appealed', 'upheld'].includes(String(strike.strikeState || ''))
  ).length;

  return {
    activityCount,
    auditEvents: [],
    candidate: candidatePayload(candidate, permissions, profile, {
      classLabel: candidateListClassLabel(enrollments),
      openSupportCount,
      strikeCount: activeStrikeCount,
    }),
    enrollments: enrollments.map(enrollmentPayload),
    generatedAt: new Date().toISOString(),
    interviewRequests: requests.map((request) => ({
      claimedInterviewCount: request.claimedInterviewCount || 0,
      documentId: getDocumentId(request),
      fulfilledInterviewCount: request.fulfilledInterviewCount || 0,
      requestedInterviewCount: request.requestedInterviewCount || 0,
      requestState: request.requestState || null,
      visibleState: request.candidateVisibleState || null,
    })),
    interviews: interviews.map((interview) =>
      interviewPayload(
        interview,
        progressionByInterviewId.get(getDocumentId(interview) || ''),
        feedbackConcernCaseByInterviewId.get(getDocumentId(interview) || '')
      )
    ),
    permissions,
    profile: profilePayload(profile),
    slotOffers: slotOffers.map((offer) => ({
      candidateRespondedAt: offer.candidateRespondedAt || null,
      candidateResponseDeadline: offer.candidateResponseDeadline || null,
      documentId: getDocumentId(offer),
      employer: (offer.employer as DocumentRecord | undefined)?.companyName || null,
      offerState: offer.offerState || null,
      requiredSlotCount: offer.requiredSlotCount || null,
    })),
    strikes: strikes.map(strikePayload),
    supportCases: supportCases.map(supportCasePayload),
    user: session.user,
  };
};

export default ({ strapi }: { strapi: StrapiService }) => ({
  async listCandidates(input: unknown, requestContext: RequestContext = {}) {
    const body = validateListCandidates(input);
    const session = await assertCandidateSession(strapi, body.sessionToken, requestContext);
    const permissions = candidatePermissions(session);
    const candidateDocuments = documents(strapi, 'api::candidate.candidate');
    const filters = candidateListFilters({ body, includeSearch: true, session });
    const baseFilters = candidateListFilters({ body, includeSearch: false, session });
    const [total, visibleScopedCount] = await Promise.all([
      candidateDocuments.count({ filters }),
      candidateDocuments.count({ filters: baseFilters }),
    ]);
    const pageCount = Math.max(1, Math.ceil(total / body.pageSize));
    const page = Math.min(body.page, pageCount);
    const candidates = await candidateDocuments.findMany({
      filters,
      limit: body.pageSize,
      populate: ['profileImage'],
      sort: candidateListSort(body.sortBy, body.sortDirection),
      start: (page - 1) * body.pageSize,
    });
    const rows = [];

    for (const candidate of candidates) {
      const candidateDocumentId = getDocumentId(candidate);

      if (!candidateDocumentId) {
        continue;
      }

      const [profile, enrollments, strikes, supportCases] = await Promise.all([
        latestCandidateProfile(strapi, candidateDocumentId),
        candidateEnrollments(strapi, candidateDocumentId),
        candidateStrikes(strapi, candidateDocumentId),
        candidateSupportCases(strapi, candidateDocumentId),
      ]);

      const row = candidatePayload(candidate, permissions, profile, {
        classLabel: candidateListClassLabel(enrollments),
        openSupportCount: supportCases.filter((supportCase) =>
          ['awaiting_candidate', 'awaiting_staff', 'in_progress', 'open'].includes(String(supportCase.caseState || ''))
        ).length,
        strikeCount: strikes.filter((strike) =>
          ['active', 'appealed', 'upheld'].includes(String(strike.strikeState || ''))
        ).length,
      });

      rows.push(row);
    }

    return {
      candidates: rows,
      counts: {
        filtered: total,
        total: visibleScopedCount,
      },
      generatedAt: new Date().toISOString(),
      pagination: {
        page,
        pageCount,
        pageSize: body.pageSize,
        total,
      },
      permissions,
      user: session.user,
    };
  },

  async getCandidate(input: unknown, requestContext: RequestContext = {}) {
    const body = validateCandidateDetail(input);
    const session = await assertCandidateSession(strapi, body.sessionToken, requestContext);
    const candidate = await findCandidateByDocumentId(strapi, body.candidateDocumentId);

    if (!candidate) {
      throw new ValidationError('Candidate could not be found.');
    }

    await assertCandidateAccess(strapi, session, body.candidateDocumentId);

    return buildCandidateDetail(strapi, session, candidate);
  },

  async accountAction(input: unknown, requestContext: RequestContext = {}) {
    const body = validateCandidateAccountAction(input);
    const session = await assertCandidateSession(strapi, body.sessionToken, requestContext);
    const permissions = candidatePermissions(session);
    const candidate = await findCandidateByDocumentId(strapi, body.candidateDocumentId);

    if (!candidate) {
      throw new ValidationError('Candidate could not be found.');
    }

    await assertCandidateAccess(strapi, session, body.candidateDocumentId);

    if (!permissions.canManageAccount) {
      throw new ForbiddenError('Admin or Super Admin access is required to manage candidate accounts.');
    }

    const previousState = {
      accountRestrictionStatus: candidate.accountRestrictionStatus || 'active',
      candidateState: candidate.candidateState || null,
    };
    const previouslyBlacklisted =
      candidate.accountRestrictionStatus === 'blacklisted' || candidate.candidateState === 'blacklisted';

    if (body.action === 'reactivate' && previouslyBlacklisted && !permissions.canReactivateBlacklisted) {
      throw new ForbiddenError('Only Super Admin can reactivate a blacklisted candidate account.');
    }

    const now = new Date().toISOString();
    const actionStateMap = {
      archive: {
        accountRestrictionStatus: 'suspended',
        candidateState: 'archived',
        eventType: 'admin.candidate_account_archived',
      },
      blacklist: {
        accountRestrictionStatus: 'blacklisted',
        candidateState: 'blacklisted',
        eventType: 'admin.candidate_account_blacklisted',
      },
      reactivate: {
        accountRestrictionStatus: 'active',
        candidateState:
          ['archived', 'blacklisted', 'suspended'].includes(String(candidate.candidateState || ''))
            ? 'account_created'
            : candidate.candidateState || 'account_created',
        eventType: 'admin.candidate_account_reactivated',
      },
      suspend: {
        accountRestrictionStatus: 'suspended',
        candidateState: 'suspended',
        eventType: 'admin.candidate_account_suspended',
      },
    }[body.action];

    if (!actionStateMap) {
      throw new ValidationError('Candidate account action is not supported.');
    }

    const authIdentityId = stringValue(candidate.authIdentityId);
    let auth0UserUnblocked = false;

    if (body.action === 'reactivate' && authIdentityId) {
      await getAuth0ManagementClient().unblockUser(authIdentityId);
      auth0UserUnblocked = true;
    }

    const workflowEffects =
      body.action === 'reactivate'
        ? null
        : await applyCandidateRestrictionWorkflowEffects({
            action: body.action,
            candidate,
            reasonNote: body.reasonNote,
            requestContext,
            strapi,
            timestamp: now,
          });

    const notificationResult = await queueCandidateAccountStatusNotification({
      action: body.action,
      candidate,
      candidateNote: body.candidateNote,
      requestContext,
      strapi,
    });

    if (body.action === 'reactivate' && candidate.accountRestrictionAppealStatus === 'submitted') {
      const appealCase = await documents(strapi, 'api::support-case.support-case').findMany({
        filters: {
          caseKey: `candidate-account:${body.candidateDocumentId}:restriction-appeal`,
        },
        limit: 1,
        populate: ['candidate', 'refund', 'payment', 'enrollment'],
      });
      const activeAppealCase = appealCase[0];

      if (activeAppealCase?.documentId && !['closed', 'resolved'].includes(String(activeAppealCase.caseState || ''))) {
        await documents(strapi, 'api::support-case.support-case').update({
          documentId: activeAppealCase.documentId,
          data: {
            caseState: 'resolved',
            metadata: {
              ...objectValue(activeAppealCase.metadata),
              accountRestrictionReactivatedAt: now,
              accountRestrictionReactivatedBy: session.user.email,
            },
            resolvedAt: now,
          },
        });
      }
    }

    const updatedCandidate = await documents(strapi, 'api::candidate.candidate').update({
      documentId: body.candidateDocumentId,
      data: {
        accountRestrictionAppealStatus:
          body.action === 'reactivate' ? 'not_applicable' : 'not_started',
        accountRestrictedAt: body.action === 'reactivate' ? null : now,
        accountRestrictedBy: body.action === 'reactivate' ? null : session.user.email,
        accountRestrictionMessage: body.action === 'reactivate' ? null : body.candidateNote || null,
        accountRestrictionReason: body.action === 'reactivate' ? null : body.action,
        accountRestrictionStatus: actionStateMap.accountRestrictionStatus,
        candidateState: actionStateMap.candidateState,
      },
      populate: ['profileImage'],
    });

    await recordAdminCandidateAudit(
      strapi,
      session,
      updatedCandidate,
      actionStateMap.eventType,
      requestContext,
      {
        metadata: {
          action: body.action,
          auth0UserUnblocked,
          candidateNotificationQueued: notificationResult.queued,
          candidateNoteProvided: Boolean(body.candidateNote),
          reasonNote: body.reasonNote,
          workflowEffects,
        },
        newState: {
          accountRestrictionStatus: updatedCandidate.accountRestrictionStatus || null,
          candidateState: updatedCandidate.candidateState || null,
        },
        previousState,
        severity: body.action === 'reactivate' ? 'info' : 'warning',
      }
    );

    return {
      action: body.action,
      candidate: await buildCandidateDetail(strapi, session, updatedCandidate),
      updated: true,
      user: session.user,
    };
  },

  async updateProfile(input: unknown, requestContext: RequestContext = {}) {
    const body = validateCandidateProfileUpdate(input);
    const session = await assertCandidateSession(strapi, body.sessionToken, requestContext);
    const permissions = candidatePermissions(session);
    const candidate = await findCandidateByDocumentId(strapi, body.candidateDocumentId);

    if (!candidate) {
      throw new ValidationError('Candidate could not be found.');
    }

    await assertCandidateAccess(strapi, session, body.candidateDocumentId);

    if (!permissions.canEditProfile && !permissions.canEditDateOfBirth) {
      throw new ForbiddenError('You cannot edit this candidate profile.');
    }

    if (body.dateOfBirth && !permissions.canEditDateOfBirth) {
      throw new ForbiddenError('Only Super Admin can edit candidate date of birth.');
    }

    const currentProfile = await latestCandidateProfile(strapi, body.candidateDocumentId);
    const previousState = {
      candidate: {
        dateOfBirth: candidate.dateOfBirth || null,
      },
      profile: profilePayload(currentProfile),
    };

    if (body.dateOfBirth) {
      await documents(strapi, 'api::candidate.candidate').update({
        documentId: body.candidateDocumentId,
        data: {
          dateOfBirth: body.dateOfBirth,
        },
      });
    }

    const profileData = {
      ...body.profile,
      metadata: {
        ...(currentProfile && typeof currentProfile.metadata === 'object' ? currentProfile.metadata : {}),
        lastAdminEditReason: body.reasonNote,
        lastAdminEditedAt: new Date().toISOString(),
        lastAdminEditedByEmail: session.user.email,
        lastAdminEditedById: session.user.id,
      },
    };

    if (currentProfile?.documentId) {
      await documents(strapi, 'api::candidate-profile.candidate-profile').update({
        documentId: currentProfile.documentId,
        data: profileData,
      });
    } else {
      await documents(strapi, 'api::candidate-profile.candidate-profile').create({
        data: {
          ...profileData,
          candidate: relationConnect(candidate),
          profileState: 'draft',
          recruitmentPlatformVisibility: candidate.recruitmentPlatformVisibility || 'not_set',
        },
      });
    }

    const notification = body.candidateNote
      ? await queueCandidateAmendmentNote({
          candidate,
          note: body.candidateNote,
          requestContext,
          strapi,
        })
      : { queued: false };

    await recordAdminCandidateAudit(
      strapi,
      session,
      candidate,
      'admin.candidate_profile_updated',
      requestContext,
      {
        metadata: {
          candidateNoteQueued: notification.queued,
          reasonNote: body.reasonNote,
        },
        newState: {
          candidate: {
            dateOfBirth: body.dateOfBirth || candidate.dateOfBirth || null,
          },
          profile: body.profile,
        },
        previousState,
      }
    );

    const updatedCandidate = await findCandidateByDocumentId(strapi, body.candidateDocumentId);

    return {
      candidate: updatedCandidate ? await buildCandidateDetail(strapi, session, updatedCandidate) : null,
      notificationQueued: notification.queued,
      updated: true,
      user: session.user,
    };
  },

  async createSupportCase(input: unknown, requestContext: RequestContext = {}) {
    const body = validateSupportCreate(input);
    const session = await assertCandidateSession(strapi, body.sessionToken, requestContext);
    const permissions = candidatePermissions(session);
    const candidate = await findCandidateByDocumentId(strapi, body.candidateDocumentId);

    if (!candidate) {
      throw new ValidationError('Candidate could not be found.');
    }

    await assertCandidateAccess(strapi, session, body.candidateDocumentId);

    if (!permissions.canCreateSupportCase) {
      throw new ForbiddenError('You cannot create support cases.');
    }

    const now = new Date().toISOString();
    const supportCase = await documents(strapi, 'api::support-case.support-case').create({
      data: {
        assignedAt: body.assignedTo ? now : null,
        candidate: relationConnect(candidate),
        caseKey: `admin-candidate:${body.candidateDocumentId}:${Date.now()}`,
        caseState: 'open',
        caseType: body.caseType,
        openedAt: now,
        openedByDisplayName: session.user.displayName,
        openedByEmail: session.user.email,
        openedByStaffUserId: session.user.id,
        openedByType: 'admin',
        ownerRoleKey: body.assignedTo?.roleKey || body.ownerRoleKey || 'support',
        ownerStaffDisplayName: body.assignedTo?.displayName || null,
        ownerStaffEmail: body.assignedTo?.email || null,
        ownerStaffUserId: body.assignedTo?.id || null,
        priority: body.priority,
        source: 'admin_dashboard',
        summary: body.initialNote,
        title: body.title,
      },
      populate: ['candidate'],
    });

    await documents(strapi, 'api::support-message.support-message').create({
      data: {
        body: body.initialNote,
        candidate: relationConnect(candidate),
        direction: 'internal',
        messageType: 'staff_note',
        senderDisplayName: session.user.displayName,
        senderEmail: session.user.email,
        senderId: session.user.id,
        senderType: 'admin',
        supportCase: relationConnect(supportCase),
        visibility: 'internal',
      },
    });

    await recordAdminCandidateAudit(
      strapi,
      session,
      candidate,
      'admin.candidate_support_case_created',
      requestContext,
      {
        metadata: {
          assignedTo: body.assignedTo || null,
          supportCaseDocumentId: getDocumentId(supportCase),
        },
      }
    );

    return {
      created: true,
      supportCase: supportCasePayload(supportCase),
      user: session.user,
    };
  },

  async strikeAction(input: unknown, requestContext: RequestContext = {}) {
    const body = validateStrikeAction(input);
    const session = await assertCandidateSession(strapi, body.sessionToken, requestContext);
    const permissions = candidatePermissions(session);
    const candidate = await findCandidateByDocumentId(strapi, body.candidateDocumentId);

    if (!candidate) {
      throw new ValidationError('Candidate could not be found.');
    }

    await assertCandidateAccess(strapi, session, body.candidateDocumentId);

    if (!permissions.canManageStrikes) {
      throw new ForbiddenError('Admin or Super Admin access is required to manage candidate strikes.');
    }

    const now = new Date().toISOString();

    if (body.action === 'apply') {
      const strikes = await candidateStrikes(strapi, body.candidateDocumentId);
      const strikeNumber =
        Math.max(0, ...strikes.map((strike) => Number(strike.strikeNumber || 0))) + 1;
      const strike = await documents(strapi, 'api::candidate-interview-strike.candidate-interview-strike').create({
        data: {
          appliedAt: now,
          candidate: relationConnect(candidate),
          metadata: {
            adminReasonNote: body.reasonNote,
            appliedByStaffEmail: session.user.email,
            appliedByStaffUserId: session.user.id,
          },
          reason: body.reason,
          strikeNumber,
          strikeState: 'active',
        },
      });

      await recordAdminCandidateAudit(
        strapi,
        session,
        candidate,
        'admin.candidate_interview_strike_applied',
        requestContext,
        {
          metadata: {
            reasonNote: body.reasonNote,
            strikeDocumentId: getDocumentId(strike),
            strikeNumber,
          },
          severity: 'warning',
        }
      );

      return {
        strike: strikePayload(strike),
        updated: true,
        user: session.user,
      };
    }

    const strikes = await candidateStrikes(strapi, body.candidateDocumentId);
    const targetStrikes =
      body.action === 'reset_all'
        ? strikes.filter((strike) => ['active', 'appealed', 'upheld'].includes(String(strike.strikeState || '')))
        : strikes.filter((strike) => getDocumentId(strike) === body.strikeDocumentId);

    if (targetStrikes.length === 0) {
      throw new ValidationError('Candidate strike could not be found.');
    }

    const nextState =
      body.action === 'uphold'
        ? 'upheld'
        : body.action === 'expire'
          ? 'expired'
          : 'removed';

    const updatedStrikes = [];

    for (const strike of targetStrikes) {
      const strikeDocumentId = getDocumentId(strike);

      if (!strikeDocumentId) {
        continue;
      }

      updatedStrikes.push(
        await documents(strapi, 'api::candidate-interview-strike.candidate-interview-strike').update({
          documentId: strikeDocumentId,
          data: {
            reviewedAt: now,
            reviewedByAdminId: session.user.id,
            reviewDecision: body.reasonNote,
            strikeState: nextState,
          },
        })
      );
    }

    await recordAdminCandidateAudit(
      strapi,
      session,
      candidate,
      body.action === 'reset_all'
        ? 'admin.candidate_interview_strikes_reset'
        : 'admin.candidate_interview_strike_reviewed',
      requestContext,
      {
        metadata: {
          action: body.action,
          reasonNote: body.reasonNote,
          strikeDocumentIds: updatedStrikes.map(getDocumentId),
        },
        severity: body.action === 'uphold' ? 'warning' : 'info',
      }
    );

    return {
      strikes: updatedStrikes.map(strikePayload),
      updated: true,
      user: session.user,
    };
  },

  async candidateActivity(input: unknown, requestContext: RequestContext = {}) {
    const body = validateCandidateActivity(input);
    const session = await assertCandidateSession(strapi, body.sessionToken, requestContext);
    const candidate = await findCandidateByDocumentId(strapi, body.candidateDocumentId);

    if (!candidate) {
      throw new ValidationError('Candidate could not be found.');
    }

    await assertCandidateAccess(strapi, session, body.candidateDocumentId);

    const auditDocuments = documents(strapi, 'api::audit-event.audit-event');
    const filters = candidateAuditFilters(candidate, {
      actorType: body.actorType,
      category: body.category,
      search: body.search,
      severity: body.severity,
      source: body.source,
    });
    const baseFilters = candidateAuditFilters(candidate);
    const [filteredTotal, total, filterOptions] = await Promise.all([
      auditDocuments.count({ filters }),
      auditDocuments.count({ filters: baseFilters }),
      candidateActivityOptions(strapi, candidate),
    ]);
    const pageCount = Math.max(1, Math.ceil(filteredTotal / body.pageSize));
    const page = Math.min(body.page, pageCount);
    const records = await auditDocuments.findMany({
      filters,
      limit: body.pageSize,
      sort: ['occurredAt:desc', 'createdAt:desc'],
      start: (page - 1) * body.pageSize,
    });

    return {
      auditEvents: records.map(auditPayload),
      filters: filterOptions,
      generatedAt: new Date().toISOString(),
      pagination: {
        page,
        pageCount,
        pageSize: body.pageSize,
        total: filteredTotal,
      },
      totalActivity: total,
      user: session.user,
    };
  },

  async activityReport(input: unknown, requestContext: RequestContext = {}) {
    const body = validateCandidateActivityReport(input);
    const session = await assertCandidateSession(strapi, body.sessionToken, requestContext);
    const permissions = candidatePermissions(session);
    const candidate = await findCandidateByDocumentId(strapi, body.candidateDocumentId);

    if (!candidate) {
      throw new ValidationError('Candidate could not be found.');
    }

    if (!permissions.canExportActivityReport) {
      throw new ForbiddenError('Admin or Super Admin access is required for candidate activity reports.');
    }

    const existingAuditRecords = await candidateAuditEvents(strapi, candidate);
    const generatedAt = new Date().toISOString();

    await recordAdminCandidateAudit(
      strapi,
      session,
      candidate,
      'admin.candidate_activity_report_exported',
      requestContext,
      {
        metadata: {
          eventCount: existingAuditRecords.length + 1,
          exportFormat: 'pdf',
          generatedAt,
          redaction: body.redaction,
        },
      }
    );

    const auditRecords = await candidateAuditEvents(strapi, candidate);
    const report = {
      auditEvents: auditRecords.map((event) => activityReportEventPayload(event, body.redaction)),
      candidateDisplayName: body.redaction === 'redacted' ? redactedValue : displayName(candidate),
      candidateDocumentId: getDocumentId(candidate),
      candidateEmail: body.redaction === 'redacted' ? redactedValue : candidate.email || null,
      generatedAt,
      redaction: body.redaction,
      schemaVersion: 'candidate-activity-report-v2',
    };
    const pdf = await renderCandidateActivityReportPdf({
      candidate,
      report,
    });

    return {
      file: {
        base64: pdf.toString('base64'),
        fileName: `hireflip-candidate-activity-report-${safeFileNamePart(getDocumentId(candidate))}-${body.redaction}.pdf`,
        mimeType: 'application/pdf',
      },
      report,
      user: session.user,
    };
  },

  async gdprExport(input: unknown, requestContext: RequestContext = {}) {
    const body = validateCandidateDetail(input);
    const session = await assertCandidateSession(strapi, body.sessionToken, requestContext);
    const permissions = candidatePermissions(session);
    const candidate = await findCandidateByDocumentId(strapi, body.candidateDocumentId);

    if (!candidate) {
      throw new ValidationError('Candidate could not be found.');
    }

    if (!permissions.canExportGdpr) {
      throw new ForbiddenError('Only Super Admin can export candidate data.');
    }

    const candidateDocumentId = body.candidateDocumentId;
    const [profiles, enrollments, requests, slotOffers, interviews, strikes, supportCases, auditRecords, notificationEvents] =
      await Promise.all([
        findAllDocuments(strapi, 'api::candidate-profile.candidate-profile', {
          filters: { candidate: { documentId: candidateDocumentId } },
        }),
        candidateEnrollments(strapi, candidateDocumentId),
        candidateInterviewRequests(strapi, candidateDocumentId),
        candidateSlotOffers(strapi, candidateDocumentId),
        candidateInterviews(strapi, candidateDocumentId),
        candidateStrikes(strapi, candidateDocumentId),
        candidateSupportCases(strapi, candidateDocumentId),
        candidateAuditEvents(strapi, candidate),
        findAllDocuments(strapi, 'api::notification-event.notification-event', {
          filters: { candidate: { documentId: candidateDocumentId } },
          sort: ['createdAt:desc'],
        }),
      ]);
    const supportCaseIds = compact(supportCases.map(getDocumentId));
    const supportMessages = supportCaseIds.length
      ? await findAllDocuments(strapi, 'api::support-message.support-message', {
          filters: {
            supportCase: {
              documentId: {
                $in: supportCaseIds,
              },
            },
          },
          sort: ['createdAt:asc'],
        })
      : [];
    const interviewIds = compact(interviews.map(getDocumentId));
    const interviewFeedback = interviewIds.length
      ? await findAllDocuments(strapi, 'api::interview-feedback.interview-feedback', {
          filters: {
            interview: {
              documentId: {
                $in: interviewIds,
              },
            },
          },
          sort: ['createdAt:asc'],
        })
      : [];
    const exportedAt = new Date().toISOString();

    const exportPayload = {
        auditEvents: auditRecords,
        candidate,
        candidateProfiles: profiles,
        enrollments,
        generatedAt: exportedAt,
        interviewFeedback,
        interviewRequests: requests,
        interviewSlotOffers: slotOffers,
        interviews,
        notificationEvents,
        schemaVersion: 'candidate-gdpr-export-v1',
        strikes,
        supportCases,
        supportMessages,
    };
    const pdf = await renderCandidateExportPdf({
      candidate,
      data: exportPayload,
    });

    await recordAdminCandidateAudit(
      strapi,
      session,
      candidate,
      'admin.privacy_candidate_data_exported',
      requestContext,
      {
        metadata: {
          exportedAt,
          exportFormat: 'pdf',
        },
      }
    );

    return {
      export: exportPayload,
      exported: true,
      file: {
        base64: pdf.toString('base64'),
        fileName: `hireflip-candidate-data-export-${getDocumentId(candidate) || 'candidate'}.pdf`,
        mimeType: 'application/pdf',
      },
      user: session.user,
    };
  },
});

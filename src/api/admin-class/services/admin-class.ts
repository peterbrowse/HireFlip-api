import { errors, validateZodSchema, z } from '@strapi/utils';
import { publishAdminRealtimeEvent } from '../../../utils/admin-realtime-events';
import {
  publishCandidateClassRealtimeEvent,
  publishClassRealtimeEvent,
} from '../../../utils/class-realtime-events';

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
  record(input: Record<string, unknown>): Promise<unknown>;
};

type InterviewRequestService = {
  checkClassInterviewSupply(input: unknown): Promise<{
    availableInterviewCapacity: number;
    capacityShortfall?: number;
    contingencyPercentage?: number;
    eligibleEmployerCount?: number;
    employerCapacityBreakdown?: Array<Record<string, unknown>>;
    ready: boolean;
    reason?: string | null;
    requiredInterviewCapacity: number;
    thresholdPercentage?: number;
  }>;
};

type DocumentRecord = Record<string, unknown> & {
  amountPence?: number;
  automaticOpeningReadinessStatus?: string;
  beganClassAt?: string;
  body?: string;
  candidate?: DocumentRecord;
  capacity?: number;
  class?: DocumentRecord;
  classArea?: DocumentRecord;
  completedAt?: string;
  completionDeadline?: string;
  courseCompletionDeadline?: string;
  courseDeadlineExtensionSeconds?: number;
  completionStatus?: string;
  createdAt?: string;
  course?: DocumentRecord;
  courseMaterial?: DocumentRecord;
  courseModule?: DocumentRecord;
  courseSection?: DocumentRecord;
  courseTest?: DocumentRecord;
  currency?: string;
  displayTitle?: string;
  documentId?: string;
  email?: string;
  endDate?: string;
  enrolledAt?: string;
  enrollment?: DocumentRecord;
  enrollmentOpenedAt?: string;
  enrollmentOpenedBy?: string;
  enrollmentState?: string;
  firstName?: string;
  id?: number | string;
  interestRegisteredAt?: string;
  interestThresholdPercentage?: number;
  interviewCapacityContingencyPercentage?: number;
  interviewGuaranteeDeadline?: string;
  interviewGuaranteeWindowStartsAt?: string;
  interviewsGuaranteed?: number;
  invitedToJoinAt?: string;
  lastName?: string;
  materialState?: string;
  materialType?: string;
  metadata?: unknown;
  module?: DocumentRecord;
  moduleState?: string;
  modulesPassCriteriaAttached?: boolean;
  name?: string;
  officialClassCode?: string;
  openedAt?: string;
  openingCapacityReservation?: unknown;
  openingCapacityReservationState?: string;
  openingMode?: string;
  openingReadinessCheckedAt?: string;
  openingReadinessStatus?: string;
  openingReadinessSummary?: unknown;
  passStatus?: string;
  payment?: DocumentRecord;
  paymentState?: string;
  paymentStatus?: string;
  phone?: string;
  postedByStaffDisplayName?: string;
  postedByStaffEmail?: string;
  postedByStaffUserId?: string;
  pricePence?: number;
  minimumViableCapacity?: number;
  processedAt?: string;
  progressState?: string;
  progressType?: string;
  providerCheckoutSessionId?: string;
  providerPaymentIntentId?: string;
  expiresAt?: string;
  visibleFrom?: string;
  qualifyingInterviewsDeliveredCount?: number;
  refundEligibilityState?: string;
  region?: string;
  remoteInterviewsAllowed?: boolean;
  reservation?: DocumentRecord;
  reservationExpiresAt?: string;
  reservationState?: string;
  scheduledEnrollmentOpenAt?: string;
  score?: number;
  sector?: string;
  sectionState?: string;
  sortOrder?: number;
  slug?: string;
  startDate?: string;
  startedAt?: string;
  state?: string;
  announcementState?: string;
  priority?: string;
  test?: DocumentRecord;
  testState?: string;
  title?: string;
  updatedAt?: string;
  waitingListPosition?: number;
  workSector?: DocumentRecord;
  year?: number;
  yearSequenceNumber?: number;
};

type DocumentCollection = {
  count(input: Record<string, unknown>): Promise<number>;
  create(input: Record<string, unknown>): Promise<DocumentRecord>;
  findMany(input: Record<string, unknown>): Promise<DocumentRecord[]>;
  update(input: Record<string, unknown>): Promise<DocumentRecord>;
};

type StrapiService = {
  documents(uid: string): unknown;
  log?: {
    error?: (message: string, error?: unknown) => void;
    warn?: (message: string, error?: unknown) => void;
  };
  plugin(name: string): unknown;
  service(uid: string): unknown;
};

type NotificationServiceQueueResponse = {
  data?: {
    jobId?: unknown;
    queued?: unknown;
  };
};

const classStates = [
  'draft',
  'coming_soon',
  'waitlist_open',
  'open',
  'full',
  'in_progress',
  'completion_window',
  'interview_window',
  'completed',
  'cancelled',
  'archived',
] as const;

const openingModes = [
  'manual_readiness',
  'admin_scheduled',
  'admin_immediate',
  'automatic',
  'automatic_when_ready',
  'automatic_at_capacity',
] as const;
const readinessFilters = [
  'all',
  'ready',
  'blocked',
  'needs_employer_capacity',
  'needs_course_setup',
] as const;
const announcementPriorities = ['normal', 'important', 'urgent'] as const;
const announcementStates = ['draft', 'published', 'archived'] as const;
const editableAnnouncementStates = ['draft', 'published'] as const;

const listSchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(10).max(100).default(25),
    readiness: z.enum(readinessFilters).default('all'),
    search: z.string().trim().max(120).optional().transform((value) => value || undefined),
    sessionToken: z.string().trim().min(32).max(512),
    sortBy: z.enum(['capacity', 'createdAt', 'displayTitle', 'readiness', 'startDate', 'state']).default('startDate'),
    sortDirection: z.enum(['asc', 'desc']).default('asc'),
    state: z.enum([...classStates, 'all']).default('all'),
  })
  .strict();

const detailSchema = z
  .object({
    classDocumentId: z.string().trim().min(1).max(160),
    sessionToken: z.string().trim().min(32).max(512),
  })
  .strict();

const optionsSchema = z
  .object({
    sessionToken: z.string().trim().min(32).max(512),
  })
  .strict();

const emptyToUndefined = (value: unknown) => value === '' || value === null ? undefined : value;
const numberInput = (schema: z.ZodNumber) =>
  z.preprocess((value) => {
    const cleaned = emptyToUndefined(value);

    if (typeof cleaned === 'string') {
      return Number(cleaned);
    }

    return cleaned;
  }, schema);
const optionalString = (maxLength: number) =>
  z.preprocess(emptyToUndefined, z.string().trim().max(maxLength).optional());
const optionalDate = () =>
  z.preprocess(emptyToUndefined, z.string().trim().max(80).optional());
const optionalDateTime = () =>
  z.preprocess(emptyToUndefined, z.string().trim().max(120).optional());
const optionalDocumentId = () =>
  z.preprocess(emptyToUndefined, z.string().trim().max(160).optional());
const optionalBoolean = () =>
  z.preprocess((value) => {
    if (value === '' || value === null || typeof value === 'undefined') {
      return undefined;
    }

    if (typeof value === 'string') {
      return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
    }

    return value;
  }, z.boolean().optional());

const classInputSchema = z
  .object({
    capacity: numberInput(z.number().int().min(1).max(1000)),
    classAreaDocumentId: optionalDocumentId(),
    completionDeadline: optionalDateTime(),
    courseDocumentId: z.string().trim().min(1).max(160),
    currency: z.string().trim().min(3).max(3).transform((value) => value.toUpperCase()),
    discountedPricePence: numberInput(z.number().int().min(0)).optional(),
    displayTitle: z.string().trim().min(1).max(160),
    employerInterviewAvailabilityThresholdPercentage: numberInput(z.number().int().min(1).max(1000)).default(150),
    endDate: optionalDate(),
    includedItems: z.array(z.string().trim().min(1).max(240)).max(40).optional(),
    interestThresholdPercentage: numberInput(z.number().int().min(1).max(1000)).default(100),
    interviewCapacityContingencyPercentage: numberInput(z.number().int().min(0).max(500)).default(30),
    interviewGuaranteeDeadline: optionalDateTime(),
    interviewsGuaranteed: numberInput(z.number().int().min(0).max(50)),
    level: optionalString(80),
    moduleSummary: optionalString(2000),
    modulesPassCriteriaAttached: optionalBoolean().default(false),
    minimumViableCapacity: numberInput(z.number().int().min(1).max(1000)).default(1),
    name: z.string().trim().min(1).max(160),
    officialClassCode: z.string().trim().min(1).max(40),
    openingMode: z.enum(openingModes).default('manual_readiness'),
    overview: optionalString(5000),
    pricePence: numberInput(z.number().int().min(0)).optional(),
    region: optionalString(120),
    remoteInterviewsAllowed: optionalBoolean().default(false),
    requirements: optionalString(3000),
    scheduledEnrollmentOpenAt: optionalDateTime(),
    scheduleNotes: optionalString(3000),
    sector: optionalString(120),
    slug: optionalString(160),
    startDate: optionalDate(),
    state: z.enum(classStates).default('draft'),
    workSectorDocumentId: optionalDocumentId(),
    year: numberInput(z.number().int().min(2026).max(2100)).optional(),
    yearSequenceNumber: numberInput(z.number().int().min(1).max(999)).optional(),
  })
  .strict();

const createSchema = z
  .object({
    class: classInputSchema,
    sessionToken: z.string().trim().min(32).max(512),
  })
  .strict();

const updateSchema = z
  .object({
    class: classInputSchema.partial().extend({
      courseDocumentId: optionalDocumentId(),
    }),
    classDocumentId: z.string().trim().min(1).max(160),
    sessionToken: z.string().trim().min(32).max(512),
  })
  .strict();

const lifecycleSchema = z
  .object({
    action: z.enum([
      'archive',
      'cancel',
      'close_enrollment',
      'mark_completed',
      'open_completion_window',
      'open_enrollment',
      'open_interview_window',
      'open_waitlist',
      'start_class',
    ]),
    classDocumentId: z.string().trim().min(1).max(160),
    reason: z.string().trim().max(2000).optional().transform((value) => value || undefined),
    sessionToken: z.string().trim().min(32).max(512),
  })
  .strict();

const postAnnouncementSchema = z
  .object({
    body: z.string().trim().min(1).max(12000),
    classDocumentId: z.string().trim().min(1).max(160),
    announcementState: z.enum(editableAnnouncementStates).default('published'),
    expiresAt: optionalDateTime(),
    priority: z.enum(announcementPriorities).default('normal'),
    sessionToken: z.string().trim().min(32).max(512),
    title: z.string().trim().min(1).max(160),
    visibleFrom: optionalDateTime(),
  })
  .strict();

const updateAnnouncementSchema = z
  .object({
    announcementDocumentId: z.string().trim().min(1).max(160),
    announcementState: z.enum(editableAnnouncementStates).default('published'),
    body: z.string().trim().min(1).max(12000),
    classDocumentId: z.string().trim().min(1).max(160),
    expiresAt: optionalDateTime(),
    priority: z.enum(announcementPriorities).default('normal'),
    sessionToken: z.string().trim().min(32).max(512),
    title: z.string().trim().min(1).max(160),
    visibleFrom: optionalDateTime(),
  })
  .strict();

const deleteAnnouncementSchema = z
  .object({
    announcementDocumentId: z.string().trim().min(1).max(160),
    classDocumentId: z.string().trim().min(1).max(160),
    sessionToken: z.string().trim().min(32).max(512),
  })
  .strict();

const validateList = validateZodSchema(listSchema);
const validateDetail = validateZodSchema(detailSchema);
const validateOptions = validateZodSchema(optionsSchema);
const validateCreate = validateZodSchema(createSchema);
const validateUpdate = validateZodSchema(updateSchema);
const validateLifecycle = validateZodSchema(lifecycleSchema);
const validatePostAnnouncement = validateZodSchema(postAnnouncementSchema);
const validateUpdateAnnouncement = validateZodSchema(updateAnnouncementSchema);
const validateDeleteAnnouncement = validateZodSchema(deleteAnnouncementSchema);

const documents = (strapi: StrapiService, uid: string) =>
  strapi.documents(uid) as unknown as DocumentCollection;

const findAllDocuments = async (
  strapi: StrapiService,
  uid: string,
  input: Record<string, unknown>,
  pageSize = 100
) => {
  const collection = documents(strapi, uid);
  const total = await collection.count({ filters: input.filters || {} });
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

const adminAuthService = (strapi: StrapiService) =>
  strapi.service('api::admin-auth.admin-auth') as unknown as AdminAuthService;

const auditEvents = (strapi: StrapiService) =>
  strapi.service('api::audit-event.audit-event') as unknown as AuditEventService;

const interviewRequestService = (strapi: StrapiService) =>
  strapi.service('api::interview-request.interview-request') as unknown as InterviewRequestService;

const objectValue = (value: unknown) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const paymentReceiptUrl = (payment: DocumentRecord) => {
  const metadata = objectValue(payment.metadata);

  if (typeof payment.providerReceiptUrl === 'string') {
    return payment.providerReceiptUrl;
  }

  return typeof metadata.providerReceiptUrl === 'string' ? metadata.providerReceiptUrl : null;
};

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

const hasAnyRole = (session: AdminSession, roles: string[]) =>
  session.user.roleKeys.some((roleKey) => roles.includes(roleKey));

const assertClassViewSession = async (
  strapi: StrapiService,
  sessionToken: string,
  context: RequestContext
) => {
  const session = await adminAuthService(strapi).getSession({ sessionToken }, context);

  if (!hasAnyRole(session, ['admin', 'super_admin', 'support'])) {
    throw new ForbiddenError('Admin, Super Admin, or Support access is required.');
  }

  return session;
};

const assertClassManageSession = async (
  strapi: StrapiService,
  sessionToken: string,
  context: RequestContext
) => {
  const session = await assertClassViewSession(strapi, sessionToken, context);

  if (!hasAnyRole(session, ['admin', 'super_admin'])) {
    throw new ForbiddenError('Admin or Super Admin access is required.');
  }

  return session;
};

const assertSuperAdminSession = async (
  strapi: StrapiService,
  sessionToken: string,
  context: RequestContext
) => {
  const session = await assertClassManageSession(strapi, sessionToken, context);

  if (!session.user.roleKeys.includes('super_admin')) {
    throw new ForbiddenError('Super Admin access is required.');
  }

  return session;
};

const classPopulate = ['classArea', 'course', 'workSector'];
const enrollmentPopulate = ['candidate', 'class'];
const reservationPopulate = ['candidate', 'class', 'enrollment'];
const paymentPopulate = ['candidate', 'enrollment', 'reservation'];
const courseProgressPopulate = ['enrollment', 'courseSection', 'courseModule', 'courseMaterial', 'courseTest'];

const getDocumentId = (record?: DocumentRecord | null) => {
  if (!record) {
    return undefined;
  }

  return typeof record.documentId === 'string'
    ? record.documentId
    : typeof record.id === 'string' || typeof record.id === 'number'
      ? String(record.id)
      : undefined;
};

const candidateDisplayName = (candidate?: DocumentRecord | null) => {
  if (!candidate) {
    return 'Not recorded';
  }

  const firstName = typeof candidate.firstName === 'string' ? candidate.firstName.trim() : '';
  const lastName = typeof candidate.lastName === 'string' ? candidate.lastName.trim() : '';
  const fullName = `${firstName} ${lastName}`.trim();

  return fullName || String(candidate.email || 'Candidate');
};

const money = (amountPence?: number | null, currency = 'GBP') => {
  if (typeof amountPence !== 'number') {
    return null;
  }

  return new Intl.NumberFormat('en-GB', {
    currency,
    style: 'currency',
  }).format(amountPence / 100);
};

const classLabel = (classRecord: DocumentRecord) =>
  classRecord.displayTitle || classRecord.name || classRecord.officialClassCode || 'Class';

const summarizeClass = (classRecord?: DocumentRecord | null) => {
  if (!classRecord) {
    return null;
  }

  return {
    capacity: classRecord.capacity ?? null,
    classArea: classRecord.classArea
      ? {
          documentId: getDocumentId(classRecord.classArea),
          name: classRecord.classArea.name || null,
          slug: classRecord.classArea.slug || null,
        }
      : null,
    completionDeadline: classRecord.completionDeadline || null,
    course: classRecord.course
      ? {
          courseState: classRecord.course.courseState || null,
          documentId: getDocumentId(classRecord.course),
          name: classRecord.course.name || null,
          version: classRecord.course.version || null,
        }
      : null,
    currency: classRecord.currency || null,
    discountedPricePence: classRecord.discountedPricePence ?? null,
    displayTitle: classRecord.displayTitle || classRecord.name || null,
    documentId: getDocumentId(classRecord),
    employerInterviewAvailabilityThresholdPercentage:
      classRecord.employerInterviewAvailabilityThresholdPercentage ?? null,
    endDate: classRecord.endDate || null,
    enrollmentOpenedAt: classRecord.enrollmentOpenedAt || null,
    enrollmentOpenedBy: classRecord.enrollmentOpenedBy || null,
    includedItems: Array.isArray(classRecord.includedItems) ? classRecord.includedItems : [],
    interestThresholdPercentage: classRecord.interestThresholdPercentage ?? null,
    interviewCapacityContingencyPercentage:
      classRecord.interviewCapacityContingencyPercentage ?? null,
    interviewGuaranteeDeadline: classRecord.interviewGuaranteeDeadline || null,
    interviewsGuaranteed: classRecord.interviewsGuaranteed ?? null,
    level: classRecord.level || null,
    moduleSummary: classRecord.moduleSummary || null,
    modulesPassCriteriaAttached: classRecord.modulesPassCriteriaAttached === true,
    minimumViableCapacity: classRecord.minimumViableCapacity ?? null,
    name: classRecord.name || null,
    officialClassCode: classRecord.officialClassCode || null,
    openedAt: classRecord.openedAt || null,
    openingCapacityReservationState: classRecord.openingCapacityReservationState || 'none',
    openingMode: classRecord.openingMode || null,
    openingReadinessCheckedAt: classRecord.openingReadinessCheckedAt || null,
    openingReadinessStatus:
      classRecord.openingReadinessStatus ||
      (classRecord.automaticOpeningReadinessStatus === 'not_ready'
        ? 'blocked'
        : classRecord.automaticOpeningReadinessStatus || 'not_checked'),
    openingReadinessSummary: objectValue(classRecord.openingReadinessSummary),
    overview: classRecord.overview || null,
    pricePence: classRecord.pricePence ?? null,
    region: classRecord.classArea?.name || classRecord.region || null,
    remoteInterviewsAllowed: classRecord.remoteInterviewsAllowed === true,
    requirements: classRecord.requirements || null,
    scheduledEnrollmentOpenAt: classRecord.scheduledEnrollmentOpenAt || null,
    scheduleNotes: classRecord.scheduleNotes || null,
    sector: classRecord.workSector?.name || classRecord.sector || null,
    slug: classRecord.slug || null,
    startDate: classRecord.startDate || null,
    state: classRecord.state || null,
    workSector: classRecord.workSector
      ? {
          documentId: getDocumentId(classRecord.workSector),
          name: classRecord.workSector.name || null,
          slug: classRecord.workSector.slug || null,
        }
      : null,
    year: classRecord.year ?? null,
    yearSequenceNumber: classRecord.yearSequenceNumber ?? null,
  };
};

const enrollmentState = (enrollment?: DocumentRecord | null) =>
  String(enrollment?.enrollmentState || '');

const countMap = (enrollments: DocumentRecord[]) => {
  const counts = {
    capacityHeld: 0,
    completed: 0,
    failed: 0,
    inProgress: 0,
    interestRegistered: 0,
    paid: 0,
    placeReserved: 0,
    refundedOrRemoved: 0,
    totalRelationships: enrollments.length,
    waitingList: 0,
  };

  for (const enrollment of enrollments) {
    const state = enrollmentState(enrollment);

    if (state === 'interest_registered') {
      counts.interestRegistered += 1;
    }

    if (state === 'place_reserved') {
      counts.placeReserved += 1;
    }

    if (state === 'waiting_list') {
      counts.waitingList += 1;
    }

    if (['enrolled', 'in_class', 'interview_phase', 'completed'].includes(state)) {
      counts.paid += 1;
      counts.capacityHeld += 1;
    }

    if (state === 'place_reserved') {
      counts.capacityHeld += 1;
    }

    if (['in_class', 'interview_phase'].includes(state)) {
      counts.inProgress += 1;
    }

    if (state === 'completed') {
      counts.completed += 1;
    }

    if (state === 'failed') {
      counts.failed += 1;
    }

    if (['refunded', 'removed_no_refund', 'removed_partial_refund', 'removed_full_refund'].includes(state)) {
      counts.refundedOrRemoved += 1;
    }
  }

  return counts;
};

const classCounts = (classRecord: DocumentRecord, enrollments: DocumentRecord[]) => {
  const counts = countMap(enrollments);
  const capacity = typeof classRecord.capacity === 'number' && classRecord.capacity > 0
    ? classRecord.capacity
    : 0;
  const remainingCapacity = capacity ? Math.max(0, capacity - counts.capacityHeld) : null;
  const fillPercentage = capacity ? Math.min(100, Math.round((counts.capacityHeld / capacity) * 100)) : 0;

  return {
    ...counts,
    capacity,
    fillPercentage,
    remainingCapacity,
  };
};

const integerValue = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
};

const classDemandCount = (counts: ReturnType<typeof classCounts>) =>
  counts.capacityHeld + counts.interestRegistered + counts.placeReserved + counts.waitingList;

const courseSetupIsComplete = (courseSetup: CourseSetupPayload) =>
  courseSetup.sections.length > 0 &&
  courseSetup.modules.length > 0 &&
  courseSetup.materials.length > 0 &&
  courseSetup.tests.length > 0;

const readinessSummary = (classRecord: DocumentRecord) =>
  objectValue(classRecord.openingReadinessSummary);

const readinessCategoryForClass = (classRecord: DocumentRecord) => {
  const summary = readinessSummary(classRecord);
  const category = typeof summary.category === 'string' ? summary.category : undefined;

  if (category) {
    return category;
  }

  const status = classRecord.openingReadinessStatus ||
    (classRecord.automaticOpeningReadinessStatus === 'not_ready'
      ? 'blocked'
      : classRecord.automaticOpeningReadinessStatus);

  return status === 'ready' || status === 'opened' ? 'ready' : status === 'blocked' ? 'blocked' : 'not_checked';
};

type ClassListInput = z.infer<typeof listSchema>;

const classListReadinessFilter = (readiness: ClassListInput['readiness']) => {
  if (readiness === 'all') {
    return null;
  }

  if (readiness === 'ready') {
    return {
      openingReadinessStatus: {
        $in: ['ready', 'opened'],
      },
    };
  }

  return {
    openingReadinessStatus: 'blocked',
  };
};

const classListFilters = (body: ClassListInput) => {
  const filters: Record<string, unknown> = {};
  const andFilters: Record<string, unknown>[] = [];

  if (body.state !== 'all') {
    filters.state = body.state;
  }

  const readiness = classListReadinessFilter(body.readiness);

  if (readiness) {
    andFilters.push(readiness);
  }

  if (body.search) {
    andFilters.push({
      $or: [
        { documentId: { $containsi: body.search } },
        { displayTitle: { $containsi: body.search } },
        { name: { $containsi: body.search } },
        { officialClassCode: { $containsi: body.search } },
        { region: { $containsi: body.search } },
        { sector: { $containsi: body.search } },
        { classArea: { name: { $containsi: body.search } } },
        { course: { name: { $containsi: body.search } } },
        { workSector: { name: { $containsi: body.search } } },
      ],
    });
  }

  return andFilters.length ? { ...filters, $and: andFilters } : filters;
};

const classListSort = (sortBy: ClassListInput['sortBy'], sortDirection: ClassListInput['sortDirection']) => {
  if (sortBy === 'readiness') {
    return [`openingReadinessStatus:${sortDirection}`, `startDate:${sortDirection}`];
  }

  return [`${sortBy}:${sortDirection}`];
};

const classPermissions = (session: AdminSession) => ({
  canCancel: session.user.roleKeys.includes('super_admin'),
  canCreate: hasAnyRole(session, ['admin', 'super_admin']),
  canEdit: hasAnyRole(session, ['admin', 'super_admin']),
  canManageLifecycle: hasAnyRole(session, ['admin', 'super_admin']),
  canOverrideCompleted: session.user.roleKeys.includes('super_admin'),
  canViewCandidateContact: hasAnyRole(session, ['admin', 'super_admin', 'support']),
  canViewFinancials: hasAnyRole(session, ['admin', 'super_admin']),
});

const findClassByDocumentId = async (strapi: StrapiService, classDocumentId: string) => {
  const classes = await documents(strapi, 'api::class.class').findMany({
    filters: {
      documentId: classDocumentId,
    },
    limit: 1,
    populate: classPopulate,
  });

  return classes[0];
};

const findEnrollmentsForClasses = async (
  strapi: StrapiService,
  classDocumentIds: string[]
) => {
  if (classDocumentIds.length === 0) {
    return [];
  }

  return findAllDocuments(strapi, 'api::enrollment.enrollment', {
    filters: {
      class: {
        documentId: {
          $in: classDocumentIds,
        },
      },
    },
    populate: enrollmentPopulate,
    sort: ['createdAt:asc'],
  });
};

const groupEnrollmentsByClass = (enrollments: DocumentRecord[]) =>
  enrollments.reduce((map, enrollment) => {
    const classDocumentId = getDocumentId(enrollment.class);

    if (!classDocumentId) {
      return map;
    }

    const current = map.get(classDocumentId) || [];
    current.push(enrollment);
    map.set(classDocumentId, current);

    return map;
  }, new Map<string, DocumentRecord[]>());

const latestByEnrollment = (records: DocumentRecord[]) =>
  records.reduce((map, record) => {
    const enrollmentDocumentId = getDocumentId(record.enrollment);

    if (!enrollmentDocumentId) {
      return map;
    }

    const current = map.get(enrollmentDocumentId);
    const currentTime = current?.createdAt ? Date.parse(String(current.createdAt)) : 0;
    const nextTime = record.createdAt ? Date.parse(String(record.createdAt)) : 0;

    if (!current || nextTime >= currentTime) {
      map.set(enrollmentDocumentId, record);
    }

    return map;
  }, new Map<string, DocumentRecord>());

const findReservationsForEnrollments = async (
  strapi: StrapiService,
  enrollmentDocumentIds: string[]
) => {
  if (enrollmentDocumentIds.length === 0) {
    return new Map<string, DocumentRecord>();
  }

  const reservations = await findAllDocuments(strapi, 'api::reservation.reservation', {
    filters: {
      enrollment: {
        documentId: {
          $in: enrollmentDocumentIds,
        },
      },
    },
    populate: reservationPopulate,
    sort: ['createdAt:asc'],
  });

  return latestByEnrollment(reservations);
};

const findPaymentsForEnrollments = async (
  strapi: StrapiService,
  enrollmentDocumentIds: string[]
) => {
  if (enrollmentDocumentIds.length === 0) {
    return new Map<string, DocumentRecord>();
  }

  const payments = await findAllDocuments(strapi, 'api::payment.payment', {
    filters: {
      enrollment: {
        documentId: {
          $in: enrollmentDocumentIds,
        },
      },
    },
    populate: paymentPopulate,
    sort: ['createdAt:asc'],
  });

  return latestByEnrollment(payments);
};

type CourseSetupPayload = {
  materials: Array<{
    documentId?: string;
    materialState: string | null;
    required: boolean;
  }>;
  modules: Array<{
    documentId?: string;
    moduleState: string | null;
    required: boolean;
  }>;
  sections: Array<{
    documentId?: string;
    required: boolean;
    sectionState: string | null;
  }>;
  tests: Array<{
    documentId?: string;
    testState: string | null;
  }>;
};

const findCourseProgressForEnrollments = async (
  strapi: StrapiService,
  enrollmentDocumentIds: string[]
) => {
  if (enrollmentDocumentIds.length === 0) {
    return new Map<string, DocumentRecord[]>();
  }

  const progressRecords = await findAllDocuments(strapi, 'api::course-progress.course-progress', {
    filters: {
      enrollment: {
        documentId: {
          $in: enrollmentDocumentIds,
        },
      },
    },
    populate: courseProgressPopulate,
    sort: ['createdAt:asc'],
  });

  return progressRecords.reduce((map, progressRecord) => {
    const enrollmentDocumentId = getDocumentId(progressRecord.enrollment);

    if (!enrollmentDocumentId) {
      return map;
    }

    map.set(enrollmentDocumentId, [
      ...(map.get(enrollmentDocumentId) || []),
      progressRecord,
    ]);

    return map;
  }, new Map<string, DocumentRecord[]>());
};

const setupItemKeys = (courseSetup: CourseSetupPayload) => {
  const keys = new Set<string>();

  courseSetup.sections.forEach((section) => {
    if (section.required && section.sectionState !== 'archived' && section.documentId) {
      keys.add(`section:${section.documentId}`);
    }
  });
  courseSetup.modules.forEach((module) => {
    if (module.required && module.moduleState !== 'archived' && module.documentId) {
      keys.add(`module:${module.documentId}`);
    }
  });
  courseSetup.materials.forEach((material) => {
    if (material.required && material.materialState !== 'archived' && material.documentId) {
      keys.add(`material:${material.documentId}`);
    }
  });
  courseSetup.tests.forEach((test) => {
    if (test.testState !== 'archived' && test.documentId) {
      keys.add(`test:${test.documentId}`);
    }
  });

  return keys;
};

const progressItemKey = (progressRecord: DocumentRecord) => {
  if (progressRecord.progressType === 'section') {
    const documentId = getDocumentId(progressRecord.courseSection);
    return documentId ? `section:${documentId}` : null;
  }

  if (progressRecord.progressType === 'module') {
    const documentId = getDocumentId(progressRecord.courseModule);
    return documentId ? `module:${documentId}` : null;
  }

  if (progressRecord.progressType === 'material') {
    const documentId = getDocumentId(progressRecord.courseMaterial);
    return documentId ? `material:${documentId}` : null;
  }

  if (progressRecord.progressType === 'test') {
    const documentId = getDocumentId(progressRecord.courseTest);
    return documentId ? `test:${documentId}` : null;
  }

  return null;
};

const progressTimestamp = (progressRecord?: DocumentRecord) => {
  if (!progressRecord) {
    return null;
  }

  return progressRecord.completedAt || progressRecord.startedAt || progressRecord.updatedAt || progressRecord.createdAt || null;
};

const latestProgressRecord = (progressRecords: DocumentRecord[]) =>
  progressRecords.reduce<DocumentRecord | undefined>((latest, progressRecord) => {
    const latestTime = progressTimestamp(latest);
    const progressTime = progressTimestamp(progressRecord);

    if (!latestTime) {
      return progressRecord;
    }

    if (!progressTime) {
      return latest;
    }

    return Date.parse(progressTime) >= Date.parse(latestTime) ? progressRecord : latest;
  }, undefined);

const daysUntil = (dateValue?: string | null) => {
  if (!dateValue) {
    return null;
  }

  const timestamp = Date.parse(dateValue);

  if (Number.isNaN(timestamp)) {
    return null;
  }

  return Math.ceil((timestamp - Date.now()) / 86400000);
};

const activeDeadline = (classRecord: DocumentRecord, enrollment: DocumentRecord) => {
  const phase = String(enrollment.enrollmentState || classRecord.state || '');
  const interviewDeadline = enrollment.interviewGuaranteeDeadline || classRecord.interviewGuaranteeDeadline || null;
  const completionDeadline = enrollment.courseCompletionDeadline || classRecord.completionDeadline || null;
  const reservationDeadline = enrollment.reservationExpiresAt || null;

  if (phase === 'interview_phase' && interviewDeadline) {
    return {
      at: interviewDeadline,
      type: 'interview',
    };
  }

  if (['in_class', 'enrolled'].includes(phase) && completionDeadline) {
    return {
      at: completionDeadline,
      type: 'completion',
    };
  }

  if (['place_reserved', 'enrollment_open'].includes(phase) && reservationDeadline) {
    return {
      at: reservationDeadline,
      type: 'reservation',
    };
  }

  if (classRecord.state === 'completion_window' && completionDeadline) {
    return {
      at: completionDeadline,
      type: 'completion',
    };
  }

  if (classRecord.state === 'interview_window' && interviewDeadline) {
    return {
      at: interviewDeadline,
      type: 'interview',
    };
  }

  return {
    at: completionDeadline || interviewDeadline || reservationDeadline,
    type: completionDeadline
      ? 'completion'
      : interviewDeadline
        ? 'interview'
        : reservationDeadline
          ? 'reservation'
          : null,
  };
};

const enrollmentProgressSummary = ({
  classRecord,
  courseItemKeys,
  enrollment,
  progressRecords,
}: {
  classRecord: DocumentRecord;
  courseItemKeys: Set<string>;
  enrollment: DocumentRecord;
  progressRecords: DocumentRecord[];
}) => {
  const completedKeys = new Set<string>();
  const startedKeys = new Set<string>();
  const classProgressRecord = latestProgressRecord(
    progressRecords.filter((progressRecord) => progressRecord.progressType === 'class')
  );
  const latestProgress = latestProgressRecord(progressRecords);

  progressRecords.forEach((progressRecord) => {
    const itemKey = progressItemKey(progressRecord);

    if (!itemKey || !courseItemKeys.has(itemKey)) {
      return;
    }

    if (['in_progress', 'completed', 'failed'].includes(String(progressRecord.progressState || ''))) {
      startedKeys.add(itemKey);
    }

    if (progressRecord.progressState === 'completed') {
      completedKeys.add(itemKey);
    }
  });

  const totalItems = courseItemKeys.size;
  const courseCompletedByStatus =
    enrollment.completionStatus === 'completed' || classProgressRecord?.progressState === 'completed';
  const completedItems = totalItems > 0 && courseCompletedByStatus
    ? totalItems
    : Math.min(totalItems, completedKeys.size);
  const startedItems = totalItems > 0 && courseCompletedByStatus
    ? totalItems
    : Math.min(totalItems, startedKeys.size);
  const percentageComplete = totalItems > 0
    ? Math.min(100, Math.round((completedItems / totalItems) * 100))
    : courseCompletedByStatus
      ? 100
      : null;
  const deadline = activeDeadline(classRecord, enrollment);

  return {
    activeDeadlineAt: deadline.at || null,
    activeDeadlineDaysRemaining: daysUntil(deadline.at),
    activeDeadlineType: deadline.type,
    classProgressState: classProgressRecord?.progressState || null,
    completedItems,
    completionDeadline: classRecord.completionDeadline || null,
    interviewGuaranteeDeadline:
      enrollment.interviewGuaranteeDeadline || classRecord.interviewGuaranteeDeadline || null,
    interviewGuaranteeWindowStartsAt: enrollment.interviewGuaranteeWindowStartsAt || null,
    interviewsGuaranteed: classRecord.interviewsGuaranteed ?? null,
    latestProgressAt: progressTimestamp(latestProgress),
    latestProgressState: latestProgress?.progressState || null,
    percentageComplete,
    percentageSource: totalItems > 0
      ? 'course_progress_records'
      : courseCompletedByStatus
        ? 'enrollment_completion_status'
        : null,
    phase: enrollment.enrollmentState || classRecord.state || null,
    qualifyingInterviewsDeliveredCount: enrollment.qualifyingInterviewsDeliveredCount ?? null,
    startedItems,
    totalItems,
  };
};

const publicEnrollment = ({
  classRecord,
  enrollment,
  payment,
  permissions,
  progressRecords,
  reservation,
  courseItemKeys,
}: {
  classRecord: DocumentRecord;
  courseItemKeys: Set<string>;
  enrollment: DocumentRecord;
  payment?: DocumentRecord;
  permissions: ReturnType<typeof classPermissions>;
  progressRecords: DocumentRecord[];
  reservation?: DocumentRecord;
}) => {
  const candidate = enrollment.candidate;
  const candidateDocumentId = getDocumentId(candidate);

  return {
    candidate: {
      displayName: candidateDisplayName(candidate),
      documentId: candidateDocumentId || null,
      email: permissions.canViewCandidateContact ? candidate?.email || null : null,
      phone: permissions.canViewCandidateContact ? candidate?.phone || null : null,
      state: candidate?.candidateState || null,
    },
    completedAt: enrollment.completedAt || null,
    completionStatus: enrollment.completionStatus || null,
    documentId: getDocumentId(enrollment) || null,
    enrolledAt: enrollment.enrolledAt || null,
    enrollmentState: enrollment.enrollmentState || null,
    interestRegisteredAt: enrollment.interestRegisteredAt || null,
    invitedToJoinAt: enrollment.invitedToJoinAt || null,
    passStatus: enrollment.passStatus || null,
    payment: permissions.canViewFinancials && payment
      ? {
          amountPence: payment.amountPence ?? null,
          currency: payment.currency || null,
          documentId: getDocumentId(payment) || null,
          formattedAmount: money(payment.amountPence, String(payment.currency || 'GBP')),
          paidAt: payment.paidAt || null,
          paymentState: payment.paymentState || null,
          providerCheckoutSessionId: payment.providerCheckoutSessionId || null,
          providerPaymentIntentId: payment.providerPaymentIntentId || null,
          providerReceiptUrl: paymentReceiptUrl(payment),
        }
      : null,
    paymentStatus: enrollment.paymentStatus || null,
    progress: enrollmentProgressSummary({
      classRecord,
      courseItemKeys,
      enrollment,
      progressRecords,
    }),
    qualifyingInterviewsDeliveredCount: enrollment.qualifyingInterviewsDeliveredCount ?? null,
    refundEligibilityState: enrollment.refundEligibilityState || null,
    reservation: permissions.canViewFinancials && reservation
      ? {
          amountPence: reservation.amountPence ?? null,
          currency: reservation.currency || null,
          documentId: getDocumentId(reservation) || null,
          expiresAt: reservation.expiresAt || null,
          formattedAmount: money(reservation.amountPence, String(reservation.currency || 'GBP')),
          paidAt: reservation.paidAt || null,
          reservationState: reservation.reservationState || null,
        }
      : null,
    reservationExpiresAt: enrollment.reservationExpiresAt || null,
    waitingListPosition: enrollment.waitingListPosition ?? null,
  };
};

const publicClassAnnouncement = (announcement: DocumentRecord) => ({
  announcementState: announcement.announcementState || null,
  body: announcement.body || null,
  createdAt: announcement.createdAt || null,
  documentId: getDocumentId(announcement) || null,
  expiresAt: announcement.expiresAt || null,
  postedBy: {
    displayName: announcement.postedByStaffDisplayName || null,
    email: announcement.postedByStaffEmail || null,
    id: announcement.postedByStaffUserId || null,
  },
  priority: announcement.priority || null,
  title: announcement.title || null,
  updatedAt: announcement.updatedAt || null,
  visibleFrom: announcement.visibleFrom || null,
});

const findClassAnnouncements = async (strapi: StrapiService, classDocumentId: string) =>
  findAllDocuments(strapi, 'api::class-announcement.class-announcement', {
    filters: {
      announcementState: {
        $ne: 'archived',
      },
      class: {
        documentId: classDocumentId,
      },
    },
    sort: ['visibleFrom:desc', 'createdAt:desc'],
  });

const findClassAnnouncementByDocumentId = async (
  strapi: StrapiService,
  classDocumentId: string,
  announcementDocumentId: string
) => {
  const announcements = await documents(strapi, 'api::class-announcement.class-announcement').findMany({
    filters: {
      class: {
        documentId: classDocumentId,
      },
      documentId: announcementDocumentId,
    },
    limit: 1,
  });

  return announcements[0];
};

const publicClassSummary = (
  classRecord: DocumentRecord,
  enrollments: DocumentRecord[],
  permissions: ReturnType<typeof classPermissions>
) => ({
  ...summarizeClass(classRecord),
  actions: permissions,
  counts: classCounts(classRecord, enrollments),
});

const optionPayload = (record: DocumentRecord) => ({
  documentId: getDocumentId(record) || '',
  label: String(record.name || record.displayTitle || record.title || record.slug || 'Untitled'),
  state: record.courseState || record.moduleState || record.materialState || record.state || null,
  subtitle: [record.version, record.slug, record.sector].filter(Boolean).join(' - ') || null,
});

const normalizeClassData = (input: z.infer<typeof classInputSchema> | Partial<z.infer<typeof classInputSchema>>) => {
  const data: Record<string, unknown> = {};
  const directFields = [
    'capacity',
    'completionDeadline',
    'currency',
    'discountedPricePence',
    'displayTitle',
    'employerInterviewAvailabilityThresholdPercentage',
    'endDate',
    'includedItems',
    'interestThresholdPercentage',
    'interviewCapacityContingencyPercentage',
    'interviewGuaranteeDeadline',
    'interviewsGuaranteed',
    'level',
    'moduleSummary',
    'modulesPassCriteriaAttached',
    'minimumViableCapacity',
    'name',
    'officialClassCode',
    'openingMode',
    'overview',
    'pricePence',
    'region',
    'remoteInterviewsAllowed',
    'requirements',
    'scheduledEnrollmentOpenAt',
    'scheduleNotes',
    'sector',
    'slug',
    'startDate',
    'state',
    'year',
    'yearSequenceNumber',
  ] as const;

  directFields.forEach((field) => {
    if (typeof input[field] !== 'undefined') {
      const value = input[field];
      data[field] = value === '' || value === null ? null : value;
    }
  });

  if (input.courseDocumentId) {
    data.course = {
      connect: [{ documentId: input.courseDocumentId }],
    };
  }

  if (input.classAreaDocumentId) {
    data.classArea = {
      connect: [{ documentId: input.classAreaDocumentId }],
    };
  }

  if (input.workSectorDocumentId) {
    data.workSector = {
      connect: [{ documentId: input.workSectorDocumentId }],
    };
  }

  return data;
};

const recordClassAudit = async ({
  classRecord,
  context,
  eventType,
  metadata,
  newState,
  previousState,
  session,
  strapi,
}: {
  classRecord: DocumentRecord;
  context: RequestContext;
  eventType: string;
  metadata?: Record<string, unknown>;
  newState?: unknown;
  previousState?: unknown;
  session: AdminSession;
  strapi: StrapiService;
}) => {
  await auditEvents(strapi).record({
    actorDisplayName: session.user.displayName,
    actorEmail: session.user.email,
    actorId: session.user.id,
    actorType: 'admin',
    eventCategory: 'course',
    eventType,
    ipAddress: context.ipAddress,
    metadata,
    newState,
    previousState,
    requestId: context.requestId,
    serviceName: context.serviceName,
    source: 'admin_dashboard',
    subjectDisplayName: String(classLabel(classRecord)),
    subjectId: getDocumentId(classRecord),
    subjectType: 'class',
    userAgent: context.userAgent,
  });
};

const publishClassAdminChange = (strapi: StrapiService, classDocumentId?: string) =>
  publishAdminRealtimeEvent(
    {
      channels: ['operations'],
      resourceKey: classDocumentId,
      resourceType: 'class',
      type: 'classes_changed',
    },
    strapi.log
  );

const publishClassCandidateChanges = async (
  strapi: StrapiService,
  classRecord: DocumentRecord,
  enrollments: DocumentRecord[],
  eventType:
    | 'class_announcement_deleted'
    | 'class_announcement_posted'
    | 'class_announcement_updated'
    | 'class_state_changed' = 'class_state_changed'
) => {
  const classDocumentId = getDocumentId(classRecord);

  if (!classDocumentId) {
    return;
  }

  await publishClassRealtimeEvent(
    {
      classDocumentId,
      type: eventType,
    },
    strapi.log
  );
  await Promise.all(
    enrollments.map((enrollment) => {
      const candidateDocumentId = getDocumentId(enrollment.candidate);

      if (!candidateDocumentId) {
        return Promise.resolve();
      }

      return publishCandidateClassRealtimeEvent(
        {
          candidateDocumentId,
          classDocumentId,
          type: eventType,
        },
        strapi.log
      );
    })
  );
};

const requestNotificationServiceEmail = async ({
  correlationId,
  subject,
  template,
  to,
  type,
}: {
  correlationId?: string;
  subject: string;
  template: {
    key: string;
    variables: Record<string, unknown>;
  };
  to: string;
  type: string;
}): Promise<NotificationServiceQueueResponse | undefined> => {
  const baseUrl = process.env.NOTIFICATION_SERVICE_URL;
  const serviceToken = process.env.NOTIFICATION_SERVICE_TOKEN;

  if (!baseUrl || !serviceToken) {
    return undefined;
  }

  const controller = new AbortController();
  const timeout = setTimeout(controller.abort.bind(controller), 5000);

  try {
    const response = await fetch(`${trimTrailingSlash(baseUrl)}/api/internal/notifications/email`, {
      body: JSON.stringify({
        correlationId,
        priority: 'normal',
        source: 'core-api',
        subject,
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
    const payload = (await response.json().catch(() => null)) as NotificationServiceQueueResponse | null;

    return response.ok && payload?.data ? payload : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
};

const candidateDashboardClassUrl = () =>
  `${trimTrailingSlash(process.env.CANDIDATE_DASHBOARD_PUBLIC_URL || 'https://dash.hireflip.work')}/class`;

const notifyEnrollmentOpened = async ({
  classRecord,
  enrollment,
  requestContext,
  strapi,
}: {
  classRecord: DocumentRecord;
  enrollment: DocumentRecord;
  requestContext: RequestContext;
  strapi: StrapiService;
}) => {
  const candidate = enrollment.candidate;
  const candidateDocumentId = getDocumentId(candidate);
  const classDocumentId = getDocumentId(classRecord);
  const className = classLabel(classRecord);
  const subject = `${className} enrollment is open`;
  const bodyLines = [
    `Enrollment is open for ${className}.`,
    'Open your HireFlip dashboard to reserve a place and continue to checkout.',
  ];
  const emailQueueResult =
    typeof candidate?.email === 'string'
      ? await requestNotificationServiceEmail({
          correlationId: `${classDocumentId}:${candidateDocumentId}:enrollment_open`,
          subject,
          template: {
            key: 'generic_branded_message',
            variables: {
              bodyLines,
              ctaLabel: 'Open class dashboard',
              ctaUrl: candidateDashboardClassUrl(),
              heading: subject,
              subject,
            },
          },
          to: candidate.email,
          type: 'candidate_class_enrollment_opened',
        })
      : undefined;

  await documents(strapi, 'api::notification-event.notification-event').create({
    data: {
      candidate: candidateDocumentId
        ? {
            connect: [{ documentId: candidateDocumentId }],
          }
        : undefined,
      channel: 'email',
      class: classDocumentId
        ? {
            connect: [{ documentId: classDocumentId }],
          }
        : undefined,
      deliveryState: emailQueueResult?.data?.queued === true ? 'queued' : 'failed',
      eventType: 'candidate.class_enrollment_opened',
      metadata: {
        class: summarizeClass(classRecord),
        notificationServiceJobId:
          typeof emailQueueResult?.data?.jobId === 'string'
            ? emailQueueResult.data.jobId
            : undefined,
        requestId: requestContext.requestId,
        url: candidateDashboardClassUrl(),
      },
      priority: 'normal',
      recipientEmail: candidate?.email,
      recipientId: candidateDocumentId,
      recipientType: 'candidate',
      relatedId: classDocumentId,
      relatedType: 'class',
      templateKey: 'candidate_class_enrollment_opened',
    },
  });
};

const openEnrollmentForClass = async ({
  classRecord,
  requestContext,
  session,
  strapi,
}: {
  classRecord: DocumentRecord;
  requestContext: RequestContext;
  session: AdminSession;
  strapi: StrapiService;
}) => {
  const now = new Date().toISOString();
  const previousState = summarizeClass(classRecord);
  const openingCapacityReservation = createOpeningCapacityReservation(classRecord);
  const updatedClass = await documents(strapi, 'api::class.class').update({
    documentId: getDocumentId(classRecord),
    data: {
      automaticOpeningReadinessStatus: 'opened',
      enrollmentOpenedAt: classRecord.enrollmentOpenedAt || now,
      enrollmentOpenedBy: session.user.displayName,
      openedAt: classRecord.openedAt || now,
      openingCapacityReservation,
      openingCapacityReservationState: 'reserved',
      openingReadinessCheckedAt: classRecord.openingReadinessCheckedAt || now,
      openingReadinessStatus: 'opened',
      scheduledEnrollmentOpenAt: classRecord.scheduledEnrollmentOpenAt || null,
      state: 'open',
    },
    populate: classPopulate,
  });
  const interestedEnrollments = await findAllDocuments(strapi, 'api::enrollment.enrollment', {
    filters: {
      class: {
        documentId: getDocumentId(classRecord),
      },
      enrollmentState: 'interest_registered',
    },
    populate: enrollmentPopulate,
  });
  const openedEnrollments = await Promise.all(
    interestedEnrollments.map((enrollment) =>
      documents(strapi, 'api::enrollment.enrollment').update({
        documentId: getDocumentId(enrollment),
        data: {
          invitedToJoinAt: enrollment.invitedToJoinAt || now,
          paymentStatus: 'pending',
          enrollmentState: 'enrollment_open',
          metadata: {
            ...objectValue(enrollment.metadata),
            enrollmentOpenedAt: now,
            enrollmentOpenedByAdminId: session.user.id,
          },
        },
        populate: enrollmentPopulate,
      })
    )
  );

  await Promise.all(
    openedEnrollments.map((enrollment) =>
      notifyEnrollmentOpened({
        classRecord: updatedClass,
        enrollment,
        requestContext,
        strapi,
      })
    )
  );
  await recordClassAudit({
    classRecord: updatedClass,
    context: requestContext,
    eventType: 'admin.class_enrollment_opened',
    metadata: {
      openedEnrollmentCount: openedEnrollments.length,
      openingCapacityReservation,
    },
    newState: summarizeClass(updatedClass),
    previousState,
    session,
    strapi,
  });
  await publishClassAdminChange(strapi, getDocumentId(updatedClass));
  await publishClassCandidateChanges(strapi, updatedClass, openedEnrollments);

  return updatedClass;
};

const lifecycleTarget: Record<string, { eventType: string; state: string }> = {
  archive: {
    eventType: 'admin.class_archived',
    state: 'archived',
  },
  cancel: {
    eventType: 'admin.class_cancelled',
    state: 'cancelled',
  },
  close_enrollment: {
    eventType: 'admin.class_enrollment_closed',
    state: 'full',
  },
  mark_completed: {
    eventType: 'admin.class_completed_override',
    state: 'completed',
  },
  open_completion_window: {
    eventType: 'admin.class_completion_window_opened',
    state: 'completion_window',
  },
  open_interview_window: {
    eventType: 'admin.class_interview_window_opened',
    state: 'interview_window',
  },
  open_waitlist: {
    eventType: 'admin.class_waitlist_opened',
    state: 'waitlist_open',
  },
  start_class: {
    eventType: 'admin.class_started',
    state: 'in_progress',
  },
};

const updateEnrollmentsForClassStart = async (
  strapi: StrapiService,
  classRecord: DocumentRecord,
  session: AdminSession
) => {
  const now = new Date().toISOString();
  const enrollments = await findAllDocuments(strapi, 'api::enrollment.enrollment', {
    filters: {
      class: {
        documentId: getDocumentId(classRecord),
      },
      enrollmentState: 'enrolled',
    },
    populate: enrollmentPopulate,
  });

  return Promise.all(
    enrollments.map((enrollment) =>
      documents(strapi, 'api::enrollment.enrollment').update({
        documentId: getDocumentId(enrollment),
        data: {
          beganClassAt: enrollment.beganClassAt || now,
          enrollmentState: 'in_class',
          metadata: {
            ...objectValue(enrollment.metadata),
            classStartedByAdminId: session.user.id,
          },
        },
        populate: enrollmentPopulate,
      })
    )
  );
};

const courseSetupForClass = async (strapi: StrapiService, classRecord: DocumentRecord) => {
  const courseDocumentId = getDocumentId(classRecord.course);

  if (!courseDocumentId) {
    return {
      course: null,
      materials: [],
      modules: [],
      sections: [],
      tests: [],
    };
  }

  const [courses, sections, courseTests] = await Promise.all([
    documents(strapi, 'api::course.course').findMany({
      filters: {
        documentId: courseDocumentId,
      },
      limit: 1,
    }),
    findAllDocuments(strapi, 'api::course-section.course-section', {
      filters: {
        course: {
          documentId: courseDocumentId,
        },
      },
      sort: ['sortOrder:asc', 'createdAt:asc'],
    }),
    findAllDocuments(strapi, 'api::course-test.course-test', {
      filters: {
        course: {
          documentId: courseDocumentId,
        },
      },
      sort: ['createdAt:asc'],
    }),
  ]);
  const sectionDocumentIds = sections.map(getDocumentId).filter((documentId): documentId is string => Boolean(documentId));
  const modules = sectionDocumentIds.length
    ? await findAllDocuments(strapi, 'api::course-module.course-module', {
        filters: {
          courseSection: {
            documentId: {
              $in: sectionDocumentIds,
            },
          },
        },
        populate: ['courseSection'],
        sort: ['sortOrder:asc', 'createdAt:asc'],
      })
    : [];
  const moduleDocumentIds = modules.map(getDocumentId).filter((documentId): documentId is string => Boolean(documentId));
  const [materials, moduleTests] = await Promise.all([
    moduleDocumentIds.length
      ? findAllDocuments(strapi, 'api::course-material.course-material', {
          filters: {
            module: {
              documentId: {
                $in: moduleDocumentIds,
              },
            },
          },
          populate: ['module'],
          sort: ['sortOrder:asc', 'createdAt:asc'],
        })
      : [],
    moduleDocumentIds.length
      ? findAllDocuments(strapi, 'api::course-test.course-test', {
          filters: {
            courseModule: {
              documentId: {
                $in: moduleDocumentIds,
              },
            },
          },
          populate: ['courseModule'],
          sort: ['createdAt:asc'],
        })
      : [],
  ]);

  return {
    course: courses[0]
      ? {
          courseState: courses[0].courseState || null,
          description: courses[0].description || null,
          documentId: getDocumentId(courses[0]),
          name: courses[0].name || null,
          sourceType: courses[0].sourceType || null,
          version: courses[0].version || null,
      }
      : null,
    sections: sections.map((section) => ({
      description: section.description || null,
      documentId: getDocumentId(section),
      required: section.required === true,
      sectionState: section.sectionState || null,
      sortOrder: section.sortOrder ?? 0,
      title: section.title || null,
    })),
    materials: materials.map((material) => ({
      completionMode: material.completionMode || null,
      documentId: getDocumentId(material),
      estimatedDurationMinutes: material.estimatedDurationMinutes ?? null,
      materialState: material.materialState || null,
      materialType: material.materialType || null,
      moduleDocumentId: getDocumentId(material.module),
      required: material.required === true,
      requiredCompletionPercentage: material.requiredCompletionPercentage ?? null,
      sortOrder: material.sortOrder ?? 0,
      title: material.title || null,
    })),
    modules: modules.map((module) => ({
      description: module.description || null,
      documentId: getDocumentId(module),
      moduleState: module.moduleState || null,
      required: module.required === true,
      sectionDocumentId: getDocumentId(module.courseSection),
      sortOrder: module.sortOrder ?? 0,
      title: module.title || null,
    })),
    tests: [...courseTests, ...moduleTests].map((test) => ({
      attemptLimit: test.attemptLimit ?? null,
      courseModuleDocumentId: getDocumentId(test.courseModule),
      description: test.description || null,
      documentId: getDocumentId(test),
      passMark: test.passMark ?? null,
      testState: test.testState || null,
      timeLimitMinutes: test.timeLimitMinutes ?? null,
      title: test.title || null,
    })),
  };
};

const calculateClassOpeningReadiness = async ({
  classRecord,
  enrollments,
  strapi,
}: {
  classRecord: DocumentRecord;
  enrollments: DocumentRecord[];
  strapi: StrapiService;
}) => {
  const classDocumentId = getDocumentId(classRecord);
  const counts = classCounts(classRecord, enrollments);
  const capacity = Math.max(1, integerValue(classRecord.capacity, 1));
  const minimumViableCapacity = Math.min(
    capacity,
    Math.max(1, integerValue(classRecord.minimumViableCapacity, 1))
  );
  const candidateDemand = classDemandCount(counts);
  const demandMeetsMinimum = candidateDemand >= minimumViableCapacity;
  const blockerKeys: string[] = [];
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (!getDocumentId(classRecord.classArea)) {
    blockerKeys.push('class_area');
    blockers.push('Class operating region is missing.');
  }

  if (!getDocumentId(classRecord.workSector)) {
    blockerKeys.push('work_sector');
    blockers.push('Class work sector is missing.');
  }

  if (!getDocumentId(classRecord.course)) {
    blockerKeys.push('course_setup');
    blockers.push('Course is not linked.');
  }

  const courseSetup = await courseSetupForClass(strapi, classRecord);

  if (getDocumentId(classRecord.course) && !courseSetupIsComplete(courseSetup)) {
    blockerKeys.push('course_setup');
    blockers.push('Course setup must include sections, modules, materials, and tests.');
  }

  if (classRecord.modulesPassCriteriaAttached !== true) {
    blockerKeys.push('course_setup');
    blockers.push('Module pass criteria are not attached.');
  }

  if (!classRecord.currency) {
    blockerKeys.push('payment_config');
    blockers.push('Class currency is missing.');
  }

  if (typeof classRecord.pricePence !== 'number' && typeof classRecord.discountedPricePence !== 'number') {
    blockerKeys.push('payment_config');
    blockers.push('Class price is missing.');
  }

  if (
    classRecord.startDate &&
    classRecord.endDate &&
    Date.parse(classRecord.endDate) < Date.parse(classRecord.startDate)
  ) {
    blockerKeys.push('dates');
    blockers.push('Class end date is before the start date.');
  }

  if (!demandMeetsMinimum) {
    blockerKeys.push('minimum_viable_capacity');
    blockers.push(
      `Candidate demand is ${candidateDemand}/${minimumViableCapacity} minimum viable class size.`
    );
  } else if (candidateDemand < capacity) {
    warnings.push(`Candidate demand is ${candidateDemand}/${capacity}; class is not at full capacity.`);
  }

  const supply = classDocumentId
    ? await interviewRequestService(strapi).checkClassInterviewSupply({ classDocumentId })
    : {
        availableInterviewCapacity: 0,
        capacityShortfall: 0,
        contingencyPercentage: 0,
        eligibleEmployerCount: 0,
        employerCapacityBreakdown: [],
        ready: false,
        requiredInterviewCapacity: 0,
        reason: 'Class has not been created yet.',
      };

  if (!supply.ready) {
    blockerKeys.push('employer_capacity');
    blockers.push(supply.reason || 'Employer interview capacity is below the required level.');
  }

  const uniqueBlockerKeys = Array.from(new Set(blockerKeys));
  const uniqueBlockers = Array.from(new Set(blockers));
  const ready = uniqueBlockerKeys.length === 0;
  const category = ready
    ? 'ready'
    : uniqueBlockerKeys.includes('employer_capacity')
      ? 'needs_employer_capacity'
      : uniqueBlockerKeys.includes('course_setup')
        ? 'needs_course_setup'
        : 'blocked';
  const checkedAt = new Date().toISOString();

  return {
    automaticOpeningReadinessStatus: ready ? 'ready' : 'not_ready',
    openingReadinessCheckedAt: checkedAt,
    openingReadinessStatus: ready ? 'ready' : 'blocked',
    openingReadinessSummary: {
      availableInterviewCapacity: supply.availableInterviewCapacity,
      blockerKeys: uniqueBlockerKeys,
      blockers: uniqueBlockers,
      capacity,
      candidateDemand,
      category,
      checkedAt,
      contingencyPercentage: supply.contingencyPercentage ?? null,
      demandMeetsMinimum,
      eligibleEmployerCount: supply.eligibleEmployerCount ?? 0,
      employerCapacityBreakdown: Array.isArray(supply.employerCapacityBreakdown)
        ? supply.employerCapacityBreakdown
        : [],
      minimumViableCapacity,
      ready,
      reason: ready ? null : uniqueBlockers[0] || supply.reason || 'Class opening readiness is blocked.',
      requiredInterviewCapacity: supply.requiredInterviewCapacity,
      shortfallByRegion: supply.capacityShortfall || 0,
      warnings,
    },
  };
};

const updateClassOpeningReadiness = async ({
  classRecord,
  enrollments,
  strapi,
}: {
  classRecord: DocumentRecord;
  enrollments: DocumentRecord[];
  strapi: StrapiService;
}) => {
  const classDocumentId = getDocumentId(classRecord);

  if (!classDocumentId) {
    return classRecord;
  }

  const readiness = await calculateClassOpeningReadiness({
    classRecord,
    enrollments,
    strapi,
  });

  return documents(strapi, 'api::class.class').update({
    documentId: classDocumentId,
    data: readiness,
    populate: classPopulate,
  });
};

const readinessAllowsOpening = (classRecord: DocumentRecord) => {
  const summary = readinessSummary(classRecord);
  return classRecord.openingReadinessStatus === 'ready' ||
    classRecord.automaticOpeningReadinessStatus === 'ready' ||
    summary.ready === true;
};

const shouldOpenByMode = (classRecord: DocumentRecord, enrollments: DocumentRecord[], now: number) => {
  const openingMode = classRecord.openingMode || 'manual_readiness';

  if (openingMode === 'manual_readiness' || openingMode === 'admin_immediate') {
    return false;
  }

  if (openingMode === 'admin_scheduled') {
    return Boolean(
      classRecord.scheduledEnrollmentOpenAt &&
      Date.parse(String(classRecord.scheduledEnrollmentOpenAt)) <= now
    );
  }

  if (classRecord.scheduledEnrollmentOpenAt && Date.parse(String(classRecord.scheduledEnrollmentOpenAt)) > now) {
    return false;
  }

  if (openingMode === 'automatic' || openingMode === 'automatic_when_ready') {
    return true;
  }

  if (openingMode !== 'automatic_at_capacity') {
    return false;
  }

  const capacity = Math.max(1, integerValue(classRecord.capacity, 1));
  const counts = classCounts(classRecord, enrollments);

  return counts.capacityHeld + counts.interestRegistered >= capacity;
};

const createOpeningCapacityReservation = (classRecord: DocumentRecord) => {
  const summary = readinessSummary(classRecord);
  const breakdown = Array.isArray(summary.employerCapacityBreakdown)
    ? summary.employerCapacityBreakdown.map(objectValue)
    : [];
  let remaining = integerValue(summary.requiredInterviewCapacity, 0);
  const allocations: Array<Record<string, unknown>> = [];

  for (const employerCapacity of breakdown) {
    if (remaining <= 0) {
      break;
    }

    const available = integerValue(employerCapacity.available, 0);
    const reserved = Math.min(available, remaining);

    if (reserved <= 0 || !employerCapacity.employerDocumentId) {
      continue;
    }

    allocations.push({
      contactDocumentId: employerCapacity.contactDocumentId || null,
      contactEmail: employerCapacity.contactEmail || null,
      employerDocumentId: employerCapacity.employerDocumentId,
      employerName: employerCapacity.employerName || null,
      reserved,
    });
    remaining -= reserved;
  }

  return {
    allocations,
    classDocumentId: getDocumentId(classRecord),
    createdAt: new Date().toISOString(),
    requiredInterviewCapacity: integerValue(summary.requiredInterviewCapacity, 0),
    unallocated: Math.max(0, remaining),
  };
};

const shouldAutoOpenClass = (classRecord: DocumentRecord, enrollments: DocumentRecord[], now: number) => {
  return shouldOpenByMode(classRecord, enrollments, now) && readinessAllowsOpening(classRecord);
};

export default ({ strapi }: { strapi: StrapiService }) => ({
  async listClasses(input: unknown, requestContext: RequestContext = {}) {
    const body = validateList(input);
    const session = await assertClassViewSession(strapi, body.sessionToken, requestContext);
    const permissions = classPermissions(session);
    const classDocuments = documents(strapi, 'api::class.class');
    const filters = classListFilters(body);
    const [filteredTotal, openCount, totalCount] = await Promise.all([
      classDocuments.count({ filters }),
      classDocuments.count({ filters: { state: 'open' } }),
      classDocuments.count({ filters: {} }),
    ]);
    const pageCount = Math.max(1, Math.ceil(filteredTotal / body.pageSize));
    const page = Math.min(body.page, pageCount);
    const visibleClasses = await classDocuments.findMany({
      filters,
      limit: body.pageSize,
      populate: classPopulate,
      sort: classListSort(body.sortBy, body.sortDirection),
      start: (page - 1) * body.pageSize,
    });
    const classDocumentIds = visibleClasses.map(getDocumentId).filter((documentId): documentId is string => Boolean(documentId));
    const enrollments = await findEnrollmentsForClasses(strapi, classDocumentIds);
    const enrollmentsByClass = groupEnrollmentsByClass(enrollments);
    const aggregateCapacity = visibleClasses.reduce((total, classRecord) => total + integerValue(classRecord.capacity, 0), 0);
    const aggregateCapacityHeld = visibleClasses.reduce(
      (total, classRecord) =>
        total + classCounts(classRecord, enrollmentsByClass.get(getDocumentId(classRecord) || '') || []).capacityHeld,
      0
    );

    return {
      classes: visibleClasses.map((classRecord) =>
        publicClassSummary(
          classRecord,
          enrollmentsByClass.get(getDocumentId(classRecord) || '') || [],
          permissions
        )
      ),
      counts: {
        capacity: aggregateCapacity,
        capacityHeld: aggregateCapacityHeld,
        filtered: filteredTotal,
        open: openCount,
        total: totalCount,
      },
      generatedAt: new Date().toISOString(),
      pagination: {
        page,
        pageCount,
        pageSize: body.pageSize,
        total: filteredTotal,
      },
      user: session.user,
    };
  },

  async getClassDetail(input: unknown, requestContext: RequestContext = {}) {
    const body = validateDetail(input);
    const session = await assertClassViewSession(strapi, body.sessionToken, requestContext);
    const permissions = classPermissions(session);
    const classRecord = await findClassByDocumentId(strapi, body.classDocumentId);

    if (!classRecord) {
      throw new ValidationError('Class could not be found.');
    }

    const enrollments = await findEnrollmentsForClasses(strapi, [body.classDocumentId]);
    const enrollmentDocumentIds = enrollments.map(getDocumentId).filter((documentId): documentId is string => Boolean(documentId));
    const refreshedClass = await updateClassOpeningReadiness({
      classRecord,
      enrollments,
      strapi,
    });
    const [reservationsByEnrollment, paymentsByEnrollment, progressByEnrollment, courseSetup, announcements] = await Promise.all([
      findReservationsForEnrollments(strapi, enrollmentDocumentIds),
      findPaymentsForEnrollments(strapi, enrollmentDocumentIds),
      findCourseProgressForEnrollments(strapi, enrollmentDocumentIds),
      courseSetupForClass(strapi, refreshedClass),
      findClassAnnouncements(strapi, body.classDocumentId),
    ]);
    const courseItemKeys = setupItemKeys(courseSetup);

    return {
      announcements: announcements.map(publicClassAnnouncement),
      class: publicClassSummary(refreshedClass, enrollments, permissions),
      courseSetup,
      enrollments: enrollments.map((enrollment) =>
        publicEnrollment({
          classRecord: refreshedClass,
          courseItemKeys,
          enrollment,
          payment: paymentsByEnrollment.get(getDocumentId(enrollment) || ''),
          permissions,
          progressRecords: progressByEnrollment.get(getDocumentId(enrollment) || '') || [],
          reservation: reservationsByEnrollment.get(getDocumentId(enrollment) || ''),
        })
      ),
      generatedAt: new Date().toISOString(),
      user: session.user,
    };
  },

  async getClassOptions(input: unknown, requestContext: RequestContext = {}) {
    const body = validateOptions(input);
    const session = await assertClassManageSession(strapi, body.sessionToken, requestContext);
    const [courses, classAreas, workSectors] = await Promise.all([
      findAllDocuments(strapi, 'api::course.course', {
        sort: ['name:asc'],
      }),
      findAllDocuments(strapi, 'api::class-area.class-area', {
        sort: ['name:asc'],
      }),
      findAllDocuments(strapi, 'api::work-sector.work-sector', {
        sort: ['name:asc'],
      }),
    ]);

    return {
      classAreas: classAreas.map(optionPayload),
      courses: courses.map(optionPayload),
      generatedAt: new Date().toISOString(),
      user: session.user,
      workSectors: workSectors.map(optionPayload),
    };
  },

  async createClass(input: unknown, requestContext: RequestContext = {}) {
    const body = validateCreate(input);
    const session = await assertClassManageSession(strapi, body.sessionToken, requestContext);
    const classRecord = await documents(strapi, 'api::class.class').create({
      data: normalizeClassData(body.class),
      populate: classPopulate,
    });
    const refreshedClass = await updateClassOpeningReadiness({
      classRecord,
      enrollments: [],
      strapi,
    });

    await recordClassAudit({
      classRecord: refreshedClass,
      context: requestContext,
      eventType: 'admin.class_created',
      newState: summarizeClass(refreshedClass),
      session,
      strapi,
    });
    await publishClassAdminChange(strapi, getDocumentId(refreshedClass));

    return {
      class: publicClassSummary(refreshedClass, [], classPermissions(session)),
      created: true,
      user: session.user,
    };
  },

  async updateClass(input: unknown, requestContext: RequestContext = {}) {
    const body = validateUpdate(input);
    const session = await assertClassManageSession(strapi, body.sessionToken, requestContext);
    const existingClass = await findClassByDocumentId(strapi, body.classDocumentId);

    if (!existingClass) {
      throw new ValidationError('Class could not be found.');
    }

    if (
      body.class.state &&
      ['cancelled', 'completed'].includes(body.class.state) &&
      !session.user.roleKeys.includes('super_admin')
    ) {
      throw new ForbiddenError('Super Admin access is required for cancellation or completion overrides.');
    }

    const updatedClass = await documents(strapi, 'api::class.class').update({
      documentId: body.classDocumentId,
      data: normalizeClassData(body.class),
      populate: classPopulate,
    });
    const enrollments = await findEnrollmentsForClasses(strapi, [body.classDocumentId]);
    const refreshedClass = await updateClassOpeningReadiness({
      classRecord: updatedClass,
      enrollments,
      strapi,
    });

    await recordClassAudit({
      classRecord: refreshedClass,
      context: requestContext,
      eventType: 'admin.class_updated',
      newState: summarizeClass(refreshedClass),
      previousState: summarizeClass(existingClass),
      session,
      strapi,
    });
    await publishClassAdminChange(strapi, body.classDocumentId);
    await publishClassCandidateChanges(strapi, refreshedClass, enrollments);

    return {
      class: publicClassSummary(refreshedClass, enrollments, classPermissions(session)),
      updated: true,
      user: session.user,
    };
  },

  async postClassAnnouncement(input: unknown, requestContext: RequestContext = {}) {
    const body = validatePostAnnouncement(input);
    const session = await assertClassManageSession(strapi, body.sessionToken, requestContext);
    const classRecord = await findClassByDocumentId(strapi, body.classDocumentId);

    if (!classRecord) {
      throw new ValidationError('Class could not be found.');
    }

    const now = new Date().toISOString();
    const visibleFrom =
      body.visibleFrom || (body.announcementState === 'published' ? now : undefined);
    const announcement = await documents(strapi, 'api::class-announcement.class-announcement').create({
      data: {
        announcementState: body.announcementState,
        body: body.body,
        class: {
          connect: [{ documentId: body.classDocumentId }],
        },
        expiresAt: body.expiresAt || null,
        metadata: {
          requestId: requestContext.requestId,
          source: 'admin_dashboard',
        },
        postedByStaffDisplayName: session.user.displayName,
        postedByStaffEmail: session.user.email,
        postedByStaffUserId: session.user.id,
        priority: body.priority,
        title: body.title,
        visibleFrom: visibleFrom || null,
      },
    });
    const enrollments = await findEnrollmentsForClasses(strapi, [body.classDocumentId]);

    await recordClassAudit({
      classRecord,
      context: requestContext,
      eventType: 'admin.class_announcement_posted',
      metadata: {
        announcementDocumentId: getDocumentId(announcement),
        announcementState: body.announcementState,
        expiresAt: body.expiresAt,
        priority: body.priority,
        visibleFrom,
      },
      newState: publicClassAnnouncement(announcement),
      session,
      strapi,
    });
    await publishClassAdminChange(strapi, body.classDocumentId);

    if (body.announcementState === 'published') {
      await publishClassCandidateChanges(
        strapi,
        classRecord,
        enrollments,
        'class_announcement_posted'
      );
    }

    return {
      announcement: publicClassAnnouncement(announcement),
      created: true,
      user: session.user,
    };
  },

  async updateClassAnnouncement(input: unknown, requestContext: RequestContext = {}) {
    const body = validateUpdateAnnouncement(input);
    const session = await assertClassManageSession(strapi, body.sessionToken, requestContext);
    const [classRecord, existingAnnouncement] = await Promise.all([
      findClassByDocumentId(strapi, body.classDocumentId),
      findClassAnnouncementByDocumentId(strapi, body.classDocumentId, body.announcementDocumentId),
    ]);

    if (!classRecord) {
      throw new ValidationError('Class could not be found.');
    }

    if (!existingAnnouncement || existingAnnouncement.announcementState === 'archived') {
      throw new ValidationError('Class announcement could not be found.');
    }

    const updatedAnnouncement = await documents(strapi, 'api::class-announcement.class-announcement').update({
      documentId: body.announcementDocumentId,
      data: {
        announcementState: body.announcementState,
        body: body.body,
        expiresAt: body.expiresAt || null,
        metadata: {
          ...objectValue(existingAnnouncement.metadata),
          lastUpdatedAt: new Date().toISOString(),
          lastUpdatedByStaffUserId: session.user.id,
          lastUpdatedRequestId: requestContext.requestId,
          source: 'admin_dashboard',
        },
        priority: body.priority,
        title: body.title,
        visibleFrom: body.visibleFrom || null,
      },
    });
    const enrollments = await findEnrollmentsForClasses(strapi, [body.classDocumentId]);

    await recordClassAudit({
      classRecord,
      context: requestContext,
      eventType: 'admin.class_announcement_updated',
      metadata: {
        announcementDocumentId: body.announcementDocumentId,
        announcementState: body.announcementState,
        expiresAt: body.expiresAt,
        priority: body.priority,
        visibleFrom: body.visibleFrom,
      },
      newState: publicClassAnnouncement(updatedAnnouncement),
      previousState: publicClassAnnouncement(existingAnnouncement),
      session,
      strapi,
    });
    await publishClassAdminChange(strapi, body.classDocumentId);

    if (
      existingAnnouncement.announcementState === 'published' ||
      updatedAnnouncement.announcementState === 'published'
    ) {
      await publishClassCandidateChanges(
        strapi,
        classRecord,
        enrollments,
        'class_announcement_updated'
      );
    }

    return {
      announcement: publicClassAnnouncement(updatedAnnouncement),
      updated: true,
      user: session.user,
    };
  },

  async deleteClassAnnouncement(input: unknown, requestContext: RequestContext = {}) {
    const body = validateDeleteAnnouncement(input);
    const session = await assertClassManageSession(strapi, body.sessionToken, requestContext);
    const [classRecord, existingAnnouncement] = await Promise.all([
      findClassByDocumentId(strapi, body.classDocumentId),
      findClassAnnouncementByDocumentId(strapi, body.classDocumentId, body.announcementDocumentId),
    ]);

    if (!classRecord) {
      throw new ValidationError('Class could not be found.');
    }

    if (!existingAnnouncement || existingAnnouncement.announcementState === 'archived') {
      throw new ValidationError('Class announcement could not be found.');
    }

    const archivedAnnouncement = await documents(strapi, 'api::class-announcement.class-announcement').update({
      documentId: body.announcementDocumentId,
      data: {
        announcementState: 'archived',
        metadata: {
          ...objectValue(existingAnnouncement.metadata),
          archivedAt: new Date().toISOString(),
          archivedByStaffUserId: session.user.id,
          archivedRequestId: requestContext.requestId,
          source: 'admin_dashboard',
        },
      },
    });
    const enrollments = await findEnrollmentsForClasses(strapi, [body.classDocumentId]);

    await recordClassAudit({
      classRecord,
      context: requestContext,
      eventType: 'admin.class_announcement_deleted',
      metadata: {
        announcementDocumentId: body.announcementDocumentId,
      },
      newState: publicClassAnnouncement(archivedAnnouncement),
      previousState: publicClassAnnouncement(existingAnnouncement),
      session,
      strapi,
    });
    await publishClassAdminChange(strapi, body.classDocumentId);

    if (existingAnnouncement.announcementState === 'published') {
      await publishClassCandidateChanges(
        strapi,
        classRecord,
        enrollments,
        'class_announcement_deleted'
      );
    }

    return {
      announcement: publicClassAnnouncement(archivedAnnouncement),
      deleted: true,
      user: session.user,
    };
  },

  async updateClassLifecycle(input: unknown, requestContext: RequestContext = {}) {
    const body = validateLifecycle(input);
    const session = ['cancel', 'mark_completed'].includes(body.action)
      ? await assertSuperAdminSession(strapi, body.sessionToken, requestContext)
      : await assertClassManageSession(strapi, body.sessionToken, requestContext);
    const existingClass = await findClassByDocumentId(strapi, body.classDocumentId);

    if (!existingClass) {
      throw new ValidationError('Class could not be found.');
    }

    if (body.action === 'open_enrollment') {
      const enrollmentsBeforeOpen = await findEnrollmentsForClasses(strapi, [body.classDocumentId]);
      const readinessClass = await updateClassOpeningReadiness({
        classRecord: existingClass,
        enrollments: enrollmentsBeforeOpen,
        strapi,
      });
      const canOverrideReadiness = session.user.roleKeys.includes('super_admin');
      const readyToOpen = readinessAllowsOpening(readinessClass);

      if (!readyToOpen && !canOverrideReadiness) {
        const summary = readinessSummary(readinessClass);
        throw new ValidationError(
          typeof summary.reason === 'string'
            ? summary.reason
            : 'Class opening readiness is blocked.'
        );
      }

      if (!readyToOpen && canOverrideReadiness && !body.reason) {
        throw new ValidationError('A Super Admin override reason is required to open a blocked class.');
      }

      if (!readyToOpen && canOverrideReadiness) {
        await recordClassAudit({
          classRecord: readinessClass,
          context: requestContext,
          eventType: 'admin.class_opening_readiness_override_used',
          metadata: {
            reason: body.reason,
            readiness: readinessSummary(readinessClass),
          },
          session,
          strapi,
        });
      }

      const openedClass = await openEnrollmentForClass({
        classRecord: readinessClass,
        requestContext,
        session,
        strapi,
      });
      const enrollments = await findEnrollmentsForClasses(strapi, [body.classDocumentId]);

      return {
        class: publicClassSummary(openedClass, enrollments, classPermissions(session)),
        updated: true,
        user: session.user,
      };
    }

    const target = lifecycleTarget[body.action];

    if (!target) {
      throw new ValidationError('Unsupported class lifecycle action.');
    }

    const now = new Date().toISOString();
    const updatedClass = await documents(strapi, 'api::class.class').update({
      documentId: body.classDocumentId,
      data: {
        ...(target.state === 'cancelled' || target.state === 'completed' || target.state === 'archived'
          ? { closedAt: now }
          : {}),
        ...(target.state === 'in_progress' ? { openedAt: existingClass.openedAt || now } : {}),
        state: target.state,
      },
      populate: classPopulate,
    });
    const changedEnrollments = body.action === 'start_class'
      ? await updateEnrollmentsForClassStart(strapi, updatedClass, session)
      : [];
    const enrollments = await findEnrollmentsForClasses(strapi, [body.classDocumentId]);

    await recordClassAudit({
      classRecord: updatedClass,
      context: requestContext,
      eventType: target.eventType,
      metadata: {
        reason: body.reason,
        updatedEnrollmentCount: changedEnrollments.length,
      },
      newState: summarizeClass(updatedClass),
      previousState: summarizeClass(existingClass),
      session,
      strapi,
    });
    await publishClassAdminChange(strapi, body.classDocumentId);
    await publishClassCandidateChanges(strapi, updatedClass, enrollments);

    return {
      class: publicClassSummary(updatedClass, enrollments, classPermissions(session)),
      updated: true,
      user: session.user,
    };
  },

  async reconcileScheduledClassOpenings(limit = 100, requestContext: RequestContext = {}) {
    const serviceSession: AdminSession = {
      user: {
        displayName: 'Class workflow',
        email: 'system@hireflip.work',
        id: 'class-workflow',
        roleKeys: ['super_admin'],
        roles: ['System'],
      },
    };
    const now = Date.now();
    const classes = await documents(strapi, 'api::class.class').findMany({
      filters: {
        openingMode: {
          $in: ['admin_scheduled', 'automatic', 'automatic_when_ready', 'automatic_at_capacity'],
        },
        state: {
          $in: ['draft', 'coming_soon', 'waitlist_open'],
        },
      },
      limit,
      populate: classPopulate,
      sort: ['scheduledEnrollmentOpenAt:asc', 'createdAt:asc'],
    });
    const classDocumentIds = classes.map(getDocumentId).filter((documentId): documentId is string => Boolean(documentId));
    const enrollments = await findEnrollmentsForClasses(strapi, classDocumentIds);
    const enrollmentsByClass = groupEnrollmentsByClass(enrollments);
    const opened: string[] = [];

    for (const classRecord of classes) {
      const classDocumentId = getDocumentId(classRecord);
      const classEnrollments = enrollmentsByClass.get(classDocumentId || '') || [];

      if (!classDocumentId) {
        continue;
      }

      try {
        const readinessClass = await updateClassOpeningReadiness({
          classRecord,
          enrollments: classEnrollments,
          strapi,
        });
        const readiness = readinessSummary(readinessClass);
        const statusChanged = readinessClass.openingReadinessStatus !== classRecord.openingReadinessStatus;

        if (!readinessAllowsOpening(readinessClass)) {
          if (statusChanged) {
            await auditEvents(strapi).record({
              actorType: 'system',
              eventCategory: 'course',
              eventType: 'class.opening_readiness_blocked',
              metadata: {
                readiness,
                source: 'scheduled_class_opening',
              },
              requestId: requestContext.requestId,
              serviceName: requestContext.serviceName,
              severity: readiness.blockerKeys && Array.isArray(readiness.blockerKeys)
                ? 'warning'
                : 'info',
              source: 'core_api',
              subjectDisplayName: classRecord.displayTitle || classRecord.name || classDocumentId,
              subjectId: classDocumentId,
              subjectType: 'class',
            });
          }
          continue;
        }

        if (statusChanged) {
          await auditEvents(strapi).record({
            actorType: 'system',
            eventCategory: 'course',
            eventType: 'class.opening_readiness_passed',
            metadata: {
              readiness,
              source: 'scheduled_class_opening',
            },
            requestId: requestContext.requestId,
            serviceName: requestContext.serviceName,
            severity: 'info',
            source: 'core_api',
            subjectDisplayName: classRecord.displayTitle || classRecord.name || classDocumentId,
            subjectId: classDocumentId,
            subjectType: 'class',
          });
        }

        if (!shouldAutoOpenClass(readinessClass, classEnrollments, now)) {
          continue;
        }

        const openedClass = await openEnrollmentForClass({
          classRecord: readinessClass,
          requestContext,
          session: serviceSession,
          strapi,
        });
        opened.push(getDocumentId(openedClass) || classDocumentId);
      } catch (error) {
        strapi.log?.error?.('Scheduled class opening failed.', error);
      }
    }

    return {
      checked: classes.length,
      opened,
    };
  },
});

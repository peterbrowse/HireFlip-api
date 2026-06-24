import { factories } from '@strapi/strapi';
import { errors, validateZodSchema, z } from '@strapi/utils';
import { addWorkingDays, subtractWorkingDays } from '../../../utils/working-days';

const { ValidationError } = errors;

type RequestContext = {
  ipAddress?: string;
  requestId?: string;
  serviceName?: string;
  userAgent?: string;
};

type DocumentRecord = Record<string, unknown> & {
  candidate?: DocumentRecord;
  class?: DocumentRecord;
  classArea?: DocumentRecord;
  claimCount?: number;
  claimState?: string;
  commitmentMode?: string;
  contactRole?: string;
  contactState?: string;
  coverageRegions?: DocumentRecord[];
  createdAt?: string;
  dashboardOnboardingState?: string;
  documentId?: string;
  email?: string;
  employer?: DocumentRecord;
  employerContact?: DocumentRecord;
  employerDetailsReminderCount?: number;
  employerDetailsDueAt?: string;
  employerDetailsEscalatedAt?: string;
  employerDetailsReleaseEligibleAt?: string;
  employerDetailsReleasedAt?: string;
  employerFeedbackReminderCount?: number;
  employerResponseReminderCount?: number;
  employerState?: string;
  endTime?: string;
  enrollment?: DocumentRecord;
  expiresAt?: string;
  firstName?: string;
  fulfilledInterviewCount?: number;
  id?: number | string;
  insufficientCapacityDetectedAt?: string;
  initialInterviewCommitmentCadence?: string;
  initialInterviewCommitmentVolume?: number;
  interviewRequest?: DocumentRecord;
  interviewCommitmentCadence?: string;
  interviewCommitmentVolume?: number;
  interviewCoverageOverrideAt?: string;
  interviewCoverageOverrideByEmail?: string;
  interviewCoverageOverrideByName?: string;
  interviewCoverageOverrideReason?: string;
  interviewGuaranteeDeadline?: string;
  interviewsGuaranteed?: number;
  lastName?: string;
  lastEmployerResponseReminderSentAt?: string;
  lastEmployerDetailsReminderSentAt?: string;
  lastEmployerFeedbackReminderSentAt?: string;
  metadata?: unknown;
  name?: string;
  operatingRegions?: DocumentRecord[];
  profileState?: string;
  region?: DocumentRecord;
  regionCommitments?: DocumentRecord[];
  requestState?: string;
  requiredSlotCount?: number;
  responseSlaWorkingDays?: number;
  releaseNote?: string;
  releaseReason?: string;
  scheduledStartTime?: string;
  scheduledEndTime?: string;
  slug?: string;
  slotOffer?: DocumentRecord;
  slotOffers?: DocumentRecord[];
  slots?: DocumentRecord[];
  slotState?: string;
  startTime?: string;
  title?: string;
  updatedAt?: string;
  availability?: string;
  completedAt?: string;
  feedbackDueAt?: string;
  feedbackOverdueDetectedAt?: string;
  workSector?: DocumentRecord;
};

type DocumentCollection = {
  create(input: Record<string, unknown>): Promise<DocumentRecord>;
  findMany(input: Record<string, unknown>): Promise<DocumentRecord[]>;
  update(input: Record<string, unknown>): Promise<DocumentRecord>;
};

type StrapiDocumentService = {
  documents(uid: string): unknown;
  log?: {
    error?: (message: string, error?: unknown) => void;
  };
  service(uid: string): unknown;
};

type AuditEventService = {
  record(input: Record<string, unknown>): Promise<unknown>;
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

const ensureForEnrollmentSchema = z
  .object({
    enrollmentDocumentId: z.string().trim().min(1).max(120),
    source: z.string().trim().max(160).optional().transform((value) => value || undefined),
  })
  .strict();

const classSupplySchema = z
  .object({
    classDocumentId: z.string().trim().min(1).max(120),
  })
  .strict();

const markSubmittedSchema = z
  .object({
    capacityClaimDocumentId: z.string().trim().min(1).max(120),
    interviewSlotOfferDocumentId: z.string().trim().min(1).max(120),
  })
  .strict();

const releaseCapacityClaimSchema = z
  .object({
    capacityClaimDocumentId: z.string().trim().min(1).max(120),
    releaseNote: z.string().trim().max(1000).optional().transform((value) => value || undefined),
    releaseReason: z
      .enum([
        'employer_declined',
        'contact_reschedule_requested',
        'no_availability',
        'wrong_region',
        'role_paused',
        'contact_unavailable',
        'capacity_changed',
        'candidate_declined_slots',
        'expired',
        'admin_released',
        'request_cancelled',
        'capacity_rebalanced',
        'other',
      ])
      .default('employer_declined'),
    releasedByEmployerContactDocumentId: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

const validateEnsureForEnrollment = validateZodSchema(ensureForEnrollmentSchema);
const validateClassSupply = validateZodSchema(classSupplySchema);
const validateMarkSubmitted = validateZodSchema(markSubmittedSchema);
const validateReleaseCapacityClaim = validateZodSchema(releaseCapacityClaimSchema);

const consumingClaimStates = ['held', 'notified', 'accepted', 'fulfilled'];
const routedRequestStates = [
  'capacity_claimed',
  'employer_notified',
  'slot_options_submitted',
  'candidate_reviewing',
  'candidate_selected',
  'fulfilled',
];
const openRequestStates = [
  'pending_profile',
  'pending_availability',
  'pending_capacity',
  'capacity_claimed',
  'employer_notified',
  'slot_options_submitted',
  'candidate_reviewing',
  'candidate_selected',
  'manual_review',
];
const openCandidateOfferStates = ['submitted', 'sent'];
const reusableSlotTopUpPurpose = 'reusable_slot_top_up';
const reusableSlotAssignmentSource = 'reusable_slot_pool';

const documents = (strapi: StrapiDocumentService, uid: string) =>
  strapi.documents(uid) as unknown as DocumentCollection;

const auditEvents = (strapi: StrapiDocumentService) =>
  strapi.service('api::audit-event.audit-event') as unknown as AuditEventService;

const getDocumentId = (record?: DocumentRecord | null) =>
  typeof record?.documentId === 'string' ? record.documentId : undefined;

const objectValue = (value: unknown) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const documentRecordValue = (value: unknown): DocumentRecord | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as DocumentRecord)
    : undefined;

const sortSlotsByStartTime = (slots: unknown) =>
  (Array.isArray(slots) ? slots : [])
    .filter((slot): slot is DocumentRecord => Boolean(slot && typeof slot === 'object'))
    .sort((left, right) => String(left.startTime || '').localeCompare(String(right.startTime || '')));

const relationConnect = (record?: unknown) => {
  const documentRecord = documentRecordValue(record);

  return documentRecord?.documentId
    ? {
        connect: [{ documentId: documentRecord.documentId }],
      }
    : undefined;
};

const getIntegerEnv = (name: string, fallback: number) => {
  const value = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

const candidateDashboardInterviewUrl = () =>
  `${trimTrailingSlash(process.env.CANDIDATE_DASHBOARD_BASE_URL || 'http://localhost:3001')}/interviews`;

const employerDashboardAvailabilityUrl = (claimDocumentId?: string) =>
  `${trimTrailingSlash(process.env.EMPLOYER_DASHBOARD_BASE_URL || 'http://localhost:3004')}/availability${
    claimDocumentId ? `/${claimDocumentId}` : ''
  }`;

const employerDashboardInterviewUrl = (interviewDocumentId?: string) =>
  `${trimTrailingSlash(process.env.EMPLOYER_DASHBOARD_BASE_URL || 'http://localhost:3004')}/interviews${
    interviewDocumentId ? `/${interviewDocumentId}` : ''
  }`;

const employerCapacityClaimReminderIntervalMs = () =>
  getIntegerEnv('EMPLOYER_CAPACITY_CLAIM_REMINDER_INTERVAL_HOURS', 12) * 60 * 60 * 1000;

const employerCapacityClaimReminderMax = () =>
  getIntegerEnv('EMPLOYER_CAPACITY_CLAIM_REMINDER_MAX', 4);

const employerInterviewDetailsReminderIntervalMs = () =>
  getIntegerEnv('EMPLOYER_INTERVIEW_DETAILS_REMINDER_INTERVAL_HOURS', 12) * 60 * 60 * 1000;

const employerInterviewDetailsReminderMax = () =>
  getIntegerEnv('EMPLOYER_INTERVIEW_DETAILS_REMINDER_MAX', 4);

const employerFeedbackReminderIntervalMs = () =>
  getIntegerEnv('EMPLOYER_INTERVIEW_FEEDBACK_REMINDER_INTERVAL_HOURS', 48) * 60 * 60 * 1000;

const employerFeedbackDueDays = () => getIntegerEnv('EMPLOYER_INTERVIEW_FEEDBACK_DUE_DAYS', 7);

const integerValue = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : fallback;
};

const boundedInteger = (value: unknown, fallback: number, min: number, max: number) =>
  Math.min(max, Math.max(min, integerValue(value, fallback) || fallback));

const displayName = (record?: DocumentRecord | null) =>
  [record?.firstName, record?.lastName].filter(Boolean).join(' ').trim() ||
  String(record?.name || record?.email || record?.documentId || '').trim();

const validDate = (value?: string | Date | null) => {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);

  return Number.isFinite(date.getTime()) ? date : null;
};

const addCalendarDays = (value: string | Date, days: number) => {
  const date = validDate(value) || new Date();
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + Math.max(0, Math.floor(days)));
  return next;
};

const detailDueWindowForInterview = (interview: DocumentRecord, from: string | Date = new Date()) => {
  const fromDate = validDate(from) || new Date();
  const scheduledStart = validDate(interview.scheduledStartTime);
  const twoWorkingDays = addWorkingDays(fromDate, 2) || fromDate;
  let dueDays = 2;

  if (scheduledStart) {
    const minimumNoticeCutoff = subtractWorkingDays(scheduledStart, 4);

    if (minimumNoticeCutoff && twoWorkingDays.getTime() > minimumNoticeCutoff.getTime()) {
      dueDays = 1;
    }
  }

  const dueAt = addWorkingDays(fromDate, dueDays) || fromDate;
  const extraDay = addWorkingDays(dueAt, 1) || dueAt;
  let releaseEligibleAt = extraDay;

  if (scheduledStart) {
    const minimumNoticeCutoff = subtractWorkingDays(scheduledStart, 4);

    if (minimumNoticeCutoff && extraDay.getTime() > minimumNoticeCutoff.getTime()) {
      releaseEligibleAt = dueAt;
    }
  }

  return {
    dueAt: dueAt.toISOString(),
    dueDays,
    releaseEligibleAt: releaseEligibleAt.toISOString(),
  };
};

const interviewFeedbackDueAt = (interview: DocumentRecord) => {
  const existingDueAt = validDate(interview.feedbackDueAt);

  if (existingDueAt) {
    return existingDueAt.toISOString();
  }

  const reference =
    validDate(interview.scheduledEndTime) ||
    validDate(interview.completedAt) ||
    validDate(interview.scheduledStartTime) ||
    validDate(interview.createdAt) ||
    new Date();

  return addCalendarDays(reference, employerFeedbackDueDays()).toISOString();
};

const requestNotificationServiceEmail = async ({
  correlationId,
  subject,
  template,
  to,
  type,
}: {
  correlationId?: string;
  subject?: string;
  template?: NotificationTemplatePayload;
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
        priority: 'critical',
        source: 'core-api',
        ...(subject ? { subject } : {}),
        ...(template ? { template } : {}),
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

const cadencePeriodStart = (cadence: string, now = new Date()) => {
  const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1, 0, 0, 0, 0));

  if (cadence === 'quarterly') {
    start.setUTCMonth(Math.floor(now.getUTCMonth() / 3) * 3);
  } else if (cadence === 'biannually') {
    start.setUTCMonth(now.getUTCMonth() < 6 ? 0 : 6);
  }

  return start;
};

const regionDocumentIds = (records?: DocumentRecord[]) =>
  new Set((records || []).map(getDocumentId).filter((documentId): documentId is string => Boolean(documentId)));

const contactCoversRegion = (contact: DocumentRecord, regionDocumentId: string) =>
  regionDocumentIds(contact.coverageRegions).has(regionDocumentId);

const activeContacts = (employer: DocumentRecord) =>
  (employer.contacts as DocumentRecord[] | undefined || []).filter(
    (contact) => contact.contactState === 'active'
  );

const leadContact = (contacts: DocumentRecord[]) =>
  contacts.find((contact) => contact.contactRole === 'lead_contact') || contacts[0];

const operatingRegionIds = (employer: DocumentRecord) => regionDocumentIds(employer.operatingRegions);

const snapshotSlot = (slot: DocumentRecord) => ({
  assignedContactDocumentId: getDocumentId(slot.employerContact) || null,
  documentId: getDocumentId(slot) || null,
  endTime: slot.endTime || null,
  locationDetails: slot.locationDetails || null,
  locationType: slot.locationType || 'to_be_confirmed',
  meetingUrl: slot.meetingUrl || null,
  slotState: slot.slotState || null,
  startTime: slot.startTime || null,
});

const snapshotOfferSlots = async (
  strapi: StrapiDocumentService,
  offer?: DocumentRecord | null,
  requestContext: RequestContext = {}
) => {
  const offerDocumentId = getDocumentId(offer);
  const existingMetadata = objectValue(offer?.metadata);

  if (!offerDocumentId || Array.isArray(existingMetadata.historicalSlotsSnapshot)) {
    return;
  }

  const slots = sortSlotsByStartTime(offer?.slots);

  await documents(strapi, 'api::interview-slot-offer.interview-slot-offer').update({
    documentId: offerDocumentId,
    data: {
      metadata: {
        ...existingMetadata,
        historicalSlotsSnapshot: slots.map(snapshotSlot),
        historicalSlotsSnapshotAt: new Date().toISOString(),
        historicalSlotsSnapshotRequestId: requestContext.requestId,
      },
    },
  });
};

const commitmentForEmployer = (employer: DocumentRecord, regionDocumentId: string) => {
  if (employer.commitmentMode === 'per_region') {
    const commitment = (employer.regionCommitments || []).find(
      (record) =>
        record.commitmentState === 'active' &&
        getDocumentId(record.region) === regionDocumentId &&
        integerValue(record.interviewCommitmentVolume) > 0
    );

    if (!commitment) {
      return null;
    }

    return {
      cadence: String(commitment.interviewCommitmentCadence || 'quarterly'),
      mode: 'per_region',
      volume: integerValue(commitment.interviewCommitmentVolume),
    };
  }

  const volume = integerValue(employer.interviewCommitmentVolume);
  const cadence = String(employer.interviewCommitmentCadence || 'not_set');

  if (!volume || cadence === 'not_set') {
    return null;
  }

  return {
    cadence,
    mode: 'global',
    volume,
  };
};

const candidatePrerequisites = async (
  strapi: StrapiDocumentService,
  candidateDocumentId?: string
) => {
  if (!candidateDocumentId) {
    return {
      availabilitySubmitted: false,
      profileComplete: false,
    };
  }

  const profiles = await documents(strapi, 'api::candidate-profile.candidate-profile').findMany({
    filters: {
      candidate: {
        documentId: candidateDocumentId,
      },
      profileState: 'completed',
    },
    limit: 1,
    sort: ['completedAt:desc', 'updatedAt:desc', 'createdAt:desc'],
  });
  const profile = profiles[0];

  return {
    availabilitySubmitted: Boolean(String(profile?.availability || '').trim()),
    profileComplete: Boolean(profile),
  };
};

const findEnrollment = async (strapi: StrapiDocumentService, enrollmentDocumentId: string) => {
  const enrollments = await documents(strapi, 'api::enrollment.enrollment').findMany({
    filters: {
      documentId: enrollmentDocumentId,
    },
    limit: 1,
    populate: {
      candidate: true,
      class: {
        populate: ['classArea'],
      },
    },
  });

  return enrollments[0] || null;
};

const findOpenRequestForEnrollment = async (
  strapi: StrapiDocumentService,
  enrollmentDocumentId: string
) => {
  const requests = await documents(strapi, 'api::interview-request.interview-request').findMany({
    filters: {
      enrollment: {
        documentId: enrollmentDocumentId,
      },
      requestState: {
        $in: openRequestStates,
      },
    },
    limit: 1,
    populate: ['candidate', 'class', 'region'],
    sort: ['createdAt:desc'],
  });

  return requests[0] || null;
};

const findActiveClaimsForRequest = async (
  strapi: StrapiDocumentService,
  requestDocumentId: string
) =>
  documents(strapi, 'api::employer-capacity-claim.employer-capacity-claim').findMany({
    filters: {
      interviewRequest: {
        documentId: requestDocumentId,
      },
      claimState: {
        $in: consumingClaimStates,
      },
    },
    limit: 100,
    populate: ['employer', 'employerContact', 'region'],
    sort: ['createdAt:asc'],
  });

const findAllClaimsForRequest = async (
  strapi: StrapiDocumentService,
  requestDocumentId: string
) =>
  documents(strapi, 'api::employer-capacity-claim.employer-capacity-claim').findMany({
    filters: {
      interviewRequest: {
        documentId: requestDocumentId,
      },
    },
    limit: 100,
    populate: ['employer', 'employerContact', 'region'],
    sort: ['createdAt:asc'],
  });

const activeTopUpClaimsForRequest = async (
  strapi: StrapiDocumentService,
  requestDocumentId: string
) => {
  const claims = await documents(strapi, 'api::employer-capacity-claim.employer-capacity-claim').findMany({
    filters: {
      claimState: {
        $in: ['held', 'notified', 'accepted'],
      },
      interviewRequest: {
        documentId: requestDocumentId,
      },
    },
    limit: 25,
    populate: ['employer', 'employerContact', 'region'],
    sort: ['createdAt:asc'],
  });

  return claims.filter((claim) => objectValue(claim.metadata).purpose === reusableSlotTopUpPurpose);
};

const findSlotOfferForNotification = async (
  strapi: StrapiDocumentService,
  offerDocumentId: string
) => {
  const offers = await documents(strapi, 'api::interview-slot-offer.interview-slot-offer').findMany({
    filters: {
      documentId: offerDocumentId,
    },
    limit: 1,
    populate: {
      candidate: true,
      employer: true,
      employerContact: true,
      enrollment: {
        populate: ['class'],
      },
      interviewRequest: {
        populate: ['class', 'region'],
      },
      slots: {
        populate: ['employerContact'],
      },
    },
  });

  return offers[0] || null;
};

const queueCandidateSlotOfferNotification = async ({
  offerDocumentId,
  requestContext,
  responseDeadline,
  strapi,
}: {
  offerDocumentId: string;
  requestContext: RequestContext;
  responseDeadline: string;
  strapi: StrapiDocumentService;
}) => {
  const offer = await findSlotOfferForNotification(strapi, offerDocumentId);
  const candidate = offer?.candidate;
  const candidateDocumentId = getDocumentId(candidate);
  const dashboardUrl = candidateDashboardInterviewUrl();

  if (!offer || !candidateDocumentId) {
    return {
      emailQueued: false,
      smsQueued: false,
    };
  }

  const candidateName = candidate?.firstName || 'there';
  const notificationPreferences = objectValue(candidate?.notificationPreferences);
  const channelPreferences = objectValue(notificationPreferences.channels);
  const emailAllowed = Boolean(candidate?.email) && channelPreferences.email !== false;
  const smsAllowed = Boolean(candidate?.phone) && channelPreferences.sms === true;
  const subject = 'Your interview slots are ready to review';
  const bodyLines = [
    `Hi ${candidateName},`,
    'Your interview slot options are ready to review in your HireFlip dashboard.',
    'Please review all available options before deciding. You have 2 working days to respond.',
  ];
  const emailQueueResult =
    emailAllowed && typeof candidate?.email === 'string'
      ? await requestNotificationServiceEmail({
          correlationId: offerDocumentId,
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
          type: 'candidate_interview_slot_options_ready',
        })
      : undefined;
  const smsQueueResult =
    smsAllowed && typeof candidate?.phone === 'string'
      ? await requestNotificationServiceSms({
          body: `HireFlip: your interview slots are ready. Review them within 2 working days: ${dashboardUrl}`,
          correlationId: offerDocumentId,
          to: candidate.phone,
          type: 'candidate_interview_slot_options_ready',
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
  const enrollment = documentRecordValue(offer.enrollment);
  const classRecord = documentRecordValue(enrollment?.class);

  await Promise.all(
    channels.map(({ channel, deliveryState, jobId, recipientPhone }) =>
      documents(strapi, 'api::notification-event.notification-event').create({
        data: {
          candidate: {
            connect: [{ documentId: candidateDocumentId }],
          },
          channel,
          class: classRecord?.documentId
            ? {
                connect: [{ documentId: classRecord.documentId }],
              }
            : undefined,
          deliveryState,
          eventType: 'candidate.interview_slot_options_ready',
          interview: undefined,
          metadata: {
            candidateResponseDeadline: responseDeadline,
            dashboardUrl,
            employerDocumentId: getDocumentId(offer.employer) || null,
            interviewSlotOfferDocumentId: offerDocumentId,
            notificationServiceJobId: typeof jobId === 'string' ? jobId : undefined,
            requestId: requestContext.requestId,
            slotCount: Array.isArray(offer.slots) ? offer.slots.length : undefined,
          },
          priority: 'urgent',
          recipientEmail: candidate.email,
          recipientId: candidateDocumentId,
          recipientPhone,
          recipientType: 'candidate',
          relatedId: offerDocumentId,
          relatedType: 'interview_slot_offer',
          templateKey: channel === 'email' ? 'generic_branded_message' : undefined,
        },
      })
    )
  );

  return {
    emailQueued: emailQueueResult?.data?.queued === true,
    smsQueued: smsQueueResult?.data?.queued === true,
  };
};

const classWorkSectorDocumentId = (request?: DocumentRecord | null) =>
  getDocumentId(documentRecordValue(documentRecordValue(request?.class)?.workSector));

const interviewReadySortValue = (request: DocumentRecord) => {
  const metadata = objectValue(request.metadata);
  const lastEnsureAt = typeof metadata.lastEnsureAt === 'string' ? Date.parse(metadata.lastEnsureAt) : Number.NaN;
  const lastRoutedAt = request.lastRoutedAt ? Date.parse(String(request.lastRoutedAt)) : Number.NaN;
  const createdAt = request.createdAt ? Date.parse(String(request.createdAt)) : Number.NaN;

  if (!Number.isNaN(lastEnsureAt)) {
    return lastEnsureAt;
  }

  if (!Number.isNaN(lastRoutedAt)) {
    return lastRoutedAt;
  }

  return Number.isNaN(createdAt) ? Number.MAX_SAFE_INTEGER : createdAt;
};

const guaranteeDeadlineSortValue = (request: DocumentRecord) => {
  const enrollment = documentRecordValue(request.enrollment);
  const candidates = [
    enrollment?.interviewGuaranteeDeadline,
    documentRecordValue(request.class)?.interviewGuaranteeDeadline,
  ]
    .map((value) => (value ? Date.parse(String(value)) : Number.NaN))
    .filter((value) => !Number.isNaN(value));

  return candidates.length ? Math.min(...candidates) : Number.MAX_SAFE_INTEGER;
};

const requestHasOpenCandidateOffer = (request: DocumentRecord) =>
  (Array.isArray(request.slotOffers) ? request.slotOffers : []).some((offer) =>
    openCandidateOfferStates.includes(String(offer.offerState || ''))
  );

const selectedEmployerIdsForRequest = async (
  strapi: StrapiDocumentService,
  request: DocumentRecord
) => {
  const candidateDocumentId = getDocumentId(request.candidate);
  const enrollmentDocumentId = getDocumentId(request.enrollment);

  if (!candidateDocumentId) {
    return new Set<string>();
  }

  const interviews = await documents(strapi, 'api::interview.interview').findMany({
    filters: {
      candidate: {
        documentId: candidateDocumentId,
      },
      ...(enrollmentDocumentId
        ? {
            enrollment: {
              documentId: enrollmentDocumentId,
            },
          }
        : {}),
      interviewState: {
        $in: ['awaiting_employer_details', 'candidate_selected', 'confirmed', 'completed'],
      },
    },
    limit: 100,
    populate: ['employer'],
  });

  return new Set(
    interviews
      .map((interview) => getDocumentId(interview.employer))
      .filter((documentId): documentId is string => Boolean(documentId))
  );
};

const reusableSlotFilters = (regionDocumentId: string, workSectorDocumentId?: string) => ({
  region: {
    documentId: regionDocumentId,
  },
  slotState: 'available',
  startTime: {
    $gte: addWorkingDays(new Date(), 4).toISOString(),
  },
  ...(workSectorDocumentId
    ? {
        workSector: {
          documentId: workSectorDocumentId,
        },
      }
    : {}),
});

const findReusableSlots = async ({
  excludedCandidateId,
  excludedEmployerIds = new Set<string>(),
  excludedRequestId,
  limit = 100,
  regionDocumentId,
  strapi,
  workSectorDocumentId,
}: {
  excludedCandidateId?: string;
  excludedEmployerIds?: Set<string>;
  excludedRequestId?: string;
  limit?: number;
  regionDocumentId: string;
  strapi: StrapiDocumentService;
  workSectorDocumentId?: string;
}) => {
  const slots = await documents(strapi, 'api::interview-slot.interview-slot').findMany({
    filters: reusableSlotFilters(regionDocumentId, workSectorDocumentId),
    limit,
    populate: {
      employer: true,
      employerContact: true,
      region: true,
      slotOffer: {
        populate: ['candidate', 'interviewRequest', 'slots'],
      },
      workSector: true,
    },
    sort: ['startTime:asc', 'createdAt:asc'],
  });
  const seenStartTimes = new Set<string>();
  const reusableSlots: DocumentRecord[] = [];

  for (const slot of slots) {
    const employerDocumentId = getDocumentId(slot.employer);
    const startTime = String(slot.startTime || '');
    const sourceOffer = documentRecordValue(slot.slotOffer);
    const sourceOfferMetadata = objectValue(sourceOffer?.metadata);
    const sourceIsReusableTopUp =
      sourceOfferMetadata.reusableSlotTopUp === true ||
      sourceOfferMetadata.purpose === reusableSlotTopUpPurpose;
    const sourceCandidateDocumentId = getDocumentId(sourceOffer?.candidate);
    const sourceRequestDocumentId = getDocumentId(sourceOffer?.interviewRequest);

    if (
      !employerDocumentId ||
      excludedEmployerIds.has(employerDocumentId) ||
      (!sourceIsReusableTopUp && excludedCandidateId && sourceCandidateDocumentId === excludedCandidateId) ||
      (!sourceIsReusableTopUp && excludedRequestId && sourceRequestDocumentId === excludedRequestId) ||
      seenStartTimes.has(startTime)
    ) {
      continue;
    }

    seenStartTimes.add(startTime);
    reusableSlots.push(slot);
  }

  return reusableSlots;
};

const findReusableSlotCandidateRequests = async ({
  limit,
  regionDocumentId,
  strapi,
  workSectorDocumentId,
}: {
  limit: number;
  regionDocumentId: string;
  strapi: StrapiDocumentService;
  workSectorDocumentId?: string;
}) => {
  const requests = await documents(strapi, 'api::interview-request.interview-request').findMany({
    filters: {
      candidateVisibleState: {
        $in: ['arranging_interviews', 'blocked'],
      },
      region: {
        documentId: regionDocumentId,
      },
      requestState: {
        $in: ['pending_capacity', 'capacity_claimed', 'employer_notified', 'slot_options_submitted'],
      },
    },
    limit,
    populate: {
      candidate: true,
      class: {
        populate: ['workSector'],
      },
      enrollment: true,
      region: true,
      slotOffers: true,
    },
  });

  return requests
    .filter((request) =>
      workSectorDocumentId ? classWorkSectorDocumentId(request) === workSectorDocumentId : true
    )
    .filter((request) => !requestHasOpenCandidateOffer(request))
    .sort((left, right) => {
      const deadlineDiff = guaranteeDeadlineSortValue(left) - guaranteeDeadlineSortValue(right);

      if (deadlineDiff !== 0) {
        return deadlineDiff;
      }

      return interviewReadySortValue(left) - interviewReadySortValue(right);
    });
};

const activeEmployerContacts = (employer?: DocumentRecord | null) =>
  (Array.isArray(employer?.contacts) ? employer.contacts : []).filter(
    (contact) => !['archived', 'disabled'].includes(String(contact.contactState || ''))
  );

const leadEmployerContact = (employer?: DocumentRecord | null) =>
  activeEmployerContacts(employer).find((contact) => contact.contactRole === 'lead_contact') ||
  activeEmployerContacts(employer)[0] ||
  null;

const queueEmployerCapacityClaimReminderNotification = async ({
  claim,
  requestContext,
  strapi,
}: {
  claim: DocumentRecord;
  requestContext: RequestContext;
  strapi: StrapiDocumentService;
}) => {
  const employerContact = documentRecordValue(claim.employerContact);

  if (!employerContact?.email) {
    return {
      emailQueued: false,
    };
  }

  const claimDocumentId = getDocumentId(claim);
  const dashboardUrl = employerDashboardAvailabilityUrl(claimDocumentId);
  const subject = 'Reminder: interview availability is needed';
  const bodyLines = [
    `Hi ${employerContact.firstName || 'there'},`,
    'HireFlip is still waiting for three interview slot options for this candidate request.',
    'Please review the request in your employer dashboard before the response window closes.',
  ];
  const emailQueueResult = await requestNotificationServiceEmail({
    correlationId: claimDocumentId,
    subject,
    template: {
      key: 'generic_branded_message',
      variables: {
        bodyLines,
        ctaLabel: 'Review availability request',
        ctaUrl: dashboardUrl,
        heading: subject,
        subject,
      },
    },
    to: String(employerContact.email),
    type: 'employer_capacity_claim_response_reminder',
  });

  await documents(strapi, 'api::notification-event.notification-event').create({
    data: {
      channel: 'email',
      deliveryState: emailQueueResult?.data?.queued === true ? 'queued' : 'failed',
      employer: relationConnect(claim.employer),
      eventType: 'employer.capacity_claim_response_reminder',
      metadata: {
        capacityClaimDocumentId: claimDocumentId,
        dashboardUrl,
        employerResponseDeadline: claim.expiresAt || null,
        notificationServiceJobId:
          typeof emailQueueResult?.data?.jobId === 'string'
            ? emailQueueResult.data.jobId
            : undefined,
        reminderCount: integerValue(claim.employerResponseReminderCount) + 1,
        requestId: requestContext.requestId,
      },
      priority: 'urgent',
      recipientEmail: String(employerContact.email),
      recipientId: getDocumentId(employerContact),
      recipientType: 'employer_contact',
      relatedId: claimDocumentId,
      relatedType: 'employer_capacity_claim',
      templateKey: 'generic_branded_message',
    },
  });

  return {
    emailQueued: emailQueueResult?.data?.queued === true,
  };
};

const queueEmployerCapacityClaimExpiredLeadNotification = async ({
  claim,
  requestContext,
  strapi,
}: {
  claim: DocumentRecord;
  requestContext: RequestContext;
  strapi: StrapiDocumentService;
}) => {
  const leadContact = leadEmployerContact(claim.employer);
  const assignedContact = documentRecordValue(claim.employerContact);

  if (!leadContact?.email) {
    return {
      emailQueued: false,
    };
  }

  const claimDocumentId = getDocumentId(claim);
  const assignedName = assignedContact ? displayName(assignedContact) || 'A listed contact' : 'A listed contact';
  const dashboardUrl = employerDashboardAvailabilityUrl();
  const subject = 'Interview availability request expired';
  const bodyLines = [
    `Hi ${leadContact.firstName || 'there'},`,
    `${assignedName} let an interview availability request expire before submitting slot options.`,
    'HireFlip has released the capacity and will try to route the candidate to another eligible employer. Please review your SLA agreement and make sure future requests are covered on time.',
  ];
  const emailQueueResult = await requestNotificationServiceEmail({
    correlationId: claimDocumentId,
    subject,
    template: {
      key: 'generic_branded_message',
      variables: {
        bodyLines,
        ctaLabel: 'View availability requests',
        ctaUrl: dashboardUrl,
        heading: subject,
        subject,
      },
    },
    to: String(leadContact.email),
    type: 'employer_capacity_claim_expired_lead_warning',
  });

  await documents(strapi, 'api::notification-event.notification-event').create({
    data: {
      channel: 'email',
      deliveryState: emailQueueResult?.data?.queued === true ? 'queued' : 'failed',
      employer: relationConnect(claim.employer),
      eventType: 'employer.capacity_claim_expired_lead_warning',
      metadata: {
        assignedContactDocumentId: getDocumentId(assignedContact),
        capacityClaimDocumentId: claimDocumentId,
        dashboardUrl,
        employerResponseDeadline: claim.expiresAt || null,
        notificationServiceJobId:
          typeof emailQueueResult?.data?.jobId === 'string'
            ? emailQueueResult.data.jobId
            : undefined,
        requestId: requestContext.requestId,
      },
      priority: 'urgent',
      recipientEmail: String(leadContact.email),
      recipientId: getDocumentId(leadContact),
      recipientType: 'employer_contact',
      relatedId: claimDocumentId,
      relatedType: 'employer_capacity_claim',
      templateKey: 'generic_branded_message',
    },
  });

  return {
    emailQueued: emailQueueResult?.data?.queued === true,
  };
};

const queueEmployerInterviewDetailsReminderNotification = async ({
  interview,
  requestContext,
  strapi,
}: {
  interview: DocumentRecord;
  requestContext: RequestContext;
  strapi: StrapiDocumentService;
}) => {
  const employerContact = documentRecordValue(interview.employerContact);

  if (!employerContact?.email) {
    return {
      emailQueued: false,
    };
  }

  const interviewDocumentId = getDocumentId(interview);
  const dashboardUrl = employerDashboardInterviewUrl(interviewDocumentId);
  const candidate = documentRecordValue(interview.candidate);
  const candidateName = candidate ? displayName(candidate) || 'the candidate' : 'the candidate';
  const subject = 'Reminder: interview details need confirming';
  const bodyLines = [
    `Hi ${employerContact.firstName || 'there'},`,
    `${candidateName} has selected an interview slot and is waiting for the final location or joining instructions.`,
    'Please confirm the interview details in your HireFlip employer dashboard.',
  ];
  const emailQueueResult = await requestNotificationServiceEmail({
    correlationId: interviewDocumentId,
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
    type: 'employer_interview_details_reminder',
  });

  await documents(strapi, 'api::notification-event.notification-event').create({
    data: {
      channel: 'email',
      deliveryState: emailQueueResult?.data?.queued === true ? 'queued' : 'failed',
      employer: relationConnect(interview.employer),
      eventType: 'employer.interview_details_reminder',
      interview: relationConnect(interview),
      metadata: {
        dashboardUrl,
        interviewDocumentId,
        notificationServiceJobId:
          typeof emailQueueResult?.data?.jobId === 'string'
            ? emailQueueResult.data.jobId
            : undefined,
        reminderCount: integerValue(interview.employerDetailsReminderCount) + 1,
        requestId: requestContext.requestId,
      },
      priority: 'urgent',
      recipientEmail: String(employerContact.email),
      recipientId: getDocumentId(employerContact),
      recipientType: 'employer_contact',
      relatedId: interviewDocumentId,
      relatedType: 'interview',
      templateKey: 'generic_branded_message',
    },
  });

  return {
    emailQueued: emailQueueResult?.data?.queued === true,
  };
};

const createInterviewNotificationEvent = async ({
  eventType,
  interview,
  recipient,
  requestContext,
  result,
  strapi,
  templateKey = 'generic_branded_message',
  type,
}: {
  eventType: string;
  interview: DocumentRecord;
  recipient: DocumentRecord;
  requestContext: RequestContext;
  result?: NotificationServiceQueueResponse;
  strapi: StrapiDocumentService;
  templateKey?: string;
  type: string;
}) => {
  const interviewDocumentId = getDocumentId(interview);

  await documents(strapi, 'api::notification-event.notification-event').create({
    data: {
      channel: 'email',
      deliveryState: result?.data?.queued === true ? 'queued' : 'failed',
      employer: relationConnect(interview.employer),
      eventType,
      interview: relationConnect(interview),
      metadata: {
        interviewDocumentId,
        notificationServiceJobId:
          typeof result?.data?.jobId === 'string' ? result.data.jobId : undefined,
        requestId: requestContext.requestId,
        type,
      },
      priority: 'urgent',
      recipientEmail: String(recipient.email),
      recipientId: getDocumentId(recipient),
      recipientType: 'employer_contact',
      relatedId: interviewDocumentId,
      relatedType: 'interview',
      templateKey,
    },
  });
};

const queueEmployerInterviewDetailsLeadEscalationNotification = async ({
  interview,
  requestContext,
  strapi,
}: {
  interview: DocumentRecord;
  requestContext: RequestContext;
  strapi: StrapiDocumentService;
}) => {
  const employer = documentRecordValue(interview.employer);
  const leadContact = leadEmployerContact(employer);

  if (!leadContact?.email) {
    return {
      emailQueued: false,
    };
  }

  const interviewDocumentId = getDocumentId(interview);
  const dashboardUrl = employerDashboardInterviewUrl(interviewDocumentId);
  const candidate = documentRecordValue(interview.candidate);
  const candidateName = candidate ? displayName(candidate) || 'the candidate' : 'the candidate';
  const subject = 'Interview details are overdue';
  const bodyLines = [
    `Hi ${leadContact.firstName || 'there'},`,
    `${candidateName} selected an interview slot, but the final details have not been confirmed yet.`,
    'Please make sure the assigned interviewer confirms the details in the employer dashboard. If this is not completed in time, HireFlip may release and reroute the interview to protect the candidate.',
  ];
  const emailQueueResult = await requestNotificationServiceEmail({
    correlationId: interviewDocumentId,
    subject,
    template: {
      key: 'generic_branded_message',
      variables: {
        bodyLines,
        ctaLabel: 'Review interview',
        ctaUrl: dashboardUrl,
        heading: subject,
        subject,
      },
    },
    to: String(leadContact.email),
    type: 'employer_interview_details_overdue_lead_warning',
  });

  await createInterviewNotificationEvent({
    eventType: 'employer.interview_details_overdue_lead_warning',
    interview,
    recipient: leadContact,
    requestContext,
    result: emailQueueResult,
    strapi,
    type: 'employer_interview_details_overdue_lead_warning',
  });

  return {
    emailQueued: emailQueueResult?.data?.queued === true,
  };
};

const queueEmployerInterviewReleasedNotification = async ({
  interview,
  requestContext,
  strapi,
}: {
  interview: DocumentRecord;
  requestContext: RequestContext;
  strapi: StrapiDocumentService;
}) => {
  const assignedContact = documentRecordValue(interview.employerContact);
  const leadContact = leadEmployerContact(documentRecordValue(interview.employer));
  const recipients = [assignedContact, leadContact].filter(
    (contact, index, contacts): contact is DocumentRecord =>
      Boolean(contact?.email) &&
      contacts.findIndex((candidate) => candidate?.email === contact?.email) === index
  );
  const interviewDocumentId = getDocumentId(interview);
  const candidate = documentRecordValue(interview.candidate);
  const candidateName = candidate ? displayName(candidate) || 'the candidate' : 'the candidate';
  const subject = 'Interview released due to missing details';
  const results: NotificationServiceQueueResponse[] = [];

  for (const recipient of recipients) {
    const bodyLines = [
      `Hi ${recipient.firstName || 'there'},`,
      `${candidateName}'s interview has been released because the final interview details were not confirmed in time.`,
      'HireFlip will reroute the candidate to protect their interview guarantee. Please review your dashboard and respond promptly to future interview requests.',
    ];
    const emailQueueResult = await requestNotificationServiceEmail({
      correlationId: interviewDocumentId,
      subject,
      template: {
        key: 'generic_branded_message',
        variables: {
          bodyLines,
          ctaLabel: 'Open dashboard',
          ctaUrl: employerDashboardInterviewUrl(),
          heading: subject,
          subject,
        },
      },
      to: String(recipient.email),
      type: 'employer_interview_released_missing_details',
    });

    results.push(emailQueueResult || {});
    await createInterviewNotificationEvent({
      eventType: 'employer.interview_released_missing_details',
      interview,
      recipient,
      requestContext,
      result: emailQueueResult,
      strapi,
      type: 'employer_interview_released_missing_details',
    });
  }

  return {
    emailQueued: results.some((result) => result?.data?.queued === true),
  };
};

const queueEmployerFeedbackReminderNotification = async ({
  interview,
  requestContext,
  strapi,
}: {
  interview: DocumentRecord;
  requestContext: RequestContext;
  strapi: StrapiDocumentService;
}) => {
  const employerContact = documentRecordValue(interview.employerContact);

  if (!employerContact?.email) {
    return {
      emailQueued: false,
    };
  }

  const interviewDocumentId = getDocumentId(interview);
  const dashboardUrl = `${trimTrailingSlash(
    process.env.EMPLOYER_DASHBOARD_BASE_URL || 'http://localhost:3004'
  )}/feedback/${interviewDocumentId}`;
  const candidate = documentRecordValue(interview.candidate);
  const candidateName = candidate ? displayName(candidate) || 'the candidate' : 'the candidate';
  const subject = 'Reminder: interview feedback is due';
  const bodyLines = [
    `Hi ${employerContact.firstName || 'there'},`,
    `Please complete feedback for ${candidateName}'s interview.`,
    'Feedback helps HireFlip support the candidate and keeps the interview process moving.',
  ];
  const emailQueueResult = await requestNotificationServiceEmail({
    correlationId: interviewDocumentId,
    subject,
    template: {
      key: 'generic_branded_message',
      variables: {
        bodyLines,
        ctaLabel: 'Complete feedback',
        ctaUrl: dashboardUrl,
        heading: subject,
        subject,
      },
    },
    to: String(employerContact.email),
    type: 'employer_interview_feedback_reminder',
  });

  await createInterviewNotificationEvent({
    eventType: 'employer.interview_feedback_reminder',
    interview,
    recipient: employerContact,
    requestContext,
    result: emailQueueResult,
    strapi,
    type: 'employer_interview_feedback_reminder',
  });

  return {
    emailQueued: emailQueueResult?.data?.queued === true,
  };
};

const consumedClaimsForEmployer = async ({
  cadence,
  employerDocumentId,
  mode,
  regionDocumentId,
  strapi,
}: {
  cadence: string;
  employerDocumentId: string;
  mode: string;
  regionDocumentId: string;
  strapi: StrapiDocumentService;
}) => {
  const claims = await documents(strapi, 'api::employer-capacity-claim.employer-capacity-claim').findMany({
    filters: {
      claimState: {
        $in: consumingClaimStates,
      },
      createdAt: {
        $gte: cadencePeriodStart(cadence).toISOString(),
      },
      employer: {
        documentId: employerDocumentId,
      },
      ...(mode === 'per_region'
        ? {
            region: {
              documentId: regionDocumentId,
            },
          }
        : {}),
    },
    limit: 1000,
  });

  return claims.reduce((total, claim) => total + integerValue(claim.claimCount, 1), 0);
};

const eligibleEmployerCapacity = async (
  strapi: StrapiDocumentService,
  regionDocumentId: string,
  now = new Date()
) => {
  const employers = await documents(strapi, 'api::employer.employer').findMany({
    filters: {
      dashboardOnboardingState: 'complete',
      employerState: 'active',
    },
    limit: 1000,
    populate: {
      contacts: {
        populate: ['coverageRegions'],
      },
      operatingRegions: true,
      regionCommitments: {
        populate: ['region'],
      },
    },
    sort: ['companyName:asc', 'createdAt:asc'],
  });
  const eligible = [];

  for (const employer of employers) {
    const employerDocumentId = getDocumentId(employer);

    if (!employerDocumentId || !operatingRegionIds(employer).has(regionDocumentId)) {
      continue;
    }

    const contacts = activeContacts(employer);
    const coveredContacts = contacts.filter((contact) => contactCoversRegion(contact, regionDocumentId));
    const assignmentContact =
      coveredContacts.find((contact) => contact.contactRole === 'lead_contact') ||
      coveredContacts[0] ||
      (employer.interviewCoverageOverrideAt ? leadContact(contacts) : undefined);
    const assignmentContactDocumentId = getDocumentId(assignmentContact);

    if (!assignmentContact || !assignmentContactDocumentId) {
      continue;
    }

    const commitment = commitmentForEmployer(employer, regionDocumentId);

    if (!commitment) {
      continue;
    }

    const consumed = await consumedClaimsForEmployer({
      cadence: commitment.cadence,
      employerDocumentId,
      mode: commitment.mode,
      regionDocumentId,
      strapi,
    });
    const available = Math.max(0, commitment.volume - consumed);

    if (available <= 0) {
      continue;
    }

    eligible.push({
      available,
      consumed,
      employer,
      employerDocumentId,
      employerName: String(employer.companyName || employer.name || ''),
      contact: assignmentContact,
      contactDocumentId: assignmentContactDocumentId,
      contactEmail: assignmentContact.email,
      commitment,
      lastCalculatedAt: now.toISOString(),
    });
  }

  return eligible.sort((left, right) => {
    if (left.consumed !== right.consumed) {
      return left.consumed - right.consumed;
    }

    return left.employerName.localeCompare(right.employerName);
  });
};

const updateRequestCounts = async (
  strapi: StrapiDocumentService,
  request: DocumentRecord,
  data: Record<string, unknown>
) =>
  documents(strapi, 'api::interview-request.interview-request').update({
    documentId: getDocumentId(request),
    data,
    populate: ['candidate', 'class', 'region'],
  });

const recordCapacityShortfall = async ({
  available,
  reason,
  request,
  requestContext,
  required,
  strapi,
}: {
  available: number;
  reason: string;
  request: DocumentRecord;
  requestContext: RequestContext;
  required: number;
  strapi: StrapiDocumentService;
}) => {
  if (!(request.requestState === 'pending_capacity' && request.insufficientCapacityDetectedAt)) {
    await auditEvents(strapi).record({
      actorType: 'system',
      eventCategory: 'interview',
      eventType: 'interview_request.capacity_shortfall',
      ipAddress: requestContext.ipAddress,
      metadata: {
        availableInterviewCapacity: available,
        requestedInterviewCount: required,
        requestId: requestContext.requestId,
        source: 'interview_request_router',
      },
      requestId: requestContext.requestId,
      serviceName: requestContext.serviceName,
      severity: 'error',
      source: 'core_api',
      subjectDisplayName: displayName(request.candidate) || 'Interview request',
      subjectId: getDocumentId(request),
      subjectType: 'interview_request',
      userAgent: requestContext.userAgent,
    });
  }

  return updateRequestCounts(strapi, request, {
    candidateVisibleState: 'blocked',
    insufficientCapacityDetectedAt: new Date().toISOString(),
    insufficientCapacityReason: reason,
    lastCapacityCheckAt: new Date().toISOString(),
    requestState: 'pending_capacity',
  });
};

const createReusableSlotOffer = async ({
  request,
  requestContext,
  slots,
  strapi,
}: {
  request: DocumentRecord;
  requestContext: RequestContext;
  slots: DocumentRecord[];
  strapi: StrapiDocumentService;
}) => {
  const requestDocumentId = getDocumentId(request);
  const candidateDocumentId = getDocumentId(request.candidate);
  const enrollmentDocumentId = getDocumentId(request.enrollment);
  const firstSlot = slots[0];
  const firstEmployer = documentRecordValue(firstSlot?.employer);
  const firstEmployerContact = documentRecordValue(firstSlot?.employerContact);

  if (!requestDocumentId || !candidateDocumentId || !enrollmentDocumentId || !firstEmployer?.documentId) {
    return null;
  }

  const nowDate = new Date();
  const now = nowDate.toISOString();
  const responseDeadline = addWorkingDays(nowDate, 2).toISOString();
  const offer = await documents(strapi, 'api::interview-slot-offer.interview-slot-offer').create({
    data: {
      candidate: {
        connect: [{ documentId: candidateDocumentId }],
      },
      candidateNotifiedAt: now,
      candidateResponseDeadline: responseDeadline,
      employer: relationConnect(firstEmployer),
      employerContact: relationConnect(firstEmployerContact),
      enrollment: {
        connect: [{ documentId: enrollmentDocumentId }],
      },
      interviewRequest: {
        connect: [{ documentId: requestDocumentId }],
      },
      metadata: {
        requestId: requestContext.requestId,
        reusableSlotDocumentIds: slots.map(getDocumentId).filter(Boolean),
        source: reusableSlotAssignmentSource,
      },
      offerState: 'sent',
      requiredSlotCount: 3,
    },
  });
  const offerDocumentId = getDocumentId(offer);

  if (!offerDocumentId) {
    return null;
  }

  for (const slot of slots) {
    await snapshotOfferSlots(strapi, documentRecordValue(slot.slotOffer), requestContext);
    await documents(strapi, 'api::interview-slot.interview-slot').update({
      documentId: getDocumentId(slot),
      data: {
        metadata: {
          ...objectValue(slot.metadata),
          reassignedAt: now,
          reassignedFromOfferDocumentId: getDocumentId(slot.slotOffer) || null,
          reassignedRequestId: requestContext.requestId,
          reassignedToOfferDocumentId: offerDocumentId,
          reassignmentSource: reusableSlotAssignmentSource,
        },
        slotOffer: {
          connect: [{ documentId: offerDocumentId }],
        },
        slotState: 'offered',
      },
    });
  }

  await documents(strapi, 'api::interview-request.interview-request').update({
    documentId: requestDocumentId,
    data: {
      candidateVisibleState: 'reviewing_options',
      insufficientCapacityDetectedAt: null,
      insufficientCapacityReason: null,
      lastCapacityCheckAt: now,
      requestState: 'slot_options_submitted',
    },
  });

  await auditEvents(strapi).record({
    actorType: 'system',
    eventCategory: 'interview',
    eventType: 'interview_request.reusable_slots_assigned',
    ipAddress: requestContext.ipAddress,
    metadata: {
      interviewSlotOfferDocumentId: offerDocumentId,
      reusableSlotDocumentIds: slots.map(getDocumentId).filter(Boolean),
      requestId: requestContext.requestId,
      source: reusableSlotAssignmentSource,
    },
    requestId: requestContext.requestId,
    serviceName: requestContext.serviceName,
    severity: 'info',
    source: 'core_api',
    subjectDisplayName: displayName(request.candidate) || 'Interview request',
    subjectId: requestDocumentId,
    subjectType: 'interview_request',
    userAgent: requestContext.userAgent,
  });

  await queueCandidateSlotOfferNotification({
    offerDocumentId,
    requestContext,
    responseDeadline,
    strapi,
  });

  return offerDocumentId;
};

const createReusableSlotTopUpClaim = async ({
  availableReusableSlotCount,
  missingSlotCount,
  request,
  requestContext,
  strapi,
}: {
  availableReusableSlotCount: number;
  missingSlotCount: number;
  request: DocumentRecord;
  requestContext: RequestContext;
  strapi: StrapiDocumentService;
}) => {
  const requestDocumentId = getDocumentId(request);
  const regionDocumentId = getDocumentId(request.region);

  if (!requestDocumentId || !regionDocumentId || missingSlotCount <= 0) {
    return null;
  }

  const existingTopUps = await activeTopUpClaimsForRequest(strapi, requestDocumentId);

  if (existingTopUps.length) {
    return null;
  }

  const existingClaims = await findAllClaimsForRequest(strapi, requestDocumentId);
  const activeEmployerIds = new Set(
    existingClaims
      .filter((claim) => ['held', 'notified', 'accepted', 'fulfilled'].includes(String(claim.claimState || '')))
      .map((claim) => getDocumentId(claim.employer))
      .filter((documentId): documentId is string => Boolean(documentId))
  );
  const availableEmployers = (await eligibleEmployerCapacity(strapi, regionDocumentId)).filter(
    (capacity) => !activeEmployerIds.has(capacity.employerDocumentId)
  );

  if (!availableEmployers.length) {
    await recordCapacityShortfall({
      available: availableReusableSlotCount,
      reason: `Only ${availableReusableSlotCount} reusable interview slot option(s) are available and no employer capacity is available to top up to 3 options.`,
      request,
      requestContext,
      required: 3,
      strapi,
    });
    return null;
  }

  const now = new Date();
  const deadline = addWorkingDays(now, integerValue(request.responseSlaWorkingDays, 2)) || now;
  const capacity = availableEmployers[0];

  const claim = await documents(strapi, 'api::employer-capacity-claim.employer-capacity-claim').create({
    data: {
      assignmentSource: 'automatic',
      claimCount: 1,
      claimState: 'notified',
      employer: {
        connect: [{ documentId: capacity.employerDocumentId }],
      },
      employerContact: {
        connect: [{ documentId: capacity.contactDocumentId }],
      },
      expiresAt: deadline.toISOString(),
      interviewRequest: {
        connect: [{ documentId: requestDocumentId }],
      },
      metadata: {
        availableReusableSlotCount,
        commitmentCadence: capacity.commitment.cadence,
        commitmentMode: capacity.commitment.mode,
        purpose: reusableSlotTopUpPurpose,
        requestId: requestContext.requestId,
        source: 'reusable_slot_pool_top_up',
      },
      notifiedAt: now.toISOString(),
      region: {
        connect: [{ documentId: regionDocumentId }],
      },
      requiredSlotCount: Math.min(3, Math.max(1, missingSlotCount)),
    },
  });

  await documents(strapi, 'api::interview-request.interview-request').update({
    documentId: requestDocumentId,
    data: {
      candidateVisibleState: 'arranging_interviews',
      lastCapacityCheckAt: now.toISOString(),
      requestState: 'employer_notified',
    },
  });

  await auditEvents(strapi).record({
    actorType: 'system',
    eventCategory: 'interview',
    eventType: 'interview_request.reusable_slot_top_up_requested',
    ipAddress: requestContext.ipAddress,
    metadata: {
      availableReusableSlotCount,
      capacityClaimDocumentId: getDocumentId(claim),
      missingSlotCount,
      requestId: requestContext.requestId,
      source: reusableSlotAssignmentSource,
    },
    requestId: requestContext.requestId,
    serviceName: requestContext.serviceName,
    severity: 'info',
    source: 'core_api',
    subjectDisplayName: displayName(request.candidate) || 'Interview request',
    subjectId: requestDocumentId,
    subjectType: 'interview_request',
    userAgent: requestContext.userAgent,
  });

  return claim;
};

const routeInterviewRequest = async (
  strapi: StrapiDocumentService,
  request: DocumentRecord,
  requestContext: RequestContext = {}
) => {
  const requestDocumentId = getDocumentId(request);
  const regionDocumentId = getDocumentId(request.region);
  const requestedInterviewCount = Math.max(1, integerValue(request.requestedInterviewCount, 1));

  if (!requestDocumentId || !regionDocumentId) {
    return recordCapacityShortfall({
      available: 0,
      reason: 'Interview request is missing a class operating region.',
      request,
      requestContext,
      required: requestedInterviewCount,
      strapi,
    });
  }

  const [existingClaims, allClaims] = await Promise.all([
    findActiveClaimsForRequest(strapi, requestDocumentId),
    findAllClaimsForRequest(strapi, requestDocumentId),
  ]);
  const existingEmployerIds = new Set(
    allClaims.map((claim) => getDocumentId(claim.employer)).filter((documentId): documentId is string => Boolean(documentId))
  );
  const existingClaimCount = existingClaims.reduce(
    (total, claim) => total + integerValue(claim.claimCount, 1),
    0
  );

  if (existingClaimCount >= requestedInterviewCount) {
    return updateRequestCounts(strapi, request, {
      candidateVisibleState: 'arranging_interviews',
      claimedInterviewCount: existingClaimCount,
      lastCapacityCheckAt: new Date().toISOString(),
      requestState:
        request.requestState === 'slot_options_submitted'
          ? 'slot_options_submitted'
          : request.requestState === 'candidate_reviewing'
            ? 'candidate_reviewing'
            : 'employer_notified',
    });
  }

  const needed = requestedInterviewCount - existingClaimCount;
  const availableEmployers = (await eligibleEmployerCapacity(strapi, regionDocumentId)).filter(
    (capacity) => !existingEmployerIds.has(capacity.employerDocumentId)
  );

  if (availableEmployers.length < needed) {
    return recordCapacityShortfall({
      available: availableEmployers.length + existingClaimCount,
      reason: `Only ${availableEmployers.length + existingClaimCount} distinct employer interview capacity claim(s) are available for ${requestedInterviewCount} required interview(s).`,
      request,
      requestContext,
      required: requestedInterviewCount,
      strapi,
    });
  }

  const now = new Date();
  const deadline = addWorkingDays(now, integerValue(request.responseSlaWorkingDays, 2)) || now;
  const selected = availableEmployers.slice(0, needed);

  await Promise.all(
    selected.map((capacity) =>
      documents(strapi, 'api::employer-capacity-claim.employer-capacity-claim').create({
        data: {
          assignmentSource: 'automatic',
          claimCount: 1,
          claimState: 'notified',
          employer: {
            connect: [{ documentId: capacity.employerDocumentId }],
          },
          employerContact: {
            connect: [{ documentId: capacity.contactDocumentId }],
          },
          expiresAt: deadline.toISOString(),
          interviewRequest: {
            connect: [{ documentId: requestDocumentId }],
          },
          metadata: {
            commitmentCadence: capacity.commitment.cadence,
            commitmentMode: capacity.commitment.mode,
            requestId: requestContext.requestId,
            source: 'interview_request_router',
          },
          notifiedAt: now.toISOString(),
          region: {
            connect: [{ documentId: regionDocumentId }],
          },
          requiredSlotCount: 3,
        },
      })
    )
  );

  await auditEvents(strapi).record({
    actorType: 'system',
    eventCategory: 'interview',
    eventType: 'interview_request.capacity_claimed',
    ipAddress: requestContext.ipAddress,
    metadata: {
      claimedInterviewCount: requestedInterviewCount,
      employerDocumentIds: selected.map((capacity) => capacity.employerDocumentId),
      requestId: requestContext.requestId,
      source: 'interview_request_router',
    },
    requestId: requestContext.requestId,
    serviceName: requestContext.serviceName,
    severity: 'info',
    source: 'core_api',
    subjectDisplayName: displayName(request.candidate) || 'Interview request',
    subjectId: requestDocumentId,
    subjectType: 'interview_request',
    userAgent: requestContext.userAgent,
  });

  return updateRequestCounts(strapi, request, {
    candidateVisibleState: 'arranging_interviews',
    claimedInterviewCount: requestedInterviewCount,
    employerResponseDeadline: deadline.toISOString(),
    insufficientCapacityDetectedAt: null,
    insufficientCapacityReason: null,
    lastCapacityCheckAt: now.toISOString(),
    lastRoutedAt: now.toISOString(),
    requestState: 'employer_notified',
  });
};

const findSelectedOfferForInterview = async (
  strapi: StrapiDocumentService,
  interview: DocumentRecord
) => {
  const metadata = objectValue(interview.metadata);
  const metadataOfferDocumentId =
    typeof metadata.interviewSlotOfferDocumentId === 'string'
      ? metadata.interviewSlotOfferDocumentId
      : undefined;
  const interviewDocumentId = getDocumentId(interview);
  const filters = metadataOfferDocumentId
    ? { documentId: metadataOfferDocumentId }
    : {
        selectedInterview: {
          documentId: interviewDocumentId,
        },
      };
  const offers = await documents(strapi, 'api::interview-slot-offer.interview-slot-offer').findMany({
    filters,
    limit: 1,
    populate: {
      capacityClaim: true,
      candidate: true,
      employer: true,
      employerContact: true,
      enrollment: true,
      interviewRequest: {
        populate: ['candidate', 'class', 'enrollment', 'region', 'slotOffers'],
      },
      selectedSlot: true,
      slots: {
        populate: ['employer', 'employerContact', 'region', 'workSector', 'slotOffer'],
      },
    },
  });

  return offers[0] || null;
};

const releaseInterviewForMissingDetails = async ({
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
    return false;
  }

  const now = new Date().toISOString();
  const offer = await findSelectedOfferForInterview(strapi, interview);
  const selectedSlot =
    documentRecordValue(interview.interviewSlot) ||
    documentRecordValue(offer?.selectedSlot);
  const reusableThreshold = addWorkingDays(new Date(), 4);
  const selectedSlotStart = validDate(selectedSlot?.startTime);
  const reusableSlot = Boolean(selectedSlotStart && selectedSlotStart >= reusableThreshold);

  if (selectedSlot?.documentId) {
    await documents(strapi, 'api::interview-slot.interview-slot').update({
      documentId: selectedSlot.documentId,
      data: {
        metadata: {
          ...objectValue(selectedSlot.metadata),
          employerDetailsReleaseAt: now,
          employerDetailsReleaseInterviewDocumentId: interviewDocumentId,
          requestId: requestContext.requestId,
        },
        slotState: reusableSlot ? 'available' : 'expired',
      },
    });
  }

  await documents(strapi, 'api::interview.interview').update({
    documentId: interviewDocumentId,
    data: {
      countsTowardGuarantee: false,
      employerCancellation: true,
      employerDetailsReleaseReason: 'employer_did_not_confirm',
      employerDetailsReleasedAt: now,
      interviewState: 'employer_cancelled',
      metadata: {
        ...objectValue(interview.metadata),
        candidateSafeCancellationReason: 'The employer did not confirm the final interview details in time.',
        employerDetailsReleasedAt: now,
        employerDetailsReleaseRequestId: requestContext.requestId,
        employerDetailsReleaseSource: 'interview_workflow_reconciliation',
        releasedSlotDocumentId: selectedSlot?.documentId || null,
        releasedSlotReturnedToPool: reusableSlot,
      },
    },
  });

  if (offer?.documentId) {
    await documents(strapi, 'api::interview-slot-offer.interview-slot-offer').update({
      documentId: offer.documentId,
      data: {
        metadata: {
          ...objectValue(offer.metadata),
          employerDetailsReleaseAt: now,
          employerDetailsReleaseInterviewDocumentId: interviewDocumentId,
          requestId: requestContext.requestId,
        },
        offerState: 'replacement_required',
      },
    });
  }

  const request = documentRecordValue(offer?.interviewRequest);
  const requestDocumentId = getDocumentId(request);

  if (requestDocumentId) {
    await documents(strapi, 'api::interview-request.interview-request').update({
      documentId: requestDocumentId,
      data: {
        candidateVisibleState: 'arranging_interviews',
        claimedInterviewCount: 0,
        lastCapacityCheckAt: now,
        requestState: 'pending_capacity',
      },
    });
  }

  await queueEmployerInterviewReleasedNotification({
    interview,
    requestContext,
    strapi,
  });
  await documents(strapi, 'api::interview.interview').update({
    documentId: interviewDocumentId,
    data: {
      employerDetailsReleaseNotificationSentAt: now,
    },
  });

  await auditEvents(strapi).record({
    actorType: 'system',
    eventCategory: 'interview',
    eventType: 'employer.interview_details_missing_released',
    ipAddress: requestContext.ipAddress,
    metadata: {
      interviewDocumentId,
      interviewSlotOfferDocumentId: getDocumentId(offer) || null,
      requestId: requestContext.requestId,
      reusableSlot,
      selectedSlotDocumentId: selectedSlot?.documentId || null,
    },
    requestId: requestContext.requestId,
    serviceName: requestContext.serviceName,
    severity: 'warning',
    source: 'core_api',
    subjectDisplayName: displayName(interview.candidate) || 'Interview',
    subjectId: interviewDocumentId,
    subjectType: 'interview',
    userAgent: requestContext.userAgent,
  });

  if (request?.documentId) {
    await routeInterviewRequest(
      strapi,
      {
        ...request,
        claimedInterviewCount: 0,
        requestState: 'pending_capacity',
      },
      requestContext
    );
  }

  return true;
};

export default factories.createCoreService('api::interview-request.interview-request', ({ strapi }) => ({
  async reconcileReusableInterviewSlots(limit = 100, requestContext: RequestContext = {}) {
    const reusableSlots = await documents(strapi, 'api::interview-slot.interview-slot').findMany({
      filters: {
        slotState: 'available',
        startTime: {
          $gte: addWorkingDays(new Date(), 4).toISOString(),
        },
      },
      limit,
      populate: ['region', 'workSector'],
      sort: ['startTime:asc', 'createdAt:asc'],
    });
    const poolKeys = Array.from(
      new Set(
        reusableSlots
          .map((slot) => {
            const regionDocumentId = getDocumentId(slot.region);
            const workSectorDocumentId = getDocumentId(slot.workSector);

            return regionDocumentId ? `${regionDocumentId}:${workSectorDocumentId || ''}` : null;
          })
          .filter((value): value is string => Boolean(value))
      )
    );
    const summary = {
      assignedOffers: 0,
      checkedPools: poolKeys.length,
      errors: [] as Array<{ error: string; poolKey?: string; requestDocumentId?: string }>,
      skipped: 0,
      topUpClaims: 0,
    };

    for (const poolKey of poolKeys) {
      const [regionDocumentId, workSectorDocumentIdRaw] = poolKey.split(':');
      const workSectorDocumentId = workSectorDocumentIdRaw || undefined;

      try {
        const requests = await findReusableSlotCandidateRequests({
          limit,
          regionDocumentId,
          strapi,
          workSectorDocumentId,
        });

        for (const request of requests) {
          const requestDocumentId = getDocumentId(request);

          try {
            const excludedEmployerIds = await selectedEmployerIdsForRequest(strapi, request);
            const availableSlots = await findReusableSlots({
              excludedCandidateId: getDocumentId(request.candidate) || undefined,
              excludedEmployerIds,
              excludedRequestId: requestDocumentId || undefined,
              limit: 25,
              regionDocumentId,
              strapi,
              workSectorDocumentId,
            });

            if (availableSlots.length >= 3) {
              const offerDocumentId = await createReusableSlotOffer({
                request,
                requestContext,
                slots: availableSlots.slice(0, 3),
                strapi,
              });

              if (offerDocumentId) {
                summary.assignedOffers += 1;
              } else {
                summary.skipped += 1;
              }

              continue;
            }

            if (availableSlots.length > 0) {
              const claim = await createReusableSlotTopUpClaim({
                availableReusableSlotCount: availableSlots.length,
                missingSlotCount: 3 - availableSlots.length,
                request,
                requestContext,
                strapi,
              });

              if (claim) {
                summary.topUpClaims += 1;
              } else {
                summary.skipped += 1;
              }

              break;
            } else {
              summary.skipped += 1;
            }
          } catch (error) {
            summary.errors.push({
              error: error instanceof Error ? error.message : String(error),
              poolKey,
              requestDocumentId,
            });
          }
        }
      } catch (error) {
        summary.errors.push({
          error: error instanceof Error ? error.message : String(error),
          poolKey,
        });
      }
    }

    return summary;
  },

  async reconcileEmployerCapacityClaims(limit = 100, requestContext: RequestContext = {}) {
    const now = Date.now();
    const reminderIntervalMs = employerCapacityClaimReminderIntervalMs();
    const reminderMax = employerCapacityClaimReminderMax();
    const claims = await documents(strapi, 'api::employer-capacity-claim.employer-capacity-claim').findMany({
      filters: {
        claimState: {
          $in: ['held', 'notified', 'accepted'],
        },
      },
      limit,
      populate: {
        employer: {
          populate: {
            contacts: true,
          },
        },
        employerContact: true,
        interviewRequest: {
          populate: ['candidate', 'class', 'region'],
        },
        region: true,
      },
      sort: ['expiresAt:asc', 'createdAt:asc'],
    });
    const summary = {
      checked: claims.length,
      errors: [] as Array<{ capacityClaimDocumentId?: string; error: string }>,
      expired: 0,
      reminded: 0,
      skipped: 0,
    };

    for (const claim of claims) {
      const capacityClaimDocumentId = getDocumentId(claim);

      try {
        const expiresAtMs = claim.expiresAt ? Date.parse(claim.expiresAt) : Number.NaN;

        if (!capacityClaimDocumentId || Number.isNaN(expiresAtMs)) {
          summary.skipped += 1;
          continue;
        }

        if (expiresAtMs <= now) {
          await queueEmployerCapacityClaimExpiredLeadNotification({
            claim,
            requestContext,
            strapi,
          });
          await this.releaseCapacityClaim(
            {
              capacityClaimDocumentId,
              releaseNote: 'Employer response SLA expired.',
              releaseReason: 'expired',
            },
            {
              ...requestContext,
              serviceName: requestContext.serviceName || 'class-workflow-worker',
            }
          );
          summary.expired += 1;
          continue;
        }

        const reminderCount = integerValue(claim.employerResponseReminderCount);

        if (reminderCount >= reminderMax) {
          summary.skipped += 1;
          continue;
        }

        const lastReminderMs = claim.lastEmployerResponseReminderSentAt
          ? Date.parse(claim.lastEmployerResponseReminderSentAt)
          : Number.NaN;
        const notifiedMs = claim.notifiedAt ? Date.parse(String(claim.notifiedAt)) : Number.NaN;
        const createdMs = claim.createdAt ? Date.parse(String(claim.createdAt)) : now;
        const referenceMs = Number.isNaN(lastReminderMs)
          ? Number.isNaN(notifiedMs)
            ? createdMs
            : notifiedMs
          : lastReminderMs;

        if (now - referenceMs < reminderIntervalMs) {
          summary.skipped += 1;
          continue;
        }

        await queueEmployerCapacityClaimReminderNotification({
          claim,
          requestContext,
          strapi,
        });
        await documents(strapi, 'api::employer-capacity-claim.employer-capacity-claim').update({
          documentId: capacityClaimDocumentId,
          data: {
            employerResponseReminderCount: reminderCount + 1,
            lastEmployerResponseReminderSentAt: new Date(now).toISOString(),
            metadata: {
              ...objectValue(claim.metadata),
              lastReminderRequestId: requestContext.requestId,
              lastReminderSource: 'employer_capacity_claim_reconciliation',
            },
          },
        });
        summary.reminded += 1;
      } catch (error) {
        summary.errors.push({
          capacityClaimDocumentId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return summary;
  },

  async reconcileEmployerInterviewDetails(limit = 100, requestContext: RequestContext = {}) {
    const now = Date.now();
    const reminderIntervalMs = employerInterviewDetailsReminderIntervalMs();
    const reminderMax = employerInterviewDetailsReminderMax();
    const interviews = await documents(strapi, 'api::interview.interview').findMany({
      filters: {
        interviewState: 'awaiting_employer_details',
      },
      limit,
      populate: {
        candidate: true,
        employer: {
          populate: ['contacts'],
        },
        employerContact: true,
        interviewSlot: true,
      },
      sort: ['createdAt:asc'],
    });
    const summary = {
      checked: interviews.length,
      escalated: 0,
      errors: [] as Array<{ error: string; interviewDocumentId?: string }>,
      released: 0,
      reminded: 0,
      skipped: 0,
    };

    for (const interview of interviews) {
      const interviewDocumentId = getDocumentId(interview);

      try {
        if (!interviewDocumentId || !documentRecordValue(interview.employerContact)?.email) {
          summary.skipped += 1;
          continue;
        }

        const reminderCount = integerValue(interview.employerDetailsReminderCount);
        const fallbackWindow = detailDueWindowForInterview(interview, interview.createdAt || new Date(now));
        const dueAt = interview.employerDetailsDueAt || fallbackWindow.dueAt;
        const releaseEligibleAt =
          interview.employerDetailsReleaseEligibleAt || fallbackWindow.releaseEligibleAt;
        const dueMs = Date.parse(dueAt);
        const releaseEligibleMs = Date.parse(releaseEligibleAt);

        if (!interview.employerDetailsDueAt || !interview.employerDetailsReleaseEligibleAt) {
          await documents(strapi, 'api::interview.interview').update({
            documentId: interviewDocumentId,
            data: {
              employerDetailsDueAt: dueAt,
              employerDetailsReleaseEligibleAt: releaseEligibleAt,
              metadata: {
                ...objectValue(interview.metadata),
                employerDetailsDueBackfilledAt: new Date(now).toISOString(),
                employerDetailsDueWorkingDays: fallbackWindow.dueDays,
              },
            },
          });
        }

        if (
          reminderCount > 0 &&
          !interview.employerDetailsEscalatedAt &&
          Number.isFinite(releaseEligibleMs) &&
          now >= releaseEligibleMs
        ) {
          await queueEmployerInterviewDetailsLeadEscalationNotification({
            interview,
            requestContext,
            strapi,
          });
          await documents(strapi, 'api::interview.interview').update({
            documentId: interviewDocumentId,
            data: {
              employerDetailsEscalatedAt: new Date(now).toISOString(),
            },
          });
          summary.escalated += 1;
        }

        if (
          reminderCount > 0 &&
          Number.isFinite(releaseEligibleMs) &&
          now >= releaseEligibleMs
        ) {
          const released = await releaseInterviewForMissingDetails({
            interview,
            requestContext,
            strapi,
          });

          if (released) {
            summary.released += 1;
          } else {
            summary.skipped += 1;
          }
          continue;
        }

        if (reminderCount >= reminderMax) {
          summary.skipped += 1;
          continue;
        }

        const lastReminderMs = interview.lastEmployerDetailsReminderSentAt
          ? Date.parse(interview.lastEmployerDetailsReminderSentAt)
          : Number.NaN;
        const createdMs = interview.createdAt ? Date.parse(String(interview.createdAt)) : now;
        const referenceMs = Number.isNaN(lastReminderMs) ? createdMs : lastReminderMs;

        if (
          now - referenceMs < reminderIntervalMs &&
          (!Number.isFinite(dueMs) || now < dueMs)
        ) {
          summary.skipped += 1;
          continue;
        }

        await queueEmployerInterviewDetailsReminderNotification({
          interview,
          requestContext,
          strapi,
        });
        await documents(strapi, 'api::interview.interview').update({
          documentId: interviewDocumentId,
          data: {
            employerDetailsReminderCount: reminderCount + 1,
            lastEmployerDetailsReminderSentAt: new Date(now).toISOString(),
            metadata: {
              ...objectValue(interview.metadata),
              lastDetailsReminderRequestId: requestContext.requestId,
              lastDetailsReminderSource: 'employer_interview_details_reconciliation',
            },
          },
        });
        summary.reminded += 1;
      } catch (error) {
        summary.errors.push({
          error: error instanceof Error ? error.message : String(error),
          interviewDocumentId,
        });
      }
    }

    return summary;
  },

  async reconcileEmployerInterviewFeedback(limit = 100, requestContext: RequestContext = {}) {
    const now = Date.now();
    const reminderIntervalMs = employerFeedbackReminderIntervalMs();
    const interviews = await documents(strapi, 'api::interview.interview').findMany({
      filters: {
        interviewState: 'completed',
      },
      limit,
      populate: {
        candidate: true,
        employer: true,
        employerContact: true,
        interviewSlot: true,
      },
      sort: ['completedAt:asc', 'scheduledEndTime:asc', 'createdAt:asc'],
    });
    const interviewDocumentIds = interviews
      .map(getDocumentId)
      .filter((documentId): documentId is string => Boolean(documentId));
    const feedbackRecords = interviewDocumentIds.length
      ? await documents(strapi, 'api::interview-feedback.interview-feedback').findMany({
          filters: {
            interview: {
              documentId: {
                $in: interviewDocumentIds,
              },
            },
            submittedByType: 'employer_contact',
          },
          limit: Math.max(limit, 100),
          populate: ['interview'],
        })
      : [];
    const feedbackInterviewIds = new Set(
      feedbackRecords
        .map((feedback) => getDocumentId(documentRecordValue(feedback.interview)))
        .filter((documentId): documentId is string => Boolean(documentId))
    );
    const summary = {
      checked: interviews.length,
      errors: [] as Array<{ error: string; interviewDocumentId?: string }>,
      overdue: 0,
      reminded: 0,
      skipped: 0,
    };

    for (const interview of interviews) {
      const interviewDocumentId = getDocumentId(interview);

      try {
        if (!interviewDocumentId || feedbackInterviewIds.has(interviewDocumentId)) {
          summary.skipped += 1;
          continue;
        }

        const dueAt = interviewFeedbackDueAt(interview);
        const dueMs = Date.parse(dueAt);
        const reminderCount = integerValue(interview.employerFeedbackReminderCount);

        if (!interview.feedbackDueAt) {
          await documents(strapi, 'api::interview.interview').update({
            documentId: interviewDocumentId,
            data: {
              feedbackDueAt: dueAt,
            },
          });
        }

        if (Number.isFinite(dueMs) && now > dueMs) {
          if (!interview.feedbackOverdueDetectedAt) {
            await documents(strapi, 'api::interview.interview').update({
              documentId: interviewDocumentId,
              data: {
                feedbackOverdueDetectedAt: new Date(now).toISOString(),
              },
            });
          }
          summary.overdue += 1;
          continue;
        }

        if (!documentRecordValue(interview.employerContact)?.email) {
          summary.skipped += 1;
          continue;
        }

        const lastReminderMs = interview.lastEmployerFeedbackReminderSentAt
          ? Date.parse(interview.lastEmployerFeedbackReminderSentAt)
          : Number.NaN;
        const referenceMs = Number.isNaN(lastReminderMs)
          ? Date.parse(String(interview.completedAt || interview.scheduledEndTime || interview.createdAt || now))
          : lastReminderMs;

        if (Number.isFinite(referenceMs) && now - referenceMs < reminderIntervalMs) {
          summary.skipped += 1;
          continue;
        }

        await queueEmployerFeedbackReminderNotification({
          interview,
          requestContext,
          strapi,
        });
        await documents(strapi, 'api::interview.interview').update({
          documentId: interviewDocumentId,
          data: {
            employerFeedbackReminderCount: reminderCount + 1,
            lastEmployerFeedbackReminderSentAt: new Date(now).toISOString(),
            metadata: {
              ...objectValue(interview.metadata),
              lastFeedbackReminderRequestId: requestContext.requestId,
              lastFeedbackReminderSource: 'employer_interview_feedback_reconciliation',
            },
          },
        });
        summary.reminded += 1;
      } catch (error) {
        summary.errors.push({
          error: error instanceof Error ? error.message : String(error),
          interviewDocumentId,
        });
      }
    }

    return summary;
  },

  async ensureForEnrollment(input: unknown, requestContext: RequestContext = {}) {
    const body = validateEnsureForEnrollment(input);
    const enrollment = await findEnrollment(strapi, body.enrollmentDocumentId);

    if (!enrollment) {
      throw new ValidationError('Enrollment could not be found.');
    }

    const candidateDocumentId = getDocumentId(enrollment.candidate);
    const classRecord = enrollment.class;
    const classDocumentId = getDocumentId(classRecord);
    const regionDocumentId = getDocumentId(classRecord?.classArea);

    if (!candidateDocumentId || !classDocumentId) {
      throw new ValidationError('Enrollment is missing candidate or class data.');
    }

    const requestedInterviewCount = Math.max(1, integerValue(classRecord?.interviewsGuaranteed, 1));
    const prerequisites = await candidatePrerequisites(strapi, candidateDocumentId);
    const existingRequest = await findOpenRequestForEnrollment(strapi, body.enrollmentDocumentId);
    const requestData = {
      candidate: {
        connect: [{ documentId: candidateDocumentId }],
      },
      class: {
        connect: [{ documentId: classDocumentId }],
      },
      enrollment: {
        connect: [{ documentId: body.enrollmentDocumentId }],
      },
      metadata: {
        ...objectValue(existingRequest?.metadata),
        lastEnsureSource: body.source || 'system',
        lastEnsureAt: new Date().toISOString(),
        requestId: requestContext.requestId,
      },
      requestedInterviewCount,
      responseSlaWorkingDays: 2,
      ...(regionDocumentId
        ? {
            region: {
              connect: [{ documentId: regionDocumentId }],
            },
          }
        : {}),
    };
    let request = existingRequest?.documentId
      ? await documents(strapi, 'api::interview-request.interview-request').update({
          documentId: existingRequest.documentId,
          data: requestData,
          populate: ['candidate', 'class', 'region'],
        })
      : await documents(strapi, 'api::interview-request.interview-request').create({
          data: {
            ...requestData,
            candidateVisibleState: 'waiting_for_candidate',
            requestState: 'pending_profile',
          },
          populate: ['candidate', 'class', 'region'],
        });

    if (!prerequisites.profileComplete) {
      return updateRequestCounts(strapi, request, {
        candidateVisibleState: 'waiting_for_candidate',
        requestState: 'pending_profile',
      });
    }

    if (!prerequisites.availabilitySubmitted) {
      return updateRequestCounts(strapi, request, {
        candidateVisibleState: 'waiting_for_candidate',
        requestState: 'pending_availability',
      });
    }

    request = await updateRequestCounts(strapi, request, {
      candidateVisibleState: 'arranging_interviews',
      requestState:
        request.requestState && routedRequestStates.includes(String(request.requestState))
          ? request.requestState
          : 'pending_capacity',
    });

    return routeInterviewRequest(strapi, request, requestContext);
  },

  async markSlotOptionsSubmitted(input: unknown, requestContext: RequestContext = {}) {
    const body = validateMarkSubmitted(input);
    const claims = await documents(strapi, 'api::employer-capacity-claim.employer-capacity-claim').findMany({
      filters: {
        documentId: body.capacityClaimDocumentId,
      },
      limit: 1,
      populate: ['interviewRequest'],
    });
    const claim = claims[0];

    if (!claim) {
      throw new ValidationError('Capacity claim could not be found.');
    }

    const requestDocumentId = getDocumentId(claim.interviewRequest);
    const nowDate = new Date();
    const now = nowDate.toISOString();
    const responseDeadline = addWorkingDays(nowDate, 2).toISOString();

    await documents(strapi, 'api::employer-capacity-claim.employer-capacity-claim').update({
      documentId: body.capacityClaimDocumentId,
      data: {
        claimState: 'fulfilled',
        fulfilledAt: now,
        releaseReason: 'slot_options_submitted',
      },
    });
    await documents(strapi, 'api::interview-slot-offer.interview-slot-offer').update({
      documentId: body.interviewSlotOfferDocumentId,
      data: {
        candidateNotifiedAt: now,
        candidateResponseDeadline: responseDeadline,
        offerState: 'sent',
      },
    });

    if (requestDocumentId) {
      const activeClaims = await findActiveClaimsForRequest(strapi, requestDocumentId);
      const fulfilledCount = activeClaims.filter((activeClaim) => activeClaim.claimState === 'fulfilled').length;
      await documents(strapi, 'api::interview-request.interview-request').update({
        documentId: requestDocumentId,
        data: {
          candidateVisibleState: 'reviewing_options',
          fulfilledInterviewCount: fulfilledCount,
          lastCapacityCheckAt: now,
          requestState: 'slot_options_submitted',
        },
      });
    }

    await auditEvents(strapi).record({
      actorType: 'employer_contact',
      eventCategory: 'interview',
      eventType: 'interview_request.slot_options_submitted',
      metadata: {
        capacityClaimDocumentId: body.capacityClaimDocumentId,
        interviewSlotOfferDocumentId: body.interviewSlotOfferDocumentId,
        requestId: requestContext.requestId,
      },
      requestId: requestContext.requestId,
      serviceName: requestContext.serviceName,
      severity: 'info',
      source: 'employer_dashboard',
      subjectId: requestDocumentId || body.capacityClaimDocumentId,
      subjectType: requestDocumentId ? 'interview_request' : 'employer_capacity_claim',
    });
    await queueCandidateSlotOfferNotification({
      offerDocumentId: body.interviewSlotOfferDocumentId,
      requestContext,
      responseDeadline,
      strapi,
    });

    return {
      submitted: true,
    };
  },

  async releaseCapacityClaim(input: unknown, requestContext: RequestContext = {}) {
    const body = validateReleaseCapacityClaim(input);
    const claims = await documents(strapi, 'api::employer-capacity-claim.employer-capacity-claim').findMany({
      filters: {
        documentId: body.capacityClaimDocumentId,
      },
      limit: 1,
      populate: {
        employer: true,
        employerContact: true,
        interviewRequest: {
          populate: ['candidate', 'class', 'region'],
        },
      },
    });
    const claim = claims[0];

    if (!claim) {
      throw new ValidationError('Capacity claim could not be found.');
    }

    if (!['held', 'notified', 'accepted'].includes(String(claim.claimState || ''))) {
      throw new ValidationError('Capacity claim is not open for release.');
    }

    const request = claim.interviewRequest;
    const requestDocumentId = getDocumentId(request);
    const now = new Date().toISOString();
    const releasedClaim = await documents(strapi, 'api::employer-capacity-claim.employer-capacity-claim').update({
      documentId: body.capacityClaimDocumentId,
      data: {
        claimState: body.releaseReason === 'expired' ? 'expired' : 'declined',
        declinedAt: body.releaseReason === 'expired' ? null : now,
        releaseNote: body.releaseNote || null,
        releaseReason: body.releaseReason,
        releasedAt: now,
        metadata: {
          ...objectValue(claim.metadata),
          releasedByEmployerContactDocumentId: body.releasedByEmployerContactDocumentId || null,
          releasedRequestId: requestContext.requestId,
          releasedSource: 'employer_dashboard',
        },
      },
      populate: ['employer', 'employerContact', 'interviewRequest'],
    });

    if (requestDocumentId) {
      const activeClaims = await findActiveClaimsForRequest(strapi, requestDocumentId);
      const activeClaimCount = activeClaims.reduce(
        (total, activeClaim) => total + integerValue(activeClaim.claimCount, 1),
        0
      );

      await documents(strapi, 'api::interview-request.interview-request').update({
        documentId: requestDocumentId,
        data: {
          candidateVisibleState: activeClaimCount > 0 ? 'arranging_interviews' : 'blocked',
          claimedInterviewCount: activeClaimCount,
          lastCapacityCheckAt: now,
          requestState: activeClaimCount > 0 ? 'employer_notified' : 'pending_capacity',
        },
      });

      await routeInterviewRequest(
        strapi,
        {
          ...request,
          claimedInterviewCount: activeClaimCount,
          requestState: 'pending_capacity',
        },
        requestContext
      );
    }

    await auditEvents(strapi).record({
      actorId: body.releasedByEmployerContactDocumentId || undefined,
      actorType: body.releaseReason === 'expired' ? 'system' : 'employer_contact',
      eventCategory: 'interview',
      eventType:
        body.releaseReason === 'expired'
          ? 'interview_request.capacity_claim_expired'
          : 'interview_request.capacity_claim_declined',
      metadata: {
        capacityClaimDocumentId: body.capacityClaimDocumentId,
        releaseNote: body.releaseNote || null,
        releaseReason: body.releaseReason,
        requestId: requestContext.requestId,
      },
      requestId: requestContext.requestId,
      serviceName: requestContext.serviceName,
      severity: 'warning',
      source: body.releaseReason === 'expired' ? 'core_api' : 'employer_dashboard',
      subjectId: requestDocumentId || body.capacityClaimDocumentId,
      subjectType: requestDocumentId ? 'interview_request' : 'employer_capacity_claim',
      userAgent: requestContext.userAgent,
    });

    return {
      claim: {
        claimState: releasedClaim.claimState,
        documentId: getDocumentId(releasedClaim),
        releaseReason: releasedClaim.releaseReason || null,
      },
      released: true,
    };
  },

  async checkClassInterviewSupply(input: unknown) {
    const body = validateClassSupply(input);
    const classes = await documents(strapi, 'api::class.class').findMany({
      filters: {
        documentId: body.classDocumentId,
      },
      limit: 1,
      populate: ['classArea'],
    });
    const classRecord = classes[0];
    const regionDocumentId = getDocumentId(classRecord?.classArea);

    if (!classRecord || !regionDocumentId) {
      return {
        availableInterviewCapacity: 0,
        ready: false,
        requiredInterviewCapacity: 0,
        reason: 'Class is missing an operating region.',
      };
    }

    const capacity = Math.max(1, integerValue(classRecord.capacity, 1));
    const interviewsGuaranteed = Math.max(0, integerValue(classRecord.interviewsGuaranteed, 0));
    const thresholdPercentage = Math.max(
      1,
      integerValue(classRecord.employerInterviewAvailabilityThresholdPercentage, 150)
    );
    const requiredInterviewCapacity = Math.ceil(
      capacity * interviewsGuaranteed * (thresholdPercentage / 100)
    );
    const eligible = await eligibleEmployerCapacity(strapi, regionDocumentId);
    const availableInterviewCapacity = eligible.reduce(
      (total, employerCapacity) => total + employerCapacity.available,
      0
    );
    const distinctEmployerRequirementMet =
      interviewsGuaranteed <= 1 || eligible.length >= interviewsGuaranteed;
    const capacityRequirementMet = availableInterviewCapacity >= requiredInterviewCapacity;

    return {
      availableInterviewCapacity,
      eligibleEmployerCount: eligible.length,
      ready: capacityRequirementMet && distinctEmployerRequirementMet,
      requiredInterviewCapacity,
      thresholdPercentage,
      reason:
        capacityRequirementMet && distinctEmployerRequirementMet
          ? null
          : !distinctEmployerRequirementMet
            ? `Only ${eligible.length} distinct employer(s) are available for ${interviewsGuaranteed} guaranteed interview(s).`
            : `Employer interview capacity is ${availableInterviewCapacity}/${requiredInterviewCapacity} for this class area.`,
    };
  },
}));

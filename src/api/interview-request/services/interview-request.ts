import { factories } from '@strapi/strapi';
import { errors, validateZodSchema, z } from '@strapi/utils';
import { addWorkingDays } from '../../../utils/working-days';

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
  employerState?: string;
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
  metadata?: unknown;
  name?: string;
  operatingRegions?: DocumentRecord[];
  profileState?: string;
  region?: DocumentRecord;
  regionCommitments?: DocumentRecord[];
  requestState?: string;
  responseSlaWorkingDays?: number;
  releaseNote?: string;
  releaseReason?: string;
  slug?: string;
  title?: string;
  updatedAt?: string;
  availability?: string;
  completedAt?: string;
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

const getIntegerEnv = (name: string, fallback: number) => {
  const value = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

const candidateDashboardInterviewUrl = () =>
  `${trimTrailingSlash(process.env.CANDIDATE_DASHBOARD_BASE_URL || 'http://localhost:3001')}/interviews`;

const integerValue = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : fallback;
};

const displayName = (record?: DocumentRecord | null) =>
  [record?.firstName, record?.lastName].filter(Boolean).join(' ').trim() ||
  String(record?.name || record?.email || record?.documentId || '').trim();

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

export default factories.createCoreService('api::interview-request.interview-request', ({ strapi }) => ({
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

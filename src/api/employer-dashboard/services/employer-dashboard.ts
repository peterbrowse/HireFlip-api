import { errors, validateZodSchema, z } from '@strapi/utils';

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
  candidate?: DocumentRecord;
  candidateNotifiedAt?: string;
  candidateResponseDeadline?: string;
  companyName?: string;
  contactState?: string;
  completedAt?: string;
  createdAt?: string;
  documentId?: string;
  email?: string;
  employer?: DocumentRecord;
  employerContact?: DocumentRecord;
  endTime?: string;
  enrollment?: DocumentRecord;
  firstName?: string;
  id?: number | string;
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
  progressionState?: string;
  region?: string;
  requestedDetailsAt?: string;
  roleTitle?: string;
  scheduledEndTime?: string;
  scheduledStartTime?: string;
  slotState?: string;
  slots?: DocumentRecord[];
  startTime?: string;
  submittedAt?: string;
  updatedAt?: string;
};

type DocumentCollection = {
  create(input: Record<string, unknown>): Promise<DocumentRecord>;
  findMany(input: Record<string, unknown>): Promise<DocumentRecord[]>;
  update(input: Record<string, unknown>): Promise<DocumentRecord>;
};

type StrapiDocumentService = {
  documents(uid: string): unknown;
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

const validateIdentity = validateZodSchema(identitySchema);
const validateCreateInterviewSlotOffer = validateZodSchema(createInterviewSlotOfferSchema);

const documents = (strapi: StrapiDocumentService, uid: string) =>
  strapi.documents(uid) as DocumentCollection;

const getDocumentId = (record?: DocumentRecord | null) =>
  typeof record?.documentId === 'string' ? record.documentId : null;

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
    populate: ['employer'],
  });

  const contact = contacts[0];

  if (!contact || !contact.employer) {
    throw new ValidationError('Employer contact could not be found.');
  }

  if (contact.contactState && !['active', 'invited'].includes(String(contact.contactState))) {
    throw new ValidationError('Employer contact is not active.');
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

const accountPayload = (contact: DocumentRecord) => {
  const employer = contact.employer;

  return {
    assignmentModeLabel: humanize(String(employer?.assignmentMode || 'automatic')),
    cadenceLabel: humanize(String(employer?.interviewCommitmentCadence || 'not_set')),
    commitmentLabel: commitmentLabel(employer),
    companyName: employer?.companyName || 'Employer dashboard',
    contactEmail: contact.email || 'Not recorded',
    contactName: contactDisplayName(contact),
    region: employer?.region || null,
    statusLabel: humanize(String(employer?.employerState || contact.contactState || 'not_connected')),
  };
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

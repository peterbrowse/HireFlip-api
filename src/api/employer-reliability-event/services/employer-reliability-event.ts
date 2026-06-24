import { factories } from '@strapi/strapi';
import { errors } from '@strapi/utils';

const { ValidationError } = errors;

type RequestContext = {
  ipAddress?: string;
  requestId?: string;
  serviceName?: string;
  userAgent?: string;
};

type DocumentRecord = Record<string, unknown> & {
  candidate?: DocumentRecord;
  companyName?: string;
  contactRole?: string;
  contactState?: string;
  documentId?: string;
  email?: string;
  employer?: DocumentRecord;
  employerContact?: DocumentRecord;
  eventAt?: string;
  eventState?: string;
  eventType?: string;
  firstName?: string;
  id?: number | string;
  lastName?: string;
  metadata?: unknown;
  name?: string;
  outcome?: string;
  reliabilityEvents?: DocumentRecord[];
  sourceDocumentId?: string;
  sourceType?: string;
  strikeNumber?: number;
  title?: string;
  summary?: string;
};

type AdminActor = {
  displayName?: string | null;
  email?: string | null;
  id?: string | null;
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
  };
};

type ReliabilityEventType =
  | 'capacity_claim_expired'
  | 'interview_details_overdue'
  | 'interview_details_released'
  | 'feedback_overdue'
  | 'employer_no_show'
  | 'employer_cancelled'
  | 'reschedule_requested'
  | 'manual_warning'
  | 'manual_strike'
  | 'reliability_reset';

type ReliabilityOutcome = 'note' | 'reset' | 'strike' | 'warning';
type ReliabilitySourceType = 'admin' | 'employer_capacity_claim' | 'interview' | 'interview_request' | 'system';

type RecordReliabilityEventInput = {
  capacityClaim?: DocumentRecord;
  candidate?: DocumentRecord;
  employer?: DocumentRecord;
  employerContact?: DocumentRecord;
  employerDocumentId?: string;
  eventAt?: string;
  eventType: ReliabilityEventType;
  forceOutcome?: ReliabilityOutcome;
  internalNote?: string;
  interview?: DocumentRecord;
  metadata?: Record<string, unknown>;
  notifyEmployer?: boolean;
  sourceDocumentId?: string;
  sourceType: ReliabilitySourceType;
  summary?: string;
  title: string;
};

type ActionReliabilityEventInput = {
  action: 'acknowledge' | 'apply_strike' | 'apply_warning' | 'clear' | 'reset_employer';
  actor?: AdminActor;
  employerDocumentId?: string;
  eventDocumentId?: string;
  internalNote?: string;
  sourceDocumentId?: string;
  sourceType?: ReliabilitySourceType;
  summary?: string;
  title?: string;
};

const documents = (strapi: StrapiDocumentService, uid: string) =>
  strapi.documents(uid) as unknown as DocumentCollection;

const auditEvents = (strapi: StrapiDocumentService) =>
  strapi.service('api::audit-event.audit-event') as unknown as AuditEventService;

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

const getDocumentId = (record?: DocumentRecord | null) =>
  typeof record?.documentId === 'string'
    ? record.documentId
    : typeof record?.id === 'number' || typeof record?.id === 'string'
      ? String(record.id)
      : undefined;

const documentRecordValue = (value: unknown): DocumentRecord | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as DocumentRecord)
    : undefined;

const objectValue = (value: unknown) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const relationConnect = (record?: unknown) => {
  const documentRecord = documentRecordValue(record);
  const documentId = getDocumentId(documentRecord);

  return documentId
    ? {
        connect: [{ documentId }],
      }
    : undefined;
};

const displayName = (record?: DocumentRecord | null) =>
  [record?.firstName, record?.lastName].filter(Boolean).join(' ').trim() ||
  String(record?.name || record?.email || record?.documentId || '').trim();

const humanize = (value?: string | null) =>
  String(value || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());

const activeEmployerContacts = (employer?: DocumentRecord | null) =>
  (Array.isArray(employer?.contacts) ? employer.contacts : []).filter(
    (contact) => !['archived', 'disabled'].includes(String(contact.contactState || ''))
  );

const leadEmployerContact = (employer?: DocumentRecord | null) =>
  activeEmployerContacts(employer).find((contact) => contact.contactRole === 'lead_contact') ||
  activeEmployerContacts(employer)[0] ||
  null;

const findEmployer = async (
  strapi: StrapiDocumentService,
  input: { employer?: DocumentRecord; employerDocumentId?: string }
) => {
  const existing = documentRecordValue(input.employer);

  if (existing?.documentId && Array.isArray(existing.contacts)) {
    return existing;
  }

  const employerDocumentId = input.employerDocumentId || getDocumentId(existing);

  if (!employerDocumentId) {
    return existing || null;
  }

  const employers = await documents(strapi, 'api::employer.employer').findMany({
    filters: {
      documentId: employerDocumentId,
    },
    limit: 1,
    populate: {
      contacts: true,
    },
  });

  return employers[0] || existing || null;
};

const requestNotificationServiceEmail = async ({
  cc,
  correlationId,
  subject,
  template,
  to,
  type,
}: {
  cc?: string[];
  correlationId?: string;
  subject: string;
  template: {
    key: string;
    variables?: Record<string, unknown>;
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
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(`${trimTrailingSlash(baseUrl)}/api/internal/notifications/email`, {
      body: JSON.stringify({
        correlationId,
        priority: 'urgent',
        source: 'core-api',
        subject,
        template,
        to,
        type,
        ...(cc?.filter(Boolean).length ? { cc: cc.filter(Boolean) } : {}),
      }),
      headers: {
        'content-type': 'application/json',
        'x-hireflip-service-name': 'core-api',
        'x-hireflip-service-token': serviceToken,
      },
      method: 'POST',
      signal: controller.signal,
    });

    if (!response.ok) {
      return undefined;
    }

    return (await response.json()) as NotificationServiceQueueResponse;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
};

const employerDashboardSettingsUrl = () =>
  `${trimTrailingSlash(process.env.EMPLOYER_DASHBOARD_BASE_URL || 'http://localhost:3004')}/settings`;

const activeReliabilityFilters = (employerDocumentId: string) => ({
  employer: {
    documentId: employerDocumentId,
  },
  eventState: {
    $in: ['active', 'acknowledged'],
  },
  outcome: {
    $in: ['warning', 'strike'],
  },
});

const findExistingSourceEvent = async (
  strapi: StrapiDocumentService,
  {
    employerDocumentId,
    eventType,
    sourceDocumentId,
    sourceType,
  }: {
    employerDocumentId: string;
    eventType: ReliabilityEventType;
    sourceDocumentId?: string;
    sourceType: ReliabilitySourceType;
  }
) => {
  if (!sourceDocumentId) {
    return null;
  }

  const events = await documents(strapi, 'api::employer-reliability-event.employer-reliability-event').findMany({
    filters: {
      ...activeReliabilityFilters(employerDocumentId),
      eventType,
      sourceDocumentId,
      sourceType,
    },
    limit: 1,
    sort: ['eventAt:desc', 'createdAt:desc'],
  });

  return events[0] || null;
};

const determineOutcome = async (
  strapi: StrapiDocumentService,
  employerDocumentId: string,
  forceOutcome?: ReliabilityOutcome
) => {
  const events = await documents(strapi, 'api::employer-reliability-event.employer-reliability-event').findMany({
    filters: activeReliabilityFilters(employerDocumentId),
    limit: 200,
  });
  const strikeCount = events.filter((event) => event.outcome === 'strike').length;

  if (forceOutcome) {
    return {
      outcome: forceOutcome,
      strikeNumber: forceOutcome === 'strike' ? strikeCount + 1 : 0,
    };
  }

  return {
    outcome: events.length > 0 ? 'strike' : 'warning',
    strikeNumber: events.length > 0 ? strikeCount + 1 : 0,
  };
};

const createNotificationEvent = async ({
  employer,
  event,
  recipient,
  result,
  strapi,
}: {
  employer: DocumentRecord;
  event: DocumentRecord;
  recipient: DocumentRecord;
  result?: NotificationServiceQueueResponse;
  strapi: StrapiDocumentService;
}) => {
  await documents(strapi, 'api::notification-event.notification-event').create({
    data: {
      channel: 'email',
      deliveryState: result?.data?.queued === true ? 'queued' : 'failed',
      employer: relationConnect(employer),
      eventType: `employer.reliability_${event.outcome}`,
      metadata: {
        employerReliabilityEventDocumentId: getDocumentId(event),
        notificationServiceJobId:
          typeof result?.data?.jobId === 'string' ? result.data.jobId : undefined,
      },
      priority: 'urgent',
      recipientEmail: String(recipient.email),
      recipientId: getDocumentId(recipient),
      recipientType: 'employer_contact',
      relatedId: getDocumentId(event),
      relatedType: 'employer_reliability_event',
      templateKey: 'generic_branded_message',
    },
  });
};

const notifyEmployerReliabilityEvent = async ({
  employer,
  event,
  preferredContact,
  strapi,
}: {
  employer: DocumentRecord;
  event: DocumentRecord;
  preferredContact?: DocumentRecord;
  strapi: StrapiDocumentService;
}) => {
  const leadContact = leadEmployerContact(employer);
  const recipient = preferredContact?.email ? preferredContact : leadContact;

  if (!recipient?.email) {
    return false;
  }

  const recipientEmail = String(recipient.email);
  const leadEmail = leadContact?.email ? String(leadContact.email) : null;
  const cc = leadEmail && leadEmail !== recipientEmail ? [leadEmail] : undefined;
  const outcomeLabel = event.outcome === 'strike' ? 'Reliability strike' : 'Reliability warning';
  const subject = `${outcomeLabel}: ${event.title || 'Employer SLA event'}`;
  const bodyLines = [
    `Hi ${recipient.firstName || 'there'},`,
    event.summary ||
      'HireFlip has recorded an employer reliability event connected to your interview commitments.',
    event.outcome === 'strike'
      ? 'This has been recorded as a reliability strike. Please review the issue and keep future interview commitments within the agreed SLA.'
      : 'This has been recorded as a warning. Please review the issue so it does not become a pattern.',
  ];
  const result = await requestNotificationServiceEmail({
    cc,
    correlationId: getDocumentId(event),
    subject,
    template: {
      key: 'generic_branded_message',
      variables: {
        bodyLines,
        ctaLabel: 'Review account',
        ctaUrl: employerDashboardSettingsUrl(),
        heading: subject,
        subject,
      },
    },
    to: recipientEmail,
    type: `employer_reliability_${event.outcome}`,
  });

  await createNotificationEvent({
    employer,
    event,
    recipient,
    result,
    strapi,
  });

  await documents(strapi, 'api::employer-reliability-event.employer-reliability-event').update({
    documentId: getDocumentId(event),
    data: {
      employerNotificationSentAt: new Date().toISOString(),
      leadCcEmail: cc?.[0] || null,
    },
  });

  return result?.data?.queued === true;
};

const eventPayload = (event: DocumentRecord) => ({
  documentId: getDocumentId(event) || null,
  eventAt: event.eventAt || null,
  eventState: event.eventState || null,
  eventType: event.eventType || null,
  eventTypeLabel: humanize(String(event.eventType || '')),
  outcome: event.outcome || null,
  sourceDocumentId: event.sourceDocumentId || null,
  sourceType: event.sourceType || null,
  strikeNumber: Number(event.strikeNumber || 0),
  summary: event.summary || null,
  title: event.title || null,
});

export default factories.createCoreService(
  'api::employer-reliability-event.employer-reliability-event' as never,
  ({ strapi }) => ({
    async recordEvent(input: RecordReliabilityEventInput, requestContext: RequestContext = {}) {
      const employer = await findEmployer(strapi, input);
      const employerDocumentId = getDocumentId(employer);

      if (!employer || !employerDocumentId) {
        return {
          created: false,
          event: null,
          reason: 'missing_employer',
        };
      }

      const existing = await findExistingSourceEvent(strapi, {
        employerDocumentId,
        eventType: input.eventType,
        sourceDocumentId: input.sourceDocumentId,
        sourceType: input.sourceType,
      });

      if (existing) {
        return {
          created: false,
          event: eventPayload(existing),
          reason: 'duplicate_source_event',
        };
      }

      const outcomeResult = await determineOutcome(strapi, employerDocumentId, input.forceOutcome);
      const outcome = outcomeResult.outcome as ReliabilityOutcome;
      const strikeNumber = outcomeResult.strikeNumber;
      const now = new Date().toISOString();
      const event = await documents(strapi, 'api::employer-reliability-event.employer-reliability-event').create({
        data: {
          capacityClaim: relationConnect(input.capacityClaim),
          candidate: relationConnect(input.candidate),
          employer: relationConnect(employer),
          employerContact: relationConnect(input.employerContact),
          eventAt: input.eventAt || now,
          eventState: outcome === 'reset' ? 'reset' : 'active',
          eventType: input.eventType,
          internalNote: input.internalNote || null,
          interview: relationConnect(input.interview),
          metadata: {
            ...objectValue(input.metadata),
            requestId: requestContext.requestId,
          },
          outcome,
          sourceDocumentId: input.sourceDocumentId || null,
          sourceType: input.sourceType,
          strikeNumber,
          summary: input.summary || null,
          title: input.title,
        },
      });

      if (input.notifyEmployer !== false && ['warning', 'strike'].includes(outcome)) {
        await notifyEmployerReliabilityEvent({
          employer,
          event,
          preferredContact: input.employerContact,
          strapi,
        });
      }

      await auditEvents(strapi).record({
        actorType: requestContext.serviceName ? 'service' : 'system',
        eventCategory: 'employer',
        eventType: `employer.reliability_${outcome}_recorded`,
        ipAddress: requestContext.ipAddress,
        metadata: {
          employerReliabilityEventDocumentId: getDocumentId(event),
          sourceDocumentId: input.sourceDocumentId || null,
          sourceType: input.sourceType,
        },
        requestId: requestContext.requestId,
        serviceName: requestContext.serviceName,
        severity: outcome === 'strike' ? 'warning' : 'info',
        source: 'core_api',
        subjectDisplayName: String(employer.companyName || employerDocumentId),
        subjectId: employerDocumentId,
        subjectType: 'employer',
        userAgent: requestContext.userAgent,
      });

      return {
        created: true,
        event: eventPayload(event),
      };
    },

    async summaryForEmployer(employerDocumentId: string) {
      if (!employerDocumentId) {
        return {
          latestEventAt: null,
          recentEvents: [],
          state: 'clear',
          strikeCount: 0,
          warningCount: 0,
        };
      }

      const events = await documents(strapi, 'api::employer-reliability-event.employer-reliability-event').findMany({
        filters: activeReliabilityFilters(employerDocumentId),
        limit: 25,
        sort: ['eventAt:desc', 'createdAt:desc'],
      });
      const strikeCount = events.filter((event) => event.outcome === 'strike').length;
      const warningCount = events.filter((event) => event.outcome === 'warning').length;

      return {
        latestEventAt: events[0]?.eventAt || null,
        recentEvents: events.slice(0, 5).map(eventPayload),
        state: strikeCount > 0 ? 'strike' : warningCount > 0 ? 'warning' : 'clear',
        strikeCount,
        warningCount,
      };
    },

    async action(input: ActionReliabilityEventInput, requestContext: RequestContext = {}) {
      const now = new Date().toISOString();
      const actor = input.actor || {};

      if (input.action === 'apply_warning' || input.action === 'apply_strike') {
        if (!input.employerDocumentId) {
          throw new ValidationError('Employer ID is required.');
        }

        return (
          strapi.service('api::employer-reliability-event.employer-reliability-event') as {
            recordEvent(input: RecordReliabilityEventInput, context?: RequestContext): Promise<unknown>;
          }
        ).recordEvent(
          {
            employerDocumentId: input.employerDocumentId,
            eventAt: now,
            eventType: input.action === 'apply_warning' ? 'manual_warning' : 'manual_strike',
            forceOutcome: input.action === 'apply_warning' ? 'warning' : 'strike',
            internalNote: input.internalNote,
            metadata: {
              actionedByEmail: actor.email || null,
              actionedByName: actor.displayName || null,
            },
            sourceDocumentId: input.sourceDocumentId,
            sourceType: input.sourceType || 'admin',
            summary: input.summary,
            title:
              input.title ||
              (input.action === 'apply_warning'
                ? 'Manual employer reliability warning'
                : 'Manual employer reliability strike'),
          },
          requestContext
        );
      }

      if (input.action === 'reset_employer') {
        if (!input.employerDocumentId || !input.internalNote?.trim()) {
          throw new ValidationError('Employer ID and reset reason are required.');
        }

        const events = await documents(strapi, 'api::employer-reliability-event.employer-reliability-event').findMany({
          filters: activeReliabilityFilters(input.employerDocumentId),
          limit: 500,
        });

        for (const event of events) {
          const documentId = getDocumentId(event);

          if (documentId) {
            await documents(strapi, 'api::employer-reliability-event.employer-reliability-event').update({
              documentId,
              data: {
                actionedByEmail: actor.email || null,
                actionedByName: actor.displayName || null,
                eventState: 'reset',
                internalNote: input.internalNote,
                resetAt: now,
              },
            });
          }
        }

        return (
          strapi.service('api::employer-reliability-event.employer-reliability-event') as {
            recordEvent(input: RecordReliabilityEventInput, context?: RequestContext): Promise<unknown>;
          }
        ).recordEvent(
          {
            employerDocumentId: input.employerDocumentId,
            eventAt: now,
            eventType: 'reliability_reset',
            forceOutcome: 'reset',
            internalNote: input.internalNote,
            metadata: {
              actionedByEmail: actor.email || null,
              actionedByName: actor.displayName || null,
              resetEventCount: events.length,
            },
            notifyEmployer: false,
            sourceDocumentId: input.employerDocumentId,
            sourceType: 'admin',
            summary: input.summary || 'Employer reliability warning and strike state was reset by staff.',
            title: input.title || 'Employer reliability reset',
          },
          requestContext
        );
      }

      if (!input.eventDocumentId) {
        throw new ValidationError('Reliability event ID is required.');
      }

      const events = await documents(strapi, 'api::employer-reliability-event.employer-reliability-event').findMany({
        filters: {
          documentId: input.eventDocumentId,
        },
        limit: 1,
      });
      const event = events[0];

      if (!event) {
        throw new ValidationError('Reliability event could not be found.');
      }

      if (input.action === 'clear' && !input.internalNote?.trim()) {
        throw new ValidationError('A note is required when clearing a reliability event.');
      }

      const data =
        input.action === 'clear'
          ? {
              actionedByEmail: actor.email || null,
              actionedByName: actor.displayName || null,
              clearedAt: now,
              eventState: 'cleared',
              internalNote: input.internalNote,
            }
          : {
              acknowledgedAt: now,
              actionedByEmail: actor.email || null,
              actionedByName: actor.displayName || null,
              eventState: 'acknowledged',
              internalNote: input.internalNote || event.internalNote || null,
            };

      const updated = await documents(strapi, 'api::employer-reliability-event.employer-reliability-event').update({
        documentId: input.eventDocumentId,
        data,
      });

      await auditEvents(strapi).record({
        actorDisplayName: actor.displayName || undefined,
        actorEmail: actor.email || undefined,
        actorId: actor.id || undefined,
        actorType: 'admin',
        eventCategory: 'employer',
        eventType: `employer.reliability_event_${input.action}`,
        ipAddress: requestContext.ipAddress,
        metadata: {
          employerReliabilityEventDocumentId: input.eventDocumentId,
          internalNote: input.internalNote || null,
        },
        requestId: requestContext.requestId,
        serviceName: requestContext.serviceName,
        severity: input.action === 'clear' ? 'warning' : 'info',
        source: 'admin_dashboard',
        subjectId: input.eventDocumentId,
        subjectType: 'employer_reliability_event',
        userAgent: requestContext.userAgent,
      });

      return {
        event: eventPayload(updated),
        updated: true,
      };
    },
  })
);

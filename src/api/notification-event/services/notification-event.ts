import { factories } from '@strapi/strapi';
import { errors, validateZodSchema, z } from '@strapi/utils';
import { publishAdminRealtimeEvent } from '../../../utils/admin-realtime-events';

const { ValidationError } = errors;

type RequestContext = {
  ipAddress?: string;
  requestId?: string;
  serviceName?: string;
  userAgent?: string;
};

type DocumentRecord = Record<string, unknown> & {
  candidate?: DocumentRecord;
  channel?: string;
  deliveryState?: NotificationDeliveryState;
  documentId?: string;
  employer?: DocumentRecord;
  errorMessage?: string;
  eventType?: string;
  failedAt?: string;
  id?: number | string;
  metadata?: unknown;
  priority?: string;
  provider?: string;
  providerMessageId?: string;
  recipientEmail?: string;
  recipientId?: string;
  recipientType?: string;
  relatedId?: string;
  relatedType?: string;
  templateKey?: string;
};

type DocumentCollection = {
  count(input: Record<string, unknown>): Promise<number>;
  create(input: Record<string, unknown>): Promise<DocumentRecord>;
  findMany(input: Record<string, unknown>): Promise<DocumentRecord[]>;
  update(input: Record<string, unknown>): Promise<DocumentRecord>;
};

type StrapiDocumentService = {
  documents(uid: string): unknown;
  log?: {
    warn?: (message: string, error?: unknown) => void;
  };
  service(uid: string): unknown;
};

type AuditEventService = {
  record(input: unknown): Promise<unknown>;
};

const deliveryStateSchema = z.enum([
  'processed',
  'delivered',
  'deferred',
  'failed',
  'bounced',
  'dropped',
  'blocked',
  'suppressed',
  'spam_reported',
]);

type NotificationDeliveryState = z.infer<typeof deliveryStateSchema>;

const providerStatusSchema = z.object({
  correlationId: z.string().trim().max(160).optional(),
  deliveryState: deliveryStateSchema,
  event: z.string().trim().min(1).max(120),
  notificationServiceJobId: z.string().trim().max(160).optional(),
  notificationType: z.string().trim().max(160).optional(),
  occurredAt: z.string().datetime(),
  provider: z.literal('sendgrid'),
  providerEventId: z.string().trim().min(1).max(500),
  providerMessageId: z.string().trim().max(500).optional(),
  rawEvent: z.unknown().optional(),
  reason: z.string().trim().max(1000).optional(),
  recipientEmail: z.string().trim().email().max(254).optional(),
  source: z.string().trim().max(120).optional(),
});

const validateProviderStatus = validateZodSchema(providerStatusSchema);

type ProviderStatusInput = z.infer<typeof providerStatusSchema>;

const documents = (strapi: StrapiDocumentService, uid: string) =>
  strapi.documents(uid) as DocumentCollection;

const findAllDocuments = async (
  strapi: StrapiDocumentService,
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

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const metadataFor = (event: DocumentRecord) => (isObject(event.metadata) ? event.metadata : {});

const normalizeEmail = (email?: string) => (email || '').trim().toLowerCase();

const terminalFailureStates = new Set<NotificationDeliveryState>([
  'failed',
  'bounced',
  'dropped',
  'blocked',
  'suppressed',
  'spam_reported',
]);

const degradedStates = new Set<NotificationDeliveryState>([
  'deferred',
  ...terminalFailureStates,
]);

const isHighValueNotificationEvent = (event: DocumentRecord) => {
  const haystack = [
    event.eventType,
    event.templateKey,
    event.relatedType,
    event.priority,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (['high', 'urgent'].includes(String(event.priority || ''))) {
    return true;
  }

  return [
    '2fa',
    'otp',
    'staff',
    'invite',
    'support',
    'refund',
    'interview',
    'feedback',
    'appeal',
    'amendment',
    'payment',
    'enrollment',
  ].some((keyword) => haystack.includes(keyword));
};

const relationDocumentId = (record?: DocumentRecord) =>
  typeof record?.documentId === 'string' ? record.documentId : undefined;

const findNotificationEvent = async (
  strapi: StrapiDocumentService,
  body: ProviderStatusInput
) => {
  if (body.providerMessageId) {
    const providerMatches = await documents(strapi, 'api::notification-event.notification-event').findMany({
      filters: {
        provider: body.provider,
        providerMessageId: body.providerMessageId,
      },
      limit: 1,
      populate: ['candidate', 'employer'],
      sort: ['updatedAt:desc', 'createdAt:desc'],
    });

    if (providerMatches.length > 0) {
      return providerMatches[0];
    }
  }

  const filters: Record<string, unknown> = {
    channel: 'email',
  };

  if (body.recipientEmail) {
    filters.recipientEmail = normalizeEmail(body.recipientEmail);
  }

  if (body.notificationType) {
    filters.eventType = body.notificationType;
  }

  const candidates = await findAllDocuments(strapi, 'api::notification-event.notification-event', {
    filters,
    populate: ['candidate', 'employer'],
    sort: ['createdAt:desc'],
  });

  if (body.notificationServiceJobId) {
    const jobMatch = candidates.find(
      (event) => metadataFor(event).notificationServiceJobId === body.notificationServiceJobId
    );

    if (jobMatch) {
      return jobMatch;
    }
  }

  if (body.correlationId) {
    const correlationMatch = candidates.find((event) => {
      const metadata = metadataFor(event);

      return (
        metadata.correlationId === body.correlationId ||
        metadata.requestId === body.correlationId ||
        metadata.notificationCorrelationId === body.correlationId
      );
    });

    if (correlationMatch) {
      return correlationMatch;
    }
  }

  return candidates[0];
};

const providerSummaryFor = (body: ProviderStatusInput) => ({
  deliveryState: body.deliveryState,
  event: body.event,
  occurredAt: body.occurredAt,
  provider: body.provider,
  providerEventId: body.providerEventId,
  providerMessageId: body.providerMessageId || null,
  reason: body.reason || null,
  recipientEmail: body.recipientEmail || null,
});

const nextMetadataFor = (event: DocumentRecord, body: ProviderStatusInput) => {
  const currentMetadata = metadataFor(event);
  const currentHistory = Array.isArray(currentMetadata.providerDeliveryHistory)
    ? currentMetadata.providerDeliveryHistory
    : [];
  const summary = providerSummaryFor(body);

  return {
    ...currentMetadata,
    providerDelivery: summary,
    providerDeliveryHistory: [...currentHistory, summary].slice(-20),
  };
};

const updateRecipientEmailIssue = async (
  strapi: StrapiDocumentService,
  event: DocumentRecord,
  body: ProviderStatusInput
) => {
  if (!terminalFailureStates.has(body.deliveryState)) {
    return;
  }

  const issue = {
    deliveryState: body.deliveryState,
    detectedAt: body.occurredAt,
    eventType: event.eventType || body.notificationType || null,
    provider: body.provider,
    providerEventId: body.providerEventId,
    reason: body.reason || null,
  };

  const updateNotificationPreferences = async (uid: string, documentId?: string) => {
    if (!documentId) {
      return;
    }

    const [record] = await documents(strapi, uid).findMany({
      filters: {
        documentId,
      },
      limit: 1,
    });

    if (!record?.documentId) {
      return;
    }

    await documents(strapi, uid).update({
      documentId: record.documentId,
      data: {
        notificationPreferences: {
          ...(isObject(record.notificationPreferences) ? record.notificationPreferences : {}),
          emailDeliveryIssue: issue,
        },
      },
    });
  };

  if (event.recipientType === 'candidate') {
    await updateNotificationPreferences(
      'api::candidate.candidate',
      event.recipientId || relationDocumentId(event.candidate)
    );
  }

  if (event.recipientType === 'employer_contact') {
    await updateNotificationPreferences('api::employer-contact.employer-contact', event.recipientId);
  }
};

const recordProviderAudit = async (
  strapi: StrapiDocumentService,
  event: DocumentRecord,
  body: ProviderStatusInput,
  requestContext: RequestContext
) => {
  if (!degradedStates.has(body.deliveryState)) {
    return;
  }

  const auditEventService = strapi.service('api::audit-event.audit-event') as AuditEventService;
  const severity = body.deliveryState === 'deferred' ? 'warning' : 'error';

  await auditEventService.record({
    actorDisplayName: 'Notification service',
    actorId: requestContext.serviceName || 'notification-service',
    actorType: 'service',
    correlationId: body.correlationId,
    eventCategory: 'notification',
    eventType: `notification.email.${body.deliveryState}`,
    ipAddress: requestContext.ipAddress,
    metadata: {
      deliveryState: body.deliveryState,
      eventType: event.eventType || body.notificationType || null,
      notificationServiceJobId: body.notificationServiceJobId || null,
      provider: body.provider,
      providerEventId: body.providerEventId,
      providerMessageId: body.providerMessageId || null,
      recipientEmail: body.recipientEmail || event.recipientEmail || null,
      reason: body.reason || null,
      templateKey: event.templateKey || null,
    },
    newState: {
      deliveryState: body.deliveryState,
      errorMessage: body.reason || null,
    },
    occurredAt: body.occurredAt,
    previousState: {
      deliveryState: event.deliveryState || null,
      errorMessage: event.errorMessage || null,
    },
    requestId: requestContext.requestId,
    serviceName: requestContext.serviceName || 'notification-service',
    severity,
    source: 'notification_service',
    subjectId: event.documentId,
    subjectType: 'notification_event',
    userAgent: requestContext.userAgent,
  });
};

const updateNotificationEvent = async (
  strapi: StrapiDocumentService,
  event: DocumentRecord,
  body: ProviderStatusInput
) => {
  if (!event.documentId) {
    throw new ValidationError('Notification event is missing a document id.');
  }

  const deliveryState = body.deliveryState;
  const isTerminalFailure = terminalFailureStates.has(deliveryState);

  return documents(strapi, 'api::notification-event.notification-event').update({
    documentId: event.documentId,
    data: {
      deliveryState,
      errorMessage: degradedStates.has(deliveryState) ? body.reason || body.event : null,
      failedAt: isTerminalFailure ? body.occurredAt : null,
      ...(deliveryState === 'processed' ? { sentAt: body.occurredAt } : {}),
      ...(deliveryState === 'delivered' ? { deliveredAt: body.occurredAt } : {}),
      provider: body.provider,
      providerMessageId: body.providerMessageId || event.providerMessageId || null,
      metadata: nextMetadataFor(event, body),
      priority:
        isTerminalFailure && isHighValueNotificationEvent(event) ? 'high' : event.priority || 'normal',
    },
  });
};

export default factories.createCoreService('api::notification-event.notification-event', ({ strapi }) => ({
  async recordProviderStatus(input: unknown, requestContext: RequestContext = {}) {
    const body: ProviderStatusInput = validateProviderStatus(input);
    const event = await findNotificationEvent(strapi, body);

    if (!event?.documentId) {
      await (strapi.service('api::audit-event.audit-event') as AuditEventService).record({
        actorDisplayName: 'Notification service',
        actorId: requestContext.serviceName || 'notification-service',
        actorType: 'service',
        correlationId: body.correlationId,
        eventCategory: 'notification',
        eventType: 'notification.email.provider_event_unmatched',
        metadata: {
          deliveryState: body.deliveryState,
          notificationServiceJobId: body.notificationServiceJobId || null,
          notificationType: body.notificationType || null,
          provider: body.provider,
          providerEventId: body.providerEventId,
          providerMessageId: body.providerMessageId || null,
          recipientEmail: body.recipientEmail || null,
        },
        occurredAt: body.occurredAt,
        requestId: requestContext.requestId,
        serviceName: requestContext.serviceName || 'notification-service',
        severity: 'warning',
        source: 'notification_service',
        subjectType: 'notification_event',
      });

      return {
        matched: false,
        providerEventId: body.providerEventId,
      };
    }

    const updatedEvent = await updateNotificationEvent(strapi, event, body);

    await Promise.all([
      recordProviderAudit(strapi, event, body, requestContext),
      updateRecipientEmailIssue(strapi, event, body).catch((error) => {
        strapi.log?.warn?.('Recipient email issue flag could not be updated.', error);
      }),
    ]);

    if (terminalFailureStates.has(body.deliveryState) && isHighValueNotificationEvent(event)) {
      await publishAdminRealtimeEvent(
        {
          channels: ['operations', 'support'],
          resourceKey: event.documentId,
          resourceType: 'notification_event',
          type: 'admin_tasks_changed',
        },
        strapi.log
      );
    }

    return {
      deliveryState: updatedEvent.deliveryState,
      matched: true,
      notificationEventDocumentId: updatedEvent.documentId,
      providerEventId: body.providerEventId,
    };
  },
}));

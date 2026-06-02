import { factories } from '@strapi/strapi';
import { errors, validateZodSchema, z } from '@strapi/utils';

const { ValidationError } = errors;

type RequestContext = {
  ipAddress?: string;
  requestId?: string;
  serviceName?: string;
  userAgent?: string;
};

type DocumentRecord = Record<string, unknown> & {
  documentId?: string;
  status?: string;
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

type PaymentConfirmationResult = {
  payment?: {
    documentId?: string;
  } | null;
};

type CandidateService = {
  confirmClassReservationPaymentFromProvider(
    input: unknown,
    context: RequestContext
  ): Promise<PaymentConfirmationResult>;
  recordClassReservationPaymentProviderOutcome(
    input: unknown,
    eventType: string,
    context: RequestContext
  ): Promise<PaymentConfirmationResult>;
};

type PaymentWebhookEventService = {
  receiveStripeEvent(input: unknown, context: RequestContext): Promise<unknown>;
};

const documents = (strapi: StrapiDocumentService, uid: string) =>
  strapi.documents(uid) as unknown as DocumentCollection;

const candidateService = (strapi: StrapiDocumentService) =>
  strapi.service('api::candidate.candidate') as unknown as CandidateService;

const objectValue = (value: unknown) => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
};

const checkoutSessionSchema = z
  .object({
    amountTotal: z.number().int().nonnegative().optional(),
    checkoutSessionId: z.string().trim().min(1).max(255),
    checkoutUrl: z.string().trim().url().nullable().optional(),
    clientReferenceId: z.string().trim().max(255).nullable().optional(),
    currency: z.string().trim().min(3).max(3).nullable().optional(),
    customerId: z.string().trim().max(255).optional(),
    metadata: z.unknown().optional().transform((value) => objectValue(value)),
    paymentIntentId: z.string().trim().max(255).optional(),
    paymentProvider: z.literal('stripe').default('stripe'),
    paymentStatus: z.string().trim().min(1).max(80),
    status: z.string().trim().min(1).max(80),
  })
  .strict();

const stripeWebhookEventSchema = z
  .object({
    checkoutSession: checkoutSessionSchema,
    createdAt: z.string().datetime().optional(),
    eventType: z.string().trim().min(1).max(160),
    livemode: z.boolean().optional(),
    providerEventId: z.string().trim().min(1).max(255),
  })
  .strict();

const validateStripeWebhookEvent = validateZodSchema(stripeWebhookEventSchema);

const completionEventTypes = new Set([
  'checkout.session.async_payment_succeeded',
  'checkout.session.completed',
]);

const findWebhookEvent = async (
  strapi: StrapiDocumentService,
  providerEventId: string
) => {
  const events = await documents(strapi, 'api::payment-webhook-event.payment-webhook-event').findMany({
    filters: {
      providerEventId,
    },
    limit: 1,
    populate: ['payment', 'refund'],
  });

  return events[0];
};

const stringifyError = (error: unknown) =>
  error instanceof Error ? error.message : 'Payment webhook processing failed.';

export default factories.createCoreService('api::payment-webhook-event.payment-webhook-event', ({ strapi }) => ({
  async retryFailedStripeEvents(limit = 50) {
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const failedEvents = await documents(strapi, 'api::payment-webhook-event.payment-webhook-event').findMany({
      filters: {
        paymentProvider: 'stripe',
        status: 'failed',
      },
      limit: safeLimit,
      sort: ['receivedAt:asc', 'createdAt:asc'],
    });
    const summary = {
      failed: 0,
      processed: 0,
      skipped: 0,
      total: failedEvents.length,
    };

    for (const event of failedEvents) {
      const payload = objectValue(event.payload);

      if (!payload.providerEventId) {
        summary.skipped += 1;
        continue;
      }

      try {
        const webhookEventService = strapi.service(
          'api::payment-webhook-event.payment-webhook-event'
        ) as unknown as PaymentWebhookEventService;

        await webhookEventService.receiveStripeEvent(payload, {
          serviceName: 'payment-webhook-reconciliation',
        });
        summary.processed += 1;
      } catch {
        summary.failed += 1;
      }
    }

    return summary;
  },

  async receiveStripeEvent(input: unknown, requestContext: RequestContext = {}) {
    const payload = validateStripeWebhookEvent(input);
    const existingEvent = await findWebhookEvent(strapi, payload.providerEventId);

    if (existingEvent?.status === 'processed' || existingEvent?.status === 'ignored') {
      return {
        duplicate: true,
        providerEventId: payload.providerEventId,
        status: existingEvent.status,
      };
    }

    const receivedAt = new Date().toISOString();
    const webhookEvent = existingEvent?.documentId
      ? await documents(strapi, 'api::payment-webhook-event.payment-webhook-event').update({
          documentId: existingEvent.documentId,
          data: {
            payload,
            processingError: null,
            receivedAt: existingEvent.receivedAt || receivedAt,
            status: 'received',
          },
        })
      : await documents(strapi, 'api::payment-webhook-event.payment-webhook-event').create({
          data: {
            eventType: payload.eventType,
            metadata: {
              checkoutSessionId: payload.checkoutSession.checkoutSessionId,
              livemode: payload.livemode,
              providerCreatedAt: payload.createdAt,
            },
            paymentProvider: 'stripe',
            payload,
            providerEventId: payload.providerEventId,
            receivedAt,
            status: 'received',
          },
        });

    if (!webhookEvent.documentId) {
      throw new ValidationError('Payment webhook event could not be recorded.');
    }

    try {
      const service = candidateService(strapi);
      const confirmationResult =
        completionEventTypes.has(payload.eventType) &&
        payload.checkoutSession.status === 'complete' &&
        payload.checkoutSession.paymentStatus === 'paid'
          ? await service.confirmClassReservationPaymentFromProvider(payload.checkoutSession, {
              ...requestContext,
              serviceName: requestContext.serviceName || 'payment-service',
            })
          : await service.recordClassReservationPaymentProviderOutcome(payload.checkoutSession, payload.eventType, {
              ...requestContext,
              serviceName: requestContext.serviceName || 'payment-service',
            });
      const paymentDocumentId = confirmationResult.payment?.documentId;
      const processedEvent = await documents(strapi, 'api::payment-webhook-event.payment-webhook-event').update({
        documentId: webhookEvent.documentId,
        data: {
          ...(paymentDocumentId
            ? {
                payment: {
                  connect: [{ documentId: paymentDocumentId }],
                },
              }
            : {}),
          processedAt: new Date().toISOString(),
          processingError: null,
          status: paymentDocumentId ? 'processed' : 'ignored',
        },
        populate: ['payment', 'refund'],
      });

      return {
        providerEventId: payload.providerEventId,
        status: processedEvent.status,
      };
    } catch (error) {
      await documents(strapi, 'api::payment-webhook-event.payment-webhook-event').update({
        documentId: webhookEvent.documentId,
        data: {
          processedAt: new Date().toISOString(),
          processingError: stringifyError(error),
          status: 'failed',
        },
      });

      throw error;
    }
  },
}));

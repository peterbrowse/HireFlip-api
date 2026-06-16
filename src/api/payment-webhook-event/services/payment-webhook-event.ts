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
  processingState?: string;
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

type RefundProviderUpdateResult = {
  ignored?: boolean;
  payment?: {
    documentId?: string;
  } | null;
  refund?: {
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

type AdminRefundService = {
  recordProviderRefundUpdate(
    input: unknown,
    context: RequestContext
  ): Promise<RefundProviderUpdateResult>;
};

type PaymentWebhookEventService = {
  receiveStripeEvent(input: unknown, context: RequestContext): Promise<unknown>;
};

const documents = (strapi: StrapiDocumentService, uid: string) =>
  strapi.documents(uid) as unknown as DocumentCollection;

const candidateService = (strapi: StrapiDocumentService) =>
  strapi.service('api::candidate.candidate') as unknown as CandidateService;

const adminRefundService = (strapi: StrapiDocumentService) =>
  strapi.service('api::admin-refund.admin-refund') as unknown as AdminRefundService;

const objectValue = (value: unknown) => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
};

const webhookEventProcessingState = (event?: DocumentRecord) => event?.processingState || event?.status;

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

const providerRefundSchema = z
  .object({
    amountPence: z.number().int().nonnegative(),
    createdAt: z.string().datetime(),
    currency: z.string().trim().min(3).max(3),
    failureReason: z.string().trim().max(255).nullable().optional(),
    metadata: z.unknown().optional().transform((value) => objectValue(value)),
    paymentProvider: z.literal('stripe').default('stripe'),
    providerPaymentIntentId: z.string().trim().max(255).nullable().optional(),
    providerRefundId: z.string().trim().min(1).max(255),
    providerRefundStatus: z.string().trim().max(80).nullable().optional(),
    reason: z.string().trim().max(120).nullable().optional(),
  })
  .strict();

const stripeWebhookEventBaseSchema = z
  .object({
    createdAt: z.string().datetime().optional(),
    eventType: z.string().trim().min(1).max(160),
    livemode: z.boolean().optional(),
    providerEventId: z.string().trim().min(1).max(255),
  })
  .strict();

const stripeCheckoutWebhookEventSchema = stripeWebhookEventBaseSchema
  .extend({
    checkoutSession: checkoutSessionSchema,
  })
  .strict();

const stripeRefundWebhookEventSchema = stripeWebhookEventBaseSchema
  .extend({
    providerRefund: providerRefundSchema,
  })
  .strict();

const stripeWebhookEventSchema = z.union([
  stripeCheckoutWebhookEventSchema,
  stripeRefundWebhookEventSchema,
]);

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
        processingState: 'failed',
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

    if (webhookEventProcessingState(existingEvent) === 'processed' || webhookEventProcessingState(existingEvent) === 'ignored') {
      return {
        duplicate: true,
        providerEventId: payload.providerEventId,
        status: webhookEventProcessingState(existingEvent),
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
            processingState: 'received',
          },
        })
      : await documents(strapi, 'api::payment-webhook-event.payment-webhook-event').create({
          data: {
            eventType: payload.eventType,
            metadata: {
              ...('checkoutSession' in payload
                ? { checkoutSessionId: payload.checkoutSession.checkoutSessionId }
                : { providerRefundId: payload.providerRefund.providerRefundId }),
              livemode: payload.livemode,
              providerCreatedAt: payload.createdAt,
            },
            paymentProvider: 'stripe',
            payload,
            providerEventId: payload.providerEventId,
            receivedAt,
            processingState: 'received',
          },
        });

    if (!webhookEvent.documentId) {
      throw new ValidationError('Payment webhook event could not be recorded.');
    }

    try {
      let paymentDocumentId: string | undefined;
      let refundDocumentId: string | undefined;

      if ('providerRefund' in payload) {
        const refundResult = await adminRefundService(strapi).recordProviderRefundUpdate(
          {
            createdAt: payload.createdAt,
            eventType: payload.eventType,
            livemode: payload.livemode,
            providerEventId: payload.providerEventId,
            providerRefund: payload.providerRefund,
          },
          {
            ...requestContext,
            serviceName: requestContext.serviceName || 'payment-service',
          }
        );

        paymentDocumentId = refundResult.payment?.documentId;
        refundDocumentId = refundResult.refund?.documentId;
      } else {
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

        paymentDocumentId = confirmationResult.payment?.documentId;
      }

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
          ...(refundDocumentId
            ? {
                refund: {
                  connect: [{ documentId: refundDocumentId }],
                },
              }
            : {}),
          processedAt: new Date().toISOString(),
          processingError: null,
          processingState: paymentDocumentId || refundDocumentId ? 'processed' : 'ignored',
        },
        populate: ['payment', 'refund'],
      });

      return {
        providerEventId: payload.providerEventId,
        status: webhookEventProcessingState(processedEvent),
      };
    } catch (error) {
      await documents(strapi, 'api::payment-webhook-event.payment-webhook-event').update({
        documentId: webhookEvent.documentId,
        data: {
          processedAt: new Date().toISOString(),
          processingError: stringifyError(error),
          processingState: 'failed',
        },
      });

      throw error;
    }
  },
}));

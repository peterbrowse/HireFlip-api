import { randomUUID } from 'node:crypto';
import { factories } from '@strapi/strapi';
import { errors, validateZodSchema, z } from '@strapi/utils';
import Redis from 'ioredis';

const { ValidationError } = errors;

let webhookRedisClient: Redis | undefined;
let webhookRedisConnectionPromise: Promise<void> | undefined;

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

const envBool = (name: string, fallback: boolean) => {
  const value = (process.env[name] || '').toLowerCase();

  if (['1', 'true', 'yes', 'on'].includes(value)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(value)) {
    return false;
  }

  return fallback;
};

const envInt = (name: string, fallback: number) => {
  const value = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const webhookRedisUrl = () =>
  process.env.PAYMENT_WEBHOOK_EVENT_REDIS_URL ||
  process.env.CLASS_ALLOCATION_REDIS_URL ||
  process.env.REDIS_URL ||
  'redis://localhost:6379';

const webhookLockPrefix = () =>
  (process.env.PAYMENT_WEBHOOK_EVENT_LOCK_PREFIX || 'hireflip:payment-webhook-event-lock')
    .replace(/:+$/g, '');

const webhookLockTtlMs = () => envInt('PAYMENT_WEBHOOK_EVENT_LOCK_TTL_MS', 30000);
const webhookLockWaitMs = () => envInt('PAYMENT_WEBHOOK_EVENT_LOCK_WAIT_MS', 120000);
const webhookLockPollMs = () => envInt('PAYMENT_WEBHOOK_EVENT_LOCK_POLL_MS', 50);

const getWebhookRedis = () => {
  if (!webhookRedisClient || webhookRedisClient.status === 'end') {
    const url = webhookRedisUrl();

    webhookRedisClient = new Redis(url, {
      commandTimeout: envInt('PAYMENT_WEBHOOK_EVENT_REDIS_COMMAND_TIMEOUT_MS', 2000),
      enableOfflineQueue: false,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
      tls: url.startsWith('rediss://')
        ? {
            rejectUnauthorized: envBool('PAYMENT_WEBHOOK_EVENT_REDIS_TLS_REJECT_UNAUTHORIZED', false),
          }
        : undefined,
    });
    webhookRedisClient.on('error', () => undefined);
  }

  return webhookRedisClient;
};

const ensureWebhookRedis = async () => {
  const redis = getWebhookRedis();

  if (redis.status === 'ready') {
    return redis;
  }

  if (!webhookRedisConnectionPromise) {
    webhookRedisConnectionPromise = redis.connect().then(() => undefined);
  }

  try {
    await webhookRedisConnectionPromise;
  } finally {
    webhookRedisConnectionPromise = undefined;
  }

  if ((redis.status as string) !== 'ready') {
    throw new Error('Payment webhook Redis lock client is not ready.');
  }

  return redis;
};

const releaseWebhookLockScript = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end

return 0
`;

const refreshWebhookLockScript = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], ARGV[2])
end

return 0
`;

const sleep = (durationMs: number) => new Promise((resolve) => setTimeout(resolve, durationMs));

const webhookLockKey = (providerEventId: string) =>
  `${webhookLockPrefix()}:${providerEventId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

const withProviderEventLock = async <TResult>(
  providerEventId: string,
  callback: () => Promise<TResult>
) => {
  if (!envBool('PAYMENT_WEBHOOK_EVENT_LOCK_ENABLED', true)) {
    return callback();
  }

  const redis = await ensureWebhookRedis();
  const key = webhookLockKey(providerEventId);
  const owner = randomUUID();
  const ttlMs = webhookLockTtlMs();
  const waitMs = webhookLockWaitMs();
  const pollMs = webhookLockPollMs();
  const startedAt = Date.now();

  while (Date.now() - startedAt < waitMs) {
    if ((await redis.set(key, owner, 'PX', ttlMs, 'NX')) === 'OK') {
      let refreshTimer: ReturnType<typeof setInterval> | undefined;

      try {
        refreshTimer = setInterval(() => {
          void redis
            .eval(refreshWebhookLockScript, 1, key, owner, String(ttlMs))
            .catch(() => undefined);
        }, Math.max(1000, Math.floor(ttlMs / 3)));
        refreshTimer.unref?.();

        return await callback();
      } finally {
        if (refreshTimer) {
          clearInterval(refreshTimer);
        }

        await redis.eval(releaseWebhookLockScript, 1, key, owner).catch(() => undefined);
      }
    }

    await sleep(pollMs + Math.floor(Math.random() * pollMs));
  }

  throw new Error('Timed out waiting for payment webhook event lock.');
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
    receiptUrl: z.string().trim().url().nullable().optional(),
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

const isUniqueConstraintError = (error: unknown) => {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const value = error as {
    code?: unknown;
    details?: { errors?: unknown[] };
    message?: unknown;
    name?: unknown;
  };
  const message = String(value.message || '').toLowerCase();

  return (
    value.code === '23505' ||
    String(value.name || '').toLowerCase().includes('unique') ||
    message.includes('must be unique') ||
    (message.includes('unique') && message.includes('provider')) ||
    (message.includes('duplicate') && message.includes('provider'))
  );
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

    return withProviderEventLock(payload.providerEventId, async () => {
    const existingEvent = await findWebhookEvent(strapi, payload.providerEventId);

    if (webhookEventProcessingState(existingEvent) === 'processed' || webhookEventProcessingState(existingEvent) === 'ignored') {
      return {
        duplicate: true,
        providerEventId: payload.providerEventId,
        status: webhookEventProcessingState(existingEvent),
      };
    }

    const receivedAt = new Date().toISOString();
    let webhookEvent: DocumentRecord;

    if (existingEvent?.documentId) {
      webhookEvent = await documents(strapi, 'api::payment-webhook-event.payment-webhook-event').update({
        documentId: existingEvent.documentId,
        data: {
          payload,
          processingError: null,
          receivedAt: existingEvent.receivedAt || receivedAt,
          processingState: 'received',
        },
      });
    } else {
      try {
        webhookEvent = await documents(strapi, 'api::payment-webhook-event.payment-webhook-event').create({
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
      } catch (error) {
        if (!isUniqueConstraintError(error)) {
          throw error;
        }

        const racedEvent = await findWebhookEvent(strapi, payload.providerEventId);

        if (
          webhookEventProcessingState(racedEvent) === 'processed' ||
          webhookEventProcessingState(racedEvent) === 'ignored'
        ) {
          return {
            duplicate: true,
            providerEventId: payload.providerEventId,
            status: webhookEventProcessingState(racedEvent),
          };
        }

        if (!racedEvent?.documentId) {
          throw error;
        }

        webhookEvent = await documents(strapi, 'api::payment-webhook-event.payment-webhook-event').update({
          documentId: racedEvent.documentId,
          data: {
            payload,
            processingError: null,
            receivedAt: racedEvent.receivedAt || receivedAt,
            processingState: 'received',
          },
        });
      }
    }

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
    });
  },
}));

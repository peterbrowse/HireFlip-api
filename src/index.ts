import type { Core } from '@strapi/strapi';

type RequestContext = {
  serviceName?: string;
};

type CandidateService = {
  reconcileProviderCheckoutPayments(limit?: number, context?: RequestContext): Promise<unknown>;
};

type PaymentWebhookEventService = {
  retryFailedStripeEvents(limit?: number): Promise<unknown>;
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

const asCandidateService = (strapi: Core.Strapi) =>
  strapi.service('api::candidate.candidate') as unknown as CandidateService;

const asPaymentWebhookEventService = (strapi: Core.Strapi) =>
  strapi.service('api::payment-webhook-event.payment-webhook-event') as unknown as PaymentWebhookEventService;

const startPaymentReconciliation = (strapi: Core.Strapi) => {
  if (!envBool('PAYMENT_WEBHOOK_RECONCILIATION_ENABLED', true)) {
    return;
  }

  const intervalMs = envInt('PAYMENT_WEBHOOK_RECONCILIATION_INTERVAL_MS', 60000);
  const limit = envInt('PAYMENT_WEBHOOK_RETRY_LIMIT', 50);
  let isRunning = false;

  const run = async () => {
    if (isRunning) {
      return;
    }

    isRunning = true;

    try {
      await asPaymentWebhookEventService(strapi).retryFailedStripeEvents(limit);
      await asCandidateService(strapi).reconcileProviderCheckoutPayments(limit, {
        serviceName: 'payment-reconciliation-scheduler',
      });
    } catch (error) {
      strapi.log.error('Payment reconciliation scheduler failed.', error);
    } finally {
      isRunning = false;
    }
  };

  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  void run();
};

export default {
  /**
   * An asynchronous register function that runs before
   * your application is initialized.
   *
   * This gives you an opportunity to extend code.
   */
  register(/* { strapi }: { strapi: Core.Strapi } */) {},

  /**
   * An asynchronous bootstrap function that runs before
   * your application gets started.
   *
   * This gives you an opportunity to set up your data model,
   * run jobs, or perform some special logic.
   */
  bootstrap({ strapi }: { strapi: Core.Strapi }) {
    startPaymentReconciliation(strapi);
  },
};

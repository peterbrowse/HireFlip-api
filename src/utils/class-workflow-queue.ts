import { Queue, Worker, type JobsOptions } from 'bullmq';
import type { Core } from '@strapi/strapi';

type RequestContext = {
  serviceName?: string;
};

type CandidateService = {
  expireWaitingListOfferByDocumentId(offerDocumentId: string, context?: RequestContext): Promise<unknown>;
  reconcileProviderCheckoutPayments(limit?: number, context?: RequestContext): Promise<unknown>;
  syncWaitingListOfferExpiryJobs(limit?: number, context?: RequestContext): Promise<unknown>;
};

type PaymentWebhookEventService = {
  retryFailedStripeEvents(limit?: number): Promise<unknown>;
};

type AdminRefundService = {
  reconcileProviderRefunds(limit?: number, context?: RequestContext): Promise<unknown>;
};

type AdminClassService = {
  reconcileScheduledClassOpenings(limit?: number, context?: RequestContext): Promise<unknown>;
};

type ClassWorkflowJobName = 'expire-waiting-list-offer' | 'reconcile-payments';

type ClassWorkflowJobData = {
  classDocumentId?: string;
  expiresAt: string;
  offerDocumentId: string;
} | {
  limit: number;
};

let workflowQueue: Queue<ClassWorkflowJobData, unknown, ClassWorkflowJobName> | undefined;
let workflowWorker: Worker<ClassWorkflowJobData, unknown, ClassWorkflowJobName> | undefined;

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

const formatJobError = (error: unknown) =>
  error instanceof Error ? error.stack || error.message : String(error);

const queueEnabled = () => envBool('CLASS_WORKFLOW_QUEUE_ENABLED', true);

const redisUrl = () =>
  process.env.CLASS_WORKFLOW_QUEUE_REDIS_URL ||
  process.env.CLASS_ALLOCATION_REDIS_URL ||
  process.env.REDIS_URL ||
  'redis://localhost:6379';

const queuePrefix = () =>
  (process.env.CLASS_WORKFLOW_QUEUE_PREFIX || 'hireflip:class-workflow').replace(/:+$/g, '');

const createRedisConnectionOptions = () => ({
  maxRetriesPerRequest: null,
  url: redisUrl(),
  ...(redisUrl().startsWith('rediss://')
    ? {
        tls: {
          rejectUnauthorized: envBool('CLASS_WORKFLOW_QUEUE_TLS_REJECT_UNAUTHORIZED', false),
        },
      }
    : {}),
});

const queueName = () => process.env.CLASS_WORKFLOW_QUEUE_NAME || 'class-workflow';

const getWaitingListOfferExpiryJobOptions = (
  data: Extract<ClassWorkflowJobData, { offerDocumentId: string }>
): JobsOptions => ({
  attempts: envInt('CLASS_WORKFLOW_QUEUE_JOB_ATTEMPTS', 5),
  backoff: {
    delay: envInt('CLASS_WORKFLOW_QUEUE_JOB_BACKOFF_MS', 5000),
    type: 'exponential',
  },
  delay: Math.max(0, Date.parse(data.expiresAt) - Date.now()),
  jobId: [
    'waiting-list-offer-expiry',
    data.offerDocumentId,
    data.expiresAt.replace(/[^a-zA-Z0-9_-]/g, '_'),
  ].join('__'),
  removeOnComplete: envInt('CLASS_WORKFLOW_QUEUE_REMOVE_ON_COMPLETE', 1000),
  removeOnFail: envInt('CLASS_WORKFLOW_QUEUE_REMOVE_ON_FAIL', 5000),
});

const getReconciliationRepeatEveryMs = () =>
  envInt('CLASS_WORKFLOW_PAYMENT_RECONCILIATION_INTERVAL_MS', 60000);

const getReconciliationLimit = () =>
  envInt('CLASS_WORKFLOW_PAYMENT_RECONCILIATION_LIMIT', envInt('PAYMENT_WEBHOOK_RETRY_LIMIT', 50));

const getWaitingListOfferSyncLimit = () =>
  envInt('CLASS_WORKFLOW_WAITING_LIST_OFFER_SYNC_LIMIT', 1000);

const getWorkflowQueue = () => {
  if (!workflowQueue) {
    workflowQueue = new Queue<ClassWorkflowJobData, unknown, ClassWorkflowJobName>(queueName(), {
      connection: createRedisConnectionOptions(),
      prefix: queuePrefix(),
    });
  }

  return workflowQueue;
};

export const addWaitingListOfferExpiryJob = async (data: ClassWorkflowJobData) => {
  if (!queueEnabled()) {
    return undefined;
  }

  if (!('offerDocumentId' in data)) {
    throw new Error('Waiting-list offer expiry job data must include an offer document ID.');
  }

  return getWorkflowQueue().add(
    'expire-waiting-list-offer',
    data,
    getWaitingListOfferExpiryJobOptions(data)
  );
};

const candidateService = (strapi: Core.Strapi) =>
  strapi.service('api::candidate.candidate') as unknown as CandidateService;

const paymentWebhookEventService = (strapi: Core.Strapi) =>
  strapi.service('api::payment-webhook-event.payment-webhook-event') as unknown as PaymentWebhookEventService;

const adminRefundService = (strapi: Core.Strapi) =>
  strapi.service('api::admin-refund.admin-refund') as unknown as AdminRefundService;

const adminClassService = (strapi: Core.Strapi) =>
  strapi.service('api::admin-class.admin-class') as unknown as AdminClassService;

export const schedulePaymentReconciliationJob = async () => {
  if (!queueEnabled() || !envBool('CLASS_WORKFLOW_PAYMENT_RECONCILIATION_ENABLED', true)) {
    return undefined;
  }

  return getWorkflowQueue().add(
    'reconcile-payments',
    {
      limit: getReconciliationLimit(),
    },
    {
      attempts: envInt('CLASS_WORKFLOW_QUEUE_JOB_ATTEMPTS', 5),
      backoff: {
        delay: envInt('CLASS_WORKFLOW_QUEUE_JOB_BACKOFF_MS', 5000),
        type: 'exponential',
      },
      jobId: 'payment-reconciliation',
      repeat: {
        every: getReconciliationRepeatEveryMs(),
      },
      removeOnComplete: envInt('CLASS_WORKFLOW_QUEUE_REMOVE_ON_COMPLETE', 1000),
      removeOnFail: envInt('CLASS_WORKFLOW_QUEUE_REMOVE_ON_FAIL', 5000),
    }
  );
};

export const syncWaitingListOfferExpiryJobs = async (strapi: Core.Strapi) => {
  if (!queueEnabled()) {
    return undefined;
  }

  return candidateService(strapi).syncWaitingListOfferExpiryJobs(getWaitingListOfferSyncLimit(), {
    serviceName: 'class-workflow-bootstrap',
  });
};

export const startClassWorkflowWorker = (strapi: Core.Strapi) => {
  if (!queueEnabled() || workflowWorker) {
    return workflowWorker;
  }

  workflowWorker = new Worker<ClassWorkflowJobData, unknown, ClassWorkflowJobName>(
    queueName(),
    async (job) => {
      if (job.name === 'expire-waiting-list-offer') {
        if (!('offerDocumentId' in job.data)) {
          throw new Error('Waiting-list offer expiry job is missing offer data.');
        }

        await candidateService(strapi).expireWaitingListOfferByDocumentId(job.data.offerDocumentId, {
          serviceName: 'class-workflow-worker',
        });
        return;
      }

      if (job.name === 'reconcile-payments') {
        const limit = 'limit' in job.data ? job.data.limit : getReconciliationLimit();

        try {
          await paymentWebhookEventService(strapi).retryFailedStripeEvents(limit);
        } catch (error) {
          throw new Error(`Failed Stripe webhook event retry failed: ${formatJobError(error)}`);
        }

        try {
          await candidateService(strapi).reconcileProviderCheckoutPayments(limit, {
            serviceName: 'class-workflow-worker',
          });
        } catch (error) {
          throw new Error(`Pending Stripe checkout reconciliation failed: ${formatJobError(error)}`);
        }

        try {
          await adminRefundService(strapi).reconcileProviderRefunds(limit, {
            serviceName: 'class-workflow-worker',
          });
        } catch (error) {
          throw new Error(`Pending Stripe refund reconciliation failed: ${formatJobError(error)}`);
        }

        try {
          await adminClassService(strapi).reconcileScheduledClassOpenings(limit, {
            serviceName: 'class-workflow-worker',
          });
        } catch (error) {
          throw new Error(`Scheduled class opening reconciliation failed: ${formatJobError(error)}`);
        }

        return;
      }

      throw new Error(`Unsupported class workflow job: ${job.name}`);
    },
    {
      concurrency: envInt('CLASS_WORKFLOW_QUEUE_WORKER_CONCURRENCY', 2),
      connection: createRedisConnectionOptions(),
      prefix: queuePrefix(),
    }
  );

  workflowWorker.on('failed', (job, error) => {
    strapi.log.error(
      `Class workflow job failed: ${job?.name || 'unknown'} ${job?.id || 'unknown'} ${formatJobError(error)}`
    );
  });

  return workflowWorker;
};

export const stopClassWorkflowQueue = async () => {
  const worker = workflowWorker;
  const queue = workflowQueue;

  workflowWorker = undefined;
  workflowQueue = undefined;

  if (worker) {
    worker.removeAllListeners();
    await worker.close();
  }

  if (queue) {
    await queue.close();
  }
};

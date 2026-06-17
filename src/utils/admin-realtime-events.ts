import Redis from 'ioredis';

type Logger = {
  error?: (message: string, error?: unknown) => void;
};

export type AdminRealtimeEventType =
  | 'assessment_appeals_changed'
  | 'admin_tasks_changed'
  | 'classes_changed'
  | 'refund_reviews_changed'
  | 'review_claim_changed'
  | 'support_cases_changed';

export type AdminRealtimeChannel = 'operations' | 'refunds' | 'support';

export type AdminRealtimeEvent = {
  channels: AdminRealtimeChannel[];
  occurredAt?: string;
  resourceKey?: string;
  resourceType?: string;
  type: AdminRealtimeEventType;
};

let publisher: Redis | undefined;
let publisherConnectionPromise: Promise<void> | undefined;

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

const redisUrl = () =>
  process.env.ADMIN_REALTIME_REDIS_URL ||
  process.env.CLASS_REALTIME_REDIS_URL ||
  process.env.CLASS_ALLOCATION_REDIS_URL ||
  process.env.REDIS_URL ||
  'redis://localhost:6379';

const redisChannelPrefix = () =>
  (process.env.ADMIN_REALTIME_REDIS_CHANNEL_PREFIX || 'hireflip:admin-realtime')
    .replace(/:+$/g, '');

export const adminRealtimeChannel = (channel: AdminRealtimeChannel) =>
  `${redisChannelPrefix()}:${channel}`;

export const createAdminRealtimeSubscriber = () => {
  const url = redisUrl();

  const subscriber = new Redis(url, {
    commandTimeout: envInt('ADMIN_REALTIME_REDIS_COMMAND_TIMEOUT_MS', 2000),
    enableOfflineQueue: false,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
    tls: url.startsWith('rediss://')
      ? {
          rejectUnauthorized: envBool('ADMIN_REALTIME_REDIS_TLS_REJECT_UNAUTHORIZED', false),
        }
      : undefined,
  });

  subscriber.on('error', () => undefined);

  return subscriber;
};

const getPublisher = () => {
  if (!publisher || publisher.status === 'end') {
    const url = redisUrl();

    publisher = new Redis(url, {
      commandTimeout: envInt('ADMIN_REALTIME_REDIS_COMMAND_TIMEOUT_MS', 2000),
      enableOfflineQueue: false,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
      tls: url.startsWith('rediss://')
        ? {
            rejectUnauthorized: envBool('ADMIN_REALTIME_REDIS_TLS_REJECT_UNAUTHORIZED', false),
          }
        : undefined,
    });
    publisher.on('error', () => undefined);
  }

  return publisher;
};

const ensurePublisher = async () => {
  const redis = getPublisher();

  if (redis.status === 'ready') {
    return redis;
  }

  if (!publisherConnectionPromise) {
    publisherConnectionPromise = redis.connect().then(() => undefined);
  }

  try {
    await publisherConnectionPromise;
  } finally {
    publisherConnectionPromise = undefined;
  }

  if ((redis.status as string) !== 'ready') {
    throw new Error('Admin realtime Redis publisher is not ready.');
  }

  return redis;
};

export const publishAdminRealtimeEvent = async (
  event: AdminRealtimeEvent,
  logger?: Logger
) => {
  const channels = [...new Set(event.channels)];

  if (channels.length === 0) {
    return;
  }

  try {
    const redis = await ensurePublisher();
    const payload = JSON.stringify({
      ...event,
      channels,
      occurredAt: event.occurredAt || new Date().toISOString(),
    });

    await Promise.all(
      channels.map((channel) => redis.publish(adminRealtimeChannel(channel), payload))
    );
  } catch (error) {
    logger?.error?.('Admin realtime event publish failed.', error);
  }
};

export const disconnectAdminRealtimePublisher = async () => {
  if (!publisher) {
    return;
  }

  const redis = publisher;

  publisher = undefined;
  publisherConnectionPromise = undefined;

  if (redis.status === 'end') {
    return;
  }

  await redis.quit().catch(() => {
    redis.disconnect();
  });
};

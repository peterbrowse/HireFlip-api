import Redis from 'ioredis';

type Logger = {
  error?: (message: string, error?: unknown) => void;
};

export type CandidateClassRealtimeEventType =
  | 'class_relationship_updated'
  | 'class_state_changed'
  | 'reservation_created'
  | 'reservation_expired'
  | 'reservation_cancelled'
  | 'waiting_list_joined'
  | 'waiting_list_offer_claimed'
  | 'waiting_list_offer_created'
  | 'waiting_list_offer_declined'
  | 'waiting_list_offer_expired'
  | 'waiting_list_offer_superseded';

export type CandidateClassRealtimeEvent = {
  candidateDocumentId?: string;
  classDocumentId?: string;
  occurredAt?: string;
  offerDocumentId?: string;
  type: CandidateClassRealtimeEventType;
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
  process.env.CLASS_REALTIME_REDIS_URL ||
  process.env.CLASS_ALLOCATION_REDIS_URL ||
  process.env.REDIS_URL ||
  'redis://localhost:6379';

const redisChannelPrefix = () =>
  (process.env.CLASS_REALTIME_REDIS_CHANNEL_PREFIX || 'hireflip:class-realtime')
    .replace(/:+$/g, '');

export const candidateClassRealtimeChannel = (candidateDocumentId: string) =>
  `${redisChannelPrefix()}:candidate:${candidateDocumentId}`;

export const classRealtimeChannel = (classDocumentId: string) =>
  `${redisChannelPrefix()}:class:${classDocumentId}`;

export const createClassRealtimeSubscriber = () => {
  const url = redisUrl();

  const subscriber = new Redis(url, {
    commandTimeout: envInt('CLASS_REALTIME_REDIS_COMMAND_TIMEOUT_MS', 2000),
    enableOfflineQueue: false,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
    tls: url.startsWith('rediss://')
      ? {
          rejectUnauthorized: envBool('CLASS_REALTIME_REDIS_TLS_REJECT_UNAUTHORIZED', false),
        }
      : undefined,
  });

  subscriber.on('error', () => undefined);

  return subscriber;
};

const objectValue = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const stringValue = (value: unknown) => (typeof value === 'string' && value.trim() ? value : undefined);

export const getClassRealtimeChannelsForInterest = (classInterest: unknown) => {
  const channels = new Set<string>();
  const payload = objectValue(classInterest);
  const candidate = objectValue(payload.candidate);
  const candidateDocumentId = stringValue(candidate.documentId);

  if (candidateDocumentId) {
    channels.add(candidateClassRealtimeChannel(candidateDocumentId));
  }

  if (Array.isArray(payload.classes)) {
    for (const classRelationship of payload.classes) {
      const classRecord = objectValue(objectValue(classRelationship).class);
      const classDocumentId = stringValue(classRecord.documentId);

      if (classDocumentId) {
        channels.add(classRealtimeChannel(classDocumentId));
      }
    }
  }

  return [...channels];
};

const getPublisher = () => {
  if (!publisher || publisher.status === 'end') {
    const url = redisUrl();

    publisher = new Redis(url, {
      commandTimeout: envInt('CLASS_REALTIME_REDIS_COMMAND_TIMEOUT_MS', 2000),
      enableOfflineQueue: false,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
      tls: url.startsWith('rediss://')
        ? {
            rejectUnauthorized: envBool('CLASS_REALTIME_REDIS_TLS_REJECT_UNAUTHORIZED', false),
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
    throw new Error('Class realtime Redis publisher is not ready.');
  }

  return redis;
};

export const publishCandidateClassRealtimeEvent = async (
  event: CandidateClassRealtimeEvent,
  logger?: Logger
) => {
  if (!event.candidateDocumentId) {
    return;
  }

  try {
    const redis = await ensurePublisher();

    await redis.publish(
      candidateClassRealtimeChannel(event.candidateDocumentId),
      JSON.stringify({
        ...event,
        occurredAt: event.occurredAt || new Date().toISOString(),
      })
    );
  } catch (error) {
    logger?.error?.('Candidate class realtime event publish failed.', error);
  }
};

export const publishClassRealtimeEvent = async (
  event: CandidateClassRealtimeEvent,
  logger?: Logger
) => {
  if (!event.classDocumentId) {
    return;
  }

  try {
    const redis = await ensurePublisher();

    await redis.publish(
      classRealtimeChannel(event.classDocumentId),
      JSON.stringify({
        ...event,
        occurredAt: event.occurredAt || new Date().toISOString(),
      })
    );
  } catch (error) {
    logger?.error?.('Class realtime event publish failed.', error);
  }
};

export const disconnectClassRealtimePublisher = async () => {
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

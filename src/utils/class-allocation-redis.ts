import Redis from 'ioredis';

type AllocationStatus =
  | 'paid'
  | 'reserved_existing'
  | 'reserved_new'
  | 'waitlisted_existing'
  | 'waitlisted_new';

type AllocationResult = {
  allocationId?: string;
  expiresAt?: string;
  heldPlaces: number;
  status: AllocationStatus;
  waitlistCreated: boolean;
  waitlistPosition?: number;
};

type HoldSnapshot = {
  allocationId: string;
  candidateDocumentId: string;
  expiresAt: string;
  reservationDocumentId?: string;
};

type WaitlistSnapshot = {
  candidateDocumentId: string;
  position: number;
};

type ClassAllocationSnapshot = {
  holds: HoldSnapshot[];
  paidCandidateDocumentIds: string[];
  waitlist: WaitlistSnapshot[];
};

type AllocationMeta = {
  allocationId: string;
  expiresAt: string;
};

let redisClient: Redis | undefined;
let redisConnectionPromise: Promise<void> | undefined;

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

export const isClassAllocationRedisEnabled = () =>
  envBool('CLASS_ALLOCATION_REDIS_ENABLED', true);

const redisUrl = () =>
  process.env.CLASS_ALLOCATION_REDIS_URL ||
  process.env.REDIS_URL ||
  'redis://localhost:6379';

const redisPrefix = () =>
  (process.env.CLASS_ALLOCATION_REDIS_PREFIX || 'hireflip:class-allocation')
    .replace(/:+$/g, '');

const syncTtlSeconds = () => envInt('CLASS_ALLOCATION_REDIS_SYNC_TTL_SECONDS', 300);
const syncLockTtlMs = () => envInt('CLASS_ALLOCATION_REDIS_SYNC_LOCK_MS', 10000);

const keyBase = (classDocumentId: string) => `${redisPrefix()}:${classDocumentId}`;

const classAllocationKeys = (classDocumentId: string) => {
  const base = keyBase(classDocumentId);

  return {
    holds: `${base}:holds`,
    holdMeta: `${base}:hold-meta`,
    paid: `${base}:paid`,
    ready: `${base}:ready`,
    syncLock: `${base}:sync-lock`,
    waitlist: `${base}:waitlist`,
    waitlistSequence: `${base}:waitlist-sequence`,
  };
};

const getRedis = () => {
  if (!redisClient || redisClient.status === 'end') {
    redisClient = new Redis(redisUrl(), {
      commandTimeout: envInt('CLASS_ALLOCATION_REDIS_COMMAND_TIMEOUT_MS', 2000),
      enableOfflineQueue: false,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
      tls: redisUrl().startsWith('rediss://')
        ? {
            rejectUnauthorized: envBool('CLASS_ALLOCATION_REDIS_TLS_REJECT_UNAUTHORIZED', false),
          }
        : undefined,
    });
    redisClient.on('error', () => undefined);
  }

  return redisClient;
};

const ensureRedis = async () => {
  if (!isClassAllocationRedisEnabled()) {
    throw new Error('Class allocation Redis is disabled.');
  }

  const redis = getRedis();

  if (redis.status === 'ready') {
    return redis;
  }

  if (!redisConnectionPromise) {
    redisConnectionPromise = redis.connect().then(() => undefined);
  }

  try {
    await redisConnectionPromise;
  } finally {
    redisConnectionPromise = undefined;
  }

  if ((redis.status as string) !== 'ready') {
    throw new Error('Class allocation Redis is not ready.');
  }

  return redis;
};

const parseAllocationMeta = (value?: string): AllocationMeta | undefined => {
  if (!value) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(value) as Partial<AllocationMeta>;

    if (typeof parsed.allocationId === 'string' && typeof parsed.expiresAt === 'string') {
      return {
        allocationId: parsed.allocationId,
        expiresAt: parsed.expiresAt,
      };
    }
  } catch {
    return undefined;
  }

  return undefined;
};

const allocationScript = `
local holds = KEYS[1]
local holdMeta = KEYS[2]
local paid = KEYS[3]
local waitlist = KEYS[4]
local waitlistSequence = KEYS[5]
local capacity = tonumber(ARGV[1])
local nowMs = tonumber(ARGV[2])
local expiresAtMs = tonumber(ARGV[3])
local candidateDocumentId = ARGV[4]
local allocationMeta = ARGV[5]

local expiredCandidates = redis.call('ZRANGEBYSCORE', holds, '-inf', nowMs)
for _, expiredCandidate in ipairs(expiredCandidates) do
  redis.call('HDEL', holdMeta, expiredCandidate)
end
redis.call('ZREMRANGEBYSCORE', holds, '-inf', nowMs)

if redis.call('SISMEMBER', paid, candidateDocumentId) == 1 then
  return {'paid', '', tostring(redis.call('SCARD', paid) + redis.call('ZCARD', holds)), '0'}
end

local existingHoldScore = redis.call('ZSCORE', holds, candidateDocumentId)
if existingHoldScore then
  return {'reserved_existing', redis.call('HGET', holdMeta, candidateDocumentId) or '', tostring(redis.call('SCARD', paid) + redis.call('ZCARD', holds)), '0'}
end

local heldPlaces = redis.call('SCARD', paid) + redis.call('ZCARD', holds)
local waitlistCount = redis.call('ZCARD', waitlist)
local firstWaitlisted = redis.call('ZRANGE', waitlist, 0, 0)[1]

if capacity > heldPlaces and (waitlistCount == 0 or firstWaitlisted == candidateDocumentId) then
  redis.call('ZADD', holds, expiresAtMs, candidateDocumentId)
  redis.call('HSET', holdMeta, candidateDocumentId, allocationMeta)
  redis.call('ZREM', waitlist, candidateDocumentId)
  return {'reserved_new', allocationMeta, tostring(heldPlaces), '0'}
end

if not redis.call('ZSCORE', waitlist, candidateDocumentId) then
  local nextPosition = redis.call('INCR', waitlistSequence)
  redis.call('ZADD', waitlist, nextPosition, candidateDocumentId)
  local rank = redis.call('ZRANK', waitlist, candidateDocumentId)
  return {'waitlisted_new', '', tostring(heldPlaces), tostring((rank or 0) + 1)}
end

local rank = redis.call('ZRANK', waitlist, candidateDocumentId)
return {'waitlisted_existing', '', tostring(heldPlaces), tostring((rank or 0) + 1)}
`;

const releaseScript = `
local holds = KEYS[1]
local holdMeta = KEYS[2]
local paid = KEYS[3]
local waitlist = KEYS[4]
local candidateDocumentId = ARGV[1]
local removeWaitlist = ARGV[2]

redis.call('ZREM', holds, candidateDocumentId)
redis.call('HDEL', holdMeta, candidateDocumentId)

if removeWaitlist == '1' then
  redis.call('ZREM', waitlist, candidateDocumentId)
end

redis.call('SREM', paid, candidateDocumentId)
return 'ok'
`;

const markPaidScript = `
local holds = KEYS[1]
local holdMeta = KEYS[2]
local paid = KEYS[3]
local waitlist = KEYS[4]
local candidateDocumentId = ARGV[1]

redis.call('ZREM', holds, candidateDocumentId)
redis.call('HDEL', holdMeta, candidateDocumentId)
redis.call('ZREM', waitlist, candidateDocumentId)
redis.call('SADD', paid, candidateDocumentId)
return 'ok'
`;

const coerceScriptResult = (value: unknown): AllocationResult => {
  if (!Array.isArray(value)) {
    throw new Error('Class allocation Redis returned an invalid response.');
  }

  const [statusValue, metadataValue, heldPlacesValue, waitlistPositionValue] = value;
  const status = String(statusValue) as AllocationStatus;
  const metadata = parseAllocationMeta(typeof metadataValue === 'string' ? metadataValue : undefined);
  const heldPlaces = Number.parseInt(String(heldPlacesValue || '0'), 10);
  const waitlistPosition = Number.parseInt(String(waitlistPositionValue || '0'), 10);

  if (
    ![
      'paid',
      'reserved_existing',
      'reserved_new',
      'waitlisted_existing',
      'waitlisted_new',
    ].includes(status)
  ) {
    throw new Error('Class allocation Redis returned an unknown status.');
  }

  return {
    allocationId: metadata?.allocationId,
    expiresAt: metadata?.expiresAt,
    heldPlaces: Number.isFinite(heldPlaces) ? heldPlaces : 0,
    status,
    waitlistCreated: status === 'waitlisted_new',
    waitlistPosition: Number.isFinite(waitlistPosition) && waitlistPosition > 0 ? waitlistPosition : undefined,
  };
};

export const isClassAllocationReady = async (classDocumentId: string) => {
  const redis = await ensureRedis();
  const keys = classAllocationKeys(classDocumentId);

  return (await redis.get(keys.ready)) === '1';
};

export const tryAcquireClassAllocationSyncLock = async (classDocumentId: string) => {
  const redis = await ensureRedis();
  const keys = classAllocationKeys(classDocumentId);

  return (await redis.set(keys.syncLock, String(Date.now()), 'PX', syncLockTtlMs(), 'NX')) === 'OK';
};

export const waitForClassAllocationReady = async (
  classDocumentId: string,
  timeoutMs = syncLockTtlMs()
) => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await isClassAllocationReady(classDocumentId)) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, 75));
  }

  return false;
};

export const replaceClassAllocationSnapshot = async (
  classDocumentId: string,
  snapshot: ClassAllocationSnapshot
) => {
  const redis = await ensureRedis();
  const keys = classAllocationKeys(classDocumentId);
  const nowMs = Date.now();
  const pipeline = redis.pipeline();
  const activeHolds = snapshot.holds.filter((hold) => Date.parse(hold.expiresAt) > nowMs);
  const maxWaitlistPosition = snapshot.waitlist.reduce(
    (highest, item) => Math.max(highest, item.position),
    0
  );

  pipeline.del(keys.holds, keys.holdMeta, keys.paid, keys.waitlist, keys.waitlistSequence);

  for (const hold of activeHolds) {
    pipeline.zadd(keys.holds, Date.parse(hold.expiresAt), hold.candidateDocumentId);
    pipeline.hset(
      keys.holdMeta,
      hold.candidateDocumentId,
      JSON.stringify({
        allocationId: hold.allocationId,
        expiresAt: hold.expiresAt,
        reservationDocumentId: hold.reservationDocumentId,
      })
    );
  }

  if (snapshot.paidCandidateDocumentIds.length > 0) {
    pipeline.sadd(keys.paid, ...snapshot.paidCandidateDocumentIds);
  }

  for (const item of snapshot.waitlist) {
    pipeline.zadd(keys.waitlist, item.position, item.candidateDocumentId);
  }

  pipeline.set(keys.waitlistSequence, String(maxWaitlistPosition));
  pipeline.set(keys.ready, '1', 'EX', syncTtlSeconds());
  pipeline.del(keys.syncLock);
  await pipeline.exec();
};

export const allocateClassPlace = async ({
  allocationId,
  candidateDocumentId,
  capacity,
  classDocumentId,
  expiresAt,
}: {
  allocationId: string;
  candidateDocumentId: string;
  capacity: number;
  classDocumentId: string;
  expiresAt: string;
}) => {
  const redis = await ensureRedis();
  const keys = classAllocationKeys(classDocumentId);
  const result = await redis.eval(
    allocationScript,
    5,
    keys.holds,
    keys.holdMeta,
    keys.paid,
    keys.waitlist,
    keys.waitlistSequence,
    String(capacity),
    String(Date.now()),
    String(Date.parse(expiresAt)),
    candidateDocumentId,
    JSON.stringify({ allocationId, expiresAt })
  );

  return coerceScriptResult(result);
};

export const releaseClassPlaceAllocation = async ({
  candidateDocumentId,
  classDocumentId,
  removeWaitlist = false,
}: {
  candidateDocumentId: string;
  classDocumentId: string;
  removeWaitlist?: boolean;
}) => {
  const redis = await ensureRedis();
  const keys = classAllocationKeys(classDocumentId);

  await redis.eval(
    releaseScript,
    4,
    keys.holds,
    keys.holdMeta,
    keys.paid,
    keys.waitlist,
    candidateDocumentId,
    removeWaitlist ? '1' : '0'
  );
};

export const markClassPlaceAllocationPaid = async ({
  candidateDocumentId,
  classDocumentId,
}: {
  candidateDocumentId: string;
  classDocumentId: string;
}) => {
  const redis = await ensureRedis();
  const keys = classAllocationKeys(classDocumentId);

  await redis.eval(
    markPaidScript,
    4,
    keys.holds,
    keys.holdMeta,
    keys.paid,
    keys.waitlist,
    candidateDocumentId
  );
};

export const closeClassAllocationRedis = async () => {
  if (!redisClient) {
    return;
  }

  const client = redisClient;
  redisClient = undefined;
  redisConnectionPromise = undefined;
  client.disconnect();
};

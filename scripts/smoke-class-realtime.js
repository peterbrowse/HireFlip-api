#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const Redis = require('ioredis');

const stripQuotes = (value) => {
  const trimmed = value.trim();

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
};

const loadEnvFile = () => {
  const envPath = path.resolve(process.cwd(), process.env.ENV_PATH || '.env.local');

  if (!fs.existsSync(envPath)) {
    return;
  }

  const contents = fs.readFileSync(envPath, 'utf8');

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);

    if (!match) {
      continue;
    }

    const [, key, value] = match;

    if (!Object.prototype.hasOwnProperty.call(process.env, key)) {
      process.env[key] = stripQuotes(value);
    }
  }
};

const boolEnv = (name, fallback) => {
  const value = (process.env[name] || '').toLowerCase();

  if (['1', 'true', 'yes', 'on'].includes(value)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(value)) {
    return false;
  }

  return fallback;
};

const numberEnv = (name, fallback) => {
  const value = Number.parseInt(process.env[name] || '', 10);

  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const realtimeRedisUrl = () =>
  process.env.CLASS_REALTIME_REDIS_URL ||
  process.env.CLASS_ALLOCATION_REDIS_URL ||
  process.env.REDIS_URL ||
  'redis://localhost:6379';

const createSubscriber = () => {
  const redisUrl = realtimeRedisUrl();
  const subscriber = new Redis(redisUrl, {
    commandTimeout: numberEnv('CLASS_REALTIME_REDIS_COMMAND_TIMEOUT_MS', 2000),
    enableOfflineQueue: false,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
    tls: redisUrl.startsWith('rediss://')
      ? {
          rejectUnauthorized: boolEnv('CLASS_REALTIME_REDIS_TLS_REJECT_UNAUTHORIZED', false),
        }
      : undefined,
  });

  subscriber.on('error', () => undefined);

  return subscriber;
};

const waitForEvents = ({ channels, expectedEventTypes, publish }) =>
  new Promise((resolve, reject) => {
    const received = [];
    const remaining = new Set(expectedEventTypes);
    const timeout = setTimeout(() => {
      reject(
        new Error(
          `Timed out waiting for realtime events. Received: ${JSON.stringify(received)}`
        )
      );
    }, numberEnv('CLASS_REALTIME_SMOKE_TIMEOUT_MS', 3000));
    const subscriber = createSubscriber();
    const finish = async (error) => {
      clearTimeout(timeout);
      subscriber.removeAllListeners();
      await subscriber.quit().catch(() => subscriber.disconnect());

      if (error) {
        reject(error);
        return;
      }

      resolve(received);
    };

    subscriber.on('message', (channel, rawMessage) => {
      let payload;

      try {
        payload = JSON.parse(rawMessage);
      } catch {
        payload = { rawMessage };
      }

      received.push({ channel, payload });

      if (payload?.type) {
        remaining.delete(payload.type);
      }

      if (remaining.size === 0) {
        void finish();
      }
    });

    subscriber
      .connect()
      .then(() => subscriber.subscribe(...channels))
      .then(publish)
      .catch((error) => {
        void finish(error);
      });
  });

const main = async () => {
  loadEnvFile();

  const {
    candidateClassRealtimeChannel,
    classRealtimeChannel,
    disconnectClassRealtimePublisher,
    publishCandidateClassRealtimeEvent,
    publishClassRealtimeEvent,
  } = require('../dist/src/utils/class-realtime-events.js');

  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const classDocumentId = `realtime-smoke-class-${runId}`;
  const candidateDocumentId = `realtime-smoke-candidate-${runId}`;
  const classChannel = classRealtimeChannel(classDocumentId);
  const candidateChannel = candidateClassRealtimeChannel(candidateDocumentId);
  const events = await waitForEvents({
    channels: [classChannel, candidateChannel],
    expectedEventTypes: ['class_state_changed', 'waiting_list_offer_created'],
    publish: async () => {
      await publishClassRealtimeEvent({
        classDocumentId,
        type: 'class_state_changed',
      });
      await publishCandidateClassRealtimeEvent({
        candidateDocumentId,
        classDocumentId,
        offerDocumentId: `realtime-smoke-offer-${runId}`,
        type: 'waiting_list_offer_created',
      });
    },
  });

  await disconnectClassRealtimePublisher();

  console.log(
    JSON.stringify(
      {
        channels: [classChannel, candidateChannel],
        received: events.map((event) => ({
          channel: event.channel,
          type: event.payload.type,
        })),
        status: 'passed',
      },
      null,
      2
    )
  );
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

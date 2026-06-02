#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { compileStrapi, createStrapi } = require('@strapi/strapi');
const Redis = require('ioredis');

process.env.CLASS_WORKFLOW_BOOTSTRAP_ENABLED = 'false';

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

const numberEnv = (name, fallback) => {
  const value = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
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

const documents = (strapi, uid) => strapi.documents(uid);

const createDocument = (strapi, uid, data, populate = []) =>
  documents(strapi, uid).create({ data, populate });

const deleteDocument = async (strapi, uid, documentId) => {
  if (!documentId) {
    return;
  }

  await documents(strapi, uid).delete({ documentId }).catch(() => undefined);
};

const deleteDocuments = async (strapi, uid, records) => {
  for (const record of records) {
    await deleteDocument(strapi, uid, record.documentId);
  }
};

const normalizePreferenceValue = (value) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

const preferenceSelection = (slug) => ({
  other: '',
  selected: [normalizePreferenceValue(slug)],
});

const cleanupRedisKeys = async (classDocumentId) => {
  if (!classDocumentId) {
    return;
  }

  const redisUrl =
    process.env.CLASS_ALLOCATION_REDIS_URL ||
    process.env.REDIS_URL ||
    'redis://localhost:6379';
  const prefix = (process.env.CLASS_ALLOCATION_REDIS_PREFIX || 'hireflip:class-allocation')
    .replace(/:+$/g, '');
  const redis = new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
    tls: redisUrl.startsWith('rediss://')
      ? {
          rejectUnauthorized: boolEnv('CLASS_ALLOCATION_REDIS_TLS_REJECT_UNAUTHORIZED', false),
        }
      : undefined,
  });

  redis.on('error', () => undefined);

  try {
    await redis.connect();
    const keys = await redis.keys(`${prefix}:${classDocumentId}:*`);

    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } finally {
    redis.disconnect();
  }
};

const main = async () => {
  loadEnvFile();

  process.env.CLASS_ALLOCATION_REDIS_ENABLED =
    process.env.CLASS_ALLOCATION_REDIS_ENABLED || 'true';

  const capacity = numberEnv('CLASS_ALLOCATION_SMOKE_CAPACITY', 1);
  const candidateCount = numberEnv('CLASS_ALLOCATION_SMOKE_CANDIDATES', capacity + 5);
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const areaSlug = `allocation-smoke-area-${runId}`;
  const sectorSlug = `allocation-smoke-sector-${runId}`;
  const created = {
    area: undefined,
    candidates: [],
    classRecord: undefined,
    course: undefined,
    sector: undefined,
  };

  const appContext = await compileStrapi();
  const strapi = await createStrapi(appContext).load();

  try {
    created.area = await createDocument(strapi, 'api::class-area.class-area', {
      country: 'United Kingdom',
      name: `Allocation Smoke Area ${runId}`,
      slug: areaSlug,
      state: 'active',
    });
    created.sector = await createDocument(strapi, 'api::work-sector.work-sector', {
      name: `Allocation Smoke Sector ${runId}`,
      slug: sectorSlug,
      state: 'active',
    });
    created.course = await createDocument(strapi, 'api::course.course', {
      name: `Allocation Smoke Course ${runId}`,
      sector: 'Smoke',
      sourceType: 'internal',
      courseState: 'active',
      version: runId,
    });
    created.classRecord = await createDocument(
      strapi,
      'api::class.class',
      {
        capacity,
        classArea: {
          connect: [{ documentId: created.area.documentId }],
        },
        course: {
          connect: [{ documentId: created.course.documentId }],
        },
        currency: 'GBP',
        discountedPricePence: 100,
        displayTitle: `Allocation Smoke Class ${runId}`,
        interviewsGuaranteed: 2,
        level: 'Entry',
        name: `Allocation Smoke Class ${runId}`,
        officialClassCode: `Smoke ${runId}`,
        pricePence: 100,
        region: created.area.name,
        sector: created.sector.name,
        slug: `allocation-smoke-class-${runId}`,
        startDate: '2026-12-01',
        state: 'open',
        workSector: {
          connect: [{ documentId: created.sector.documentId }],
        },
        year: 2026,
        yearSequenceNumber: 999,
      },
      ['classArea', 'workSector', 'course']
    );

    for (let index = 0; index < candidateCount; index += 1) {
      const candidate = await createDocument(strapi, 'api::candidate.candidate', {
        accountOnboardingCompletedAt: new Date().toISOString(),
        accountRestrictionStatus: 'active',
        authIdentityId: `auth0|allocation-smoke-${runId}-${index}`,
        authProvider: 'auth0',
        classAreaPreferences: preferenceSelection(areaSlug, created.area.name),
        email: `allocation-smoke-${runId}-${index}@example.test`,
        firstName: 'Allocation',
        lastName: `Smoke ${index}`,
        marketingConsentState: 'opted_out',
        preferredCommunicationChannel: 'email',
        candidateState: 'unenrolled',
        workSectorPreferences: preferenceSelection(sectorSlug, created.sector.name),
      });

      created.candidates.push(candidate);
    }

    const candidateService = strapi.service('api::candidate.candidate');
    const results = await Promise.allSettled(
      created.candidates.map((candidate) =>
        candidateService.reserveCurrentCandidateClassPlace(
          {
            email: candidate.email,
            subject: candidate.authIdentityId,
            type: 'auth0',
          },
          {
            classDocumentId: created.classRecord.documentId,
          },
          {
            requestId: `allocation-smoke-${runId}`,
            serviceName: 'allocation-smoke-script',
          }
        )
      )
    );
    const activeReservations = await documents(strapi, 'api::reservation.reservation').findMany({
      filters: {
        class: {
          documentId: created.classRecord.documentId,
        },
        reservationState: 'active',
      },
      limit: 1000,
      populate: ['candidate'],
    });
    const waitingListEnrollments = await documents(strapi, 'api::enrollment.enrollment').findMany({
      filters: {
        class: {
          documentId: created.classRecord.documentId,
        },
        enrollmentState: 'waiting_list',
      },
      limit: 1000,
      populate: ['candidate'],
    });
    const rejected = results.filter((result) => result.status === 'rejected');
    const rejectedReasons = rejected.map((result) =>
      result.status === 'rejected' && result.reason instanceof Error
        ? result.reason.message
        : 'Unknown reservation error.'
    );

    if (activeReservations.length !== capacity) {
      throw new Error(
        `Expected ${capacity} active reservation(s), got ${activeReservations.length}. Rejections: ${JSON.stringify(rejectedReasons)}`
      );
    }

    if (waitingListEnrollments.length !== candidateCount - capacity) {
      throw new Error(
        `Expected ${candidateCount - capacity} waiting-list enrollment(s), got ${waitingListEnrollments.length}. Rejections: ${JSON.stringify(rejectedReasons)}`
      );
    }

    if (rejected.length > 0) {
      throw new Error(`${rejected.length} reservation request(s) rejected unexpectedly.`);
    }

    strapi.log.info(
      `Class allocation smoke passed: ${JSON.stringify({
        activeReservations: activeReservations.length,
        candidateCount,
        capacity,
        waitingListEnrollments: waitingListEnrollments.length,
      })}`
    );
  } finally {
    if (process.env.CLASS_ALLOCATION_SMOKE_KEEP_DATA !== 'true') {
      await cleanupRedisKeys(created.classRecord?.documentId);

      if (created.classRecord?.documentId) {
        const [reservations, enrollments, payments, auditEvents] = await Promise.all([
          documents(strapi, 'api::reservation.reservation').findMany({
            filters: {
              class: {
                documentId: created.classRecord.documentId,
              },
            },
            fields: ['documentId'],
            limit: 1000,
          }),
          documents(strapi, 'api::enrollment.enrollment').findMany({
            filters: {
              class: {
                documentId: created.classRecord.documentId,
              },
            },
            fields: ['documentId'],
            limit: 1000,
          }),
          documents(strapi, 'api::payment.payment').findMany({
            filters: {
              reservation: {
                class: {
                  documentId: created.classRecord.documentId,
                },
              },
            },
            fields: ['documentId'],
            limit: 1000,
          }),
          documents(strapi, 'api::audit-event.audit-event').findMany({
            filters: {
              requestId: `allocation-smoke-${runId}`,
            },
            fields: ['documentId'],
            limit: 1000,
          }),
        ]);

        await deleteDocuments(strapi, 'api::payment.payment', payments);
        await deleteDocuments(strapi, 'api::reservation.reservation', reservations);
        await deleteDocuments(strapi, 'api::enrollment.enrollment', enrollments);
        await deleteDocuments(strapi, 'api::audit-event.audit-event', auditEvents);
      }

      await deleteDocument(strapi, 'api::class.class', created.classRecord?.documentId);
      await deleteDocument(strapi, 'api::course.course', created.course?.documentId);
      await deleteDocument(strapi, 'api::class-area.class-area', created.area?.documentId);
      await deleteDocument(strapi, 'api::work-sector.work-sector', created.sector?.documentId);

      for (const candidate of created.candidates) {
        await deleteDocument(strapi, 'api::candidate.candidate', candidate.documentId);
      }
    }

    await strapi.destroy();
  }
};

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

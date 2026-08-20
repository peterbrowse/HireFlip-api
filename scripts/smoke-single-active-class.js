#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { compileStrapi, createStrapi } = require('@strapi/strapi');
const Redis = require('ioredis');
const { setupSmokeDatabase } = require('./lib/smoke-database');
const { documents } = require('./lib/strapi-documents');

process.env.CLASS_WORKFLOW_BOOTSTRAP_ENABLED = 'false';

const expectedConflictMessage =
  'Finish your current class journey before reserving a place on another class.';

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

  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);

    if (match && !Object.prototype.hasOwnProperty.call(process.env, match[1])) {
      process.env[match[1]] = stripQuotes(match[2]);
    }
  }
};

const connect = (record) => ({ connect: [{ documentId: record.documentId }] });
const normalizePreferenceValue = (value) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const preferenceSelection = (slug) => ({
  other: '',
  selected: [normalizePreferenceValue(slug)],
});

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const errorMessage = (result) =>
  result.status === 'rejected' && result.reason instanceof Error
    ? result.reason.message
    : undefined;

const cleanupRedisPrefix = async (prefix) => {
  const redisUrl =
    process.env.CLASS_ALLOCATION_REDIS_URL ||
    process.env.REDIS_URL ||
    'redis://localhost:6379';
  const redis = new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
    tls: redisUrl.startsWith('rediss://')
      ? {
          rejectUnauthorized: false,
        }
      : undefined,
  });

  redis.on('error', () => undefined);

  try {
    await redis.connect();
    const keys = await redis.keys(`${prefix}:*`);

    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } finally {
    redis.disconnect();
  }
};

const main = async () => {
  loadEnvFile();

  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const redisPrefix = `hireflip:single-active-class-smoke:${runId}`;
  const smokeDatabase = setupSmokeDatabase({
    runId,
    scriptName: 'single-active-class',
  });

  process.env.CLASS_ALLOCATION_REDIS_ENABLED = 'true';
  process.env.CLASS_ALLOCATION_REDIS_PREFIX = redisPrefix;

  const appContext = await compileStrapi();
  const strapi = await createStrapi(appContext).load();

  try {
    const area = await documents(strapi, 'api::class-area.class-area').create({
      data: {
        country: 'United Kingdom',
        name: `Single Active Class Area ${runId}`,
        slug: `single-active-area-${runId}`,
        state: 'active',
      },
    });
    const sector = await documents(strapi, 'api::work-sector.work-sector').create({
      data: {
        name: `Single Active Class Sector ${runId}`,
        slug: `single-active-sector-${runId}`,
        state: 'active',
      },
    });
    const course = await documents(strapi, 'api::course.course').create({
      data: {
        courseState: 'active',
        name: `Single Active Class Course ${runId}`,
        sector: 'Smoke',
        sourceType: 'internal',
        version: runId,
      },
    });
    const createClass = (suffix, sequence) =>
      documents(strapi, 'api::class.class').create({
        data: {
          capacity: 10,
          classArea: connect(area),
          course: connect(course),
          currency: 'GBP',
          discountedPricePence: 100,
          displayTitle: `Single Active Class ${suffix} ${runId}`,
          interviewsGuaranteed: 2,
          level: 'Entry',
          name: `Single Active Class ${suffix} ${runId}`,
          officialClassCode: `SAC-${sequence}-${runId}`.slice(0, 40),
          pricePence: 100,
          region: area.name,
          sector: sector.name,
          slug: `single-active-class-${suffix}-${runId}`,
          startDate: '2026-12-01',
          state: 'open',
          workSector: connect(sector),
          year: 2026,
          yearSequenceNumber: sequence,
        },
        populate: ['classArea', 'course', 'workSector'],
      });
    const [firstClass, secondClass] = await Promise.all([
      createClass('first', 997),
      createClass('second', 998),
    ]);
    const candidate = await documents(strapi, 'api::candidate.candidate').create({
      data: {
        accountOnboardingCompletedAt: new Date().toISOString(),
        accountRestrictionStatus: 'active',
        authIdentityId: `auth0|single-active-class-${runId}`,
        authProvider: 'auth0',
        candidateState: 'unenrolled',
        classAreaPreferences: preferenceSelection(area.slug),
        email: `single-active-class-${runId}@example.test`,
        firstName: 'Single',
        lastName: 'Journey',
        marketingConsentState: 'opted_out',
        preferredCommunicationChannel: 'email',
        workSectorPreferences: preferenceSelection(sector.slug),
      },
    });
    const auth = {
      email: candidate.email,
      subject: candidate.authIdentityId,
      type: 'auth0',
    };
    const candidateService = strapi.service('api::candidate.candidate');
    const reserve = (classRecord, suffix) =>
      candidateService.reserveCurrentCandidateClassPlace(
        auth,
        { classDocumentId: classRecord.documentId },
        {
          requestId: `single-active-class-${runId}-${suffix}`,
          serviceName: 'single-active-class-smoke',
        }
      );

    const concurrentResults = await Promise.allSettled([
      reserve(firstClass, 'concurrent-first'),
      reserve(secondClass, 'concurrent-second'),
    ]);
    const fulfilled = concurrentResults.filter((result) => result.status === 'fulfilled');
    const rejected = concurrentResults.filter((result) => result.status === 'rejected');
    const concurrentErrors = concurrentResults.map(errorMessage).filter(Boolean);

    assert(
      fulfilled.length === 1,
      `Expected one reservation to succeed, got ${fulfilled.length}. Errors: ${JSON.stringify(concurrentErrors)}`
    );
    assert(rejected.length === 1, `Expected one reservation to be rejected, got ${rejected.length}.`);
    assert(
      errorMessage(rejected[0]) === expectedConflictMessage,
      `Unexpected concurrent rejection: ${errorMessage(rejected[0])}`
    );

    const enrollments = await documents(strapi, 'api::enrollment.enrollment').findMany({
      filters: {
        candidate: {
          documentId: candidate.documentId,
        },
      },
      populate: ['class'],
    });

    assert(enrollments.length === 1, `Expected one enrollment, got ${enrollments.length}.`);

    let activeEnrollment = enrollments[0];
    const otherClass =
      activeEnrollment.class.documentId === firstClass.documentId ? secondClass : firstClass;

    for (const enrollmentState of ['enrolled', 'in_class', 'interview_phase']) {
      activeEnrollment = await documents(strapi, 'api::enrollment.enrollment').update({
        documentId: activeEnrollment.documentId,
        data: {
          enrollmentState,
          paymentStatus: 'paid',
          reservationExpiresAt: null,
        },
        populate: ['class'],
      });
      const blockedResult = await Promise.allSettled([
        reserve(otherClass, `blocked-${enrollmentState}`),
      ]);

      assert(
        errorMessage(blockedResult[0]) === expectedConflictMessage,
        `Expected ${enrollmentState} to block another reservation, got ${errorMessage(blockedResult[0])}.`
      );
    }

    await documents(strapi, 'api::enrollment.enrollment').update({
      documentId: activeEnrollment.documentId,
      data: {
        completionStatus: 'completed',
        completedAt: new Date().toISOString(),
        enrollmentState: 'completed',
        passStatus: 'passed',
      },
    });

    const nextJourney = await reserve(otherClass, 'after-completion');

    assert(nextJourney.reserved === true, 'Expected a completed journey to allow a new reservation.');
    strapi.log.info(
      `Single active class smoke passed: ${JSON.stringify({
        blockingStates: ['place_reserved', 'enrolled', 'in_class', 'interview_phase'],
        concurrencyProtected: true,
        completedJourneyCanReserveAgain: true,
      })}`
    );
  } finally {
    await strapi.destroy();
    await cleanupRedisPrefix(redisPrefix);
    await smokeDatabase.cleanup();
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

#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { Queue } = require('bullmq');
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

const authForCandidate = (candidate) => ({
  email: candidate.email,
  subject: candidate.authIdentityId,
  type: 'auth0',
});

const cleanupClassAllocationRedisKeys = async (classDocumentId) => {
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

const cleanupClassWorkflowJobs = async (offerDocumentIds) => {
  const offerIds = new Set(offerDocumentIds.filter(Boolean));

  if (offerIds.size === 0) {
    return;
  }

  const redisUrl =
    process.env.CLASS_WORKFLOW_QUEUE_REDIS_URL ||
    process.env.CLASS_ALLOCATION_REDIS_URL ||
    process.env.REDIS_URL ||
    'redis://localhost:6379';
  const connection = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    tls: redisUrl.startsWith('rediss://')
      ? {
          rejectUnauthorized: boolEnv('CLASS_WORKFLOW_QUEUE_REDIS_TLS_REJECT_UNAUTHORIZED', false),
        }
      : undefined,
  });
  const queue = new Queue(process.env.CLASS_WORKFLOW_QUEUE_NAME || 'class-workflow', {
    connection,
    prefix: (process.env.CLASS_WORKFLOW_QUEUE_PREFIX || 'hireflip:class-workflow').replace(/:+$/g, ''),
  });

  connection.on('error', () => undefined);

  try {
    const jobs = await queue.getJobs(['delayed', 'waiting', 'failed', 'completed'], 0, -1);
    const matchingJobs = jobs.filter((job) => offerIds.has(job.data?.offerDocumentId));

    for (const job of matchingJobs) {
      await job.remove().catch(() => undefined);
    }
  } finally {
    await queue.close().catch(() => undefined);
    await connection.quit().catch(() => connection.disconnect());
  }
};

const findActiveOffer = async (strapi, classRecord, candidate) => {
  const offers = await documents(strapi, 'api::waiting-list-offer.waiting-list-offer').findMany({
    filters: {
      candidate: {
        documentId: candidate.documentId,
      },
      class: {
        documentId: classRecord.documentId,
      },
      offerState: 'active',
    },
    limit: 1,
    populate: ['candidate', 'class', 'enrollment', 'reservation'],
    sort: ['offeredAt:desc', 'createdAt:desc'],
  });

  return offers[0];
};

const findOfferByDocumentId = async (strapi, documentId) => {
  const offers = await documents(strapi, 'api::waiting-list-offer.waiting-list-offer').findMany({
    filters: {
      documentId,
    },
    limit: 1,
    populate: ['candidate', 'class', 'enrollment', 'reservation'],
  });

  return offers[0];
};

const findCandidateEnrollment = async (strapi, classRecord, candidate) => {
  const enrollments = await documents(strapi, 'api::enrollment.enrollment').findMany({
    filters: {
      candidate: {
        documentId: candidate.documentId,
      },
      class: {
        documentId: classRecord.documentId,
      },
    },
    limit: 1,
    populate: ['candidate', 'class'],
  });

  return enrollments[0];
};

const countClassRecords = async (strapi, uid, classRecord, extraFilters = {}) =>
  (
    await documents(strapi, uid).findMany({
      filters: {
        ...extraFilters,
        class: {
          documentId: classRecord.documentId,
        },
      },
      fields: ['documentId'],
      limit: 1000,
    })
  ).length;

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const setupSmokeData = async (strapi, runId) => {
  const areaSlug = `waiting-list-smoke-area-${runId}`;
  const sectorSlug = `waiting-list-smoke-sector-${runId}`;
  const area = await createDocument(strapi, 'api::class-area.class-area', {
    country: 'United Kingdom',
    name: `Waiting List Smoke Area ${runId}`,
    slug: areaSlug,
    state: 'active',
  });
  const sector = await createDocument(strapi, 'api::work-sector.work-sector', {
    name: `Waiting List Smoke Sector ${runId}`,
    slug: sectorSlug,
    state: 'active',
  });
  const course = await createDocument(strapi, 'api::course.course', {
    name: `Waiting List Smoke Course ${runId}`,
    sector: 'Smoke',
    sourceType: 'internal',
    courseState: 'active',
    version: runId,
  });
  const classRecord = await createDocument(
    strapi,
    'api::class.class',
    {
      capacity: 1,
      classArea: {
        connect: [{ documentId: area.documentId }],
      },
      course: {
        connect: [{ documentId: course.documentId }],
      },
      currency: 'GBP',
      discountedPricePence: 100,
      displayTitle: `Waiting List Smoke Class ${runId}`,
      interviewsGuaranteed: 2,
      level: 'Entry',
      name: `Waiting List Smoke Class ${runId}`,
      officialClassCode: `WL Smoke ${runId}`,
      pricePence: 100,
      region: area.name,
      sector: sector.name,
      slug: `waiting-list-smoke-class-${runId}`,
      startDate: '2026-12-01',
      state: 'open',
      workSector: {
        connect: [{ documentId: sector.documentId }],
      },
      year: 2026,
      yearSequenceNumber: 998,
    },
    ['classArea', 'workSector', 'course']
  );
  const candidates = [];

  for (let index = 0; index < 4; index += 1) {
    candidates.push(
      await createDocument(strapi, 'api::candidate.candidate', {
        accountOnboardingCompletedAt: new Date().toISOString(),
        accountRestrictionStatus: 'active',
        authIdentityId: `auth0|waiting-list-smoke-${runId}-${index}`,
        authProvider: 'auth0',
        classAreaPreferences: preferenceSelection(areaSlug),
        email: `waiting-list-smoke-${runId}-${index}@example.test`,
        firstName: 'WaitingList',
        lastName: `Smoke ${index}`,
        marketingConsentState: 'opted_out',
        preferredCommunicationChannel: 'email',
        candidateState: 'unenrolled',
        workSectorPreferences: preferenceSelection(sectorSlug),
      })
    );
  }

  return {
    area,
    candidates,
    classRecord,
    course,
    sector,
  };
};

const cleanupSmokeData = async (strapi, created, runId) => {
  if (created.classRecord?.documentId) {
    const [
      auditEvents,
      notificationEvents,
      offers,
      payments,
      reservations,
      enrollments,
    ] = await Promise.all([
      documents(strapi, 'api::audit-event.audit-event').findMany({
        filters: {
          requestId: `waiting-list-smoke-${runId}`,
        },
        fields: ['documentId'],
        limit: 1000,
      }),
      documents(strapi, 'api::notification-event.notification-event').findMany({
        filters: {
          class: {
            documentId: created.classRecord.documentId,
          },
        },
        fields: ['documentId'],
        limit: 1000,
      }),
      documents(strapi, 'api::waiting-list-offer.waiting-list-offer').findMany({
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
    ]);

    await cleanupClassWorkflowJobs(offers.map((offer) => offer.documentId));
    await cleanupClassAllocationRedisKeys(created.classRecord.documentId);
    await deleteDocuments(strapi, 'api::notification-event.notification-event', notificationEvents);
    await deleteDocuments(strapi, 'api::payment.payment', payments);
    await deleteDocuments(strapi, 'api::waiting-list-offer.waiting-list-offer', offers);
    await deleteDocuments(strapi, 'api::reservation.reservation', reservations);
    await deleteDocuments(strapi, 'api::enrollment.enrollment', enrollments);
    await deleteDocuments(strapi, 'api::audit-event.audit-event', auditEvents);
  }

  await deleteDocument(strapi, 'api::class.class', created.classRecord?.documentId);
  await deleteDocument(strapi, 'api::course.course', created.course?.documentId);
  await deleteDocument(strapi, 'api::class-area.class-area', created.area?.documentId);
  await deleteDocument(strapi, 'api::work-sector.work-sector', created.sector?.documentId);

  for (const candidate of created.candidates || []) {
    await deleteDocument(strapi, 'api::candidate.candidate', candidate.documentId);
  }
};

const main = async () => {
  loadEnvFile();

  process.env.CLASS_ALLOCATION_REDIS_ENABLED =
    process.env.CLASS_ALLOCATION_REDIS_ENABLED || 'true';

  if (process.env.WAITING_LIST_SMOKE_NOTIFICATION_MODE !== 'enabled') {
    process.env.NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://127.0.0.1:1';
    process.env.NOTIFICATION_SERVICE_TOKEN = process.env.NOTIFICATION_SERVICE_TOKEN || 'waiting-list-smoke-token';
  }

  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const reopenedRunId = `${runId}-reopened`;
  const requestContext = {
    requestId: `waiting-list-smoke-${runId}`,
    serviceName: 'waiting-list-smoke-script',
  };
  const reopenedRequestContext = {
    requestId: `waiting-list-smoke-${reopenedRunId}`,
    serviceName: 'waiting-list-smoke-script',
  };
  const created = {
    area: undefined,
    candidates: [],
    classRecord: undefined,
    course: undefined,
    sector: undefined,
  };
  const reopenedCreated = {
    area: undefined,
    candidates: [],
    classRecord: undefined,
    course: undefined,
    sector: undefined,
  };
  const appContext = await compileStrapi();
  const strapi = await createStrapi(appContext).load();

  try {
    Object.assign(created, await setupSmokeData(strapi, runId));
    Object.assign(reopenedCreated, await setupSmokeData(strapi, reopenedRunId));

    const candidateService = strapi.service('api::candidate.candidate');
    const [holder, declineCandidate, expireCandidate, claimCandidate] = created.candidates;
    const holderReservation = await candidateService.reserveCurrentCandidateClassPlace(
      authForCandidate(holder),
      {
        classDocumentId: created.classRecord.documentId,
      },
      requestContext
    );

    assert(holderReservation.reserved === true, 'Expected first candidate to reserve the only place.');
    assert(
      holderReservation.reservation?.documentId,
      'Expected first reservation to return a reservation document ID.'
    );

    for (const candidate of [declineCandidate, expireCandidate, claimCandidate]) {
      const waitingListResult = await candidateService.reserveCurrentCandidateClassPlace(
        authForCandidate(candidate),
        {
          classDocumentId: created.classRecord.documentId,
        },
        requestContext
      );

      assert(waitingListResult.reserved === false, 'Expected excess candidates to join the waiting list.');
    }

    await candidateService.cancelCurrentCandidateClassReservation(
      authForCandidate(holder),
      holderReservation.reservation.documentId,
      requestContext
    );

    const declineOffer = await findActiveOffer(strapi, created.classRecord, declineCandidate);

    assert(declineOffer?.documentId, 'Expected the first waiting-list candidate to receive an active offer.');

    await candidateService.declineCurrentCandidateWaitingListOffer(
      authForCandidate(declineCandidate),
      declineOffer.documentId,
      requestContext
    );

    const declinedOffer = await findOfferByDocumentId(strapi, declineOffer.documentId);
    const expireOffer = await findActiveOffer(strapi, created.classRecord, expireCandidate);

    assert(declinedOffer?.offerState === 'declined', 'Expected first offer to be declined.');
    assert(expireOffer?.documentId, 'Expected the second waiting-list candidate to receive an active offer.');

    await documents(strapi, 'api::waiting-list-offer.waiting-list-offer').update({
      documentId: expireOffer.documentId,
      data: {
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      },
      populate: ['candidate', 'class', 'enrollment', 'reservation'],
    });
    await candidateService.expireWaitingListOfferByDocumentId(
      expireOffer.documentId,
      requestContext
    );

    const expiredOffer = await findOfferByDocumentId(strapi, expireOffer.documentId);
    const claimOffer = await findActiveOffer(strapi, created.classRecord, claimCandidate);

    assert(expiredOffer?.offerState === 'expired', 'Expected second offer to expire.');
    assert(claimOffer?.documentId, 'Expected the third waiting-list candidate to receive an active offer.');

    const claimResult = await candidateService.reserveCurrentCandidateClassPlace(
      authForCandidate(claimCandidate),
      {
        classDocumentId: created.classRecord.documentId,
        waitingListOfferDocumentId: claimOffer.documentId,
      },
      requestContext
    );
    const claimedOffer = await findOfferByDocumentId(strapi, claimOffer.documentId);
    const claimEnrollment = await findCandidateEnrollment(
      strapi,
      created.classRecord,
      claimCandidate
    );
    const activeReservationCount = await countClassRecords(
      strapi,
      'api::reservation.reservation',
      created.classRecord,
      {
        reservationState: 'active',
      }
    );

    assert(claimResult.reserved === true, 'Expected the final waiting-list offer to claim a place.');
    assert(claimedOffer?.offerState === 'claimed', 'Expected final waiting-list offer to be marked claimed.');
    assert(
      claimEnrollment?.enrollmentState === 'place_reserved',
      'Expected final waiting-list candidate to move to place_reserved.'
    );
    assert(activeReservationCount === 1, `Expected exactly one active reservation, got ${activeReservationCount}.`);

    const offerCounts = {
      active: await countClassRecords(strapi, 'api::waiting-list-offer.waiting-list-offer', created.classRecord, {
        offerState: 'active',
      }),
      claimed: await countClassRecords(strapi, 'api::waiting-list-offer.waiting-list-offer', created.classRecord, {
        offerState: 'claimed',
      }),
      declined: await countClassRecords(strapi, 'api::waiting-list-offer.waiting-list-offer', created.classRecord, {
        offerState: 'declined',
      }),
      expired: await countClassRecords(strapi, 'api::waiting-list-offer.waiting-list-offer', created.classRecord, {
        offerState: 'expired',
      }),
    };

    assert(offerCounts.active === 0, 'Expected no active offers after final claim.');
    assert(offerCounts.claimed === 1, 'Expected one claimed offer.');
    assert(offerCounts.declined === 1, 'Expected one declined offer.');
    assert(offerCounts.expired === 1, 'Expected one expired offer.');

    const [reopenedHolder, reopenedWaitlisted] = reopenedCreated.candidates;
    const reopenedHolderReservation = await candidateService.reserveCurrentCandidateClassPlace(
      authForCandidate(reopenedHolder),
      {
        classDocumentId: reopenedCreated.classRecord.documentId,
      },
      reopenedRequestContext
    );

    assert(
      reopenedHolderReservation.reserved === true,
      'Expected reopened scenario holder to reserve the original place.'
    );

    const reopenedWaitingListResult = await candidateService.reserveCurrentCandidateClassPlace(
      authForCandidate(reopenedWaitlisted),
      {
        classDocumentId: reopenedCreated.classRecord.documentId,
      },
      reopenedRequestContext
    );

    assert(
      reopenedWaitingListResult.reserved === false,
      'Expected reopened scenario candidate to join the waiting list before capacity increases.'
    );

    reopenedCreated.classRecord = await documents(strapi, 'api::class.class').update({
      documentId: reopenedCreated.classRecord.documentId,
      data: {
        state: 'full',
      },
      populate: ['classArea', 'workSector', 'course'],
    });

    const fullClassInterest = await candidateService.getCurrentCandidateClassInterest(
      authForCandidate(reopenedWaitlisted)
    );
    const fullClassRelationship = fullClassInterest.classes.find(
      (relationship) => relationship.class.documentId === reopenedCreated.classRecord.documentId
    );

    assert(
      fullClassRelationship?.state === 'waiting_list',
      `Expected full class relationship to remain waiting_list, got ${fullClassRelationship?.state}.`
    );

    reopenedCreated.classRecord = await documents(strapi, 'api::class.class').update({
      documentId: reopenedCreated.classRecord.documentId,
      data: {
        capacity: 2,
        state: 'open',
      },
      populate: ['classArea', 'workSector', 'course'],
    });

    const reopenedClassInterest = await candidateService.getCurrentCandidateClassInterest(
      authForCandidate(reopenedWaitlisted)
    );
    const reopenedClassRelationship = reopenedClassInterest.classes.find(
      (relationship) => relationship.class.documentId === reopenedCreated.classRecord.documentId
    );

    assert(
      reopenedClassRelationship?.state === 'enrollment_open',
      `Expected reopened waitlisted candidate to become enrollment_open, got ${reopenedClassRelationship?.state}.`
    );
    assert(
      reopenedClassRelationship?.canJoinClass === true,
      'Expected reopened waitlisted candidate relationship to allow joining.'
    );

    const reopenedReserveResult = await candidateService.reserveCurrentCandidateClassPlace(
      authForCandidate(reopenedWaitlisted),
      {
        classDocumentId: reopenedCreated.classRecord.documentId,
      },
      reopenedRequestContext
    );
    const reopenedEnrollment = await findCandidateEnrollment(
      strapi,
      reopenedCreated.classRecord,
      reopenedWaitlisted
    );

    assert(
      reopenedReserveResult.reserved === true,
      'Expected reopened waitlisted candidate to reserve without a waiting-list offer.'
    );
    assert(
      reopenedEnrollment?.enrollmentState === 'place_reserved',
      'Expected reopened waitlisted candidate enrollment to move to place_reserved.'
    );
    assert(
      !reopenedEnrollment?.waitingListPosition,
      'Expected reopened waitlisted candidate to be removed from the waiting list after reservation.'
    );

    strapi.log.info(
      `Waiting-list offer smoke passed: ${JSON.stringify({
        activeReservationCount,
        offerCounts,
        reopenedWaitlistClaim: reopenedEnrollment?.enrollmentState,
      })}`
    );
  } finally {
    if (process.env.WAITING_LIST_SMOKE_KEEP_DATA !== 'true') {
      await cleanupSmokeData(strapi, created, runId);
      await cleanupSmokeData(strapi, reopenedCreated, reopenedRunId);
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

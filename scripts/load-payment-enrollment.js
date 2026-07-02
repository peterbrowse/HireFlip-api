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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const allSettledWithConcurrency = async (items, concurrency, worker) => {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(items.length, concurrency));

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;

        try {
          results[index] = {
            status: 'fulfilled',
            value: await worker(items[index], index),
          };
        } catch (reason) {
          results[index] = {
            reason,
            status: 'rejected',
          };
        }
      }
    })
  );

  return results;
};

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const objectValue = (value) => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }

  return {};
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

const unique = (values) => [...new Set(values.filter(Boolean))];

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

const requestContext = (runId, mode, name) => ({
  requestId: `payment-enrollment-load-${runId}-${mode}-${name}`,
  serviceName: 'payment-enrollment-load-script',
});

const installRedisDelayChaos = (enabled) => {
  if (!enabled) {
    return () => undefined;
  }

  const originalEval = Redis.prototype.eval;
  const minDelayMs = numberEnv('PAYMENT_ENROLLMENT_LOAD_REDIS_MIN_DELAY_MS', 15);
  const maxDelayMs = Math.max(minDelayMs, numberEnv('PAYMENT_ENROLLMENT_LOAD_REDIS_MAX_DELAY_MS', 120));

  Redis.prototype.eval = async function evalWithLoadDelay(...args) {
    const delay = minDelayMs + Math.floor(Math.random() * (maxDelayMs - minDelayMs + 1));
    await sleep(delay);
    return originalEval.apply(this, args);
  };

  return () => {
    Redis.prototype.eval = originalEval;
  };
};

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

const setupLoadData = async (strapi, runId, { candidateCount, capacity, mode }) => {
  const areaSlug = `payment-enrollment-load-area-${mode}-${runId}`;
  const sectorSlug = `payment-enrollment-load-sector-${mode}-${runId}`;
  const area = await createDocument(strapi, 'api::class-area.class-area', {
    country: 'United Kingdom',
    name: `Payment Enrollment Load Area ${mode} ${runId}`,
    slug: areaSlug,
    state: 'active',
  });
  const sector = await createDocument(strapi, 'api::work-sector.work-sector', {
    name: `Payment Enrollment Load Sector ${mode} ${runId}`,
    slug: sectorSlug,
    state: 'active',
  });
  const course = await createDocument(strapi, 'api::course.course', {
    name: `Payment Enrollment Load Course ${mode} ${runId}`,
    sector: 'Load',
    sourceType: 'internal',
    courseState: 'active',
    version: `${mode}-${runId}`,
  });
  const classRecord = await createDocument(
    strapi,
    'api::class.class',
    {
      capacity,
      classArea: {
        connect: [{ documentId: area.documentId }],
      },
      course: {
        connect: [{ documentId: course.documentId }],
      },
      currency: 'GBP',
      discountedPricePence: 100,
      displayTitle: `Payment Enrollment Load Class ${mode} ${runId}`,
      interviewsGuaranteed: 2,
      level: 'Entry',
      name: `Payment Enrollment Load Class ${mode} ${runId}`,
      officialClassCode: `Load ${mode} ${runId}`.slice(0, 80),
      pricePence: 100,
      region: area.name,
      sector: sector.name,
      slug: `payment-enrollment-load-class-${mode}-${runId}`,
      startDate: '2026-12-01',
      state: 'open',
      workSector: {
        connect: [{ documentId: sector.documentId }],
      },
      year: 2026,
      yearSequenceNumber: 997,
    },
    ['classArea', 'workSector', 'course']
  );
  const candidates = [];

  for (let index = 0; index < candidateCount; index += 1) {
    const candidate = await createDocument(strapi, 'api::candidate.candidate', {
      accountOnboardingCompletedAt: new Date().toISOString(),
      accountRestrictionStatus: 'active',
      authIdentityId: `auth0|payment-enrollment-load-${mode}-${runId}-${index}`,
      authProvider: 'auth0',
      candidateState: 'unenrolled',
      classAreaPreferences: preferenceSelection(areaSlug),
      email: `payment-enrollment-load-${mode}-${runId}-${index}@example.test`,
      firstName: 'Payment',
      lastName: `Load ${index}`,
      marketingConsentState: 'opted_out',
      preferredCommunicationChannel: 'email',
      workSectorPreferences: preferenceSelection(sectorSlug),
    });

    candidates.push(candidate);
  }

  return {
    area,
    candidates,
    classRecord,
    course,
    sector,
  };
};

const findClassReservations = async (strapi, classDocumentId, reservationState) =>
  documents(strapi, 'api::reservation.reservation').findMany({
    filters: {
      class: {
        documentId: classDocumentId,
      },
      ...(reservationState ? { reservationState } : {}),
    },
    limit: 1000,
    populate: ['candidate', 'class', 'enrollment'],
    sort: ['reservationStartedAt:asc', 'createdAt:asc'],
  });

const findClassEnrollments = async (strapi, classDocumentId) =>
  documents(strapi, 'api::enrollment.enrollment').findMany({
    filters: {
      class: {
        documentId: classDocumentId,
      },
    },
    limit: 1000,
    populate: ['candidate', 'class'],
    sort: ['waitingListPosition:asc', 'createdAt:asc'],
  });

const findClassPayments = async (strapi, classDocumentId) =>
  documents(strapi, 'api::payment.payment').findMany({
    filters: {
      reservation: {
        class: {
          documentId: classDocumentId,
        },
      },
    },
    limit: 1000,
    populate: ['candidate', 'enrollment', 'reservation'],
    sort: ['createdAt:asc'],
  });

const findClassOffers = async (strapi, classDocumentId, offerState) =>
  documents(strapi, 'api::waiting-list-offer.waiting-list-offer').findMany({
    filters: {
      class: {
        documentId: classDocumentId,
      },
      ...(offerState ? { offerState } : {}),
    },
    limit: 1000,
    populate: ['candidate', 'class', 'enrollment', 'reservation'],
    sort: ['offeredAt:asc', 'createdAt:asc'],
  });

const findProviderWebhookEvents = async (strapi, providerEventIds) =>
  providerEventIds.length
    ? documents(strapi, 'api::payment-webhook-event.payment-webhook-event').findMany({
        filters: {
          providerEventId: {
            $in: providerEventIds,
          },
        },
        limit: Math.max(1000, providerEventIds.length + 10),
        populate: ['payment', 'refund'],
      })
    : [];

const getDocumentId = (record) => record?.documentId || (record?.id ? String(record.id) : undefined);

const assertUniqueCandidateRows = (records, label) => {
  const candidateIds = records
    .map((record) => getDocumentId(record.candidate))
    .filter(Boolean);
  const duplicateCandidateIds = candidateIds.filter((candidateId, index) => candidateIds.indexOf(candidateId) !== index);

  assert(
    duplicateCandidateIds.length === 0,
    `Duplicate ${label} rows for candidate(s): ${unique(duplicateCandidateIds).join(', ')}`
  );
};

const reserveCandidatesUnderLoad = async (
  strapi,
  created,
  { concurrency, duplicateAttempts, mode, runId }
) => {
  const candidateService = strapi.service('api::candidate.candidate');
  const attempts = created.candidates.flatMap((candidate) =>
    Array.from({ length: duplicateAttempts }, (_, attemptIndex) => ({
      attemptIndex,
      candidate,
    }))
  );
  const reservationConcurrency = Math.max(1, Math.min(attempts.length, concurrency || attempts.length));
  const results = await allSettledWithConcurrency(
    attempts,
    reservationConcurrency,
    ({ attemptIndex, candidate }) =>
      candidateService.reserveCurrentCandidateClassPlace(
        authForCandidate(candidate),
        {
          classDocumentId: created.classRecord.documentId,
        },
        requestContext(runId, mode, `reserve-${attemptIndex}`)
      )
  );
  const rejected = results.filter((result) => result.status === 'rejected');

  assert(
    rejected.length === 0,
    `${rejected.length} reservation attempt(s) rejected under load: ${JSON.stringify(
      rejected.slice(0, 10).map((result) => result.reason?.message || String(result.reason))
    )}`
  );

  return {
    attempts: attempts.length,
    concurrency: reservationConcurrency,
    reservedResponses: results.filter(
      (result) => result.status === 'fulfilled' && result.value?.reserved === true
    ).length,
    waitlistedResponses: results.filter(
      (result) => result.status === 'fulfilled' && result.value?.reserved === false
    ).length,
  };
};

const assertInitialAllocation = async (strapi, created, { capacity, candidateCount }) => {
  const classDocumentId = created.classRecord.documentId;
  const [activeReservations, enrollments] = await Promise.all([
    findClassReservations(strapi, classDocumentId, 'active'),
    findClassEnrollments(strapi, classDocumentId),
  ]);
  const waitingListEnrollments = enrollments.filter((enrollment) => enrollment.enrollmentState === 'waiting_list');

  assert(
    activeReservations.length === capacity,
    `Expected ${capacity} active reservation(s), got ${activeReservations.length}.`
  );
  assert(
    waitingListEnrollments.length === candidateCount - capacity,
    `Expected ${candidateCount - capacity} waiting-list enrollment(s), got ${waitingListEnrollments.length}.`
  );
  assert(
    enrollments.length === candidateCount,
    `Expected exactly one enrollment per candidate (${candidateCount}), got ${enrollments.length}.`
  );
  assertUniqueCandidateRows(activeReservations, 'active reservation');
  assertUniqueCandidateRows(enrollments, 'enrollment');

  return {
    activeReservations,
    enrollments,
    waitingListEnrollments,
  };
};

const exerciseWaitingListPromotion = async (strapi, created, { capacity, mode, runId }) => {
  const candidateService = strapi.service('api::candidate.candidate');
  const classDocumentId = created.classRecord.documentId;
  const initial = await assertInitialAllocation(strapi, created, {
    candidateCount: created.candidates.length,
    capacity,
  });
  const firstWaitlistedEnrollment = [...initial.waitingListEnrollments].sort(
    (left, right) => Number(left.waitingListPosition || 0) - Number(right.waitingListPosition || 0)
  )[0];
  const holderReservation = initial.activeReservations[0];

  assert(firstWaitlistedEnrollment?.candidate?.documentId, 'Expected at least one waiting-list candidate.');
  assert(holderReservation?.candidate?.authIdentityId, 'Expected an active reservation holder.');

  await candidateService.cancelCurrentCandidateClassReservation(
    authForCandidate(holderReservation.candidate),
    holderReservation.documentId,
    requestContext(runId, mode, 'promotion-cancel')
  );

  const activeOffers = await findClassOffers(strapi, classDocumentId, 'active');

  assert(activeOffers.length === 1, `Expected one active waiting-list offer after cancellation, got ${activeOffers.length}.`);
  assert(
    activeOffers[0].candidate?.documentId === firstWaitlistedEnrollment.candidate.documentId,
    `Expected waiting-list promotion for first candidate ${firstWaitlistedEnrollment.candidate.documentId}, got ${activeOffers[0].candidate?.documentId}.`
  );

  const claimResult = await candidateService.reserveCurrentCandidateClassPlace(
    authForCandidate(activeOffers[0].candidate),
    {
      classDocumentId,
      waitingListOfferDocumentId: activeOffers[0].documentId,
    },
    requestContext(runId, mode, 'promotion-claim')
  );

  assert(claimResult.reserved === true, 'Expected promoted waiting-list candidate to claim the released place.');

  const [activeReservations, claimedOffer] = await Promise.all([
    findClassReservations(strapi, classDocumentId, 'active'),
    documents(strapi, 'api::waiting-list-offer.waiting-list-offer').findMany({
      filters: {
        documentId: activeOffers[0].documentId,
      },
      limit: 1,
      populate: ['candidate', 'class', 'enrollment', 'reservation'],
    }),
  ]);

  assert(
    activeReservations.length === capacity,
    `Expected ${capacity} active reservation(s) after waiting-list claim, got ${activeReservations.length}.`
  );
  assert(claimedOffer[0]?.offerState === 'claimed', 'Expected promoted offer to be marked claimed.');

  return {
    cancelledCandidateDocumentId: holderReservation.candidate.documentId,
    claimedCandidateDocumentId: activeOffers[0].candidate.documentId,
    claimedOfferDocumentId: activeOffers[0].documentId,
  };
};

const createCheckoutPayment = async (strapi, reservation, checkoutSessionId) => {
  const checkoutUrl = `https://checkout.stripe.test/${checkoutSessionId}`;
  const payment = await documents(strapi, 'api::payment.payment').create({
    data: {
      amountPence: reservation.amountPence,
      candidate: {
        connect: [{ documentId: reservation.candidate.documentId }],
      },
      createdByService: 'payment-enrollment-load-script',
      currency: reservation.currency,
      enrollment: {
        connect: [{ documentId: reservation.enrollment.documentId }],
      },
      metadata: {
        checkoutUrl,
        providerSessionStatus: 'open',
        reservationDocumentId: reservation.documentId,
      },
      paymentProvider: 'stripe',
      paymentType: 'course_payment',
      providerCheckoutSessionId: checkoutSessionId,
      reservation: {
        connect: [{ documentId: reservation.documentId }],
      },
      slotReservationExpiresAt: reservation.expiresAt,
      paymentState: 'checkout_created',
    },
  });

  await documents(strapi, 'api::enrollment.enrollment').update({
    documentId: reservation.enrollment.documentId,
    data: {
      metadata: {
        ...(objectValue(reservation.enrollment.metadata)),
        activeCheckoutSessionId: checkoutSessionId,
        activePaymentDocumentId: payment.documentId,
      },
    },
  });

  return payment;
};

const normalizedCheckoutSession = ({
  checkoutSessionId,
  paymentStatus = 'paid',
  reservation,
  status = 'complete',
}) => ({
  amountTotal: reservation.amountPence,
  checkoutSessionId,
  checkoutUrl: `https://checkout.stripe.test/${checkoutSessionId}`,
  clientReferenceId: reservation.documentId,
  currency: String(reservation.currency || 'GBP').toLowerCase(),
  metadata: {
    candidateDocumentId: reservation.candidate.documentId,
    classDocumentId: reservation.class.documentId,
    enrollmentDocumentId: reservation.enrollment.documentId,
    reservationDocumentId: reservation.documentId,
    source: 'payment-enrollment-load-script',
  },
  paymentProvider: 'stripe',
  paymentStatus,
  receiptUrl: `https://pay.stripe.test/receipts/${checkoutSessionId}`,
  status,
});

const stripeWebhookPayload = ({
  checkoutSession,
  eventType,
  providerEventId,
}) => ({
  checkoutSession,
  createdAt: new Date().toISOString(),
  eventType,
  livemode: false,
  providerEventId,
});

const createCheckoutPayments = async (strapi, reservations, { mode, runId }) => {
  const payments = [];

  for (let index = 0; index < reservations.length; index += 1) {
    const reservation = reservations[index];
    const checkoutSessionId = `cs_payment_enrollment_load_${mode}_${runId}_${index}`;
    const payment = await createCheckoutPayment(strapi, reservation, checkoutSessionId);

    payments.push({
      checkoutSessionId,
      payment,
      reservation,
    });
  }

  return payments;
};

const assertSettled = (results, label) => {
  const rejected = results.filter((result) => result.status === 'rejected');

  assert(
    rejected.length === 0,
    `${label} had ${rejected.length} rejected operation(s): ${JSON.stringify(
      rejected.slice(0, 10).map((result) => result.reason?.message || String(result.reason))
    )}`
  );
};

const deliverBaselineWebhooks = async (strapi, checkoutPayments, { mode, providerEventIds, runId }) => {
  const webhookService = strapi.service('api::payment-webhook-event.payment-webhook-event');
  const operations = [];

  for (let index = 0; index < checkoutPayments.length; index += 1) {
    const { checkoutSessionId, reservation } = checkoutPayments[index];
    const providerEventId = `evt_payment_enrollment_load_${mode}_${runId}_${index}_success`;
    providerEventIds.push(providerEventId);
    const payload = stripeWebhookPayload({
      checkoutSession: normalizedCheckoutSession({ checkoutSessionId, reservation }),
      eventType: index % 2 === 0 ? 'checkout.session.completed' : 'checkout.session.async_payment_succeeded',
      providerEventId,
    });

    operations.push(webhookService.receiveStripeEvent(payload, requestContext(runId, mode, `webhook-${index}-a`)));
    operations.push(webhookService.receiveStripeEvent(payload, requestContext(runId, mode, `webhook-${index}-b`)));
  }

  assertSettled(await Promise.allSettled(operations), 'Baseline duplicate webhook delivery');
};

const seedFailedWebhookRows = async (strapi, checkoutPayments, { mode, providerEventIds, runId }) => {
  for (let index = 0; index < checkoutPayments.length; index += 1) {
    const { checkoutSessionId, reservation } = checkoutPayments[index];
    const providerEventId = `evt_payment_enrollment_load_${mode}_${runId}_${index}_retry`;
    providerEventIds.push(providerEventId);
    const payload = stripeWebhookPayload({
      checkoutSession: normalizedCheckoutSession({ checkoutSessionId, reservation }),
      eventType: 'checkout.session.completed',
      providerEventId,
    });

    await documents(strapi, 'api::payment-webhook-event.payment-webhook-event').create({
      data: {
        eventType: payload.eventType,
        metadata: {
          checkoutSessionId,
          livemode: false,
          providerCreatedAt: payload.createdAt,
        },
        paymentProvider: 'stripe',
        payload,
        processingError: 'Simulated load-test transient webhook failure.',
        processingState: 'failed',
        providerEventId,
        receivedAt: new Date().toISOString(),
      },
    });
  }
};

const deliverStaleOutcomeAfterSuccess = async (strapi, checkoutPayments, { mode, providerEventIds, runId }) => {
  const webhookService = strapi.service('api::payment-webhook-event.payment-webhook-event');
  const operations = checkoutPayments.map(async ({ checkoutSessionId, reservation }, index) => {
    const successProviderEventId = `evt_payment_enrollment_load_${mode}_${runId}_${index}_success_then_stale`;
    const staleProviderEventId = `evt_payment_enrollment_load_${mode}_${runId}_${index}_stale_expired`;
    providerEventIds.push(successProviderEventId, staleProviderEventId);

    await webhookService.receiveStripeEvent(
      stripeWebhookPayload({
        checkoutSession: normalizedCheckoutSession({ checkoutSessionId, reservation }),
        eventType: 'checkout.session.completed',
        providerEventId: successProviderEventId,
      }),
      requestContext(runId, mode, `stale-success-${index}`)
    );
    await sleep(10 + Math.floor(Math.random() * 90));
    await webhookService.receiveStripeEvent(
      stripeWebhookPayload({
        checkoutSession: normalizedCheckoutSession({
          checkoutSessionId,
          paymentStatus: 'unpaid',
          reservation,
          status: 'expired',
        }),
        eventType: 'checkout.session.expired',
        providerEventId: staleProviderEventId,
      }),
      requestContext(runId, mode, `stale-expired-${index}`)
    );
  });

  assertSettled(await Promise.allSettled(operations), 'Chaos stale webhook delivery');
};

const deliverChaosWebhooks = async (
  getStrapi,
  setStrapi,
  restartStrapi,
  checkoutPayments,
  { mode, providerEventIds, runId }
) => {
  const duplicateGroup = checkoutPayments.filter((_, index) => index % 3 === 0);
  const retryGroup = checkoutPayments.filter((_, index) => index % 3 === 1);
  const staleGroup = checkoutPayments.filter((_, index) => index % 3 === 2);

  await deliverBaselineWebhooks(getStrapi(), duplicateGroup, {
    mode: `${mode}_duplicate`,
    providerEventIds,
    runId,
  });
  await seedFailedWebhookRows(getStrapi(), retryGroup, {
    mode,
    providerEventIds,
    runId,
  });
  setStrapi(await restartStrapi('after-failed-webhook-seed'));

  const retrySummary = await getStrapi()
    .service('api::payment-webhook-event.payment-webhook-event')
    .retryFailedStripeEvents(200);

  assert(
    retrySummary.processed >= retryGroup.length,
    `Expected at least ${retryGroup.length} failed webhook event(s) to be retried, got ${JSON.stringify(retrySummary)}.`
  );

  await deliverStaleOutcomeAfterSuccess(getStrapi(), staleGroup, {
    mode,
    providerEventIds,
    runId,
  });
};

const assertFinalState = async (strapi, created, checkoutPayments, providerEventIds, {
  capacity,
  candidateCount,
  promotion,
}) => {
  const classDocumentId = created.classRecord.documentId;
  const [reservations, activeReservations, enrollments, payments, activeOffers, webhookEvents] = await Promise.all([
    findClassReservations(strapi, classDocumentId),
    findClassReservations(strapi, classDocumentId, 'active'),
    findClassEnrollments(strapi, classDocumentId),
    findClassPayments(strapi, classDocumentId),
    findClassOffers(strapi, classDocumentId, 'active'),
    findProviderWebhookEvents(strapi, unique(providerEventIds)),
  ]);
  const paidReservations = reservations.filter((reservation) => reservation.reservationState === 'paid');
  const cancelledReservations = reservations.filter((reservation) => reservation.reservationState === 'cancelled');
  const paidEnrollments = enrollments.filter(
    (enrollment) => enrollment.enrollmentState === 'enrolled' && enrollment.paymentStatus === 'paid'
  );
  const waitingListEnrollments = enrollments.filter((enrollment) => enrollment.enrollmentState === 'waiting_list');
  const paymentExceptions = [
    ...reservations.filter((reservation) => reservation.reservationState === 'payment_exception'),
    ...enrollments.filter((enrollment) => enrollment.enrollmentState === 'payment_exception'),
    ...payments.filter((payment) => payment.paymentState === 'requires_review'),
  ];
  const failedWebhookEvents = webhookEvents.filter((event) => event.processingState === 'failed');
  const expectedWaitingListCount = candidateCount - capacity;

  assert(activeReservations.length === 0, `Expected no active reservations after payment, got ${activeReservations.length}.`);
  assert(paidReservations.length === capacity, `Expected ${capacity} paid reservations, got ${paidReservations.length}.`);
  assert(
    cancelledReservations.some((reservation) => reservation.candidate?.documentId === promotion.cancelledCandidateDocumentId),
    'Expected the intentionally cancelled reservation holder to stay cancelled.'
  );
  assert(paidEnrollments.length === capacity, `Expected ${capacity} paid enrollments, got ${paidEnrollments.length}.`);
  assert(
    waitingListEnrollments.length === expectedWaitingListCount,
    `Expected ${expectedWaitingListCount} candidates to remain on the waiting list, got ${waitingListEnrollments.length}.`
  );
  assert(
    !waitingListEnrollments.some(
      (enrollment) => enrollment.candidate?.documentId === promotion.claimedCandidateDocumentId
    ),
    'Expected the promoted waiting-list candidate to leave the waiting list after claiming.'
  );
  assert(enrollments.length === candidateCount, `Expected ${candidateCount} enrollments, got ${enrollments.length}.`);
  assert(paymentExceptions.length === 0, `Expected no payment exception rows, got ${paymentExceptions.length}.`);
  assert(activeOffers.length === 0, `Expected no active waiting-list offers after final state, got ${activeOffers.length}.`);
  assert(failedWebhookEvents.length === 0, `Expected no failed webhook events, got ${failedWebhookEvents.length}.`);
  assertUniqueCandidateRows(paidReservations, 'paid reservation');
  assertUniqueCandidateRows(paidEnrollments, 'paid enrollment');
  assertUniqueCandidateRows(enrollments, 'enrollment');

  for (const { checkoutSessionId } of checkoutPayments) {
    const matchingPayments = payments.filter((payment) => payment.providerCheckoutSessionId === checkoutSessionId);

    assert(
      matchingPayments.length === 1,
      `Expected exactly one payment for checkout session ${checkoutSessionId}, got ${matchingPayments.length}.`
    );
    assert(
      matchingPayments[0].paymentState === 'paid',
      `Expected checkout session ${checkoutSessionId} to remain paid, got ${matchingPayments[0].paymentState}.`
    );
  }

  for (const providerEventId of unique(providerEventIds)) {
    const matchingEvents = webhookEvents.filter((event) => event.providerEventId === providerEventId);

    assert(
      matchingEvents.length === 1,
      `Expected exactly one webhook event row for ${providerEventId}, got ${matchingEvents.length}.`
    );
    assert(
      ['processed', 'ignored'].includes(matchingEvents[0].processingState),
      `Expected webhook event ${providerEventId} to be processed or ignored, got ${matchingEvents[0].processingState}.`
    );
  }

  return {
    activeReservations: activeReservations.length,
    candidateCount,
    checkoutSessions: checkoutPayments.length,
    paidEnrollments: paidEnrollments.length,
    paidReservations: paidReservations.length,
    providerWebhookEvents: unique(providerEventIds).length,
    waitingListEnrollments: waitingListEnrollments.length,
  };
};

const cleanupLoadData = async (strapi, created, { providerEventIds, requestIdPrefix }) => {
  await cleanupRedisKeys(created.classRecord?.documentId);

  if (created.classRecord?.documentId) {
    const [webhookEvents, payments, offers, reservations, enrollments, auditEvents] = await Promise.all([
      findProviderWebhookEvents(strapi, unique(providerEventIds)),
      findClassPayments(strapi, created.classRecord.documentId),
      findClassOffers(strapi, created.classRecord.documentId),
      findClassReservations(strapi, created.classRecord.documentId),
      findClassEnrollments(strapi, created.classRecord.documentId),
      requestIdPrefix
        ? documents(strapi, 'api::audit-event.audit-event').findMany({
            filters: {
              requestId: {
                $contains: requestIdPrefix,
              },
            },
            fields: ['documentId'],
            limit: 1000,
          })
        : [],
    ]);

    await deleteDocuments(strapi, 'api::payment-webhook-event.payment-webhook-event', webhookEvents);
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

  if (process.env.PAYMENT_ENROLLMENT_LOAD_NOTIFICATION_MODE !== 'enabled') {
    process.env.NOTIFICATION_SERVICE_URL = 'http://127.0.0.1:1';
    process.env.NOTIFICATION_SERVICE_TOKEN = 'payment-enrollment-load-token';
  }

  const mode = (process.env.PAYMENT_ENROLLMENT_LOAD_MODE || 'baseline').toLowerCase();
  const allowedModes = new Set(['baseline', 'chaos']);

  assert(allowedModes.has(mode), 'PAYMENT_ENROLLMENT_LOAD_MODE must be baseline or chaos.');

  const capacity = numberEnv('PAYMENT_ENROLLMENT_LOAD_CAPACITY', 30);
  const candidateCount = numberEnv(
    'PAYMENT_ENROLLMENT_LOAD_CANDIDATES',
    Math.max(capacity + 15, capacity * 3)
  );
  const duplicateAttempts = numberEnv('PAYMENT_ENROLLMENT_LOAD_DUPLICATE_ATTEMPTS', 2);
  const reservationConcurrency = numberEnv(
    'PAYMENT_ENROLLMENT_LOAD_CONCURRENCY',
    Math.max(4, Math.min(candidateCount, numberEnv('DATABASE_POOL_MAX', 10)))
  );
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const providerEventIds = [];
  const requestIdPrefix = `payment-enrollment-load-${runId}-${mode}`;

  assert(candidateCount > capacity, 'PAYMENT_ENROLLMENT_LOAD_CANDIDATES must be greater than capacity.');

  const restoreRedisChaos = installRedisDelayChaos(mode === 'chaos');
  const appContext = await compileStrapi();
  let strapi = await createStrapi(appContext).load();
  let created = {
    area: undefined,
    candidates: [],
    classRecord: undefined,
    course: undefined,
    sector: undefined,
  };

  const restartStrapi = async (label) => {
    await strapi.destroy();
    strapi = await createStrapi(appContext).load();
    strapi.log.info(`Payment enrollment load simulated API restart: ${label}`);
    return strapi;
  };

  try {
    created = await setupLoadData(strapi, runId, {
      candidateCount,
      capacity,
      mode,
    });

    const reservationLoad = await reserveCandidatesUnderLoad(strapi, created, {
      concurrency: reservationConcurrency,
      duplicateAttempts,
      mode,
      runId,
    });

    const promotion = await exerciseWaitingListPromotion(strapi, created, {
      capacity,
      mode,
      runId,
    });

    if (mode === 'chaos') {
      strapi = await restartStrapi('after-reservation-and-promotion');
    }

    const activeReservations = await findClassReservations(strapi, created.classRecord.documentId, 'active');
    const checkoutPayments = await createCheckoutPayments(strapi, activeReservations, {
      mode,
      runId,
    });

    if (mode === 'chaos') {
      await deliverChaosWebhooks(
        () => strapi,
        (nextStrapi) => {
          strapi = nextStrapi;
        },
        restartStrapi,
        checkoutPayments,
        {
          mode,
          providerEventIds,
          runId,
        }
      );
    } else {
      await deliverBaselineWebhooks(strapi, checkoutPayments, {
        mode,
        providerEventIds,
        runId,
      });
    }

    const finalState = await assertFinalState(strapi, created, checkoutPayments, providerEventIds, {
      capacity,
      candidateCount,
      promotion,
    });
    const summary = {
      ...finalState,
      capacity,
      duplicateAttempts,
      mode,
      reservationAttempts: reservationLoad.attempts,
      reservationConcurrency: reservationLoad.concurrency,
      runId,
    };

    strapi.log.info(`Payment enrollment ${mode} load passed: ${JSON.stringify(summary)}`);
    console.log(`PAYMENT_ENROLLMENT_LOAD_SUMMARY ${JSON.stringify(summary)}`);
  } finally {
    restoreRedisChaos();

    if (process.env.PAYMENT_ENROLLMENT_LOAD_KEEP_DATA !== 'true') {
      await cleanupLoadData(strapi, created, {
        providerEventIds,
        requestIdPrefix,
      }).catch((error) => {
        console.error('Payment enrollment load cleanup failed.', error);
      });
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

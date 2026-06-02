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

const objectValue = (value) => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }

  return {};
};

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
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

const setupSmokeData = async (strapi, runId, candidateCount = 8) => {
  const areaSlug = `payment-edge-smoke-area-${runId}`;
  const sectorSlug = `payment-edge-smoke-sector-${runId}`;
  const area = await createDocument(strapi, 'api::class-area.class-area', {
    country: 'United Kingdom',
    name: `Payment Edge Smoke Area ${runId}`,
    slug: areaSlug,
    state: 'active',
  });
  const sector = await createDocument(strapi, 'api::work-sector.work-sector', {
    name: `Payment Edge Smoke Sector ${runId}`,
    slug: sectorSlug,
    state: 'active',
  });
  const course = await createDocument(strapi, 'api::course.course', {
    name: `Payment Edge Smoke Course ${runId}`,
    sector: 'Smoke',
    sourceType: 'internal',
    courseState: 'active',
    version: runId,
  });
  const classRecord = await createDocument(
    strapi,
    'api::class.class',
    {
      capacity: 20,
      classArea: {
        connect: [{ documentId: area.documentId }],
      },
      course: {
        connect: [{ documentId: course.documentId }],
      },
      currency: 'GBP',
      discountedPricePence: 100,
      displayTitle: `Payment Edge Smoke Class ${runId}`,
      interviewsGuaranteed: 2,
      level: 'Entry',
      name: `Payment Edge Smoke Class ${runId}`,
      officialClassCode: `Smoke ${runId}`,
      pricePence: 100,
      region: area.name,
      sector: sector.name,
      slug: `payment-edge-smoke-class-${runId}`,
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

  for (let index = 0; index < candidateCount; index += 1) {
    const candidate = await createDocument(strapi, 'api::candidate.candidate', {
      accountOnboardingCompletedAt: new Date().toISOString(),
      accountRestrictionStatus: 'active',
      authIdentityId: `auth0|payment-edge-smoke-${runId}-${index}`,
      authProvider: 'auth0',
      candidateState: 'unenrolled',
      classAreaPreferences: preferenceSelection(areaSlug),
      email: `payment-edge-smoke-${runId}-${index}@example.test`,
      firstName: 'Payment',
      lastName: `Smoke ${index}`,
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

const findReservation = async (strapi, reservationDocumentId) => {
  const reservations = await documents(strapi, 'api::reservation.reservation').findMany({
    filters: {
      documentId: reservationDocumentId,
    },
    limit: 1,
    populate: ['candidate', 'class', 'enrollment'],
  });

  return reservations[0];
};

const findEnrollment = async (strapi, enrollmentDocumentId) => {
  const enrollments = await documents(strapi, 'api::enrollment.enrollment').findMany({
    filters: {
      documentId: enrollmentDocumentId,
    },
    limit: 1,
    populate: ['candidate', 'class'],
  });

  return enrollments[0];
};

const findPaymentByCheckoutSession = async (strapi, checkoutSessionId) => {
  const payments = await documents(strapi, 'api::payment.payment').findMany({
    filters: {
      providerCheckoutSessionId: checkoutSessionId,
    },
    limit: 1,
    populate: ['candidate', 'enrollment', 'reservation'],
  });

  return payments[0];
};

const findPaymentsForReservation = async (strapi, reservationDocumentId) =>
  documents(strapi, 'api::payment.payment').findMany({
    filters: {
      reservation: {
        documentId: reservationDocumentId,
      },
    },
    limit: 20,
    populate: ['candidate', 'enrollment', 'reservation'],
    sort: ['createdAt:asc'],
  });

const findWebhookEventsByProviderId = async (strapi, providerEventId) =>
  documents(strapi, 'api::payment-webhook-event.payment-webhook-event').findMany({
    filters: {
      providerEventId,
    },
    limit: 10,
    populate: ['payment'],
  });

const findAuditEvents = async (strapi, requestId, eventType) =>
  documents(strapi, 'api::audit-event.audit-event').findMany({
    filters: {
      eventType,
      requestId,
    },
    fields: ['documentId', 'eventType', 'requestId'],
    limit: 50,
  });

const reserveCandidate = async (strapi, classRecord, candidate, requestContext) => {
  const candidateService = strapi.service('api::candidate.candidate');
  const result = await candidateService.reserveCurrentCandidateClassPlace(
    authForCandidate(candidate),
    {
      classDocumentId: classRecord.documentId,
    },
    requestContext
  );

  assert(result?.reservation?.documentId, 'Expected reservation service to return a reservation document ID.');

  return findReservation(strapi, result.reservation.documentId);
};

const markTermsAccepted = async (strapi, reservation) =>
  documents(strapi, 'api::reservation.reservation').update({
    documentId: reservation.documentId,
    data: {
      termsAcceptedAt: new Date().toISOString(),
      termsVersion: process.env.CLASS_TERMS_VERSION || 'class-terms-v1',
    },
    populate: ['candidate', 'class', 'enrollment'],
  });

const createCheckoutPayment = async (strapi, reservation, checkoutSessionId) => {
  const checkoutUrl = `https://checkout.stripe.test/${checkoutSessionId}`;
  const payment = await documents(strapi, 'api::payment.payment').create({
    data: {
      amountPence: reservation.amountPence,
      candidate: {
        connect: [{ documentId: reservation.candidate.documentId }],
      },
      createdByService: 'payment-edge-smoke-script',
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
    source: 'payment-edge-smoke-script',
  },
  paymentProvider: 'stripe',
  paymentStatus,
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

const jsonResponse = (status, body) =>
  new Response(JSON.stringify(body), {
    headers: {
      'content-type': 'application/json',
    },
    status,
  });

const installPaymentServiceFetchMock = ({
  createCheckoutSession,
  lookupSessions = {},
}) => {
  const originalFetch = global.fetch;
  const previousBaseUrl = process.env.PAYMENT_SERVICE_URL;
  const previousToken = process.env.PAYMENT_SERVICE_TOKEN;

  process.env.PAYMENT_SERVICE_URL = 'https://payment-edge-smoke.test';
  process.env.PAYMENT_SERVICE_TOKEN = 'payment-edge-smoke-token';

  global.fetch = async (input, options = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const method = String(options.method || 'GET').toUpperCase();

    if (url.pathname === '/internal/checkout-sessions' && method === 'POST') {
      const body = JSON.parse(String(options.body || '{}'));
      const checkoutSessionId =
        typeof createCheckoutSession === 'function'
          ? createCheckoutSession(body)
          : `cs_payment_edge_retry_${Date.now()}`;

      return jsonResponse(201, {
        data: {
          checkoutSessionId,
          checkoutUrl: `https://checkout.stripe.test/${checkoutSessionId}`,
          paymentProvider: 'stripe',
          status: 'open',
        },
      });
    }

    const lookupMatch = url.pathname.match(/^\/internal\/checkout-sessions\/([^/]+)$/);

    if (lookupMatch && method === 'GET') {
      const checkoutSessionId = decodeURIComponent(lookupMatch[1]);
      const session = lookupSessions[checkoutSessionId];

      if (!session) {
        return jsonResponse(404, {
          error: {
            message: 'Checkout Session not found in smoke mock.',
          },
        });
      }

      return jsonResponse(200, {
        data: session,
      });
    }

    const expireMatch = url.pathname.match(/^\/internal\/checkout-sessions\/([^/]+)\/expire$/);

    if (expireMatch && method === 'POST') {
      const checkoutSessionId = decodeURIComponent(expireMatch[1]);
      const session = lookupSessions[checkoutSessionId];

      if (!session) {
        return jsonResponse(404, {
          error: {
            message: 'Checkout Session not found in smoke mock.',
          },
        });
      }

      return jsonResponse(200, {
        data: {
          ...session,
          paymentStatus: 'unpaid',
          status: 'expired',
        },
      });
    }

    return jsonResponse(404, {
      error: {
        message: 'Unhandled payment service smoke mock request.',
      },
    });
  };

  return () => {
    global.fetch = originalFetch;

    if (previousBaseUrl === undefined) {
      delete process.env.PAYMENT_SERVICE_URL;
    } else {
      process.env.PAYMENT_SERVICE_URL = previousBaseUrl;
    }

    if (previousToken === undefined) {
      delete process.env.PAYMENT_SERVICE_TOKEN;
    } else {
      process.env.PAYMENT_SERVICE_TOKEN = previousToken;
    }
  };
};

const main = async () => {
  loadEnvFile();

  process.env.CLASS_ALLOCATION_REDIS_ENABLED =
    process.env.CLASS_ALLOCATION_REDIS_ENABLED || 'true';

  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const requestIds = [];
  const providerEventIds = [];
  const passedScenarios = [];
  const appContext = await compileStrapi();
  const strapi = await createStrapi(appContext).load();
  const created = await setupSmokeData(strapi, runId);
  const candidateService = strapi.service('api::candidate.candidate');
  const webhookService = strapi.service('api::payment-webhook-event.payment-webhook-event');

  const context = (name) => {
    const requestId = `payment-edge-smoke-${runId}-${name}`;
    requestIds.push(requestId);

    return {
      requestId,
      serviceName: 'payment-edge-smoke-script',
    };
  };

  const eventId = (name) => {
    const providerEventId = `evt_payment_edge_${runId}_${name}`;
    providerEventIds.push(providerEventId);

    return providerEventId;
  };

  const runScenario = async (name, callback) => {
    await callback();
    passedScenarios.push(name);
    strapi.log.info(`Payment edge-case smoke scenario passed: ${name}`);
  };

  try {
    await runScenario('duplicate-success-webhook', async () => {
      const requestContext = context('duplicate-success-webhook');
      const reservation = await reserveCandidate(
        strapi,
        created.classRecord,
        created.candidates[0],
        requestContext
      );
      const checkoutSessionId = `cs_payment_edge_${runId}_success`;
      const providerEventId = eventId('success');

      await createCheckoutPayment(strapi, reservation, checkoutSessionId);

      const payload = stripeWebhookPayload({
        checkoutSession: normalizedCheckoutSession({ checkoutSessionId, reservation }),
        eventType: 'checkout.session.completed',
        providerEventId,
      });
      const firstResult = await webhookService.receiveStripeEvent(payload, requestContext);
      const duplicateResult = await webhookService.receiveStripeEvent(payload, requestContext);
      const refreshedReservation = await findReservation(strapi, reservation.documentId);
      const refreshedEnrollment = await findEnrollment(strapi, reservation.enrollment.documentId);
      const payment = await findPaymentByCheckoutSession(strapi, checkoutSessionId);
      const webhookEvents = await findWebhookEventsByProviderId(strapi, providerEventId);
      const audits = await findAuditEvents(
        strapi,
        requestContext.requestId,
        'candidate.payment_confirmed_by_webhook'
      );

      assert(firstResult.status === 'processed', 'Expected first success webhook to be processed.');
      assert(duplicateResult.duplicate === true, 'Expected second success webhook to be treated as duplicate.');
      assert(webhookEvents.length === 1, 'Expected exactly one webhook event row for duplicate delivery.');
      assert(webhookEvents[0].processingState === 'processed', 'Expected duplicate webhook row to remain processed.');
      assert(payment.paymentState === 'paid', 'Expected success payment to be paid.');
      assert(refreshedReservation.reservationState === 'paid', 'Expected success reservation to be paid.');
      assert(refreshedEnrollment.enrollmentState === 'enrolled', 'Expected success enrollment to be enrolled.');
      assert(refreshedEnrollment.paymentStatus === 'paid', 'Expected success enrollment payment status to be paid.');
      assert(audits.length === 1, 'Expected duplicate delivery to create one payment confirmation audit event.');
    });

    await runScenario('failed-payment-retry', async () => {
      const requestContext = context('failed-payment-retry');
      const reservation = await markTermsAccepted(
        strapi,
        await reserveCandidate(strapi, created.classRecord, created.candidates[1], requestContext)
      );
      const failedCheckoutSessionId = `cs_payment_edge_${runId}_failed`;
      const retryCheckoutSessionId = `cs_payment_edge_${runId}_retry`;

      await createCheckoutPayment(strapi, reservation, failedCheckoutSessionId);

      await webhookService.receiveStripeEvent(
        stripeWebhookPayload({
          checkoutSession: normalizedCheckoutSession({
            checkoutSessionId: failedCheckoutSessionId,
            paymentStatus: 'unpaid',
            reservation,
            status: 'complete',
          }),
          eventType: 'checkout.session.async_payment_failed',
          providerEventId: eventId('failed'),
        }),
        requestContext
      );

      const failedPayment = await findPaymentByCheckoutSession(strapi, failedCheckoutSessionId);
      const activeReservation = await findReservation(strapi, reservation.documentId);
      const activeEnrollment = await findEnrollment(strapi, reservation.enrollment.documentId);

      assert(failedPayment.paymentState === 'failed', 'Expected failed provider outcome to mark payment failed.');
      assert(activeReservation.reservationState === 'active', 'Expected failed active payment to keep reservation active.');
      assert(activeEnrollment.enrollmentState === 'place_reserved', 'Expected failed active payment to keep place reserved.');
      assert(
        objectValue(activeEnrollment.metadata).activeCheckoutSessionId == null,
        'Expected failed payment to clear active checkout metadata.'
      );

      const restoreFetch = installPaymentServiceFetchMock({
        createCheckoutSession: () => retryCheckoutSessionId,
      });

      try {
        const retryResult = await candidateService.getCurrentCandidateClassReservation(
          authForCandidate(created.candidates[1]),
          reservation.documentId,
          requestContext
        );

        assert(
          retryResult.paymentAction?.kind === 'stripe_checkout',
          'Expected failed active payment to allow a retry Checkout session.'
        );
        assert(
          retryResult.paymentAction.checkoutSessionId === retryCheckoutSessionId,
          'Expected retry payment action to use the smoke Checkout session.'
        );
      } finally {
        restoreFetch();
      }

      const retryPayment = await findPaymentByCheckoutSession(strapi, retryCheckoutSessionId);
      const reservationPayments = await findPaymentsForReservation(strapi, reservation.documentId);

      assert(retryPayment.paymentState === 'checkout_created', 'Expected retry Checkout payment to be created.');
      assert(reservationPayments.length === 2, 'Expected failed reservation to retain failed and retry payment records.');
    });

    await runScenario('expired-checkout-release', async () => {
      const requestContext = context('expired-checkout-release');
      const reservation = await reserveCandidate(strapi, created.classRecord, created.candidates[2], requestContext);
      const checkoutSessionId = `cs_payment_edge_${runId}_expired`;

      await createCheckoutPayment(strapi, reservation, checkoutSessionId);

      await webhookService.receiveStripeEvent(
        stripeWebhookPayload({
          checkoutSession: normalizedCheckoutSession({
            checkoutSessionId,
            paymentStatus: 'unpaid',
            reservation,
            status: 'expired',
          }),
          eventType: 'checkout.session.expired',
          providerEventId: eventId('expired'),
        }),
        requestContext
      );

      const expiredPayment = await findPaymentByCheckoutSession(strapi, checkoutSessionId);
      const expiredReservation = await findReservation(strapi, reservation.documentId);
      const expiredEnrollment = await findEnrollment(strapi, reservation.enrollment.documentId);

      assert(expiredPayment.paymentState === 'expired', 'Expected expired provider outcome to mark payment expired.');
      assert(expiredReservation.reservationState === 'expired', 'Expected expired provider outcome to expire reservation.');
      assert(
        expiredEnrollment.enrollmentState === 'enrollment_open',
        'Expected expired reservation without waiting list to return to enrollment_open.'
      );
      assert(expiredEnrollment.reservationExpiresAt == null, 'Expected expired reservation to clear enrollment expiry.');

      const retryReservation = await reserveCandidate(
        strapi,
        created.classRecord,
        created.candidates[2],
        requestContext
      );

      assert(
        retryReservation.reservationState === 'active',
        'Expected candidate to be able to reserve again after provider-confirmed expiry.'
      );
    });

    await runScenario('pending-reconciliation-skip', async () => {
      const requestContext = context('pending-reconciliation-skip');
      const reservation = await reserveCandidate(strapi, created.classRecord, created.candidates[3], requestContext);
      const checkoutSessionId = `cs_payment_edge_${runId}_pending`;
      const pendingSession = normalizedCheckoutSession({
        checkoutSessionId,
        paymentStatus: 'unpaid',
        reservation,
        status: 'open',
      });

      await createCheckoutPayment(strapi, reservation, checkoutSessionId);

      const restoreFetch = installPaymentServiceFetchMock({
        lookupSessions: {
          [checkoutSessionId]: pendingSession,
        },
      });

      try {
        await candidateService.reconcileProviderCheckoutPayments(200, requestContext);
      } finally {
        restoreFetch();
      }

      const payment = await findPaymentByCheckoutSession(strapi, checkoutSessionId);
      const activeReservation = await findReservation(strapi, reservation.documentId);

      assert(payment.paymentState === 'checkout_created', 'Expected pending/open provider session to remain checkout_created.');
      assert(activeReservation.reservationState === 'active', 'Expected pending/open provider session to keep reservation active.');
    });

    await runScenario('provider-query-reconciliation-success', async () => {
      const requestContext = context('provider-query-reconciliation-success');
      const reservation = await reserveCandidate(strapi, created.classRecord, created.candidates[4], requestContext);
      const checkoutSessionId = `cs_payment_edge_${runId}_reconcile`;
      const paidSession = normalizedCheckoutSession({
        checkoutSessionId,
        reservation,
      });

      await createCheckoutPayment(strapi, reservation, checkoutSessionId);

      const restoreFetch = installPaymentServiceFetchMock({
        lookupSessions: {
          [checkoutSessionId]: paidSession,
        },
      });

      try {
        await candidateService.reconcileProviderCheckoutPayments(200, requestContext);
      } finally {
        restoreFetch();
      }

      const payment = await findPaymentByCheckoutSession(strapi, checkoutSessionId);
      const paidReservation = await findReservation(strapi, reservation.documentId);
      const paidEnrollment = await findEnrollment(strapi, reservation.enrollment.documentId);
      const audits = await findAuditEvents(
        strapi,
        requestContext.requestId,
        'candidate.payment_confirmed_by_reconciliation'
      );

      assert(payment.paymentState === 'paid', 'Expected provider-query reconciliation to mark payment paid.');
      assert(paidReservation.reservationState === 'paid', 'Expected provider-query reconciliation to mark reservation paid.');
      assert(paidEnrollment.enrollmentState === 'enrolled', 'Expected provider-query reconciliation to enroll candidate.');
      assert(audits.length === 1, 'Expected provider-query reconciliation to write one confirmation audit event.');
    });

    await runScenario('failed-webhook-retry', async () => {
      const requestContext = context('failed-webhook-retry');
      const reservation = await reserveCandidate(strapi, created.classRecord, created.candidates[5], requestContext);
      const checkoutSessionId = `cs_payment_edge_${runId}_retry_webhook`;
      const providerEventId = eventId('retry_webhook');
      const payload = stripeWebhookPayload({
        checkoutSession: normalizedCheckoutSession({
          checkoutSessionId,
          reservation,
        }),
        eventType: 'checkout.session.async_payment_succeeded',
        providerEventId,
      });

      await createCheckoutPayment(strapi, reservation, checkoutSessionId);
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
          processingError: 'Simulated transient processing failure.',
          processingState: 'failed',
          providerEventId,
          receivedAt: new Date().toISOString(),
        },
      });

      await webhookService.retryFailedStripeEvents(200);

      const webhookEvents = await findWebhookEventsByProviderId(strapi, providerEventId);
      const payment = await findPaymentByCheckoutSession(strapi, checkoutSessionId);
      const paidReservation = await findReservation(strapi, reservation.documentId);

      assert(webhookEvents.length === 1, 'Expected retry to reuse the failed webhook event row.');
      assert(webhookEvents[0].processingState === 'processed', 'Expected failed webhook retry to process the event.');
      assert(payment.paymentState === 'paid', 'Expected failed webhook retry to mark payment paid.');
      assert(paidReservation.reservationState === 'paid', 'Expected failed webhook retry to mark reservation paid.');
    });

    await runScenario('paid-after-cancelled-reservation-exception', async () => {
      const requestContext = context('paid-after-cancelled-reservation-exception');
      const reservation = await reserveCandidate(strapi, created.classRecord, created.candidates[6], requestContext);
      const checkoutSessionId = `cs_payment_edge_${runId}_exception`;

      await createCheckoutPayment(strapi, reservation, checkoutSessionId);
      await documents(strapi, 'api::reservation.reservation').update({
        documentId: reservation.documentId,
        data: {
          cancelledAt: new Date().toISOString(),
          reservationState: 'cancelled',
        },
      });

      await webhookService.receiveStripeEvent(
        stripeWebhookPayload({
          checkoutSession: normalizedCheckoutSession({
            checkoutSessionId,
            reservation,
          }),
          eventType: 'checkout.session.completed',
          providerEventId: eventId('exception'),
        }),
        requestContext
      );

      const exceptionPayment = await findPaymentByCheckoutSession(strapi, checkoutSessionId);
      const exceptionReservation = await findReservation(strapi, reservation.documentId);
      const exceptionEnrollment = await findEnrollment(strapi, reservation.enrollment.documentId);
      const audits = await findAuditEvents(
        strapi,
        requestContext.requestId,
        'candidate.payment_reservation_state_conflict'
      );

      assert(exceptionPayment.paymentState === 'requires_review', 'Expected paid cancelled reservation to require review.');
      assert(
        exceptionReservation.reservationState === 'payment_exception',
        'Expected paid cancelled reservation to move to payment_exception.'
      );
      assert(
        exceptionEnrollment.enrollmentState === 'payment_exception',
        'Expected paid cancelled reservation enrollment to move to payment_exception.'
      );
      assert(
        exceptionEnrollment.paymentStatus === 'requires_review',
        'Expected paid cancelled reservation enrollment payment status to require review.'
      );
      assert(audits.length === 1, 'Expected payment exception to write one critical audit event.');
    });

    strapi.log.info(
      `Payment edge-case smoke passed: ${JSON.stringify({
        runId,
        scenarios: passedScenarios,
      })}`
    );
  } finally {
    if (process.env.PAYMENT_EDGE_CASE_SMOKE_KEEP_DATA !== 'true') {
      await cleanupClassAllocationRedisKeys(created.classRecord?.documentId);

      if (created.classRecord?.documentId) {
        const [webhookEvents, payments, reservations, enrollments, auditEvents] = await Promise.all([
          providerEventIds.length > 0
            ? documents(strapi, 'api::payment-webhook-event.payment-webhook-event').findMany({
                filters: {
                  providerEventId: {
                    $in: providerEventIds,
                  },
                },
                fields: ['documentId'],
                limit: 1000,
              })
            : [],
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
          requestIds.length > 0
            ? documents(strapi, 'api::audit-event.audit-event').findMany({
                filters: {
                  requestId: {
                    $in: requestIds,
                  },
                },
                fields: ['documentId'],
                limit: 1000,
              })
            : [],
        ]);

        await deleteDocuments(strapi, 'api::payment-webhook-event.payment-webhook-event', webhookEvents);
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

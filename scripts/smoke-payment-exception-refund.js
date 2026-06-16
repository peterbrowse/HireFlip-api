#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { compileStrapi, createStrapi } = require('@strapi/strapi');

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

const documents = (strapi, uid) => strapi.documents(uid);

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const deleteDocument = async (strapi, uid, documentId) => {
  if (!documentId) {
    return;
  }

  await documents(strapi, uid).delete({ documentId }).catch(() => undefined);
};

const findOneByDocumentId = async (strapi, uid, documentId, populate = []) => {
  const records = await documents(strapi, uid).findMany({
    filters: {
      documentId,
    },
    limit: 1,
    populate,
  });

  return records[0];
};

const findSupportCasesForRefund = (strapi, refundDocumentId) =>
  documents(strapi, 'api::support-case.support-case').findMany({
    filters: {
      refund: {
        documentId: refundDocumentId,
      },
    },
    limit: 20,
  });

const findSupportMessagesForRefund = (strapi, refundDocumentId) =>
  documents(strapi, 'api::support-message.support-message').findMany({
    filters: {
      refund: {
        documentId: refundDocumentId,
      },
    },
    limit: 20,
    sort: ['createdAt:asc'],
  });

const findAuditEventsForRequest = (strapi, requestId) =>
  documents(strapi, 'api::audit-event.audit-event').findMany({
    filters: {
      requestId,
    },
    limit: 20,
  });

const main = async () => {
  loadEnvFile();

  process.env.NOTIFICATION_SERVICE_URL = 'https://notification-smoke.example.test';
  process.env.NOTIFICATION_SERVICE_TOKEN = 'smoke-notification-token';

  const capturedNotifications = [];
  const originalFetch = global.fetch;

  global.fetch = async (url, options) => {
    capturedNotifications.push({
      body: JSON.parse(options.body),
      headers: options.headers,
      method: options.method,
      url: String(url),
    });

    return {
      json: async () => ({
        data: {
          jobId: 'payment-exception-smoke-job',
          queued: true,
          type: 'candidate_refund_accepted',
        },
      }),
      ok: true,
      status: 202,
    };
  };

  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const appContext = await compileStrapi();
  const strapi = await createStrapi(appContext).load();
  const originalService = strapi.service.bind(strapi);
  const session = {
    user: {
      displayName: 'Payment Exception Smoke Admin',
      email: 'payment-exception-admin@example.test',
      id: `payment-exception-admin-${runId}`,
      roleKeys: ['admin'],
      roles: ['Admin'],
    },
  };
  const created = {
    auditEvents: [],
    candidate: null,
    enrollment: null,
    payment: null,
    refund: null,
    reservation: null,
    supportCases: [],
    supportMessages: [],
  };
  let claimAsserted = false;

  strapi.service = (uid) => {
    if (uid === 'api::admin-auth.admin-auth') {
      return {
        getSession: async () => session,
      };
    }

    if (uid === 'api::admin-review-claim.admin-review-claim') {
      return {
        assertActiveClaimForSession: async (input, claimSession) => {
          claimAsserted = true;
          assert(input.claimToken === 'c'.repeat(32), 'Expected review claim token to be checked.');
          assert(claimSession.user.id === session.user.id, 'Expected claim check to use the active session.');
        },
        claimForSession: async () => ({
          reviewClaim: {
            claimToken: 'c'.repeat(32),
          },
        }),
      };
    }

    return originalService(uid);
  };

  try {
    const now = new Date().toISOString();
    const requestId = `payment-exception-refund-smoke-${runId}`;
    const message = 'Your capacity-conflict payment has been reviewed and a full refund has been approved.';
    const candidate = await documents(strapi, 'api::candidate.candidate').create({
      data: {
        accountOnboardingCompletedAt: now,
        accountRestrictionStatus: 'active',
        authIdentityId: `auth0|payment-exception-smoke-${runId}`,
        authProvider: 'auth0',
        candidateState: 'unenrolled',
        email: `payment-exception-smoke-${runId}@example.test`,
        firstName: 'Payment',
        lastName: 'Exception',
        marketingConsentState: 'opted_out',
        preferredCommunicationChannel: 'email',
      },
    });
    const enrollment = await documents(strapi, 'api::enrollment.enrollment').create({
      data: {
        candidate: {
          connect: [{ documentId: candidate.documentId }],
        },
        enrollmentState: 'payment_exception',
        paymentStatus: 'requires_review',
      },
      populate: ['candidate'],
    });
    const reservation = await documents(strapi, 'api::reservation.reservation').create({
      data: {
        amountPence: 32000,
        candidate: {
          connect: [{ documentId: candidate.documentId }],
        },
        currency: 'GBP',
        enrollment: {
          connect: [{ documentId: enrollment.documentId }],
        },
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        paidAt: now,
        reservationStartedAt: now,
        reservationState: 'payment_exception',
        source: 'candidate_dashboard',
      },
      populate: ['candidate', 'enrollment'],
    });
    const payment = await documents(strapi, 'api::payment.payment').create({
      data: {
        amountPence: 32000,
        candidate: {
          connect: [{ documentId: candidate.documentId }],
        },
        currency: 'GBP',
        enrollment: {
          connect: [{ documentId: enrollment.documentId }],
        },
        metadata: {
          exceptionReason: 'class_capacity_conflict',
        },
        paidAt: now,
        paymentProvider: 'stripe',
        paymentState: 'requires_review',
        paymentType: 'course_payment',
        providerCheckoutSessionId: `cs_payment_exception_smoke_${runId}`,
        providerPaymentIntentId: `pi_payment_exception_smoke_${runId}`,
        reservation: {
          connect: [{ documentId: reservation.documentId }],
        },
      },
      populate: ['candidate', 'enrollment', 'reservation'],
    });

    created.candidate = candidate;
    created.enrollment = enrollment;
    created.reservation = reservation;
    created.payment = payment;

    const taskKey = `payment:${payment.documentId}:requires_review`;
    const service = strapi.service('api::admin-refund.admin-refund');
    const result = await service.approvePaymentExceptionRefund(
      {
        message,
        reviewClaimToken: 'c'.repeat(32),
        sessionToken: 's'.repeat(32),
        taskKey,
      },
      {
        requestId,
        serviceName: 'payment-exception-refund-smoke',
      }
    );

    assert(claimAsserted, 'Expected payment exception approval to assert the active review claim.');
    assert(result.approved === true, 'Expected result to confirm approval.');
    assert(result.refund?.refundState === 'approved', 'Expected approved refund state.');
    assert(result.refund?.amountPence === 32000, 'Expected a full refund amount.');
    assert(result.refund?.refundPercentage === 100, 'Expected 100% refund percentage.');
    assert(capturedNotifications.length === 1, 'Expected one candidate notification.');
    assert(
      capturedNotifications[0].body.template.key === 'candidate_refund_accepted',
      'Expected refund acceptance template.'
    );

    const refunds = await documents(strapi, 'api::refund.refund').findMany({
      filters: {
        payment: {
          documentId: payment.documentId,
        },
      },
      limit: 5,
      populate: ['candidate', 'enrollment', 'payment'],
    });
    const refund = refunds[0];

    created.refund = refund;
    assert(refunds.length === 1, 'Expected exactly one refund for the payment exception.');
    assert(refund.eligibilitySource === 'payment_error', 'Expected payment-error eligibility source.');
    assert(refund.refundState === 'approved', 'Expected persisted refund to be approved.');
    assert(refund.reason === message, 'Expected refund reason to store the candidate message.');

    const [updatedPayment, updatedReservation, updatedEnrollment] = await Promise.all([
      findOneByDocumentId(strapi, 'api::payment.payment', payment.documentId),
      findOneByDocumentId(strapi, 'api::reservation.reservation', reservation.documentId),
      findOneByDocumentId(strapi, 'api::enrollment.enrollment', enrollment.documentId),
    ]);

    assert(updatedPayment.paymentState === 'paid', 'Expected payment to leave requires_review.');
    assert(
      updatedPayment.metadata?.paymentExceptionResolution === 'full_refund_approved',
      'Expected payment metadata to record payment exception resolution.'
    );
    assert(updatedReservation.reservationState === 'released', 'Expected reservation to be released.');
    assert(
      updatedEnrollment.enrollmentState === 'removed_full_refund',
      'Expected enrollment to move to removed_full_refund.'
    );
    assert(updatedEnrollment.paymentStatus === 'paid', 'Expected enrollment payment status to record paid provider state.');

    created.supportCases = await findSupportCasesForRefund(strapi, refund.documentId);
    created.supportMessages = await findSupportMessagesForRefund(strapi, refund.documentId);
    created.auditEvents = await findAuditEventsForRequest(strapi, requestId);

    assert(created.supportCases.length === 1, 'Expected a support case for the approved refund.');
    assert(created.supportMessages.length === 1, 'Expected a support message for the approved refund.');
    assert(
      created.supportMessages[0].messageType === 'refund_acceptance',
      'Expected refund acceptance support message.'
    );
    assert(created.auditEvents.length >= 1, 'Expected an audit event for the exception resolution.');
    assert(
      created.auditEvents.some((event) => event.eventType === 'admin.payment_exception_full_refund_approved'),
      'Expected payment exception approval audit event.'
    );

    const listResult = await service.listReviews(
      {
        sessionToken: 's'.repeat(32),
      },
      {
        requestId: `${requestId}:list`,
      }
    );

    assert(
      !listResult.reviews.some((review) => review.taskKey === taskKey),
      'Expected original payment exception review to be removed.'
    );
    assert(
      listResult.reviews.some((review) => review.taskKey === `refund:${refund.documentId}:approved`),
      'Expected approved refund review to remain for Super Admin execution.'
    );

    console.log('Payment exception refund smoke passed.');
  } finally {
    if (created.refund?.documentId) {
      created.supportMessages = await findSupportMessagesForRefund(strapi, created.refund.documentId);
      created.supportCases = await findSupportCasesForRefund(strapi, created.refund.documentId);
    }

    for (const message of created.supportMessages) {
      await deleteDocument(strapi, 'api::support-message.support-message', message.documentId);
    }

    for (const supportCase of created.supportCases) {
      await deleteDocument(strapi, 'api::support-case.support-case', supportCase.documentId);
    }

    for (const auditEvent of created.auditEvents) {
      await deleteDocument(strapi, 'api::audit-event.audit-event', auditEvent.documentId);
    }

    await deleteDocument(strapi, 'api::refund.refund', created.refund?.documentId);
    await deleteDocument(strapi, 'api::payment.payment', created.payment?.documentId);
    await deleteDocument(strapi, 'api::reservation.reservation', created.reservation?.documentId);
    await deleteDocument(strapi, 'api::enrollment.enrollment', created.enrollment?.documentId);
    await deleteDocument(strapi, 'api::candidate.candidate', created.candidate?.documentId);
    await strapi.destroy();
    global.fetch = originalFetch;
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

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

const { documents } = require('./lib/strapi-documents');

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

const deleteDocuments = async (strapi, uid, records) => {
  for (const record of records) {
    await deleteDocument(strapi, uid, record.documentId);
  }
};

const findByDocumentId = async (strapi, uid, documentId, populate = []) => {
  const records = await documents(strapi, uid).findMany({
    filters: {
      documentId,
    },
    limit: 1,
    populate,
  });

  return records[0];
};

const findSupportMessagesForRefund = (strapi, refundDocumentId) =>
  documents(strapi, 'api::support-message.support-message').findMany({
    filters: {
      refund: {
        documentId: refundDocumentId,
      },
    },
    fields: ['body', 'deliveryState', 'documentId', 'messageType', 'visibility'],
    sort: ['createdAt:asc'],
  });

const createPaymentAndRefund = async ({
  amountPence,
  candidate,
  paymentIntentId,
  providerRefundId,
  refundAmountPence,
  refundState = 'processing',
  strapi,
}) => {
  const payment = await documents(strapi, 'api::payment.payment').create({
    data: {
      amountPence,
      candidate: {
        connect: [{ documentId: candidate.documentId }],
      },
      currency: 'GBP',
      paidAt: new Date().toISOString(),
      paymentProvider: 'stripe',
      paymentState: 'paid',
      paymentType: 'course_payment',
      providerPaymentIntentId: paymentIntentId,
    },
    populate: ['candidate'],
  });
  const refund = await documents(strapi, 'api::refund.refund').create({
    data: {
      amountPence: refundAmountPence,
      candidate: {
        connect: [{ documentId: candidate.documentId }],
      },
      currency: 'GBP',
      payment: {
        connect: [{ documentId: payment.documentId }],
      },
      paymentProvider: 'stripe',
      providerRefundId,
      reason: 'Refund provider smoke.',
      refundPercentage: 50,
      refundState,
      requestedAt: new Date().toISOString(),
    },
    populate: ['candidate', 'payment'],
  });

  return {
    payment,
    refund,
  };
};

const providerRefundPayload = ({
  amountPence,
  metadata = {},
  paymentIntentId,
  providerRefundId,
  status,
}) => ({
  amountPence,
  createdAt: new Date().toISOString(),
  currency: 'GBP',
  failureReason: status === 'failed' ? 'lost_or_stolen_card' : null,
  metadata,
  paymentProvider: 'stripe',
  providerPaymentIntentId: paymentIntentId,
  providerRefundId,
  providerRefundStatus: status,
  reason: 'requested_by_customer',
});

const main = async () => {
  loadEnvFile();

  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const appContext = await compileStrapi();
  const strapi = await createStrapi(appContext).load();
  const created = {
    auditRequestIds: [],
    candidate: null,
    payments: [],
    refunds: [],
  };

  try {
    const adminRefundService = strapi.service('api::admin-refund.admin-refund');
    const candidate = await documents(strapi, 'api::candidate.candidate').create({
      data: {
        accountOnboardingCompletedAt: new Date().toISOString(),
        accountRestrictionStatus: 'active',
        authIdentityId: `auth0|refund-provider-smoke-${runId}`,
        authProvider: 'auth0',
        candidateState: 'enrolled',
        email: `refund-provider-smoke-${runId}@example.test`,
        firstName: 'Refund',
        lastName: 'Smoke',
        marketingConsentState: 'opted_out',
        preferredCommunicationChannel: 'email',
      },
    });

    created.candidate = candidate;

    const successPair = await createPaymentAndRefund({
      amountPence: 32000,
      candidate,
      paymentIntentId: `pi_refund_provider_success_${runId}`,
      providerRefundId: `re_refund_provider_success_${runId}`,
      refundAmountPence: 16000,
      strapi,
    });

    created.payments.push(successPair.payment);
    created.refunds.push(successPair.refund);
    created.auditRequestIds.push(`refund-provider-success-${runId}`);

    const successResult = await adminRefundService.recordProviderRefundUpdate(
      {
        eventType: 'refund.updated',
        providerEventId: `evt_refund_provider_success_${runId}`,
        providerRefund: providerRefundPayload({
          amountPence: 16000,
          metadata: {
            refundDocumentId: successPair.refund.documentId,
          },
          paymentIntentId: successPair.payment.providerPaymentIntentId,
          providerRefundId: successPair.refund.providerRefundId,
          status: 'succeeded',
        }),
      },
      {
        requestId: created.auditRequestIds.at(-1),
        serviceName: 'refund-provider-smoke',
      }
    );

    assert(successResult?.refund?.documentId === successPair.refund.documentId, 'Expected succeeded refund result.');

    const completedRefund = await findByDocumentId(
      strapi,
      'api::refund.refund',
      successPair.refund.documentId,
      ['payment']
    );
    const partiallyRefundedPayment = await findByDocumentId(
      strapi,
      'api::payment.payment',
      successPair.payment.documentId
    );
    const successMessages = await findSupportMessagesForRefund(strapi, successPair.refund.documentId);

    assert(completedRefund.refundState === 'completed', 'Expected provider success to complete the refund.');
    assert(completedRefund.processedAt, 'Expected provider success to set processedAt.');
    assert(
      partiallyRefundedPayment.paymentState === 'partially_refunded',
      'Expected provider success to partially refund the payment.'
    );
    assert(successMessages.length === 1, 'Expected provider success to add one support message.');
    assert(
      successMessages[0].visibility === 'public',
      'Expected provider success support message to be candidate-visible.'
    );

    await adminRefundService.recordProviderRefundUpdate(
      {
        eventType: 'refund.updated',
        providerEventId: `evt_refund_provider_success_duplicate_${runId}`,
        providerRefund: providerRefundPayload({
          amountPence: 16000,
          metadata: {
            refundDocumentId: successPair.refund.documentId,
          },
          paymentIntentId: successPair.payment.providerPaymentIntentId,
          providerRefundId: successPair.refund.providerRefundId,
          status: 'succeeded',
        }),
      },
      {
        requestId: `refund-provider-success-duplicate-${runId}`,
        serviceName: 'refund-provider-smoke',
      }
    );

    const duplicateMessages = await findSupportMessagesForRefund(strapi, successPair.refund.documentId);

    assert(
      duplicateMessages.length === 1,
      'Expected unchanged provider refund update not to duplicate support messages.'
    );

    const failedPair = await createPaymentAndRefund({
      amountPence: 32000,
      candidate,
      paymentIntentId: `pi_refund_provider_failed_${runId}`,
      providerRefundId: `re_refund_provider_failed_${runId}`,
      refundAmountPence: 16000,
      strapi,
    });

    created.payments.push(failedPair.payment);
    created.refunds.push(failedPair.refund);
    created.auditRequestIds.push(`refund-provider-failed-${runId}`);

    await adminRefundService.recordProviderRefundUpdate(
      {
        eventType: 'refund.failed',
        providerEventId: `evt_refund_provider_failed_${runId}`,
        providerRefund: providerRefundPayload({
          amountPence: 16000,
          metadata: {
            refundDocumentId: failedPair.refund.documentId,
          },
          paymentIntentId: failedPair.payment.providerPaymentIntentId,
          providerRefundId: failedPair.refund.providerRefundId,
          status: 'failed',
        }),
      },
      {
        requestId: created.auditRequestIds.at(-1),
        serviceName: 'refund-provider-smoke',
      }
    );

    const failedRefund = await findByDocumentId(strapi, 'api::refund.refund', failedPair.refund.documentId);
    const stillPaidPayment = await findByDocumentId(strapi, 'api::payment.payment', failedPair.payment.documentId);
    const failedMessages = await findSupportMessagesForRefund(strapi, failedPair.refund.documentId);

    assert(failedRefund.refundState === 'failed', 'Expected provider failure to mark refund failed.');
    assert(stillPaidPayment.paymentState === 'paid', 'Expected provider failure not to refund the payment.');
    assert(failedMessages.length === 1, 'Expected provider failure to add one support message.');
    assert(
      failedMessages[0].visibility === 'public',
      'Expected provider failure support message to use candidate-safe public copy.'
    );
    assert(
      failedMessages[0].body.includes('issue whilst processing your refund'),
      'Expected provider failure support message to avoid provider internals.'
    );

    created.auditRequestIds.push(`refund-provider-unmatched-${runId}`);

    const unmatchedResult = await adminRefundService.recordProviderRefundUpdate(
      {
        eventType: 'refund.updated',
        providerEventId: `evt_refund_provider_unmatched_${runId}`,
        providerRefund: providerRefundPayload({
          amountPence: 16000,
          paymentIntentId: `pi_refund_provider_unmatched_${runId}`,
          providerRefundId: `re_refund_provider_unmatched_${runId}`,
          status: 'succeeded',
        }),
      },
      {
        requestId: created.auditRequestIds.at(-1),
        serviceName: 'refund-provider-smoke',
      }
    );

    assert(unmatchedResult?.ignored === true, 'Expected unmatched provider refund to be ignored safely.');

    strapi.log.info(
      `Refund provider update smoke passed: ${JSON.stringify({
        runId,
      })}`
    );
  } finally {
    if (process.env.REFUND_PROVIDER_SMOKE_KEEP_DATA !== 'true') {
      const supportCaseIds = new Set();

      for (const refund of created.refunds) {
        const supportCases = await strapi
          .service('api::support-case.support-case')
          .casesForRefund(refund.documentId)
          .catch(() => []);

        for (const supportCase of supportCases) {
          supportCaseIds.add(supportCase.documentId);
        }

        const messages = await findSupportMessagesForRefund(strapi, refund.documentId).catch(() => []);

        await deleteDocuments(strapi, 'api::support-message.support-message', messages);
      }

      await deleteDocuments(
        strapi,
        'api::support-case.support-case',
        Array.from(supportCaseIds).map((documentId) => ({ documentId }))
      );

      if (created.auditRequestIds.length > 0) {
        const auditEvents = await documents(strapi, 'api::audit-event.audit-event').findMany({
          filters: {
            requestId: {
              $in: created.auditRequestIds,
            },
          },
          fields: ['documentId'],
        });

        await deleteDocuments(strapi, 'api::audit-event.audit-event', auditEvents);
      }

      await deleteDocuments(strapi, 'api::refund.refund', created.refunds);
      await deleteDocuments(strapi, 'api::payment.payment', created.payments);
      await deleteDocument(strapi, 'api::candidate.candidate', created.candidate?.documentId);
    }

    await strapi.destroy();
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

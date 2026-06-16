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

const main = async () => {
  loadEnvFile();

  const limit = Number.parseInt(process.env.PAYMENT_WEBHOOK_RETRY_LIMIT || '50', 10);
  const appContext = await compileStrapi();
  const strapi = await createStrapi(appContext).load();

  try {
    const webhookEventService = strapi.service('api::payment-webhook-event.payment-webhook-event');
    const candidateService = strapi.service('api::candidate.candidate');
    const adminRefundService = strapi.service('api::admin-refund.admin-refund');
    const webhookSummary = await webhookEventService.retryFailedStripeEvents(limit);
    const checkoutSummary = await candidateService.reconcileProviderCheckoutPayments(limit, {
      serviceName: 'payment-reconciliation',
    });
    const refundSummary = await adminRefundService.reconcileProviderRefunds(limit, {
      serviceName: 'refund-reconciliation',
    });

    strapi.log.info(`Retried failed Stripe payment webhook events: ${JSON.stringify(webhookSummary)}`);
    strapi.log.info(`Reconciled pending Stripe checkout payments: ${JSON.stringify(checkoutSummary)}`);
    strapi.log.info(`Reconciled pending Stripe refunds: ${JSON.stringify(refundSummary)}`);
  } finally {
    await strapi.destroy();
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

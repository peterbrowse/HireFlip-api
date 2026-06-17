#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { compileStrapi, createStrapi } = require('@strapi/strapi');

process.env.CLASS_WORKFLOW_BOOTSTRAP_ENABLED = 'false';

const resetTargets = [
  ['api::notification-event.notification-event', 'notification events'],
  ['api::payment-webhook-event.payment-webhook-event', 'payment webhook events'],
  ['api::refund.refund', 'refunds'],
  ['api::payment.payment', 'payments'],
  ['api::interview-feedback.interview-feedback', 'interview feedback records'],
  ['api::offer.offer', 'offers'],
  ['api::interview.interview', 'interviews'],
  ['api::interview-slot.interview-slot', 'interview slots'],
  ['api::candidate-interview-strike.candidate-interview-strike', 'candidate interview strikes'],
  ['api::assessment-appeal.assessment-appeal', 'assessment appeals'],
  ['api::course-answer-submission.course-answer-submission', 'course answer submissions'],
  ['api::course-test-attempt.course-test-attempt', 'course test attempts'],
  ['api::course-test-result.course-test-result', 'course test results'],
  ['api::course-module-result.course-module-result', 'course module results'],
  ['api::course-section-result.course-section-result', 'course section results'],
  ['api::course-result.course-result', 'course results'],
  ['api::course-progress.course-progress', 'course progress records'],
  ['api::waiting-list-offer.waiting-list-offer', 'waiting-list offers'],
  ['api::reservation.reservation', 'reservations'],
  ['api::enrollment.enrollment', 'enrollments'],
  ['api::class.class', 'classes'],
];

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

const assertLocalDatabase = () => {
  const databaseClient = process.env.DATABASE_CLIENT || 'sqlite';
  const allowNonLocalReset = process.env.ALLOW_NON_LOCAL_CLASS_RESET === 'true';

  if (databaseClient !== 'sqlite' && !allowNonLocalReset) {
    throw new Error(
      'Refusing to reset class data because DATABASE_CLIENT is not sqlite. Set ALLOW_NON_LOCAL_CLASS_RESET=true only when you intentionally want to reset a non-local database.'
    );
  }
};

const deleteAllDocuments = async (strapi, uid) => {
  let deletedCount = 0;
  const batchSize = 100;

  while (true) {
    const records = await strapi.documents(uid).findMany({
      fields: ['documentId'],
      limit: batchSize,
    });

    if (!records.length) {
      break;
    }

    for (const record of records) {
      await strapi.documents(uid).delete({
        documentId: record.documentId,
      });
      deletedCount += 1;
    }
  }

  return deletedCount;
};

const main = async () => {
  loadEnvFile();
  assertLocalDatabase();

  const appContext = await compileStrapi();
  const strapi = await createStrapi(appContext).load();

  try {
    const summary = {};

    for (const [uid, label] of resetTargets) {
      if (!strapi.contentTypes[uid]) {
        summary[label] = 'skipped';
        continue;
      }

      summary[label] = await deleteAllDocuments(strapi, uid);
    }

    strapi.log.info(`Reset HireFlip class workflow data: ${JSON.stringify(summary)}`);
  } finally {
    await strapi.destroy();
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

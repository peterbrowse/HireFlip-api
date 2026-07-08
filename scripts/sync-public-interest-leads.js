#!/usr/bin/env node

const { compileStrapi, createStrapi } = require('@strapi/strapi');

const integerEnv = (name, fallback) => {
  const value = Number.parseInt(process.env[name] || '', 10);

  return Number.isFinite(value) ? value : fallback;
};

const booleanEnv = (name, fallback = false) => {
  const value = String(process.env[name] || '').trim().toLowerCase();

  if (!value) {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(value);
};

const main = async () => {
  const appContext = await compileStrapi();
  const strapi = await createStrapi(appContext).load();

  try {
    const service = strapi.service('api::public-interest-lead.public-interest-lead');
    const result = await service.syncPendingLeads({
      documentId: process.env.PUBLIC_INTEREST_LEAD_SYNC_DOCUMENT_ID || undefined,
      includeFailed: booleanEnv('PUBLIC_INTEREST_LEAD_SYNC_INCLUDE_FAILED', false),
      limit: integerEnv('PUBLIC_INTEREST_LEAD_SYNC_BATCH_SIZE', 50),
    });

    console.log(JSON.stringify(result, null, 2));
  } finally {
    await strapi.destroy();
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

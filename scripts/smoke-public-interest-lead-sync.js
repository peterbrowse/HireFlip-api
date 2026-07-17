#!/usr/bin/env node

const assert = require('node:assert/strict');
const { compileStrapi, createStrapi } = require('@strapi/strapi');

const runId = `public-lead-sync-${Date.now()}`;
const email = `${runId}@example.test`;
const originalFetch = global.fetch;

process.env.PUBLIC_INTEREST_LEAD_SYNC_PROVIDER = 'smoke-webhook';
process.env.PUBLIC_INTEREST_LEAD_SYNC_URL = 'https://mailing-platform.example.test/leads';
process.env.PUBLIC_INTEREST_LEAD_SYNC_TOKEN = 'smoke-sync-token';
process.env.PUBLIC_INTEREST_LEAD_SYNC_LIST_ID = 'smoke-list';

let syncRequest;

global.fetch = async (input, init = {}) => {
  syncRequest = {
    body: JSON.parse(init.body),
    headers: init.headers,
    url: String(input),
  };

  return new Response(
    JSON.stringify({
      data: {
        id: 'smoke-contact-id',
        listId: 'smoke-list',
      },
    }),
    {
      headers: {
        'content-type': 'application/json',
      },
      status: 200,
    }
  );
};

const main = async () => {
  const appContext = await compileStrapi();
  const strapi = await createStrapi(appContext).load();
  const documents = strapi.documents('api::public-interest-lead.public-interest-lead');
  let lead;

  try {
    lead = await documents.create({
      data: {
        consentCapturedAt: new Date().toISOString(),
        consentState: 'marketing_opted_in',
        consentWordingVersion: 'smoke-v1',
        email,
        enquiryLawfulBasis: 'legitimate_interests',
        leadType: 'candidate_interest',
        marketingChannels: {
          email: true,
        },
        marketingLawfulBasis: 'consent',
        metadata: {
          smokeRunId: runId,
        },
        privacyNoticeVersion: 'smoke-privacy-v1',
        sourceForm: 'smoke',
        suppressionStatus: 'not_suppressed',
        syncStatus: 'pending',
      },
    });

    const result = await strapi
      .service('api::public-interest-lead.public-interest-lead')
      .syncPendingLeads({
        documentId: lead.documentId,
      });

    assert.equal(result.configured, true);
    assert.equal(result.synced, 1);
    assert.equal(result.failed, 0);
    assert.equal(syncRequest.url, process.env.PUBLIC_INTEREST_LEAD_SYNC_URL);
    assert.equal(syncRequest.headers.authorization, 'Bearer smoke-sync-token');
    assert.equal(syncRequest.body.email, email);
    assert.equal(syncRequest.body.listId, 'smoke-list');

    const [updatedLead] = await documents.findMany({
      filters: {
        documentId: lead.documentId,
      },
      limit: 1,
    });

    assert.equal(updatedLead.syncStatus, 'synced');
    assert.equal(updatedLead.mailingPlatformProvider, 'smoke-webhook');
    assert.equal(updatedLead.mailingPlatformContactId, 'smoke-contact-id');
    assert.equal(updatedLead.mailingPlatformListId, 'smoke-list');

    console.log('Public interest lead sync smoke passed.');
  } finally {
    if (lead?.documentId) {
      await documents.delete({ documentId: lead.documentId }).catch(() => undefined);
    }

    await strapi.destroy();
    global.fetch = originalFetch;
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

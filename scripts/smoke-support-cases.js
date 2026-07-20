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

const findMessagesForCase = (strapi, supportCaseDocumentId) =>
  documents(strapi, 'api::support-message.support-message').findMany({
    filters: {
      supportCase: {
        documentId: supportCaseDocumentId,
      },
    },
    sort: ['createdAt:asc'],
  });

const main = async () => {
  loadEnvFile();

  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const appContext = await compileStrapi();
  const strapi = await createStrapi(appContext).load();
  const originalService = strapi.service.bind(strapi);
  const session = {
    user: {
      displayName: 'Support Smoke Admin',
      email: 'support-smoke-admin@example.test',
      id: `support-smoke-admin-${runId}`,
      roleKeys: ['admin'],
      roles: ['Admin'],
    },
  };
  const created = {
    candidate: null,
    refund: null,
    supportCase: null,
    messages: [],
  };

  strapi.service = (uid) => {
    if (uid === 'api::admin-auth.admin-auth') {
      return {
        getSession: async () => session,
      };
    }

    if (uid === 'api::admin-review-claim.admin-review-claim') {
      return {
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
    const supportCaseService = strapi.service('api::support-case.support-case');
    const candidate = await documents(strapi, 'api::candidate.candidate').create({
      data: {
        accountOnboardingCompletedAt: new Date().toISOString(),
        accountRestrictionStatus: 'active',
        authIdentityId: `auth0|support-case-smoke-${runId}`,
        authProvider: 'auth0',
        candidateState: 'unenrolled',
        email: `support-case-smoke-${runId}@example.test`,
        firstName: 'Support',
        lastName: 'Smoke',
        marketingConsentState: 'opted_out',
        preferredCommunicationChannel: 'email',
      },
    });
    const refund = await documents(strapi, 'api::refund.refund').create({
      data: {
        amountPence: 5000,
        candidate: {
          connect: [{ documentId: candidate.documentId }],
        },
        currency: 'GBP',
        paymentProvider: 'stripe',
        reason: 'Support case smoke refund request.',
        refundPercentage: 50,
        refundState: 'requested',
        requestedAt: new Date().toISOString(),
      },
      populate: ['candidate'],
    });

    created.candidate = candidate;
    created.refund = refund;

    const ensured = await supportCaseService.ensureRefundCase({
      assignedTo: {
        displayName: 'Support Owner',
        email: 'support.owner@example.test',
        id: `support-owner-${runId}`,
        roleKey: 'support',
      },
      candidate,
      createdBy: {
        displayName: 'Smoke Admin',
        email: 'smoke.admin@example.test',
        id: `smoke-admin-${runId}`,
        type: 'admin',
      },
      priority: 'high',
      refund,
      source: 'admin_dashboard',
      state: 'awaiting_candidate',
      summary: 'Smoke support case for refund refusal.',
    });

    created.supportCase = ensured.supportCase;

    assert(ensured.created === true, 'Expected support case to be created.');
    assert(ensured.supportCase?.documentId, 'Expected support case document ID.');
    assert(
      ensured.supportCase.ownerStaffUserId === `support-owner-${runId}`,
      'Expected support case owner to be assigned.'
    );

    const publicMessage = await supportCaseService.addMessage({
      body: 'We need more evidence before approving this refund.',
      candidate,
      deliveryState: 'queued',
      direction: 'outbound',
      messageType: 'refund_refusal',
      refund,
      sender: {
        displayName: 'Smoke Admin',
        email: 'smoke.admin@example.test',
        id: `smoke-admin-${runId}`,
        type: 'admin',
      },
      subject: 'Refund review update',
      supportCase: ensured.supportCase,
      visibility: 'public',
    });
    const internalMessage = await supportCaseService.addMessage({
      body: 'Candidate may appeal with interview availability evidence.',
      candidate,
      direction: 'internal',
      messageType: 'staff_note',
      refund,
      sender: {
        displayName: 'Smoke Admin',
        email: 'smoke.admin@example.test',
        id: `smoke-admin-${runId}`,
        type: 'admin',
      },
      supportCase: ensured.supportCase,
      visibility: 'internal',
    });

    created.messages.push(publicMessage, internalMessage);

    const assignedCase = await supportCaseService.assignCase({
      assignedTo: {
        displayName: 'Escalated Support Owner',
        email: 'support.escalated@example.test',
        id: `support-escalated-${runId}`,
        roleKey: 'admin',
      },
      supportCase: ensured.supportCase,
    });

    assert(
      assignedCase.ownerStaffUserId === `support-escalated-${runId}`,
      'Expected support case assignment to update.'
    );

    const listedResult = await supportCaseService.listCases({
      caseType: 'refund',
      search: ensured.supportCase.documentId,
    });
    const listedCases = Array.isArray(listedResult) ? listedResult : listedResult.cases || [];
    const listedCase = listedCases.find((supportCase) => supportCase.documentId === ensured.supportCase.documentId);

    assert(listedCase, 'Expected support case to be returned by listCases.');
    assert(listedCase.owner?.id === `support-escalated-${runId}`, 'Expected listed case owner to match assignment.');
    assert(listedCase.messages.length === 2, 'Expected listed case to include support messages.');

    const detailedCase = await supportCaseService.getCase({
      supportCaseDocumentId: ensured.supportCase.documentId,
    });

    assert(detailedCase, 'Expected support case detail to be returned.');
    assert(detailedCase.messages.length === 2, 'Expected support case detail to include messages.');

    const adminCase = await strapi.service('api::admin-support.admin-support').getCase({
      sessionToken: 's'.repeat(32),
      supportCaseDocumentId: ensured.supportCase.documentId,
    });
    assert(adminCase.relatedRecord?.type === 'refund', 'Expected refund related-record type.');
    assert(
      adminCase.relatedRecord?.documentId === refund.documentId,
      'Expected related refund document ID.'
    );
    assert(
      adminCase.relatedRecord?.path === `/refunds/${encodeURIComponent(refund.documentId)}`,
      'Expected support case to link to the canonical refund review.'
    );

    const candidateCase = await supportCaseService.getCaseForCandidate({
      candidateDocumentId: candidate.documentId,
      supportCaseDocumentId: ensured.supportCase.documentId,
    });

    assert(candidateCase, 'Expected candidate support case detail to be returned.');
    assert(candidateCase.messages.length === 1, 'Expected candidate support case detail to hide internal messages.');
    assert(!candidateCase.owner, 'Expected candidate support case detail to hide owner metadata.');

    const candidateCases = await supportCaseService.casesForCandidate(candidate.documentId);
    const listedCandidateCase = candidateCases.find(
      (supportCase) => supportCase.documentId === ensured.supportCase.documentId
    );

    assert(listedCandidateCase, 'Expected candidate support case list to include the case.');
    assert(listedCandidateCase.messages.length === 1, 'Expected candidate support case list to hide internal messages.');

    const messages = await findMessagesForCase(strapi, ensured.supportCase.documentId);

    assert(messages.length === 2, 'Expected two persisted support messages.');

    console.log('Support case smoke passed.');
  } finally {
    if (created.supportCase?.documentId) {
      const messages = await findMessagesForCase(strapi, created.supportCase.documentId);

      for (const message of messages) {
        await deleteDocument(strapi, 'api::support-message.support-message', message.documentId);
      }
    }

    await deleteDocument(strapi, 'api::support-case.support-case', created.supportCase?.documentId);
    await deleteDocument(strapi, 'api::refund.refund', created.refund?.documentId);
    await deleteDocument(strapi, 'api::candidate.candidate', created.candidate?.documentId);
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

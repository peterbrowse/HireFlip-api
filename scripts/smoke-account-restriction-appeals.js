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

  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);

    if (match && !Object.prototype.hasOwnProperty.call(process.env, match[1])) {
      process.env[match[1]] = stripQuotes(match[2]);
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
  if (documentId) {
    await documents(strapi, uid).delete({ documentId }).catch(() => undefined);
  }
};

const findOne = async (strapi, uid, documentId, populate = []) => {
  const records = await documents(strapi, uid).findMany({
    filters: { documentId },
    limit: 1,
    populate,
  });

  return records[0] || null;
};

const findMessages = (strapi, supportCaseDocumentId) =>
  documents(strapi, 'api::support-message.support-message').findMany({
    filters: {
      supportCase: { documentId: supportCaseDocumentId },
    },
    sort: ['createdAt:asc'],
  });

const expectFailure = async (action, messageIncludes, failureMessage) => {
  try {
    await action();
  } catch (error) {
    assert(
      String(error?.message || error).includes(messageIncludes),
      `${failureMessage} Received: ${String(error?.message || error)}`
    );
    return;
  }

  throw new Error(failureMessage);
};

const main = async () => {
  loadEnvFile();
  process.env.NOTIFICATION_SERVICE_URL = 'https://notification-account-appeal-smoke.example.test';
  process.env.NOTIFICATION_SERVICE_TOKEN = 'account-appeal-smoke-token';

  const originalFetch = global.fetch;
  let notificationRequestCount = 0;

  global.fetch = async () => {
    notificationRequestCount += 1;

    return {
      json: async () => ({
        data: {
          jobId: `account-appeal-notification-${notificationRequestCount}`,
          queued: true,
        },
      }),
      ok: true,
      status: 202,
    };
  };

  const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const authIdentityId = `auth0|account-appeal-smoke-${runId}`;
  const auth = { subject: authIdentityId, type: 'auth0' };
  const sessionToken = 's'.repeat(32);
  const reviewClaimToken = 'c'.repeat(32);
  const appContext = await compileStrapi();
  const strapi = await createStrapi(appContext).load();
  const originalService = strapi.service.bind(strapi);
  const auditEvents = [];
  let activeSession = {
    user: {
      displayName: 'Account Appeal Smoke Admin',
      email: 'account-appeal-admin@example.test',
      id: `account-appeal-admin-${runId}`,
      roleKeys: ['admin'],
      roles: ['Admin'],
    },
  };
  let claimAssertCount = 0;
  const created = {
    candidate: null,
    supportCase: null,
  };

  strapi.service = (uid) => {
    if (uid === 'api::admin-auth.admin-auth') {
      return {
        getSession: async () => activeSession,
      };
    }

    if (uid === 'api::admin-review-claim.admin-review-claim') {
      return {
        assertActiveClaimForSession: async (input, session) => {
          claimAssertCount += 1;
          assert(input.claimToken === reviewClaimToken, 'Active review claim token is required.');
          assert(input.resourceType === 'support_case', 'Expected support case review claim type.');
          assert(session.user.id === activeSession.user.id, 'Expected active admin session for claim.');
        },
        claimForSession: async (input) => ({
          reviewClaim: {
            canTakeOver: false,
            claimToken: reviewClaimToken,
            claimedAt: new Date().toISOString(),
            claimedBy: {
              displayName: activeSession.user.displayName,
              email: activeSession.user.email,
              id: activeSession.user.id,
              roleKeys: activeSession.user.roleKeys,
            },
            expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
            heartbeatAt: null,
            isActive: true,
            isOwnedByCurrentUser: true,
            resourceDocumentId: input.resourceDocumentId,
            resourceKey: input.resourceKey,
            resourceLabel: input.resourceLabel,
            resourceType: input.resourceType,
          },
        }),
      };
    }

    if (uid === 'api::audit-event.audit-event') {
      return {
        record: async (input) => {
          auditEvents.push(input);
          return { documentId: `account-appeal-audit-${auditEvents.length}` };
        },
      };
    }

    return originalService(uid);
  };

  try {
    const candidate = await documents(strapi, 'api::candidate.candidate').create({
      data: {
        accountOnboardingCompletedAt: new Date().toISOString(),
        accountRestrictionAppealStatus: 'not_started',
        accountRestrictedAt: new Date().toISOString(),
        accountRestrictedBy: 'security@example.test',
        accountRestrictionMessage: 'Account activity requires a security review.',
        accountRestrictionReason: 'suspend',
        accountRestrictionStatus: 'suspended',
        authIdentityId,
        authProvider: 'auth0',
        candidateState: 'suspended',
        email: `account-appeal-smoke-${runId}@example.test`,
        firstName: 'Account Appeal',
        lastName: 'Smoke',
        marketingConsentState: 'opted_out',
        preferredCommunicationChannel: 'email',
      },
    });
    created.candidate = candidate;

    const candidateService = strapi.service('api::candidate.candidate');
    const adminSupportService = strapi.service('api::admin-support.admin-support');
    const appealResult = await candidateService.appealCurrentCandidateAccountRestriction(
      auth,
      {
        reason: 'The account activity was not mine. I have secured the account and can provide evidence.',
      },
      { requestId: `account-appeal-submit-${runId}` }
    );
    const supportCaseDocumentId = appealResult.supportCase?.documentId;
    assert(supportCaseDocumentId, 'Expected account appeal support case document ID.');
    created.supportCase = { documentId: supportCaseDocumentId };

    let refreshedCandidate = await findOne(
      strapi,
      'api::candidate.candidate',
      candidate.documentId
    );
    assert(
      refreshedCandidate.accountRestrictionAppealStatus === 'submitted',
      'Expected candidate appeal status to be submitted.'
    );

    const detailResult = await adminSupportService.getCase({
      sessionToken,
      supportCaseDocumentId,
    });
    assert(detailResult.accountRestrictionAppeal, 'Expected account appeal detail payload.');
    assert(
      detailResult.accountRestrictionAppeal.status === 'submitted',
      'Expected submitted appeal in admin detail.'
    );
    assert(
      detailResult.relatedRecord?.type === 'candidate_account',
      'Expected candidate account related-record link.'
    );

    activeSession = {
      user: {
        displayName: 'Account Appeal Smoke Support',
        email: 'account-appeal-support@example.test',
        id: `account-appeal-support-${runId}`,
        roleKeys: ['support'],
        roles: ['Support'],
      },
    };
    await expectFailure(
      () =>
        adminSupportService.decideAccountRestrictionAppeal({
          decision: 'start_review',
          reviewClaimToken,
          sessionToken,
          supportCaseDocumentId,
        }),
      'Admin or Super Admin access is required',
      'Expected Support role to be denied formal appeal decisions.'
    );

    activeSession = {
      user: {
        displayName: 'Account Appeal Smoke Admin',
        email: 'account-appeal-admin@example.test',
        id: `account-appeal-admin-${runId}`,
        roleKeys: ['admin'],
        roles: ['Admin'],
      },
    };
    await expectFailure(
      () =>
        adminSupportService.decideAccountRestrictionAppeal({
          decision: 'start_review',
          sessionToken,
          supportCaseDocumentId,
        }),
      'Active review claim token is required',
      'Expected a missing review claim to prevent an appeal decision.'
    );

    const reviewResult = await adminSupportService.decideAccountRestrictionAppeal(
      {
        decision: 'start_review',
        reviewClaimToken,
        sessionToken,
        supportCaseDocumentId,
      },
      { requestId: `account-appeal-review-${runId}` }
    );
    assert(reviewResult.updated === true, 'Expected start-review action to succeed.');
    refreshedCandidate = await findOne(
      strapi,
      'api::candidate.candidate',
      candidate.documentId
    );
    let refreshedCase = await findOne(
      strapi,
      'api::support-case.support-case',
      supportCaseDocumentId,
      ['candidate']
    );
    assert(
      refreshedCandidate.accountRestrictionAppealStatus === 'under_review',
      'Expected candidate appeal to move under review.'
    );
    assert(refreshedCase.caseState === 'in_progress', 'Expected appeal case to be in progress.');

    const rejectionCandidateMessage =
      'We could not uphold the appeal because the supplied evidence did not explain the recorded account activity.';
    const rejectionInternalReason =
      'Security event timestamps still match the candidate session and no contradictory evidence was supplied.';
    await adminSupportService.decideAccountRestrictionAppeal(
      {
        candidateMessage: rejectionCandidateMessage,
        decision: 'reject',
        reasonNote: rejectionInternalReason,
        reviewClaimToken,
        sessionToken,
        supportCaseDocumentId,
      },
      { requestId: `account-appeal-reject-${runId}` }
    );
    refreshedCandidate = await findOne(
      strapi,
      'api::candidate.candidate',
      candidate.documentId
    );
    refreshedCase = await findOne(
      strapi,
      'api::support-case.support-case',
      supportCaseDocumentId,
      ['candidate']
    );
    assert(
      refreshedCandidate.accountRestrictionAppealStatus === 'rejected',
      'Expected candidate appeal status to be rejected.'
    );
    assert(
      refreshedCandidate.accountRestrictionStatus === 'suspended',
      'Expected rejection to preserve the account restriction.'
    );
    assert(refreshedCase.caseState === 'resolved', 'Expected rejected appeal case to resolve.');

    const candidateCaseAfterRejection = await candidateService.getCurrentCandidateSupportCase(
      auth,
      supportCaseDocumentId
    );
    assert(
      candidateCaseAfterRejection.supportCase.messages.some(
        (item) => item.body === rejectionCandidateMessage
      ),
      'Expected candidate to see the rejection message.'
    );
    assert(
      !candidateCaseAfterRejection.supportCase.messages.some(
        (item) => item.body.includes(rejectionInternalReason)
      ),
      'Expected internal decision reason to stay out of the candidate conversation.'
    );

    await candidateService.replyToCurrentCandidateSupportCase(
      auth,
      supportCaseDocumentId,
      {
        body: 'I have additional email-provider evidence showing when I recovered the account. Please reconsider.',
      },
      { requestId: `account-appeal-candidate-reply-${runId}` }
    );
    refreshedCandidate = await findOne(
      strapi,
      'api::candidate.candidate',
      candidate.documentId
    );
    refreshedCase = await findOne(
      strapi,
      'api::support-case.support-case',
      supportCaseDocumentId,
      ['candidate']
    );
    assert(
      refreshedCandidate.accountRestrictionAppealStatus === 'under_review',
      'Expected candidate response to reopen the appeal for review.'
    );
    assert(
      refreshedCase.caseState === 'awaiting_staff',
      'Expected candidate response to return the case to staff.'
    );

    await documents(strapi, 'api::candidate.candidate').update({
      documentId: candidate.documentId,
      data: { authIdentityId: null },
    });

    const upheldCandidateMessage =
      'We have upheld your appeal and restored access to your HireFlip account.';
    await adminSupportService.decideAccountRestrictionAppeal(
      {
        candidateMessage: upheldCandidateMessage,
        decision: 'uphold',
        reasonNote: 'New email-provider evidence confirms the suspicious activity occurred before account recovery.',
        reviewClaimToken,
        sessionToken,
        supportCaseDocumentId,
      },
      { requestId: `account-appeal-uphold-${runId}` }
    );
    refreshedCandidate = await findOne(
      strapi,
      'api::candidate.candidate',
      candidate.documentId
    );
    refreshedCase = await findOne(
      strapi,
      'api::support-case.support-case',
      supportCaseDocumentId,
      ['candidate']
    );
    assert(
      refreshedCandidate.accountRestrictionStatus === 'active',
      'Expected upheld appeal to reactivate the account.'
    );
    assert(
      refreshedCandidate.accountRestrictionAppealStatus === 'not_applicable',
      'Expected upheld appeal to clear the restriction appeal state.'
    );
    assert(
      refreshedCandidate.candidateState === 'account_created',
      'Expected upheld appeal to return the candidate to a normal account state.'
    );
    assert(refreshedCase.caseState === 'resolved', 'Expected upheld appeal case to resolve.');

    const publicCase = await originalService('api::support-case.support-case').getCaseForCandidate({
      candidateDocumentId: candidate.documentId,
      supportCaseDocumentId,
    });
    assert(publicCase.messages.length === 5, 'Expected the complete five-message appeal conversation.');
    assert(
      publicCase.messages.at(-1)?.body === upheldCandidateMessage,
      'Expected the upheld decision at the end of the candidate conversation.'
    );
    assert(claimAssertCount === 4, 'Expected every attempted admin transition to check the review claim.');
    assert(
      auditEvents.some(
        (event) => event.eventType === 'admin.candidate_account_restriction_appeal_review_started'
      ),
      'Expected review-start audit event.'
    );
    assert(
      auditEvents.some(
        (event) => event.eventType === 'admin.candidate_account_restriction_appeal_rejected'
      ),
      'Expected rejection audit event.'
    );
    assert(
      auditEvents.some(
        (event) => event.eventType === 'admin.candidate_account_restriction_appeal_upheld'
      ),
      'Expected uphold audit event.'
    );
    assert(
      auditEvents.some((event) => event.eventType === 'candidate.support_case_replied'),
      'Expected candidate reply audit event.'
    );

    console.log('Account restriction appeal workflow smoke passed.');
  } finally {
    strapi.service = originalService;
    global.fetch = originalFetch;

    if (created.supportCase?.documentId) {
      const messages = await findMessages(strapi, created.supportCase.documentId);

      for (const message of messages) {
        await deleteDocument(strapi, 'api::support-message.support-message', message.documentId);
      }
    }

    if (created.candidate?.documentId) {
      const notificationEvents = await documents(
        strapi,
        'api::notification-event.notification-event'
      ).findMany({
        filters: {
          candidate: { documentId: created.candidate.documentId },
        },
      });

      for (const event of notificationEvents) {
        await deleteDocument(strapi, 'api::notification-event.notification-event', event.documentId);
      }
    }

    await deleteDocument(
      strapi,
      'api::support-case.support-case',
      created.supportCase?.documentId
    );
    await deleteDocument(strapi, 'api::candidate.candidate', created.candidate?.documentId);
    await strapi.destroy();
  }
};

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

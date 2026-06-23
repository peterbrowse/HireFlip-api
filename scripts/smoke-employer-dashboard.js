#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomBytes } = require('node:crypto');
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

const connect = (record) => ({
  connect: [{ documentId: record.documentId }],
});

const deleteDocument = async (strapi, uid, documentId) => {
  if (!documentId) {
    return;
  }

  await documents(strapi, uid).delete({ documentId }).catch(() => undefined);
};

const deleteNotificationEventsForEmail = async (strapi, email) => {
  if (!email) {
    return;
  }

  const events = await documents(strapi, 'api::notification-event.notification-event')
    .findMany({
      filters: {
        recipientEmail: email,
      },
      limit: 50,
    })
    .catch(() => []);

  for (const event of events) {
    await deleteDocument(strapi, 'api::notification-event.notification-event', event.documentId);
	  }
	};

const deleteAuditEventsForSubject = async (strapi, subjectId) => {
  if (!subjectId) {
    return;
  }

  const events = await documents(strapi, 'api::audit-event.audit-event')
    .findMany({
      filters: {
        subjectId,
      },
      limit: 50,
    })
    .catch(() => []);

  for (const event of events) {
    await deleteDocument(strapi, 'api::audit-event.audit-event', event.documentId);
  }
};

const deleteEmployerRegionCommitments = async (strapi, employerDocumentId) => {
  if (!employerDocumentId) {
    return;
  }

  const commitments = await documents(
    strapi,
    'api::employer-region-commitment.employer-region-commitment'
  )
    .findMany({
      filters: {
        employer: {
          documentId: employerDocumentId,
        },
      },
      limit: 100,
    })
    .catch(() => []);

  for (const commitment of commitments) {
    await deleteDocument(
      strapi,
      'api::employer-region-commitment.employer-region-commitment',
      commitment.documentId
    );
  }
};

const deleteCapacityChangeRequestsForEmployer = async (strapi, employerDocumentId) => {
  if (!employerDocumentId) {
    return;
  }

  const requests = await documents(
    strapi,
    'api::employer-capacity-change-request.employer-capacity-change-request'
  )
    .findMany({
      filters: {
        employer: {
          documentId: employerDocumentId,
        },
      },
      limit: 100,
    })
    .catch(() => []);

  for (const request of requests) {
    await deleteDocument(
      strapi,
      'api::employer-capacity-change-request.employer-capacity-change-request',
      request.documentId
    );
  }
};

const addDays = (days, hour = 10) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  date.setUTCHours(hour, 0, 0, 0);
  return date.toISOString();
};

const addWorkingDays = (days, hour = 10) => {
  const date = new Date();
  let remaining = days;

  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1);

    if (![0, 6].includes(date.getUTCDay())) {
      remaining -= 1;
    }
  }

  date.setUTCHours(hour, 0, 0, 0);
  return date.toISOString();
};

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: {
      'content-type': 'application/json',
    },
    status,
  });

const createSmokeFetch = ({ authDomain, connectionId, connectionName, notificationUrl, runId }) => {
  const usersByEmail = new Map();
  const usersById = new Map();
  const notifications = [];
  const blockedUsers = new Set();
  const passwordTicketRequests = [];
  const tokenPayload = Buffer.from(
    JSON.stringify({
      scope: 'create:users read:users update:users create:user_tickets read:connections',
    })
  ).toString('base64url');
  const managementToken = `header.${tokenPayload}.signature`;

  const fetch = async (input, init = {}) => {
    const url = new URL(String(input));

    if (url.origin === notificationUrl) {
      const body = JSON.parse(String(init.body || '{}'));
      notifications.push(body);

      return jsonResponse(
        {
          data: {
            jobId: `notification-job-${notifications.length}`,
            queued: true,
            type: body.type,
          },
        },
        202
      );
    }

    if (url.hostname !== authDomain) {
      return globalThis.__hireflipOriginalFetch(input, init);
    }

    if (url.pathname === '/oauth/token' && init.method === 'POST') {
      return jsonResponse({
        access_token: managementToken,
        expires_in: 3600,
        token_type: 'Bearer',
      });
    }

    if (url.pathname === '/api/v2/users-by-email') {
      const email = String(url.searchParams.get('email') || '').toLowerCase();
      const user = usersByEmail.get(email);

      return jsonResponse(user ? [user] : []);
    }

    if (url.pathname === '/api/v2/users' && init.method === 'POST') {
      const body = JSON.parse(String(init.body || '{}'));
      const email = String(body.email || '').toLowerCase();
      const user = {
        blocked: false,
        email,
        email_verified: true,
        identities: [
          {
            connection: connectionName,
            connection_id: connectionId,
            provider: 'auth0',
          },
        ],
        user_id: `auth0|employer-smoke-${runId}-${usersByEmail.size + 1}`,
      };

      usersByEmail.set(email, user);
      usersById.set(user.user_id, user);

      return jsonResponse(user, 201);
    }

    if (url.pathname.startsWith('/api/v2/users/') && init.method === 'PATCH') {
      const userId = decodeURIComponent(url.pathname.slice('/api/v2/users/'.length));
      const body = JSON.parse(String(init.body || '{}'));
      const user = usersById.get(userId) || {
        identities: [
          {
            connection: connectionName,
            connection_id: connectionId,
            provider: 'auth0',
          },
        ],
        user_id: userId,
      };

      Object.assign(user, body);

      if (body.blocked === true) {
        blockedUsers.add(userId);
      }

      if (body.blocked === false) {
        blockedUsers.delete(userId);
      }

      usersById.set(userId, user);

      if (user.email) {
        usersByEmail.set(String(user.email).toLowerCase(), user);
      }

      return jsonResponse(user);
    }

    if (url.pathname.startsWith('/api/v2/users/') && (!init.method || init.method === 'GET')) {
      const userId = decodeURIComponent(url.pathname.slice('/api/v2/users/'.length));
      const user = usersById.get(userId);

      if (!user) {
        return jsonResponse({ message: 'User not found' }, 404);
      }

      return jsonResponse(user);
    }

    if (url.pathname === '/api/v2/tickets/password-change' && init.method === 'POST') {
      const body = JSON.parse(String(init.body || '{}'));

      if (body.client_id && body.result_url) {
        return jsonResponse({ message: 'result_url cannot be used together with client_id' }, 400);
      }

      passwordTicketRequests.push(body);

      return jsonResponse({
        ticket: `https://${authDomain}/lo/reset?ticket=smoke-${encodeURIComponent(body.user_id || 'user')}`,
      });
    }

    if (url.pathname.startsWith('/api/v2/connections/')) {
      return jsonResponse({
        id: connectionId,
        name: connectionName,
        strategy: 'auth0',
      });
    }

    return jsonResponse({ message: `Unhandled Auth0 smoke route: ${url.pathname}` }, 404);
  };

  return {
    blockedUsers,
    fetch,
    notifications,
    passwordTicketRequests,
    usersByEmail,
    usersById,
  };
};

const main = async () => {
  loadEnvFile();

  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  process.env.AUTH0_MANAGEMENT_DOMAIN = `auth-smoke-${runId}.example.test`;
  process.env.AUTH0_MANAGEMENT_CLIENT_ID = 'smoke-management-client';
  process.env.AUTH0_MANAGEMENT_CLIENT_SECRET = 'smoke-management-secret';
  process.env.AUTH0_EMPLOYER_CONNECTION_NAME = 'hireflip-employers-smoke';
  process.env.AUTH0_EMPLOYER_CONNECTION_ID = `con_smoke_${runId.replace(/[^a-zA-Z0-9]/g, '')}`;
  process.env.AUTH0_EMPLOYER_APP_CLIENT_ID = `app_smoke_${runId.replace(/[^a-zA-Z0-9]/g, '')}`;
  process.env.AUTH0_EMPLOYER_PASSWORD_TICKET_TTL_SECONDS = '172800';
  process.env.EMPLOYER_DASHBOARD_BASE_URL = 'http://localhost:3004';
  process.env.NOTIFICATION_SERVICE_URL = `https://notification-smoke-${runId}.example.test`;
  process.env.NOTIFICATION_SERVICE_TOKEN = 'smoke-notification-token';

  const smokeFetch = createSmokeFetch({
    authDomain: process.env.AUTH0_MANAGEMENT_DOMAIN,
    connectionId: process.env.AUTH0_EMPLOYER_CONNECTION_ID,
    connectionName: process.env.AUTH0_EMPLOYER_CONNECTION_NAME,
    notificationUrl: process.env.NOTIFICATION_SERVICE_URL,
    runId,
  });
  globalThis.__hireflipOriginalFetch = global.fetch;
  global.fetch = smokeFetch.fetch;

  const appContext = await compileStrapi();
  const strapi = await createStrapi(appContext).load();
	  const created = {
	    adminClassArea: null,
	    adminClassAreaSecondary: null,
	    adminEmployer: null,
	    adminEmployerContact: null,
	    adminEmployerInvite: null,
	    adminReinvitedEmployerInvite: null,
	    candidate: null,
	    capacityChangeRequest: null,
	    capacityClaim: null,
	    class: null,
	    candidateProfile: null,
	    employer: null,
	    employerContact: null,
	    employerInvite: null,
	    enrollment: null,
	    feedback: null,
	    invitedEmployer: null,
	    invitedEmployerContact: null,
	    interview: null,
	    interviewRequest: null,
	    onboardingPolicyDocument: null,
	    progressionRequest: null,
	    slotOffer: null,
	    slots: [],
	    settingsTeamContact: null,
	    settingsTeamInvite: null,
	    teamContact: null,
	  };

  try {
    const originalService = strapi.service.bind(strapi);

    strapi.service = (uid) => {
      if (uid === 'api::admin-auth.admin-auth') {
        return {
          getSession: async () => ({
            user: {
              displayName: 'Smoke Super Admin',
              email: `admin-employer-smoke-${runId}@example.test`,
              id: `staff-smoke-${runId}`,
              roleKeys: ['super_admin'],
              roles: ['Super Admin'],
            },
          }),
        };
      }

      return originalService(uid);
    };

    const adminEmployerService = strapi.service('api::admin-employer.admin-employer');
    const employerDashboardService = strapi.service('api::employer-dashboard.employer-dashboard');
    const interviewRequestService = strapi.service('api::interview-request.interview-request');
    const adminInviteEmail = `admin-created-employer-smoke-${runId}@example.test`;
    const adminClassArea = await documents(strapi, 'api::class-area.class-area').create({
      data: {
        name: `Employer Invite Smoke Area ${runId}`,
        slug: `employer-invite-smoke-area-${runId}`.replace(/[^a-zA-Z0-9-]/g, '-'),
        sortOrder: 1,
        state: 'active',
      },
    });

	    created.adminClassArea = adminClassArea;
	    created.adminClassAreaSecondary = await documents(strapi, 'api::class-area.class-area').create({
	      data: {
	        name: `Employer Invite Smoke Secondary Area ${runId}`,
	        slug: `employer-invite-smoke-secondary-area-${runId}`.replace(/[^a-zA-Z0-9-]/g, '-'),
	        sortOrder: 2,
	        state: 'active',
	      },
	    });

	    created.onboardingPolicyDocument = await documents(strapi, 'api::policy-document.policy-document').create({
	      data: {
	        acceptanceLabel: 'I accept the smoke employer terms.',
	        body: [
	          'Smoke employer terms paragraph one.',
	          'Smoke employer terms paragraph two.',
	        ].join('\n\n'),
	        effectiveFrom: new Date().toISOString(),
	        introCopy: 'Smoke employer terms intro.',
	        policyKey: `employer_terms:smoke-${runId}`,
	        policyState: 'active',
	        policyType: 'employer_terms',
	        title: 'Smoke Employer Terms',
	        version: `smoke-employer-terms-${runId}`,
	      },
	    });

    const inviteOptions = await adminEmployerService.getInviteOptions({
      sessionToken: 's'.repeat(32),
    });

    assert(
      inviteOptions.regions.some((region) => region.name === adminClassArea.name),
      'Expected invite options to include active class area regions.'
    );

    const createdAdminInvite = await adminEmployerService.createInvite({
      companyName: `Admin Created Employer Smoke ${runId}`,
      contactEmail: adminInviteEmail,
      expiresInDays: 14,
      firstName: 'Admin',
      interviewCommitmentCadence: 'quarterly',
      interviewCommitmentVolume: 4,
      lastName: 'Invite',
      regions: [adminClassArea.name],
      roleTitle: 'People lead',
      sessionToken: 's'.repeat(32),
    });

    assert(createdAdminInvite.created === true, 'Expected admin employer invite to be created.');
    assert(createdAdminInvite.inviteSent === true, 'Expected employer invite email to queue.');
    assert(
      createdAdminInvite.invite.regionNames?.includes(adminClassArea.name),
      'Expected admin employer invite to include selected operating region.'
    );
    assert(
      createdAdminInvite.invite.inviteUrl?.includes('/invite/'),
      'Expected admin employer invite URL.'
    );
    assert(smokeFetch.notifications.length === 1, 'Expected one employer invite notification.');
    assert(
      smokeFetch.notifications[0].template?.key === 'employer_invite',
      'Expected employer invite template.'
    );

    const adminInviteRecords = await documents(strapi, 'api::employer-invite.employer-invite').findMany({
      filters: {
        documentId: createdAdminInvite.invite.documentId,
      },
      limit: 1,
      populate: {
        employer: {
          populate: ['operatingRegions'],
        },
        employerContact: {
          populate: ['coverageRegions'],
        },
      },
    });

    created.adminEmployerInvite = adminInviteRecords[0];
    created.adminEmployer = created.adminEmployerInvite?.employer || null;
    created.adminEmployerContact = created.adminEmployerInvite?.employerContact || null;

    assert(created.adminEmployerInvite?.authIdentityId, 'Expected invite to store Auth0 identity.');
    assert(created.adminEmployerInvite?.authPasswordTicketUrl, 'Expected invite to store setup ticket.');
    assert(
      smokeFetch.passwordTicketRequests[0]?.client_id === process.env.AUTH0_EMPLOYER_APP_CLIENT_ID,
      'Expected Auth0 setup ticket to target the employer dashboard app client.'
    );
    assert(
      !('result_url' in smokeFetch.passwordTicketRequests[0]),
      'Expected Auth0 setup ticket not to mix result_url with client_id.'
    );

    const employersList = await adminEmployerService.listEmployers({
      sessionToken: 's'.repeat(32),
    });

    assert(
      employersList.employers.some((employer) => employer.documentId === created.adminEmployer?.documentId),
      'Expected employer list to include created employer.'
    );

    const regionFilteredEmployers = await adminEmployerService.listEmployers({
      region: adminClassArea.name,
      sessionToken: 's'.repeat(32),
    });

    assert(
      regionFilteredEmployers.employers.some((employer) => employer.documentId === created.adminEmployer?.documentId),
      'Expected employer region filter to match any operating region.'
    );

    const employerDetail = await adminEmployerService.getEmployerDetail({
      employerDocumentId: created.adminEmployer.documentId,
      sessionToken: 's'.repeat(32),
    });

    assert(employerDetail.employer.companyName === created.adminEmployer.companyName, 'Expected employer detail.');
    assert(
      employerDetail.employer.regionNames.includes(adminClassArea.name),
      'Expected employer detail to include operating region.'
    );
    assert(
      employerDetail.contacts[0]?.coverageRegionNames.includes(adminClassArea.name),
      'Expected lead contact to cover selected operating region.'
    );
    assert(employerDetail.totalInvites >= 1, 'Expected employer detail invite history.');

    const adminInviteToken = decodeURIComponent(
      createdAdminInvite.invite.inviteUrl.split('/invite/')[1] || ''
    );
    const setupTicket = await employerDashboardService.createInviteSetupTicket({
      inviteToken: adminInviteToken,
    });

    assert(
      setupTicket.setupUrl.startsWith(`https://${process.env.AUTH0_MANAGEMENT_DOMAIN}/`),
      'Expected setup ticket URL.'
    );

    const generatedAdminInviteLink = await adminEmployerService.generateInviteLink({
      employerInviteDocumentId: createdAdminInvite.invite.documentId,
      sessionToken: 's'.repeat(32),
    });

    assert(generatedAdminInviteLink.generated === true, 'Expected employer invite link generation.');
    assert(
      generatedAdminInviteLink.invite.inviteUrl?.includes('/invite/'),
      'Expected generated employer invite URL.'
    );
    assert(
      smokeFetch.notifications.length === 1,
      'Expected employer invite link generation not to queue another notification.'
    );

    const generatedAdminInviteToken = decodeURIComponent(
      generatedAdminInviteLink.invite.inviteUrl.split('/invite/')[1] || ''
    );
    const generatedSetupTicket = await employerDashboardService.createInviteSetupTicket({
      inviteToken: generatedAdminInviteToken,
    });

    assert(
      generatedSetupTicket.setupUrl.startsWith(`https://${process.env.AUTH0_MANAGEMENT_DOMAIN}/`),
      'Expected generated invite setup ticket URL.'
    );

    const resentAdminInvite = await adminEmployerService.resendInvite({
      employerInviteDocumentId: createdAdminInvite.invite.documentId,
      sessionToken: 's'.repeat(32),
    });

    assert(resentAdminInvite.resent === true, 'Expected employer invite resend.');
    assert(resentAdminInvite.inviteSent === true, 'Expected resent employer invite email to queue.');
    assert(smokeFetch.notifications.length === 2, 'Expected resend notification.');

    await adminEmployerService.revokeInvite({
      employerInviteDocumentId: createdAdminInvite.invite.documentId,
      sessionToken: 's'.repeat(32),
    });

    assert(
      smokeFetch.blockedUsers.has(created.adminEmployerInvite.authIdentityId),
      'Expected revoked invite to block Auth0 user.'
    );

    const invitesAfterRevoke = await adminEmployerService.listInvites({
      sessionToken: 's'.repeat(32),
    });

    assert(
      !invitesAfterRevoke.invites.some((invite) => invite.documentId === createdAdminInvite.invite.documentId),
      'Expected revoked employer invite to be hidden from the global invite list.'
    );

    const employerDetailAfterRevoke = await adminEmployerService.getEmployerDetail({
      employerDocumentId: created.adminEmployer.documentId,
      sessionToken: 's'.repeat(32),
    });

    assert(
      employerDetailAfterRevoke.invites.some(
        (invite) =>
          invite.documentId === createdAdminInvite.invite.documentId &&
          invite.inviteState === 'revoked'
      ),
      'Expected revoked employer invite to remain in employer invite history.'
    );

    const archivedEmployer = await adminEmployerService.archiveEmployer({
      employerDocumentId: created.adminEmployer.documentId,
      sessionToken: 's'.repeat(32),
    });

    assert(archivedEmployer.archived === true, 'Expected employer archive to succeed.');
    assert(archivedEmployer.employer.employerState === 'archived', 'Expected employer to be archived.');

    const employerDetailAfterArchive = await adminEmployerService.getEmployerDetail({
      employerDocumentId: created.adminEmployer.documentId,
      sessionToken: 's'.repeat(32),
    });

    assert(
      employerDetailAfterArchive.contacts.every((contact) => contact.contactState === 'archived'),
      'Expected archive to move employer contacts out of active access.'
    );

    const defaultEmployersAfterArchive = await adminEmployerService.listEmployers({
      sessionToken: 's'.repeat(32),
    });

    assert(
      !defaultEmployersAfterArchive.employers.some(
        (employer) => employer.documentId === created.adminEmployer.documentId
      ),
      'Expected default employer list to hide archived employers.'
    );

    const archivedEmployersList = await adminEmployerService.listEmployers({
      sessionToken: 's'.repeat(32),
      state: 'archived',
    });

    assert(
      archivedEmployersList.employers.some(
        (employer) => employer.documentId === created.adminEmployer.documentId
      ),
      'Expected archived employer list to include archived employers.'
    );

    const reinvitedEmployer = await adminEmployerService.createInvite({
      companyName: `Admin Reinvited Employer Smoke ${runId}`,
      contactEmail: adminInviteEmail,
      expiresInDays: 14,
      firstName: 'Admin',
      interviewCommitmentCadence: 'quarterly',
      interviewCommitmentVolume: 2,
      lastName: 'Invite',
      regions: [adminClassArea.name],
      roleTitle: 'People lead',
      sessionToken: 's'.repeat(32),
    });

    assert(reinvitedEmployer.created === true, 'Expected archived employer to be inviteable again.');
    assert(
      reinvitedEmployer.invite.inviteUrl?.includes('/invite/'),
      'Expected archived employer reinvite URL.'
    );
    created.adminReinvitedEmployerInvite = (
      await documents(strapi, 'api::employer-invite.employer-invite').findMany({
        filters: {
          documentId: reinvitedEmployer.invite.documentId,
        },
        limit: 1,
        populate: {
          employer: {
            populate: ['operatingRegions'],
          },
          employerContact: {
            populate: ['coverageRegions'],
          },
        },
      })
    )[0];

    const recoveredAuthIdentityId = `auth0|recovered-employer-dashboard-smoke-${runId}`;
    smokeFetch.usersById.set(recoveredAuthIdentityId, {
      blocked: false,
      email: adminInviteEmail,
      email_verified: true,
      identities: [
        {
          connection: process.env.AUTH0_EMPLOYER_CONNECTION_NAME,
          connection_id: process.env.AUTH0_EMPLOYER_CONNECTION_ID,
          provider: 'auth0',
        },
      ],
      user_id: recoveredAuthIdentityId,
    });

    const recoveredReinvite = await employerDashboardService.acceptPendingInvite({
      authIdentityId: recoveredAuthIdentityId,
      email: adminInviteEmail,
    });

    assert(recoveredReinvite.accepted === true, 'Expected archived employer re-invite completion.');
    assert(
      recoveredReinvite.account.companyName === reinvitedEmployer.invite.companyName,
      'Expected recovered invite to activate the re-invited employer account.'
    );

    const recoveredInviteRecord = (
      await documents(strapi, 'api::employer-invite.employer-invite').findMany({
        filters: {
          documentId: reinvitedEmployer.invite.documentId,
        },
        limit: 1,
        populate: ['employerContact'],
      })
    )[0];

    assert(
      recoveredInviteRecord.authIdentityId === recoveredAuthIdentityId,
      'Expected recovered invite to store the signed-in Auth0 identity.'
    );
    assert(
      recoveredInviteRecord.employerContact?.authIdentityId === recoveredAuthIdentityId,
      'Expected recovered invite to relink the employer contact Auth0 identity.'
    );

    const inviteToken = randomBytes(32).toString('base64url');
    const invitedEmployer = await documents(strapi, 'api::employer.employer').create({
      data: {
	        assignmentMode: 'automatic',
	        companyName: `Invited Employer Smoke ${runId}`,
	        employerState: 'invited',
	        initialInterviewCommitmentCadence: 'quarterly',
	        initialInterviewCommitmentVolume: 3,
	        interviewCommitmentCadence: 'quarterly',
	        interviewCommitmentVolume: 3,
        region: 'Manchester',
      },
    });
    const invitedAuthIdentityId = `auth0|invited-employer-dashboard-smoke-${runId}`;
    const invitedEmployerContact = await documents(strapi, 'api::employer-contact.employer-contact').create({
      data: {
        authIdentityId: invitedAuthIdentityId,
        authProvider: 'auth0',
        contactState: 'invited',
        email: `invited-employer-dashboard-smoke-${runId}@example.test`,
        employer: connect(invitedEmployer),
        firstName: 'Invited',
        lastName: 'Employer',
        invitedAt: new Date().toISOString(),
        roleTitle: 'Talent lead',
      },
      populate: ['employer'],
    });
    const employerInvite = await documents(strapi, 'api::employer-invite.employer-invite').create({
      data: {
        authIdentityId: invitedAuthIdentityId,
        employer: connect(invitedEmployer),
        employerContact: connect(invitedEmployerContact),
        expiresAt: addDays(14),
        inviteEmail: invitedEmployerContact.email,
        inviteState: 'pending',
        lastSentAt: new Date().toISOString(),
        tokenHash: createHash('sha256').update(inviteToken).digest('hex'),
      },
      populate: ['employer', 'employerContact'],
    });

    created.invitedEmployer = invitedEmployer;
    created.invitedEmployerContact = invitedEmployerContact;
    created.employerInvite = employerInvite;

    const inviteValidation = await employerDashboardService.validateInvite({ inviteToken });

    assert(inviteValidation.valid === true, 'Expected employer invite to validate.');
    assert(
      inviteValidation.invite.companyName === invitedEmployer.companyName,
      'Expected invite validation company name.'
    );

    let rejectedUnacceptedOverview = false;

    try {
      await employerDashboardService.getOverview({
        authIdentityId: invitedAuthIdentityId,
        email: invitedEmployerContact.email,
      });
    } catch (error) {
      rejectedUnacceptedOverview = true;
    }

    assert(rejectedUnacceptedOverview, 'Expected unaccepted employer invite to be blocked.');

    let rejectedMismatchedEmail = false;

    try {
      await employerDashboardService.acceptInvite({
        authIdentityId: invitedAuthIdentityId,
        email: `wrong-employer-dashboard-smoke-${runId}@example.test`,
        inviteToken,
      });
    } catch (error) {
      rejectedMismatchedEmail = true;
    }

    assert(rejectedMismatchedEmail, 'Expected mismatched invited email to be rejected.');

    let rejectedWrongPendingIdentity = false;

    try {
      await employerDashboardService.acceptPendingInvite({
        authIdentityId: `auth0|wrong-employer-dashboard-smoke-${runId}`,
        email: invitedEmployerContact.email,
      });
    } catch (error) {
      rejectedWrongPendingIdentity = true;
    }

    assert(
      rejectedWrongPendingIdentity,
      'Expected pending invite recovery to require the pre-provisioned Auth0 identity.'
    );

    const acceptedInvite = await employerDashboardService.acceptPendingInvite({
      authIdentityId: invitedAuthIdentityId,
      email: invitedEmployerContact.email,
    });

	    assert(acceptedInvite.accepted === true, 'Expected employer invite to be accepted.');
	    assert(acceptedInvite.account.companyName === invitedEmployer.companyName, 'Expected accepted account.');
	    assert(
	      acceptedInvite.account.onboarding?.isComplete === false,
	      'Expected accepted invite to require dashboard onboarding.'
	    );

	    const onboardingBeforeCompletion = await employerDashboardService.getOnboarding({
	      authIdentityId: invitedAuthIdentityId,
	      email: invitedEmployerContact.email,
	    });

	    assert(
	      onboardingBeforeCompletion.onboarding.isComplete === false,
	      'Expected onboarding to be incomplete before completion.'
	    );
	    assert(
	      onboardingBeforeCompletion.onboarding.availableRegions.some(
	        (region) => region.documentId === adminClassArea.documentId
	      ),
	      'Expected onboarding to expose active operating regions.'
	    );
	    assert(
	      onboardingBeforeCompletion.onboarding.terms.policy?.documentId ===
	        created.onboardingPolicyDocument.documentId,
	      'Expected onboarding to expose active employer terms.'
	    );

	    const teamContactEmail = `team-contact-employer-smoke-${runId}@example.test`;
	    const completedOnboarding = await employerDashboardService.completeOnboarding({
	      acceptedTerms: true,
	      acceptedTermsPolicyDocumentId: created.onboardingPolicyDocument.documentId,
	      acceptedTermsPolicyVersion: created.onboardingPolicyDocument.version,
	      authIdentityId: invitedAuthIdentityId,
	      commitmentMode: 'global',
	      companyName: `${invitedEmployer.companyName} Updated`,
	      contactFirstName: 'Invited',
	      contactLastName: 'Employer',
	      contactPhone: '+447700900123',
	      contactRoleTitle: 'Talent lead',
	      email: invitedEmployerContact.email,
	      interviewCommitmentCadence: 'quarterly',
	      interviewCommitmentVolume: 4,
	      operatingRegionDocumentIds: [adminClassArea.documentId],
	      teamContacts: [
	        {
	          coverageRegionDocumentIds: [adminClassArea.documentId],
	          email: teamContactEmail,
	          firstName: 'Team',
	          lastName: 'Contact',
	          roleTitle: 'Hiring manager',
	        },
	      ],
	    });

	    assert(completedOnboarding.completed === true, 'Expected employer onboarding to complete.');
	    assert(
	      completedOnboarding.onboarding.isComplete === true,
	      'Expected completed onboarding state.'
	    );
	    assert(
	      completedOnboarding.onboarding.terms.acceptedPolicyVersion ===
	        created.onboardingPolicyDocument.version,
	      'Expected completed onboarding to record terms version.'
	    );

	    created.teamContact = (
	      await documents(strapi, 'api::employer-contact.employer-contact').findMany({
	        filters: {
	          email: teamContactEmail,
	        },
	        limit: 1,
	        populate: ['coverageRegions'],
	      })
	    )[0];

	    assert(created.teamContact?.contactState === 'listed', 'Expected optional team contact to be listed.');
	    assert(
	      created.teamContact.coverageRegions?.some((region) => region.documentId === adminClassArea.documentId),
	      'Expected optional team contact to cover selected operating region.'
	    );

	    const onboardingCapacityReviews = await documents(
	      strapi,
	      'api::employer-capacity-change-request.employer-capacity-change-request'
	    ).findMany({
	      filters: {
	        employer: {
	          documentId: invitedEmployer.documentId,
	        },
	        requestState: 'pending',
	      },
	      limit: 5,
	    });

	    assert(
	      onboardingCapacityReviews.length === 0,
	      'Expected increased onboarding commitment not to create a capacity review request.'
	    );

	    const invitedEmployerDetailAfterOnboarding = await adminEmployerService.getEmployerDetail({
	      employerDocumentId: invitedEmployer.documentId,
	      sessionToken: 's'.repeat(32),
	    });

	    assert(
	      invitedEmployerDetailAfterOnboarding.employer.coverage.isComplete === true,
	      'Expected onboarding coverage to cover all selected operating regions.'
	    );
	    const onboardingLeadContact = invitedEmployerDetailAfterOnboarding.contacts.find(
	      (contact) => contact.documentId === invitedEmployerContact.documentId
	    );
	    assert(
	      onboardingLeadContact?.contactRole === 'lead_contact',
	      'Expected onboarding contact to be marked as the lead contact.'
	    );
	    assert(
	      Boolean(onboardingLeadContact?.coverageConfirmedAt),
	      'Expected onboarding to record coverage confirmation.'
	    );

	    const increasedSettings = await employerDashboardService.updateSettings({
	      authIdentityId: invitedAuthIdentityId,
	      commitmentMode: 'global',
	      companyName: `${invitedEmployer.companyName} Updated`,
	      coverageConfirmed: true,
	      coverageRegionDocumentIds: [adminClassArea.documentId],
	      email: invitedEmployerContact.email,
	      interviewCommitmentCadence: 'quarterly',
	      interviewCommitmentVolume: 6,
	      operatingRegionDocumentIds: [
	        adminClassArea.documentId,
	        created.adminClassAreaSecondary.documentId,
	      ],
	      regionCommitments: [],
	    });

	    assert(increasedSettings.settings.updated === true, 'Expected employer settings update.');
	    assert(
	      increasedSettings.settings.reviewNeeded === false,
	      'Expected increased commitment and added region to apply without a capacity review.'
	    );
	    assert(
	      increasedSettings.account.coverage.isComplete === false,
	      'Expected added operating region to require interview coverage.'
	    );
	    assert(
	      increasedSettings.account.coverage.gateOpen === false,
	      'Expected missing interview coverage to block accepting interview requests.'
	    );

	    const coverageOverride = await adminEmployerService.setCoverageOverride({
	      employerDocumentId: invitedEmployer.documentId,
	      enabled: true,
	      reason: 'Smoke test coverage override while secondary region coverage is pending.',
	      sessionToken: 's'.repeat(32),
	    });

	    assert(coverageOverride.overridden === true, 'Expected coverage override to be enabled.');
	    assert(
	      coverageOverride.employer.coverage.gateOpen === true,
	      'Expected coverage override to open the interview request gate.'
	    );

	    const invitedTeamContactEmail = `settings-team-employer-smoke-${runId}@example.test`;
	    const notificationsBeforeTeamInvite = smokeFetch.notifications.length;
	    const invitedTeamContact = await employerDashboardService.inviteTeamContact({
	      authIdentityId: invitedAuthIdentityId,
	      coverageRegionDocumentIds: [created.adminClassAreaSecondary.documentId],
	      email: invitedEmployerContact.email,
	      firstName: 'Secondary',
	      inviteEmail: invitedTeamContactEmail,
	      lastName: 'Contact',
	      roleTitle: 'Regional hiring lead',
	    });

	    assert(invitedTeamContact.invited === true, 'Expected lead contact to invite a team contact.');
	    assert(invitedTeamContact.inviteSent === true, 'Expected team contact invite email to queue.');
	    assert(
	      invitedTeamContact.contact.coverageRegionNames.includes(created.adminClassAreaSecondary.name),
	      'Expected invited team contact to cover the selected operating region.'
	    );
	    assert(
	      smokeFetch.notifications.length === notificationsBeforeTeamInvite + 1,
	      'Expected team invite notification.'
	    );

	    created.settingsTeamContact = {
	      documentId: invitedTeamContact.contact.documentId,
	      email: invitedTeamContactEmail,
	    };
	    created.settingsTeamInvite = {
	      documentId: invitedTeamContact.invite.documentId,
	    };

	    const removedCoverageOverride = await adminEmployerService.setCoverageOverride({
	      employerDocumentId: invitedEmployer.documentId,
	      enabled: false,
	      reason: 'Smoke test removing temporary coverage override.',
	      sessionToken: 's'.repeat(32),
	    });

	    assert(removedCoverageOverride.overridden === false, 'Expected coverage override to be removed.');

	    const reducedSettings = await employerDashboardService.updateSettings({
	      authIdentityId: invitedAuthIdentityId,
	      commitmentMode: 'global',
	      companyName: `${invitedEmployer.companyName} Updated`,
	      coverageConfirmed: true,
	      coverageRegionDocumentIds: [adminClassArea.documentId],
	      email: invitedEmployerContact.email,
	      interviewCommitmentCadence: 'quarterly',
	      interviewCommitmentVolume: 3,
	      operatingRegionDocumentIds: [adminClassArea.documentId],
	      regionCommitments: [],
	      reviewNote: 'Smoke test reduced interview commitment and removed secondary region.',
	    });

	    assert(reducedSettings.settings.reviewNeeded === true, 'Expected reduced commitment to need review.');

	    created.capacityChangeRequest = (
	      await documents(strapi, 'api::employer-capacity-change-request.employer-capacity-change-request').findMany({
	        filters: {
	          employer: {
	            documentId: invitedEmployer.documentId,
	          },
	          requestState: 'pending',
	        },
	        limit: 1,
	      })
	    )[0];

	    assert(
	      created.capacityChangeRequest?.requestedInterviewCommitmentVolume === 3,
	      'Expected reduced commitment to create a capacity review request.'
	    );

	    const acceptedOverview = await employerDashboardService.getOverview({
	      authIdentityId: invitedAuthIdentityId,
	      email: invitedEmployerContact.email,
	    });

	    assert(
	      acceptedOverview.account.companyName === `${invitedEmployer.companyName} Updated`,
	      'Expected accepted invited employer to access overview.'
	    );
	    assert(
	      acceptedOverview.account.onboarding?.isComplete === true,
	      'Expected overview account to report completed onboarding.'
	    );

	    const invitedEmployerDetail = await adminEmployerService.getEmployerDetail({
	      employerDocumentId: invitedEmployer.documentId,
	      sessionToken: 's'.repeat(32),
	    });

	    assert(
	      invitedEmployerDetail.employer.onboardingComplete === true,
	      'Expected admin employer detail to expose completed onboarding.'
	    );
	    assert(
	      invitedEmployerDetail.employer.employerTermsPolicyVersion ===
	        created.onboardingPolicyDocument.version,
	      'Expected admin employer detail to expose accepted terms version.'
	    );

    let rejectedReusedInvite = false;

    try {
      await employerDashboardService.validateInvite({ inviteToken });
    } catch (error) {
      rejectedReusedInvite = true;
    }

    assert(rejectedReusedInvite, 'Expected accepted employer invite to be inactive.');

    const employer = await documents(strapi, 'api::employer.employer').create({
      data: {
        assignmentMode: 'automatic',
        companyName: `Employer Smoke ${runId}`,
        dashboardOnboardingCompletedAt: new Date().toISOString(),
        dashboardOnboardingState: 'complete',
        employerState: 'active',
        interviewCommitmentCadence: 'quarterly',
        interviewCommitmentVolume: 5,
        operatingRegions: connect(created.adminClassArea),
        region: 'London',
      },
    });
    const employerContact = await documents(strapi, 'api::employer-contact.employer-contact').create({
      data: {
        accountCreatedAt: new Date().toISOString(),
        authIdentityId: `auth0|employer-dashboard-smoke-${runId}`,
        authProvider: 'auth0',
        contactState: 'active',
        contactRole: 'lead_contact',
        coverageConfirmedAt: new Date().toISOString(),
        coverageConfirmedByEmail: `employer-dashboard-smoke-${runId}@example.test`,
        coverageRegions: connect(created.adminClassArea),
        email: `employer-dashboard-smoke-${runId}@example.test`,
        employer: connect(employer),
        firstName: 'Employer',
        lastName: 'Smoke',
        roleTitle: 'Hiring manager',
      },
      populate: ['employer'],
    });
    const rerouteEmployer = await documents(strapi, 'api::employer.employer').create({
      data: {
        assignmentMode: 'automatic',
        companyName: `ZZ Employer Smoke ${runId}`,
        dashboardOnboardingCompletedAt: new Date().toISOString(),
        dashboardOnboardingState: 'complete',
        employerState: 'active',
        interviewCommitmentCadence: 'quarterly',
        interviewCommitmentVolume: 5,
        operatingRegions: connect(created.adminClassArea),
        region: 'London',
      },
    });
    const rerouteEmployerContact = await documents(strapi, 'api::employer-contact.employer-contact').create({
      data: {
        accountCreatedAt: new Date().toISOString(),
        authIdentityId: `auth0|employer-dashboard-reroute-smoke-${runId}`,
        authProvider: 'auth0',
        contactState: 'active',
        contactRole: 'lead_contact',
        coverageConfirmedAt: new Date().toISOString(),
        coverageConfirmedByEmail: `employer-dashboard-reroute-smoke-${runId}@example.test`,
        coverageRegions: connect(created.adminClassArea),
        email: `employer-dashboard-reroute-smoke-${runId}@example.test`,
        employer: connect(rerouteEmployer),
        firstName: 'Reroute',
        lastName: 'Smoke',
        roleTitle: 'Hiring manager',
      },
      populate: ['employer'],
    });
    const candidate = await documents(strapi, 'api::candidate.candidate').create({
      data: {
        accountOnboardingCompletedAt: new Date().toISOString(),
        accountRestrictionStatus: 'active',
        authIdentityId: `auth0|employer-dashboard-candidate-${runId}`,
        authProvider: 'auth0',
        candidateState: 'interview_phase',
        email: `employer-dashboard-candidate-${runId}@example.test`,
        firstName: 'Candidate',
        lastName: 'Smoke',
        marketingConsentState: 'opted_out',
        preferredCommunicationChannel: 'email',
      },
    });
    const classRecord = await documents(strapi, 'api::class.class').create({
      data: {
        capacity: 1,
        classArea: connect(created.adminClassArea),
        currency: 'GBP',
        displayTitle: `Employer Smoke Class ${runId}`,
        employerInterviewAvailabilityThresholdPercentage: 150,
        interviewsGuaranteed: 1,
        name: `Employer Smoke Class ${runId}`,
        officialClassCode: `ESC-${runId}`,
        pricePence: 100000,
        state: 'in_progress',
      },
      populate: ['classArea'],
    });
    const enrollment = await documents(strapi, 'api::enrollment.enrollment').create({
      data: {
        candidate: connect(candidate),
        class: connect(classRecord),
        completionStatus: 'completed',
        enrollmentState: 'interview_phase',
        interviewGuaranteeDeadline: addDays(90),
        interviewGuaranteeWindowStartsAt: new Date().toISOString(),
        passStatus: 'passed',
        paymentStatus: 'paid',
        qualifyingInterviewsDeliveredCount: 0,
      },
      populate: ['candidate', 'class'],
    });
    const candidateProfile = await documents(strapi, 'api::candidate-profile.candidate-profile').create({
      data: {
        availability: 'First interview availability submitted for smoke test.',
        candidate: connect(candidate),
        completedAt: new Date().toISOString(),
        profileState: 'completed',
        summary: 'Smoke profile for interview request routing.',
      },
    });

    created.employer = employer;
    created.employerContact = employerContact;
    created.rerouteEmployer = rerouteEmployer;
    created.rerouteEmployerContact = rerouteEmployerContact;
    created.candidate = candidate;
    created.class = classRecord;
    created.enrollment = enrollment;
    created.candidateProfile = candidateProfile;

    const initialOverview = await employerDashboardService.getOverview({
      email: employerContact.email,
    });

    assert(initialOverview.account.companyName === employer.companyName, 'Expected overview company name.');
    assert(initialOverview.summary.availableSlots === 0, 'Expected no available slots initially.');

    const interviewRequest = await interviewRequestService.ensureForEnrollment({
      enrollmentDocumentId: enrollment.documentId,
      source: 'smoke_employer_dashboard',
    });
    const capacityClaims = await documents(
      strapi,
      'api::employer-capacity-claim.employer-capacity-claim'
    ).findMany({
      filters: {
        employer: {
          documentId: employer.documentId,
        },
        interviewRequest: {
          documentId: interviewRequest.documentId,
        },
      },
      limit: 1,
      populate: ['interviewRequest'],
    });

    created.interviewRequest = interviewRequest;
    created.capacityClaim = capacityClaims[0];

    assert(created.capacityClaim, 'Expected interview request routing to claim employer capacity.');

    const overviewWithClaim = await employerDashboardService.getOverview({
      authIdentityId: employerContact.authIdentityId,
    });

    assert(
      overviewWithClaim.availabilityRequests.length === 1,
      'Expected one capacity-backed availability request.'
    );
    assert(
      overviewWithClaim.availabilityRequests[0].candidateName === 'Candidate Smoke',
      'Expected availability request candidate name.'
    );

    const claimDetail = await employerDashboardService.getCapacityClaim({
      authIdentityId: employerContact.authIdentityId,
      capacityClaimDocumentId: created.capacityClaim.documentId,
    });

    assert(
      claimDetail.claim.currentlyOpenBy.isCurrentContact === true,
      'Expected detail view to mark the claim as open by the current contact.'
    );
    assert(claimDetail.claim.canAct === true, 'Expected current contact to be able to act.');

    const declineResult = await employerDashboardService.declineCapacityClaim({
      authIdentityId: employerContact.authIdentityId,
      capacityClaimDocumentId: created.capacityClaim.documentId,
      declineNote: 'Smoke test cannot cover this request.',
      declineReason: 'no_availability',
    });

    assert(declineResult.released === true, 'Expected decline to release the first claim.');

    const reroutedClaims = await documents(
      strapi,
      'api::employer-capacity-claim.employer-capacity-claim'
    ).findMany({
      filters: {
        interviewRequest: {
          documentId: interviewRequest.documentId,
        },
        claimState: {
          $in: ['held', 'notified', 'accepted'],
        },
      },
      limit: 10,
      populate: ['interviewRequest', 'employer', 'employerContact'],
      sort: ['createdAt:desc'],
    });

    const reroutedClaim = reroutedClaims.find(
      (claim) => claim.documentId !== created.capacityClaim.documentId
    );

    assert(reroutedClaim, 'Expected decline to reroute capacity to another eligible employer.');
    assert(reroutedClaim.employer, 'Expected rerouted claim to include an employer.');
    assert(reroutedClaim.employerContact, 'Expected rerouted claim to include an employer contact.');

    created.declinedCapacityClaim = created.capacityClaim;
    created.capacityClaim = reroutedClaim;

    const slotEmployer = reroutedClaim.employer;
    const slotEmployerContact = reroutedClaim.employerContact;

    let rejectedShortOffer = false;

    try {
      await employerDashboardService.createInterviewSlotOffer({
        capacityClaimDocumentId: created.capacityClaim.documentId,
        candidateDocumentId: candidate.documentId,
        email: slotEmployerContact.email,
        enrollmentDocumentId: enrollment.documentId,
        interviewRequestDocumentId: interviewRequest.documentId,
        slots: [
          {
            employerContactDocumentId: slotEmployerContact.documentId,
            endTime: addWorkingDays(8, 11),
            locationType: 'online',
            startTime: addWorkingDays(8, 10),
          },
          {
            employerContactDocumentId: slotEmployerContact.documentId,
            endTime: addWorkingDays(9, 12),
            locationType: 'online',
            startTime: addWorkingDays(9, 11),
          },
        ],
      });
    } catch (error) {
      rejectedShortOffer = true;
    }

    assert(rejectedShortOffer, 'Expected 2-slot offer to be rejected.');

    const slotOfferResult = await employerDashboardService.createInterviewSlotOffer({
      capacityClaimDocumentId: created.capacityClaim.documentId,
      candidateDocumentId: candidate.documentId,
      email: slotEmployerContact.email,
      enrollmentDocumentId: enrollment.documentId,
      internalNote: 'Smoke test 3-option slot offer.',
      interviewRequestDocumentId: interviewRequest.documentId,
      slots: [
        {
          employerContactDocumentId: slotEmployerContact.documentId,
          endTime: addWorkingDays(8, 11),
          locationType: 'online',
          startTime: addWorkingDays(8, 10),
        },
        {
          employerContactDocumentId: slotEmployerContact.documentId,
          endTime: addWorkingDays(9, 12),
          locationType: 'phone',
          startTime: addWorkingDays(9, 11),
        },
        {
          employerContactDocumentId: slotEmployerContact.documentId,
          endTime: addWorkingDays(10, 15),
          locationType: 'in_person',
          startTime: addWorkingDays(10, 14),
        },
      ],
    });

    assert(slotOfferResult.created === true, 'Expected slot offer to be created.');
    assert(slotOfferResult.offer.slots.length === 3, 'Expected exactly 3 slot records.');

    created.slotOffer = { documentId: slotOfferResult.offer.documentId };
    created.slots = slotOfferResult.offer.slots;

    const overviewWithSlots = await employerDashboardService.getOverview({
      authIdentityId: slotEmployerContact.authIdentityId,
    });

    assert(overviewWithSlots.summary.availableSlots === 3, 'Expected 3 available slot options.');
    assert(
      overviewWithSlots.availabilityRequests.length === 0,
      'Expected fulfilled capacity claim to clear from availability requests.'
    );

    const interview = await documents(strapi, 'api::interview.interview').create({
      data: {
        candidate: connect(candidate),
        completedAt: addDays(-1, 11),
        countsTowardGuarantee: false,
        employer: connect(slotEmployer),
        employerContact: connect(slotEmployerContact),
        enrollment: connect(enrollment),
        interviewSlot: {
          connect: [{ documentId: created.slots[0].documentId }],
        },
        interviewState: 'completed',
        scheduledEndTime: addDays(-1, 11),
        scheduledStartTime: addDays(-1, 10),
      },
      populate: ['candidate', 'employer', 'employerContact', 'enrollment', 'interviewSlot'],
    });
    const progressionRequest = await documents(strapi, 'api::offer.offer').create({
      data: {
        candidate: connect(candidate),
        employer: connect(slotEmployer),
        interview: connect(interview),
        progressionState: 'requested',
        requestedByEmployerContact: connect(slotEmployerContact),
        requestedDetailsAt: new Date().toISOString(),
      },
      populate: ['candidate', 'employer', 'interview', 'requestedByEmployerContact'],
    });

    created.interview = interview;
    created.progressionRequest = progressionRequest;

    const overviewWithFeedbackDue = await employerDashboardService.getOverview({
      email: slotEmployerContact.email,
    });

    assert(overviewWithFeedbackDue.summary.feedbackDue === 1, 'Expected one feedback request.');
    assert(
      overviewWithFeedbackDue.summary.progressionRequests === 1,
      'Expected one progression request.'
    );

    const feedbackDetail = await employerDashboardService.getInterviewFeedbackDetail({
      email: slotEmployerContact.email,
      interviewDocumentId: interview.documentId,
    });

    assert(feedbackDetail.feedback === null, 'Expected no feedback before submission.');
    assert(feedbackDetail.rules.rawFeedbackCandidateVisible === false, 'Expected raw feedback to stay internal.');

    const feedbackResult = await employerDashboardService.submitInterviewFeedback({
      concerns: 'Needs to give more specific examples.',
      email: slotEmployerContact.email,
      interviewDocumentId: interview.documentId,
      nextStep: 'Progress internally.',
      notes: 'Smoke employer feedback.',
      outcome: 'progressing',
      rating: 5,
      strengths: 'Clear communication and strong preparation.',
    });

    assert(feedbackResult.feedback?.candidateReport?.state === 'pending', 'Expected candidate report to be pending.');
    assert(
      feedbackResult.feedback?.candidateReport?.intro === null,
      'Expected raw feedback not to be exposed as candidate report copy.'
    );

    created.feedback = feedbackResult.feedback;

    const overviewAfterFeedback = await employerDashboardService.getOverview({
      email: slotEmployerContact.email,
    });

    assert(overviewAfterFeedback.summary.feedbackDue === 0, 'Expected feedback request to clear.');

    console.log('Employer dashboard smoke passed.');
  } finally {
    await deleteDocument(strapi, 'api::interview-feedback.interview-feedback', created.feedback?.documentId);
    await deleteDocument(strapi, 'api::offer.offer', created.progressionRequest?.documentId);
    await deleteDocument(strapi, 'api::interview.interview', created.interview?.documentId);

    for (const slot of created.slots) {
      await deleteDocument(strapi, 'api::interview-slot.interview-slot', slot.documentId);
    }

    await deleteDocument(strapi, 'api::interview-slot-offer.interview-slot-offer', created.slotOffer?.documentId);
    await deleteDocument(
      strapi,
      'api::employer-capacity-claim.employer-capacity-claim',
      created.capacityClaim?.documentId
    );
    await deleteDocument(
      strapi,
      'api::employer-capacity-claim.employer-capacity-claim',
      created.declinedCapacityClaim?.documentId
    );
    await deleteAuditEventsForSubject(strapi, created.interviewRequest?.documentId);
    await deleteDocument(strapi, 'api::interview-request.interview-request', created.interviewRequest?.documentId);
    await deleteDocument(strapi, 'api::candidate-profile.candidate-profile', created.candidateProfile?.documentId);
    await deleteDocument(strapi, 'api::enrollment.enrollment', created.enrollment?.documentId);
    await deleteAuditEventsForSubject(strapi, created.class?.documentId);
    await deleteDocument(strapi, 'api::class.class', created.class?.documentId);
    await deleteDocument(strapi, 'api::employer-contact.employer-contact', created.rerouteEmployerContact?.documentId);
    await deleteDocument(strapi, 'api::employer.employer', created.rerouteEmployer?.documentId);
    await deleteDocument(strapi, 'api::employer-contact.employer-contact', created.employerContact?.documentId);
    await deleteDocument(strapi, 'api::employer.employer', created.employer?.documentId);
    await deleteDocument(strapi, 'api::candidate.candidate', created.candidate?.documentId);
	    await deleteDocument(strapi, 'api::employer-invite.employer-invite', created.employerInvite?.documentId);
	    await deleteNotificationEventsForEmail(strapi, created.settingsTeamContact?.email);
	    await deleteDocument(strapi, 'api::employer-invite.employer-invite', created.settingsTeamInvite?.documentId);
	    await deleteDocument(strapi, 'api::employer-contact.employer-contact', created.settingsTeamContact?.documentId);
	    await deleteCapacityChangeRequestsForEmployer(strapi, created.invitedEmployer?.documentId);
	    await deleteEmployerRegionCommitments(strapi, created.invitedEmployer?.documentId);
	    await deleteAuditEventsForSubject(strapi, created.invitedEmployer?.documentId);
	    await deleteDocument(strapi, 'api::employer-contact.employer-contact', created.teamContact?.documentId);
	    await deleteDocument(strapi, 'api::employer-contact.employer-contact', created.invitedEmployerContact?.documentId);
	    await deleteDocument(strapi, 'api::employer.employer', created.invitedEmployer?.documentId);
	    await deleteNotificationEventsForEmail(strapi, created.adminEmployerContact?.email);
    await deleteDocument(strapi, 'api::employer-invite.employer-invite', created.adminReinvitedEmployerInvite?.documentId);
    await deleteDocument(strapi, 'api::employer-invite.employer-invite', created.adminEmployerInvite?.documentId);
	    await deleteDocument(strapi, 'api::employer-contact.employer-contact', created.adminEmployerContact?.documentId);
	    await deleteCapacityChangeRequestsForEmployer(strapi, created.adminEmployer?.documentId);
	    await deleteEmployerRegionCommitments(strapi, created.adminEmployer?.documentId);
	    await deleteDocument(strapi, 'api::employer.employer', created.adminEmployer?.documentId);
	    await deleteDocument(
	      strapi,
	      'api::policy-document.policy-document',
	      created.onboardingPolicyDocument?.documentId
	    );
	    await deleteDocument(strapi, 'api::class-area.class-area', created.adminClassAreaSecondary?.documentId);
	    await deleteDocument(strapi, 'api::class-area.class-area', created.adminClassArea?.documentId);
    await strapi.destroy();
    global.fetch = globalThis.__hireflipOriginalFetch;
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

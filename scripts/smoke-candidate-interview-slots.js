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

const connect = (record) => ({
  connect: [{ documentId: record.documentId }],
});

const deleteDocument = async (strapi, uid, documentId) => {
  if (!documentId) {
    return;
  }

  await documents(strapi, uid).delete({ documentId }).catch(() => undefined);
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

const jsonResponse = (body, status = 202) =>
  new Response(JSON.stringify(body), {
    headers: {
      'content-type': 'application/json',
    },
    status,
  });

const createSmokeFetch = (notificationUrl) => {
  const notifications = [];

  const fetch = async (input, init = {}) => {
    const url = new URL(String(input));

    if (url.origin === notificationUrl) {
      const body = JSON.parse(String(init.body || '{}'));
      notifications.push(body);

      return jsonResponse({
        data: {
          jobId: `candidate-interview-notification-${notifications.length}`,
          queued: true,
          type: body.type,
        },
      });
    }

    return globalThis.__hireflipOriginalFetch(input, init);
  };

  return {
    fetch,
    notifications,
  };
};

const deleteNotificationEventsForEmail = async (strapi, email) => {
  const events = await documents(strapi, 'api::notification-event.notification-event')
    .findMany({
      filters: {
        recipientEmail: email,
      },
      limit: 100,
    })
    .catch(() => []);

  for (const event of events) {
    await deleteDocument(strapi, 'api::notification-event.notification-event', event.documentId);
  }
};

const createOfferFixture = async ({
  candidate,
  classArea,
  classRecord,
  contact,
  employer,
  enrollment,
  runId,
  strapi,
  suffix,
}) => {
  const request = await documents(strapi, 'api::interview-request.interview-request').create({
    data: {
      candidate: connect(candidate),
      candidateVisibleState: 'reviewing_options',
      claimedInterviewCount: 1,
      class: connect(classRecord),
      enrollment: connect(enrollment),
      fulfilledInterviewCount: 1,
      region: connect(classArea),
      requestState: 'slot_options_submitted',
      requestedInterviewCount: 1,
      responseSlaWorkingDays: 2,
    },
    populate: ['candidate', 'class', 'enrollment', 'region'],
  });
  const claim = await documents(strapi, 'api::employer-capacity-claim.employer-capacity-claim').create({
    data: {
      claimCount: 1,
      claimState: 'fulfilled',
      employer: connect(employer),
      employerContact: connect(contact),
      fulfilledAt: new Date().toISOString(),
      interviewRequest: connect(request),
      region: connect(classArea),
      releaseReason: 'slot_options_submitted',
    },
    populate: ['employer', 'employerContact', 'interviewRequest', 'region'],
  });
  const offer = await documents(strapi, 'api::interview-slot-offer.interview-slot-offer').create({
    data: {
      candidate: connect(candidate),
      candidateNotifiedAt: new Date().toISOString(),
      candidateResponseDeadline: addWorkingDays(2, 16),
      capacityClaim: connect(claim),
      employer: connect(employer),
      employerContact: connect(contact),
      enrollment: connect(enrollment),
      interviewRequest: connect(request),
      metadata: {
        smokeRunId: runId,
        suffix,
      },
      offerState: 'sent',
    },
    populate: ['candidate', 'capacityClaim', 'employer', 'employerContact', 'enrollment', 'interviewRequest'],
  });
  const slots = [];

  for (const [index, locationType] of ['in_person', 'online', 'in_person'].entries()) {
    const start = addWorkingDays(5 + index, 10 + index);
    const endDate = new Date(start);

    endDate.setUTCMinutes(endDate.getUTCMinutes() + 45);
    slots.push(
      await documents(strapi, 'api::interview-slot.interview-slot').create({
        data: {
          capacity: 1,
          employer: connect(employer),
          employerContact: connect(contact),
          endTime: endDate.toISOString(),
          locationType,
          metadata: {
            smokeRunId: runId,
            suffix,
          },
          slotOffer: connect(offer),
          slotState: 'offered',
          startTime: start,
        },
      })
    );
  }

  return {
    claim,
    offer,
    request,
    slots,
  };
};

const main = async () => {
  loadEnvFile();

  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  process.env.CANDIDATE_DASHBOARD_BASE_URL = 'http://localhost:3001';
  process.env.EMPLOYER_DASHBOARD_BASE_URL = 'http://localhost:3004';
  process.env.NOTIFICATION_SERVICE_URL = `https://candidate-interview-smoke-${runId}.example.test`;
  process.env.NOTIFICATION_SERVICE_TOKEN = 'candidate-interview-smoke-token';

  const smokeFetch = createSmokeFetch(process.env.NOTIFICATION_SERVICE_URL);

  globalThis.__hireflipOriginalFetch = global.fetch;
  global.fetch = smokeFetch.fetch;

  const appContext = await compileStrapi();
  const strapi = await createStrapi(appContext).load();
  const created = {
    candidate: null,
    classArea: null,
    classRecord: null,
    contact: null,
    employer: null,
    enrollment: null,
    fixtures: [],
  };

  try {
    const candidateService = strapi.service('api::candidate.candidate');
    const now = new Date().toISOString();

    created.classArea = await documents(strapi, 'api::class-area.class-area').create({
      data: {
        name: `Candidate Interview Smoke Area ${runId}`,
        slug: `candidate-interview-smoke-area-${runId}`.replace(/[^a-zA-Z0-9-]/g, '-'),
        state: 'active',
      },
    });
    created.classRecord = await documents(strapi, 'api::class.class').create({
      data: {
        capacity: 1,
        classArea: connect(created.classArea),
        currency: 'GBP',
        displayTitle: `Candidate Interview Smoke Class ${runId}`,
        interviewsGuaranteed: 1,
        name: `Candidate Interview Smoke Class ${runId}`,
        officialClassCode: `CIS-${runId}`.slice(0, 40),
        state: 'interview_window',
        year: 2026,
      },
      populate: ['classArea'],
    });
    created.candidate = await documents(strapi, 'api::candidate.candidate').create({
      data: {
        accountOnboardingCompletedAt: now,
        accountRestrictionStatus: 'active',
        authIdentityId: `auth0|candidate-interview-smoke-${runId}`,
        authProvider: 'auth0',
        candidateState: 'enrolled',
        email: `candidate-interview-smoke-${runId}@example.test`,
        firstName: 'Interview',
        lastName: 'Smoke',
        marketingConsentState: 'opted_out',
        notificationPreferences: {
          channels: {
            email: true,
            sms: true,
          },
        },
        phone: '+447700900123',
        preferredCommunicationChannel: 'email',
      },
    });
    created.enrollment = await documents(strapi, 'api::enrollment.enrollment').create({
      data: {
        beganClassAt: now,
        candidate: connect(created.candidate),
        class: connect(created.classRecord),
        completionStatus: 'completed',
        enrollmentState: 'interview_phase',
        passStatus: 'passed',
        paymentStatus: 'paid',
      },
      populate: ['candidate', 'class'],
    });
    created.employer = await documents(strapi, 'api::employer.employer').create({
      data: {
        commitmentMode: 'global',
        companyName: `Candidate Interview Smoke Employer ${runId}`,
        dashboardOnboardingState: 'complete',
        employerState: 'active',
        interviewCommitmentCadence: 'quarterly',
        interviewCommitmentVolume: 5,
        operatingRegions: connect(created.classArea),
      },
      populate: ['operatingRegions'],
    });
    created.contact = await documents(strapi, 'api::employer-contact.employer-contact').create({
      data: {
        accountCreatedAt: now,
        authIdentityId: `auth0|candidate-interview-employer-smoke-${runId}`,
        authProvider: 'auth0',
        contactRole: 'lead_contact',
        contactState: 'active',
        coverageConfirmedAt: now,
        coverageRegions: connect(created.classArea),
        email: `candidate-interview-employer-smoke-${runId}@example.test`,
        employer: connect(created.employer),
        firstName: 'Employer',
        lastName: 'Smoke',
      },
      populate: ['coverageRegions', 'employer'],
    });

    const auth = {
      subject: created.candidate.authIdentityId,
      type: 'auth0',
    };
    const firstFixture = await createOfferFixture({
      candidate: created.candidate,
      classArea: created.classArea,
      classRecord: created.classRecord,
      contact: created.contact,
      employer: created.employer,
      enrollment: created.enrollment,
      runId,
      strapi,
      suffix: 'warning',
    });

    created.fixtures.push(firstFixture);

    const initialState = await candidateService.getCurrentCandidateInterviewSlotOffers(auth, {
      requestId: `candidate-interview-smoke-${runId}`,
    });

    assert(initialState.activeOffer?.documentId === firstFixture.offer.documentId, 'Expected active slot offer.');
    assert(initialState.activeOffer.slots.length === 3, 'Expected three candidate slot options.');

    const warningDecline = await candidateService.declineCurrentCandidateInterviewSlotOffer(
      auth,
      firstFixture.offer.documentId,
      {
        declineNote: 'I cannot make any of these options because of a family emergency.',
        declineReason: 'health_or_family_emergency',
      },
      {
        requestId: `candidate-interview-smoke-${runId}`,
      }
    );

    assert(warningDecline.warningState === 'warning_sent', 'Expected first decline to send a warning.');
    assert(!warningDecline.strike, 'Expected first decline not to create a strike.');

    const releasedClaim = await documents(strapi, 'api::employer-capacity-claim.employer-capacity-claim').findMany({
      filters: {
        documentId: firstFixture.claim.documentId,
      },
      limit: 1,
    });

    assert(releasedClaim[0]?.claimState === 'released', 'Expected candidate decline to release capacity claim.');

    const secondFixture = await createOfferFixture({
      candidate: created.candidate,
      classArea: created.classArea,
      classRecord: created.classRecord,
      contact: created.contact,
      employer: created.employer,
      enrollment: created.enrollment,
      runId,
      strapi,
      suffix: 'strike',
    });

    created.fixtures.push(secondFixture);

    const strikeDecline = await candidateService.declineCurrentCandidateInterviewSlotOffer(
      auth,
      secondFixture.offer.documentId,
      {
        declineNote: 'I cannot make these options because another interview now overlaps.',
        declineReason: 'another_interview',
      },
      {
        requestId: `candidate-interview-smoke-${runId}`,
      }
    );

    assert(strikeDecline.warningState === 'strike_applied', 'Expected repeat decline to apply a strike.');
    assert(strikeDecline.strike?.strikeNumber === 1, 'Expected first strike number.');

    const thirdFixture = await createOfferFixture({
      candidate: created.candidate,
      classArea: created.classArea,
      classRecord: created.classRecord,
      contact: created.contact,
      employer: created.employer,
      enrollment: created.enrollment,
      runId,
      strapi,
      suffix: 'accept',
    });

    created.fixtures.push(thirdFixture);

    const acceptance = await candidateService.acceptCurrentCandidateInterviewSlotOffer(
      auth,
      thirdFixture.offer.documentId,
      {
        formatPreference: 'in_person',
        slotDocumentId: thirdFixture.slots[0].documentId,
      },
      {
        requestId: `candidate-interview-smoke-${runId}`,
      }
    );

    assert(acceptance.accepted === true, 'Expected candidate slot acceptance.');
    assert(
      acceptance.interview?.state === 'awaiting_employer_details',
      'Expected accepted slot to wait for employer details.'
    );
    assert(
      smokeFetch.notifications.some((notification) => notification.type === 'employer_interview_details_required'),
      'Expected employer interview setup notification.'
    );

    const employerDashboardService = strapi.service('api::employer-dashboard.employer-dashboard');
    const employerIdentity = {
      authIdentityId: created.contact.authIdentityId,
      email: created.contact.email,
    };
    const interviewDocumentId = acceptance.interview?.documentId;

    assert(interviewDocumentId, 'Expected accepted interview document id.');

    const detailBeforeSetup = await employerDashboardService.getInterviewDetail({
      ...employerIdentity,
      interviewDocumentId,
    });

    assert(
      detailBeforeSetup.interview?.state === 'awaiting_employer_details',
      'Expected employer interview detail page to show setup needed.'
    );

    const confirmedDetail = await employerDashboardService.updateInterviewSetup(
      {
        ...employerIdentity,
        arrivalInstructions: 'Ask for the interview team at reception.',
        candidateInstructions: 'Bring photo ID and arrive five minutes early.',
        employerContactDocumentId: created.contact.documentId,
        interviewDocumentId,
        interviewerName: 'Employer Smoke',
        locationDetails: 'HireFlip Smoke Office, 1 Test Street, London',
        locationType: 'in_person',
      },
      {
        requestId: `candidate-interview-smoke-${runId}`,
      }
    );

    assert(confirmedDetail.interview?.state === 'confirmed', 'Expected employer setup to confirm the interview.');
    assert(
      smokeFetch.notifications.some((notification) => notification.type === 'candidate_interview_details_updated'),
      'Expected candidate interview detail notification.'
    );

    const confirmedCandidateState = await candidateService.getCurrentCandidateInterviewSlotOffers(auth, {
      requestId: `candidate-interview-smoke-${runId}`,
    });

    assert(
      confirmedCandidateState.activeOffer?.selectedInterview?.detailsPending === false,
      'Expected candidate dashboard to reveal confirmed details.'
    );
    assert(
      confirmedCandidateState.activeOffer?.selectedInterview?.locationDetails ===
        'HireFlip Smoke Office, 1 Test Street, London',
      'Expected candidate dashboard to include confirmed location details.'
    );

    console.log('Candidate interview slot smoke passed.');
  } finally {
    global.fetch = globalThis.__hireflipOriginalFetch;

    await deleteNotificationEventsForEmail(strapi, created.candidate?.email);
    await deleteNotificationEventsForEmail(strapi, created.contact?.email);

    const strikes = created.candidate?.documentId
      ? await documents(strapi, 'api::candidate-interview-strike.candidate-interview-strike').findMany({
          filters: {
            candidate: {
              documentId: created.candidate.documentId,
            },
          },
          limit: 100,
        })
      : [];
    const interviews = created.candidate?.documentId
      ? await documents(strapi, 'api::interview.interview').findMany({
          filters: {
            candidate: {
              documentId: created.candidate.documentId,
            },
          },
          limit: 100,
        })
      : [];

    for (const strike of strikes) {
      await deleteDocument(strapi, 'api::candidate-interview-strike.candidate-interview-strike', strike.documentId);
    }

    for (const interview of interviews) {
      await deleteDocument(strapi, 'api::interview.interview', interview.documentId);
    }

    for (const fixture of created.fixtures.reverse()) {
      for (const slot of fixture.slots || []) {
        await deleteDocument(strapi, 'api::interview-slot.interview-slot', slot.documentId);
      }

      await deleteDocument(strapi, 'api::interview-slot-offer.interview-slot-offer', fixture.offer?.documentId);
      await deleteDocument(strapi, 'api::employer-capacity-claim.employer-capacity-claim', fixture.claim?.documentId);
      await deleteDocument(strapi, 'api::interview-request.interview-request', fixture.request?.documentId);
    }

    await deleteDocument(strapi, 'api::enrollment.enrollment', created.enrollment?.documentId);
    await deleteDocument(strapi, 'api::employer-contact.employer-contact', created.contact?.documentId);
    await deleteDocument(strapi, 'api::employer.employer', created.employer?.documentId);
    await deleteDocument(strapi, 'api::candidate.candidate', created.candidate?.documentId);
    await deleteDocument(strapi, 'api::class.class', created.classRecord?.documentId);
    await deleteDocument(strapi, 'api::class-area.class-area', created.classArea?.documentId);

    await strapi.destroy();
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

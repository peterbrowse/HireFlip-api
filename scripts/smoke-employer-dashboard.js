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

const addDays = (days, hour = 10) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  date.setUTCHours(hour, 0, 0, 0);
  return date.toISOString();
};

const main = async () => {
  loadEnvFile();

  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const appContext = await compileStrapi();
  const strapi = await createStrapi(appContext).load();
  const created = {
    candidate: null,
    employer: null,
    employerContact: null,
    employerInvite: null,
    enrollment: null,
    feedback: null,
    invitedEmployer: null,
    invitedEmployerContact: null,
    interview: null,
    progressionRequest: null,
    slotOffer: null,
    slots: [],
  };

  try {
    const employerDashboardService = strapi.service('api::employer-dashboard.employer-dashboard');
    const inviteToken = randomBytes(32).toString('base64url');
    const invitedEmployer = await documents(strapi, 'api::employer.employer').create({
      data: {
        assignmentMode: 'automatic',
        companyName: `Invited Employer Smoke ${runId}`,
        employerState: 'invited',
        interviewCommitmentCadence: 'quarterly',
        interviewCommitmentVolume: 3,
        region: 'Manchester',
      },
    });
    const invitedEmployerContact = await documents(strapi, 'api::employer-contact.employer-contact').create({
      data: {
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
        authIdentityId: `auth0|invited-employer-dashboard-smoke-${runId}`,
        email: invitedEmployerContact.email,
      });
    } catch (error) {
      rejectedUnacceptedOverview = true;
    }

    assert(rejectedUnacceptedOverview, 'Expected unaccepted employer invite to be blocked.');

    let rejectedMismatchedEmail = false;

    try {
      await employerDashboardService.acceptInvite({
        authIdentityId: `auth0|invited-employer-dashboard-smoke-${runId}`,
        email: `wrong-employer-dashboard-smoke-${runId}@example.test`,
        inviteToken,
      });
    } catch (error) {
      rejectedMismatchedEmail = true;
    }

    assert(rejectedMismatchedEmail, 'Expected mismatched invited email to be rejected.');

    const acceptedInvite = await employerDashboardService.acceptInvite({
      authIdentityId: `auth0|invited-employer-dashboard-smoke-${runId}`,
      email: invitedEmployerContact.email,
      inviteToken,
      name: 'Invited Employer',
    });

    assert(acceptedInvite.accepted === true, 'Expected employer invite to be accepted.');
    assert(acceptedInvite.account.companyName === invitedEmployer.companyName, 'Expected accepted account.');

    const acceptedOverview = await employerDashboardService.getOverview({
      authIdentityId: `auth0|invited-employer-dashboard-smoke-${runId}`,
      email: invitedEmployerContact.email,
    });

    assert(
      acceptedOverview.account.companyName === invitedEmployer.companyName,
      'Expected accepted invited employer to access overview.'
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
        employerState: 'active',
        interviewCommitmentCadence: 'quarterly',
        interviewCommitmentVolume: 5,
        region: 'London',
      },
    });
    const employerContact = await documents(strapi, 'api::employer-contact.employer-contact').create({
      data: {
        accountCreatedAt: new Date().toISOString(),
        authIdentityId: `auth0|employer-dashboard-smoke-${runId}`,
        authProvider: 'auth0',
        contactState: 'active',
        email: `employer-dashboard-smoke-${runId}@example.test`,
        employer: connect(employer),
        firstName: 'Employer',
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
    const enrollment = await documents(strapi, 'api::enrollment.enrollment').create({
      data: {
        candidate: connect(candidate),
        completionStatus: 'completed',
        enrollmentState: 'interview_phase',
        interviewGuaranteeDeadline: addDays(90),
        interviewGuaranteeWindowStartsAt: new Date().toISOString(),
        passStatus: 'passed',
        paymentStatus: 'paid',
        qualifyingInterviewsDeliveredCount: 0,
      },
      populate: ['candidate'],
    });

    created.employer = employer;
    created.employerContact = employerContact;
    created.candidate = candidate;
    created.enrollment = enrollment;

    const initialOverview = await employerDashboardService.getOverview({
      email: employerContact.email,
    });

    assert(initialOverview.account.companyName === employer.companyName, 'Expected overview company name.');
    assert(initialOverview.summary.availableSlots === 0, 'Expected no available slots initially.');

    let rejectedShortOffer = false;

    try {
      await employerDashboardService.createInterviewSlotOffer({
        candidateDocumentId: candidate.documentId,
        email: employerContact.email,
        enrollmentDocumentId: enrollment.documentId,
        slots: [
          {
            endTime: addDays(8, 11),
            locationType: 'online',
            meetingUrl: 'https://example.test/interview-one',
            startTime: addDays(8, 10),
          },
          {
            endTime: addDays(9, 12),
            locationType: 'online',
            meetingUrl: 'https://example.test/interview-two',
            startTime: addDays(9, 11),
          },
        ],
      });
    } catch (error) {
      rejectedShortOffer = true;
    }

    assert(rejectedShortOffer, 'Expected 2-slot offer to be rejected.');

    const slotOfferResult = await employerDashboardService.createInterviewSlotOffer({
      candidateDocumentId: candidate.documentId,
      email: employerContact.email,
      enrollmentDocumentId: enrollment.documentId,
      internalNote: 'Smoke test 3-option slot offer.',
      slots: [
        {
          endTime: addDays(8, 11),
          locationType: 'online',
          meetingUrl: 'https://example.test/interview-one',
          startTime: addDays(8, 10),
        },
        {
          endTime: addDays(9, 12),
          locationType: 'phone',
          startTime: addDays(9, 11),
        },
        {
          endTime: addDays(10, 15),
          locationDetails: 'Smoke test office',
          locationType: 'in_person',
          startTime: addDays(10, 14),
        },
      ],
    });

    assert(slotOfferResult.created === true, 'Expected slot offer to be created.');
    assert(slotOfferResult.offer.slots.length === 3, 'Expected exactly 3 slot records.');

    created.slotOffer = { documentId: slotOfferResult.offer.documentId };
    created.slots = slotOfferResult.offer.slots;

    const overviewWithSlots = await employerDashboardService.getOverview({
      authIdentityId: employerContact.authIdentityId,
    });

    assert(overviewWithSlots.summary.availableSlots === 3, 'Expected 3 available slot options.');
    assert(overviewWithSlots.availabilityRequests.length === 1, 'Expected one availability request.');
    assert(
      overviewWithSlots.availabilityRequests[0].candidateName === 'Candidate Smoke',
      'Expected availability request candidate name.'
    );

    const interview = await documents(strapi, 'api::interview.interview').create({
      data: {
        candidate: connect(candidate),
        completedAt: addDays(-1, 11),
        countsTowardGuarantee: false,
        employer: connect(employer),
        employerContact: connect(employerContact),
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
        employer: connect(employer),
        interview: connect(interview),
        progressionState: 'requested',
        requestedByEmployerContact: connect(employerContact),
        requestedDetailsAt: new Date().toISOString(),
      },
      populate: ['candidate', 'employer', 'interview', 'requestedByEmployerContact'],
    });

    created.interview = interview;
    created.progressionRequest = progressionRequest;

    const overviewWithFeedbackDue = await employerDashboardService.getOverview({
      email: employerContact.email,
    });

    assert(overviewWithFeedbackDue.summary.feedbackDue === 1, 'Expected one feedback request.');
    assert(
      overviewWithFeedbackDue.summary.progressionRequests === 1,
      'Expected one progression request.'
    );

    const feedback = await documents(strapi, 'api::interview-feedback.interview-feedback').create({
      data: {
        interview: connect(interview),
        nextStep: 'Progress internally.',
        notes: 'Smoke employer feedback.',
        outcome: 'progressing',
        rating: 5,
        submittedAt: new Date().toISOString(),
        submittedById: employerContact.documentId,
        submittedByType: 'employer_contact',
      },
      populate: ['interview'],
    });

    created.feedback = feedback;

    const overviewAfterFeedback = await employerDashboardService.getOverview({
      email: employerContact.email,
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
    await deleteDocument(strapi, 'api::enrollment.enrollment', created.enrollment?.documentId);
    await deleteDocument(strapi, 'api::employer-contact.employer-contact', created.employerContact?.documentId);
    await deleteDocument(strapi, 'api::employer.employer', created.employer?.documentId);
    await deleteDocument(strapi, 'api::candidate.candidate', created.candidate?.documentId);
    await deleteDocument(strapi, 'api::employer-invite.employer-invite', created.employerInvite?.documentId);
    await deleteDocument(strapi, 'api::employer-contact.employer-contact', created.invitedEmployerContact?.documentId);
    await deleteDocument(strapi, 'api::employer.employer', created.invitedEmployer?.documentId);
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

#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { compileStrapi, createStrapi } = require('@strapi/strapi');

process.env.CLASS_WORKFLOW_BOOTSTRAP_ENABLED = 'false';

const { documents } = require('./lib/strapi-documents');

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const connect = (record) => ({ connect: [{ documentId: record.documentId }] });
const isoFromNow = (days, hours = 0) =>
  new Date(Date.now() + (days * 24 + hours) * 60 * 60 * 1000).toISOString();

const main = async () => {
  const databaseFilename = `.tmp/guarantee-refund-smoke-${process.pid}-${Date.now()}.db`;
  const databasePath = path.resolve(process.cwd(), databaseFilename);

  delete process.env.DATABASE_URL;
  process.env.DATABASE_CLIENT = 'sqlite';
  process.env.DATABASE_FILENAME = databaseFilename;

  const appContext = await compileStrapi();
  const strapi = await createStrapi(appContext).load();
  const originalService = strapi.service.bind(strapi);
  const session = {
    user: {
      displayName: 'Guarantee Refund Smoke Admin',
      email: 'guarantee-refund-admin@example.test',
      id: 'guarantee-refund-smoke-admin',
      roleKeys: ['admin'],
      roles: ['Admin'],
    },
  };

  strapi.service = (uid) => {
    if (uid === 'api::admin-auth.admin-auth') {
      return { getSession: async () => session };
    }

    if (uid === 'api::admin-review-claim.admin-review-claim') {
      return {
        activeClaimsForSession: async () => new Map(),
        claimForSession: async () => ({
          reviewClaim: { claimToken: 'c'.repeat(32) },
        }),
      };
    }

    return originalService(uid);
  };

  const classRecord = await documents(strapi, 'api::class.class').create({
    data: {
      capacity: 30,
      currency: 'GBP',
      displayTitle: 'Guarantee Refund Smoke Class',
      interviewsGuaranteed: 2,
      name: `Guarantee Refund Smoke Class ${Date.now()}`,
      officialClassCode: `GRS-${Date.now()}`,
      state: 'completed',
    },
  });

  const createScenario = async ({
    deadlineDays = -1,
    deliveredInterviews,
    eligibilityState = 'not_assessed',
    label,
  }) => {
    const now = new Date().toISOString();
    const candidate = await documents(strapi, 'api::candidate.candidate').create({
      data: {
        accountOnboardingCompletedAt: now,
        accountRestrictionStatus: 'active',
        authIdentityId: `auth0|guarantee-${label}-${Date.now()}`,
        authProvider: 'auth0',
        candidateState: 'interview_phase',
        email: `guarantee-${label}-${Date.now()}@example.test`,
        firstName: 'Guarantee',
        lastName: label,
        marketingConsentState: 'opted_out',
        preferredCommunicationChannel: 'email',
      },
    });
    const enrollment = await documents(strapi, 'api::enrollment.enrollment').create({
      data: {
        candidate: connect(candidate),
        class: connect(classRecord),
        completedAt: isoFromNow(-91),
        completionStatus: 'completed',
        enrollmentState: 'interview_phase',
        interviewGuaranteeDeadline: isoFromNow(deadlineDays),
        interviewGuaranteeWindowStartsAt: isoFromNow(-91),
        passStatus: 'passed',
        passedAt: isoFromNow(-91),
        paymentStatus: 'paid',
        qualifyingInterviewsDeliveredCount: 0,
        refundEligibilityState: eligibilityState,
      },
      populate: ['candidate', 'class'],
    });
    const payment = await documents(strapi, 'api::payment.payment').create({
      data: {
        amountPence: 32000,
        candidate: connect(candidate),
        createdByService: 'guarantee-refund-smoke',
        currency: 'GBP',
        enrollment: connect(enrollment),
        paidAt: isoFromNow(-100),
        paymentProvider: 'stripe',
        paymentState: 'paid',
        paymentType: 'course_payment',
        providerCheckoutSessionId: `cs_guarantee_${label}_${Date.now()}`,
        providerPaymentIntentId: `pi_guarantee_${label}_${Date.now()}`,
      },
      populate: ['candidate', 'enrollment'],
    });

    for (let index = 0; index < deliveredInterviews; index += 1) {
      await documents(strapi, 'api::interview.interview').create({
        data: {
          candidate: connect(candidate),
          completedAt: isoFromNow(-10 - index),
          confirmedAt: isoFromNow(-12 - index),
          countsTowardGuarantee: true,
          enrollment: connect(enrollment),
          interviewState: 'completed',
          locationType: 'online',
          scheduledEndTime: isoFromNow(-10 - index, 1),
          scheduledStartTime: isoFromNow(-10 - index),
        },
      });
    }

    return { candidate, enrollment, payment };
  };

  try {
    const zero = await createScenario({ deliveredInterviews: 0, label: 'Zero' });
    const one = await createScenario({ deliveredInterviews: 1, label: 'One' });
    const two = await createScenario({ deliveredInterviews: 2, label: 'Two' });
    const future = await createScenario({
      deadlineDays: 1,
      deliveredInterviews: 0,
      label: 'Future',
    });
    const forfeited = await createScenario({
      deliveredInterviews: 0,
      eligibilityState: 'forfeited',
      label: 'Forfeited',
    });

    await documents(strapi, 'api::candidate-profile.candidate-profile').create({
      data: {
        availabilityConfirmedAt: isoFromNow(-15),
        availabilityExpiresAt: isoFromNow(15),
        candidate: connect(zero.candidate),
        completedAt: isoFromNow(-40),
        profileState: 'completed',
        readinessOverviewAcknowledgedAt: isoFromNow(-40),
        recruitmentPlatformVisibility: 'hidden',
      },
    });

    const service = strapi.service('api::admin-refund.admin-refund');
    const first = await service.reconcileExpiredGuaranteeRefunds(100, {
      requestId: 'guarantee-refund-smoke:first',
      serviceName: 'guarantee-refund-smoke',
    });

    assert(first.total === 3, 'Expected only expired, assessable enrollments to be selected.');
    assert(first.created === 2, 'Expected zero- and one-interview refund reviews.');
    assert(first.notEligible === 1, 'Expected the fulfilled guarantee to be closed without refund.');
    assert(first.failed === 0, 'Expected the initial reconciliation to complete without errors.');

    const guaranteeRefunds = await documents(strapi, 'api::refund.refund').findMany({
      filters: { eligibilitySource: 'interview_guarantee' },
      populate: ['enrollment', 'payment'],
      sort: ['refundPercentage:desc'],
    });
    assert(guaranteeRefunds.length === 2, 'Expected exactly two guarantee refund records.');
    const fifty = guaranteeRefunds.find((refund) => Number(refund.refundPercentage) === 50);
    const twentyFive = guaranteeRefunds.find((refund) => Number(refund.refundPercentage) === 25);

    assert(fifty?.amountPence === 16000, 'Expected 50% of the GBP 320 payment.');
    assert(twentyFive?.amountPence === 8000, 'Expected 25% of the GBP 320 payment.');
    assert(
      fifty?.idempotencyKey === `interview-guarantee:${zero.enrollment.documentId}`,
      'Expected a deterministic guarantee refund idempotency key.'
    );
    assert(
      twentyFive?.idempotencyKey === `interview-guarantee:${one.enrollment.documentId}`,
      'Expected the one-interview review to use its enrollment idempotency key.'
    );

    const [updatedZero, updatedOne, updatedTwo, updatedFuture, updatedForfeited] =
      await Promise.all(
        [zero, one, two, future, forfeited].map(async (scenario) => {
          const records = await documents(strapi, 'api::enrollment.enrollment').findMany({
            filters: { documentId: scenario.enrollment.documentId },
            limit: 1,
          });
          return records[0];
        })
      );

    assert(updatedZero.refundEligibilityState === 'refund_requested', 'Expected zero-interview review state.');
    assert(updatedOne.refundEligibilityState === 'refund_requested', 'Expected one-interview review state.');
    assert(updatedOne.qualifyingInterviewsDeliveredCount === 1, 'Expected real interview count to persist.');
    assert(updatedTwo.refundEligibilityState === 'not_eligible', 'Expected two interviews to fulfil the guarantee.');
    assert(updatedTwo.qualifyingInterviewsDeliveredCount === 2, 'Expected fulfilled interview count to persist.');
    assert(updatedFuture.refundEligibilityState === 'not_assessed', 'Expected future guarantees to remain untouched.');
    assert(updatedForfeited.refundEligibilityState === 'forfeited', 'Expected forfeiture to remain final.');

    const second = await service.reconcileExpiredGuaranteeRefunds(100, {
      requestId: 'guarantee-refund-smoke:repeat',
      serviceName: 'guarantee-refund-smoke',
    });
    assert(second.total === 0, 'Expected a repeat run to have no completed work left.');

    const listed = await service.listReviews({
      page: 1,
      pageSize: 25,
      reviewType: 'refund_request',
      search: zero.enrollment.documentId,
      sessionToken: 's'.repeat(32),
    });
    assert(listed.pagination.total === 1, 'Expected the automatic refund to surface in admin search.');
    const listedReview = listed.reviews[0];
    assert(listedReview.refund.refundPercentage === 50, 'Expected the proposed percentage in admin review.');

    const detail = await service.getReviewDetail({
      page: 1,
      pageSize: 25,
      priority: 'all',
      reviewType: 'all',
      search: '',
      sessionToken: 's'.repeat(32),
      taskKey: listedReview.taskKey,
    });
    assert(
      detail.review.evidence.decisionTree.some((item) => item.key === 'interview_readiness'),
      'Expected interview-readiness evidence in the admin decision tree.'
    );
    assert(
      detail.review.evidence.decisionTree.some((item) => item.key === 'candidate_availability'),
      'Expected availability evidence in the admin decision tree.'
    );

    const race = await createScenario({ deliveredInterviews: 0, label: 'Race' });
    await Promise.all([
      service.reconcileExpiredGuaranteeRefunds(100, {
        requestId: 'guarantee-refund-smoke:race-a',
        serviceName: 'guarantee-refund-smoke',
      }),
      service.reconcileExpiredGuaranteeRefunds(100, {
        requestId: 'guarantee-refund-smoke:race-b',
        serviceName: 'guarantee-refund-smoke',
      }),
    ]);
    const raceRefunds = await documents(strapi, 'api::refund.refund').findMany({
      filters: {
        enrollment: { documentId: race.enrollment.documentId },
        eligibilitySource: 'interview_guarantee',
      },
    });
    assert(raceRefunds.length === 1, 'Expected concurrent workers to create one refund review.');

    const chaos = await createScenario({ deliveredInterviews: 1, label: 'Chaos' });
    const enrollmentDocuments = strapi.documents('api::enrollment.enrollment');
    const originalEnrollmentUpdate = enrollmentDocuments.update.bind(enrollmentDocuments);
    let injectedFailure = false;

    enrollmentDocuments.update = async (input) => {
      if (
        !injectedFailure &&
        input.documentId === chaos.enrollment.documentId &&
        input.data?.refundEligibilityState === 'refund_requested'
      ) {
        injectedFailure = true;
        throw new Error('Injected enrollment update failure.');
      }

      return originalEnrollmentUpdate(input);
    };

    const failedRun = await service.reconcileExpiredGuaranteeRefunds(100, {
      requestId: 'guarantee-refund-smoke:chaos',
      serviceName: 'guarantee-refund-smoke',
    });
    enrollmentDocuments.update = originalEnrollmentUpdate;

    assert(injectedFailure, 'Expected the partial-write failure to be injected.');
    assert(failedRun.failed === 1, 'Expected the partial write to be reported as failed.');

    const recoveredRun = await service.reconcileExpiredGuaranteeRefunds(100, {
      requestId: 'guarantee-refund-smoke:recovery',
      serviceName: 'guarantee-refund-smoke',
    });
    assert(
      recoveredRun.existing === 1,
      `Expected retry to recover the existing refund review: ${JSON.stringify(recoveredRun)}`
    );
    const chaosRefunds = await documents(strapi, 'api::refund.refund').findMany({
      filters: {
        enrollment: { documentId: chaos.enrollment.documentId },
        eligibilitySource: 'interview_guarantee',
      },
    });
    assert(chaosRefunds.length === 1, 'Expected recovery without a duplicate refund.');

    const auditEvents = await documents(strapi, 'api::audit-event.audit-event').findMany({
      filters: {
        eventType: 'refund.guarantee_review_created',
      },
    });
    assert(auditEvents.length === 4, 'Expected one review-created audit event per refund.');

    console.log('Guarantee refund reconciliation smoke passed.');
  } finally {
    await strapi.destroy();
    for (const suffix of ['', '-shm', '-wal']) {
      fs.rmSync(`${databasePath}${suffix}`, { force: true });
    }
  }
};

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

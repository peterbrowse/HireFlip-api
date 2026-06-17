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

const findOneByDocumentId = async (strapi, uid, documentId, populate = []) => {
  const records = await documents(strapi, uid).findMany({
    filters: {
      documentId,
    },
    limit: 1,
    populate,
  });

  return records[0];
};

const progressRecordsForEnrollment = (strapi, enrollmentDocumentId) =>
  documents(strapi, 'api::course-progress.course-progress').findMany({
    filters: {
      enrollment: {
        documentId: enrollmentDocumentId,
      },
    },
    limit: 20,
  });

const createAppealFixture = async ({
  classRecord,
  course,
  courseTest,
  question,
  runId,
  strapi,
  suffix,
}) => {
  const submittedAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const deadline = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const candidate = await documents(strapi, 'api::candidate.candidate').create({
    data: {
      accountOnboardingCompletedAt: submittedAt,
      accountRestrictionStatus: 'active',
      authIdentityId: `auth0|assessment-appeal-smoke-${runId}-${suffix}`,
      authProvider: 'auth0',
      candidateState: 'failed',
      email: `assessment-appeal-smoke-${runId}-${suffix}@example.test`,
      firstName: `Appeal ${suffix}`,
      lastName: 'Smoke',
      marketingConsentState: 'opted_out',
      preferredCommunicationChannel: 'email',
    },
  });
  const enrollment = await documents(strapi, 'api::enrollment.enrollment').create({
    data: {
      beganClassAt: submittedAt,
      candidate: connect(candidate),
      class: connect(classRecord),
      completionStatus: 'missed_deadline',
      courseCompletionDeadline: deadline,
      enrollmentState: 'failed',
      passStatus: 'failed',
      paymentStatus: 'paid',
    },
    populate: ['candidate', 'class'],
  });
  const attempt = await documents(strapi, 'api::course-test-attempt.course-test-attempt').create({
    data: {
      attemptNumber: 3,
      attemptState: 'failed',
      candidate: connect(candidate),
      courseTest: connect(courseTest),
      enrollment: connect(enrollment),
      maxScore: 1,
      metadata: {
        smokeRunId: runId,
      },
      passed: false,
      passMarkSnapshot: 70,
      retryEligibilityState: 'exhausted',
      retryType: 'conditional_retry',
      score: 0,
      submittedAt,
    },
    populate: ['candidate', 'courseTest', 'enrollment'],
  });
  const answer = await documents(strapi, 'api::course-answer-submission.course-answer-submission').create({
    data: {
      answerPayload: {
        selectedOptionIds: ['wrong'],
      },
      candidate: connect(candidate),
      courseQuestion: connect(question),
      courseTestAttempt: connect(attempt),
      feedback: 'The selected answer did not match the expected answer.',
      flagState: 'none',
      score: 0,
      submittedAt,
    },
  });
  const testResult = await documents(strapi, 'api::course-test-result.course-test-result').create({
    data: {
      attemptNumber: 3,
      candidate: connect(candidate),
      courseTest: connect(courseTest),
      courseTestAttempt: connect(attempt),
      decidedAt: submittedAt,
      enrollment: connect(enrollment),
      maxScore: 1,
      passed: false,
      passMarkSnapshot: 70,
      resultState: 'failed',
      retryEligibilityState: 'exhausted',
      score: 0,
    },
  });
  const courseResult = await documents(strapi, 'api::course-result.course-result').create({
    data: {
      candidate: connect(candidate),
      completionDeadline: deadline,
      course: connect(course),
      deadlineExtensionSeconds: 0,
      enrollment: connect(enrollment),
      resultState: 'failed',
      startedAt: submittedAt,
    },
  });
  const appeal = await documents(strapi, 'api::assessment-appeal.assessment-appeal').create({
    data: {
      appealState: 'submitted',
      candidate: connect(candidate),
      courseAnswerSubmission: connect(answer),
      courseTestAttempt: connect(attempt),
      enrollment: connect(enrollment),
      reason: 'Smoke test appeal: the candidate believes the selected answer was reviewed incorrectly.',
      submittedAt,
    },
    populate: ['candidate', 'courseTestAttempt', 'enrollment'],
  });

  return {
    answer,
    appeal,
    candidate,
    courseResult,
    deadline,
    enrollment,
    attempt,
    testResult,
  };
};

const main = async () => {
  loadEnvFile();

  process.env.NOTIFICATION_SERVICE_URL = 'https://notification-smoke.example.test';
  process.env.NOTIFICATION_SERVICE_TOKEN = 'smoke-notification-token';

  const capturedNotifications = [];
  const originalFetch = global.fetch;

  global.fetch = async (url, options) => {
    capturedNotifications.push({
      body: JSON.parse(options.body),
      headers: options.headers,
      method: options.method,
      url: String(url),
    });

    return {
      json: async () => ({
        data: {
          jobId: `assessment-appeal-smoke-job-${capturedNotifications.length}`,
          queued: true,
        },
      }),
      ok: true,
      status: 202,
    };
  };

  const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const appContext = await compileStrapi();
  const strapi = await createStrapi(appContext).load();
  const originalService = strapi.service.bind(strapi);
  const auditEvents = [];
  const session = {
    user: {
      displayName: 'Assessment Appeal Smoke Admin',
      email: 'assessment-appeal-admin@example.test',
      id: `assessment-appeal-admin-${runId}`,
      roleKeys: ['admin'],
      roles: ['Admin'],
    },
  };
  const created = {
    classRecord: null,
    course: null,
    courseModule: null,
    courseSection: null,
    courseTest: null,
    fixtures: [],
    question: null,
  };
  let claimAssertCount = 0;
  let claimCreateCount = 0;

  strapi.service = (uid) => {
    if (uid === 'api::admin-auth.admin-auth') {
      return {
        getSession: async () => session,
      };
    }

    if (uid === 'api::admin-review-claim.admin-review-claim') {
      return {
        assertActiveClaimForSession: async (input, claimSession) => {
          claimAssertCount += 1;
          assert(input.claimToken === 'c'.repeat(32), 'Expected review claim token to be checked.');
          assert(input.resourceType === 'assessment_appeal', 'Expected assessment appeal claim type.');
          assert(claimSession.user.id === session.user.id, 'Expected claim check to use the active session.');
        },
        claimForSession: async (input) => {
          claimCreateCount += 1;
          assert(input.resourceType === 'assessment_appeal', 'Expected assessment appeal claim type.');

          return {
            reviewClaim: {
              canTakeOver: false,
              claimToken: 'c'.repeat(32),
              claimedAt: new Date().toISOString(),
              claimedBy: {
                displayName: session.user.displayName,
                email: session.user.email,
                id: session.user.id,
                roleKeys: session.user.roleKeys,
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
          };
        },
      };
    }

    if (uid === 'api::audit-event.audit-event') {
      return {
        record: async (input) => {
          auditEvents.push(input);

          return {
            documentId: `assessment-appeal-smoke-audit-${auditEvents.length}`,
          };
        },
      };
    }

    return originalService(uid);
  };

  try {
    const course = await documents(strapi, 'api::course.course').create({
      data: {
        courseState: 'active',
        name: `Assessment Appeal Smoke Course ${runId}`,
        sourceType: 'internal',
        version: 'smoke',
      },
    });
    const courseSection = await documents(strapi, 'api::course-section.course-section').create({
      data: {
        course: connect(course),
        required: true,
        sectionState: 'active',
        sortOrder: 1,
        title: `Assessment Appeal Smoke Section ${runId}`,
      },
    });
    const courseModule = await documents(strapi, 'api::course-module.course-module').create({
      data: {
        courseSection: connect(courseSection),
        moduleState: 'active',
        required: true,
        sortOrder: 1,
        title: `Assessment Appeal Smoke Module ${runId}`,
      },
    });
    const courseTest = await documents(strapi, 'api::course-test.course-test').create({
      data: {
        attemptLimit: 3,
        copyPasteRestrictionEnabled: true,
        course: connect(course),
        courseModule: connect(courseModule),
        maxScore: 1,
        passMark: 70,
        questionRandomizationEnabled: false,
        testState: 'active',
        title: `Assessment Appeal Smoke Test ${runId}`,
      },
      populate: ['course', 'courseModule'],
    });
    const question = await documents(strapi, 'api::course-question.course-question').create({
      data: {
        correctAnswerPayload: {
          correctOptionIds: ['right'],
        },
        courseTest: connect(courseTest),
        options: [
          { id: 'wrong', label: 'Wrong answer' },
          { id: 'right', label: 'Right answer' },
        ],
        prompt: 'Which answer should pass?',
        questionState: 'active',
        questionType: 'single_choice',
        sortOrder: 1,
      },
    });
    const classRecord = await documents(strapi, 'api::class.class').create({
      data: {
        capacity: 2,
        course: connect(course),
        currency: 'GBP',
        displayTitle: `Assessment Appeal Smoke Class ${runId}`,
        interviewsGuaranteed: 2,
        name: `Assessment Appeal Smoke Class ${runId}`,
        officialClassCode: `AAS-${runId}`,
        openingMode: 'admin_immediate',
        state: 'in_progress',
        year: 2026,
        yearSequenceNumber: 1,
      },
      populate: ['course'],
    });

    created.classRecord = classRecord;
    created.course = course;
    created.courseModule = courseModule;
    created.courseSection = courseSection;
    created.courseTest = courseTest;
    created.question = question;

    const approvalFixture = await createAppealFixture({
      classRecord,
      course,
      courseTest,
      question,
      runId,
      strapi,
      suffix: 'approve',
    });
    const rejectionFixture = await createAppealFixture({
      classRecord,
      course,
      courseTest,
      question,
      runId,
      strapi,
      suffix: 'reject',
    });
    const lateSubmissionFixture = await createAppealFixture({
      classRecord,
      course,
      courseTest,
      question,
      runId,
      strapi,
      suffix: 'late',
    });

    created.fixtures.push(approvalFixture, rejectionFixture, lateSubmissionFixture);

    const oldDecisionAt = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();

    await Promise.all([
      documents(strapi, 'api::assessment-appeal.assessment-appeal').delete({
        documentId: lateSubmissionFixture.appeal.documentId,
      }),
      documents(strapi, 'api::enrollment.enrollment').update({
        documentId: lateSubmissionFixture.enrollment.documentId,
        data: {
          completionStatus: 'in_progress',
          enrollmentState: 'in_class',
          passStatus: 'failed',
        },
      }),
      documents(strapi, 'api::course-test-attempt.course-test-attempt').update({
        documentId: lateSubmissionFixture.attempt.documentId,
        data: {
          submittedAt: oldDecisionAt,
        },
      }),
      documents(strapi, 'api::course-test-result.course-test-result').update({
        documentId: lateSubmissionFixture.testResult.documentId,
        data: {
          decidedAt: oldDecisionAt,
        },
      }),
    ]);

    const appealService = strapi.service('api::admin-assessment-appeal.admin-assessment-appeal');
    const sessionToken = 's'.repeat(32);
    const reviewClaimToken = 'c'.repeat(32);
    const approvalTaskKey = `assessment-appeal:${approvalFixture.appeal.documentId}`;
    const rejectionTaskKey = `assessment-appeal:${rejectionFixture.appeal.documentId}`;
    const listResult = await appealService.listReviews(
      { sessionToken },
      { requestId: `assessment-appeal-smoke-list-${runId}` }
    );

    assert(listResult.counts.total >= 2, 'Expected active appeal reviews to be listed.');
    assert(
      listResult.reviews.some((review) => review.taskKey === approvalTaskKey),
      'Expected approval appeal task in review list.'
    );
    assert(
      listResult.reviews.some((review) => review.taskKey === rejectionTaskKey),
      'Expected rejection appeal task in review list.'
    );

    const detailResult = await appealService.getReviewDetail(
      {
        sessionToken,
        taskKey: approvalTaskKey,
      },
      { requestId: `assessment-appeal-smoke-detail-${runId}` }
    );

    assert(claimCreateCount === 1, 'Expected detail lookup to claim the appeal.');
    assert(detailResult.review.appeal.appealState === 'under_review', 'Expected detail lookup to mark appeal under review.');
    assert(detailResult.review.answers.length === 1, 'Expected answer evidence in appeal detail.');
    assert(detailResult.review.attempts.length === 1, 'Expected attempt history in appeal detail.');
    assert(detailResult.review.responseSla.dueAt, 'Expected assessment appeal response SLA due date.');
    assert(detailResult.review.responseSla.workingDaysTotal === 14, 'Expected 14-working-day response SLA.');

    const approveResult = await appealService.approveReview(
      {
        message: 'Smoke approval: one more attempt has been granted.',
        reviewClaimToken,
        sessionToken,
        taskKey: approvalTaskKey,
      },
      { requestId: `assessment-appeal-smoke-approve-${runId}` }
    );

    assert(approveResult.approved === true, 'Expected appeal approval to succeed.');

    const refreshedApprovedAppeal = await findOneByDocumentId(
      strapi,
      'api::assessment-appeal.assessment-appeal',
      approvalFixture.appeal.documentId
    );
    const refreshedApprovedAttempt = await findOneByDocumentId(
      strapi,
      'api::course-test-attempt.course-test-attempt',
      approvalFixture.attempt.documentId
    );
    const refreshedApprovedEnrollment = await findOneByDocumentId(
      strapi,
      'api::enrollment.enrollment',
      approvalFixture.enrollment.documentId
    );
    const refreshedApprovedTestResult = await findOneByDocumentId(
      strapi,
      'api::course-test-result.course-test-result',
      approvalFixture.testResult.documentId
    );
    const refreshedApprovedCourseResult = await findOneByDocumentId(
      strapi,
      'api::course-result.course-result',
      approvalFixture.courseResult.documentId
    );
    const approvalProgress = await progressRecordsForEnrollment(strapi, approvalFixture.enrollment.documentId);

    assert(refreshedApprovedAppeal.appealState === 'approved', 'Expected appeal to be approved.');
    assert(
      refreshedApprovedAttempt.retryEligibilityState === 'eligible_conditional_retry',
      'Expected approval to reopen one retry.'
    );
    assert(
      refreshedApprovedAttempt.metadata?.assessmentAppealDocumentId === approvalFixture.appeal.documentId,
      'Expected approval metadata on attempt.'
    );
    assert(refreshedApprovedEnrollment.passStatus === 'not_assessed', 'Expected enrollment pass status to reopen.');
    assert(
      new Date(refreshedApprovedEnrollment.courseCompletionDeadline).getTime() >
        new Date(approvalFixture.deadline).getTime(),
      'Expected approval to extend the course deadline.'
    );
    assert(refreshedApprovedTestResult.resultState === 'void', 'Expected previous failed test result to be voided.');
    assert(refreshedApprovedCourseResult.resultState === 'in_progress', 'Expected course result to reopen.');
    assert(approvalProgress.length >= 1, 'Expected approval to create reopened test progress.');

    await appealService.getReviewDetail(
      {
        sessionToken,
        taskKey: rejectionTaskKey,
      },
      { requestId: `assessment-appeal-smoke-detail-reject-${runId}` }
    );

    const rejectResult = await appealService.rejectReview(
      {
        message: 'Smoke rejection: the evidence does not support another attempt.',
        reviewClaimToken,
        sessionToken,
        taskKey: rejectionTaskKey,
      },
      { requestId: `assessment-appeal-smoke-reject-${runId}` }
    );

    assert(rejectResult.rejected === true, 'Expected appeal rejection to succeed.');

    const refreshedRejectedAppeal = await findOneByDocumentId(
      strapi,
      'api::assessment-appeal.assessment-appeal',
      rejectionFixture.appeal.documentId
    );
    const refreshedRejectedAttempt = await findOneByDocumentId(
      strapi,
      'api::course-test-attempt.course-test-attempt',
      rejectionFixture.attempt.documentId
    );

    assert(refreshedRejectedAppeal.appealState === 'rejected', 'Expected appeal to be rejected.');
    assert(refreshedRejectedAttempt.retryEligibilityState === 'exhausted', 'Expected rejected attempt to stay exhausted.');
    assert(claimAssertCount === 2, 'Expected approve and reject to assert active review claims.');
    assert(capturedNotifications.length === 2, 'Expected approval and rejection candidate notifications.');
    assert(
      capturedNotifications.some(
        (notification) => notification.body.type === 'candidate_course_appeal_approved'
      ),
      'Expected approval notification payload.'
    );
    assert(
      capturedNotifications.some(
        (notification) => notification.body.type === 'candidate_course_appeal_rejected'
      ),
      'Expected rejection notification payload.'
    );
    assert(
      auditEvents.some((event) => event.eventType === 'admin.assessment_appeal_approved'),
      'Expected approval audit event.'
    );
    assert(
      auditEvents.some((event) => event.eventType === 'admin.assessment_appeal_rejected'),
      'Expected rejection audit event.'
    );

    let lateAppealRejected = false;

    try {
      await strapi.service('api::candidate.candidate').createCurrentCandidateCourseAppeal(
        {
          subject: lateSubmissionFixture.candidate.authIdentityId,
          type: 'auth0',
        },
        courseTest.documentId,
        {
          reason: 'Smoke test late appeal: this should be rejected because the window has closed.',
        },
        { requestId: `assessment-appeal-smoke-late-${runId}` }
      );
    } catch (error) {
      lateAppealRejected = error instanceof Error && error.message.includes('5-working-day appeal window');
    }

    assert(lateAppealRejected, 'Expected late candidate assessment appeal submission to be rejected.');

    console.log('Assessment appeal smoke passed.');
  } finally {
    global.fetch = originalFetch;
    strapi.service = originalService;

    for (const fixture of created.fixtures) {
      if (fixture.enrollment?.documentId) {
        const progressRecords = await progressRecordsForEnrollment(strapi, fixture.enrollment.documentId);

        for (const progressRecord of progressRecords) {
          await deleteDocument(strapi, 'api::course-progress.course-progress', progressRecord.documentId);
        }
      }

      await deleteDocument(strapi, 'api::assessment-appeal.assessment-appeal', fixture.appeal?.documentId);
      await deleteDocument(strapi, 'api::course-test-result.course-test-result', fixture.testResult?.documentId);
      await deleteDocument(strapi, 'api::course-result.course-result', fixture.courseResult?.documentId);
      await deleteDocument(strapi, 'api::course-answer-submission.course-answer-submission', fixture.answer?.documentId);
      await deleteDocument(strapi, 'api::course-test-attempt.course-test-attempt', fixture.attempt?.documentId);
      await deleteDocument(strapi, 'api::enrollment.enrollment', fixture.enrollment?.documentId);
      await deleteDocument(strapi, 'api::candidate.candidate', fixture.candidate?.documentId);
    }

    await deleteDocument(strapi, 'api::class.class', created.classRecord?.documentId);
    await deleteDocument(strapi, 'api::course-question.course-question', created.question?.documentId);
    await deleteDocument(strapi, 'api::course-test.course-test', created.courseTest?.documentId);
    await deleteDocument(strapi, 'api::course-module.course-module', created.courseModule?.documentId);
    await deleteDocument(strapi, 'api::course-section.course-section', created.courseSection?.documentId);
    await deleteDocument(strapi, 'api::course.course', created.course?.documentId);
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

#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { compileStrapi, createStrapi } = require('@strapi/strapi');
const { setupSmokeDatabase } = require('./lib/smoke-database');
const { documents } = require('./lib/strapi-documents');

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
    const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);

    if (match && !Object.prototype.hasOwnProperty.call(process.env, match[1])) {
      process.env[match[1]] = stripQuotes(match[2]);
    }
  }
};

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const connect = (record) => ({
  connect: [{ documentId: record.documentId }],
});

const sessionToken = 's'.repeat(40);

const candidateData = (runId, suffix, firstName) => ({
  accountRestrictionStatus: 'active',
  authIdentityId: `auth0|admin-data-contract-${runId}-${suffix}`,
  authProvider: 'auth0',
  candidateState: 'account_created',
  email: `admin-data-contract-${runId}-${suffix}@example.test`,
  firstName,
  lastName: 'Candidate',
  marketingConsentState: 'opted_out',
  preferredCommunicationChannel: 'email',
});

const classData = (runId, suffix, displayTitle) => ({
  capacity: 30,
  currency: 'GBP',
  displayTitle,
  interviewsGuaranteed: 2,
  name: `${displayTitle} ${runId}`,
  officialClassCode: `Class ${runId.slice(-6)}-${suffix}`,
  state: 'draft',
});

const taskListInput = {
  page: 1,
  pageSize: 25,
  sessionToken,
  taskState: 'open',
};

const expectedAdminDataContractIndexes = [
  'admin_tasks_source_idx',
  'admin_tasks_state_priority_detected_idx',
  'admin_tasks_type_state_idx',
  'audit_events_actor_email_idx',
  'audit_events_actor_id_idx',
  'audit_events_subject_idx',
  'candidates_admin_list_class_sort_idx',
  'candidates_admin_list_readiness_rank_idx',
  'candidates_admin_list_readiness_state_idx',
  'employers_admin_list_invite_count_idx',
  'employers_admin_list_lead_contact_sort_idx',
];

const main = async () => {
  loadEnvFile();

  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const smokeDatabase = setupSmokeDatabase({
    runId,
    scriptName: 'admin-data-contracts',
  });
  const appContext = await compileStrapi();
  const strapi = await createStrapi(appContext).load();
  const originalService = strapi.service.bind(strapi);
  const originalDocuments = strapi.documents.bind(strapi);
  const session = {
    user: {
      displayName: 'Admin Data Contract Smoke',
      email: 'admin-data-contract@example.test',
      id: `admin-data-contract-${runId}`,
      roleKeys: ['super_admin'],
      roles: ['Super Admin'],
    },
  };
  const actualAdminTaskService = originalService('api::admin-task.admin-task');
  let nestedTaskListCalls = 0;

  const installedIndexes = await strapi.db.connection('sqlite_master')
    .where({ type: 'index' })
    .whereIn('name', expectedAdminDataContractIndexes)
    .pluck('name');
  assert(
    expectedAdminDataContractIndexes.every((indexName) => installedIndexes.includes(indexName)),
    'Expected all admin data-contract database indexes to be installed.'
  );

  strapi.service = (uid) => {
    if (uid === 'api::admin-auth.admin-auth') {
      return {
        getSession: async () => session,
      };
    }

    if (uid === 'api::admin-review-claim.admin-review-claim') {
      return {
        activeClaimsForSession: async () => new Map(),
        claimForSession: async () => ({ reviewClaim: null }),
      };
    }

    if (uid === 'api::admin-task.admin-task') {
      return new Proxy(actualAdminTaskService, {
        get(target, property, receiver) {
          if (property === 'listTasks') {
            return (...args) => {
              nestedTaskListCalls += 1;
              return target.listTasks(...args);
            };
          }

          return Reflect.get(target, property, receiver);
        },
      });
    }

    return originalService(uid);
  };

  try {
    const [alphaClass, zebraClass] = await Promise.all([
      documents(strapi, 'api::class.class').create({
        data: classData(runId, '01', 'Alpha Class'),
      }),
      documents(strapi, 'api::class.class').create({
        data: classData(runId, '02', 'Zebra Class'),
      }),
    ]);
    const [alphaCandidate, zebraCandidate, incompleteCandidate] = await Promise.all([
      documents(strapi, 'api::candidate.candidate').create({
        data: candidateData(runId, 'alpha', 'Alpha'),
      }),
      documents(strapi, 'api::candidate.candidate').create({
        data: candidateData(runId, 'zebra', 'Zebra'),
      }),
      documents(strapi, 'api::candidate.candidate').create({
        data: candidateData(runId, 'incomplete', 'Incomplete'),
      }),
    ]);
    const now = Date.now();

    await documents(strapi, 'api::enrollment.enrollment').create({
      data: {
        candidate: connect(alphaCandidate),
        class: connect(alphaClass),
        completionStatus: 'not_started',
        enrollmentState: 'enrolled',
        passStatus: 'not_assessed',
        paymentStatus: 'paid',
      },
    });
    await documents(strapi, 'api::enrollment.enrollment').create({
      data: {
        candidate: connect(zebraCandidate),
        class: connect(zebraClass),
        completionStatus: 'not_started',
        enrollmentState: 'enrolled',
        passStatus: 'not_assessed',
        paymentStatus: 'paid',
      },
    });
    await documents(strapi, 'api::candidate-profile.candidate-profile').create({
      data: {
        availabilityConfirmedAt: new Date(now - 60_000).toISOString(),
        availabilityExpiresAt: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
        candidate: connect(zebraCandidate),
        profileState: 'completed',
        recruitmentPlatformVisibility: 'hidden',
      },
    });
    await documents(strapi, 'api::candidate-profile.candidate-profile').create({
      data: {
        availabilityConfirmedAt: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(),
        availabilityExpiresAt: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
        candidate: connect(alphaCandidate),
        profileState: 'completed',
        recruitmentPlatformVisibility: 'hidden',
      },
    });

    const candidateService = strapi.service('api::admin-candidate.admin-candidate');
    const classAscending = await candidateService.listCandidates({
      page: 1,
      pageSize: 10,
      sessionToken,
      sortBy: 'class',
      sortDirection: 'asc',
    });
    const classLabels = classAscending.candidates
      .filter((candidate) => ['Alpha', 'Zebra'].includes(candidate.firstName))
      .map((candidate) => candidate.classLabel);

    assert(
      JSON.stringify(classLabels) === JSON.stringify(['Alpha Class', 'Zebra Class']),
      `Expected class sort to use derived class labels, received ${JSON.stringify(classLabels)}.`
    );

    const readinessAscending = await candidateService.listCandidates({
      page: 1,
      pageSize: 10,
      sessionToken,
      sortBy: 'readiness',
      sortDirection: 'asc',
    });
    const readinessStates = readinessAscending.candidates
      .filter((candidate) => ['Alpha', 'Incomplete', 'Zebra'].includes(candidate.firstName))
      .map((candidate) => candidate.readinessState);

    assert(
      JSON.stringify(readinessStates) ===
        JSON.stringify(['availability_expired', 'incomplete', 'ready']),
      `Expected readiness sort to use persisted readiness ranks, received ${JSON.stringify(readinessStates)}.`
    );

    await documents(strapi, 'api::candidate.candidate').update({
      documentId: zebraCandidate.documentId,
      data: {
        adminListReadinessExpiresAt: new Date(now - 1000).toISOString(),
        adminListReadinessRank: 2,
        adminListReadinessState: 'ready',
      },
    });
    const expiredCandidates = await candidateService.listCandidates({
      page: 1,
      pageSize: 10,
      readiness: 'availability_expired',
      sessionToken,
      sortBy: 'readiness',
      sortDirection: 'asc',
    });

    assert(
      expiredCandidates.candidates.some((candidate) => candidate.documentId === zebraCandidate.documentId),
      'Expected due readiness summaries to reconcile before candidate filtering.'
    );

    const employers = await Promise.all(
      ['No Contact Ltd', 'Alpha Employer Ltd', 'Zebra Employer Ltd'].map((companyName) =>
        documents(strapi, 'api::employer.employer').create({
          data: {
            companyName: `${companyName} ${runId}`,
            employerState: 'active',
          },
        })
      )
    );
    const [, alphaEmployer, zebraEmployer] = employers;

    await documents(strapi, 'api::employer-contact.employer-contact').create({
      data: {
        authProvider: 'manual',
        contactRole: 'lead_contact',
        contactState: 'active',
        email: `alpha-lead-${runId}@example.test`,
        employer: connect(alphaEmployer),
        firstName: 'Alpha',
        lastName: 'Lead',
      },
    });
    await documents(strapi, 'api::employer-contact.employer-contact').create({
      data: {
        authProvider: 'manual',
        contactRole: 'lead_contact',
        contactState: 'active',
        email: `zebra-lead-${runId}@example.test`,
        employer: connect(zebraEmployer),
        firstName: 'Zebra',
        lastName: 'Lead',
      },
    });

    const createInvite = (employer, suffix) =>
      documents(strapi, 'api::employer-invite.employer-invite').create({
        data: {
          deliveryState: 'not_required',
          employer: connect(employer),
          expiresAt: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
          inviteEmail: `invite-${runId}-${suffix}@example.test`,
          inviteState: 'pending',
          tokenHash: `${runId}-${suffix}`.padEnd(64, '0').slice(0, 64),
        },
      });

    await createInvite(alphaEmployer, 'alpha-1');
    await createInvite(zebraEmployer, 'zebra-1');
    await createInvite(zebraEmployer, 'zebra-2');

    const employerService = strapi.service('api::admin-employer.admin-employer');
    const leadAscending = await employerService.listEmployers({
      commitment: 'all',
      page: 1,
      pageSize: 10,
      sessionToken,
      sortBy: 'leadContact',
      sortDirection: 'asc',
      state: 'all',
    });
    const leadNames = leadAscending.employers
      .filter((employer) => employer.leadContact)
      .map((employer) => employer.leadContact.name);

    assert(
      JSON.stringify(leadNames) === JSON.stringify(['Alpha Lead', 'Zebra Lead']),
      `Expected lead-contact sort to use the displayed contact, received ${JSON.stringify(leadNames)}.`
    );

    const invitesDescending = await employerService.listEmployers({
      commitment: 'all',
      page: 1,
      pageSize: 10,
      sessionToken,
      sortBy: 'inviteCount',
      sortDirection: 'desc',
      state: 'all',
    });
    const inviteCounts = invitesDescending.employers.map((employer) => employer.inviteCount);

    assert(
      JSON.stringify(inviteCounts) === JSON.stringify([2, 1, 0]),
      `Expected invite-count sort to use persisted counts, received ${JSON.stringify(inviteCounts)}.`
    );

    const occurredAt = new Date().toISOString();
    await Promise.all([
      documents(strapi, 'api::audit-event.audit-event').create({
        data: {
          actorId: alphaCandidate.authIdentityId,
          actorType: 'candidate',
          eventCategory: 'candidate',
          eventType: 'candidate.profile_viewed',
          occurredAt,
          severity: 'info',
          source: 'candidate_dashboard',
          subjectId: alphaCandidate.documentId,
          subjectType: 'candidate',
        },
      }),
      documents(strapi, 'api::audit-event.audit-event').create({
        data: {
          actorType: 'admin',
          eventCategory: 'support',
          eventType: 'support.case_reviewed',
          occurredAt,
          severity: 'warning',
          source: 'admin_dashboard',
          subjectId: alphaCandidate.documentId,
          subjectType: 'candidate',
        },
      }),
      documents(strapi, 'api::audit-event.audit-event').create({
        data: {
          actorType: 'candidate',
          eventCategory: 'candidate',
          eventType: 'candidate.other_event',
          occurredAt,
          severity: 'critical',
          source: 'candidate_dashboard',
          subjectId: zebraCandidate.documentId,
          subjectType: 'candidate',
        },
      }),
    ]);

    const auditQueries = [];
    const recordAuditQuery = (query) => {
      if (String(query.sql || '').toLowerCase().includes('audit_events')) {
        auditQueries.push(String(query.sql).toLowerCase());
      }
    };
    strapi.db.connection.on('query', recordAuditQuery);

    const activity = await candidateService.candidateActivity({
      candidateDocumentId: alphaCandidate.documentId,
      page: 1,
      pageSize: 5,
      sessionToken,
    });
    strapi.db.connection.off('query', recordAuditQuery);

    assert(activity.auditEvents.length === 2, 'Expected only the selected candidate activity rows.');
    assert(
      auditQueries.filter((sql) => sql.includes('distinct')).length === 4,
      'Expected four database-distinct candidate activity option queries.'
    );
    assert(
      auditQueries.some((sql) => sql.includes('limit')),
      'Expected candidate activity rows to be read with a database limit.'
    );
    assert(
      activity.filters.categories.map((option) => option.value).join(',') === 'candidate,support',
      'Expected database-distinct candidate activity categories.'
    );

    const supportCase = await documents(strapi, 'api::support-case.support-case').create({
      data: {
        candidate: connect(alphaCandidate),
        caseKey: `admin-data-contract:${runId}`,
        caseState: 'open',
        caseType: 'general',
        lastMessageAt: occurredAt,
        openedAt: occurredAt,
        openedByType: 'candidate',
        priority: 'high',
        source: 'candidate_dashboard',
        summary: 'Admin data contract smoke support case.',
        title: 'Admin data contract smoke',
      },
    });

    const reconciliation = await actualAdminTaskService.reconcileTasks();
    assert(reconciliation.taskCount > 0, 'Expected background reconciliation to persist task rows.');

    const firstTaskFeed = await actualAdminTaskService.listTasks(taskListInput);
    const supportTask = firstTaskFeed.tasks.find(
      (task) => task.sourceDocumentId === supportCase.documentId
    );
    assert(
      supportTask,
      'Expected the reconciled support task in the persisted task feed.'
    );

    const interviewService = strapi.service('api::admin-interview.admin-interview');
    const refundService = strapi.service('api::admin-refund.admin-refund');
    await interviewService.getOperations({
      issue: 'all',
      page: 1,
      pageSize: 25,
      sessionToken,
      sortBy: 'dueAt',
      sortDirection: 'asc',
    });
    await refundService.listReviews({
      page: 1,
      pageSize: 25,
      priority: 'all',
      reviewType: 'all',
      search: '',
      sessionToken,
    });

    assert(
      nestedTaskListCalls === 0,
      `Expected Interview Operations and Refund Reviews to avoid task-feed refresh calls, received ${nestedTaskListCalls}.`
    );

    await documents(strapi, 'api::support-case.support-case').update({
      documentId: supportCase.documentId,
      data: {
        caseState: 'resolved',
        resolvedAt: new Date().toISOString(),
      },
    });
    const staleRead = await actualAdminTaskService.listTasks(taskListInput);
    const staleOverview = await actualAdminTaskService.getOverview({ sessionToken });
    const staleDetail = await actualAdminTaskService.getTaskDetail({
      sessionToken,
      taskKey: supportTask.taskKey,
    });

    assert(
      staleRead.tasks.some((task) => task.sourceDocumentId === supportCase.documentId),
      'Expected list reads to use the persisted snapshot without reconciling source collections.'
    );
    assert(
      staleOverview.tasks.some((task) => task.sourceDocumentId === supportCase.documentId),
      'Expected overview reads to use the persisted snapshot without reconciling source collections.'
    );
    assert(
      staleDetail.task.sourceDocumentId === supportCase.documentId,
      'Expected detail reads to use the persisted snapshot without reconciling source collections.'
    );

    await actualAdminTaskService.reconcileTasks();
    const reconciledRead = await actualAdminTaskService.listTasks(taskListInput);

    assert(
      !reconciledRead.tasks.some((task) => task.sourceDocumentId === supportCase.documentId),
      'Expected background reconciliation to resolve the stale persisted task.'
    );

    console.log(
      JSON.stringify(
        {
          activityDistinctFilters: true,
          adminDataContractIndexes: true,
          candidateClassSort: true,
          candidateReadinessSort: true,
          employerInviteCountSort: true,
          employerLeadContactSort: true,
          interviewAndRefundReadsAvoidTaskSync: true,
          isolatedDatabase: smokeDatabase.isolated,
          taskReadsAvoidSourceReconciliation: true,
        },
        null,
        2
      )
    );
  } finally {
    strapi.documents = originalDocuments;
    strapi.service = originalService;
    await strapi.destroy();
    await smokeDatabase.cleanup();
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

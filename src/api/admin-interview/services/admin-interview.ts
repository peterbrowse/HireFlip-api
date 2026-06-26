import { errors, validateZodSchema, z } from '@strapi/utils';

const { ForbiddenError } = errors;

type RequestContext = {
  ipAddress?: string;
  requestId?: string;
  serviceName?: string;
  userAgent?: string;
};

type AdminSession = {
  user: {
    displayName: string;
    email: string;
    id: string;
    roleKeys: string[];
    roles: string[];
  };
};

type AdminAuthService = {
  getSession(input: unknown, context: RequestContext): Promise<AdminSession>;
};

type EmployerReliabilityEventService = {
  action(input: Record<string, unknown>, context?: RequestContext): Promise<unknown>;
};

type DocumentRecord = Record<string, unknown> & {
  candidate?: DocumentRecord;
  class?: DocumentRecord;
  companyName?: string;
  completedAt?: string;
  createdAt?: string;
  candidateResponseDeadline?: string;
  candidateRespondedAt?: string;
  documentId?: string;
  email?: string;
  employer?: DocumentRecord;
  employerContact?: DocumentRecord;
  employerDetailsDueAt?: string;
  employerDetailsReleaseEligibleAt?: string;
  employerDetailsReleaseReason?: string;
  employerDetailsReleasedAt?: string;
  feedbackDueAt?: string;
  feedbackOverdueDetectedAt?: string;
  firstName?: string;
  id?: number | string;
  insufficientCapacityDetectedAt?: string;
  insufficientCapacityReason?: string;
  interviewSlot?: DocumentRecord;
  interviewState?: string;
  lastName?: string;
  metadata?: unknown;
  name?: string;
  outcome?: string;
  progressionState?: string;
  progressionType?: string;
  region?: DocumentRecord;
  requestedDetailsAt?: string;
  requestState?: string;
  scheduledEndTime?: string;
  scheduledStartTime?: string;
  sourceDocumentId?: string;
  sourceType?: string;
  strikeNumber?: number;
  title?: string;
  summary?: string;
  updatedAt?: string;
};

type DocumentCollection = {
  findMany(input: Record<string, unknown>): Promise<DocumentRecord[]>;
};

type StrapiDocumentService = {
  documents(uid: string): unknown;
  service(uid: string): unknown;
};

type OperationIssue =
  | 'all'
  | 'capacity_shortfall'
  | 'details_overdue'
  | 'details_pending'
  | 'details_released'
  | 'feedback_due'
  | 'feedback_overdue'
  | 'progression_expired';

type OperationRow = {
  actionPath: string;
  candidateName: string | null;
  dueAt: string | null;
  employerDocumentId: string | null;
  employerName: string | null;
  issue: Exclude<OperationIssue, 'all'>;
  issueLabel: string;
  priority: 'high' | 'normal' | 'urgent';
  referenceAt: string | null;
  regionName: string | null;
  sourceDocumentId: string;
  sourceType: 'interview' | 'interview_request' | 'progression_request';
  statusLabel: string;
  summary: string;
  reliabilityEvent: {
    documentId: string;
    eventAt: string | null;
    eventState: string | null;
    eventType: string | null;
    eventTypeLabel: string;
    outcome: string | null;
    strikeNumber: number;
    summary: string | null;
    title: string | null;
  } | null;
};

const operationsSchema = z
  .object({
    issue: z
      .enum([
        'all',
        'capacity_shortfall',
        'details_overdue',
        'details_pending',
        'details_released',
        'feedback_due',
        'feedback_overdue',
        'progression_expired',
      ])
      .default('all'),
    search: z.string().trim().max(120).optional().transform((value) => value || undefined),
    sessionToken: z.string().trim().min(32).max(512),
    sortBy: z.enum(['candidate', 'dueAt', 'employer', 'issue', 'priority', 'updatedAt']).default('dueAt'),
    sortDirection: z.enum(['asc', 'desc']).default('asc'),
  })
  .strict();

const validateOperations = validateZodSchema(operationsSchema);

const actionSchema = z
  .object({
    action: z.enum(['acknowledge', 'apply_strike', 'apply_warning', 'clear', 'reset_employer']),
    employerDocumentId: z.string().trim().min(1).max(120).optional(),
    internalNote: z.string().trim().max(1000).optional().transform((value) => value || undefined),
    reliabilityEventDocumentId: z.string().trim().min(1).max(120).optional(),
    sessionToken: z.string().trim().min(32).max(512),
    sourceDocumentId: z.string().trim().min(1).max(160).optional(),
    sourceType: z.enum(['admin', 'employer_capacity_claim', 'interview', 'interview_request', 'progression_request', 'system']).optional(),
    summary: z.string().trim().max(1000).optional().transform((value) => value || undefined),
    title: z.string().trim().max(180).optional().transform((value) => value || undefined),
  })
  .strict();

const validateAction = validateZodSchema(actionSchema);

const documents = (strapi: StrapiDocumentService, uid: string) =>
  strapi.documents(uid) as unknown as DocumentCollection;

const adminAuthService = (strapi: StrapiDocumentService): AdminAuthService =>
  strapi.service('api::admin-auth.admin-auth') as unknown as AdminAuthService;

const employerReliabilityEventService = (strapi: StrapiDocumentService): EmployerReliabilityEventService =>
  strapi.service(
    'api::employer-reliability-event.employer-reliability-event'
  ) as unknown as EmployerReliabilityEventService;

const getDocumentId = (record?: DocumentRecord | null) =>
  typeof record?.documentId === 'string'
    ? record.documentId
    : typeof record?.id === 'number' || typeof record?.id === 'string'
      ? String(record.id)
      : undefined;

const documentRecordValue = (value: unknown): DocumentRecord | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as DocumentRecord)
    : undefined;

const displayName = (record?: DocumentRecord | null) => {
  if (!record) {
    return null;
  }

  const fullName = [record.firstName, record.lastName].filter(Boolean).join(' ').trim();
  return fullName || String(record.name || record.email || record.documentId || '').trim() || null;
};

const employerName = (interview: DocumentRecord) => {
  const employer = documentRecordValue(interview.employer);
  return typeof employer?.companyName === 'string' ? employer.companyName : displayName(employer);
};

const employerDocumentId = (record: DocumentRecord) => getDocumentId(documentRecordValue(record.employer)) || null;

const regionName = (record: DocumentRecord) => {
  const region =
    documentRecordValue(record.region) ||
    documentRecordValue(documentRecordValue(record.interviewSlot)?.region);
  return typeof region?.name === 'string' ? region.name : null;
};

const addCalendarDays = (value?: string | Date | null, days = 7) => {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);

  if (!Number.isFinite(date.getTime())) {
    return null;
  }

  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
};

const feedbackDueAt = (interview: DocumentRecord) =>
  interview.feedbackDueAt ||
  addCalendarDays(
    interview.scheduledEndTime ||
      interview.completedAt ||
      interview.scheduledStartTime ||
      interview.createdAt,
    7
  );

const issueLabels: Record<Exclude<OperationIssue, 'all'>, string> = {
  capacity_shortfall: 'Capacity shortfall',
  details_overdue: 'Details overdue',
  details_pending: 'Details pending',
  details_released: 'Details released',
  feedback_due: 'Feedback due',
  feedback_overdue: 'Feedback overdue',
  progression_expired: 'Progression expired',
};

const reliabilityEventTypeByIssue: Partial<Record<Exclude<OperationIssue, 'all'>, string>> = {
  details_overdue: 'interview_details_overdue',
  details_released: 'interview_details_released',
  feedback_overdue: 'feedback_overdue',
  progression_expired: 'candidate_progression_expired',
};

const priorityRank = {
  urgent: 0,
  high: 1,
  normal: 2,
};

const actionPath = (issue: string, documentId: string) =>
  `/interviews?issue=${encodeURIComponent(issue)}&interview=${encodeURIComponent(documentId)}`;

const interviewRow = (
  interview: DocumentRecord,
  issue: Exclude<OperationIssue, 'all'>
): OperationRow | null => {
  const documentId = getDocumentId(interview);

  if (!documentId) {
    return null;
  }

  const candidateName = displayName(documentRecordValue(interview.candidate));
  const employer = employerName(interview);
  const due =
    issue === 'feedback_due' || issue === 'feedback_overdue'
      ? feedbackDueAt(interview)
      : interview.employerDetailsDueAt || null;
  const releaseEligible =
    issue === 'details_overdue' &&
    Boolean(
      interview.employerDetailsReleaseEligibleAt &&
        Date.parse(interview.employerDetailsReleaseEligibleAt) <= Date.now()
    );
  const priority: OperationRow['priority'] =
    issue === 'details_released' || issue === 'feedback_overdue' || releaseEligible ? 'urgent' : 'high';

  return {
    actionPath: actionPath(issue, documentId),
    candidateName,
    dueAt: due,
    employerDocumentId: employerDocumentId(interview),
    employerName: employer,
    issue,
    issueLabel: issueLabels[issue],
    priority,
    referenceAt:
      issue === 'details_released'
        ? interview.employerDetailsReleasedAt || interview.updatedAt || null
        : due || interview.updatedAt || interview.createdAt || null,
    regionName: regionName(interview),
    sourceDocumentId: documentId,
    sourceType: 'interview',
    statusLabel: String(interview.interviewState || '').replace(/_/g, ' ') || 'Not recorded',
    summary: [
      candidateName ? `Candidate: ${candidateName}` : null,
      employer ? `Employer: ${employer}` : null,
    ].filter(Boolean).join(' / '),
    reliabilityEvent: null,
  };
};

const requestRow = (request: DocumentRecord): OperationRow | null => {
  const documentId = getDocumentId(request);

  if (!documentId) {
    return null;
  }

  const candidateName = displayName(documentRecordValue(request.candidate));
  const classRecord = documentRecordValue(request.class);
  const detectedAt = request.insufficientCapacityDetectedAt || request.updatedAt || request.createdAt || null;

  return {
    actionPath: `/interviews?issue=capacity_shortfall&request=${encodeURIComponent(documentId)}`,
    candidateName,
    dueAt: detectedAt,
    employerDocumentId: null,
    employerName: null,
    issue: 'capacity_shortfall',
    issueLabel: issueLabels.capacity_shortfall,
    priority: 'urgent',
    referenceAt: detectedAt,
    regionName: regionName(request),
    sourceDocumentId: documentId,
    sourceType: 'interview_request',
    statusLabel: String(request.requestState || '').replace(/_/g, ' ') || 'Pending capacity',
    summary: [
      request.insufficientCapacityReason || 'Insufficient employer interview capacity.',
      candidateName ? `Candidate: ${candidateName}` : null,
      typeof classRecord?.displayTitle === 'string' ? `Class: ${classRecord.displayTitle}` : null,
    ].filter(Boolean).join(' / '),
    reliabilityEvent: null,
  };
};

const progressionRequestRow = (request: DocumentRecord): OperationRow | null => {
  const documentId = getDocumentId(request);
  const interview = documentRecordValue(request.interview);

  if (!documentId) {
    return null;
  }

  const candidateName = displayName(documentRecordValue(request.candidate));
  const employer = employerName(request);
  const referenceAt =
    request.candidateRespondedAt ||
    request.candidateResponseDeadline ||
    request.requestedDetailsAt ||
    request.updatedAt ||
    request.createdAt ||
    null;

  return {
    actionPath: `/interviews?issue=progression_expired&progression=${encodeURIComponent(documentId)}`,
    candidateName,
    dueAt: request.candidateResponseDeadline || null,
    employerDocumentId: employerDocumentId(request),
    employerName: employer,
    issue: 'progression_expired',
    issueLabel: issueLabels.progression_expired,
    priority: 'high',
    referenceAt,
    regionName: interview ? regionName(interview) : null,
    sourceDocumentId: documentId,
    sourceType: 'progression_request',
    statusLabel: 'No response received',
    summary: [
      'Candidate did not respond to employer progression request.',
      candidateName ? `Candidate: ${candidateName}` : null,
      employer ? `Employer: ${employer}` : null,
    ].filter(Boolean).join(' / '),
    reliabilityEvent: null,
  };
};

const assertSession = async (
  strapi: StrapiDocumentService,
  sessionToken: string,
  context: RequestContext
) => {
  const session = await adminAuthService(strapi).getSession({ sessionToken }, context);

  if (
    !session.user.roleKeys.some((roleKey) =>
      ['admin', 'sales', 'super_admin', 'support'].includes(roleKey)
    )
  ) {
    throw new ForbiddenError('Admin, Sales, Support, or Super Admin access is required.');
  }

  return session;
};

const includesSearch = (row: OperationRow, search?: string) => {
  if (!search) {
    return true;
  }

  const haystack = [
    row.candidateName,
    row.employerName,
    row.issueLabel,
    row.regionName,
    row.statusLabel,
    row.summary,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return haystack.includes(search.toLowerCase());
};

const humanize = (value?: string | null) =>
  String(value || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());

const reliabilityEventPayload = (event: DocumentRecord): OperationRow['reliabilityEvent'] => {
  const documentId = getDocumentId(event);

  if (!documentId) {
    return null;
  }

  return {
    documentId,
    eventAt: typeof event.eventAt === 'string' ? event.eventAt : null,
    eventState: typeof event.eventState === 'string' ? event.eventState : null,
    eventType: typeof event.eventType === 'string' ? event.eventType : null,
    eventTypeLabel: humanize(typeof event.eventType === 'string' ? event.eventType : null),
    outcome: typeof event.outcome === 'string' ? event.outcome : null,
    strikeNumber: Number(event.strikeNumber || 0),
    summary: typeof event.summary === 'string' ? event.summary : null,
    title: typeof event.title === 'string' ? event.title : null,
  };
};

const reliabilityLookupKey = (sourceType?: string, sourceDocumentId?: string, eventType?: string) =>
  sourceType && sourceDocumentId && eventType ? `${sourceType}:${sourceDocumentId}:${eventType}` : null;

const compareRows = (
  sortBy: 'candidate' | 'dueAt' | 'employer' | 'issue' | 'priority' | 'updatedAt',
  sortDirection: 'asc' | 'desc'
) => (left: OperationRow, right: OperationRow) => {
  const multiplier = sortDirection === 'asc' ? 1 : -1;
  const value = (row: OperationRow) => {
    if (sortBy === 'candidate') return row.candidateName || '';
    if (sortBy === 'employer') return row.employerName || '';
    if (sortBy === 'issue') return row.issueLabel;
    if (sortBy === 'priority') return priorityRank[row.priority];
    if (sortBy === 'updatedAt') return row.referenceAt || '';
    return row.dueAt || '';
  };
  const leftValue = value(left);
  const rightValue = value(right);

  if (typeof leftValue === 'number' && typeof rightValue === 'number') {
    return (leftValue - rightValue) * multiplier;
  }

  return String(leftValue).localeCompare(String(rightValue)) * multiplier;
};

export default ({ strapi }) => ({
  async getOperations(input: unknown, requestContext: RequestContext = {}) {
    const body = validateOperations(input);
    const session = await assertSession(strapi, body.sessionToken, requestContext);
    const now = Date.now();

    const [interviews, requests, progressionRequests] = await Promise.all([
      documents(strapi, 'api::interview.interview').findMany({
        filters: {
          interviewState: {
            $in: ['awaiting_employer_details', 'employer_cancelled', 'completed'],
          },
        },
        limit: 300,
        populate: {
          candidate: true,
          employer: true,
          employerContact: true,
          interviewSlot: {
            populate: ['region'],
          },
        },
        sort: ['employerDetailsDueAt:asc', 'feedbackDueAt:asc', 'updatedAt:desc'],
      }),
      documents(strapi, 'api::interview-request.interview-request').findMany({
        filters: {
          insufficientCapacityDetectedAt: {
            $notNull: true,
          },
          requestState: 'pending_capacity',
        },
        limit: 100,
        populate: ['candidate', 'class', 'region'],
        sort: ['insufficientCapacityDetectedAt:desc', 'updatedAt:desc'],
      }),
      documents(strapi, 'api::offer.offer').findMany({
        filters: {
          progressionState: 'expired',
        },
        limit: 100,
        populate: {
          candidate: true,
          employer: true,
          interview: {
            populate: ['interviewSlot'],
          },
          requestedByEmployerContact: true,
        },
        sort: ['candidateRespondedAt:desc', 'updatedAt:desc'],
      }),
    ]);
    const interviewDocumentIds = interviews
      .map(getDocumentId)
      .filter((documentId): documentId is string => Boolean(documentId));
    const feedbackRecords = interviewDocumentIds.length
      ? await documents(strapi, 'api::interview-feedback.interview-feedback').findMany({
          filters: {
            interview: {
              documentId: {
                $in: interviewDocumentIds,
              },
            },
            submittedByType: 'employer_contact',
          },
          limit: Math.max(interviewDocumentIds.length, 100),
          populate: ['interview'],
        })
      : [];
    const feedbackInterviewIds = new Set(
      feedbackRecords
        .map((feedback) => getDocumentId(documentRecordValue(feedback.interview)))
        .filter((documentId): documentId is string => Boolean(documentId))
    );
    const rows: OperationRow[] = [];

    for (const interview of interviews) {
      const interviewDocumentId = getDocumentId(interview);

      if (!interviewDocumentId) {
        continue;
      }

      if (interview.interviewState === 'awaiting_employer_details') {
        const dueAt = interview.employerDetailsDueAt;
        rows.push(interviewRow(interview, dueAt && Date.parse(dueAt) <= now ? 'details_overdue' : 'details_pending'));
      }

      if (
        interview.interviewState === 'employer_cancelled' &&
        interview.employerDetailsReleaseReason === 'employer_did_not_confirm'
      ) {
        rows.push(interviewRow(interview, 'details_released'));
      }

      if (
        interview.interviewState === 'completed' &&
        !feedbackInterviewIds.has(interviewDocumentId)
      ) {
        const dueAt = feedbackDueAt(interview);
        rows.push(interviewRow(interview, dueAt && Date.parse(dueAt) <= now ? 'feedback_overdue' : 'feedback_due'));
      }
    }

    rows.push(...requests.map(requestRow));
    rows.push(...progressionRequests.map(progressionRequestRow));

    const compactRows = rows.filter((row): row is OperationRow => Boolean(row));
    const reliabilitySourceDocumentIds = compactRows
      .map((row) => row.sourceDocumentId)
      .filter((documentId): documentId is string => Boolean(documentId));
    const reliabilityEventTypes = Object.values(reliabilityEventTypeByIssue);
    const reliabilityEvents =
      reliabilitySourceDocumentIds.length > 0
        ? await documents(strapi, 'api::employer-reliability-event.employer-reliability-event').findMany({
            filters: {
              eventState: {
                $in: ['active', 'acknowledged'],
              },
              eventType: {
                $in: reliabilityEventTypes,
              },
              sourceDocumentId: {
                $in: reliabilitySourceDocumentIds,
              },
              sourceType: 'interview',
            },
            limit: Math.max(reliabilitySourceDocumentIds.length, 100),
            sort: ['eventAt:desc', 'createdAt:desc'],
          })
        : [];
    const reliabilityEventsByKey = new Map<string, OperationRow['reliabilityEvent']>();

    for (const event of reliabilityEvents) {
      const key = reliabilityLookupKey(
        typeof event.sourceType === 'string' ? event.sourceType : undefined,
        typeof event.sourceDocumentId === 'string' ? event.sourceDocumentId : undefined,
        typeof event.eventType === 'string' ? event.eventType : undefined
      );

      if (key && !reliabilityEventsByKey.has(key)) {
        reliabilityEventsByKey.set(key, reliabilityEventPayload(event));
      }
    }

    const rowsWithReliability = compactRows.map((row) => {
      const eventType = reliabilityEventTypeByIssue[row.issue];
      const key = reliabilityLookupKey(row.sourceType, row.sourceDocumentId, eventType);

      return {
        ...row,
        reliabilityEvent: key ? reliabilityEventsByKey.get(key) || null : null,
      };
    });

    const filteredRows = rowsWithReliability
      .filter((row) => body.issue === 'all' || row.issue === body.issue)
      .filter((row) => includesSearch(row, body.search))
      .sort(compareRows(body.sortBy, body.sortDirection));

    return {
      counts: {
        capacityShortfall: rowsWithReliability.filter((row) => row.issue === 'capacity_shortfall').length,
        detailsOverdue: rowsWithReliability.filter((row) => row.issue === 'details_overdue').length,
        detailsPending: rowsWithReliability.filter((row) => row.issue === 'details_pending').length,
        detailsReleased: rowsWithReliability.filter((row) => row.issue === 'details_released').length,
        feedbackDue: rowsWithReliability.filter((row) => row.issue === 'feedback_due').length,
        feedbackOverdue: rowsWithReliability.filter((row) => row.issue === 'feedback_overdue').length,
        total: rowsWithReliability.length,
      },
      filteredOperations: filteredRows.length,
      generatedAt: new Date().toISOString(),
      operations: filteredRows.slice(0, 200),
      totalOperations: rowsWithReliability.length,
      user: session.user,
    };
  },

  async action(input: unknown, requestContext: RequestContext = {}) {
    const body = validateAction(input);
    const session = await assertSession(strapi, body.sessionToken, requestContext);

    if (
      ['apply_strike', 'clear', 'reset_employer'].includes(body.action) &&
      !body.internalNote?.trim()
    ) {
      throw new errors.ValidationError('An audit note is required for this reliability action.');
    }

    if (['acknowledge', 'clear'].includes(body.action) && !body.reliabilityEventDocumentId) {
      throw new errors.ValidationError('Reliability event ID is required.');
    }

    if (
      ['apply_strike', 'apply_warning', 'reset_employer'].includes(body.action) &&
      !body.employerDocumentId
    ) {
      throw new errors.ValidationError('Employer ID is required.');
    }

    return employerReliabilityEventService(strapi).action(
      {
        action: body.action,
        actor: {
          displayName: session.user.displayName,
          email: session.user.email,
          id: session.user.id,
        },
        employerDocumentId: body.employerDocumentId,
        eventDocumentId: body.reliabilityEventDocumentId,
        internalNote: body.internalNote,
        sourceDocumentId: body.sourceDocumentId,
        sourceType: body.sourceType,
        summary: body.summary,
        title: body.title,
      },
      requestContext
    );
  },
});

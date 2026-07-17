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

type AdminTaskService = {
  listTasks(input: unknown, context?: RequestContext): Promise<unknown>;
};

type DocumentRecord = Record<string, unknown> & {
  actionPath?: string;
  candidate?: DocumentRecord;
  candidateLabel?: string;
  candidateFollowUpCompletedAt?: string;
  candidateFollowUpOutcome?: string;
  candidateFollowUpState?: string;
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
  employerFollowUpCompletedAt?: string;
  employerFollowUpOutcome?: string;
  employerFollowUpState?: string;
  feedbackDueAt?: string;
  feedbackOverdueDetectedAt?: string;
  firstName?: string;
  id?: number | string;
  insufficientCapacityDetectedAt?: string;
  insufficientCapacityReason?: string;
  interviewSlot?: DocumentRecord;
  interviewState?: string;
  issueKey?: string;
  lastName?: string;
  metadata?: unknown;
  name?: string;
  outcome?: string;
  progressionState?: string;
  progressionType?: string;
  region?: DocumentRecord;
  requestedDetailsAt?: string;
  requestState?: string;
  dueAt?: string;
  employerLabel?: string;
  priority?: 'high' | 'normal' | 'urgent';
  priorityRank?: number;
  regionLabel?: string;
  scheduledEndTime?: string;
  scheduledStartTime?: string;
  sourceDocumentId?: string;
  sourceType?: string;
  strikeNumber?: number;
  title?: string;
  summary?: string;
  taskKey?: string;
  taskState?: string;
  taskType?: string;
  updatedAt?: string;
};

type DocumentCollection = {
  count(input: Record<string, unknown>): Promise<number>;
  findMany(input: Record<string, unknown>): Promise<DocumentRecord[]>;
};

type StrapiDocumentService = {
  documents(uid: string): unknown;
  service(uid: string): unknown;
};

type OperationIssue =
  | 'all'
  | 'capacity_shortfall'
  | 'candidate_restriction_cancelled'
  | 'details_overdue'
  | 'details_pending'
  | 'details_released'
  | 'feedback_due'
  | 'feedback_overdue'
  | 'progression_expired'
  | 'progression_follow_up_concern';

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
        'candidate_restriction_cancelled',
        'details_overdue',
        'details_pending',
        'details_released',
        'feedback_due',
        'feedback_overdue',
        'progression_expired',
        'progression_follow_up_concern',
      ])
      .default('all'),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(10).max(100).default(25),
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

const adminTaskService = (strapi: StrapiDocumentService): AdminTaskService =>
  strapi.service('api::admin-task.admin-task') as unknown as AdminTaskService;

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

const objectValue = (value: unknown) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const stringValue = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

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
  candidate_restriction_cancelled: 'Candidate restriction cancelled',
  details_overdue: 'Details overdue',
  details_pending: 'Details pending',
  details_released: 'Details released',
  feedback_due: 'Feedback due',
  feedback_overdue: 'Feedback overdue',
  progression_expired: 'Progression expired',
  progression_follow_up_concern: 'Progression follow-up concern',
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

const progressionFollowUpConcernRow = (request: DocumentRecord): OperationRow | null => {
  const documentId = getDocumentId(request);
  const interview = documentRecordValue(request.interview);

  if (!documentId) {
    return null;
  }

  const candidateName = displayName(documentRecordValue(request.candidate));
  const employer = employerName(request);
  const candidateConcern = ['employer_did_not_contact_me', 'need_support'].includes(
    String(request.candidateFollowUpOutcome || '')
  );
  const employerConcern = request.employerFollowUpOutcome === 'no_response_from_candidate';
  const outcome = candidateConcern
    ? request.candidateFollowUpOutcome
    : employerConcern
      ? request.employerFollowUpOutcome
      : null;
  const referenceAt =
    request.candidateFollowUpCompletedAt ||
    request.employerFollowUpCompletedAt ||
    request.updatedAt ||
    request.createdAt ||
    null;

  return {
    actionPath: `/interviews?issue=progression_follow_up_concern&progression=${encodeURIComponent(documentId)}`,
    candidateName,
    dueAt: referenceAt,
    employerDocumentId: employerDocumentId(request),
    employerName: employer,
    issue: 'progression_follow_up_concern',
    issueLabel: issueLabels.progression_follow_up_concern,
    priority: 'high',
    referenceAt,
    regionName: interview ? regionName(interview) : null,
    sourceDocumentId: documentId,
    sourceType: 'progression_request',
    statusLabel: outcome ? humanize(String(outcome)) : 'Needs review',
    summary: [
      'A one-month progression follow-up needs interview operations review.',
      candidateName ? `Candidate: ${candidateName}` : null,
      employer ? `Employer: ${employer}` : null,
      outcome ? `Outcome: ${humanize(String(outcome))}` : null,
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

const operationIssues = new Set<Exclude<OperationIssue, 'all'>>([
  'capacity_shortfall',
  'candidate_restriction_cancelled',
  'details_overdue',
  'details_pending',
  'details_released',
  'feedback_due',
  'feedback_overdue',
  'progression_expired',
  'progression_follow_up_concern',
]);

const operationIssueFromTask = (task: DocumentRecord): Exclude<OperationIssue, 'all'> | null => {
  const metadata = objectValue(task.metadata);
  const issue = stringValue(task.issueKey) || stringValue(metadata.issue);

  return issue && operationIssues.has(issue as Exclude<OperationIssue, 'all'>)
    ? (issue as Exclude<OperationIssue, 'all'>)
    : null;
};

const adminTaskVisibilityFilter = (session: AdminSession) => {
  if (session.user.roleKeys.includes('super_admin')) {
    return null;
  }

  if (session.user.roleKeys.some((roleKey) => ['sales', 'support'].includes(roleKey))) {
    return null;
  }

  return {
    $or: session.user.roleKeys.map((roleKey) => ({
      ownerKeyText: {
        $containsi: roleKey,
      },
    })),
  };
};

const operationSearchFilter = (search?: string) => {
  if (!search) {
    return null;
  }

  return {
    $or: [
      { candidateLabel: { $containsi: search } },
      { classLabel: { $containsi: search } },
      { employerLabel: { $containsi: search } },
      { issueKey: { $containsi: search } },
      { regionLabel: { $containsi: search } },
      { relatedDocumentId: { $containsi: search } },
      { searchText: { $containsi: search } },
      { sourceDocumentId: { $containsi: search } },
      { summary: { $containsi: search } },
      { taskKey: { $containsi: search } },
      { title: { $containsi: search } },
    ],
  };
};

const operationTaskFilters = ({
  issue,
  search,
  session,
}: {
  issue?: OperationIssue;
  search?: string;
  session: AdminSession;
}) => {
  const filters: Record<string, unknown> = {
    taskState: 'open',
    taskType: 'interview_operation',
  };
  const andFilters: Record<string, unknown>[] = [];

  if (issue && issue !== 'all') {
    filters.issueKey = issue;
  }

  const searchFilter = operationSearchFilter(search);
  const visibilityFilter = adminTaskVisibilityFilter(session);

  if (searchFilter) {
    andFilters.push(searchFilter);
  }

  if (visibilityFilter) {
    andFilters.push(visibilityFilter);
  }

  return andFilters.length ? { ...filters, $and: andFilters } : filters;
};

const operationTaskSort = (
  sortBy: 'candidate' | 'dueAt' | 'employer' | 'issue' | 'priority' | 'updatedAt',
  sortDirection: 'asc' | 'desc'
) => {
  const direction = sortDirection === 'desc' ? 'desc' : 'asc';
  const primary =
    sortBy === 'candidate'
      ? 'candidateLabel'
      : sortBy === 'employer'
        ? 'employerLabel'
        : sortBy === 'issue'
          ? 'issueKey'
          : sortBy === 'priority'
            ? 'priorityRank'
            : sortBy === 'updatedAt'
              ? 'lastDetectedAt'
              : 'dueAt';

  return [`${primary}:${direction}`, 'createdAt:desc'];
};

const operationSourceType = (task: DocumentRecord): OperationRow['sourceType'] => {
  if (task.sourceType === 'interview_request') {
    return 'interview_request';
  }

  if (task.sourceType === 'progression_request') {
    return 'progression_request';
  }

  return 'interview';
};

const metadataString = (metadata: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const value = stringValue(metadata[key]);

    if (value) {
      return value;
    }
  }

  return null;
};

const operationRowFromTask = (task: DocumentRecord): OperationRow | null => {
  const sourceDocumentId = stringValue(task.sourceDocumentId);
  const issue = operationIssueFromTask(task);

  if (!sourceDocumentId || !issue) {
    return null;
  }

  const metadata = objectValue(task.metadata);
  const dueAt =
    stringValue(task.dueAt) ||
    metadataString(metadata, [
      'candidateResponseDeadline',
      'dueAt',
      'employerDetailsDueAt',
      'feedbackDueAt',
      'releasedAt',
    ]);
  const referenceAt =
    stringValue(task.lastDetectedAt) ||
    metadataString(metadata, ['sourceDetectedAt', 'releasedAt', 'cancelledAt']) ||
    stringValue(task.updatedAt) ||
    stringValue(task.createdAt);
  const status =
    metadataString(metadata, [
      'interviewState',
      'progressionState',
      'requestState',
      'state',
    ]) ||
    stringValue(task.title) ||
    'Open';

  return {
    actionPath: stringValue(task.actionPath) || actionPath(issue, sourceDocumentId),
    candidateName:
      stringValue(task.candidateLabel) ||
      metadataString(metadata, ['candidateName', 'subjectName']),
    dueAt: dueAt || referenceAt,
    employerDocumentId: stringValue(metadata.employerDocumentId),
    employerName: stringValue(task.employerLabel) || metadataString(metadata, ['employerName']),
    issue,
    issueLabel: issueLabels[issue],
    priority: task.priority === 'urgent' || task.priority === 'high' ? task.priority : 'normal',
    referenceAt,
    regionName: stringValue(task.regionLabel) || metadataString(metadata, ['regionName']),
    sourceDocumentId,
    sourceType: operationSourceType(task),
    statusLabel: humanize(status),
    summary: stringValue(task.summary) || '',
    reliabilityEvent: null,
  };
};

const findAllDocuments = async (
  strapi: StrapiDocumentService,
  uid: string,
  input: Record<string, unknown>,
  pageSize = 100
) => {
  const collection = documents(strapi, uid);
  const filters = (input.filters || {}) as Record<string, unknown>;
  const total = await collection.count({ filters });
  const records: DocumentRecord[] = [];

  for (let start = 0; start < total; start += pageSize) {
    records.push(
      ...(await collection.findMany({
        ...input,
        limit: pageSize,
        start,
      }))
    );
  }

  return records;
};

export default ({ strapi }) => ({
  async getOperations(input: unknown, requestContext: RequestContext = {}) {
    const body = validateOperations(input);
    const session = await assertSession(strapi, body.sessionToken, requestContext);
    await adminTaskService(strapi).listTasks(
      {
        page: 1,
        pageSize: 1,
        sessionToken: body.sessionToken,
        taskState: 'open',
        taskType: 'interview_operation',
      },
      requestContext
    );

    const taskDocuments = documents(strapi, 'api::admin-task.admin-task');
    const baseFilters = operationTaskFilters({ issue: 'all', session });
    const filters = operationTaskFilters({
      issue: body.issue,
      search: body.search,
      session,
    });
    const filteredTotal = await taskDocuments.count({ filters });
    const pageCount = Math.max(1, Math.ceil(filteredTotal / body.pageSize));
    const page = Math.min(body.page, pageCount);
    const taskRecords = await taskDocuments.findMany({
      filters,
      limit: body.pageSize,
      sort: operationTaskSort(body.sortBy, body.sortDirection),
      start: (page - 1) * body.pageSize,
    });
    const compactRows = taskRecords
      .map(operationRowFromTask)
      .filter((row): row is OperationRow => Boolean(row));
    const reliabilitySourceDocumentIds = compactRows
      .map((row) => row.sourceDocumentId)
      .filter((documentId): documentId is string => Boolean(documentId));
    const reliabilityEventTypes = Object.values(reliabilityEventTypeByIssue);
    const reliabilityEvents =
      reliabilitySourceDocumentIds.length > 0
        ? await findAllDocuments(strapi, 'api::employer-reliability-event.employer-reliability-event', {
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
    const [
      capacityShortfall,
      detailsOverdue,
      detailsPending,
      detailsReleased,
      feedbackDue,
      feedbackOverdue,
      progressionFollowUpConcerns,
      totalOperations,
    ] = await Promise.all([
      taskDocuments.count({ filters: { ...baseFilters, issueKey: 'capacity_shortfall' } }),
      taskDocuments.count({ filters: { ...baseFilters, issueKey: 'details_overdue' } }),
      taskDocuments.count({ filters: { ...baseFilters, issueKey: 'details_pending' } }),
      taskDocuments.count({ filters: { ...baseFilters, issueKey: 'details_released' } }),
      taskDocuments.count({ filters: { ...baseFilters, issueKey: 'feedback_due' } }),
      taskDocuments.count({ filters: { ...baseFilters, issueKey: 'feedback_overdue' } }),
      taskDocuments.count({ filters: { ...baseFilters, issueKey: 'progression_follow_up_concern' } }),
      taskDocuments.count({ filters: baseFilters }),
    ]);

    return {
      counts: {
        capacityShortfall,
        detailsOverdue,
        detailsPending,
        detailsReleased,
        feedbackDue,
        feedbackOverdue,
        progressionFollowUpConcerns,
        total: totalOperations,
      },
      filteredOperations: filteredTotal,
      generatedAt: new Date().toISOString(),
      operations: rowsWithReliability,
      pagination: {
        page,
        pageCount,
        pageSize: body.pageSize,
        total: filteredTotal,
      },
      totalOperations,
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

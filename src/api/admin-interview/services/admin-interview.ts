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

type DocumentRecord = Record<string, unknown> & {
  candidate?: DocumentRecord;
  class?: DocumentRecord;
  companyName?: string;
  completedAt?: string;
  createdAt?: string;
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
  region?: DocumentRecord;
  requestState?: string;
  scheduledEndTime?: string;
  scheduledStartTime?: string;
  title?: string;
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
  | 'feedback_overdue';

type OperationRow = {
  actionPath: string;
  candidateName: string | null;
  dueAt: string | null;
  employerName: string | null;
  issue: Exclude<OperationIssue, 'all'>;
  issueLabel: string;
  priority: 'high' | 'normal' | 'urgent';
  referenceAt: string | null;
  regionName: string | null;
  sourceDocumentId: string;
  sourceType: 'interview' | 'interview_request';
  statusLabel: string;
  summary: string;
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
      ])
      .default('all'),
    search: z.string().trim().max(120).optional().transform((value) => value || undefined),
    sessionToken: z.string().trim().min(32).max(512),
    sortBy: z.enum(['candidate', 'dueAt', 'employer', 'issue', 'priority', 'updatedAt']).default('dueAt'),
    sortDirection: z.enum(['asc', 'desc']).default('asc'),
  })
  .strict();

const validateOperations = validateZodSchema(operationsSchema);

const documents = (strapi: StrapiDocumentService, uid: string) =>
  strapi.documents(uid) as unknown as DocumentCollection;

const adminAuthService = (strapi: StrapiDocumentService): AdminAuthService =>
  strapi.service('api::admin-auth.admin-auth') as unknown as AdminAuthService;

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

    const [interviews, requests] = await Promise.all([
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

    const filteredRows = rows
      .filter((row): row is OperationRow => Boolean(row))
      .filter((row) => body.issue === 'all' || row.issue === body.issue)
      .filter((row) => includesSearch(row, body.search))
      .sort(compareRows(body.sortBy, body.sortDirection));

    return {
      counts: {
        capacityShortfall: rows.filter((row) => row.issue === 'capacity_shortfall').length,
        detailsOverdue: rows.filter((row) => row.issue === 'details_overdue').length,
        detailsPending: rows.filter((row) => row.issue === 'details_pending').length,
        detailsReleased: rows.filter((row) => row.issue === 'details_released').length,
        feedbackDue: rows.filter((row) => row.issue === 'feedback_due').length,
        feedbackOverdue: rows.filter((row) => row.issue === 'feedback_overdue').length,
        total: rows.length,
      },
      filteredOperations: filteredRows.length,
      generatedAt: new Date().toISOString(),
      operations: filteredRows.slice(0, 200),
      totalOperations: rows.length,
      user: session.user,
    };
  },
});

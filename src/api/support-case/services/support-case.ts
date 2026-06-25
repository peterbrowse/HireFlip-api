import { validateZodSchema, z } from '@strapi/utils';

type DocumentRecord = Record<string, unknown> & {
  amountPence?: number;
  approvedAt?: string;
  caseKey?: string;
  caseState?: string;
  caseType?: string;
  candidate?: DocumentRecord;
  closedAt?: string;
  createdAt?: string;
  currency?: string;
  deliveryState?: string;
  documentId?: string;
  direction?: string;
  email?: string;
  enrollment?: DocumentRecord;
  firstName?: string;
  id?: number | string;
  lastMessageAt?: string;
  lastName?: string;
  metadata?: unknown;
  messageType?: string;
  openedAt?: string;
  ownerRoleKey?: string;
  ownerStaffDisplayName?: string;
  ownerStaffEmail?: string;
  ownerStaffUserId?: string;
  payment?: DocumentRecord;
  processedAt?: string;
  providerRefundId?: string;
  refundPercentage?: number | string;
  refund?: DocumentRecord;
  refundState?: string;
  requestedAt?: string;
  resolvedAt?: string;
  senderType?: string;
  senderDisplayName?: string;
  subject?: string;
  title?: string;
  updatedAt?: string;
  visibility?: string;
};

type DocumentCollection = {
  create(input: Record<string, unknown>): Promise<DocumentRecord>;
  findMany(input: Record<string, unknown>): Promise<DocumentRecord[]>;
  update(input: Record<string, unknown>): Promise<DocumentRecord>;
};

type StrapiDocumentService = {
  documents(uid: string): unknown;
};

type SupportCaseListInput = {
  caseState?: string;
  caseType?: string;
  limit?: number;
};

type SupportCaseDetailInput = {
  supportCaseDocumentId: string;
};

const documents = (strapi: StrapiDocumentService, uid: string) =>
  strapi.documents(uid) as unknown as DocumentCollection;

const objectValue = (value: unknown) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const getDocumentId = (record?: DocumentRecord | null) => {
  if (!record) {
    return undefined;
  }

  return typeof record.documentId === 'string'
    ? record.documentId
    : typeof record.id === 'number' || typeof record.id === 'string'
      ? String(record.id)
      : undefined;
};

const candidateDisplayName = (candidate?: DocumentRecord | null) => {
  if (!candidate) {
    return undefined;
  }

  const firstName = typeof candidate.firstName === 'string' ? candidate.firstName.trim() : '';
  const lastName = typeof candidate.lastName === 'string' ? candidate.lastName.trim() : '';
  const fullName = `${firstName} ${lastName}`.trim();

  return fullName || (typeof candidate.email === 'string' ? candidate.email : undefined);
};

const caseStateSchema = z.enum([
  'open',
  'awaiting_candidate',
  'awaiting_staff',
  'in_progress',
  'resolved',
  'closed',
]);

const caseTypeSchema = z.enum([
  'general',
  'refund',
  'payment',
  'course',
  'interview',
  'account',
  'privacy',
  'other',
]);

const prioritySchema = z.enum(['low', 'normal', 'high', 'urgent']);
const sourceSchema = z.enum([
  'candidate_dashboard',
  'admin_dashboard',
  'payment_service',
  'notification_service',
  'core_api',
  'system',
  'other',
]);
const messageTypeSchema = z.enum([
  'candidate_message',
  'staff_reply',
  'staff_note',
  'system_update',
  'outbound_email',
  'refund_refusal',
  'refund_acceptance',
  'refund_provider_update',
]);
const messageDirectionSchema = z.enum(['inbound', 'outbound', 'internal', 'system']);
const visibilitySchema = z.enum(['public', 'internal']);
const senderTypeSchema = z.enum(['candidate', 'admin', 'service', 'system']);
const deliveryStateSchema = z.enum(['not_required', 'queued', 'sent', 'delivered', 'failed']);

const ensureRefundCaseSchema = z
  .object({
    assignedTo: z
      .object({
        displayName: z.string().trim().max(240).optional(),
        email: z.string().trim().email().max(254).optional(),
        id: z.string().trim().max(160).optional(),
        roleKey: z.enum(['admin', 'sales', 'super_admin', 'support']).optional(),
      })
      .optional(),
    candidate: z.unknown().optional(),
    createdBy: z
      .object({
        displayName: z.string().trim().max(240).optional(),
        email: z.string().trim().email().max(254).optional(),
        id: z.string().trim().max(160).optional(),
        type: senderTypeSchema.default('system'),
      })
      .optional(),
    enrollment: z.unknown().optional(),
    payment: z.unknown().optional(),
    priority: prioritySchema.default('high'),
    refund: z.unknown(),
    source: sourceSchema.default('core_api'),
    state: caseStateSchema.default('open'),
    summary: z.string().trim().max(1000).optional(),
    title: z.string().trim().min(1).max(180).optional(),
  })
  .strict();

const ensureFeedbackReportConcernCaseSchema = z
  .object({
    candidate: z.unknown(),
    feedbackDocumentId: z.string().trim().min(1).max(160),
    flaggedAt: z.string().datetime(),
    interviewDocumentId: z.string().trim().min(1).max(160),
    reason: z.string().trim().min(10).max(4000),
    source: sourceSchema.default('candidate_dashboard'),
    summary: z.string().trim().max(1000).optional(),
    title: z.string().trim().min(1).max(180).optional(),
  })
  .strict();

const ensureInterviewStrikeDisputeCaseSchema = z
  .object({
    appealedAt: z.string().datetime(),
    candidate: z.unknown(),
    reason: z.string().trim().min(10).max(4000),
    source: sourceSchema.default('candidate_dashboard'),
    strikeDocumentId: z.string().trim().min(1).max(160),
    strikeNumber: z.number().int().positive().optional(),
    summary: z.string().trim().max(1000).optional(),
    title: z.string().trim().min(1).max(180).optional(),
  })
  .strict();

const addMessageSchema = z
  .object({
    body: z.string().trim().min(1).max(12000),
    candidate: z.unknown().optional(),
    deliveryState: deliveryStateSchema.default('not_required'),
    direction: messageDirectionSchema.default('system'),
    messageType: messageTypeSchema.default('system_update'),
    metadata: z.unknown().optional(),
    payment: z.unknown().optional(),
    refund: z.unknown().optional(),
    sender: z
      .object({
        displayName: z.string().trim().max(240).optional(),
        email: z.string().trim().email().max(254).optional(),
        id: z.string().trim().max(160).optional(),
        type: senderTypeSchema.default('system'),
      })
      .optional(),
    sentAt: z.string().datetime().optional(),
    subject: z.string().trim().max(180).optional(),
    supportCase: z.unknown(),
    visibility: visibilitySchema.default('internal'),
  })
  .strict();

const updateCaseStateSchema = z
  .object({
    caseState: caseStateSchema,
    metadata: z.unknown().optional(),
    supportCase: z.unknown(),
  })
  .strict();

const assignCaseSchema = z
  .object({
    assignedTo: z.object({
      displayName: z.string().trim().max(240),
      email: z.string().trim().email().max(254),
      id: z.string().trim().max(160),
      roleKey: z.enum(['admin', 'sales', 'super_admin', 'support']).optional(),
    }),
    metadata: z.unknown().optional(),
    supportCase: z.unknown(),
  })
  .strict();

const validateEnsureRefundCase = validateZodSchema(ensureRefundCaseSchema);
const validateEnsureFeedbackReportConcernCase = validateZodSchema(
  ensureFeedbackReportConcernCaseSchema
);
const validateEnsureInterviewStrikeDisputeCase = validateZodSchema(
  ensureInterviewStrikeDisputeCaseSchema
);
const validateAddMessage = validateZodSchema(addMessageSchema);
const validateUpdateCaseState = validateZodSchema(updateCaseStateSchema);
const validateAssignCase = validateZodSchema(assignCaseSchema);

const publicSupportMessage = (message: DocumentRecord) => ({
  body: message.body || '',
  createdAt: message.createdAt || null,
  deliveryState: message.deliveryState || null,
  direction: message.direction || null,
  documentId: getDocumentId(message) || null,
  messageType: message.messageType || null,
  senderDisplayName: message.senderDisplayName || null,
  senderType: message.senderType || null,
  subject: message.subject || null,
  visibility: message.visibility || null,
});

const candidateSupportMessage = (message: DocumentRecord) => ({
  body: message.body || '',
  createdAt: message.createdAt || null,
  direction: message.direction || null,
  documentId: getDocumentId(message) || null,
  messageType: message.messageType || null,
  senderDisplayName: message.senderDisplayName || null,
  senderType: message.senderType || null,
  subject: message.subject || null,
});

const formatMoney = (amountPence?: number, currency = 'GBP') => {
  if (typeof amountPence !== 'number') {
    return undefined;
  }

  return new Intl.NumberFormat('en-GB', {
    currency,
    style: 'currency',
  }).format(amountPence / 100);
};

const supportCaseRefundSummary = (
  refund?: DocumentRecord | null,
  { includeProvider = false } = {}
) => {
  if (!refund) {
    return null;
  }

  return {
    amountPence: refund.amountPence ?? null,
    approvedAt: refund.approvedAt || null,
    currency: refund.currency || null,
    documentId: getDocumentId(refund) || null,
    formattedAmount: formatMoney(refund.amountPence, refund.currency || 'GBP') || null,
    processedAt: refund.processedAt || null,
    ...(includeProvider ? { providerRefundId: refund.providerRefundId || null } : {}),
    refundPercentage: refund.refundPercentage ?? null,
    refundState: refund.refundState || null,
    requestedAt: refund.requestedAt || null,
  };
};

type CaseTrackingStepState = 'attention' | 'complete' | 'current' | 'upcoming';

const trackingStep = ({
  detail,
  key,
  label,
  occurredAt = null,
  state,
}: {
  detail: string;
  key: string;
  label: string;
  occurredAt?: string | null;
  state: CaseTrackingStepState;
}) => ({
  detail,
  key,
  label,
  occurredAt,
  state,
});

const supportCaseHasPublicCandidateReply = (messages: DocumentRecord[]) =>
  messages.some(
    (message) =>
      message.visibility === 'public' &&
      (message.senderType === 'candidate' || message.messageType === 'candidate_message')
  );

const refundCaseTracking = (supportCase: DocumentRecord, messages: DocumentRecord[]) => {
  const caseState = String(supportCase.caseState || 'open');
  const refundState = String(supportCase.refund?.refundState || '');
  const openedAt = supportCase.openedAt || supportCase.createdAt || null;
  const candidateReplied = supportCaseHasPublicCandidateReply(messages);
  const caseClosed = ['closed', 'resolved'].includes(caseState);
  const refundDecisioned = [
    'approved',
    'rejected',
    'submitted_to_provider',
    'processing',
    'completed',
    'failed',
    'cancelled',
  ].includes(refundState);
  const providerStarted = ['submitted_to_provider', 'processing', 'completed', 'failed'].includes(
    refundState
  );

  const steps = [
    trackingStep({
      detail: 'HireFlip has received the refund support case.',
      key: 'opened',
      label: 'Request opened',
      occurredAt: openedAt,
      state: 'complete',
    }),
    trackingStep({
      detail:
        caseState === 'open'
          ? 'The request is waiting to be picked up by the team.'
          : 'HireFlip is reviewing the refund request and related case history.',
      key: 'hireflip_review',
      label: 'HireFlip review',
      occurredAt: caseState === 'open' ? null : supportCase.updatedAt || supportCase.lastMessageAt || openedAt,
      state: caseState === 'open' ? 'current' : refundDecisioned || caseClosed ? 'complete' : 'current',
    }),
    trackingStep({
      detail: candidateReplied
        ? 'A candidate reply has been recorded on this case.'
        : caseState === 'awaiting_candidate'
          ? 'HireFlip is waiting for a reply in the dashboard.'
          : 'No candidate reply is required right now.',
      key: 'candidate_reply',
      label: 'Candidate reply',
      occurredAt: messages.find((message) => message.senderType === 'candidate')?.createdAt || null,
      state: candidateReplied ? 'complete' : caseState === 'awaiting_candidate' ? 'current' : 'upcoming',
    }),
    trackingStep({
      detail:
        refundState === 'rejected'
          ? 'The refund request has been refused on the current evidence.'
          : refundState === 'approved'
            ? 'The refund has been approved and is waiting for provider execution.'
            : refundState === 'failed'
              ? 'The provider refund failed and needs review.'
              : refundDecisioned
                ? 'A refund decision has been recorded.'
                : 'The refund decision has not been recorded yet.',
      key: 'refund_decision',
      label: 'Refund decision',
      occurredAt: supportCase.refund?.approvedAt || supportCase.refund?.processedAt || null,
      state:
        refundState === 'failed'
          ? 'attention'
          : refundDecisioned
            ? 'complete'
            : caseState === 'awaiting_staff' || caseState === 'in_progress'
              ? 'current'
              : 'upcoming',
    }),
    trackingStep({
      detail:
        refundState === 'completed'
          ? 'The payment provider has confirmed the refund.'
          : refundState === 'failed'
            ? 'The provider refund needs attention.'
            : providerStarted || refundState === 'approved'
              ? 'The refund is waiting for provider completion.'
              : 'No provider refund has been submitted yet.',
      key: 'provider_refund',
      label: 'Provider refund',
      occurredAt: supportCase.refund?.processedAt || null,
      state:
        refundState === 'completed'
          ? 'complete'
          : refundState === 'failed'
            ? 'attention'
            : providerStarted || refundState === 'approved'
              ? 'current'
              : 'upcoming',
    }),
    trackingStep({
      detail: caseClosed ? 'The support case is closed.' : 'The case remains open.',
      key: 'closed',
      label: 'Closed',
      occurredAt: supportCase.closedAt || supportCase.resolvedAt || null,
      state: caseClosed ? 'complete' : 'upcoming',
    }),
  ];
  const activeStep =
    steps.find((step) => step.state === 'attention') ||
    steps.find((step) => step.state === 'current') ||
    [...steps].reverse().find((step) => step.state === 'complete') ||
    steps[0];

  return {
    currentLabel: activeStep?.label || 'Case opened',
    nextAction:
      caseState === 'awaiting_candidate'
        ? 'Reply in the dashboard so the team can continue the review.'
        : refundState === 'approved'
          ? 'The approved refund is waiting to be sent to the payment provider.'
          : refundState === 'failed'
            ? 'HireFlip needs to review the failed provider refund.'
            : caseClosed
              ? null
              : 'HireFlip will update this case when there is a decision or reply.',
    steps,
  };
};

const generalCaseTracking = (supportCase: DocumentRecord, messages: DocumentRecord[]) => {
  const caseState = String(supportCase.caseState || 'open');
  const openedAt = supportCase.openedAt || supportCase.createdAt || null;
  const caseClosed = ['closed', 'resolved'].includes(caseState);
  const candidateReplied = supportCaseHasPublicCandidateReply(messages);
  const steps = [
    trackingStep({
      detail: 'HireFlip has received the support case.',
      key: 'opened',
      label: 'Case opened',
      occurredAt: openedAt,
      state: 'complete',
    }),
    trackingStep({
      detail:
        caseState === 'awaiting_candidate'
          ? 'HireFlip is waiting for a candidate reply.'
          : 'HireFlip is reviewing the case.',
      key: 'review',
      label: 'Review',
      occurredAt: supportCase.lastMessageAt || supportCase.updatedAt || null,
      state: caseClosed ? 'complete' : 'current',
    }),
    trackingStep({
      detail: candidateReplied
        ? 'A candidate reply has been recorded.'
        : 'No candidate reply is required right now.',
      key: 'candidate_reply',
      label: 'Candidate reply',
      occurredAt: messages.find((message) => message.senderType === 'candidate')?.createdAt || null,
      state: candidateReplied ? 'complete' : caseState === 'awaiting_candidate' ? 'current' : 'upcoming',
    }),
    trackingStep({
      detail: caseClosed ? 'The support case is closed.' : 'The case remains open.',
      key: 'closed',
      label: 'Closed',
      occurredAt: supportCase.closedAt || supportCase.resolvedAt || null,
      state: caseClosed ? 'complete' : 'upcoming',
    }),
  ];
  const activeStep =
    steps.find((step) => step.state === 'current') ||
    [...steps].reverse().find((step) => step.state === 'complete') ||
    steps[0];

  return {
    currentLabel: activeStep?.label || 'Case opened',
    nextAction:
      caseState === 'awaiting_candidate'
        ? 'Reply in the dashboard so the team can continue the review.'
        : caseClosed
          ? null
          : 'HireFlip will update this case when there is a reply or decision.',
    steps,
  };
};

const supportCaseTracking = (supportCase: DocumentRecord, messages: DocumentRecord[] = []) =>
  supportCase.caseType === 'refund'
    ? refundCaseTracking(supportCase, messages)
    : generalCaseTracking(supportCase, messages);

const publicSupportCase = (supportCase: DocumentRecord, messages: DocumentRecord[] = []) => ({
  caseTracking: supportCaseTracking(supportCase, messages),
  caseKey: supportCase.caseKey || null,
  caseState: supportCase.caseState || null,
  caseType: supportCase.caseType || null,
  candidate: supportCase.candidate
    ? {
        displayName: candidateDisplayName(supportCase.candidate) || null,
        documentId: getDocumentId(supportCase.candidate) || null,
        email: supportCase.candidate.email || null,
      }
    : null,
  createdAt: supportCase.createdAt || null,
  documentId: getDocumentId(supportCase) || null,
  lastMessageAt: supportCase.lastMessageAt || null,
  messages: messages.map(publicSupportMessage),
  owner: supportCase.ownerStaffUserId
    ? {
        displayName: supportCase.ownerStaffDisplayName || null,
        email: supportCase.ownerStaffEmail || null,
        id: supportCase.ownerStaffUserId || null,
        roleKey: supportCase.ownerRoleKey || null,
      }
    : null,
  priority: supportCase.priority || null,
  refund: supportCaseRefundSummary(supportCase.refund, { includeProvider: true }),
  summary: supportCase.summary || null,
  title: supportCase.title || null,
  updatedAt: supportCase.updatedAt || null,
});

const candidateSupportCase = (supportCase: DocumentRecord, messages: DocumentRecord[] = []) => ({
  caseTracking: supportCaseTracking(supportCase, messages),
  caseKey: supportCase.caseKey || null,
  caseState: supportCase.caseState || null,
  caseType: supportCase.caseType || null,
  createdAt: supportCase.createdAt || null,
  documentId: getDocumentId(supportCase) || null,
  lastMessageAt: supportCase.lastMessageAt || null,
  messages: messages
    .filter((message) => message.visibility === 'public')
    .map(candidateSupportMessage),
  priority: supportCase.priority || null,
  refund: supportCaseRefundSummary(supportCase.refund),
  summary: supportCase.summary || null,
  title: supportCase.title || null,
  updatedAt: supportCase.updatedAt || null,
});

const supportCaseKeyForRefund = (refund: DocumentRecord) =>
  `refund:${getDocumentId(refund) || 'unknown'}:support`;

const supportCaseKeyForFeedbackReportConcern = (feedbackDocumentId: string) =>
  `interview-feedback-report:${feedbackDocumentId}:candidate-concern`;

const supportCaseKeyForInterviewStrikeDispute = (strikeDocumentId: string) =>
  `candidate-interview-strike:${strikeDocumentId}:dispute`;

const relationConnect = (record?: DocumentRecord | null) =>
  getDocumentId(record) ? { connect: [{ documentId: getDocumentId(record) }] } : undefined;

const findCaseByKey = async (strapi: StrapiDocumentService, caseKey: string) => {
  const cases = await documents(strapi, 'api::support-case.support-case').findMany({
    filters: {
      caseKey,
    },
    limit: 1,
    populate: ['candidate', 'refund', 'payment', 'enrollment'],
  });

  return cases[0];
};

const messagesForCase = async (strapi: StrapiDocumentService, supportCaseDocumentId?: string) => {
  if (!supportCaseDocumentId) {
    return [];
  }

  return documents(strapi, 'api::support-message.support-message').findMany({
    filters: {
      supportCase: {
        documentId: supportCaseDocumentId,
      },
    },
    limit: 100,
    sort: ['createdAt:asc'],
  });
};

const defaultRefundCaseTitle = (refund: DocumentRecord, candidate?: DocumentRecord) => {
  const candidateName = candidateDisplayName(candidate);
  const state = typeof refund.refundState === 'string' ? refund.refundState : 'review';

  return candidateName
    ? `Refund support case for ${candidateName}`
    : `Refund support case (${state})`;
};

export default ({ strapi }: { strapi: StrapiDocumentService }) => ({
  async ensureRefundCase(input: unknown) {
    const body = validateEnsureRefundCase(input);
    const refund = body.refund as DocumentRecord;
    const candidate = body.candidate as DocumentRecord | undefined;
    const payment = body.payment as DocumentRecord | undefined;
    const enrollment = body.enrollment as DocumentRecord | undefined;
    const caseKey = supportCaseKeyForRefund(refund);
    const existingCase = await findCaseByKey(strapi, caseKey);

    if (existingCase) {
      if (body.assignedTo?.id && !existingCase.ownerStaffUserId) {
        const assignedCase = await documents(strapi, 'api::support-case.support-case').update({
          documentId: existingCase.documentId,
          data: {
            assignedAt: new Date().toISOString(),
            ownerRoleKey: body.assignedTo.roleKey,
            ownerStaffDisplayName: body.assignedTo.displayName,
            ownerStaffEmail: body.assignedTo.email,
            ownerStaffUserId: body.assignedTo.id,
          },
          populate: ['candidate', 'refund', 'payment', 'enrollment'],
        });

        return {
          created: false,
          supportCase: assignedCase,
        };
      }

      return {
        created: false,
        supportCase: existingCase,
      };
    }

    const now = new Date().toISOString();
    const createdCase = await documents(strapi, 'api::support-case.support-case').create({
      data: {
        candidate: relationConnect(candidate),
        caseKey,
        caseState: body.state,
        caseType: 'refund',
        enrollment: relationConnect(enrollment),
        assignedAt: body.assignedTo?.id ? now : undefined,
        lastMessageAt: now,
        metadata: {
          refundDocumentId: getDocumentId(refund),
        },
        openedAt: now,
        openedByDisplayName: body.createdBy?.displayName,
        openedByEmail: body.createdBy?.email,
        openedByStaffUserId: body.createdBy?.id,
        openedByType: body.createdBy?.type || 'system',
        ownerRoleKey: body.assignedTo?.roleKey,
        ownerStaffDisplayName: body.assignedTo?.displayName,
        ownerStaffEmail: body.assignedTo?.email,
        ownerStaffUserId: body.assignedTo?.id,
        payment: relationConnect(payment),
        priority: body.priority,
        refund: relationConnect(refund),
        source: body.source,
        summary: body.summary,
        title: body.title || defaultRefundCaseTitle(refund, candidate),
      },
      populate: ['candidate', 'refund', 'payment', 'enrollment'],
    });

    return {
      created: true,
      supportCase: createdCase,
    };
  },

  async ensureFeedbackReportConcernCase(input: unknown) {
    const body = validateEnsureFeedbackReportConcernCase(input);
    const candidate = body.candidate as DocumentRecord;
    const caseKey = supportCaseKeyForFeedbackReportConcern(body.feedbackDocumentId);
    const existingCase = await findCaseByKey(strapi, caseKey);
    const candidateName = candidateDisplayName(candidate);
    const title = body.title || (candidateName
      ? `AI feedback report review for ${candidateName}`
      : 'AI feedback report review');
    const summary =
      body.summary ||
      'Candidate has flagged their AI-generated interview feedback report for staff review.';
    const metadata = {
      feedbackDocumentId: body.feedbackDocumentId,
      flaggedAt: body.flaggedAt,
      interviewDocumentId: body.interviewDocumentId,
      kind: 'ai_feedback_report_concern',
      reason: body.reason,
    };

    if (existingCase) {
      const shouldReopen = ['closed', 'resolved'].includes(String(existingCase.caseState || ''));
      const supportCase = shouldReopen && existingCase.documentId
        ? await documents(strapi, 'api::support-case.support-case').update({
            documentId: existingCase.documentId,
            data: {
              caseState: 'awaiting_staff',
              closedAt: null,
              lastMessageAt: body.flaggedAt,
              metadata: {
                ...objectValue(existingCase.metadata),
                ...metadata,
                reopenedAt: body.flaggedAt,
              },
              resolvedAt: null,
            },
            populate: ['candidate', 'refund', 'payment', 'enrollment'],
          })
        : existingCase;

      return {
        created: false,
        supportCase,
      };
    }

    const supportCase = await documents(strapi, 'api::support-case.support-case').create({
      data: {
        candidate: relationConnect(candidate),
        caseKey,
        caseState: 'awaiting_staff',
        caseType: 'interview',
        lastMessageAt: body.flaggedAt,
        metadata,
        openedAt: body.flaggedAt,
        openedByDisplayName: candidateName,
        openedByEmail: candidate.email,
        openedByType: 'candidate',
        priority: 'high',
        source: body.source,
        summary,
        title,
      },
      populate: ['candidate', 'refund', 'payment', 'enrollment'],
    });

    return {
      created: true,
      supportCase,
    };
  },

  async ensureInterviewStrikeDisputeCase(input: unknown) {
    const body = validateEnsureInterviewStrikeDisputeCase(input);
    const candidate = body.candidate as DocumentRecord;
    const caseKey = supportCaseKeyForInterviewStrikeDispute(body.strikeDocumentId);
    const existingCase = await findCaseByKey(strapi, caseKey);
    const candidateName = candidateDisplayName(candidate);
    const strikeLabel = body.strikeNumber ? `strike ${body.strikeNumber}` : 'interview strike';
    const title = body.title || (candidateName
      ? `Interview strike dispute for ${candidateName}`
      : 'Interview strike dispute');
    const summary =
      body.summary ||
      `Candidate has disputed ${strikeLabel}.`;
    const metadata = {
      appealedAt: body.appealedAt,
      kind: 'candidate_interview_strike_dispute',
      reason: body.reason,
      strikeDocumentId: body.strikeDocumentId,
      strikeNumber: body.strikeNumber || null,
    };

    if (existingCase) {
      const shouldReopen = ['closed', 'resolved'].includes(String(existingCase.caseState || ''));
      const supportCase = shouldReopen && existingCase.documentId
        ? await documents(strapi, 'api::support-case.support-case').update({
            documentId: existingCase.documentId,
            data: {
              caseState: 'awaiting_staff',
              closedAt: null,
              lastMessageAt: body.appealedAt,
              metadata: {
                ...objectValue(existingCase.metadata),
                ...metadata,
                reopenedAt: body.appealedAt,
              },
              resolvedAt: null,
            },
            populate: ['candidate', 'refund', 'payment', 'enrollment'],
          })
        : existingCase;

      return {
        created: false,
        supportCase,
      };
    }

    const supportCase = await documents(strapi, 'api::support-case.support-case').create({
      data: {
        candidate: relationConnect(candidate),
        caseKey,
        caseState: 'awaiting_staff',
        caseType: 'interview',
        lastMessageAt: body.appealedAt,
        metadata,
        openedAt: body.appealedAt,
        openedByDisplayName: candidateName,
        openedByEmail: candidate.email,
        openedByType: 'candidate',
        priority: 'high',
        source: body.source,
        summary,
        title,
      },
      populate: ['candidate', 'refund', 'payment', 'enrollment'],
    });

    return {
      created: true,
      supportCase,
    };
  },

  async addMessage(input: unknown) {
    const body = validateAddMessage(input);
    const supportCase = body.supportCase as DocumentRecord;
    const candidate = body.candidate as DocumentRecord | undefined;
    const refund = body.refund as DocumentRecord | undefined;
    const payment = body.payment as DocumentRecord | undefined;
    const now = new Date().toISOString();
    const message = await documents(strapi, 'api::support-message.support-message').create({
      data: {
        body: body.body,
        candidate: relationConnect(candidate),
        deliveryState: body.deliveryState,
        direction: body.direction,
        messageType: body.messageType,
        metadata: objectValue(body.metadata),
        payment: relationConnect(payment),
        refund: relationConnect(refund),
        senderDisplayName: body.sender?.displayName,
        senderEmail: body.sender?.email,
        senderId: body.sender?.id,
        senderType: body.sender?.type || 'system',
        sentAt: body.sentAt,
        subject: body.subject,
        supportCase: relationConnect(supportCase),
        visibility: body.visibility,
      },
      populate: ['supportCase', 'candidate', 'refund', 'payment'],
    });

    if (supportCase.documentId) {
      await documents(strapi, 'api::support-case.support-case').update({
        documentId: supportCase.documentId,
        data: {
          lastMessageAt: now,
        },
      });
    }

    return message;
  },

  async updateCaseState(input: unknown) {
    const body = validateUpdateCaseState(input);
    const supportCase = body.supportCase as DocumentRecord;
    const now = new Date().toISOString();
    const resolvedState = ['resolved', 'closed'].includes(body.caseState);

    return documents(strapi, 'api::support-case.support-case').update({
      documentId: getDocumentId(supportCase),
      data: {
        caseState: body.caseState,
        closedAt: body.caseState === 'closed' ? now : null,
        metadata: {
          ...(objectValue(supportCase.metadata)),
          ...(objectValue(body.metadata)),
        },
        resolvedAt: resolvedState ? now : null,
      },
      populate: ['candidate', 'refund', 'payment', 'enrollment'],
    });
  },

  async assignCase(input: unknown) {
    const body = validateAssignCase(input);
    const supportCase = body.supportCase as DocumentRecord;

    return documents(strapi, 'api::support-case.support-case').update({
      documentId: getDocumentId(supportCase),
      data: {
        assignedAt: new Date().toISOString(),
        metadata: {
          ...(objectValue(supportCase.metadata)),
          ...(objectValue(body.metadata)),
        },
        ownerRoleKey: body.assignedTo.roleKey,
        ownerStaffDisplayName: body.assignedTo.displayName,
        ownerStaffEmail: body.assignedTo.email,
        ownerStaffUserId: body.assignedTo.id,
      },
      populate: ['candidate', 'refund', 'payment', 'enrollment'],
    });
  },

  async casesForRefund(refundDocumentId: string) {
    const cases = await documents(strapi, 'api::support-case.support-case').findMany({
      filters: {
        refund: {
          documentId: refundDocumentId,
        },
      },
      limit: 20,
      populate: ['candidate', 'refund', 'payment', 'enrollment'],
      sort: ['lastMessageAt:desc', 'createdAt:desc'],
    });

    return Promise.all(
      cases.map(async (supportCase) =>
        publicSupportCase(supportCase, await messagesForCase(strapi, getDocumentId(supportCase)))
      )
    );
  },

  async getCase(input: SupportCaseDetailInput) {
    const cases = await documents(strapi, 'api::support-case.support-case').findMany({
      filters: {
        documentId: input.supportCaseDocumentId,
      },
      limit: 1,
      populate: ['candidate', 'refund', 'payment', 'enrollment'],
    });
    const supportCase = cases[0];

    if (!supportCase) {
      return null;
    }

    return publicSupportCase(
      supportCase,
      await messagesForCase(strapi, getDocumentId(supportCase))
    );
  },

  async casesForCandidate(candidateDocumentId: string) {
    const cases = await documents(strapi, 'api::support-case.support-case').findMany({
      filters: {
        candidate: {
          documentId: candidateDocumentId,
        },
      },
      limit: 50,
      populate: ['candidate', 'refund', 'payment', 'enrollment'],
      sort: ['lastMessageAt:desc', 'createdAt:desc'],
    });

    return Promise.all(
      cases.map(async (supportCase) =>
        candidateSupportCase(
          supportCase,
          await messagesForCase(strapi, getDocumentId(supportCase))
        )
      )
    );
  },

  async getCaseForCandidate({
    candidateDocumentId,
    supportCaseDocumentId,
  }: {
    candidateDocumentId: string;
    supportCaseDocumentId: string;
  }) {
    const cases = await documents(strapi, 'api::support-case.support-case').findMany({
      filters: {
        candidate: {
          documentId: candidateDocumentId,
        },
        documentId: supportCaseDocumentId,
      },
      limit: 1,
      populate: ['candidate', 'refund', 'payment', 'enrollment'],
    });
    const supportCase = cases[0];

    if (!supportCase) {
      return null;
    }

    return candidateSupportCase(
      supportCase,
      await messagesForCase(strapi, getDocumentId(supportCase))
    );
  },

  async listCases(input: SupportCaseListInput = {}) {
    const safeLimit = Math.min(Math.max(Number(input.limit) || 50, 1), 100);
    const cases = await documents(strapi, 'api::support-case.support-case').findMany({
      filters: {
        ...(input.caseState ? { caseState: input.caseState } : {}),
        ...(input.caseType ? { caseType: input.caseType } : {}),
      },
      limit: safeLimit,
      populate: ['candidate', 'refund', 'payment', 'enrollment'],
      sort: ['lastMessageAt:desc', 'createdAt:desc'],
    });

    return Promise.all(
      cases.map(async (supportCase) =>
        publicSupportCase(supportCase, await messagesForCase(strapi, getDocumentId(supportCase)))
      )
    );
  },
});

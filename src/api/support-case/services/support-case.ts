import { validateZodSchema, z } from '@strapi/utils';

type DocumentRecord = Record<string, unknown> & {
  amountPence?: number;
  caseKey?: string;
  caseState?: string;
  caseType?: string;
  candidate?: DocumentRecord;
  createdAt?: string;
  currency?: string;
  documentId?: string;
  email?: string;
  enrollment?: DocumentRecord;
  firstName?: string;
  id?: number | string;
  lastMessageAt?: string;
  lastName?: string;
  metadata?: unknown;
  ownerRoleKey?: string;
  ownerStaffDisplayName?: string;
  ownerStaffEmail?: string;
  ownerStaffUserId?: string;
  payment?: DocumentRecord;
  refund?: DocumentRecord;
  refundState?: string;
  senderDisplayName?: string;
  subject?: string;
  title?: string;
  updatedAt?: string;
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

const publicSupportCase = (supportCase: DocumentRecord, messages: DocumentRecord[] = []) => ({
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
  refund: supportCase.refund
    ? {
        documentId: getDocumentId(supportCase.refund) || null,
        refundState: supportCase.refund.refundState || null,
      }
    : null,
  summary: supportCase.summary || null,
  title: supportCase.title || null,
  updatedAt: supportCase.updatedAt || null,
});

const supportCaseKeyForRefund = (refund: DocumentRecord) =>
  `refund:${getDocumentId(refund) || 'unknown'}:support`;

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

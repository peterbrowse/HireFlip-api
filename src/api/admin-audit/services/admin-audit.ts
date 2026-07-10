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
  actorDisplayName?: string;
  actorEmail?: string;
  actorId?: string;
  actorType?: string;
  correlationId?: string;
  createdAt?: string;
  documentId?: string;
  eventCategory?: string;
  eventType?: string;
  id?: number | string;
  ipAddress?: string;
  metadata?: unknown;
  newState?: unknown;
  occurredAt?: string;
  previousState?: unknown;
  requestId?: string;
  serviceName?: string;
  severity?: string;
  source?: string;
  subjectDisplayName?: string;
  subjectId?: string;
  subjectType?: string;
  userAgent?: string;
};

type DocumentCollection = {
  count(input: Record<string, unknown>): Promise<number>;
  findMany(input: Record<string, unknown>): Promise<DocumentRecord[]>;
};

type StrapiDocumentService = {
  documents(uid: string): unknown;
  service(uid: string): unknown;
};

const eventCategories = [
  'admin',
  'assessment',
  'candidate',
  'course',
  'employer',
  'file',
  'interview',
  'notification',
  'payment',
  'privacy',
  'progression',
  'recruitment',
  'refund',
  'security',
  'support',
  'system',
] as const;

const sources = [
  'admin_dashboard',
  'ai_service',
  'candidate_dashboard',
  'core_api',
  'employer_dashboard',
  'notification_service',
  'payment_service',
  'recruitment_platform',
  'strapi_admin',
  'system',
] as const;

const auditSearchSchema = z
  .object({
    actor: z.string().trim().max(180).optional().transform((value) => value || undefined),
    category: z.enum(eventCategories).optional(),
    dateFrom: z.string().datetime().optional(),
    dateTo: z.string().datetime().optional(),
    eventType: z.string().trim().max(180).optional().transform((value) => value || undefined),
    ipAddress: z.string().trim().max(120).optional().transform((value) => value || undefined),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(10).max(100).default(25),
    requestId: z.string().trim().max(160).optional().transform((value) => value || undefined),
    search: z.string().trim().max(180).optional().transform((value) => value || undefined),
    sessionToken: z.string().trim().min(32).max(512),
    source: z.enum(sources).optional(),
    subject: z.string().trim().max(180).optional().transform((value) => value || undefined),
  })
  .strict();

const validateAuditSearch = validateZodSchema(auditSearchSchema);

const documents = (strapi: StrapiDocumentService, uid: string) =>
  strapi.documents(uid) as unknown as DocumentCollection;

const adminAuthService = (strapi: StrapiDocumentService) =>
  strapi.service('api::admin-auth.admin-auth') as unknown as AdminAuthService;

const assertAuditSession = async (
  strapi: StrapiDocumentService,
  sessionToken: string,
  context: RequestContext
) => {
  const session = await adminAuthService(strapi).getSession({ sessionToken }, context);

  if (!session.user.roleKeys.some((roleKey) => ['admin', 'super_admin'].includes(roleKey))) {
    throw new ForbiddenError('Admin or Super Admin access is required for audit logs.');
  }

  return session;
};

const getDocumentId = (record?: DocumentRecord | null) => {
  if (!record) {
    return null;
  }

  return typeof record.documentId === 'string'
    ? record.documentId
    : typeof record.id === 'number' || typeof record.id === 'string'
      ? String(record.id)
      : null;
};

const containsFilter = (value: string) => ({
  $containsi: value,
});

const publicAuditEvent = (event: DocumentRecord) => ({
  actorDisplayName: event.actorDisplayName || null,
  actorEmail: event.actorEmail || null,
  actorId: event.actorId || null,
  actorType: event.actorType || null,
  correlationId: event.correlationId || null,
  documentId: getDocumentId(event),
  eventCategory: event.eventCategory || null,
  eventType: event.eventType || null,
  ipAddress: event.ipAddress || null,
  metadata: event.metadata || null,
  newState: event.newState || null,
  occurredAt: event.occurredAt || event.createdAt || null,
  previousState: event.previousState || null,
  requestId: event.requestId || null,
  serviceName: event.serviceName || null,
  severity: event.severity || null,
  source: event.source || null,
  subjectDisplayName: event.subjectDisplayName || null,
  subjectId: event.subjectId || null,
  subjectType: event.subjectType || null,
  userAgent: event.userAgent || null,
});

const option = (value: string) => ({
  label: value.replace(/[_-]+/g, ' '),
  value,
});

export default ({ strapi }: { strapi: StrapiDocumentService }) => ({
  async search(input: unknown, requestContext: RequestContext = {}) {
    const body = validateAuditSearch(input);
    const session = await assertAuditSession(strapi, body.sessionToken, requestContext);
    const filters: Record<string, unknown> = {};
    const andFilters: Record<string, unknown>[] = [];

    if (body.actor) {
      andFilters.push({
        $or: [
          { actorDisplayName: containsFilter(body.actor) },
          { actorEmail: containsFilter(body.actor) },
          { actorId: containsFilter(body.actor) },
          { actorType: containsFilter(body.actor) },
        ],
      });
    }

    if (body.search) {
      andFilters.push({
        $or: [
          { actorDisplayName: containsFilter(body.search) },
          { actorEmail: containsFilter(body.search) },
          { actorId: containsFilter(body.search) },
          { actorType: containsFilter(body.search) },
          { eventCategory: containsFilter(body.search) },
          { eventType: containsFilter(body.search) },
          { ipAddress: containsFilter(body.search) },
          { requestId: containsFilter(body.search) },
          { serviceName: containsFilter(body.search) },
          { source: containsFilter(body.search) },
          { subjectDisplayName: containsFilter(body.search) },
          { subjectId: containsFilter(body.search) },
          { subjectType: containsFilter(body.search) },
        ],
      });
    }

    if (body.subject) {
      andFilters.push({
        $or: [
          { subjectDisplayName: containsFilter(body.subject) },
          { subjectId: containsFilter(body.subject) },
          { subjectType: containsFilter(body.subject) },
        ],
      });
    }

    if (body.eventType) {
      filters.eventType = containsFilter(body.eventType);
    }

    if (body.category) {
      filters.eventCategory = body.category;
    }

    if (body.source) {
      filters.source = body.source;
    }

    if (body.ipAddress) {
      filters.ipAddress = containsFilter(body.ipAddress);
    }

    if (body.requestId) {
      filters.requestId = containsFilter(body.requestId);
    }

    if (body.dateFrom || body.dateTo) {
      filters.occurredAt = {
        ...(body.dateFrom ? { $gte: body.dateFrom } : {}),
        ...(body.dateTo ? { $lte: body.dateTo } : {}),
      };
    }

    const auditFilters = andFilters.length > 0 ? { ...filters, $and: andFilters } : filters;
    const auditEventDocuments = documents(strapi, 'api::audit-event.audit-event');
    const total = await auditEventDocuments.count({
      filters: auditFilters,
    });
    const pageCount = Math.max(1, Math.ceil(total / body.pageSize));
    const page = Math.min(body.page, pageCount);
    const auditEvents = await auditEventDocuments.findMany({
      filters: auditFilters,
      start: (page - 1) * body.pageSize,
      limit: body.pageSize,
      sort: ['occurredAt:desc', 'createdAt:desc'],
    });

    return {
      auditEvents: auditEvents.map(publicAuditEvent),
      filters: {
        categories: eventCategories.map(option),
        sources: sources.map(option),
      },
      generatedAt: new Date().toISOString(),
      pagination: {
        page,
        pageCount,
        pageSize: body.pageSize,
        total,
      },
      totalReturned: total,
      user: session.user,
    };
  },
});

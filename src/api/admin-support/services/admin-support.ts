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

type SupportCaseService = {
  assignCase(input: unknown): Promise<unknown>;
  getCase(input: {
    supportCaseDocumentId: string;
  }): Promise<unknown | null>;
  listCases(input?: {
    caseState?: string;
    caseType?: string;
    limit?: number;
  }): Promise<unknown[]>;
};

type StrapiService = {
  service(uid: string): unknown;
};

const listCasesSchema = z
  .object({
    caseState: z
      .enum(['open', 'awaiting_candidate', 'awaiting_staff', 'in_progress', 'resolved', 'closed'])
      .optional(),
    caseType: z
      .enum(['general', 'refund', 'payment', 'course', 'interview', 'account', 'privacy', 'other'])
      .optional(),
    limit: z.number().int().min(1).max(100).optional(),
    sessionToken: z.string().trim().min(32).max(512),
  })
  .strict();
const caseDetailSchema = z
  .object({
    sessionToken: z.string().trim().min(32).max(512),
    supportCaseDocumentId: z.string().trim().min(1).max(120),
  })
  .strict();
const assignCaseSchema = z
  .object({
    assignedTo: z.object({
      displayName: z.string().trim().min(1).max(240),
      email: z.string().trim().email().max(254),
      id: z.string().trim().min(1).max(160),
      roleKey: z.enum(['admin', 'sales', 'super_admin', 'support']).optional(),
    }),
    sessionToken: z.string().trim().min(32).max(512),
    supportCaseDocumentId: z.string().trim().min(1).max(120),
  })
  .strict();

const validateListCases = validateZodSchema(listCasesSchema);
const validateCaseDetail = validateZodSchema(caseDetailSchema);
const validateAssignCase = validateZodSchema(assignCaseSchema);

const adminAuthService = (strapi: StrapiService) =>
  strapi.service('api::admin-auth.admin-auth') as unknown as AdminAuthService;

const supportCaseService = (strapi: StrapiService) =>
  strapi.service('api::support-case.support-case') as unknown as SupportCaseService;

const assertSupportSession = async (
  strapi: StrapiService,
  sessionToken: string,
  requestContext: RequestContext
) => {
  const session = await adminAuthService(strapi).getSession({ sessionToken }, requestContext);
  const canViewSupport = session.user.roleKeys.some((roleKey) =>
    ['admin', 'super_admin', 'support'].includes(roleKey)
  );

  if (!canViewSupport) {
    throw new ForbiddenError('Admin or Support access is required.');
  }

  return session;
};

export default ({ strapi }: { strapi: StrapiService }) => ({
  async listCases(input: unknown, requestContext: RequestContext = {}) {
    const body = validateListCases(input);
    const session = await assertSupportSession(strapi, body.sessionToken, requestContext);
    const cases = await supportCaseService(strapi).listCases({
      ...(body.caseState ? { caseState: body.caseState } : {}),
      ...(body.caseType ? { caseType: body.caseType } : {}),
      ...(body.limit ? { limit: body.limit } : {}),
    });

    return {
      cases,
      counts: {
        total: cases.length,
      },
      generatedAt: new Date().toISOString(),
      user: session.user,
    };
  },

  async getCase(input: unknown, requestContext: RequestContext = {}) {
    const body = validateCaseDetail(input);
    const session = await assertSupportSession(strapi, body.sessionToken, requestContext);
    const supportCase = await supportCaseService(strapi).getCase({
      supportCaseDocumentId: body.supportCaseDocumentId,
    });

    return {
      generatedAt: new Date().toISOString(),
      supportCase,
      user: session.user,
    };
  },

  async assignCase(input: unknown, requestContext: RequestContext = {}) {
    const body = validateAssignCase(input);
    const session = await assertSupportSession(strapi, body.sessionToken, requestContext);
    const supportCase = await supportCaseService(strapi).assignCase({
      assignedTo: body.assignedTo,
      metadata: {
        assignedByAdminEmail: session.user.email,
        assignedByAdminId: session.user.id,
      },
      supportCase: {
        documentId: body.supportCaseDocumentId,
      },
    });

    return {
      assigned: true,
      supportCase,
      user: session.user,
    };
  },
});

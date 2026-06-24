type RequestContext = {
  ipAddress?: string;
  requestId?: string;
  serviceName?: string;
  userAgent?: string;
};

type AdminSupportService = {
  addInternalNote(input: unknown, context: RequestContext): Promise<unknown>;
  assignCase(input: unknown, context: RequestContext): Promise<unknown>;
  getCase(input: unknown, context: RequestContext): Promise<unknown>;
  getFeedbackReportFailure(input: unknown, context: RequestContext): Promise<unknown>;
  listAssignableStaff(input: unknown, context: RequestContext): Promise<unknown>;
  listCases(input: unknown, context: RequestContext): Promise<unknown>;
  replyToCase(input: unknown, context: RequestContext): Promise<unknown>;
  resolveFeedbackReportFailure(input: unknown, context: RequestContext): Promise<unknown>;
  resolveFeedbackReportConcern(input: unknown, context: RequestContext): Promise<unknown>;
};

const adminSupportService = (strapi: { service(uid: string): unknown }): AdminSupportService =>
  strapi.service('api::admin-support.admin-support') as unknown as AdminSupportService;

const getForwardedClientIp = (ctx) =>
  ctx.request.get('x-hireflip-client-ip') ||
  ctx.request.get('cf-connecting-ip') ||
  ctx.request.get('x-forwarded-for')?.split(',')[0]?.trim() ||
  ctx.request.ip;

const getRequestContext = (ctx): RequestContext => ({
  ipAddress: getForwardedClientIp(ctx),
  requestId: ctx.state?.requestId,
  serviceName: ctx.state?.hireflipAuth?.serviceName,
  userAgent: ctx.request.get('x-hireflip-client-user-agent') || ctx.request.get('user-agent'),
});

const isConflictError = (error: unknown) =>
  Boolean(error && typeof error === 'object' && 'status' in error && error.status === 409);

const writeResult = async (ctx, action: () => Promise<unknown>) => {
  try {
    ctx.body = {
      data: await action(),
    };
  } catch (error) {
    if (isConflictError(error)) {
      ctx.status = 409;
      ctx.body = {
        error: {
          message: error instanceof Error ? error.message : 'Review claim conflict.',
          name: 'ReviewClaimConflictError',
          status: 409,
        },
      };
      return;
    }

    throw error;
  }
};

export default ({ strapi }) => ({
  async list(ctx) {
    const result = await adminSupportService(strapi).listCases(
      ctx.request.body,
      getRequestContext(ctx)
    );

    ctx.body = {
      data: result,
    };
  },

  async detail(ctx) {
    const result = await adminSupportService(strapi).getCase(
      ctx.request.body,
      getRequestContext(ctx)
    );

    ctx.body = {
      data: result,
    };
  },

  async assignableStaff(ctx) {
    const result = await adminSupportService(strapi).listAssignableStaff(
      ctx.request.body,
      getRequestContext(ctx)
    );

    ctx.body = {
      data: result,
    };
  },

  async assign(ctx) {
    await writeResult(ctx, () =>
      adminSupportService(strapi).assignCase(ctx.request.body, getRequestContext(ctx))
    );
  },

  async reply(ctx) {
    await writeResult(ctx, () =>
      adminSupportService(strapi).replyToCase(ctx.request.body, getRequestContext(ctx))
    );
  },

  async note(ctx) {
    await writeResult(ctx, () =>
      adminSupportService(strapi).addInternalNote(ctx.request.body, getRequestContext(ctx))
    );
  },

  async feedbackReportConcern(ctx) {
    await writeResult(ctx, () =>
      adminSupportService(strapi).resolveFeedbackReportConcern(ctx.request.body, getRequestContext(ctx))
    );
  },

  async feedbackReportFailureDetail(ctx) {
    await writeResult(ctx, () =>
      adminSupportService(strapi).getFeedbackReportFailure(ctx.request.body, getRequestContext(ctx))
    );
  },

  async feedbackReportFailureAction(ctx) {
    await writeResult(ctx, () =>
      adminSupportService(strapi).resolveFeedbackReportFailure(ctx.request.body, getRequestContext(ctx))
    );
  },
});

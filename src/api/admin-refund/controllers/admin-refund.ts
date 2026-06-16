type RequestContext = {
  ipAddress?: string;
  requestId?: string;
  serviceName?: string;
  userAgent?: string;
};

type AdminRefundService = {
  approvePaymentExceptionRefund(input: unknown, context: RequestContext): Promise<unknown>;
  escalateReview(input: unknown, context: RequestContext): Promise<unknown>;
  executeReviewRefund(input: unknown, context: RequestContext): Promise<unknown>;
  getReviewDetail(input: unknown, context: RequestContext): Promise<unknown>;
  listReviews(input: unknown, context: RequestContext): Promise<unknown>;
  refuseReview(input: unknown, context: RequestContext): Promise<unknown>;
};

const adminRefundService = (strapi: { service(uid: string): unknown }): AdminRefundService =>
  strapi.service('api::admin-refund.admin-refund') as unknown as AdminRefundService;

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
    const result = await adminRefundService(strapi).listReviews(
      ctx.request.body,
      getRequestContext(ctx)
    );

    ctx.body = {
      data: result,
    };
  },

  async detail(ctx) {
    const result = await adminRefundService(strapi).getReviewDetail(
      ctx.request.body,
      getRequestContext(ctx)
    );

    ctx.body = {
      data: result,
    };
  },

  async approveExceptionRefund(ctx) {
    await writeResult(ctx, () =>
      adminRefundService(strapi).approvePaymentExceptionRefund(
        ctx.request.body,
        getRequestContext(ctx)
      )
    );
  },

  async refuse(ctx) {
    await writeResult(ctx, () =>
      adminRefundService(strapi).refuseReview(ctx.request.body, getRequestContext(ctx))
    );
  },

  async escalate(ctx) {
    await writeResult(ctx, () =>
      adminRefundService(strapi).escalateReview(ctx.request.body, getRequestContext(ctx))
    );
  },

  async execute(ctx) {
    await writeResult(ctx, () =>
      adminRefundService(strapi).executeReviewRefund(ctx.request.body, getRequestContext(ctx))
    );
  },
});

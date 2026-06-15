type RequestContext = {
  ipAddress?: string;
  requestId?: string;
  serviceName?: string;
  userAgent?: string;
};

type AdminRefundService = {
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

  async refuse(ctx) {
    const result = await adminRefundService(strapi).refuseReview(
      ctx.request.body,
      getRequestContext(ctx)
    );

    ctx.body = {
      data: result,
    };
  },

  async escalate(ctx) {
    const result = await adminRefundService(strapi).escalateReview(
      ctx.request.body,
      getRequestContext(ctx)
    );

    ctx.body = {
      data: result,
    };
  },

  async execute(ctx) {
    const result = await adminRefundService(strapi).executeReviewRefund(
      ctx.request.body,
      getRequestContext(ctx)
    );

    ctx.body = {
      data: result,
    };
  },
});

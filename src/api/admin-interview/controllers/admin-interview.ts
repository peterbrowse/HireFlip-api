type RequestContext = {
  ipAddress?: string;
  requestId?: string;
  serviceName?: string;
  userAgent?: string;
};

type AdminInterviewService = {
  getOperations(input: unknown, context: RequestContext): Promise<unknown>;
};

const adminInterviewService = (strapi: { service(uid: string): unknown }): AdminInterviewService =>
  strapi.service('api::admin-interview.admin-interview') as unknown as AdminInterviewService;

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
  async operations(ctx) {
    ctx.body = {
      data: await adminInterviewService(strapi).getOperations(
        ctx.request.body,
        getRequestContext(ctx)
      ),
    };
  },
});

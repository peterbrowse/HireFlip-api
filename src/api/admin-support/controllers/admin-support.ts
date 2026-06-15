type RequestContext = {
  ipAddress?: string;
  requestId?: string;
  serviceName?: string;
  userAgent?: string;
};

type AdminSupportService = {
  assignCase(input: unknown, context: RequestContext): Promise<unknown>;
  getCase(input: unknown, context: RequestContext): Promise<unknown>;
  listCases(input: unknown, context: RequestContext): Promise<unknown>;
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

  async assign(ctx) {
    const result = await adminSupportService(strapi).assignCase(
      ctx.request.body,
      getRequestContext(ctx)
    );

    ctx.body = {
      data: result,
    };
  },
});

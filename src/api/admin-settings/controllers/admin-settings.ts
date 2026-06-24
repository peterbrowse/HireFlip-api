type RequestContext = {
  ipAddress?: string;
  requestId?: string;
  serviceName?: string;
  userAgent?: string;
};

type AdminSettingsService = {
  getAiSettings(input: unknown, context: RequestContext): Promise<unknown>;
  updateAiSettings(input: unknown, context: RequestContext): Promise<unknown>;
};

const adminSettingsService = (strapi: { service(uid: string): unknown }): AdminSettingsService =>
  strapi.service('api::admin-settings.admin-settings') as unknown as AdminSettingsService;

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
  async ai(ctx) {
    const result = await adminSettingsService(strapi).getAiSettings(
      ctx.request.body,
      getRequestContext(ctx)
    );

    ctx.body = {
      data: result,
    };
  },

  async updateAi(ctx) {
    const result = await adminSettingsService(strapi).updateAiSettings(
      ctx.request.body,
      getRequestContext(ctx)
    );

    ctx.body = {
      data: result,
    };
  },
});

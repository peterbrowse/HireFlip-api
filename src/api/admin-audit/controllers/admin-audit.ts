type RequestContext = {
  ipAddress?: string;
  requestId?: string;
  serviceName?: string;
  userAgent?: string;
};

type AdminAuditService = {
  exportPdf(input: unknown, context: RequestContext): Promise<unknown>;
  search(input: unknown, context: RequestContext): Promise<unknown>;
};

const adminAuditService = (strapi: { service(uid: string): unknown }): AdminAuditService =>
  strapi.service('api::admin-audit.admin-audit') as unknown as AdminAuditService;

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
  async exportPdf(ctx) {
    ctx.body = {
      data: await adminAuditService(strapi).exportPdf(
        ctx.request.body,
        getRequestContext(ctx)
      ),
    };
  },

  async search(ctx) {
    ctx.body = {
      data: await adminAuditService(strapi).search(
        ctx.request.body,
        getRequestContext(ctx)
      ),
    };
  },
});

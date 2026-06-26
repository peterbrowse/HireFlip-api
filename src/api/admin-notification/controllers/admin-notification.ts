type RequestContext = {
  ipAddress?: string;
  requestId?: string;
  serviceName?: string;
  userAgent?: string;
};

type AdminNotificationService = {
  clearEmailIssue(input: unknown, context: RequestContext): Promise<unknown>;
  getIssue(input: unknown, context: RequestContext): Promise<unknown>;
  listIssues(input: unknown, context: RequestContext): Promise<unknown>;
  resendIssue(input: unknown, context: RequestContext): Promise<unknown>;
};

const adminNotificationService = (strapi: { service(uid: string): unknown }): AdminNotificationService =>
  strapi.service('api::admin-notification.admin-notification') as unknown as AdminNotificationService;

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
  async listIssues(ctx) {
    ctx.body = {
      data: await adminNotificationService(strapi).listIssues(
        ctx.request.body,
        getRequestContext(ctx)
      ),
    };
  },

  async issueDetail(ctx) {
    ctx.body = {
      data: await adminNotificationService(strapi).getIssue(
        ctx.request.body,
        getRequestContext(ctx)
      ),
    };
  },

  async resendIssue(ctx) {
    ctx.body = {
      data: await adminNotificationService(strapi).resendIssue(
        ctx.request.body,
        getRequestContext(ctx)
      ),
    };
  },

  async clearEmailIssue(ctx) {
    ctx.body = {
      data: await adminNotificationService(strapi).clearEmailIssue(
        ctx.request.body,
        getRequestContext(ctx)
      ),
    };
  },
});

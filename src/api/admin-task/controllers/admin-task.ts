import { factories } from '@strapi/strapi';

type RequestContext = {
  ipAddress?: string;
  requestId?: string;
  serviceName?: string;
  userAgent?: string;
};

type AdminTaskService = {
  getOverview(input: unknown, context: RequestContext): Promise<unknown>;
};

const adminTaskService = (strapi: { service(uid: string): unknown }): AdminTaskService =>
  strapi.service('api::admin-task.admin-task') as unknown as AdminTaskService;

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

export default factories.createCoreController('api::admin-task.admin-task', ({ strapi }) => ({
  async overview(ctx) {
    const result = await adminTaskService(strapi).getOverview(
      ctx.request.body,
      getRequestContext(ctx)
    );

    ctx.body = {
      data: result,
    };
  },
}));

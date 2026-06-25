import { factories } from '@strapi/strapi';

type RequestContext = {
  ipAddress?: string;
  requestId?: string;
  serviceName?: string;
  userAgent?: string;
};

type NotificationEventService = {
  recordProviderStatus(input: unknown, context: RequestContext): Promise<unknown>;
};

const notificationEventService = (strapi: { service(uid: string): unknown }): NotificationEventService =>
  strapi.service('api::notification-event.notification-event') as unknown as NotificationEventService;

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

export default factories.createCoreController('api::notification-event.notification-event', ({ strapi }) => ({
  async providerStatus(ctx) {
    ctx.body = {
      data: await notificationEventService(strapi).recordProviderStatus(
        ctx.request.body,
        getRequestContext(ctx)
      ),
    };
    ctx.status = 202;
  },
}));

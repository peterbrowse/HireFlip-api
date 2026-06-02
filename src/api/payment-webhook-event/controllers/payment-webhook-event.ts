import { factories } from '@strapi/strapi';

type RequestContext = {
  ipAddress?: string;
  requestId?: string;
  serviceName?: string;
  userAgent?: string;
};

type PaymentWebhookEventService = {
  receiveStripeEvent(input: unknown, context: RequestContext): Promise<unknown>;
};

const paymentWebhookEventService = (
  strapi: { service(uid: string): unknown }
): PaymentWebhookEventService =>
  strapi.service('api::payment-webhook-event.payment-webhook-event') as PaymentWebhookEventService;

const getForwardedClientIp = (ctx) =>
  ctx.request.get('cf-connecting-ip') ||
  ctx.request.get('x-forwarded-for')?.split(',')[0]?.trim() ||
  ctx.request.ip;

export default factories.createCoreController('api::payment-webhook-event.payment-webhook-event', ({ strapi }) => ({
  async receiveStripe(ctx) {
    const result = await paymentWebhookEventService(strapi).receiveStripeEvent(
      ctx.request.body,
      {
        ipAddress: getForwardedClientIp(ctx),
        requestId: ctx.state?.requestId,
        serviceName: ctx.state?.hireflipAuth?.serviceName,
        userAgent: ctx.request.get('user-agent'),
      }
    );

    ctx.body = {
      data: result,
    };
  },
}));

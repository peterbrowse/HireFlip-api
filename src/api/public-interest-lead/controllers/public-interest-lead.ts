import { factories } from '@strapi/strapi';

const getForwardedClientIp = (ctx) =>
  ctx.request.get('x-hireflip-client-ip') ||
  ctx.request.get('cf-connecting-ip') ||
  ctx.request.get('x-forwarded-for')?.split(',')[0]?.trim() ||
  ctx.request.ip;

export default factories.createCoreController('api::public-interest-lead.public-interest-lead', ({ strapi }) => ({
  async registerInterest(ctx) {
    const result = await (strapi.service('api::public-interest-lead.public-interest-lead') as any).registerInterest(
      ctx.request.body,
      {
        ipAddress: getForwardedClientIp(ctx),
        userAgent: ctx.request.get('x-hireflip-client-user-agent') || ctx.request.get('user-agent'),
        requestId: ctx.state?.requestId,
      }
    );

    ctx.status = result.created ? 201 : 202;
    ctx.body = {
      data: {
        accepted: true,
        id: result.documentId,
      },
    };
  },
}));

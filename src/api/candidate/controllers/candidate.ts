import { factories } from '@strapi/strapi';

const getForwardedClientIp = (ctx) =>
  ctx.request.get('x-hireflip-client-ip') ||
  ctx.request.get('cf-connecting-ip') ||
  ctx.request.get('x-forwarded-for')?.split(',')[0]?.trim() ||
  ctx.request.ip;

export default factories.createCoreController('api::candidate.candidate', ({ strapi }) => ({
  async me(ctx) {
    const result = await (strapi.service('api::candidate.candidate') as any).syncCurrentCandidate(
      ctx.state?.hireflipAuth,
      ctx.request.body,
      {
        ipAddress: getForwardedClientIp(ctx),
        requestId: ctx.state?.requestId,
        userAgent: ctx.request.get('x-hireflip-client-user-agent') || ctx.request.get('user-agent'),
      }
    );

    ctx.body = {
      data: result,
    };
  },

  async updateAccount(ctx) {
    const result = await (strapi.service('api::candidate.candidate') as any).updateCurrentCandidateAccount(
      ctx.state?.hireflipAuth,
      ctx.request.body,
      {
        ipAddress: getForwardedClientIp(ctx),
        requestId: ctx.state?.requestId,
        userAgent: ctx.request.get('x-hireflip-client-user-agent') || ctx.request.get('user-agent'),
      }
    );

    ctx.body = {
      data: result,
    };
  },
}));

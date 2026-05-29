import { factories } from '@strapi/strapi';

const getForwardedClientIp = (ctx) =>
  ctx.request.get('x-hireflip-client-ip') ||
  ctx.request.get('cf-connecting-ip') ||
  ctx.request.get('x-forwarded-for')?.split(',')[0]?.trim() ||
  ctx.request.ip;

const getUploadedProfileImage = (files) => {
  const file = files?.profileImage || files?.image || files?.file;
  return Array.isArray(file) ? file[0] : file;
};

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

  async updateProfileImage(ctx) {
    const file = getUploadedProfileImage(ctx.request.files);
    const result = await (strapi.service('api::candidate.candidate') as any).updateCurrentCandidateProfileImage(
      ctx.state?.hireflipAuth,
      file,
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

  async classInterest(ctx) {
    const result = await (strapi.service('api::candidate.candidate') as any).getCurrentCandidateClassInterest(
      ctx.state?.hireflipAuth
    );

    ctx.body = {
      data: result,
    };
  },

  async preferenceOptions(ctx) {
    const result = await (strapi.service('api::candidate.candidate') as any).getCandidatePreferenceOptions(
      ctx.state?.hireflipAuth
    );

    ctx.body = {
      data: result,
    };
  },

  async registerClassInterest(ctx) {
    const result = await (strapi.service('api::candidate.candidate') as any).registerCurrentCandidateClassInterest(
      ctx.state?.hireflipAuth,
      ctx.request.body,
      {
        ipAddress: getForwardedClientIp(ctx),
        requestId: ctx.state?.requestId,
        userAgent: ctx.request.get('x-hireflip-client-user-agent') || ctx.request.get('user-agent'),
      }
    );

    ctx.status = result.created ? 201 : 200;
    ctx.body = {
      data: result.data,
    };
  },

  async createUnlistedInterest(ctx) {
    const result = await (strapi.service('api::candidate.candidate') as any).createCurrentCandidateUnlistedInterest(
      ctx.state?.hireflipAuth,
      ctx.request.body,
      {
        ipAddress: getForwardedClientIp(ctx),
        requestId: ctx.state?.requestId,
        userAgent: ctx.request.get('x-hireflip-client-user-agent') || ctx.request.get('user-agent'),
      }
    );

    ctx.status = 201;
    ctx.body = {
      data: result,
    };
  },
}));

type RequestContext = {
  ipAddress?: string;
  requestId?: string;
  serviceName?: string;
  userAgent?: string;
};

type AdminAuthService = {
  createTwoFactorChallenge(input: unknown, context: RequestContext): Promise<unknown>;
  getSession(input: unknown, context: RequestContext): Promise<unknown>;
  logout(input: unknown, context: RequestContext): Promise<unknown>;
  requestStaffPasswordReset(input: unknown, context: RequestContext): Promise<unknown>;
  resendTwoFactorChallenge(input: unknown, context: RequestContext): Promise<unknown>;
  verifyTwoFactorChallenge(input: unknown, context: RequestContext): Promise<unknown>;
};

const adminAuthService = (strapi: { service(uid: string): unknown }): AdminAuthService =>
  strapi.service('api::admin-auth.admin-auth') as unknown as AdminAuthService;

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
  async login(ctx) {
    const result = await adminAuthService(strapi).createTwoFactorChallenge(
      ctx.request.body,
      getRequestContext(ctx)
    );

    ctx.body = {
      data: result,
    };
  },

  async verifyTwoFactor(ctx) {
    const result = await adminAuthService(strapi).verifyTwoFactorChallenge(
      ctx.request.body,
      getRequestContext(ctx)
    );

    ctx.body = {
      data: result,
    };
  },

  async resendTwoFactor(ctx) {
    const result = await adminAuthService(strapi).resendTwoFactorChallenge(
      ctx.request.body,
      getRequestContext(ctx)
    );

    ctx.body = {
      data: result,
    };
  },

  async session(ctx) {
    const result = await adminAuthService(strapi).getSession(
      ctx.request.body,
      getRequestContext(ctx)
    );

    ctx.body = {
      data: result,
    };
  },

  async logout(ctx) {
    const result = await adminAuthService(strapi).logout(
      ctx.request.body,
      getRequestContext(ctx)
    );

    ctx.body = {
      data: result,
    };
  },

  async requestStaffPasswordReset(ctx) {
    const result = await adminAuthService(strapi).requestStaffPasswordReset(
      ctx.request.body,
      getRequestContext(ctx)
    );

    ctx.body = {
      data: result,
    };
  },
});

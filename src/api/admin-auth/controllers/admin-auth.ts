type RequestContext = {
  ipAddress?: string;
  requestId?: string;
  serviceName?: string;
  userAgent?: string;
};

type AdminAuthService = {
  acceptStaffInvite(input: unknown, context: RequestContext): Promise<unknown>;
  createTwoFactorChallenge(input: unknown, context: RequestContext): Promise<unknown>;
  deleteStaffUser(input: unknown, context: RequestContext): Promise<unknown>;
  getStaffInviteInfo(input: unknown, context: RequestContext): Promise<unknown>;
  getStaffPasswordResetInfo(input: unknown, context: RequestContext): Promise<unknown>;
  getSession(input: unknown, context: RequestContext): Promise<unknown>;
  inviteStaffUser(input: unknown, context: RequestContext): Promise<unknown>;
  listStaffUsers(input: unknown, context: RequestContext): Promise<unknown>;
  logout(input: unknown, context: RequestContext): Promise<unknown>;
  requestStaffPasswordReset(input: unknown, context: RequestContext): Promise<unknown>;
  resendStaffInvite(input: unknown, context: RequestContext): Promise<unknown>;
  resetStaffPassword(input: unknown, context: RequestContext): Promise<unknown>;
  resendTwoFactorChallenge(input: unknown, context: RequestContext): Promise<unknown>;
  updateCurrentStaffProfile(input: unknown, context: RequestContext): Promise<unknown>;
  updateCurrentStaffProfileImage(input: unknown, file: unknown, context: RequestContext): Promise<unknown>;
  updateSessionPreference(input: unknown, context: RequestContext): Promise<unknown>;
  updateStaffUserRole(input: unknown, context: RequestContext): Promise<unknown>;
  updateStaffUserStatus(input: unknown, context: RequestContext): Promise<unknown>;
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

const getUploadedProfileImage = (files) => {
  const file = files?.profileImage || files?.image || files?.file;

  return Array.isArray(file) ? file[0] : file;
};

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

  async updateSessionPreference(ctx) {
    const result = await adminAuthService(strapi).updateSessionPreference(
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

  async updateCurrentStaffProfile(ctx) {
    const result = await adminAuthService(strapi).updateCurrentStaffProfile(
      ctx.request.body,
      getRequestContext(ctx)
    );

    ctx.body = {
      data: result,
    };
  },

  async updateCurrentStaffProfileImage(ctx) {
    const result = await adminAuthService(strapi).updateCurrentStaffProfileImage(
      ctx.request.body,
      getUploadedProfileImage(ctx.request.files),
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

  async listStaffUsers(ctx) {
    const result = await adminAuthService(strapi).listStaffUsers(
      ctx.request.body,
      getRequestContext(ctx)
    );

    ctx.body = {
      data: result,
    };
  },

  async updateStaffUserStatus(ctx) {
    const result = await adminAuthService(strapi).updateStaffUserStatus(
      ctx.request.body,
      getRequestContext(ctx)
    );

    ctx.body = {
      data: result,
    };
  },

  async updateStaffUserRole(ctx) {
    const result = await adminAuthService(strapi).updateStaffUserRole(
      ctx.request.body,
      getRequestContext(ctx)
    );

    ctx.body = {
      data: result,
    };
  },

  async deleteStaffUser(ctx) {
    const result = await adminAuthService(strapi).deleteStaffUser(
      ctx.request.body,
      getRequestContext(ctx)
    );

    ctx.body = {
      data: result,
    };
  },

  async inviteStaffUser(ctx) {
    const result = await adminAuthService(strapi).inviteStaffUser(
      ctx.request.body,
      getRequestContext(ctx)
    );

    ctx.body = {
      data: result,
    };
  },

  async resendStaffInvite(ctx) {
    const result = await adminAuthService(strapi).resendStaffInvite(
      ctx.request.body,
      getRequestContext(ctx)
    );

    ctx.body = {
      data: result,
    };
  },

  async staffInviteInfo(ctx) {
    const result = await adminAuthService(strapi).getStaffInviteInfo(
      ctx.request.body,
      getRequestContext(ctx)
    );

    ctx.body = {
      data: result,
    };
  },

  async staffPasswordResetInfo(ctx) {
    const result = await adminAuthService(strapi).getStaffPasswordResetInfo(
      ctx.request.body,
      getRequestContext(ctx)
    );

    ctx.body = {
      data: result,
    };
  },

  async resetStaffPassword(ctx) {
    const result = await adminAuthService(strapi).resetStaffPassword(
      ctx.request.body,
      getRequestContext(ctx)
    );

    ctx.body = {
      data: result,
    };
  },

  async acceptStaffInvite(ctx) {
    const result = await adminAuthService(strapi).acceptStaffInvite(
      ctx.request.body,
      getRequestContext(ctx)
    );

    ctx.body = {
      data: result,
    };
  },
});

type RequestContext = {
  ipAddress?: string;
  requestId?: string;
  serviceName?: string;
  userAgent?: string;
};

type AdminEmployerService = {
  archiveEmployer(input: unknown, context: RequestContext): Promise<unknown>;
  createInvite(input: unknown, context: RequestContext): Promise<unknown>;
  generateInviteLink(input: unknown, context: RequestContext): Promise<unknown>;
  getEmployerDetail(input: unknown, context: RequestContext): Promise<unknown>;
  getInviteOptions(input: unknown, context: RequestContext): Promise<unknown>;
  listEmployers(input: unknown, context: RequestContext): Promise<unknown>;
  listInvites(input: unknown, context: RequestContext): Promise<unknown>;
  resendInvite(input: unknown, context: RequestContext): Promise<unknown>;
  revokeInvite(input: unknown, context: RequestContext): Promise<unknown>;
};

const adminEmployerService = (strapi: { service(uid: string): unknown }): AdminEmployerService =>
  strapi.service('api::admin-employer.admin-employer') as unknown as AdminEmployerService;

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
  async listEmployers(ctx) {
    ctx.body = {
      data: await adminEmployerService(strapi).listEmployers(
        ctx.request.body,
        getRequestContext(ctx)
      ),
    };
  },

  async employerDetail(ctx) {
    ctx.body = {
      data: await adminEmployerService(strapi).getEmployerDetail(
        ctx.request.body,
        getRequestContext(ctx)
      ),
    };
  },

  async inviteOptions(ctx) {
    ctx.body = {
      data: await adminEmployerService(strapi).getInviteOptions(
        ctx.request.body,
        getRequestContext(ctx)
      ),
    };
  },

  async listInvites(ctx) {
    ctx.body = {
      data: await adminEmployerService(strapi).listInvites(
        ctx.request.body,
        getRequestContext(ctx)
      ),
    };
  },

  async createInvite(ctx) {
    ctx.body = {
      data: await adminEmployerService(strapi).createInvite(
        ctx.request.body,
        getRequestContext(ctx)
      ),
    };
  },

  async resendInvite(ctx) {
    ctx.body = {
      data: await adminEmployerService(strapi).resendInvite(
        ctx.request.body,
        getRequestContext(ctx)
      ),
    };
  },

  async generateInviteLink(ctx) {
    ctx.body = {
      data: await adminEmployerService(strapi).generateInviteLink(
        ctx.request.body,
        getRequestContext(ctx)
      ),
    };
  },

  async revokeInvite(ctx) {
    ctx.body = {
      data: await adminEmployerService(strapi).revokeInvite(
        ctx.request.body,
        getRequestContext(ctx)
      ),
    };
  },

  async archiveEmployer(ctx) {
    ctx.body = {
      data: await adminEmployerService(strapi).archiveEmployer(
        ctx.request.body,
        getRequestContext(ctx)
      ),
    };
  },
});

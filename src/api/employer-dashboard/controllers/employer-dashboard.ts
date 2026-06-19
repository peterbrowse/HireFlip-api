type RequestContext = {
  ipAddress?: string;
  requestId?: string;
  serviceName?: string;
  userAgent?: string;
};

type EmployerDashboardService = {
  acceptInvite(input: unknown, context: RequestContext): Promise<unknown>;
  createInviteSetupTicket(input: unknown, context: RequestContext): Promise<unknown>;
  createInterviewSlotOffer(input: unknown, context: RequestContext): Promise<unknown>;
  getOverview(input: unknown, context: RequestContext): Promise<unknown>;
  validateInvite(input: unknown, context: RequestContext): Promise<unknown>;
};

const employerDashboardService = (strapi: { service(uid: string): unknown }): EmployerDashboardService =>
  strapi.service('api::employer-dashboard.employer-dashboard') as unknown as EmployerDashboardService;

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
  async overview(ctx) {
    ctx.body = {
      data: await employerDashboardService(strapi).getOverview(
        ctx.request.body,
        getRequestContext(ctx)
      ),
    };
  },

  async createInterviewSlotOffer(ctx) {
    ctx.body = {
      data: await employerDashboardService(strapi).createInterviewSlotOffer(
        ctx.request.body,
        getRequestContext(ctx)
      ),
    };
  },

  async validateInvite(ctx) {
    ctx.body = {
      data: await employerDashboardService(strapi).validateInvite(
        ctx.request.body,
        getRequestContext(ctx)
      ),
    };
  },

  async acceptInvite(ctx) {
    ctx.body = {
      data: await employerDashboardService(strapi).acceptInvite(
        ctx.request.body,
        getRequestContext(ctx)
      ),
    };
  },

  async createInviteSetupTicket(ctx) {
    ctx.body = {
      data: await employerDashboardService(strapi).createInviteSetupTicket(
        ctx.request.body,
        getRequestContext(ctx)
      ),
    };
  },
});

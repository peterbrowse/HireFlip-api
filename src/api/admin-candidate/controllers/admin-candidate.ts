type RequestContext = {
  ipAddress?: string;
  requestId?: string;
  serviceName?: string;
  userAgent?: string;
};

type AdminCandidateService = {
  accountAction(input: unknown, context: RequestContext): Promise<unknown>;
  activityReport(input: unknown, context: RequestContext): Promise<unknown>;
  createSupportCase(input: unknown, context: RequestContext): Promise<unknown>;
  gdprExport(input: unknown, context: RequestContext): Promise<unknown>;
  getCandidate(input: unknown, context: RequestContext): Promise<unknown>;
  listCandidates(input: unknown, context: RequestContext): Promise<unknown>;
  strikeAction(input: unknown, context: RequestContext): Promise<unknown>;
  updateProfile(input: unknown, context: RequestContext): Promise<unknown>;
};

const adminCandidateService = (strapi: { service(uid: string): unknown }): AdminCandidateService =>
  strapi.service('api::admin-candidate.admin-candidate') as unknown as AdminCandidateService;

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
  async listCandidates(ctx) {
    ctx.body = {
      data: await adminCandidateService(strapi).listCandidates(
        ctx.request.body,
        getRequestContext(ctx)
      ),
    };
  },

  async candidateDetail(ctx) {
    ctx.body = {
      data: await adminCandidateService(strapi).getCandidate(
        ctx.request.body,
        getRequestContext(ctx)
      ),
    };
  },

  async updateProfile(ctx) {
    ctx.body = {
      data: await adminCandidateService(strapi).updateProfile(
        ctx.request.body,
        getRequestContext(ctx)
      ),
    };
  },

  async accountAction(ctx) {
    ctx.body = {
      data: await adminCandidateService(strapi).accountAction(
        ctx.request.body,
        getRequestContext(ctx)
      ),
    };
  },

  async createSupportCase(ctx) {
    ctx.body = {
      data: await adminCandidateService(strapi).createSupportCase(
        ctx.request.body,
        getRequestContext(ctx)
      ),
    };
  },

  async strikeAction(ctx) {
    ctx.body = {
      data: await adminCandidateService(strapi).strikeAction(
        ctx.request.body,
        getRequestContext(ctx)
      ),
    };
  },

  async gdprExport(ctx) {
    ctx.body = {
      data: await adminCandidateService(strapi).gdprExport(
        ctx.request.body,
        getRequestContext(ctx)
      ),
    };
  },

  async activityReport(ctx) {
    ctx.body = {
      data: await adminCandidateService(strapi).activityReport(
        ctx.request.body,
        getRequestContext(ctx)
      ),
    };
  },
});

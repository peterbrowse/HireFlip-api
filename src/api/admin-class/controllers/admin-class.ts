type RequestContext = {
  ipAddress?: string;
  requestId?: string;
  serviceName?: string;
  userAgent?: string;
};

type AdminClassService = {
  createClass(input: unknown, context: RequestContext): Promise<unknown>;
  getClassDetail(input: unknown, context: RequestContext): Promise<unknown>;
  getClassOptions(input: unknown, context: RequestContext): Promise<unknown>;
  listClasses(input: unknown, context: RequestContext): Promise<unknown>;
  postClassAnnouncement(input: unknown, context: RequestContext): Promise<unknown>;
  updateClass(input: unknown, context: RequestContext): Promise<unknown>;
  updateClassLifecycle(input: unknown, context: RequestContext): Promise<unknown>;
};

const adminClassService = (strapi: { service(uid: string): unknown }): AdminClassService =>
  strapi.service('api::admin-class.admin-class') as unknown as AdminClassService;

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
  async list(ctx) {
    ctx.body = {
      data: await adminClassService(strapi).listClasses(
        ctx.request.body,
        getRequestContext(ctx)
      ),
    };
  },

  async detail(ctx) {
    ctx.body = {
      data: await adminClassService(strapi).getClassDetail(
        ctx.request.body,
        getRequestContext(ctx)
      ),
    };
  },

  async options(ctx) {
    ctx.body = {
      data: await adminClassService(strapi).getClassOptions(
        ctx.request.body,
        getRequestContext(ctx)
      ),
    };
  },

  async create(ctx) {
    ctx.body = {
      data: await adminClassService(strapi).createClass(
        ctx.request.body,
        getRequestContext(ctx)
      ),
    };
  },

  async update(ctx) {
    ctx.body = {
      data: await adminClassService(strapi).updateClass(
        ctx.request.body,
        getRequestContext(ctx)
      ),
    };
  },

  async postAnnouncement(ctx) {
    ctx.body = {
      data: await adminClassService(strapi).postClassAnnouncement(
        ctx.request.body,
        getRequestContext(ctx)
      ),
    };
  },

  async lifecycle(ctx) {
    ctx.body = {
      data: await adminClassService(strapi).updateClassLifecycle(
        ctx.request.body,
        getRequestContext(ctx)
      ),
    };
  },
});

type RequestContext = {
  ipAddress?: string;
  requestId?: string;
  serviceName?: string;
  userAgent?: string;
};

type AdminReviewClaimService = {
  claim(input: unknown, context: RequestContext): Promise<unknown>;
  heartbeat(input: unknown, context: RequestContext): Promise<unknown>;
  release(input: unknown, context: RequestContext): Promise<unknown>;
};

const adminReviewClaimService = (strapi: { service(uid: string): unknown }) =>
  strapi.service('api::admin-review-claim.admin-review-claim') as unknown as AdminReviewClaimService;

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

const isConflictError = (error: unknown) =>
  Boolean(error && typeof error === 'object' && 'status' in error && error.status === 409);

const writeResult = async (ctx, action: () => Promise<unknown>) => {
  try {
    ctx.body = {
      data: await action(),
    };
  } catch (error) {
    if (isConflictError(error)) {
      ctx.status = 409;
      ctx.body = {
        error: {
          message: error instanceof Error ? error.message : 'Review claim conflict.',
          name: 'ReviewClaimConflictError',
          status: 409,
        },
      };
      return;
    }

    throw error;
  }
};

export default ({ strapi }) => ({
  async claim(ctx) {
    await writeResult(ctx, () =>
      adminReviewClaimService(strapi).claim(ctx.request.body, getRequestContext(ctx))
    );
  },

  async heartbeat(ctx) {
    await writeResult(ctx, () =>
      adminReviewClaimService(strapi).heartbeat(ctx.request.body, getRequestContext(ctx))
    );
  },

  async release(ctx) {
    await writeResult(ctx, () =>
      adminReviewClaimService(strapi).release(ctx.request.body, getRequestContext(ctx))
    );
  },
});

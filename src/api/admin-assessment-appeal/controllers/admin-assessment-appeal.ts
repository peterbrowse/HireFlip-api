type RequestContext = {
  ipAddress?: string;
  requestId?: string;
  serviceName?: string;
  userAgent?: string;
};

type AdminAssessmentAppealService = {
  approveReview(input: unknown, context: RequestContext): Promise<unknown>;
  getReviewDetail(input: unknown, context: RequestContext): Promise<unknown>;
  listReviews(input: unknown, context: RequestContext): Promise<unknown>;
  rejectReview(input: unknown, context: RequestContext): Promise<unknown>;
};

const adminAssessmentAppealService = (strapi: { service(uid: string): unknown }) =>
  strapi.service('api::admin-assessment-appeal.admin-assessment-appeal') as unknown as AdminAssessmentAppealService;

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
  async list(ctx) {
    ctx.body = {
      data: await adminAssessmentAppealService(strapi).listReviews(
        ctx.request.body,
        getRequestContext(ctx)
      ),
    };
  },

  async detail(ctx) {
    ctx.body = {
      data: await adminAssessmentAppealService(strapi).getReviewDetail(
        ctx.request.body,
        getRequestContext(ctx)
      ),
    };
  },

  async approve(ctx) {
    await writeResult(ctx, () =>
      adminAssessmentAppealService(strapi).approveReview(
        ctx.request.body,
        getRequestContext(ctx)
      )
    );
  },

  async reject(ctx) {
    await writeResult(ctx, () =>
      adminAssessmentAppealService(strapi).rejectReview(
        ctx.request.body,
        getRequestContext(ctx)
      )
    );
  },
});

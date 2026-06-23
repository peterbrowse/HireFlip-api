type RequestContext = {
  ipAddress?: string;
  requestId?: string;
  serviceName?: string;
  userAgent?: string;
};

type EmployerDashboardService = {
  acceptInvite(input: unknown, context: RequestContext): Promise<unknown>;
  acceptPendingInvite(input: unknown, context: RequestContext): Promise<unknown>;
  completeOnboarding(input: unknown, context: RequestContext): Promise<unknown>;
  createInviteSetupTicket(input: unknown, context: RequestContext): Promise<unknown>;
  inviteInterviewFeedbackContributor(input: unknown, context: RequestContext): Promise<unknown>;
  createInterviewSlotOffer(input: unknown, context: RequestContext): Promise<unknown>;
  declineCapacityClaim(input: unknown, context: RequestContext): Promise<unknown>;
  getCapacityClaim(input: unknown, context: RequestContext): Promise<unknown>;
  getInterviewFeedbackDetail(input: unknown, context: RequestContext): Promise<unknown>;
  getInterviewDetail(input: unknown, context: RequestContext): Promise<unknown>;
  getOnboarding(input: unknown, context: RequestContext): Promise<unknown>;
  getOverview(input: unknown, context: RequestContext): Promise<unknown>;
  inviteTeamContact(input: unknown, context: RequestContext): Promise<unknown>;
  revokeInterviewFeedbackInvite(input: unknown, context: RequestContext): Promise<unknown>;
  updateInterviewSetup(input: unknown, context: RequestContext): Promise<unknown>;
  updateProfile(input: unknown, context: RequestContext): Promise<unknown>;
  updateProfileImage(input: unknown, file: unknown, context: RequestContext): Promise<unknown>;
  updateSettings(input: unknown, context: RequestContext): Promise<unknown>;
  submitInterviewFeedback(input: unknown, context: RequestContext): Promise<unknown>;
  submitInvitedInterviewFeedback(input: unknown, context: RequestContext): Promise<unknown>;
  validateInterviewFeedbackInvite(input: unknown, context: RequestContext): Promise<unknown>;
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

const getUploadedProfileImage = (files) => {
  const file = files?.profileImage || files?.image || files?.file;

  return Array.isArray(file) ? file[0] : file;
};

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

	  async interviewDetail(ctx) {
    ctx.body = {
      data: await employerDashboardService(strapi).getInterviewDetail(
        ctx.request.body,
        getRequestContext(ctx)
      ),
    };
	  },

	  async updateInterviewSetup(ctx) {
    ctx.body = {
      data: await employerDashboardService(strapi).updateInterviewSetup(
        ctx.request.body,
        getRequestContext(ctx)
      ),
    };
	  },

	  async interviewFeedbackDetail(ctx) {
    ctx.body = {
      data: await employerDashboardService(strapi).getInterviewFeedbackDetail(
        ctx.request.body,
        getRequestContext(ctx)
      ),
    };
	  },

	  async submitInterviewFeedback(ctx) {
    ctx.body = {
      data: await employerDashboardService(strapi).submitInterviewFeedback(
        ctx.request.body,
        getRequestContext(ctx)
      ),
    };
	  },

	  async inviteInterviewFeedbackContributor(ctx) {
    ctx.body = {
      data: await employerDashboardService(strapi).inviteInterviewFeedbackContributor(
        ctx.request.body,
        getRequestContext(ctx)
      ),
    };
	  },

	  async revokeInterviewFeedbackInvite(ctx) {
    ctx.body = {
      data: await employerDashboardService(strapi).revokeInterviewFeedbackInvite(
        ctx.request.body,
        getRequestContext(ctx)
      ),
    };
	  },

	  async validateInterviewFeedbackInvite(ctx) {
    ctx.body = {
      data: await employerDashboardService(strapi).validateInterviewFeedbackInvite(
        ctx.request.body,
        getRequestContext(ctx)
      ),
    };
	  },

	  async submitInvitedInterviewFeedback(ctx) {
    ctx.body = {
      data: await employerDashboardService(strapi).submitInvitedInterviewFeedback(
        ctx.request.body,
        getRequestContext(ctx)
      ),
    };
	  },

  async capacityClaim(ctx) {
    ctx.body = {
      data: await employerDashboardService(strapi).getCapacityClaim(
        ctx.request.body,
        getRequestContext(ctx)
      ),
    };
  },

  async declineCapacityClaim(ctx) {
    ctx.body = {
      data: await employerDashboardService(strapi).declineCapacityClaim(
        ctx.request.body,
        getRequestContext(ctx)
      ),
    };
  },

	  async onboarding(ctx) {
	    ctx.body = {
	      data: await employerDashboardService(strapi).getOnboarding(
	        ctx.request.body,
	        getRequestContext(ctx)
	      ),
	    };
	  },

	  async completeOnboarding(ctx) {
	    ctx.body = {
	      data: await employerDashboardService(strapi).completeOnboarding(
	        ctx.request.body,
	        getRequestContext(ctx)
	      ),
	    };
	  },

	  async updateSettings(ctx) {
	    ctx.body = {
	      data: await employerDashboardService(strapi).updateSettings(
	        ctx.request.body,
	        getRequestContext(ctx)
	      ),
	    };
	  },

	  async updateProfile(ctx) {
	    ctx.body = {
	      data: await employerDashboardService(strapi).updateProfile(
	        ctx.request.body,
	        getRequestContext(ctx)
	      ),
	    };
	  },

	  async updateProfileImage(ctx) {
	    ctx.body = {
	      data: await employerDashboardService(strapi).updateProfileImage(
	        ctx.request.body,
	        getUploadedProfileImage(ctx.request.files),
	        getRequestContext(ctx)
	      ),
	    };
	  },

	  async inviteTeamContact(ctx) {
	    ctx.body = {
	      data: await employerDashboardService(strapi).inviteTeamContact(
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

  async acceptPendingInvite(ctx) {
    ctx.body = {
      data: await employerDashboardService(strapi).acceptPendingInvite(
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

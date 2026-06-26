type RequestContext = {
  ipAddress?: string;
  requestId?: string;
  serviceName?: string;
  userAgent?: string;
};

type PrivacyRightsRequestService = {
  adminAction(input: unknown, context: RequestContext): Promise<unknown>;
  adminAnonymiseCandidate(input: unknown, context: RequestContext): Promise<unknown>;
  adminDownloadExport(input: unknown, context: RequestContext): Promise<unknown>;
  adminGetRequest(input: unknown, context: RequestContext): Promise<unknown>;
  adminListRequests(input: unknown, context: RequestContext): Promise<unknown>;
  adminRequestDownloadCode(input: unknown, context: RequestContext): Promise<unknown>;
  candidateCreateRequest(auth: unknown, input: unknown, context: RequestContext): Promise<unknown>;
  candidateDownloadExport(auth: unknown, requestDocumentId: string, input: unknown, context: RequestContext): Promise<unknown>;
  candidateEmailDownloadLink(auth: unknown, requestDocumentId: string, context: RequestContext): Promise<unknown>;
  candidateListRequests(auth: unknown): Promise<unknown>;
  candidateRequestDownloadCode(auth: unknown, requestDocumentId: string, context: RequestContext): Promise<unknown>;
  candidateReplyToRequest(auth: unknown, requestDocumentId: string, input: unknown, context: RequestContext): Promise<unknown>;
  employerCreateRequest(input: unknown, context: RequestContext): Promise<unknown>;
  employerDownloadExport(input: unknown, context: RequestContext): Promise<unknown>;
  employerEmailDownloadLink(input: unknown, context: RequestContext): Promise<unknown>;
  employerListRequests(input: unknown): Promise<unknown>;
  employerRequestDownloadCode(input: unknown, context: RequestContext): Promise<unknown>;
  employerReplyToRequest(input: unknown, context: RequestContext): Promise<unknown>;
};

const privacyRightsRequestService = (strapi: { service(uid: string): unknown }): PrivacyRightsRequestService =>
  strapi.service('api::privacy-rights-request.privacy-rights-request') as unknown as PrivacyRightsRequestService;

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
  async candidateList(ctx) {
    ctx.body = {
      data: await privacyRightsRequestService(strapi).candidateListRequests(ctx.state.hireflipAuth),
    };
  },

  async candidateCreate(ctx) {
    ctx.body = {
      data: await privacyRightsRequestService(strapi).candidateCreateRequest(
        ctx.state.hireflipAuth,
        ctx.request.body,
        getRequestContext(ctx)
      ),
    };
  },

  async candidateRequestDownloadCode(ctx) {
    ctx.body = {
      data: await privacyRightsRequestService(strapi).candidateRequestDownloadCode(
        ctx.state.hireflipAuth,
        ctx.params.requestDocumentId,
        getRequestContext(ctx)
      ),
    };
  },

  async candidateDownloadExport(ctx) {
    ctx.body = {
      data: await privacyRightsRequestService(strapi).candidateDownloadExport(
        ctx.state.hireflipAuth,
        ctx.params.requestDocumentId,
        ctx.request.body,
        getRequestContext(ctx)
      ),
    };
  },

  async candidateEmailDownloadLink(ctx) {
    ctx.body = {
      data: await privacyRightsRequestService(strapi).candidateEmailDownloadLink(
        ctx.state.hireflipAuth,
        ctx.params.requestDocumentId,
        getRequestContext(ctx)
      ),
    };
  },

  async candidateReply(ctx) {
    ctx.body = {
      data: await privacyRightsRequestService(strapi).candidateReplyToRequest(
        ctx.state.hireflipAuth,
        ctx.params.requestDocumentId,
        ctx.request.body,
        getRequestContext(ctx)
      ),
    };
  },

  async employerList(ctx) {
    ctx.body = {
      data: await privacyRightsRequestService(strapi).employerListRequests(ctx.request.body),
    };
  },

  async employerCreate(ctx) {
    ctx.body = {
      data: await privacyRightsRequestService(strapi).employerCreateRequest(
        ctx.request.body,
        getRequestContext(ctx)
      ),
    };
  },

  async employerRequestDownloadCode(ctx) {
    ctx.body = {
      data: await privacyRightsRequestService(strapi).employerRequestDownloadCode(
        ctx.request.body,
        getRequestContext(ctx)
      ),
    };
  },

  async employerDownloadExport(ctx) {
    ctx.body = {
      data: await privacyRightsRequestService(strapi).employerDownloadExport(
        ctx.request.body,
        getRequestContext(ctx)
      ),
    };
  },

  async employerEmailDownloadLink(ctx) {
    ctx.body = {
      data: await privacyRightsRequestService(strapi).employerEmailDownloadLink(
        ctx.request.body,
        getRequestContext(ctx)
      ),
    };
  },

  async employerReply(ctx) {
    ctx.body = {
      data: await privacyRightsRequestService(strapi).employerReplyToRequest(
        ctx.request.body,
        getRequestContext(ctx)
      ),
    };
  },

  async adminList(ctx) {
    ctx.body = {
      data: await privacyRightsRequestService(strapi).adminListRequests(
        ctx.request.body,
        getRequestContext(ctx)
      ),
    };
  },

  async adminDetail(ctx) {
    ctx.body = {
      data: await privacyRightsRequestService(strapi).adminGetRequest(
        ctx.request.body,
        getRequestContext(ctx)
      ),
    };
  },

  async adminAction(ctx) {
    ctx.body = {
      data: await privacyRightsRequestService(strapi).adminAction(
        ctx.request.body,
        getRequestContext(ctx)
      ),
    };
  },

  async adminRequestDownloadCode(ctx) {
    ctx.body = {
      data: await privacyRightsRequestService(strapi).adminRequestDownloadCode(
        ctx.request.body,
        getRequestContext(ctx)
      ),
    };
  },

  async adminDownloadExport(ctx) {
    ctx.body = {
      data: await privacyRightsRequestService(strapi).adminDownloadExport(
        ctx.request.body,
        getRequestContext(ctx)
      ),
    };
  },

  async adminAnonymiseCandidate(ctx) {
    ctx.body = {
      data: await privacyRightsRequestService(strapi).adminAnonymiseCandidate(
        ctx.request.body,
        getRequestContext(ctx)
      ),
    };
  },
});

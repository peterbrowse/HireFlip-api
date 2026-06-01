import { factories } from '@strapi/strapi';

type RequestContext = {
  ipAddress?: string;
  requestId?: string;
  userAgent?: string;
};

type CreatedResponse = {
  created?: boolean;
  data?: unknown;
};

type CandidateService = {
  cancelCurrentCandidateClassReservation(
    auth: unknown,
    reservationDocumentId: string,
    context: RequestContext
  ): Promise<unknown>;
  confirmCurrentCandidateClassReservationPayment(
    auth: unknown,
    reservationDocumentId: string,
    input: unknown,
    context: RequestContext
  ): Promise<unknown>;
  createCurrentCandidateUnlistedInterest(auth: unknown, input: unknown, context: RequestContext): Promise<unknown>;
  expireCurrentCandidateClassReservation(
    auth: unknown,
    reservationDocumentId: string,
    context: RequestContext
  ): Promise<unknown>;
  getCandidatePreferenceOptions(auth: unknown): Promise<unknown>;
  getCurrentCandidateClassInterest(auth: unknown): Promise<unknown>;
  getCurrentCandidateClassReservation(
    auth: unknown,
    reservationDocumentId: string,
    context: RequestContext
  ): Promise<unknown>;
  registerCurrentCandidateClassInterest(auth: unknown, input: unknown, context: RequestContext): Promise<CreatedResponse>;
  reserveCurrentCandidateClassPlace(auth: unknown, input: unknown, context: RequestContext): Promise<CreatedResponse>;
  syncCurrentCandidate(auth: unknown, input: unknown, context: RequestContext): Promise<unknown>;
  updateCurrentCandidateAccount(auth: unknown, input: unknown, context: RequestContext): Promise<unknown>;
  updateCurrentCandidateProfileImage(auth: unknown, file: unknown, context: RequestContext): Promise<unknown>;
  withdrawCurrentCandidateClassInterest(auth: unknown, input: unknown, context: RequestContext): Promise<CreatedResponse>;
};

const candidateService = (strapi: { service(uid: string): unknown }): CandidateService =>
  strapi.service('api::candidate.candidate') as unknown as CandidateService;

const getForwardedClientIp = (ctx) =>
  ctx.request.get('x-hireflip-client-ip') ||
  ctx.request.get('cf-connecting-ip') ||
  ctx.request.get('x-forwarded-for')?.split(',')[0]?.trim() ||
  ctx.request.ip;

const getUploadedProfileImage = (files) => {
  const file = files?.profileImage || files?.image || files?.file;
  return Array.isArray(file) ? file[0] : file;
};

export default factories.createCoreController('api::candidate.candidate', ({ strapi }) => ({
  async me(ctx) {
    const result = await candidateService(strapi).syncCurrentCandidate(
      ctx.state?.hireflipAuth,
      ctx.request.body,
      {
        ipAddress: getForwardedClientIp(ctx),
        requestId: ctx.state?.requestId,
        userAgent: ctx.request.get('x-hireflip-client-user-agent') || ctx.request.get('user-agent'),
      }
    );

    ctx.body = {
      data: result,
    };
  },

  async updateAccount(ctx) {
    const result = await candidateService(strapi).updateCurrentCandidateAccount(
      ctx.state?.hireflipAuth,
      ctx.request.body,
      {
        ipAddress: getForwardedClientIp(ctx),
        requestId: ctx.state?.requestId,
        userAgent: ctx.request.get('x-hireflip-client-user-agent') || ctx.request.get('user-agent'),
      }
    );

    ctx.body = {
      data: result,
    };
  },

  async updateProfileImage(ctx) {
    const file = getUploadedProfileImage(ctx.request.files);
    const result = await candidateService(strapi).updateCurrentCandidateProfileImage(
      ctx.state?.hireflipAuth,
      file,
      {
        ipAddress: getForwardedClientIp(ctx),
        requestId: ctx.state?.requestId,
        userAgent: ctx.request.get('x-hireflip-client-user-agent') || ctx.request.get('user-agent'),
      }
    );

    ctx.body = {
      data: result,
    };
  },

  async classInterest(ctx) {
    const result = await candidateService(strapi).getCurrentCandidateClassInterest(
      ctx.state?.hireflipAuth
    );

    ctx.body = {
      data: result,
    };
  },

  async preferenceOptions(ctx) {
    const result = await candidateService(strapi).getCandidatePreferenceOptions(
      ctx.state?.hireflipAuth
    );

    ctx.body = {
      data: result,
    };
  },

  async registerClassInterest(ctx) {
    const result = await candidateService(strapi).registerCurrentCandidateClassInterest(
      ctx.state?.hireflipAuth,
      ctx.request.body,
      {
        ipAddress: getForwardedClientIp(ctx),
        requestId: ctx.state?.requestId,
        userAgent: ctx.request.get('x-hireflip-client-user-agent') || ctx.request.get('user-agent'),
      }
    );

    ctx.status = result.created ? 201 : 200;
    ctx.body = {
      data: result.data,
    };
  },

  async withdrawClassInterest(ctx) {
    const body = typeof ctx.request.body === 'object' && ctx.request.body ? ctx.request.body : {};
    const queryClassDocumentId =
      typeof ctx.query?.classDocumentId === 'string' ? ctx.query.classDocumentId : undefined;
    const input = queryClassDocumentId ? { ...body, classDocumentId: queryClassDocumentId } : body;
    const result = await candidateService(strapi).withdrawCurrentCandidateClassInterest(
      ctx.state?.hireflipAuth,
      input,
      {
        ipAddress: getForwardedClientIp(ctx),
        requestId: ctx.state?.requestId,
        userAgent: ctx.request.get('x-hireflip-client-user-agent') || ctx.request.get('user-agent'),
      }
    );

    ctx.body = {
      data: result.data,
    };
  },

  async reserveClassPlace(ctx) {
    const result = await candidateService(strapi).reserveCurrentCandidateClassPlace(
      ctx.state?.hireflipAuth,
      ctx.request.body,
      {
        ipAddress: getForwardedClientIp(ctx),
        requestId: ctx.state?.requestId,
        userAgent: ctx.request.get('x-hireflip-client-user-agent') || ctx.request.get('user-agent'),
      }
    );

    ctx.status = result.created ? 201 : 200;
    ctx.body = {
      data: result,
    };
  },

  async classReservation(ctx) {
    const result = await candidateService(strapi).getCurrentCandidateClassReservation(
      ctx.state?.hireflipAuth,
      ctx.params?.reservationDocumentId,
      {
        ipAddress: getForwardedClientIp(ctx),
        requestId: ctx.state?.requestId,
        userAgent: ctx.request.get('x-hireflip-client-user-agent') || ctx.request.get('user-agent'),
      }
    );

    ctx.body = {
      data: result,
    };
  },

  async cancelClassReservation(ctx) {
    const result = await candidateService(strapi).cancelCurrentCandidateClassReservation(
      ctx.state?.hireflipAuth,
      ctx.params?.reservationDocumentId,
      {
        ipAddress: getForwardedClientIp(ctx),
        requestId: ctx.state?.requestId,
        userAgent: ctx.request.get('x-hireflip-client-user-agent') || ctx.request.get('user-agent'),
      }
    );

    ctx.body = {
      data: result,
    };
  },

  async confirmClassReservationPayment(ctx) {
    const result = await candidateService(strapi).confirmCurrentCandidateClassReservationPayment(
      ctx.state?.hireflipAuth,
      ctx.params?.reservationDocumentId,
      ctx.request.body,
      {
        ipAddress: getForwardedClientIp(ctx),
        requestId: ctx.state?.requestId,
        userAgent: ctx.request.get('x-hireflip-client-user-agent') || ctx.request.get('user-agent'),
      }
    );

    ctx.body = {
      data: result,
    };
  },

  async expireClassReservation(ctx) {
    const result = await candidateService(strapi).expireCurrentCandidateClassReservation(
      ctx.state?.hireflipAuth,
      ctx.params?.reservationDocumentId,
      {
        ipAddress: getForwardedClientIp(ctx),
        requestId: ctx.state?.requestId,
        userAgent: ctx.request.get('x-hireflip-client-user-agent') || ctx.request.get('user-agent'),
      }
    );

    ctx.body = {
      data: result,
    };
  },

  async createUnlistedInterest(ctx) {
    const result = await candidateService(strapi).createCurrentCandidateUnlistedInterest(
      ctx.state?.hireflipAuth,
      ctx.request.body,
      {
        ipAddress: getForwardedClientIp(ctx),
        requestId: ctx.state?.requestId,
        userAgent: ctx.request.get('x-hireflip-client-user-agent') || ctx.request.get('user-agent'),
      }
    );

    ctx.status = 201;
    ctx.body = {
      data: result,
    };
  },
}));

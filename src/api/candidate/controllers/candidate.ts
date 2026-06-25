import { PassThrough } from 'node:stream';
import { factories } from '@strapi/strapi';
import {
  createClassRealtimeSubscriber,
  getClassRealtimeChannelsForInterest,
} from '../../../utils/class-realtime-events';

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
  acceptCurrentCandidateInterviewSlotOffer(
    auth: unknown,
    offerDocumentId: string,
    input: unknown,
    context: RequestContext
  ): Promise<unknown>;
  acceptCurrentCandidateClassReservationTerms(
    auth: unknown,
    reservationDocumentId: string,
    input: unknown,
    context: RequestContext
  ): Promise<unknown>;
  autofillCurrentCandidateInterviewReadinessFromCv(
    auth: unknown,
    file: unknown,
    context: RequestContext
  ): Promise<unknown>;
  cancelCurrentCandidateClassReservation(
    auth: unknown,
    reservationDocumentId: string,
    context: RequestContext
  ): Promise<unknown>;
  createCurrentCandidateUnlistedInterest(auth: unknown, input: unknown, context: RequestContext): Promise<unknown>;
  beginCurrentCandidateCourse(auth: unknown, context: RequestContext): Promise<unknown>;
  createCurrentCandidateCourseAppeal(
    auth: unknown,
    testDocumentId: string,
    input: unknown,
    context: RequestContext
  ): Promise<unknown>;
  declineCurrentCandidateInterviewSlotOffer(
    auth: unknown,
    offerDocumentId: string,
    input: unknown,
    context: RequestContext
  ): Promise<unknown>;
  disputeCurrentCandidateInterviewStrike(
    auth: unknown,
    strikeDocumentId: string,
    input: unknown,
    context: RequestContext
  ): Promise<unknown>;
  declineCurrentCandidateWaitingListOffer(
    auth: unknown,
    offerDocumentId: string,
    context: RequestContext
  ): Promise<unknown>;
  expireCurrentCandidateClassReservation(
    auth: unknown,
    reservationDocumentId: string,
    context: RequestContext
  ): Promise<unknown>;
  flagCurrentCandidateInterviewFeedbackReport(
    auth: unknown,
    interviewDocumentId: string,
    input: unknown,
    context: RequestContext
  ): Promise<unknown>;
  getCandidatePreferenceOptions(auth: unknown): Promise<unknown>;
  getCurrentCandidateClassInterest(auth: unknown): Promise<unknown>;
  getCurrentCandidateCourse(auth: unknown): Promise<unknown>;
  getCurrentCandidateInterviewReadiness(auth: unknown): Promise<unknown>;
  getCurrentCandidateInterviewSlotOffers(auth: unknown, context: RequestContext): Promise<unknown>;
  getCurrentCandidateClassReservation(
    auth: unknown,
    reservationDocumentId: string,
    context: RequestContext
  ): Promise<unknown>;
  getCurrentCandidateSupportCase(auth: unknown, supportCaseDocumentId: string): Promise<unknown>;
  getCurrentCandidateSupportCases(auth: unknown): Promise<unknown>;
  registerCurrentCandidateClassInterest(auth: unknown, input: unknown, context: RequestContext): Promise<CreatedResponse>;
  replyToCurrentCandidateSupportCase(
    auth: unknown,
    supportCaseDocumentId: string,
    input: unknown,
    context: RequestContext
  ): Promise<unknown>;
  recordCurrentCandidateCourseMaterialProgress(
    auth: unknown,
    materialDocumentId: string,
    input: unknown,
    context: RequestContext
  ): Promise<unknown>;
  reserveCurrentCandidateClassPlace(auth: unknown, input: unknown, context: RequestContext): Promise<CreatedResponse>;
  submitCurrentCandidateCourseTest(
    auth: unknown,
    testDocumentId: string,
    input: unknown,
    context: RequestContext
  ): Promise<unknown>;
  syncCurrentCandidate(auth: unknown, input: unknown, context: RequestContext): Promise<unknown>;
  updateCurrentCandidateAccount(auth: unknown, input: unknown, context: RequestContext): Promise<unknown>;
  updateCurrentCandidateInterviewReadiness(auth: unknown, input: unknown, context: RequestContext): Promise<unknown>;
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

const getUploadedCvFile = (files) => {
  const file = files?.cv || files?.cvFile || files?.file;
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

  async course(ctx) {
    const result = await candidateService(strapi).getCurrentCandidateCourse(
      ctx.state?.hireflipAuth
    );

    ctx.body = {
      data: result,
    };
  },

  async beginCourse(ctx) {
    const result = await candidateService(strapi).beginCurrentCandidateCourse(
      ctx.state?.hireflipAuth,
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

  async recordMaterialProgress(ctx) {
    const result = await candidateService(strapi).recordCurrentCandidateCourseMaterialProgress(
      ctx.state?.hireflipAuth,
      ctx.params?.materialDocumentId,
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

  async submitCourseTest(ctx) {
    const result = await candidateService(strapi).submitCurrentCandidateCourseTest(
      ctx.state?.hireflipAuth,
      ctx.params?.testDocumentId,
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

  async createCourseAppeal(ctx) {
    const result = await candidateService(strapi).createCurrentCandidateCourseAppeal(
      ctx.state?.hireflipAuth,
      ctx.params?.testDocumentId,
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

  async classEvents(ctx) {
    const classInterest = await candidateService(strapi).getCurrentCandidateClassInterest(
      ctx.state?.hireflipAuth
    );
    const channels = getClassRealtimeChannelsForInterest(classInterest);

    if (channels.length === 0) {
      ctx.status = 204;
      return;
    }

    const stream = new PassThrough();
    let isClosed = false;
    let subscriber: ReturnType<typeof createClassRealtimeSubscriber> | undefined;
    const writeEvent = (event: string, data: unknown) => {
      if (isClosed) {
        return;
      }

      stream.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    const heartbeat = setInterval(() => {
      writeEvent('heartbeat', {
        sentAt: new Date().toISOString(),
      });
    }, 25000);
    const close = () => {
      if (isClosed) {
        return;
      }

      isClosed = true;
      clearInterval(heartbeat);
      subscriber?.disconnect();
      stream.end();
    };

    ctx.req.on('close', close);
    ctx.set('cache-control', 'no-store');
    ctx.set('content-type', 'text/event-stream');
    ctx.set('x-accel-buffering', 'no');
    ctx.status = 200;
    ctx.body = stream;

    subscriber = createClassRealtimeSubscriber();
    subscriber.on('message', (channel, rawMessage) => {
      let payload: unknown = { rawMessage };

      try {
        payload = JSON.parse(rawMessage) as unknown;
      } catch {
        payload = { rawMessage };
      }

      writeEvent('class-update', {
        channel,
        payload,
        receivedAt: new Date().toISOString(),
      });
    });

    void (async () => {
      try {
        await subscriber?.connect();
        await subscriber?.subscribe(...channels);
        writeEvent('connected', {
          channels: channels.length,
          connectedAt: new Date().toISOString(),
        });
      } catch (error) {
        writeEvent('class-update-error', {
          message:
            error instanceof Error
              ? error.message
              : 'Class realtime subscription failed.',
        });
        close();
      }
    })();
  },

  async preferenceOptions(ctx) {
    const result = await candidateService(strapi).getCandidatePreferenceOptions(
      ctx.state?.hireflipAuth
    );

    ctx.body = {
      data: result,
    };
  },

  async interviewSlotOffers(ctx) {
    const result = await candidateService(strapi).getCurrentCandidateInterviewSlotOffers(
      ctx.state?.hireflipAuth,
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

  async interviewReadiness(ctx) {
    const result = await candidateService(strapi).getCurrentCandidateInterviewReadiness(
      ctx.state?.hireflipAuth
    );

    ctx.body = {
      data: result,
    };
  },

  async updateInterviewReadiness(ctx) {
    const result = await candidateService(strapi).updateCurrentCandidateInterviewReadiness(
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

  async autofillInterviewReadiness(ctx) {
    const file = getUploadedCvFile(ctx.request.files);
    const result = await candidateService(strapi).autofillCurrentCandidateInterviewReadinessFromCv(
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

  async acceptInterviewSlotOffer(ctx) {
    const result = await candidateService(strapi).acceptCurrentCandidateInterviewSlotOffer(
      ctx.state?.hireflipAuth,
      ctx.params?.offerDocumentId,
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

  async declineInterviewSlotOffer(ctx) {
    const result = await candidateService(strapi).declineCurrentCandidateInterviewSlotOffer(
      ctx.state?.hireflipAuth,
      ctx.params?.offerDocumentId,
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

  async flagInterviewFeedbackReport(ctx) {
    const result = await candidateService(strapi).flagCurrentCandidateInterviewFeedbackReport(
      ctx.state?.hireflipAuth,
      ctx.params?.interviewDocumentId,
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

  async disputeInterviewStrike(ctx) {
    const result = await candidateService(strapi).disputeCurrentCandidateInterviewStrike(
      ctx.state?.hireflipAuth,
      ctx.params?.strikeDocumentId,
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

  async supportCases(ctx) {
    const result = await candidateService(strapi).getCurrentCandidateSupportCases(
      ctx.state?.hireflipAuth
    );

    ctx.body = {
      data: result,
    };
  },

  async supportCase(ctx) {
    const result = await candidateService(strapi).getCurrentCandidateSupportCase(
      ctx.state?.hireflipAuth,
      ctx.params?.supportCaseDocumentId
    );

    ctx.body = {
      data: result,
    };
  },

  async replyToSupportCase(ctx) {
    const result = await candidateService(strapi).replyToCurrentCandidateSupportCase(
      ctx.state?.hireflipAuth,
      ctx.params?.supportCaseDocumentId,
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

  async declineWaitingListOffer(ctx) {
    const result = await candidateService(strapi).declineCurrentCandidateWaitingListOffer(
      ctx.state?.hireflipAuth,
      ctx.params?.offerDocumentId,
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

  async acceptClassReservationTerms(ctx) {
    const result = await candidateService(strapi).acceptCurrentCandidateClassReservationTerms(
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

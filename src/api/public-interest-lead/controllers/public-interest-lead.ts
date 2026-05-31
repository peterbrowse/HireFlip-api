import { factories } from '@strapi/strapi';

type RequestContext = {
  ipAddress?: string;
  requestId?: string;
  userAgent?: string;
};

type RegisterInterestResult = {
  created: boolean;
  documentId?: string;
};

type PublicInterestLeadService = {
  registerInterest(input: unknown, requestContext: RequestContext): Promise<RegisterInterestResult>;
};

const publicInterestLeadService = (strapi: { service(uid: string): unknown }): PublicInterestLeadService =>
  strapi.service('api::public-interest-lead.public-interest-lead') as PublicInterestLeadService;

const getForwardedClientIp = (ctx) =>
  ctx.request.get('x-hireflip-client-ip') ||
  ctx.request.get('cf-connecting-ip') ||
  ctx.request.get('x-forwarded-for')?.split(',')[0]?.trim() ||
  ctx.request.ip;

export default factories.createCoreController('api::public-interest-lead.public-interest-lead', ({ strapi }) => ({
  async registerInterest(ctx) {
    const result = await publicInterestLeadService(strapi).registerInterest(
      ctx.request.body,
      {
        ipAddress: getForwardedClientIp(ctx),
        userAgent: ctx.request.get('x-hireflip-client-user-agent') || ctx.request.get('user-agent'),
        requestId: ctx.state?.requestId,
      }
    );

    ctx.status = result.created ? 201 : 202;
    ctx.body = {
      data: {
        accepted: true,
        id: result.documentId,
      },
    };
  },
}));

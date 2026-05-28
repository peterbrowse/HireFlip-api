import { factories } from '@strapi/strapi';

export default factories.createCoreController('api::public-interest-lead.public-interest-lead', ({ strapi }) => ({
  async registerInterest(ctx) {
    const result = await (strapi.service('api::public-interest-lead.public-interest-lead') as any).registerInterest(
      ctx.request.body,
      {
        ipAddress: ctx.request.ip,
        userAgent: ctx.request.get('user-agent'),
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

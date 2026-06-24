import { factories } from '@strapi/strapi';
import { PassThrough } from 'node:stream';
import {
  adminRealtimeChannel,
  createAdminRealtimeSubscriber,
  type AdminRealtimeChannel,
} from '../../../utils/admin-realtime-events';

type RequestContext = {
  ipAddress?: string;
  requestId?: string;
  serviceName?: string;
  userAgent?: string;
};

type AdminTaskService = {
  clearTask(input: unknown, context: RequestContext): Promise<unknown>;
  getTaskDetail(input: unknown, context: RequestContext): Promise<unknown>;
  getOverview(input: unknown, context: RequestContext): Promise<unknown>;
  updateTaskState(input: unknown, context: RequestContext): Promise<unknown>;
};

type AdminAuthService = {
  getSession(input: unknown, context: RequestContext): Promise<{
    user: {
      roleKeys: string[];
    };
  }>;
};

const adminTaskService = (strapi: { service(uid: string): unknown }): AdminTaskService =>
  strapi.service('api::admin-task.admin-task') as unknown as AdminTaskService;

const adminAuthService = (strapi: { service(uid: string): unknown }) =>
  strapi.service('api::admin-auth.admin-auth') as unknown as AdminAuthService;

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

const adminRealtimeChannelsForRoles = (roleKeys: string[]) => {
  const channels = new Set<AdminRealtimeChannel>();

  if (roleKeys.some((roleKey) => ['admin', 'sales', 'super_admin'].includes(roleKey))) {
    channels.add('operations');
    channels.add('refunds');
  }

  if (roleKeys.some((roleKey) => ['admin', 'sales', 'super_admin', 'support'].includes(roleKey))) {
    channels.add('support');
  }

  return [...channels].map(adminRealtimeChannel);
};

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

export default factories.createCoreController('api::admin-task.admin-task', ({ strapi }) => ({
  async overview(ctx) {
    const result = await adminTaskService(strapi).getOverview(
      ctx.request.body,
      getRequestContext(ctx)
    );

    ctx.body = {
      data: result,
    };
  },

  async detail(ctx) {
    const result = await adminTaskService(strapi).getTaskDetail(
      ctx.request.body,
      getRequestContext(ctx)
    );

    ctx.body = {
      data: result,
    };
  },

  async clear(ctx) {
    await writeResult(ctx, () =>
      adminTaskService(strapi).clearTask(ctx.request.body, getRequestContext(ctx))
    );
  },

  async updateState(ctx) {
    await writeResult(ctx, () =>
      adminTaskService(strapi).updateTaskState(ctx.request.body, getRequestContext(ctx))
    );
  },

  async events(ctx) {
    const sessionToken = ctx.request.get('x-hireflip-admin-session-token');

    if (!sessionToken) {
      ctx.status = 401;
      ctx.body = {
        error: {
          message: 'Admin session required.',
          status: 401,
        },
      };
      return;
    }

    const session = await adminAuthService(strapi).getSession(
      { sessionToken },
      getRequestContext(ctx)
    );
    const channels = adminRealtimeChannelsForRoles(session.user.roleKeys);

    if (channels.length === 0) {
      ctx.status = 204;
      return;
    }

    const stream = new PassThrough();
    let isClosed = false;
    let subscriber: ReturnType<typeof createAdminRealtimeSubscriber> | undefined;
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

    subscriber = createAdminRealtimeSubscriber();
    subscriber.on('message', (channel, rawMessage) => {
      let payload: unknown = { rawMessage };

      try {
        payload = JSON.parse(rawMessage) as unknown;
      } catch {
        payload = { rawMessage };
      }

      writeEvent('admin-update', {
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
        writeEvent('admin-update-error', {
          message:
            error instanceof Error
              ? error.message
              : 'Admin realtime subscription failed.',
        });
        close();
      }
    })();
  },
}));

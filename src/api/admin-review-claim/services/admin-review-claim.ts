import { randomBytes } from 'node:crypto';
import { factories } from '@strapi/strapi';
import { errors, validateZodSchema, z } from '@strapi/utils';

import {
  type AdminRealtimeChannel,
  publishAdminRealtimeEvent,
} from '../../../utils/admin-realtime-events';

const { ForbiddenError, ValidationError } = errors;

export class ReviewClaimConflictError extends Error {
  status = 409;
  statusCode = 409;
  expose = true;

  constructor(message: string) {
    super(message);
    this.name = 'ReviewClaimConflictError';
  }
}

type RequestContext = {
  ipAddress?: string;
  requestId?: string;
  serviceName?: string;
  userAgent?: string;
};

type AdminSession = {
  user: {
    displayName: string;
    email: string;
    id: string;
    roleKeys: string[];
    roles: string[];
  };
};

type AdminAuthService = {
  getSession(input: unknown, context: RequestContext): Promise<AdminSession>;
};

type AuditEventService = {
  record(input: Record<string, unknown>): Promise<unknown>;
};

type AdminReviewResourceType = 'admin_task' | 'refund_review' | 'support_case';

type DocumentRecord = Record<string, unknown> & {
  claimKey?: string;
  claimToken?: string;
  claimedAt?: string;
  claimedByDisplayName?: string;
  claimedByEmail?: string;
  claimedByRoleKeys?: unknown;
  claimedByStaffUserId?: string;
  documentId?: string;
  expiresAt?: string;
  heartbeatAt?: string;
  id?: number | string;
  metadata?: unknown;
  releaseReason?: string;
  releasedAt?: string;
  resourceDocumentId?: string;
  resourceKey?: string;
  resourceLabel?: string;
  resourceType?: AdminReviewResourceType;
  takeoverCount?: number;
};

type DocumentCollection = {
  create(input: Record<string, unknown>): Promise<DocumentRecord>;
  findMany(input: Record<string, unknown>): Promise<DocumentRecord[]>;
  update(input: Record<string, unknown>): Promise<DocumentRecord>;
};

type StrapiDocumentService = {
  documents(uid: string): unknown;
  log?: {
    error?: (message: string, error?: unknown) => void;
  };
  service(uid: string): unknown;
};

const resourceSchema = z.object({
  resourceDocumentId: z.string().trim().max(160).optional(),
  resourceKey: z.string().trim().min(1).max(300),
  resourceLabel: z.string().trim().max(240).optional(),
  resourceType: z.enum(['admin_task', 'refund_review', 'support_case']),
});

const claimInputSchema = resourceSchema
  .extend({
    sessionToken: z.string().trim().min(32).max(512),
    takeover: z.boolean().optional(),
  })
  .strict();

const tokenInputSchema = z
  .object({
    claimToken: z.string().trim().min(32).max(160),
    sessionToken: z.string().trim().min(32).max(512),
  })
  .strict();

const assertInputSchema = resourceSchema
  .extend({
    claimToken: z.string().trim().min(32).max(160).optional(),
  })
  .strict();

const validateClaimInput = validateZodSchema(claimInputSchema);
const validateTokenInput = validateZodSchema(tokenInputSchema);
const validateAssertInput = validateZodSchema(assertInputSchema);

const documents = (strapi: StrapiDocumentService, uid: string) =>
  strapi.documents(uid) as unknown as DocumentCollection;

const adminAuthService = (strapi: StrapiDocumentService) =>
  strapi.service('api::admin-auth.admin-auth') as unknown as AdminAuthService;

const auditEvents = (strapi: StrapiDocumentService) =>
  strapi.service('api::audit-event.audit-event') as unknown as AuditEventService;

const ttlSeconds = () => {
  const parsedValue = Number.parseInt(process.env.ADMIN_REVIEW_CLAIM_TTL_SECONDS || '', 10);

  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : 10 * 60;
};

const claimKeyFor = (resourceType: AdminReviewResourceType, resourceKey: string) =>
  `${resourceType}:${resourceKey}`;

const token = () => randomBytes(32).toString('base64url');

const expiresAtFrom = (now: Date) => new Date(now.getTime() + ttlSeconds() * 1000).toISOString();

const objectValue = (value: unknown) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const getDocumentId = (record?: DocumentRecord | null) => {
  if (!record) {
    return undefined;
  }

  return typeof record.documentId === 'string'
    ? record.documentId
    : typeof record.id === 'number' || typeof record.id === 'string'
      ? String(record.id)
      : undefined;
};

const isActiveClaim = (claim?: DocumentRecord | null, now = new Date()) =>
  Boolean(
    claim &&
      !claim.releasedAt &&
      typeof claim.expiresAt === 'string' &&
      new Date(claim.expiresAt).getTime() > now.getTime()
  );

const isClaimOwner = (claim: DocumentRecord | undefined | null, session: AdminSession) =>
  Boolean(claim?.claimedByStaffUserId && claim.claimedByStaffUserId === session.user.id);

const canTakeOverClaim = (claim: DocumentRecord | undefined | null, session: AdminSession) =>
  !isActiveClaim(claim) || session.user.roleKeys.includes('super_admin');

const channelsForResource = (resourceType?: AdminReviewResourceType): AdminRealtimeChannel[] => {
  if (resourceType === 'support_case') {
    return ['support'];
  }

  if (resourceType === 'refund_review') {
    return ['operations', 'refunds'];
  }

  return ['operations'];
};

const publicClaim = (
  claim: DocumentRecord | undefined | null,
  session: AdminSession,
  includeToken = false
) => {
  if (!claim) {
    return null;
  }

  const ownedByCurrentUser = isClaimOwner(claim, session);
  const active = isActiveClaim(claim);

  return {
    canTakeOver: !active || session.user.roleKeys.includes('super_admin'),
    claimToken: includeToken && ownedByCurrentUser && active ? claim.claimToken || null : null,
    claimedAt: claim.claimedAt || null,
    claimedBy: {
      displayName: claim.claimedByDisplayName || null,
      email: claim.claimedByEmail || null,
      id: claim.claimedByStaffUserId || null,
      roleKeys: Array.isArray(claim.claimedByRoleKeys) ? claim.claimedByRoleKeys : [],
    },
    expiresAt: claim.expiresAt || null,
    heartbeatAt: claim.heartbeatAt || null,
    isActive: active,
    isOwnedByCurrentUser: ownedByCurrentUser,
    resourceDocumentId: claim.resourceDocumentId || null,
    resourceKey: claim.resourceKey || null,
    resourceLabel: claim.resourceLabel || null,
    resourceType: claim.resourceType || null,
  };
};

const findClaim = async (
  strapi: StrapiDocumentService,
  resourceType: AdminReviewResourceType,
  resourceKey: string
) => {
  const claims = await documents(strapi, 'api::admin-review-claim.admin-review-claim').findMany({
    filters: {
      claimKey: claimKeyFor(resourceType, resourceKey),
    },
    limit: 1,
  });

  return claims[0];
};

const findClaimByToken = async (strapi: StrapiDocumentService, claimToken: string) => {
  const claims = await documents(strapi, 'api::admin-review-claim.admin-review-claim').findMany({
    filters: {
      claimToken,
    },
    limit: 1,
  });

  return claims[0];
};

const recordClaimAudit = async ({
  eventType,
  claim,
  requestContext,
  session,
  strapi,
}: {
  claim: DocumentRecord;
  eventType: string;
  requestContext: RequestContext;
  session: AdminSession;
  strapi: StrapiDocumentService;
}) => {
  await auditEvents(strapi).record({
    actorDisplayName: session.user.displayName,
    actorEmail: session.user.email,
    actorId: session.user.id,
    actorType: 'admin',
    eventCategory: 'admin',
    eventType,
    ipAddress: requestContext.ipAddress,
    metadata: {
      claimDocumentId: getDocumentId(claim),
      claimKey: claim.claimKey,
      expiresAt: claim.expiresAt,
      resourceDocumentId: claim.resourceDocumentId,
      resourceKey: claim.resourceKey,
      resourceType: claim.resourceType,
      takeoverCount: claim.takeoverCount || 0,
    },
    occurredAt: new Date().toISOString(),
    requestId: requestContext.requestId,
    serviceName: requestContext.serviceName,
    severity: 'info',
    source: 'admin_dashboard',
    subjectDisplayName: claim.resourceLabel,
    subjectId: claim.resourceDocumentId || claim.resourceKey,
    subjectType: claim.resourceType,
    userAgent: requestContext.userAgent,
  });
};

const publishClaimChange = async (strapi: StrapiDocumentService, claim: DocumentRecord) =>
  publishAdminRealtimeEvent(
    {
      channels: channelsForResource(claim.resourceType),
      resourceKey: claim.resourceKey,
      resourceType: claim.resourceType,
      type: 'review_claim_changed',
    },
    strapi.log
  );

const assertClaimSession = async (
  strapi: StrapiDocumentService,
  sessionToken: string,
  context: RequestContext
) => {
  const session = await adminAuthService(strapi).getSession({ sessionToken }, context);
  const canUseAdminDashboard = session.user.roleKeys.some((roleKey) =>
    ['admin', 'sales', 'super_admin', 'support'].includes(roleKey)
  );

  if (!canUseAdminDashboard) {
    throw new ForbiddenError('Admin dashboard access is required.');
  }

  return session;
};

export default factories.createCoreService('api::admin-review-claim.admin-review-claim', ({ strapi }) => ({
  async claimForSession(input: unknown, session: AdminSession, requestContext: RequestContext = {}) {
    const body = validateClaimInput({
      ...(objectValue(input)),
      sessionToken: 'x'.repeat(32),
    });
    const now = new Date();
    const expiresAt = expiresAtFrom(now);
    const existingClaim = await findClaim(strapi, body.resourceType, body.resourceKey);

    if (isActiveClaim(existingClaim, now) && !isClaimOwner(existingClaim, session)) {
      if (!body.takeover || !canTakeOverClaim(existingClaim, session)) {
        return {
          reviewClaim: publicClaim(existingClaim, session),
        };
      }
    }

    const data = {
      claimKey: claimKeyFor(body.resourceType, body.resourceKey),
      claimToken: isClaimOwner(existingClaim, session) && existingClaim?.claimToken
        ? existingClaim.claimToken
        : token(),
      claimedAt: isClaimOwner(existingClaim, session) && existingClaim?.claimedAt
        ? existingClaim.claimedAt
        : now.toISOString(),
      claimedByDisplayName: session.user.displayName,
      claimedByEmail: session.user.email,
      claimedByRoleKeys: session.user.roleKeys,
      claimedByStaffUserId: session.user.id,
      expiresAt,
      heartbeatAt: now.toISOString(),
      metadata: {
        ...(objectValue(existingClaim?.metadata)),
        lastClaimRequestId: requestContext.requestId,
      },
      releaseReason: null,
      releasedAt: null,
      resourceDocumentId: body.resourceDocumentId,
      resourceKey: body.resourceKey,
      resourceLabel: body.resourceLabel,
      resourceType: body.resourceType,
      takeoverCount:
        existingClaim && !isClaimOwner(existingClaim, session)
          ? Number(existingClaim.takeoverCount || 0) + 1
          : Number(existingClaim?.takeoverCount || 0),
    };
    let claim: DocumentRecord;
    let eventType = 'admin.review_claim_acquired';

    if (existingClaim?.documentId) {
      eventType = isClaimOwner(existingClaim, session)
        ? 'admin.review_claim_renewed'
        : 'admin.review_claim_taken_over';
      claim = await documents(strapi, 'api::admin-review-claim.admin-review-claim').update({
        documentId: existingClaim.documentId,
        data,
      });
    } else {
      try {
        claim = await documents(strapi, 'api::admin-review-claim.admin-review-claim').create({
          data,
        });
      } catch {
        const racedClaim = await findClaim(strapi, body.resourceType, body.resourceKey);

        if (isActiveClaim(racedClaim, now) && !isClaimOwner(racedClaim, session)) {
          return {
            reviewClaim: publicClaim(racedClaim, session),
          };
        }

        claim = await documents(strapi, 'api::admin-review-claim.admin-review-claim').update({
          documentId: racedClaim.documentId,
          data,
        });
      }
    }

    await recordClaimAudit({ eventType, claim, requestContext, session, strapi });
    await publishClaimChange(strapi, claim);

    return {
      reviewClaim: publicClaim(claim, session, true),
    };
  },

  async claim(input: unknown, requestContext: RequestContext = {}) {
    const body = validateClaimInput(input);
    const session = await assertClaimSession(strapi, body.sessionToken, requestContext);

    return this.claimForSession(body, session, requestContext);
  },

  async heartbeat(input: unknown, requestContext: RequestContext = {}) {
    const body = validateTokenInput(input);
    const session = await assertClaimSession(strapi, body.sessionToken, requestContext);
    const claim = await findClaimByToken(strapi, body.claimToken);

    if (!claim?.documentId || !isClaimOwner(claim, session) || !isActiveClaim(claim)) {
      throw new ReviewClaimConflictError('This review claim is no longer active.');
    }

    const now = new Date();
    const updatedClaim = await documents(strapi, 'api::admin-review-claim.admin-review-claim').update({
      documentId: claim.documentId,
      data: {
        expiresAt: expiresAtFrom(now),
        heartbeatAt: now.toISOString(),
      },
    });

    return {
      reviewClaim: publicClaim(updatedClaim, session, true),
    };
  },

  async release(input: unknown, requestContext: RequestContext = {}) {
    const body = validateTokenInput(input);
    const session = await assertClaimSession(strapi, body.sessionToken, requestContext);
    const claim = await findClaimByToken(strapi, body.claimToken);

    if (!claim?.documentId || !isClaimOwner(claim, session)) {
      throw new ReviewClaimConflictError('This review claim is no longer active.');
    }

    const releasedClaim = await documents(strapi, 'api::admin-review-claim.admin-review-claim').update({
      documentId: claim.documentId,
      data: {
        releaseReason: 'manual',
        releasedAt: new Date().toISOString(),
      },
    });

    await recordClaimAudit({
      eventType: 'admin.review_claim_released',
      claim: releasedClaim,
      requestContext,
      session,
      strapi,
    });
    await publishClaimChange(strapi, releasedClaim);

    return {
      released: true,
      reviewClaim: publicClaim(releasedClaim, session),
    };
  },

  async assertActiveClaimForSession(input: unknown, session: AdminSession) {
    const body = validateAssertInput(input);

    if (!body.claimToken) {
      throw new ReviewClaimConflictError('A current review claim is required before this action can be completed.');
    }

    const claim = await findClaim(strapi, body.resourceType, body.resourceKey);

    if (
      !claim ||
      claim.claimToken !== body.claimToken ||
      !isClaimOwner(claim, session) ||
      !isActiveClaim(claim)
    ) {
      throw new ReviewClaimConflictError('This review claim has expired or is held by another staff member.');
    }

    return claim;
  },

  async activeClaimsForSession(input: unknown, session: AdminSession) {
    const resources = Array.isArray(input) ? input : [];
    const claimKeys = resources
      .map((resource) => {
        const parsed = resourceSchema.safeParse(resource);
        return parsed.success ? claimKeyFor(parsed.data.resourceType, parsed.data.resourceKey) : undefined;
      })
      .filter((value): value is string => Boolean(value));

    if (claimKeys.length === 0) {
      return new Map<string, ReturnType<typeof publicClaim>>();
    }

    const claims = await documents(strapi, 'api::admin-review-claim.admin-review-claim').findMany({
      filters: {
        claimKey: {
          $in: claimKeys,
        },
      },
      limit: claimKeys.length,
    });
    const claimMap = new Map<string, ReturnType<typeof publicClaim>>();

    for (const claim of claims) {
      if (claim.claimKey) {
        claimMap.set(claim.claimKey, publicClaim(claim, session));
      }
    }

    return claimMap;
  },
}));

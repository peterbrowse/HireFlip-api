import { createHash, randomBytes } from 'node:crypto';
import { errors, validateZodSchema, z } from '@strapi/utils';

const { ForbiddenError, ValidationError } = errors;

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

type DocumentRecord = Record<string, unknown> & {
  acceptedAt?: string;
  acceptedByEmail?: string;
  acceptedByAuthIdentityId?: string;
  accountCreatedAt?: string;
  authIdentityId?: string;
  companyName?: string;
  contactState?: string;
  createdAt?: string;
  createdByStaffDisplayName?: string;
  createdByStaffEmail?: string;
  documentId?: string;
  email?: string;
  employer?: DocumentRecord;
  employerContact?: DocumentRecord;
  employerState?: string;
  expiresAt?: string;
  firstName?: string;
  id?: number | string;
  invitedAt?: string;
  initialInterviewCommitmentCadence?: string;
  initialInterviewCommitmentVolume?: number;
  interviewCommitmentCadence?: string;
  interviewCommitmentVolume?: number;
  inviteEmail?: string;
  inviteState?: string;
  lastName?: string;
  lastSentAt?: string;
  metadata?: unknown;
  region?: string;
  roleTitle?: string;
  updatedAt?: string;
};

type DocumentCollection = {
  create(input: Record<string, unknown>): Promise<DocumentRecord>;
  findMany(input: Record<string, unknown>): Promise<DocumentRecord[]>;
  update(input: Record<string, unknown>): Promise<DocumentRecord>;
};

type StrapiDocumentService = {
  documents(uid: string): unknown;
  service(uid: string): unknown;
};

const sessionTokenSchema = z
  .object({
    sessionToken: z.string().trim().min(32).max(512),
  })
  .strict();

const cadenceSchema = z.enum(['not_set', 'quarterly', 'biannually', 'annually']);

const createInviteSchema = sessionTokenSchema
  .extend({
    companyName: z.string().trim().min(1).max(200),
    contactEmail: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
    expiresInDays: z.number().int().min(1).max(60).default(14),
    firstName: z.string().trim().max(120).optional().transform((value) => value || undefined),
    interviewCommitmentCadence: cadenceSchema.default('not_set'),
    interviewCommitmentVolume: z.number().int().min(0).max(1000).optional(),
    lastName: z.string().trim().max(120).optional().transform((value) => value || undefined),
    region: z.string().trim().max(120).optional().transform((value) => value || undefined),
    roleTitle: z.string().trim().max(160).optional().transform((value) => value || undefined),
  })
  .strict();

const inviteActionSchema = sessionTokenSchema
  .extend({
    employerInviteDocumentId: z.string().trim().min(1).max(80),
  })
  .strict();

const validateSessionToken = validateZodSchema(sessionTokenSchema);
const validateCreateInvite = validateZodSchema(createInviteSchema);
const validateInviteAction = validateZodSchema(inviteActionSchema);

const documents = (strapi: StrapiDocumentService, uid: string) =>
  strapi.documents(uid) as DocumentCollection;

const adminAuthService = (strapi: StrapiDocumentService): AdminAuthService =>
  strapi.service('api::admin-auth.admin-auth') as unknown as AdminAuthService;

const getDocumentId = (record?: DocumentRecord | null) =>
  typeof record?.documentId === 'string' ? record.documentId : null;

const compact = <T>(items: Array<T | false | null | undefined>) =>
  items.filter((item): item is T => Boolean(item));

const hasAnyRole = (session: AdminSession, roles: string[]) =>
  roles.some((role) => session.user.roleKeys.includes(role));

const assertEmployerManageSession = async (
  strapi: StrapiDocumentService,
  sessionToken: string,
  context: RequestContext
) => {
  const session = await adminAuthService(strapi).getSession({ sessionToken }, context);

  if (!hasAnyRole(session, ['admin', 'sales', 'super_admin'])) {
    throw new ForbiddenError('Sales, Admin, or Super Admin access is required.');
  }

  return session;
};

const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

const generateInviteToken = () => randomBytes(32).toString('base64url');

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

const employerDashboardBaseUrl = () =>
  trimTrailingSlash(process.env.EMPLOYER_DASHBOARD_BASE_URL || 'http://localhost:3004');

const inviteUrl = (token: string) =>
  `${employerDashboardBaseUrl()}/invite/${encodeURIComponent(token)}`;

const addDays = (days: number) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
};

const humanize = (value?: string | null) =>
  String(value || 'not recorded')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const contactName = (contact?: DocumentRecord | null) =>
  compact([contact?.firstName, contact?.lastName]).join(' ') ||
  contact?.email ||
  'Employer contact';

const publicInvite = (invite: DocumentRecord, rawToken?: string) => ({
  acceptedAt: invite.acceptedAt || null,
  acceptedByEmail: invite.acceptedByEmail || null,
  companyName: invite.employer?.companyName || 'Employer',
  contactEmail: invite.inviteEmail || invite.employerContact?.email || null,
  contactName: contactName(invite.employerContact),
  createdAt: invite.createdAt || null,
  createdBy: invite.createdByStaffDisplayName || invite.createdByStaffEmail || null,
  documentId: getDocumentId(invite) || String(invite.id || ''),
  employerDocumentId: getDocumentId(invite.employer),
  expiresAt: invite.expiresAt || null,
  inviteState: invite.inviteState || 'pending',
  inviteStateLabel: humanize(String(invite.inviteState || 'pending')),
  inviteUrl: rawToken ? inviteUrl(rawToken) : null,
  lastSentAt: invite.lastSentAt || null,
  region: invite.employer?.region || null,
  roleTitle: invite.employerContact?.roleTitle || null,
  updatedAt: invite.updatedAt || null,
});

const findEmployerContactByEmail = async (strapi: StrapiDocumentService, email: string) => {
  const contacts = await documents(strapi, 'api::employer-contact.employer-contact').findMany({
    filters: {
      email,
    },
    limit: 1,
    populate: ['employer'],
  });

  return contacts[0] || null;
};

const findInviteByDocumentId = async (strapi: StrapiDocumentService, documentId: string) => {
  const invites = await documents(strapi, 'api::employer-invite.employer-invite').findMany({
    filters: {
      documentId,
    },
    limit: 1,
    populate: ['employer', 'employerContact'],
  });

  return invites[0] || null;
};

const expireIfNeeded = async (strapi: StrapiDocumentService, invite?: DocumentRecord | null) => {
  if (!invite) {
    return null;
  }

  if (
    invite.inviteState === 'pending' &&
    invite.expiresAt &&
    Date.parse(invite.expiresAt) <= Date.now()
  ) {
    const inviteDocumentId = getDocumentId(invite);

    if (!inviteDocumentId) {
      throw new ValidationError('Employer invite could not be updated.');
    }

    return documents(strapi, 'api::employer-invite.employer-invite').update({
      documentId: inviteDocumentId,
      data: {
        inviteState: 'expired',
      },
      populate: ['employer', 'employerContact'],
    });
  }

  return invite;
};

const revokePendingInvitesForContact = async (
  strapi: StrapiDocumentService,
  employerContactDocumentId: string
) => {
  const invites = await documents(strapi, 'api::employer-invite.employer-invite').findMany({
    filters: {
      employerContact: {
        documentId: employerContactDocumentId,
      },
      inviteState: 'pending',
    },
    limit: 100,
  });

  await Promise.all(
    invites.map((invite) => {
      const inviteDocumentId = getDocumentId(invite);

      if (!inviteDocumentId) {
        return Promise.resolve(invite);
      }

      return documents(strapi, 'api::employer-invite.employer-invite').update({
        documentId: inviteDocumentId,
        data: {
          inviteState: 'revoked',
          revokedAt: new Date().toISOString(),
        },
      });
    })
  );
};

export default ({ strapi }) => ({
  async listInvites(input: unknown, requestContext: RequestContext = {}) {
    const body = validateSessionToken(input);
    const session = await assertEmployerManageSession(strapi, body.sessionToken, requestContext);
    const invites = await documents(strapi, 'api::employer-invite.employer-invite').findMany({
      limit: 100,
      populate: ['employer', 'employerContact'],
      sort: ['createdAt:desc'],
    });
    const normalizedInvites = await Promise.all(
      invites.map((invite) => expireIfNeeded(strapi, invite))
    );
    const publicInvites = compact(normalizedInvites).map((invite) => publicInvite(invite));

    return {
      invites: publicInvites,
      totalInvites: publicInvites.length,
      user: session.user,
    };
  },

  async createInvite(input: unknown, requestContext: RequestContext = {}) {
    const body = validateCreateInvite(input);
    const session = await assertEmployerManageSession(strapi, body.sessionToken, requestContext);
    const now = new Date().toISOString();
    let employerContact = await findEmployerContactByEmail(strapi, body.contactEmail);
    let employer = employerContact?.employer || null;

    if (employerContact?.authIdentityId && employerContact.contactState === 'active') {
      throw new ValidationError('This employer contact already has active dashboard access.');
    }

    if (!employer) {
      employer = await documents(strapi, 'api::employer.employer').create({
        data: {
          assignmentMode: 'automatic',
          companyName: body.companyName,
          employerState: 'invited',
          initialInterviewCommitmentCadence: body.interviewCommitmentCadence,
          initialInterviewCommitmentVolume: body.interviewCommitmentVolume ?? null,
          interviewCommitmentCadence: body.interviewCommitmentCadence,
          interviewCommitmentVolume: body.interviewCommitmentVolume ?? null,
          region: body.region || null,
        },
      });
    } else {
      const employerDocumentId = getDocumentId(employer);

      if (!employerDocumentId) {
        throw new ValidationError('Employer record could not be updated.');
      }

      employer = await documents(strapi, 'api::employer.employer').update({
        documentId: employerDocumentId,
        data: {
          companyName: body.companyName,
          employerState: employer.employerState === 'active' ? 'active' : 'invited',
          initialInterviewCommitmentCadence: body.interviewCommitmentCadence,
          initialInterviewCommitmentVolume: body.interviewCommitmentVolume ?? null,
          interviewCommitmentCadence: body.interviewCommitmentCadence,
          interviewCommitmentVolume: body.interviewCommitmentVolume ?? null,
          region: body.region || null,
        },
      });
    }

    const employerDocumentId = getDocumentId(employer);

    if (!employerDocumentId) {
      throw new ValidationError('Employer record could not be created.');
    }

    if (!employerContact) {
      employerContact = await documents(strapi, 'api::employer-contact.employer-contact').create({
        data: {
          authProvider: 'auth0',
          contactState: 'invited',
          email: body.contactEmail,
          employer: {
            connect: [{ documentId: employerDocumentId }],
          },
          firstName: body.firstName || null,
          invitedAt: now,
          lastName: body.lastName || null,
          roleTitle: body.roleTitle || null,
        },
        populate: ['employer'],
      });
    } else {
      const existingEmployerContactDocumentId = getDocumentId(employerContact);

      if (!existingEmployerContactDocumentId) {
        throw new ValidationError('Employer contact record could not be updated.');
      }

      employerContact = await documents(strapi, 'api::employer-contact.employer-contact').update({
        documentId: existingEmployerContactDocumentId,
        data: {
          contactState: employerContact.contactState === 'active' ? 'active' : 'invited',
          employer: {
            connect: [{ documentId: employerDocumentId }],
          },
          firstName: body.firstName || employerContact.firstName || null,
          invitedAt: employerContact.invitedAt || now,
          lastName: body.lastName || employerContact.lastName || null,
          roleTitle: body.roleTitle || employerContact.roleTitle || null,
        },
        populate: ['employer'],
      });
    }

    const employerContactDocumentId = getDocumentId(employerContact);

    if (!employerContactDocumentId) {
      throw new ValidationError('Employer contact record could not be created.');
    }

    await revokePendingInvitesForContact(strapi, employerContactDocumentId);

    const rawToken = generateInviteToken();
    const invite = await documents(strapi, 'api::employer-invite.employer-invite').create({
      data: {
        createdByStaffDisplayName: session.user.displayName,
        createdByStaffEmail: session.user.email,
        createdByStaffUserId: session.user.id,
        employer: {
          connect: [{ documentId: employerDocumentId }],
        },
        employerContact: {
          connect: [{ documentId: employerContactDocumentId }],
        },
        expiresAt: addDays(body.expiresInDays),
        inviteEmail: body.contactEmail,
        inviteState: 'pending',
        lastSentAt: now,
        metadata: {
          requestId: requestContext.requestId,
          source: 'admin_dashboard',
        },
        tokenHash: tokenHash(rawToken),
      },
      populate: ['employer', 'employerContact'],
    });

    return {
      created: true,
      invite: publicInvite(invite, rawToken),
      user: session.user,
    };
  },

  async resendInvite(input: unknown, requestContext: RequestContext = {}) {
    const body = validateInviteAction(input);
    const session = await assertEmployerManageSession(strapi, body.sessionToken, requestContext);
    const invite = await expireIfNeeded(
      strapi,
      await findInviteByDocumentId(strapi, body.employerInviteDocumentId)
    );

    if (!invite) {
      throw new ValidationError('Employer invite could not be found.');
    }

    const inviteDocumentId = getDocumentId(invite);

    if (!inviteDocumentId) {
      throw new ValidationError('Employer invite could not be updated.');
    }

    if (!['pending', 'expired'].includes(String(invite.inviteState))) {
      throw new ValidationError('Only pending or expired employer invites can be resent.');
    }

    const rawToken = generateInviteToken();
    const updatedInvite = await documents(strapi, 'api::employer-invite.employer-invite').update({
      documentId: inviteDocumentId,
      data: {
        expiresAt: addDays(14),
        inviteState: 'pending',
        lastSentAt: new Date().toISOString(),
        metadata: {
          ...(invite.metadata && typeof invite.metadata === 'object' ? invite.metadata : {}),
          resentByStaffDisplayName: session.user.displayName,
          resentByStaffEmail: session.user.email,
          resentByStaffUserId: session.user.id,
          resentRequestId: requestContext.requestId,
        },
        tokenHash: tokenHash(rawToken),
      },
      populate: ['employer', 'employerContact'],
    });

    return {
      invite: publicInvite(updatedInvite, rawToken),
      resent: true,
      user: session.user,
    };
  },

  async revokeInvite(input: unknown, requestContext: RequestContext = {}) {
    const body = validateInviteAction(input);
    const session = await assertEmployerManageSession(strapi, body.sessionToken, requestContext);
    const invite = await findInviteByDocumentId(strapi, body.employerInviteDocumentId);

    if (!invite) {
      throw new ValidationError('Employer invite could not be found.');
    }

    const inviteDocumentId = getDocumentId(invite);

    if (!inviteDocumentId) {
      throw new ValidationError('Employer invite could not be updated.');
    }

    if (invite.inviteState !== 'pending') {
      throw new ValidationError('Only pending employer invites can be revoked.');
    }

    const updatedInvite = await documents(strapi, 'api::employer-invite.employer-invite').update({
      documentId: inviteDocumentId,
      data: {
        inviteState: 'revoked',
        metadata: {
          ...(invite.metadata && typeof invite.metadata === 'object' ? invite.metadata : {}),
          revokedByStaffDisplayName: session.user.displayName,
          revokedByStaffEmail: session.user.email,
          revokedByStaffUserId: session.user.id,
          revokedRequestId: requestContext.requestId,
        },
        revokedAt: new Date().toISOString(),
      },
      populate: ['employer', 'employerContact'],
    });

    return {
      invite: publicInvite(updatedInvite),
      revoked: true,
      user: session.user,
    };
  },
});

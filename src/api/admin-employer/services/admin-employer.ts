import { createHash, randomBytes } from 'node:crypto';
import { errors, validateZodSchema, z } from '@strapi/utils';
import { getAuth0ManagementClient } from '../../../utils/auth0-management';

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
  authPasswordTicketCreatedAt?: string;
  authPasswordTicketExpiresAt?: string;
  authPasswordTicketUrl?: string;
  authProvisionedAt?: string;
  assignmentMode?: string;
  capacityChangeRequestStatus?: string;
  companyName?: string;
  contacts?: DocumentRecord[];
  contactState?: string;
  createdAt?: string;
  createdByStaffDisplayName?: string;
  createdByStaffEmail?: string;
  deliveryFailureMessage?: string;
  deliveryState?: string;
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
  notificationServiceJobId?: string;
  phone?: string;
  region?: string;
  roleTitle?: string;
  slug?: string;
  sortOrder?: number;
  state?: string;
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

type NotificationServiceQueueResponse = {
  data?: {
    jobId?: string | number;
    queued?: boolean;
    type?: string;
  };
};

const sessionTokenSchema = z
  .object({
    sessionToken: z.string().trim().min(32).max(512),
  })
  .strict();

const cadenceSchema = z.enum(['not_set', 'quarterly', 'biannually', 'annually']);
const employerCommitmentFilterSchema = z.enum(['all', 'committed', 'not_set']);
const employerSortDirectionSchema = z.enum(['asc', 'desc']);
const employerSortKeySchema = z.enum([
  'commitment',
  'companyName',
  'employerState',
  'inviteCount',
  'leadContact',
  'region',
  'updatedAt',
]);
const employerStateSchema = z.enum(['active', 'archived', 'invited', 'paused', 'prospect']);

const listEmployersSchema = sessionTokenSchema
  .extend({
    commitment: employerCommitmentFilterSchema.default('all'),
    region: z.string().trim().max(120).optional().transform((value) => value || undefined),
    search: z.string().trim().max(120).optional().transform((value) => value || undefined),
    sortBy: employerSortKeySchema.default('companyName'),
    sortDirection: employerSortDirectionSchema.default('asc'),
    state: employerStateSchema.or(z.literal('all')).default('all'),
  })
  .strict();

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

const employerDetailSchema = sessionTokenSchema
  .extend({
    employerDocumentId: z.string().trim().min(1).max(80),
  })
  .strict();

const employerActionSchema = sessionTokenSchema
  .extend({
    employerDocumentId: z.string().trim().min(1).max(80),
  })
  .strict();

const validateSessionToken = validateZodSchema(sessionTokenSchema);
const validateListEmployers = validateZodSchema(listEmployersSchema);
const validateCreateInvite = validateZodSchema(createInviteSchema);
const validateEmployerDetail = validateZodSchema(employerDetailSchema);
const validateEmployerAction = validateZodSchema(employerActionSchema);
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

const assertSuperAdminSession = async (
  strapi: StrapiDocumentService,
  sessionToken: string,
  context: RequestContext
) => {
  const session = await adminAuthService(strapi).getSession({ sessionToken }, context);

  if (!hasAnyRole(session, ['super_admin'])) {
    throw new ForbiddenError('Super Admin access is required.');
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

const inviteSetupUrl = (token: string) =>
  `${employerDashboardBaseUrl()}/invite/${encodeURIComponent(token)}/setup`;

const getIntegerEnv = (key: string, fallback: number) => {
  const value = Number.parseInt(process.env[key] || '', 10);

  return Number.isFinite(value) && value > 0 ? value : fallback;
};

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

const employerCommitmentLabel = (employer?: DocumentRecord | null) => {
  const volume = employer?.interviewCommitmentVolume;
  const cadence = employer?.interviewCommitmentCadence;

  if (typeof volume !== 'number' || volume <= 0) {
    return null;
  }

  return `${volume} interview${volume === 1 ? '' : 's'} per ${humanize(String(cadence || 'cadence')).toLowerCase()}`;
};

const publicEmployerContact = (contact: DocumentRecord) => ({
  accountCreatedAt: contact.accountCreatedAt || null,
  contactState: contact.contactState || 'invited',
  contactStateLabel: humanize(String(contact.contactState || 'invited')),
  documentId: getDocumentId(contact) || String(contact.id || ''),
  email: contact.email || null,
  firstName: contact.firstName || null,
  invitedAt: contact.invitedAt || null,
  lastName: contact.lastName || null,
  name: contactName(contact),
  phone: contact.phone || null,
  roleTitle: contact.roleTitle || null,
});

const primaryContact = (employer: DocumentRecord) => {
  const contacts = Array.isArray(employer.contacts) ? employer.contacts : [];

  return contacts.find((contact) => contact.contactState === 'active') || contacts[0] || null;
};

const publicEmployer = (employer: DocumentRecord, invites: DocumentRecord[] = []) => {
  const contacts = Array.isArray(employer.contacts) ? employer.contacts : [];
  const leadContact = primaryContact(employer);
  const pendingInvites = invites.filter((invite) => invite.inviteState === 'pending').length;

  return {
    activeContactsCount: contacts.filter((contact) => contact.contactState === 'active').length,
    assignmentMode: employer.assignmentMode || 'automatic',
    assignmentModeLabel: humanize(String(employer.assignmentMode || 'automatic')),
    capacityChangeRequestStatus: employer.capacityChangeRequestStatus || 'none',
    commitmentLabel: employerCommitmentLabel(employer),
    companyName: employer.companyName || 'Employer',
    contactsCount: contacts.length,
    createdAt: employer.createdAt || null,
    documentId: getDocumentId(employer) || String(employer.id || ''),
    employerState: employer.employerState || 'prospect',
    employerStateLabel: humanize(String(employer.employerState || 'prospect')),
    inviteCount: invites.length,
    leadContact: leadContact ? publicEmployerContact(leadContact) : null,
    pendingInvitesCount: pendingInvites,
    region: employer.region || null,
    updatedAt: employer.updatedAt || null,
  };
};

type PublicEmployerSummary = ReturnType<typeof publicEmployer>;

const employerMatchesSearch = (employer: PublicEmployerSummary, search?: string) => {
  if (!search) {
    return true;
  }

  const value = search.toLowerCase();

  return [
    employer.assignmentModeLabel,
    employer.commitmentLabel,
    employer.companyName,
    employer.employerStateLabel,
    employer.leadContact?.email,
    employer.leadContact?.name,
    employer.leadContact?.phone,
    employer.leadContact?.roleTitle,
    employer.region,
  ].some((item) => String(item || '').toLowerCase().includes(value));
};

const employerMatchesCommitment = (
  employer: PublicEmployerSummary,
  commitment: z.infer<typeof employerCommitmentFilterSchema>
) => {
  if (commitment === 'committed') {
    return Boolean(employer.commitmentLabel);
  }

  if (commitment === 'not_set') {
    return !employer.commitmentLabel;
  }

  return true;
};

const employerSortValue = (
  employer: PublicEmployerSummary,
  sortBy: z.infer<typeof employerSortKeySchema>
) => {
  if (sortBy === 'inviteCount') {
    return employer.inviteCount;
  }

  if (sortBy === 'updatedAt') {
    return employer.updatedAt ? Date.parse(employer.updatedAt) : 0;
  }

  if (sortBy === 'leadContact') {
    return String(employer.leadContact?.name || employer.leadContact?.email || '').toLowerCase();
  }

  if (sortBy === 'employerState') {
    return String(employer.employerStateLabel || employer.employerState).toLowerCase();
  }

  if (sortBy === 'commitment') {
    return String(employer.commitmentLabel || '').toLowerCase();
  }

  return String(employer[sortBy] || '').toLowerCase();
};

const compareEmployers = (
  sortBy: z.infer<typeof employerSortKeySchema>,
  sortDirection: z.infer<typeof employerSortDirectionSchema>
) => (left: PublicEmployerSummary, right: PublicEmployerSummary) => {
  const leftValue = employerSortValue(left, sortBy);
  const rightValue = employerSortValue(right, sortBy);
  let result = 0;

  if (typeof leftValue === 'number' && typeof rightValue === 'number') {
    result = leftValue - rightValue;
  } else {
    result = String(leftValue).localeCompare(String(rightValue), 'en-GB', {
      numeric: true,
      sensitivity: 'base',
    });
  }

  if (result === 0 && sortBy !== 'companyName') {
    result = String(left.companyName).localeCompare(String(right.companyName), 'en-GB', {
      numeric: true,
      sensitivity: 'base',
    });
  }

  return sortDirection === 'asc' ? result : -result;
};

const publicClassAreaOption = (classArea: DocumentRecord) => ({
  documentId: getDocumentId(classArea) || String(classArea.id || ''),
  label: classArea.name || 'Region',
  name: classArea.name || null,
  slug: classArea.slug || null,
  state: classArea.state || 'active',
});

const getOperationalClassAreas = async (strapi: StrapiDocumentService) => {
  const classAreas = await documents(strapi, 'api::class-area.class-area').findMany({
    limit: 500,
    sort: ['sortOrder:asc', 'name:asc'],
  });

  return classAreas.filter((classArea) => ['active', 'coming_soon'].includes(String(classArea.state)));
};

const assertOperationalRegion = async (strapi: StrapiDocumentService, region?: string) => {
  if (!region) {
    return undefined;
  }

  const classAreas = await getOperationalClassAreas(strapi);
  const matchedArea = classAreas.find(
    (classArea) => String(classArea.name || '').toLowerCase() === region.toLowerCase()
  );

  if (!matchedArea?.name) {
    throw new ValidationError('Region must match a current HireFlip operating area.');
  }

  return matchedArea.name;
};

const displayNameForContact = (contact: DocumentRecord) =>
  compact([contact.firstName, contact.lastName]).join(' ') || contact.email || undefined;

const publicInvite = (invite: DocumentRecord, rawToken?: string) => ({
  acceptedAt: invite.acceptedAt || null,
  acceptedByEmail: invite.acceptedByEmail || null,
  companyName: invite.employer?.companyName || 'Employer',
  contactEmail: invite.inviteEmail || invite.employerContact?.email || null,
  contactName: contactName(invite.employerContact),
  createdAt: invite.createdAt || null,
  createdBy: invite.createdByStaffDisplayName || invite.createdByStaffEmail || null,
  deliveryFailureMessage: invite.deliveryFailureMessage || null,
  deliveryState: invite.deliveryState || 'not_required',
  deliveryStateLabel: humanize(String(invite.deliveryState || 'not_required')),
  documentId: getDocumentId(invite) || String(invite.id || ''),
  employerDocumentId: getDocumentId(invite.employer),
  expiresAt: invite.expiresAt || null,
  inviteState: invite.inviteState || 'pending',
  inviteStateLabel: humanize(String(invite.inviteState || 'pending')),
  inviteUrl: rawToken ? inviteUrl(rawToken) : null,
  lastSentAt: invite.lastSentAt || null,
  notificationServiceJobId: invite.notificationServiceJobId || null,
  region: invite.employer?.region || null,
  roleTitle: invite.employerContact?.roleTitle || null,
  updatedAt: invite.updatedAt || null,
});

const createEmployerPasswordTicket = async (contact: DocumentRecord, rawToken: string) => {
  const email = contact.email;

  if (!email) {
    throw new ValidationError('Employer contact is missing an email address.');
  }

  const auth0 = getAuth0ManagementClient();
  const authUser = await auth0.ensureEmployerUser({
    email,
    firstName: contact.firstName || null,
    lastName: contact.lastName || null,
    name: displayNameForContact(contact) || null,
  });
  const ticket = await auth0.createPasswordSetupTicket({
    inviteUrl: inviteUrl(rawToken),
    userId: authUser.userId,
  });

  return {
    authUserCreated: authUser.created,
    expiresAt: ticket.expiresAt,
    ticketUrl: ticket.ticketUrl,
    userId: authUser.userId,
  };
};

const requestNotificationServiceEmail = async ({
  correlationId,
  template,
  to,
  type,
}: {
  correlationId?: string;
  template: {
    key: string;
    variables?: Record<string, unknown>;
  };
  to: string;
  type: string;
}): Promise<NotificationServiceQueueResponse> => {
  const baseUrl = process.env.NOTIFICATION_SERVICE_URL;
  const serviceToken = process.env.NOTIFICATION_SERVICE_TOKEN;

  if (!baseUrl || !serviceToken) {
    throw new Error('Notification service is not configured.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    getIntegerEnv('NOTIFICATION_SERVICE_TIMEOUT_MS', 5000)
  );

  try {
    const response = await fetch(`${trimTrailingSlash(baseUrl)}/api/internal/notifications/email`, {
      body: JSON.stringify({
        correlationId,
        priority: 'transactional',
        source: 'core-api',
        template,
        to,
        type,
      }),
      headers: {
        'content-type': 'application/json',
        'x-hireflip-service-name': 'core-api',
        'x-hireflip-service-token': serviceToken,
      },
      method: 'POST',
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => null)) as NotificationServiceQueueResponse | null;

    if (!response.ok || !payload?.data) {
      throw new Error('Employer invite notification could not be queued.');
    }

    return payload;
  } finally {
    clearTimeout(timeout);
  }
};

const createNotificationEvent = async (
  strapi: StrapiDocumentService,
  {
    deliveryState,
    errorMessage,
    eventType,
    invite,
    jobId,
  }: {
    deliveryState: 'queued' | 'failed';
    errorMessage?: string;
    eventType: string;
    invite: DocumentRecord;
    jobId?: string | number;
  }
) => {
  const employerDocumentId = getDocumentId(invite.employer);
  const inviteDocumentId = getDocumentId(invite);
  const contactDocumentId = getDocumentId(invite.employerContact);
  const now = new Date().toISOString();

  return documents(strapi, 'api::notification-event.notification-event').create({
    data: {
      channel: 'email',
      deliveryState,
      ...(deliveryState === 'failed' ? { failedAt: now } : {}),
      errorMessage: errorMessage || null,
      eventType,
      ...(employerDocumentId
        ? {
            employer: {
              connect: [{ documentId: employerDocumentId }],
            },
          }
        : {}),
      metadata: {
        notificationServiceJobId: typeof jobId === 'undefined' ? null : String(jobId),
      },
      priority: deliveryState === 'failed' ? 'high' : 'normal',
      recipientEmail: invite.inviteEmail || invite.employerContact?.email || null,
      recipientId: contactDocumentId || undefined,
      recipientType: 'employer_contact',
      relatedId: inviteDocumentId || undefined,
      relatedType: 'employer_invite',
      templateKey: 'employer_invite',
    },
  });
};

const queueEmployerInviteEmail = async (
  strapi: StrapiDocumentService,
  {
    eventType,
    invite,
    rawToken,
  }: {
    eventType: 'employer_invite_created' | 'employer_invite_resent';
    invite: DocumentRecord;
    rawToken: string;
  }
) => {
  const inviteDocumentId = getDocumentId(invite);
  const contact = invite.employerContact || {};
  const email = String(invite.inviteEmail || contact.email || '').trim().toLowerCase();
  const now = new Date().toISOString();

  if (!inviteDocumentId) {
    throw new ValidationError('Employer invite could not be updated.');
  }

  if (!email) {
    throw new ValidationError('Employer invite is missing an email address.');
  }

  try {
    const response = await requestNotificationServiceEmail({
      correlationId: `employer-invite:${inviteDocumentId}:${Date.now()}`,
      template: {
        key: 'employer_invite',
        variables: {
          companyName: invite.employer?.companyName || 'your company',
          contactFirstName: contact.firstName || undefined,
          expiresAt: invite.expiresAt || undefined,
          inviteUrl: inviteSetupUrl(rawToken),
          reviewInviteUrl: inviteUrl(rawToken),
        },
      },
      to: email,
      type: eventType,
    });
    const jobId = response.data?.jobId;

    await createNotificationEvent(strapi, {
      deliveryState: 'queued',
      eventType,
      invite,
      jobId,
    });

    return documents(strapi, 'api::employer-invite.employer-invite').update({
      documentId: inviteDocumentId,
      data: {
        deliveryFailureMessage: null,
        deliveryState: 'queued',
        lastSentAt: now,
        notificationServiceJobId: typeof jobId === 'undefined' ? null : String(jobId),
      },
      populate: ['employer', 'employerContact'],
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Employer invite notification could not be queued.';

    await createNotificationEvent(strapi, {
      deliveryState: 'failed',
      errorMessage,
      eventType,
      invite,
    });

    return documents(strapi, 'api::employer-invite.employer-invite').update({
      documentId: inviteDocumentId,
      data: {
        deliveryFailureMessage: errorMessage,
        deliveryState: 'failed',
        lastSentAt: null,
        notificationServiceJobId: null,
      },
      populate: ['employer', 'employerContact'],
    });
  }
};

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

const revokePendingInvitesForEmployer = async (
  strapi: StrapiDocumentService,
  employerDocumentId: string,
  session: AdminSession,
  requestContext: RequestContext
) => {
  const invites = await documents(strapi, 'api::employer-invite.employer-invite').findMany({
    filters: {
      employer: {
        documentId: employerDocumentId,
      },
      inviteState: 'pending',
    },
    limit: 200,
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
          metadata: {
            ...(invite.metadata && typeof invite.metadata === 'object' ? invite.metadata : {}),
            revokedByArchive: true,
            revokedByStaffDisplayName: session.user.displayName,
            revokedByStaffEmail: session.user.email,
            revokedByStaffUserId: session.user.id,
            revokedRequestId: requestContext.requestId,
          },
          revokedAt: new Date().toISOString(),
        },
      });
    })
  );
};

export default ({ strapi }) => ({
  async listEmployers(input: unknown, requestContext: RequestContext = {}) {
    const body = validateListEmployers(input);
    const session = await assertEmployerManageSession(strapi, body.sessionToken, requestContext);
    const [employers, invites] = await Promise.all([
      documents(strapi, 'api::employer.employer').findMany({
        limit: 1000,
        populate: ['contacts'],
        sort: ['companyName:asc'],
      }),
      documents(strapi, 'api::employer-invite.employer-invite').findMany({
        limit: 1000,
        populate: ['employer', 'employerContact'],
        sort: ['createdAt:desc'],
      }),
    ]);
    const invitesByEmployer = new Map<string, DocumentRecord[]>();

    for (const invite of invites) {
      const employerDocumentId = getDocumentId(invite.employer);

      if (!employerDocumentId) {
        continue;
      }

      invitesByEmployer.set(employerDocumentId, [
        ...(invitesByEmployer.get(employerDocumentId) || []),
        invite,
      ]);
    }
    const employerSummaries = employers.map((employer) =>
      publicEmployer(employer, invitesByEmployer.get(getDocumentId(employer) || '') || [])
    );
    const stateFilteredEmployers = employerSummaries.filter((employer) =>
      body.state === 'all'
        ? employer.employerState !== 'archived'
        : employer.employerState === body.state
    );
    const filteredEmployers = stateFilteredEmployers
      .filter((employer) => !body.region || employer.region === body.region)
      .filter((employer) => employerMatchesCommitment(employer, body.commitment))
      .filter((employer) => employerMatchesSearch(employer, body.search))
      .sort(compareEmployers(body.sortBy, body.sortDirection));

    return {
      employers: filteredEmployers,
      filteredEmployers: filteredEmployers.length,
      generatedAt: new Date().toISOString(),
      totalEmployers: stateFilteredEmployers.length,
      user: session.user,
    };
  },

  async getEmployerDetail(input: unknown, requestContext: RequestContext = {}) {
    const body = validateEmployerDetail(input);
    const session = await assertEmployerManageSession(strapi, body.sessionToken, requestContext);
    const employers = await documents(strapi, 'api::employer.employer').findMany({
      filters: {
        documentId: body.employerDocumentId,
      },
      limit: 1,
      populate: ['contacts'],
    });
    const employer = employers[0];

    if (!employer) {
      throw new ValidationError('Employer could not be found.');
    }

    const invites = await documents(strapi, 'api::employer-invite.employer-invite').findMany({
      filters: {
        employer: {
          documentId: body.employerDocumentId,
        },
      },
      limit: 200,
      populate: ['employer', 'employerContact'],
      sort: ['createdAt:desc'],
    });

    return {
      contacts: (Array.isArray(employer.contacts) ? employer.contacts : []).map(publicEmployerContact),
      employer: publicEmployer(employer, invites),
      generatedAt: new Date().toISOString(),
      invites: invites.map((invite) => publicInvite(invite)),
      totalContacts: Array.isArray(employer.contacts) ? employer.contacts.length : 0,
      totalInvites: invites.length,
      user: session.user,
    };
  },

  async getInviteOptions(input: unknown, requestContext: RequestContext = {}) {
    const body = validateSessionToken(input);
    const session = await assertEmployerManageSession(strapi, body.sessionToken, requestContext);
    const classAreas = await getOperationalClassAreas(strapi);

    return {
      generatedAt: new Date().toISOString(),
      regions: classAreas.map(publicClassAreaOption),
      user: session.user,
    };
  },

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
    const publicInvites = compact(normalizedInvites)
      .filter((invite) => invite.inviteState !== 'revoked')
      .map((invite) => publicInvite(invite));

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
    const region = await assertOperationalRegion(strapi, body.region);
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
          region: region || null,
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
          region: region || null,
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
    const authProvision = await createEmployerPasswordTicket(employerContact, rawToken);
    const authProvisionedAt = new Date().toISOString();

    employerContact = await documents(strapi, 'api::employer-contact.employer-contact').update({
      documentId: employerContactDocumentId,
      data: {
        authIdentityId: authProvision.userId,
        authProvider: 'auth0',
      },
      populate: ['employer'],
    });

    const invite = await documents(strapi, 'api::employer-invite.employer-invite').create({
      data: {
        authIdentityId: authProvision.userId,
        authPasswordTicketCreatedAt: authProvisionedAt,
        authPasswordTicketExpiresAt: authProvision.expiresAt,
        authPasswordTicketUrl: authProvision.ticketUrl,
        authProvisionedAt,
        createdByStaffDisplayName: session.user.displayName,
        createdByStaffEmail: session.user.email,
        createdByStaffUserId: session.user.id,
        deliveryState: 'not_required',
        employer: {
          connect: [{ documentId: employerDocumentId }],
        },
        employerContact: {
          connect: [{ documentId: employerContactDocumentId }],
        },
        expiresAt: addDays(body.expiresInDays),
        inviteEmail: body.contactEmail,
        inviteState: 'pending',
        metadata: {
          authUserCreated: authProvision.authUserCreated,
          requestId: requestContext.requestId,
          source: 'admin_dashboard',
        },
        tokenHash: tokenHash(rawToken),
      },
      populate: ['employer', 'employerContact'],
    });
    const deliveredInvite = await queueEmployerInviteEmail(strapi, {
      eventType: 'employer_invite_created',
      invite,
      rawToken,
    });

    return {
      created: true,
      invite: publicInvite(deliveredInvite, rawToken),
      inviteSent: deliveredInvite.deliveryState === 'queued',
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
    const authProvision = await createEmployerPasswordTicket(invite.employerContact || {}, rawToken);
    const authProvisionedAt = new Date().toISOString();
    const employerContactDocumentId = getDocumentId(invite.employerContact);

    if (employerContactDocumentId) {
      await documents(strapi, 'api::employer-contact.employer-contact').update({
        documentId: employerContactDocumentId,
        data: {
          authIdentityId: authProvision.userId,
          authProvider: 'auth0',
        },
      });
    }

    const updatedInvite = await documents(strapi, 'api::employer-invite.employer-invite').update({
      documentId: inviteDocumentId,
      data: {
        authIdentityId: authProvision.userId,
        authPasswordTicketCreatedAt: authProvisionedAt,
        authPasswordTicketExpiresAt: authProvision.expiresAt,
        authPasswordTicketUrl: authProvision.ticketUrl,
        authProvisionedAt,
        deliveryFailureMessage: null,
        deliveryState: 'not_required',
        expiresAt: addDays(14),
        inviteState: 'pending',
        lastSentAt: null,
        metadata: {
          ...(invite.metadata && typeof invite.metadata === 'object' ? invite.metadata : {}),
          authUserCreated: authProvision.authUserCreated,
          resentByStaffDisplayName: session.user.displayName,
          resentByStaffEmail: session.user.email,
          resentByStaffUserId: session.user.id,
          resentRequestId: requestContext.requestId,
        },
        tokenHash: tokenHash(rawToken),
      },
      populate: ['employer', 'employerContact'],
    });
    const deliveredInvite = await queueEmployerInviteEmail(strapi, {
      eventType: 'employer_invite_resent',
      invite: updatedInvite,
      rawToken,
    });

    return {
      invite: publicInvite(deliveredInvite, rawToken),
      inviteSent: deliveredInvite.deliveryState === 'queued',
      resent: true,
      user: session.user,
    };
  },

  async generateInviteLink(input: unknown, requestContext: RequestContext = {}) {
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
      throw new ValidationError('Only pending or expired employer invites can have a new link generated.');
    }

    const rawToken = generateInviteToken();
    const authProvision = await createEmployerPasswordTicket(invite.employerContact || {}, rawToken);
    const authProvisionedAt = new Date().toISOString();
    const employerContactDocumentId = getDocumentId(invite.employerContact);

    if (employerContactDocumentId) {
      await documents(strapi, 'api::employer-contact.employer-contact').update({
        documentId: employerContactDocumentId,
        data: {
          authIdentityId: authProvision.userId,
          authProvider: 'auth0',
        },
      });
    }

    const updatedInvite = await documents(strapi, 'api::employer-invite.employer-invite').update({
      documentId: inviteDocumentId,
      data: {
        authIdentityId: authProvision.userId,
        authPasswordTicketCreatedAt: authProvisionedAt,
        authPasswordTicketExpiresAt: authProvision.expiresAt,
        authPasswordTicketUrl: authProvision.ticketUrl,
        authProvisionedAt,
        expiresAt: addDays(14),
        inviteState: 'pending',
        metadata: {
          ...(invite.metadata && typeof invite.metadata === 'object' ? invite.metadata : {}),
          authUserCreated: authProvision.authUserCreated,
          linkGeneratedByStaffDisplayName: session.user.displayName,
          linkGeneratedByStaffEmail: session.user.email,
          linkGeneratedByStaffUserId: session.user.id,
          linkGeneratedRequestId: requestContext.requestId,
        },
        tokenHash: tokenHash(rawToken),
      },
      populate: ['employer', 'employerContact'],
    });

    return {
      generated: true,
      invite: publicInvite(updatedInvite, rawToken),
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

    const authIdentityId = invite.authIdentityId || invite.employerContact?.authIdentityId;
    const employerContactDocumentId = getDocumentId(invite.employerContact);

    if (authIdentityId) {
      await getAuth0ManagementClient().blockUser(authIdentityId);
    }

    if (employerContactDocumentId && invite.employerContact?.contactState !== 'active') {
      await documents(strapi, 'api::employer-contact.employer-contact').update({
        documentId: employerContactDocumentId,
        data: {
          contactState: 'disabled',
        },
      });
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

  async archiveEmployer(input: unknown, requestContext: RequestContext = {}) {
    const body = validateEmployerAction(input);
    const session = await assertSuperAdminSession(strapi, body.sessionToken, requestContext);
    const employers = await documents(strapi, 'api::employer.employer').findMany({
      filters: {
        documentId: body.employerDocumentId,
      },
      limit: 1,
      populate: ['contacts'],
    });
    const employer = employers[0];

    if (!employer) {
      throw new ValidationError('Employer could not be found.');
    }

    const employerDocumentId = getDocumentId(employer);

    if (!employerDocumentId) {
      throw new ValidationError('Employer could not be updated.');
    }

    if (employer.employerState === 'archived') {
      return {
        archived: true,
        employer: publicEmployer(employer),
        user: session.user,
      };
    }

    const contacts = Array.isArray(employer.contacts) ? employer.contacts : [];
    const authIdentityIds = Array.from(
      new Set(
        contacts
          .map((contact) => (typeof contact.authIdentityId === 'string' ? contact.authIdentityId : ''))
          .filter(Boolean)
      )
    );

    await Promise.all(
      authIdentityIds.map((authIdentityId) => getAuth0ManagementClient().blockUser(authIdentityId))
    );

    await Promise.all(
      contacts.map((contact) => {
        const employerContactDocumentId = getDocumentId(contact);

        if (!employerContactDocumentId) {
          return Promise.resolve(contact);
        }

        return documents(strapi, 'api::employer-contact.employer-contact').update({
          documentId: employerContactDocumentId,
          data: {
            contactState: 'archived',
          },
        });
      })
    );

    await revokePendingInvitesForEmployer(strapi, employerDocumentId, session, requestContext);

    const archivedEmployer = await documents(strapi, 'api::employer.employer').update({
      documentId: employerDocumentId,
      data: {
        employerState: 'archived',
      },
      populate: ['contacts'],
    });

    return {
      archived: true,
      employer: publicEmployer(archivedEmployer),
      user: session.user,
    };
  },
});

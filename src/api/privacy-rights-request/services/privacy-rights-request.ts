import { createHash, randomBytes, randomInt } from 'node:crypto';
import PDFDocument from 'pdfkit';
import { errors, validateZodSchema, z } from '@strapi/utils';
import { getAuth0ManagementClient } from '../../../utils/auth0-management';
import { publishAdminRealtimeEvent } from '../../../utils/admin-realtime-events';

const { ForbiddenError, ValidationError } = errors;

type RequestContext = {
  ipAddress?: string;
  requestId?: string;
  serviceName?: string;
  userAgent?: string;
};

type Auth0State = {
  email?: string;
  subject?: string;
  type?: string;
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
  record(input: unknown): Promise<unknown>;
};

type DocumentRecord = Record<string, unknown> & {
  accountRestrictionStatus?: string;
  authIdentityId?: string;
  candidate?: DocumentRecord;
  candidateState?: string;
  companyName?: string;
  contactRole?: string;
  contactState?: string;
  createdAt?: string;
  documentId?: string;
  dueAt?: string;
  email?: string;
  employer?: DocumentRecord;
  employerContact?: DocumentRecord;
  enrollmentState?: string;
  firstName?: string;
  id?: number | string;
  identityVerificationStatus?: string;
  interviewState?: string;
  lastName?: string;
  metadata?: unknown;
  phone?: string;
  receivedAt?: string;
  refundState?: string;
  requestState?: string;
  requestType?: string;
  requestingUserId?: string;
  requestingUserType?: string;
  reservationState?: string;
  subjectUserId?: string;
  subjectUserType?: string;
  updatedAt?: string;
};

type DocumentCollection = {
  create(input: Record<string, unknown>): Promise<DocumentRecord>;
  findMany(input: Record<string, unknown>): Promise<DocumentRecord[]>;
  update(input: Record<string, unknown>): Promise<DocumentRecord>;
};

type StrapiService = {
  documents(uid: string): unknown;
  log?: {
    error?: (message: string, error?: unknown) => void;
    warn?: (message: string, error?: unknown) => void;
  };
  service(uid: string): unknown;
};

type NotificationServiceQueueResponse = {
  data?: {
    jobId?: unknown;
    queued?: unknown;
    type?: unknown;
  };
};

type NotificationTemplatePayload = {
  key: string;
  variables?: Record<string, unknown>;
};

const requestTypeValues = [
  'access',
  'correction',
  'deletion',
  'erasure',
  'portability',
  'objection',
  'restriction',
  'other',
] as const;
const requestStateValues = [
  'received',
  'identity_verification_required',
  'in_review',
  'clarification_requested',
  'processing',
  'completed',
  'partially_fulfilled',
  'rejected',
  'cancelled',
] as const;
const exportScopeValues = ['personal', 'company', 'both'] as const;

const candidateCreateSchema = z
  .object({
    message: z.string().trim().max(4000).optional(),
    requestType: z.enum(requestTypeValues),
  })
  .strict();
const employerIdentitySchema = z
  .object({
    authIdentityId: z.string().trim().min(1).max(160).optional(),
    email: z.string().trim().email().max(254).optional(),
  })
  .refine((value) => Boolean(value.authIdentityId || value.email), {
    message: 'Employer identity is required.',
  });
const employerCreateSchema = employerIdentitySchema
  .extend({
    exportScope: z.enum(exportScopeValues).default('personal'),
    message: z.string().trim().max(4000).optional(),
    requestType: z.enum(requestTypeValues),
  })
  .strict();
const employerRequestSchema = employerIdentitySchema
  .extend({
    code: z.string().trim().regex(/^\d{6}$/).optional(),
    requestDocumentId: z.string().trim().min(1).max(160),
  })
  .strict();
const downloadSchema = z
  .object({
    code: z.string().trim().regex(/^\d{6}$/),
  })
  .strict();
const adminListSchema = z
  .object({
    page: z.number().int().min(1).max(500).default(1),
    pageSize: z.number().int().min(1).max(100).default(25),
    requestState: z.enum(['all', ...requestStateValues]).default('all'),
    requestType: z.enum(['all', ...requestTypeValues]).default('all'),
    search: z.string().trim().max(180).optional().transform((value) => value || undefined),
    sessionToken: z.string().trim().min(32).max(512),
    subjectUserType: z.enum(['all', 'candidate', 'employer_contact']).default('all'),
  })
  .strict();
const adminRequestSchema = z
  .object({
    requestDocumentId: z.string().trim().min(1).max(160),
    sessionToken: z.string().trim().min(32).max(512),
  })
  .strict();
const adminActionSchema = adminRequestSchema
  .extend({
    internalNote: z.string().trim().max(4000).optional(),
    publicResponse: z.string().trim().max(4000).optional(),
    rejectionReason: z.string().trim().max(4000).optional(),
    requestState: z.enum(requestStateValues),
  })
  .strict();
const adminDownloadSchema = adminRequestSchema
  .extend({
    code: z.string().trim().regex(/^\d{6}$/),
  })
  .strict();
const adminAnonymiseSchema = adminRequestSchema
  .extend({
    auditReason: z.string().trim().min(3).max(4000),
  })
  .strict();

const validateCandidateCreate = validateZodSchema(candidateCreateSchema);
const validateEmployerCreate = validateZodSchema(employerCreateSchema);
const validateEmployerRequest = validateZodSchema(employerRequestSchema);
const validateDownload = validateZodSchema(downloadSchema);
const validateAdminList = validateZodSchema(adminListSchema);
const validateAdminRequest = validateZodSchema(adminRequestSchema);
const validateAdminAction = validateZodSchema(adminActionSchema);
const validateAdminDownload = validateZodSchema(adminDownloadSchema);
const validateAdminAnonymise = validateZodSchema(adminAnonymiseSchema);

const documents = (strapi: StrapiService, uid: string) =>
  strapi.documents(uid) as DocumentCollection;

const adminAuthService = (strapi: StrapiService) =>
  strapi.service('api::admin-auth.admin-auth') as unknown as AdminAuthService;

const auditEvents = (strapi: StrapiService) =>
  strapi.service('api::audit-event.audit-event') as unknown as AuditEventService;

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

const objectValue = (value: unknown) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const stringValue = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

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

const relationConnect = (record?: DocumentRecord | null) =>
  getDocumentId(record) ? { connect: [{ documentId: getDocumentId(record) }] } : undefined;

const humanize = (value?: string | null) =>
  String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase()) || 'Not recorded';

const compact = <T>(items: Array<T | null | undefined>) =>
  items.filter((item): item is T => Boolean(item));

const addOneCalendarMonth = (date: Date) => {
  const next = new Date(date);
  next.setMonth(next.getMonth() + 1);
  return next;
};

const displayName = (record?: DocumentRecord | null) =>
  [record?.firstName, record?.lastName].filter(Boolean).join(' ').trim() ||
  stringValue(record?.companyName) ||
  stringValue(record?.email) ||
  'Not recorded';

const subjectSummary = (request: DocumentRecord) => {
  const subject =
    request.subjectUserType === 'employer_contact'
      ? request.employerContact
      : request.candidate;

  return {
    companyName: subject?.employer?.companyName || null,
    documentId: getDocumentId(subject) || null,
    email: subject?.email || null,
    name: displayName(subject),
    type: request.subjectUserType || 'unknown',
  };
};

const requestMetadata = (request: DocumentRecord) => objectValue(request.metadata);

const publicRequest = (request: DocumentRecord, includeInternal = false) => {
  const metadata = requestMetadata(request);
  const notes = Array.isArray(metadata.notes) ? metadata.notes : [];

  return {
    completedAt: request.completedAt || null,
    deletionJobStatus: request.deletionJobStatus || 'not_required',
    documentId: getDocumentId(request),
    downstreamProviderSyncStatus: request.downstreamProviderSyncStatus || 'not_required',
    dueAt: request.dueAt || null,
    exportScope: metadata.exportScope || 'personal',
    identityVerificationStatus: request.identityVerificationStatus || 'not_started',
    publicResponse: stringValue(metadata.publicResponse),
    receivedAt: request.receivedAt || request.createdAt || null,
    rejectionReason: request.rejectionReason || null,
    requestState: request.requestState || 'received',
    requestStateLabel: humanize(request.requestState),
    requestType: request.requestType || 'access',
    requestTypeLabel: humanize(request.requestType),
    requesterMessage: stringValue(metadata.requesterMessage),
    subject: subjectSummary(request),
    ...(includeInternal
      ? {
          internalNotes: notes,
          metadata,
          retentionReasons: request.retentionReasons || null,
        }
      : {}),
  };
};

const privacyRequestPopulate = {
  candidate: {
    populate: {
      profileImage: true,
    },
  },
  employerContact: {
    populate: {
      coverageRegions: true,
      employer: {
        populate: {
          contacts: {
            populate: ['coverageRegions', 'profileImage'],
          },
          operatingRegions: true,
          regionCommitments: {
            populate: ['region'],
          },
        },
      },
      profileImage: true,
    },
  },
  publicInterestLead: true,
};

const findRequestByDocumentId = async (strapi: StrapiService, requestDocumentId: string) => {
  const requests = await documents(strapi, 'api::privacy-rights-request.privacy-rights-request').findMany({
    filters: { documentId: requestDocumentId },
    limit: 1,
    populate: privacyRequestPopulate,
  });

  return requests[0] || null;
};

const findCandidateByAuthIdentity = async (strapi: StrapiService, authIdentityId: string) => {
  const candidates = await documents(strapi, 'api::candidate.candidate').findMany({
    filters: { authIdentityId },
    limit: 1,
    populate: {
      profileImage: true,
    },
  });

  return candidates[0] || null;
};

const employerContactFilters = (identity: { authIdentityId?: string; email?: string }) => {
  const filters = compact([
    identity.authIdentityId ? { authIdentityId: identity.authIdentityId } : null,
    identity.email ? { email: identity.email } : null,
  ]);

  return filters.length === 1 ? filters[0] : { $or: filters };
};

const findEmployerContact = async (
  strapi: StrapiService,
  identity: { authIdentityId?: string; email?: string }
) => {
  const contacts = await documents(strapi, 'api::employer-contact.employer-contact').findMany({
    filters: employerContactFilters(identity),
    limit: 1,
    populate: {
      coverageRegions: true,
      employer: {
        populate: {
          contacts: {
            populate: ['coverageRegions', 'profileImage'],
          },
          operatingRegions: true,
          regionCommitments: {
            populate: ['region'],
          },
        },
      },
      profileImage: true,
    },
  });
  const contact = contacts[0];

  if (!contact || !contact.employer) {
    throw new ValidationError('Employer contact could not be found.');
  }

  if (contact.contactState !== 'active') {
    throw new ValidationError('Employer contact is not active.');
  }

  if (
    identity.authIdentityId &&
    contact.authIdentityId &&
    contact.authIdentityId !== identity.authIdentityId
  ) {
    throw new ValidationError('Employer contact is linked to another Auth0 account.');
  }

  return contact;
};

const assertCandidateAuth = async (strapi: StrapiService, auth: unknown) => {
  const state = objectValue(auth) as Auth0State;

  if (state.type !== 'auth0' || !state.subject) {
    throw new ForbiddenError('Candidate sign-in is required.');
  }

  const candidate = await findCandidateByAuthIdentity(strapi, state.subject);

  if (!candidate) {
    throw new ValidationError('Candidate account could not be found.');
  }

  return candidate;
};

const assertSubjectOwnsRequest = (
  request: DocumentRecord,
  subject: DocumentRecord,
  subjectType: 'candidate' | 'employer_contact'
) => {
  const expectedId = getDocumentId(subject);
  const actualId = getDocumentId(subjectType === 'candidate' ? request.candidate : request.employerContact);

  if (!expectedId || expectedId !== actualId) {
    throw new ForbiddenError('Privacy request is not linked to this account.');
  }
};

const hasAnyRole = (session: AdminSession, roleKeys: string[]) =>
  session.user.roleKeys.some((role) => roleKeys.includes(role));

const assertAdminSession = async (
  strapi: StrapiService,
  sessionToken: string,
  context: RequestContext,
  allowedRoles: string[] = ['admin', 'super_admin', 'support']
) => {
  const session = await adminAuthService(strapi).getSession({ sessionToken }, context);

  if (!hasAnyRole(session, allowedRoles)) {
    throw new ForbiddenError('Admin access is required.');
  }

  return session;
};

const assertSuperAdminSession = async (
  strapi: StrapiService,
  sessionToken: string,
  context: RequestContext
) => {
  const session = await adminAuthService(strapi).getSession({ sessionToken }, context);

  if (!session.user.roleKeys.includes('super_admin')) {
    throw new ForbiddenError('Super Admin access is required.');
  }

  return session;
};

const audit = (
  strapi: StrapiService,
  {
    actorDisplayName,
    actorEmail,
    actorId,
    actorType,
    context,
    eventType,
    metadata,
    request,
    severity = 'info',
    source,
  }: {
    actorDisplayName?: string;
    actorEmail?: string;
    actorId?: string;
    actorType: 'admin' | 'candidate' | 'employer_contact' | 'service' | 'system';
    context: RequestContext;
    eventType: string;
    metadata?: Record<string, unknown>;
    request?: DocumentRecord | null;
    severity?: 'info' | 'warning' | 'error' | 'critical';
    source: 'admin_dashboard' | 'candidate_dashboard' | 'employer_dashboard' | 'core_api';
  }
) =>
  auditEvents(strapi).record({
    actorDisplayName,
    actorEmail,
    actorId,
    actorType,
    eventCategory: 'privacy',
    eventType,
    ipAddress: context.ipAddress,
    metadata,
    occurredAt: new Date().toISOString(),
    requestId: context.requestId,
    severity,
    source,
    subjectDisplayName: request ? `${humanize(request.requestType)} request` : undefined,
    subjectId: request ? getDocumentId(request) : undefined,
    subjectType: 'privacy_rights_request',
    userAgent: context.userAgent,
  });

const publishPrivacyTaskChange = (strapi: StrapiService, request?: DocumentRecord | null) =>
  publishAdminRealtimeEvent(
    {
      channels: ['operations'],
      resourceKey: getDocumentId(request) ? `privacy-request:${getDocumentId(request)}` : undefined,
      resourceType: 'admin_task',
      type: 'admin_tasks_changed',
    },
    strapi.log
  );

const hashChallengeCode = ({
  code,
  requestDocumentId,
  salt,
}: {
  code: string;
  requestDocumentId: string;
  salt: string;
}) => createHash('sha256').update(`${requestDocumentId}:${code}:${salt}`).digest('hex');

const createDownloadChallenge = (request: DocumentRecord, actorType: string, actorId?: string) => {
  const requestDocumentId = getDocumentId(request);

  if (!requestDocumentId) {
    throw new ValidationError('Privacy request document id is missing.');
  }

  const code = String(randomInt(100000, 1000000));
  const salt = randomBytes(16).toString('hex');

  return {
    code,
    challenge: {
      actorId: actorId || null,
      actorType,
      attempts: 0,
      codeHash: hashChallengeCode({ code, requestDocumentId, salt }),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      requestedAt: new Date().toISOString(),
      salt,
    },
  };
};

const verifyDownloadChallenge = async (
  strapi: StrapiService,
  request: DocumentRecord,
  code: string,
  actorType: string,
  actorId?: string
) => {
  const metadata = requestMetadata(request);
  const challenge = objectValue(metadata.downloadChallenge);
  const requestDocumentId = getDocumentId(request);

  if (!requestDocumentId || !challenge.codeHash || !challenge.salt || !challenge.expiresAt) {
    throw new ValidationError('Request a fresh download code first.');
  }

  if (challenge.actorType !== actorType || (challenge.actorId || null) !== (actorId || null)) {
    throw new ValidationError('Request a fresh download code first.');
  }

  if (new Date(String(challenge.expiresAt)).getTime() < Date.now()) {
    throw new ValidationError('Download code has expired.');
  }

  const attempts = typeof challenge.attempts === 'number' ? challenge.attempts : 0;

  if (attempts >= 5) {
    throw new ValidationError('Download code has expired.');
  }

  const submittedHash = hashChallengeCode({
    code,
    requestDocumentId,
    salt: String(challenge.salt),
  });

  if (submittedHash !== challenge.codeHash) {
    await documents(strapi, 'api::privacy-rights-request.privacy-rights-request').update({
      documentId: requestDocumentId,
      data: {
        metadata: {
          ...metadata,
          downloadChallenge: {
            ...challenge,
            attempts: attempts + 1,
          },
        },
      },
    });
    throw new ValidationError('Download code is not correct.');
  }

  await documents(strapi, 'api::privacy-rights-request.privacy-rights-request').update({
    documentId: requestDocumentId,
    data: {
      identityVerificationStatus: 'verified',
      metadata: {
        ...metadata,
        downloadChallenge: null,
        lastDownloadVerifiedAt: new Date().toISOString(),
      },
    },
  });
};

const requestNotificationServiceEmail = async ({
  correlationId,
  subject,
  template,
  text,
  to,
  type,
}: {
  correlationId?: string;
  subject: string;
  template?: NotificationTemplatePayload;
  text: string;
  to: string;
  type: string;
}): Promise<NotificationServiceQueueResponse | undefined> => {
  const baseUrl = process.env.NOTIFICATION_SERVICE_URL;
  const serviceToken = process.env.NOTIFICATION_SERVICE_TOKEN;

  if (!baseUrl || !serviceToken) {
    return undefined;
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Number(process.env.NOTIFICATION_SERVICE_TIMEOUT_MS || 5000)
  );

  try {
    const response = await fetch(`${trimTrailingSlash(baseUrl)}/api/internal/notifications/email`, {
      body: JSON.stringify({
        correlationId,
        priority: 'transactional',
        source: 'core-api',
        subject,
        template,
        text,
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
      return undefined;
    }

    return payload;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
};

const createNotificationEvent = async (
  strapi: StrapiService,
  request: DocumentRecord,
  {
    bodyLines,
    ctaLabel,
    ctaUrl,
    heading,
    recipient,
    recipientType,
    subject,
    type,
  }: {
    bodyLines: string[];
    ctaLabel?: string;
    ctaUrl?: string;
    heading: string;
    recipient: DocumentRecord;
    recipientType: 'admin' | 'candidate' | 'employer_contact';
    subject: string;
    type: string;
  }
) => {
  const recipientEmail = stringValue(recipient.email);

  if (!recipientEmail) {
    return undefined;
  }

  const requestDocumentId = getDocumentId(request);
  const notification = await documents(strapi, 'api::notification-event.notification-event').create({
    data: {
      channel: 'email',
      deliveryState: 'queued',
      eventType: type,
      priority: 'normal',
      recipientEmail,
      recipientId: getDocumentId(recipient),
      recipientType,
      relatedId: requestDocumentId,
      relatedType: 'privacy_rights_request',
      templateKey: 'generic_branded_message',
      ...(recipientType === 'candidate' && getDocumentId(recipient)
        ? { candidate: relationConnect(recipient) }
        : {}),
      ...(recipientType === 'employer_contact' ? { employer: relationConnect(recipient.employer) } : {}),
      metadata: {
        bodyLines,
        ctaLabel,
        ctaUrl,
        heading,
        subject,
      },
    },
  });

  const emailResult = await requestNotificationServiceEmail({
    correlationId: requestDocumentId,
    subject,
    template: {
      key: 'generic_branded_message',
      variables: {
        bodyLines,
        ctaLabel,
        ctaUrl,
        heading,
        replyInstruction:
          'Please use your HireFlip dashboard for privacy request updates rather than replying to this email.',
        replyTo: process.env.SUPPORT_REPLY_TO_EMAIL || 'support@hireflip.work',
        subject,
      },
    },
    text: bodyLines.join('\n\n'),
    to: recipientEmail,
    type,
  });

  if (!emailResult?.data) {
    await documents(strapi, 'api::notification-event.notification-event').update({
      documentId: getDocumentId(notification),
      data: {
        deliveryState: 'failed',
        failedAt: new Date().toISOString(),
        errorMessage: 'Notification service did not queue the privacy email.',
      },
    });
  }

  return notification;
};

const dashboardPrivacyUrl = (
  subjectType: 'candidate' | 'employer_contact',
  requestDocumentId?: string
) => {
  const baseUrl =
    subjectType === 'candidate'
      ? trimTrailingSlash(process.env.CANDIDATE_DASHBOARD_BASE_URL || 'https://dash.hireflip.work')
      : trimTrailingSlash(process.env.EMPLOYER_DASHBOARD_BASE_URL || 'https://boss.hireflip.work');
  const suffix = requestDocumentId ? `?request=${encodeURIComponent(requestDocumentId)}` : '';

  return `${baseUrl}/settings/privacy${suffix}`;
};

const queuePrivacyUpdate = (
  strapi: StrapiService,
  request: DocumentRecord,
  bodyLines: string[],
  context: RequestContext,
  ctaLabel = 'Open privacy request'
) => {
  const subjectType = request.subjectUserType === 'employer_contact' ? 'employer_contact' : 'candidate';
  const recipient = subjectType === 'employer_contact' ? request.employerContact : request.candidate;

  if (!recipient) {
    return undefined;
  }

  return createNotificationEvent(strapi, request, {
    bodyLines,
    ctaLabel,
    ctaUrl: dashboardPrivacyUrl(subjectType, getDocumentId(request)),
    heading: 'Privacy request update',
    recipient,
    recipientType: subjectType,
    subject: 'Privacy request update',
    type: `${subjectType}_privacy_request_update`,
  }).catch((error) => {
    strapi.log?.warn?.('Privacy request notification could not be queued.', error);
    return undefined;
  });
};

const saveDownloadChallenge = async (
  strapi: StrapiService,
  request: DocumentRecord,
  actorType: 'admin' | 'candidate' | 'employer_contact',
  actorId?: string
) => {
  const { challenge, code } = createDownloadChallenge(request, actorType, actorId);
  const requestDocumentId = getDocumentId(request);

  if (!requestDocumentId) {
    throw new ValidationError('Privacy request document id is missing.');
  }

  await documents(strapi, 'api::privacy-rights-request.privacy-rights-request').update({
    documentId: requestDocumentId,
    data: {
      identityVerificationStatus: 'pending',
      metadata: {
        ...requestMetadata(request),
        downloadChallenge: challenge,
      },
    },
  });

  return code;
};

const createPrivacyRequest = async (
  strapi: StrapiService,
  {
    actorId,
    actorType,
    context,
    exportScope,
    message,
    requestType,
    subject,
    subjectType,
  }: {
    actorId?: string;
    actorType: 'candidate' | 'employer_contact';
    context: RequestContext;
    exportScope?: string;
    message?: string;
    requestType: string;
    subject: DocumentRecord;
    subjectType: 'candidate' | 'employer_contact';
  }
) => {
  const now = new Date();
  const request = await documents(strapi, 'api::privacy-rights-request.privacy-rights-request').create({
    data: {
      dueAt: addOneCalendarMonth(now).toISOString(),
      identityVerificationStatus: 'not_started',
      receivedAt: now.toISOString(),
      requestState: 'received',
      requestType,
      requestingUserId: actorId || getDocumentId(subject),
      requestingUserType: actorType,
      subjectUserId: getDocumentId(subject),
      subjectUserType: subjectType,
      ...(subjectType === 'candidate'
        ? { candidate: relationConnect(subject) }
        : { employerContact: relationConnect(subject) }),
      metadata: {
        exportScope: exportScope || 'personal',
        requesterMessage: message || null,
      },
    },
  });
  const populatedRequest = await findRequestByDocumentId(strapi, getDocumentId(request) || '');

  await audit(strapi, {
    actorEmail: subject.email,
    actorId,
    actorType,
    context,
    eventType: 'privacy.request_created',
    metadata: {
      requestType,
      subjectType,
    },
    request: populatedRequest || request,
    source: subjectType === 'candidate' ? 'candidate_dashboard' : 'employer_dashboard',
  });

  if (populatedRequest) {
    await queuePrivacyUpdate(strapi, populatedRequest, [
      `We have received your ${humanize(requestType).toLowerCase()} request.`,
      'The HireFlip team will review it and update you from your dashboard.',
    ], context);
  }

  await publishPrivacyTaskChange(strapi, populatedRequest || request);

  return populatedRequest || request;
};

const listRequestsForSubject = async (
  strapi: StrapiService,
  subject: DocumentRecord,
  subjectType: 'candidate' | 'employer_contact'
) => {
  const relationFilter =
    subjectType === 'candidate'
      ? { candidate: { documentId: getDocumentId(subject) } }
      : { employerContact: { documentId: getDocumentId(subject) } };
  const requests = await documents(strapi, 'api::privacy-rights-request.privacy-rights-request').findMany({
    filters: relationFilter,
    limit: 100,
    populate: privacyRequestPopulate,
    sort: ['receivedAt:desc', 'createdAt:desc'],
  });

  return {
    requests: requests.map((request) => publicRequest(request)),
  };
};

const jsonClone = (value: unknown) => JSON.parse(JSON.stringify(value ?? null));

const candidateDataExport = async (strapi: StrapiService, candidate: DocumentRecord) => {
  const candidateDocumentId = getDocumentId(candidate);

  if (!candidateDocumentId) {
    throw new ValidationError('Candidate document id is missing.');
  }

  const [
    profiles,
    enrollments,
    requests,
    slotOffers,
    interviews,
    strikes,
    supportCases,
    auditRecords,
    notificationEvents,
    privacyRequests,
  ] = await Promise.all([
    documents(strapi, 'api::candidate-profile.candidate-profile').findMany({
      filters: { candidate: { documentId: candidateDocumentId } },
      limit: 100,
    }),
    documents(strapi, 'api::enrollment.enrollment').findMany({
      filters: { candidate: { documentId: candidateDocumentId } },
      limit: 200,
      populate: '*',
    }),
    documents(strapi, 'api::interview-request.interview-request').findMany({
      filters: { candidate: { documentId: candidateDocumentId } },
      limit: 200,
      populate: '*',
    }),
    documents(strapi, 'api::interview-slot-offer.interview-slot-offer').findMany({
      filters: { candidate: { documentId: candidateDocumentId } },
      limit: 200,
      populate: '*',
    }),
    documents(strapi, 'api::interview.interview').findMany({
      filters: { candidate: { documentId: candidateDocumentId } },
      limit: 200,
      populate: '*',
    }),
    documents(strapi, 'api::candidate-interview-strike.candidate-interview-strike').findMany({
      filters: { candidate: { documentId: candidateDocumentId } },
      limit: 200,
      populate: '*',
    }),
    documents(strapi, 'api::support-case.support-case').findMany({
      filters: { candidate: { documentId: candidateDocumentId } },
      limit: 500,
      populate: '*',
    }),
    documents(strapi, 'api::audit-event.audit-event').findMany({
      filters: {
        $or: [
          { actorId: candidate.authIdentityId || candidateDocumentId },
          { actorEmail: candidate.email },
          { subjectId: candidateDocumentId },
          { subjectDisplayName: displayName(candidate) },
        ],
      },
      limit: 1000,
      sort: ['occurredAt:desc', 'createdAt:desc'],
    }),
    documents(strapi, 'api::notification-event.notification-event').findMany({
      filters: { candidate: { documentId: candidateDocumentId } },
      limit: 1000,
      sort: ['createdAt:desc'],
    }),
    documents(strapi, 'api::privacy-rights-request.privacy-rights-request').findMany({
      filters: { candidate: { documentId: candidateDocumentId } },
      limit: 100,
      sort: ['receivedAt:desc', 'createdAt:desc'],
    }),
  ]);
  const supportCaseIds = compact(supportCases.map(getDocumentId));
  const supportMessages = supportCaseIds.length
    ? await documents(strapi, 'api::support-message.support-message').findMany({
        filters: {
          supportCase: {
            documentId: {
              $in: supportCaseIds,
            },
          },
        },
        limit: 1000,
        sort: ['createdAt:asc'],
      })
    : [];
  const interviewIds = compact(interviews.map(getDocumentId));
  const interviewFeedback = interviewIds.length
    ? await documents(strapi, 'api::interview-feedback.interview-feedback').findMany({
        filters: {
          interview: {
            documentId: {
              $in: interviewIds,
            },
          },
        },
        limit: 1000,
        sort: ['createdAt:asc'],
      })
    : [];

  return {
    auditEvents: auditRecords,
    candidate,
    candidateProfiles: profiles,
    enrollments,
    generatedAt: new Date().toISOString(),
    interviewFeedback,
    interviewRequests: requests,
    interviewSlotOffers: slotOffers,
    interviews,
    notificationEvents,
    privacyRequests,
    schemaVersion: 'candidate-privacy-export-v2',
    strikes,
    supportCases,
    supportMessages,
  };
};

const employerDataExport = async (
  strapi: StrapiService,
  contact: DocumentRecord,
  exportScope: string
) => {
  const contactDocumentId = getDocumentId(contact);
  const employerDocumentId = getDocumentId(contact.employer);

  if (!contactDocumentId) {
    throw new ValidationError('Employer contact document id is missing.');
  }

  const includeCompany = exportScope === 'company' || exportScope === 'both';
  const [
    notificationEvents,
    privacyRequests,
    auditRecords,
    interviews,
    capacityClaims,
    feedback,
    invites,
  ] = await Promise.all([
    documents(strapi, 'api::notification-event.notification-event').findMany({
      filters: {
        recipientType: 'employer_contact',
        recipientId: contactDocumentId,
      },
      limit: 1000,
      sort: ['createdAt:desc'],
    }),
    documents(strapi, 'api::privacy-rights-request.privacy-rights-request').findMany({
      filters: { employerContact: { documentId: contactDocumentId } },
      limit: 100,
      sort: ['receivedAt:desc', 'createdAt:desc'],
    }),
    documents(strapi, 'api::audit-event.audit-event').findMany({
      filters: {
        $or: [
          { actorId: contact.authIdentityId || contactDocumentId },
          { actorEmail: contact.email },
          { subjectId: contactDocumentId },
          ...(includeCompany && employerDocumentId ? [{ subjectId: employerDocumentId }] : []),
        ],
      },
      limit: 1000,
      sort: ['occurredAt:desc', 'createdAt:desc'],
    }),
    documents(strapi, 'api::interview.interview').findMany({
      filters: includeCompany && employerDocumentId
        ? { employer: { documentId: employerDocumentId } }
        : { employerContact: { documentId: contactDocumentId } },
      limit: 1000,
      populate: '*',
    }),
    documents(strapi, 'api::employer-capacity-claim.employer-capacity-claim').findMany({
      filters: includeCompany && employerDocumentId
        ? { employer: { documentId: employerDocumentId } }
        : { employerContact: { documentId: contactDocumentId } },
      limit: 1000,
      populate: '*',
    }),
    documents(strapi, 'api::interview-feedback.interview-feedback').findMany({
      filters: {
        employerContact: {
          documentId: contactDocumentId,
        },
      },
      limit: 1000,
      populate: '*',
    }),
    documents(strapi, 'api::employer-invite.employer-invite').findMany({
      filters: includeCompany && employerDocumentId
        ? { employer: { documentId: employerDocumentId } }
        : { employerContact: { documentId: contactDocumentId } },
      limit: 1000,
      populate: '*',
    }),
  ]);

  return {
    auditEvents: auditRecords,
    employer: includeCompany ? contact.employer : undefined,
    employerCapacityClaims: capacityClaims,
    employerContact: contact,
    employerInvites: invites,
    exportScope,
    generatedAt: new Date().toISOString(),
    interviewFeedback: feedback,
    interviews,
    notificationEvents,
    privacyRequests,
    schemaVersion: 'employer-privacy-export-v1',
  };
};

const redactInternalExportFields = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(redactInternalExportFields);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const source = value as Record<string, unknown>;
  const redacted: Record<string, unknown> = {};
  const blockedKeys = new Set([
    'downloadChallenge',
    'passwordHash',
    'providerPayload',
    'rawProviderPayload',
    'serviceToken',
  ]);

  Object.entries(source).forEach(([key, child]) => {
    redacted[key] = blockedKeys.has(key) ? '[redacted]' : redactInternalExportFields(child);
  });

  return redacted;
};

const renderPdf = async ({
  data,
  request,
  subject,
  title,
}: {
  data: unknown;
  request: DocumentRecord;
  subject: DocumentRecord;
  title: string;
}) =>
  new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({
      margins: {
        bottom: 48,
        left: 48,
        right: 48,
        top: 48,
      },
      size: 'A4',
    });

    doc.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    doc.fontSize(20).text(title);
    doc.moveDown(0.5);
    doc.fontSize(10).text(`Generated: ${new Date().toISOString()}`);
    doc.text(`Subject: ${displayName(subject)} (${subject.email || 'No email'})`);
    doc.text(`Request: ${humanize(request.requestType)} / ${humanize(request.requestState)}`);
    doc.text(`Request ID: ${getDocumentId(request) || 'Not recorded'}`);
    doc.moveDown();
    doc.fontSize(14).text('Export Data');
    doc.moveDown(0.5);
    doc.fontSize(8).text(JSON.stringify(redactInternalExportFields(jsonClone(data)), null, 2), {
      lineGap: 2,
    });
    doc.end();
  });

const exportForRequest = async (strapi: StrapiService, request: DocumentRecord) => {
  if (!['completed', 'partially_fulfilled', 'processing'].includes(String(request.requestState))) {
    throw new ValidationError('Privacy export is not ready for download yet.');
  }

  if (request.subjectUserType === 'employer_contact') {
    const contact = request.employerContact;

    if (!contact) {
      throw new ValidationError('Employer contact is missing from privacy request.');
    }

    const exportScope = String(requestMetadata(request).exportScope || 'personal');
    const data = await employerDataExport(strapi, contact, exportScope);
    const pdf = await renderPdf({
      data,
      request,
      subject: contact,
      title: 'HireFlip Employer Privacy Data Export',
    });

    return {
      base64: pdf.toString('base64'),
      fileName: `hireflip-employer-privacy-export-${getDocumentId(request)}.pdf`,
      mimeType: 'application/pdf',
    };
  }

  const candidate = request.candidate;

  if (!candidate) {
    throw new ValidationError('Candidate is missing from privacy request.');
  }

  const data = await candidateDataExport(strapi, candidate);
  const pdf = await renderPdf({
    data,
    request,
    subject: candidate,
    title: 'HireFlip Candidate Privacy Data Export',
  });

  return {
    base64: pdf.toString('base64'),
    fileName: `hireflip-candidate-privacy-export-${getDocumentId(request)}.pdf`,
    mimeType: 'application/pdf',
  };
};

const activePrivacyBlockers = async (strapi: StrapiService, candidate: DocumentRecord) => {
  const candidateDocumentId = getDocumentId(candidate);

  if (!candidateDocumentId) {
    return ['Candidate document id is missing.'];
  }

  const [
    activeReservations,
    activeEnrollments,
    activeRefunds,
    activePayments,
    activeSupportCases,
    activeInterviews,
    activeInterviewRequests,
  ] = await Promise.all([
    documents(strapi, 'api::reservation.reservation').findMany({
      filters: {
        candidate: { documentId: candidateDocumentId },
        reservationState: { $in: ['active', 'payment_exception'] },
      },
      limit: 1,
    }),
    documents(strapi, 'api::enrollment.enrollment').findMany({
      filters: {
        candidate: { documentId: candidateDocumentId },
        enrollmentState: {
          $in: [
            'enrollment_open',
            'place_reserved',
            'enrolled',
            'payment_exception',
            'in_class',
            'interview_phase',
          ],
        },
      },
      limit: 1,
    }),
    documents(strapi, 'api::refund.refund').findMany({
      filters: {
        candidate: { documentId: candidateDocumentId },
        refundState: {
          $in: ['draft', 'requested', 'approved', 'submitted_to_provider', 'processing', 'failed'],
        },
      },
      limit: 1,
    }),
    documents(strapi, 'api::payment.payment').findMany({
      filters: {
        candidate: { documentId: candidateDocumentId },
        paymentState: { $in: ['checkout_created', 'pending', 'requires_review'] },
      },
      limit: 1,
    }),
    documents(strapi, 'api::support-case.support-case').findMany({
      filters: {
        candidate: { documentId: candidateDocumentId },
        caseState: { $in: ['open', 'awaiting_candidate', 'awaiting_staff', 'in_progress'] },
      },
      limit: 1,
    }),
    documents(strapi, 'api::interview.interview').findMany({
      filters: {
        candidate: { documentId: candidateDocumentId },
        interviewState: {
          $in: ['offered', 'candidate_selected', 'awaiting_employer_details', 'confirmed', 'rescheduled'],
        },
      },
      limit: 1,
    }),
    documents(strapi, 'api::interview-request.interview-request').findMany({
      filters: {
        candidate: { documentId: candidateDocumentId },
        requestState: {
          $in: [
            'pending_profile',
            'pending_availability',
            'pending_capacity',
            'capacity_claimed',
            'employer_notified',
            'slot_options_submitted',
            'candidate_reviewing',
            'candidate_selected',
            'manual_review',
          ],
        },
      },
      limit: 1,
    }),
  ]);
  const blockers = compact([
    activeReservations.length ? 'Active reservation or payment exception' : null,
    activeEnrollments.length ? 'Active class/enrolment' : null,
    activeRefunds.length ? 'Active refund or payment dispute' : null,
    activePayments.length ? 'Active payment workflow' : null,
    activeSupportCases.length ? 'Active support case' : null,
    activeInterviews.length ? 'Active interview' : null,
    activeInterviewRequests.length ? 'Active interview request' : null,
    candidate.accountRestrictionStatus && candidate.accountRestrictionStatus !== 'active'
      ? 'Unresolved account restriction appeal may exist'
      : null,
  ]);

  return blockers;
};

const anonymiseCandidate = async (
  strapi: StrapiService,
  candidate: DocumentRecord,
  session: AdminSession,
  request: DocumentRecord,
  auditReason: string,
  context: RequestContext
) => {
  const candidateDocumentId = getDocumentId(candidate);

  if (!candidateDocumentId) {
    throw new ValidationError('Candidate document id is missing.');
  }

  const blockers = await activePrivacyBlockers(strapi, candidate);

  if (blockers.length) {
    await documents(strapi, 'api::privacy-rights-request.privacy-rights-request').update({
      documentId: getDocumentId(request),
      data: {
        retentionReasons: blockers,
      },
    });
    throw new ValidationError(`Candidate cannot be anonymised yet: ${blockers.join('; ')}.`);
  }

  if (candidate.authIdentityId) {
    await getAuth0ManagementClient().deleteUser(String(candidate.authIdentityId));
  }

  const anonymisedEmail = `anon+${candidateDocumentId}@privacy.hireflip.local`;
  await documents(strapi, 'api::candidate.candidate').update({
    documentId: candidateDocumentId,
    data: {
      accountRestrictionAppealStatus: 'not_applicable',
      accountRestrictionMessage: null,
      accountRestrictionReason: 'privacy_anonymised',
      accountRestrictionStatus: 'blacklisted',
      accountRestrictedAt: new Date().toISOString(),
      accountRestrictedBy: session.user.email,
      authIdentityId: null,
      authProvider: 'unknown',
      candidateState: 'archived',
      classAreaPreferences: {},
      dateOfBirth: null,
      email: anonymisedEmail,
      firstName: 'Anonymised',
      gender: null,
      genderSelfDescription: null,
      lastName: 'Candidate',
      marketingConsentCapturedAt: null,
      marketingConsentState: 'withdrawn',
      notificationPreferences: {},
      phone: null,
      profileImage: null,
      profileSettings: {
        anonymisedAt: new Date().toISOString(),
        anonymisedBy: session.user.email,
        privacyRequestDocumentId: getDocumentId(request),
      },
      recruitmentPlatformVisibility: 'hidden',
      region: null,
      sector: null,
      workSectorPreferences: {},
    },
  });
  const profiles = await documents(strapi, 'api::candidate-profile.candidate-profile').findMany({
    filters: { candidate: { documentId: candidateDocumentId } },
    limit: 100,
  });

  await Promise.all(
    profiles.map((profile) =>
      documents(strapi, 'api::candidate-profile.candidate-profile').update({
        documentId: getDocumentId(profile),
        data: {
          availability: null,
          availabilityNote: null,
          education: [],
          experience: [],
          generatedCvFile: null,
          linkedinUrl: null,
          location: null,
          metadata: {
            anonymisedAt: new Date().toISOString(),
            privacyRequestDocumentId: getDocumentId(request),
          },
          portfolioUrl: null,
          profileState: 'archived',
          projects: [],
          recruitmentPlatformVisibility: 'hidden',
          skills: [],
          summary: null,
          targetRoleTitle: null,
          targetSector: null,
          targetSectorLabel: null,
          unavailableDates: [],
          workPreferences: {},
        },
      })
    )
  );

  const updatedRequest = await documents(strapi, 'api::privacy-rights-request.privacy-rights-request').update({
    documentId: getDocumentId(request),
    data: {
      completedAt: new Date().toISOString(),
      deletionJobStatus: 'completed',
      downstreamProviderSyncStatus: 'completed',
      requestState: 'completed',
      metadata: {
        ...requestMetadata(request),
        anonymisedAt: new Date().toISOString(),
        anonymisedBy: session.user.email,
        anonymisationReason: auditReason,
      },
    },
  });

  await audit(strapi, {
    actorDisplayName: session.user.displayName,
    actorEmail: session.user.email,
    actorId: session.user.id,
    actorType: 'admin',
    context,
    eventType: 'privacy.candidate_anonymised',
    metadata: {
      auditReason,
      candidateDocumentId,
    },
    request: updatedRequest,
    severity: 'warning',
    source: 'admin_dashboard',
  });

  return updatedRequest;
};

const adminResult = (session: AdminSession, request: DocumentRecord) => ({
  request: publicRequest(request, true),
  user: session.user,
});

export default ({ strapi }: { strapi: StrapiService }) => ({
  async candidateListRequests(auth: unknown) {
    const candidate = await assertCandidateAuth(strapi, auth);

    return listRequestsForSubject(strapi, candidate, 'candidate');
  },

  async candidateCreateRequest(auth: unknown, input: unknown, context: RequestContext) {
    const body = validateCandidateCreate(input);
    const candidate = await assertCandidateAuth(strapi, auth);
    const request = await createPrivacyRequest(strapi, {
      actorId: candidate.authIdentityId,
      actorType: 'candidate',
      context,
      message: body.message,
      requestType: body.requestType,
      subject: candidate,
      subjectType: 'candidate',
    });

    return {
      created: true,
      request: publicRequest(request),
    };
  },

  async candidateRequestDownloadCode(auth: unknown, requestDocumentId: string, context: RequestContext) {
    const candidate = await assertCandidateAuth(strapi, auth);
    const request = await findRequestByDocumentId(strapi, requestDocumentId);

    if (!request) {
      throw new ValidationError('Privacy request could not be found.');
    }

    assertSubjectOwnsRequest(request, candidate, 'candidate');

    const code = await saveDownloadChallenge(strapi, request, 'candidate', candidate.authIdentityId);
    await createNotificationEvent(strapi, request, {
      bodyLines: [
        `Your HireFlip privacy download code is ${code}.`,
        'This code expires in 15 minutes.',
        'If you did not request this, contact HireFlip support from your dashboard.',
      ],
      heading: 'Your privacy download code',
      recipient: candidate,
      recipientType: 'candidate',
      subject: 'Your HireFlip privacy download code',
      type: 'candidate_privacy_download_code',
    });
    await audit(strapi, {
      actorEmail: candidate.email,
      actorId: candidate.authIdentityId,
      actorType: 'candidate',
      context,
      eventType: 'privacy.download_code_requested',
      request,
      source: 'candidate_dashboard',
    });

    return {
      codeSent: true,
      expiresInSeconds: 900,
    };
  },

  async candidateDownloadExport(
    auth: unknown,
    requestDocumentId: string,
    input: unknown,
    context: RequestContext
  ) {
    const body = validateDownload(input);
    const candidate = await assertCandidateAuth(strapi, auth);
    const request = await findRequestByDocumentId(strapi, requestDocumentId);

    if (!request) {
      throw new ValidationError('Privacy request could not be found.');
    }

    assertSubjectOwnsRequest(request, candidate, 'candidate');
    await verifyDownloadChallenge(strapi, request, body.code, 'candidate', candidate.authIdentityId);
    const file = await exportForRequest(strapi, request);
    await audit(strapi, {
      actorEmail: candidate.email,
      actorId: candidate.authIdentityId,
      actorType: 'candidate',
      context,
      eventType: 'privacy.export_downloaded',
      request,
      source: 'candidate_dashboard',
    });

    return {
      file,
      downloaded: true,
    };
  },

  async candidateEmailDownloadLink(auth: unknown, requestDocumentId: string, context: RequestContext) {
    const candidate = await assertCandidateAuth(strapi, auth);
    const request = await findRequestByDocumentId(strapi, requestDocumentId);

    if (!request) {
      throw new ValidationError('Privacy request could not be found.');
    }

    assertSubjectOwnsRequest(request, candidate, 'candidate');
    await createNotificationEvent(strapi, request, {
      bodyLines: [
        'Your privacy export is ready to download from your HireFlip dashboard.',
        'For security, you will need to request and enter a one-time code before the file downloads.',
      ],
      ctaLabel: 'Open privacy request',
      ctaUrl: dashboardPrivacyUrl('candidate', requestDocumentId),
      heading: 'Your privacy export is ready',
      recipient: candidate,
      recipientType: 'admin',
      subject: 'Your HireFlip privacy export is ready',
      type: 'candidate_privacy_download_link',
    });

    return {
      emailed: true,
    };
  },

  async employerListRequests(input: unknown) {
    const identity = validateEmployerRequest({
      ...(typeof input === 'object' && input ? input : {}),
      requestDocumentId: 'placeholder',
    });
    const contact = await findEmployerContact(strapi, identity);

    return listRequestsForSubject(strapi, contact, 'employer_contact');
  },

  async employerCreateRequest(input: unknown, context: RequestContext) {
    const body = validateEmployerCreate(input);
    const contact = await findEmployerContact(strapi, body);
    const request = await createPrivacyRequest(strapi, {
      actorId: body.authIdentityId,
      actorType: 'employer_contact',
      context,
      exportScope: body.exportScope,
      message: body.message,
      requestType: body.requestType,
      subject: contact,
      subjectType: 'employer_contact',
    });

    return {
      created: true,
      request: publicRequest(request),
    };
  },

  async employerRequestDownloadCode(input: unknown, context: RequestContext) {
    const body = validateEmployerRequest(input);
    const contact = await findEmployerContact(strapi, body);
    const request = await findRequestByDocumentId(strapi, body.requestDocumentId);

    if (!request) {
      throw new ValidationError('Privacy request could not be found.');
    }

    assertSubjectOwnsRequest(request, contact, 'employer_contact');

    const code = await saveDownloadChallenge(strapi, request, 'employer_contact', body.authIdentityId);
    await createNotificationEvent(strapi, request, {
      bodyLines: [
        `Your HireFlip privacy download code is ${code}.`,
        'This code expires in 15 minutes.',
        'If you did not request this, contact HireFlip support from your dashboard.',
      ],
      heading: 'Your privacy download code',
      recipient: contact,
      recipientType: 'employer_contact',
      subject: 'Your HireFlip privacy download code',
      type: 'employer_contact_privacy_download_code',
    });
    await audit(strapi, {
      actorEmail: contact.email,
      actorId: body.authIdentityId,
      actorType: 'employer_contact',
      context,
      eventType: 'privacy.download_code_requested',
      request,
      source: 'employer_dashboard',
    });

    return {
      codeSent: true,
      expiresInSeconds: 900,
    };
  },

  async employerDownloadExport(input: unknown, context: RequestContext) {
    const body = validateEmployerRequest(input);
    const contact = await findEmployerContact(strapi, body);
    const request = await findRequestByDocumentId(strapi, body.requestDocumentId);

    if (!request) {
      throw new ValidationError('Privacy request could not be found.');
    }

    if (!body.code) {
      throw new ValidationError('Download code is required.');
    }

    assertSubjectOwnsRequest(request, contact, 'employer_contact');
    await verifyDownloadChallenge(strapi, request, body.code, 'employer_contact', body.authIdentityId);
    const file = await exportForRequest(strapi, request);
    await audit(strapi, {
      actorEmail: contact.email,
      actorId: body.authIdentityId,
      actorType: 'employer_contact',
      context,
      eventType: 'privacy.export_downloaded',
      request,
      source: 'employer_dashboard',
    });

    return {
      downloaded: true,
      file,
    };
  },

  async employerEmailDownloadLink(input: unknown, context: RequestContext) {
    const body = validateEmployerRequest(input);
    const contact = await findEmployerContact(strapi, body);
    const request = await findRequestByDocumentId(strapi, body.requestDocumentId);

    if (!request) {
      throw new ValidationError('Privacy request could not be found.');
    }

    assertSubjectOwnsRequest(request, contact, 'employer_contact');
    await createNotificationEvent(strapi, request, {
      bodyLines: [
        'Your privacy export is ready to download from your HireFlip dashboard.',
        'For security, you will need to request and enter a one-time code before the file downloads.',
      ],
      ctaLabel: 'Open privacy request',
      ctaUrl: dashboardPrivacyUrl('employer_contact', body.requestDocumentId),
      heading: 'Your privacy export is ready',
      recipient: contact,
      recipientType: 'employer_contact',
      subject: 'Your HireFlip privacy export is ready',
      type: 'employer_contact_privacy_download_link',
    });
    await audit(strapi, {
      actorEmail: contact.email,
      actorId: body.authIdentityId,
      actorType: 'employer_contact',
      context,
      eventType: 'privacy.download_link_emailed',
      request,
      source: 'employer_dashboard',
    });

    return {
      emailed: true,
    };
  },

  async adminListRequests(input: unknown, context: RequestContext) {
    const body = validateAdminList(input);
    const session = await assertAdminSession(strapi, body.sessionToken, context);
    const filters: Record<string, unknown> = {};

    if (body.requestState !== 'all') {
      filters.requestState = body.requestState;
    }

    if (body.requestType !== 'all') {
      filters.requestType = body.requestType;
    }

    if (body.subjectUserType !== 'all') {
      filters.subjectUserType = body.subjectUserType;
    }

    const requests = await documents(strapi, 'api::privacy-rights-request.privacy-rights-request').findMany({
      filters,
      limit: 500,
      populate: privacyRequestPopulate,
      sort: ['receivedAt:desc', 'createdAt:desc'],
    });
    const search = body.search?.toLowerCase();
    const searched = search
      ? requests.filter((request) =>
          [
            request.requestType,
            request.requestState,
            request.candidate?.email,
            request.employerContact?.email,
            displayName(request.candidate),
            displayName(request.employerContact),
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
            .includes(search)
        )
      : requests;
    const start = (body.page - 1) * body.pageSize;
    const pageRequests = searched.slice(start, start + body.pageSize);

    return {
      counts: {
        active: requests.filter((request) =>
          ['received', 'identity_verification_required', 'in_review', 'clarification_requested', 'processing'].includes(
            String(request.requestState)
          )
        ).length,
        overdue: requests.filter((request) => request.dueAt && new Date(request.dueAt).getTime() < Date.now()).length,
        total: requests.length,
      },
      pagination: {
        page: body.page,
        pageSize: body.pageSize,
        total: searched.length,
      },
      requests: pageRequests.map((request) => publicRequest(request, true)),
      user: session.user,
    };
  },

  async adminGetRequest(input: unknown, context: RequestContext) {
    const body = validateAdminRequest(input);
    const session = await assertAdminSession(strapi, body.sessionToken, context);
    const request = await findRequestByDocumentId(strapi, body.requestDocumentId);

    if (!request) {
      throw new ValidationError('Privacy request could not be found.');
    }

    const blockers =
      request.candidate && ['deletion', 'erasure'].includes(String(request.requestType))
        ? await activePrivacyBlockers(strapi, request.candidate)
        : [];

    return {
      blockers,
      ...adminResult(session, request),
    };
  },

  async adminAction(input: unknown, context: RequestContext) {
    const body = validateAdminAction(input);
    const session = await assertAdminSession(strapi, body.sessionToken, context);
    const request = await findRequestByDocumentId(strapi, body.requestDocumentId);

    if (!request) {
      throw new ValidationError('Privacy request could not be found.');
    }

    if (
      ['deletion', 'erasure'].includes(String(request.requestType)) &&
      body.requestState === 'completed' &&
      !session.user.roleKeys.includes('super_admin')
    ) {
      throw new ForbiddenError('Super Admin approval is required to complete deletion requests.');
    }

    const metadata = requestMetadata(request);
    const nextNotes = [
      ...(Array.isArray(metadata.notes) ? metadata.notes : []),
      ...(body.internalNote
        ? [
            {
              body: body.internalNote,
              createdAt: new Date().toISOString(),
              createdBy: session.user.email,
            },
          ]
        : []),
    ];
    const terminalPrivacyRequestStates = ['completed', 'partially_fulfilled', 'rejected', 'cancelled'];
    const nextStateIsTerminal = terminalPrivacyRequestStates.includes(body.requestState);
    const updated = await documents(strapi, 'api::privacy-rights-request.privacy-rights-request').update({
      documentId: getDocumentId(request),
      data: {
        completedAt: nextStateIsTerminal ? request.completedAt || new Date().toISOString() : null,
        rejectionReason: body.requestState === 'rejected' ? body.rejectionReason || null : request.rejectionReason || null,
        requestState: body.requestState,
        metadata: {
          ...metadata,
          notes: nextNotes,
          publicResponse: body.publicResponse || metadata.publicResponse || null,
          stateUpdatedAt: new Date().toISOString(),
          stateUpdatedBy: session.user.email,
        },
      },
    });
    const populated = (await findRequestByDocumentId(strapi, getDocumentId(updated) || '')) || updated;

    await audit(strapi, {
      actorDisplayName: session.user.displayName,
      actorEmail: session.user.email,
      actorId: session.user.id,
      actorType: 'admin',
      context,
      eventType: 'privacy.request_state_updated',
      metadata: {
        nextState: body.requestState,
        previousState: request.requestState,
      },
      request: populated,
      source: 'admin_dashboard',
    });

    if (body.publicResponse || ['completed', 'partially_fulfilled', 'rejected'].includes(body.requestState)) {
      await queuePrivacyUpdate(strapi, populated, [
        `Your privacy request is now ${humanize(body.requestState).toLowerCase()}.`,
        body.publicResponse ||
          (body.requestState === 'completed'
            ? 'You can review the request from your HireFlip dashboard.'
            : 'The HireFlip team has updated your request.'),
      ], context);
    }

    await publishPrivacyTaskChange(strapi, populated);

    return adminResult(session, populated);
  },

  async adminRequestDownloadCode(input: unknown, context: RequestContext) {
    const body = validateAdminRequest(input);
    const session = await assertSuperAdminSession(strapi, body.sessionToken, context);
    const request = await findRequestByDocumentId(strapi, body.requestDocumentId);

    if (!request) {
      throw new ValidationError('Privacy request could not be found.');
    }

    const code = await saveDownloadChallenge(strapi, request, 'admin', session.user.id);
    await createNotificationEvent(strapi, request, {
      bodyLines: [
        `Your HireFlip admin privacy export code is ${code}.`,
        'This code expires in 15 minutes.',
      ],
      heading: 'Your admin privacy export code',
      recipient: {
        documentId: session.user.id,
        email: session.user.email,
        firstName: session.user.displayName,
      },
      recipientType: 'candidate',
      subject: 'Your HireFlip admin privacy export code',
      type: 'admin_privacy_download_code',
    });
    await audit(strapi, {
      actorDisplayName: session.user.displayName,
      actorEmail: session.user.email,
      actorId: session.user.id,
      actorType: 'admin',
      context,
      eventType: 'privacy.admin_download_code_requested',
      request,
      source: 'admin_dashboard',
    });

    return {
      codeSent: true,
      expiresInSeconds: 900,
      user: session.user,
    };
  },

  async adminDownloadExport(input: unknown, context: RequestContext) {
    const body = validateAdminDownload(input);
    const session = await assertSuperAdminSession(strapi, body.sessionToken, context);
    const request = await findRequestByDocumentId(strapi, body.requestDocumentId);

    if (!request) {
      throw new ValidationError('Privacy request could not be found.');
    }

    await verifyDownloadChallenge(strapi, request, body.code, 'admin', session.user.id);
    const file = await exportForRequest(strapi, request);
    await audit(strapi, {
      actorDisplayName: session.user.displayName,
      actorEmail: session.user.email,
      actorId: session.user.id,
      actorType: 'admin',
      context,
      eventType: 'privacy.admin_export_downloaded',
      request,
      source: 'admin_dashboard',
    });

    return {
      downloaded: true,
      file,
      user: session.user,
    };
  },

  async adminAnonymiseCandidate(input: unknown, context: RequestContext) {
    const body = validateAdminAnonymise(input);
    const session = await assertSuperAdminSession(strapi, body.sessionToken, context);
    const request = await findRequestByDocumentId(strapi, body.requestDocumentId);

    if (!request) {
      throw new ValidationError('Privacy request could not be found.');
    }

    if (!['deletion', 'erasure'].includes(String(request.requestType))) {
      throw new ValidationError('Only deletion or erasure requests can anonymise a candidate.');
    }

    if (!request.candidate) {
      throw new ValidationError('Privacy request is not linked to a candidate.');
    }

    const updated = await anonymiseCandidate(strapi, request.candidate, session, request, body.auditReason, context);
    await publishPrivacyTaskChange(strapi, updated);

    return adminResult(session, updated);
  },
});

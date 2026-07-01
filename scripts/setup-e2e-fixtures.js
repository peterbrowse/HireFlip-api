#!/usr/bin/env node

const { createHash } = require('node:crypto');
const { compileStrapi, createStrapi } = require('@strapi/strapi');

process.env.CLASS_WORKFLOW_BOOTSTRAP_ENABLED = 'false';

const roleDefinitions = {
  admin: { code: 'hireflip-admin', name: 'Admin' },
  sales: { code: 'hireflip-sales', name: 'Sales' },
  support: { code: 'hireflip-support', name: 'Support' },
};

const trimTrailingSlash = (value) => value.replace(/\/+$/, '');

const normalizeDomain = (value) => trimTrailingSlash(value.trim().replace(/^https?:\/\//, ''));

const requireEnv = (name) => {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required for e2e fixture setup.`);
  }

  return value;
};

const optionalEnv = (name, fallback = '') => process.env[name]?.trim() || fallback;

const normalizeEmail = (value) => value.trim().toLowerCase();

const hashInviteToken = (token) => createHash('sha256').update(token).digest('hex');

const hashPrivacyDownloadCode = ({ code, requestDocumentId, salt }) =>
  createHash('sha256').update(`${requestDocumentId}:${code}:${salt}`).digest('hex');

const safeSlug = (value) =>
  String(value || 'e2e')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const normalizePreferenceValue = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const preferenceSelection = (slug) => ({
  other: '',
  selected: [normalizePreferenceValue(slug)],
});

const addDays = (date, days) => {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

const addHours = (date, hours) => {
  const next = new Date(date.getTime());
  next.setUTCHours(next.getUTCHours() + hours);
  return next;
};

const isoDaysFrom = (date, days) => addDays(date, days).toISOString();

const isoDaysHoursFrom = (date, days, hours) => addHours(addDays(date, days), hours).toISOString();

const connect = (record) => ({ connect: [{ documentId: record.documentId }] });
const connectMany = (records) => ({
  connect: records.map((record) => ({ documentId: record.documentId })),
});

const documents = (strapi, uid) => strapi.documents(uid);

const findFirst = async (strapi, uid, filters, populate = []) => {
  const records = await documents(strapi, uid).findMany({
    filters,
    limit: 1,
    populate,
    sort: ['createdAt:desc'],
  });

  return records[0] || null;
};

const deleteDocument = async (strapi, uid, documentId) => {
  if (!documentId) {
    return;
  }

  await documents(strapi, uid).delete({ documentId }).catch(() => undefined);
};

const deleteMany = async (strapi, uid, filters) => {
  const records = await documents(strapi, uid).findMany({
    filters,
    limit: 100,
  });

  for (const record of records) {
    await deleteDocument(strapi, uid, record.documentId);
  }

  return records.length;
};

const upsertBySlug = async (strapi, uid, slug, data, populate = []) => {
  const existing = await findFirst(strapi, uid, { slug }, populate);

  if (existing?.documentId) {
    return documents(strapi, uid).update({
      documentId: existing.documentId,
      data,
      populate,
    });
  }

  return documents(strapi, uid).create({
    data: {
      ...data,
      slug,
    },
    populate,
  });
};

const upsertCourse = async (strapi, data) => {
  const existing = await findFirst(strapi, 'api::course.course', {
    name: data.name,
    version: data.version,
  });

  if (existing?.documentId) {
    return documents(strapi, 'api::course.course').update({
      documentId: existing.documentId,
      data,
    });
  }

  return documents(strapi, 'api::course.course').create({ data });
};

const managementConfig = () => {
  const domain = normalizeDomain(requireEnv('AUTH0_MANAGEMENT_DOMAIN'));

  return {
    audience: `https://${domain}/api/v2/`,
    clientId: requireEnv('AUTH0_MANAGEMENT_CLIENT_ID'),
    clientSecret: requireEnv('AUTH0_MANAGEMENT_CLIENT_SECRET'),
    domain,
  };
};

let cachedManagementToken = null;

const parseAuth0Response = async (response, fallbackMessage) => {
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(payload?.message || payload?.error_description || fallbackMessage);
  }

  return payload;
};

const getManagementToken = async (config) => {
  if (cachedManagementToken?.expiresAt > Date.now() + 60_000) {
    return cachedManagementToken.accessToken;
  }

  const response = await fetch(`https://${config.domain}/oauth/token`, {
    body: JSON.stringify({
      audience: config.audience,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: 'client_credentials',
    }),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  });
  const payload = await parseAuth0Response(response, 'Auth0 Management token request failed.');

  cachedManagementToken = {
    accessToken: payload.access_token,
    expiresAt: Date.now() + Math.max(60, payload.expires_in || 3600) * 1000,
  };

  return cachedManagementToken.accessToken;
};

const requestManagementApi = async (config, path, init = {}) => {
  const accessToken = await getManagementToken(config);
  const response = await fetch(`https://${config.domain}/api/v2${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers || {}),
      authorization: `Bearer ${accessToken}`,
    },
  });

  return parseAuth0Response(response, 'Auth0 Management API request failed.');
};

const isConnectionUser = (user, connectionName) =>
  Array.isArray(user.identities) &&
  user.identities.some((identity) => identity.connection === connectionName);

const ensureAuth0User = async ({
  connectionName,
  email,
  firstName,
  lastName,
  name,
  password,
}) => {
  const config = managementConfig();
  const normalizedEmail = normalizeEmail(email);
  const existingUsers = await requestManagementApi(
    config,
    `/users-by-email?email=${encodeURIComponent(normalizedEmail)}`
  );
  const existingUser = existingUsers.find((user) => isConnectionUser(user, connectionName));
  const profileData = {
    blocked: false,
    email_verified: true,
    family_name: lastName || undefined,
    given_name: firstName || undefined,
    name: name || [firstName, lastName].filter(Boolean).join(' ') || normalizedEmail,
  };

  if (existingUser) {
    if (optionalEnv('HIREFLIP_E2E_SYNC_AUTH0_USERS', 'false') !== 'true') {
      return {
        created: false,
        userId: existingUser.user_id,
      };
    }

    const updatedUser = await requestManagementApi(
      config,
      `/users/${encodeURIComponent(existingUser.user_id)}`,
      {
        body: JSON.stringify(profileData),
        method: 'PATCH',
      }
    );

    await requestManagementApi(config, `/users/${encodeURIComponent(existingUser.user_id)}`, {
      body: JSON.stringify({
        connection: connectionName,
        password,
      }),
      method: 'PATCH',
    });

    return {
      created: false,
      userId: updatedUser.user_id,
    };
  }

  const createdUser = await requestManagementApi(config, '/users', {
    body: JSON.stringify({
      ...profileData,
      connection: connectionName,
      email: normalizedEmail,
      password,
      verify_email: false,
    }),
    method: 'POST',
  });

  return {
    created: true,
    userId: createdUser.user_id,
  };
};

const getStaffRole = async (strapi, roleKey) => {
  const roleService = strapi.service('admin::role');

  if (roleKey === 'super_admin') {
    return roleService.getSuperAdmin();
  }

  const definition = roleDefinitions[roleKey];

  if (!definition) {
    throw new Error(`Unsupported e2e staff role ${roleKey}.`);
  }

  return (
    (await roleService.findOne({ code: definition.code })) ||
    (await roleService.findOne({ name: definition.name }))
  );
};

const ensureStaffUser = async (strapi) => {
  const email = normalizeEmail(requireEnv('HIREFLIP_E2E_ADMIN_EMAIL'));
  const password = requireEnv('HIREFLIP_E2E_ADMIN_PASSWORD');
  const roleKey = optionalEnv('HIREFLIP_E2E_ADMIN_ROLE', 'super_admin');
  const role = await getStaffRole(strapi, roleKey);

  if (!role?.id) {
    throw new Error(`Admin role ${roleKey} is not available.`);
  }

  const userService = strapi.service('admin::user');
  const existing = await strapi.db.query('admin::user').findOne({
    populate: ['roles'],
    where: {
      email,
    },
  });
  const payload = {
    email,
    firstname: optionalEnv('HIREFLIP_E2E_ADMIN_FIRST_NAME', 'E2E'),
    isActive: true,
    lastname: optionalEnv('HIREFLIP_E2E_ADMIN_LAST_NAME', 'Admin'),
    password,
    registrationToken: null,
    roles: [role.id],
  };
  const staffUser = existing?.id
    ? await userService.updateById(existing.id, payload)
    : await userService.create(payload);

  return {
    created: !existing,
    email,
    id: staffUser.id,
    roleKey,
  };
};

const ensureActiveCheckoutTermsPolicy = async (strapi) => {
  const existingPolicy = await findFirst(strapi, 'api::policy-document.policy-document', {
    policyState: 'active',
    policyType: 'class_checkout_terms',
  });

  if (existingPolicy) {
    return existingPolicy;
  }

  return documents(strapi, 'api::policy-document.policy-document').create({
    data: {
      acceptanceLabel: 'I have read and accept the HireFlip e2e checkout terms.',
      body: 'E2E checkout terms for browser smoke testing. Final legal wording remains outside this fixture.',
      effectiveFrom: new Date().toISOString(),
      introCopy: 'Review these e2e checkout terms before paying.',
      policyKey: 'e2e:class-checkout-terms',
      policyState: 'active',
      policyType: 'class_checkout_terms',
      title: 'E2E Checkout Terms',
      version: 'e2e-checkout-terms-v1',
    },
  });
};

const ensureContent = async (strapi) => {
  const areaSlug = safeSlug(optionalEnv('HIREFLIP_E2E_CLASS_AREA_SLUG', 'e2e-london'));
  const coverageAreaSlug = safeSlug(
    optionalEnv('HIREFLIP_E2E_COVERAGE_GAP_AREA_SLUG', 'e2e-manchester')
  );
  const sectorSlug = safeSlug(optionalEnv('HIREFLIP_E2E_WORK_SECTOR_SLUG', 'e2e-marketing'));
  const classSlug = safeSlug(optionalEnv('HIREFLIP_E2E_CLASS_SLUG', 'hireflip-e2e-checkout-class'));
  const year = Math.max(2026, new Date().getUTCFullYear());
  const area = await upsertBySlug(strapi, 'api::class-area.class-area', areaSlug, {
    country: 'United Kingdom',
    name: optionalEnv('HIREFLIP_E2E_CLASS_AREA_NAME', 'E2E London'),
    slug: areaSlug,
    state: 'active',
  });
  const coverageGapArea = await upsertBySlug(
    strapi,
    'api::class-area.class-area',
    coverageAreaSlug,
    {
      country: 'United Kingdom',
      name: optionalEnv('HIREFLIP_E2E_COVERAGE_GAP_AREA_NAME', 'E2E Manchester'),
      slug: coverageAreaSlug,
      state: 'active',
    }
  );
  const sector = await upsertBySlug(strapi, 'api::work-sector.work-sector', sectorSlug, {
    name: optionalEnv('HIREFLIP_E2E_WORK_SECTOR_NAME', 'E2E Marketing'),
    slug: sectorSlug,
    state: 'active',
  });
  const course = await upsertCourse(strapi, {
    courseState: 'active',
    name: 'E2E Browser Course',
    sector: sector.name,
    sourceType: 'internal',
    version: 'e2e-browser-v1',
  });
  const existingClass =
    (await findFirst(strapi, 'api::class.class', {
      officialClassCode: optionalEnv('HIREFLIP_E2E_CLASS_CODE', 'E2E-001'),
    })) ||
    (await findFirst(strapi, 'api::class.class', { slug: classSlug }));
  const classData = {
    capacity: Number.parseInt(optionalEnv('HIREFLIP_E2E_CLASS_CAPACITY', '20'), 10),
    classArea: connect(area),
    course: connect(course),
    currency: 'GBP',
    discountedPricePence: Number.parseInt(optionalEnv('HIREFLIP_E2E_CLASS_PRICE_PENCE', '100'), 10),
    displayTitle: optionalEnv('HIREFLIP_E2E_CLASS_TITLE', 'HireFlip E2E Checkout Class'),
    enrollmentOpenedAt: new Date().toISOString(),
    enrollmentOpenedBy: 'e2e-fixture',
    interviewCapacityContingencyPercentage: 30,
    interviewsGuaranteed: 2,
    level: 'Entry',
    minimumViableCapacity: 1,
    modulesPassCriteriaAttached: true,
    name: optionalEnv('HIREFLIP_E2E_CLASS_NAME', 'HireFlip E2E Checkout Class'),
    officialClassCode: optionalEnv('HIREFLIP_E2E_CLASS_CODE', 'E2E-001'),
    openedAt: new Date().toISOString(),
    openingMode: 'admin_immediate',
    openingReadinessStatus: 'opened',
    overview: 'A browser e2e fixture class used to verify the candidate checkout journey.',
    pricePence: Number.parseInt(optionalEnv('HIREFLIP_E2E_CLASS_PRICE_PENCE', '100'), 10),
    region: area.name,
    remoteInterviewsAllowed: true,
    sector: sector.name,
    slug: classSlug,
    startDate: `${year}-12-01`,
    state: 'open',
    workSector: connect(sector),
    year,
    yearSequenceNumber: 997,
  };
  const classRecord = existingClass?.documentId
    ? await documents(strapi, 'api::class.class').update({
        documentId: existingClass.documentId,
        data: classData,
        populate: ['classArea', 'workSector', 'course'],
      })
    : await documents(strapi, 'api::class.class').create({
        data: classData,
        populate: ['classArea', 'workSector', 'course'],
      });

  await ensureActiveCheckoutTermsPolicy(strapi);

  return {
    area,
    classRecord,
    coverageGapArea,
    sector,
  };
};

const resetCandidateCheckoutRecords = async (strapi, candidate) => {
  if (!candidate?.documentId) {
    return {
      enrollments: 0,
      payments: 0,
      reservations: 0,
    };
  }

  const filters = { candidate: { documentId: candidate.documentId } };

  return {
    payments: await deleteMany(strapi, 'api::payment.payment', filters),
    reservations: await deleteMany(strapi, 'api::reservation.reservation', filters),
    enrollments: await deleteMany(strapi, 'api::enrollment.enrollment', filters),
  };
};

const resetCandidatePrivacyRecords = async (strapi, candidate) => {
  if (!candidate?.documentId) {
    return 0;
  }

  return deleteMany(strapi, 'api::privacy-rights-request.privacy-rights-request', {
    candidate: { documentId: candidate.documentId },
  });
};

const resetCandidateNotificationEvents = async (strapi, candidate) => {
  if (!candidate?.documentId) {
    return 0;
  }

  return deleteMany(strapi, 'api::notification-event.notification-event', {
    candidate: { documentId: candidate.documentId },
  });
};

const ensureCandidate = async (strapi, auth0User, content) => {
  const email = normalizeEmail(requireEnv('HIREFLIP_E2E_CANDIDATE_EMAIL'));
  const now = new Date().toISOString();
  const existing =
    (await findFirst(strapi, 'api::candidate.candidate', { email })) ||
    (await findFirst(strapi, 'api::candidate.candidate', { authIdentityId: auth0User.userId }));

  if (existing?.documentId) {
    await resetCandidatePrivacyRecords(strapi, existing);
    await resetCandidateNotificationEvents(strapi, existing);
    await resetCandidateCheckoutRecords(strapi, existing);
    await deleteDocument(strapi, 'api::candidate.candidate', existing.documentId);
  }

  const data = {
    accountCreatedAt: existing?.accountCreatedAt || now,
    accountOnboardingCompletedAt: now,
    accountRestrictionAppealStatus: 'not_applicable',
    accountRestrictionStatus: 'active',
    authIdentityId: auth0User.userId,
    authProvider: 'auth0',
    candidateState: 'unenrolled',
    classAreaPreferences: preferenceSelection(content.area.slug),
    dateOfBirth: optionalEnv('HIREFLIP_E2E_CANDIDATE_DATE_OF_BIRTH', '1995-01-15'),
    email,
    firstName: optionalEnv('HIREFLIP_E2E_CANDIDATE_FIRST_NAME', 'E2E'),
    gender: 'prefer_not_to_say',
    lastName: optionalEnv('HIREFLIP_E2E_CANDIDATE_LAST_NAME', 'Candidate'),
    marketingConsentCapturedAt: now,
    marketingConsentState: 'opted_out',
    marketingConsentWordingVersion:
      optionalEnv('HIREFLIP_E2E_CANDIDATE_CONSENT_WORDING_VERSION', 'e2e-candidate-account-v1'),
    notificationPreferences: {
      channels: {
        email: true,
        phone: false,
        sms: false,
      },
      preferredCommunicationChannel: 'email',
    },
    phone: optionalEnv('HIREFLIP_E2E_CANDIDATE_PHONE', '+447700900123'),
    preferredCommunicationChannel: 'email',
    profileSettings: {
      accountOnboarding: {
        completedAt: now,
      },
    },
    recruitmentPlatformVisibility: 'visible',
    region: content.area.name,
    sector: content.sector.name,
    workSectorPreferences: preferenceSelection(content.sector.slug),
  };

  return documents(strapi, 'api::candidate.candidate').create({ data });
};

const ensureCandidatePrivacyExportRequest = async (strapi, candidate) => {
  const nowDate = new Date();
  const code = optionalEnv('HIREFLIP_E2E_PRIVACY_DOWNLOAD_CODE', '123456');
  const salt = optionalEnv('HIREFLIP_E2E_PRIVACY_DOWNLOAD_SALT', 'e2e-privacy-download-salt');
  const request = await documents(strapi, 'api::privacy-rights-request.privacy-rights-request').create({
    data: {
      candidate: connect(candidate),
      completedAt: isoDaysFrom(nowDate, -1),
      deletionJobStatus: 'not_required',
      downstreamProviderSyncStatus: 'not_required',
      dueAt: isoDaysFrom(nowDate, 30),
      identityVerificationStatus: 'pending',
      receivedAt: isoDaysFrom(nowDate, -2),
      requestState: 'completed',
      requestingUserId: candidate.authIdentityId,
      requestingUserType: 'candidate',
      requestType: 'access',
      subjectUserId: candidate.documentId,
      subjectUserType: 'candidate',
      metadata: {
        exportScope: 'personal',
        publicResponse:
          'Your E2E privacy export is ready. Use the seeded browser test code to download the PDF.',
        requesterMessage: 'E2E completed privacy export fixture for browser download coverage.',
      },
    },
  });
  const downloadChallenge = {
    actorId: candidate.authIdentityId || null,
    actorType: 'candidate',
    attempts: 0,
    codeHash: hashPrivacyDownloadCode({
      code,
      requestDocumentId: request.documentId,
      salt,
    }),
    expiresAt: isoDaysFrom(nowDate, 1),
    requestedAt: new Date().toISOString(),
    salt,
  };

  return documents(strapi, 'api::privacy-rights-request.privacy-rights-request').update({
    documentId: request.documentId,
    data: {
      metadata: {
        ...(request.metadata || {}),
        downloadChallenge,
      },
    },
  });
};

const ensureCandidateNotificationIssue = async (strapi, candidate) => {
  const nowDate = new Date();
  const eventType = optionalEnv(
    'HIREFLIP_E2E_NOTIFICATION_ISSUE_EVENT_TYPE',
    'candidate.e2e_notification_issue'
  );
  const templateKey = optionalEnv(
    'HIREFLIP_E2E_NOTIFICATION_ISSUE_TEMPLATE_KEY',
    'generic_branded_message'
  );
  const providerMessageId = optionalEnv(
    'HIREFLIP_E2E_NOTIFICATION_ISSUE_PROVIDER_MESSAGE_ID',
    'e2e-notification-provider-message'
  );
  const reason = optionalEnv(
    'HIREFLIP_E2E_NOTIFICATION_ISSUE_REASON',
    'E2E seeded provider bounce for notification issue browser coverage.'
  );

  await deleteMany(strapi, 'api::notification-event.notification-event', {
    eventType,
    recipientEmail: candidate.email,
  });

  await documents(strapi, 'api::candidate.candidate').update({
    documentId: candidate.documentId,
    data: {
      notificationPreferences: {
        ...(candidate.notificationPreferences || {}),
        emailDeliveryIssue: {
          detectedAt: isoDaysFrom(nowDate, -1),
          deliveryState: 'bounced',
          provider: 'sendgrid',
          providerMessageId,
          reason,
        },
      },
    },
  });

  return documents(strapi, 'api::notification-event.notification-event').create({
    data: {
      candidate: connect(candidate),
      channel: 'email',
      deliveryState: 'bounced',
      errorMessage: reason,
      eventType,
      failedAt: isoDaysFrom(nowDate, -1),
      metadata: {
        notificationServiceJobId: 'e2e-notification-job',
        providerDelivery: {
          deliveryState: 'bounced',
          event: 'bounce',
          notificationServiceJobId: 'e2e-notification-job',
          occurredAt: isoDaysFrom(nowDate, -1),
          provider: 'sendgrid',
          providerEventId: 'e2e-provider-event',
          providerMessageId,
          reason,
          source: 'e2e_fixture',
        },
        providerDeliveryHistory: [
          {
            deliveryState: 'processed',
            event: 'processed',
            notificationServiceJobId: 'e2e-notification-job',
            occurredAt: isoDaysFrom(nowDate, -1),
            provider: 'sendgrid',
            providerEventId: 'e2e-provider-processed',
            providerMessageId,
            reason: 'Message accepted by provider before seeded bounce.',
            source: 'e2e_fixture',
          },
          {
            deliveryState: 'bounced',
            event: 'bounce',
            notificationServiceJobId: 'e2e-notification-job',
            occurredAt: isoDaysFrom(nowDate, -1),
            provider: 'sendgrid',
            providerEventId: 'e2e-provider-bounce',
            providerMessageId,
            reason,
            source: 'e2e_fixture',
          },
        ],
      },
      priority: 'high',
      provider: 'sendgrid',
      providerMessageId,
      recipientEmail: candidate.email,
      recipientId: candidate.documentId,
      recipientType: 'candidate',
      relatedId: candidate.documentId,
      relatedType: 'candidate',
      templateKey,
    },
  });
};

const resetCandidateInterviewRecords = async (strapi, candidate) => {
  if (!candidate?.documentId) {
    return;
  }

  const candidateFilter = { candidate: { documentId: candidate.documentId } };
  const interviews = await documents(strapi, 'api::interview.interview').findMany({
    filters: candidateFilter,
    limit: 100,
  });
  const interviewIds = interviews.map((interview) => interview.documentId).filter(Boolean);

  for (const interviewDocumentId of interviewIds) {
    await deleteMany(strapi, 'api::interview-feedback.interview-feedback', {
      interview: { documentId: interviewDocumentId },
    });
    await deleteMany(strapi, 'api::interview-feedback-invite.interview-feedback-invite', {
      interview: { documentId: interviewDocumentId },
    });
    await deleteMany(strapi, 'api::offer.offer', {
      interview: { documentId: interviewDocumentId },
    });
  }

  const slotOffers = await documents(strapi, 'api::interview-slot-offer.interview-slot-offer').findMany({
    filters: candidateFilter,
    limit: 100,
  });

  for (const offer of slotOffers) {
    await deleteMany(strapi, 'api::interview-slot.interview-slot', {
      slotOffer: { documentId: offer.documentId },
    });
  }

  await deleteMany(strapi, 'api::interview-slot-offer.interview-slot-offer', candidateFilter);
  await deleteMany(strapi, 'api::candidate-interview-strike.candidate-interview-strike', candidateFilter);
  await deleteMany(strapi, 'api::interview.interview', candidateFilter);
  await deleteMany(strapi, 'api::employer-capacity-claim.employer-capacity-claim', {
    interviewRequest: candidateFilter,
  });
  await deleteMany(strapi, 'api::interview-request.interview-request', candidateFilter);
  await deleteMany(strapi, 'api::candidate-profile.candidate-profile', candidateFilter);
  await deleteMany(strapi, 'api::enrollment.enrollment', candidateFilter);
};

const ensureInterviewCandidate = async (strapi, auth0User, content, employerContext, options = {}) => {
  const email = normalizeEmail(
    options.email ||
      optionalEnv('HIREFLIP_E2E_INTERVIEW_CANDIDATE_EMAIL', 'e2e-interview-candidate@hireflip.work')
  );
  const feedbackInviteEmail = normalizeEmail(
    options.feedbackInviteEmail ||
      optionalEnv('HIREFLIP_E2E_FEEDBACK_INVITE_EMAIL', 'e2e-feedback-attendee@hireflip.work')
  );
  const feedbackInviteToken =
    options.feedbackInviteToken ||
    optionalEnv('HIREFLIP_E2E_FEEDBACK_INVITE_TOKEN', 'e2e-feedback-invite-token');
  const firstName = options.firstName || optionalEnv('HIREFLIP_E2E_INTERVIEW_CANDIDATE_FIRST_NAME', 'E2E');
  const lastName =
    options.lastName || optionalEnv('HIREFLIP_E2E_INTERVIEW_CANDIDATE_LAST_NAME', 'Interview Candidate');
  const phone = options.phone || optionalEnv('HIREFLIP_E2E_INTERVIEW_CANDIDATE_PHONE', '+447700900124');
  const dateOfBirth =
    options.dateOfBirth || optionalEnv('HIREFLIP_E2E_INTERVIEW_CANDIDATE_DATE_OF_BIRTH', '1996-02-20');
  const assignmentNote = options.assignmentNote || 'E2E browser fixture active slot offer.';
  const includeHistory = options.includeHistory !== false;
  const nowDate = new Date();
  const now = nowDate.toISOString();
  const existing =
    (await findFirst(strapi, 'api::candidate.candidate', { email })) ||
    (await findFirst(strapi, 'api::candidate.candidate', { authIdentityId: auth0User.userId }));

  if (existing?.documentId) {
    await resetCandidateInterviewRecords(strapi, existing);
    await deleteDocument(strapi, 'api::candidate.candidate', existing.documentId);
  }

  const candidate = await documents(strapi, 'api::candidate.candidate').create({
    data: {
      accountCreatedAt: existing?.accountCreatedAt || now,
      accountOnboardingCompletedAt: now,
      accountRestrictionAppealStatus: 'not_applicable',
      accountRestrictionStatus: 'active',
      authIdentityId: auth0User.userId,
      authProvider: 'auth0',
      candidateState: 'interview_phase',
      classAreaPreferences: preferenceSelection(content.area.slug),
      dateOfBirth,
      email,
      firstName,
      gender: 'prefer_not_to_say',
      lastName,
      marketingConsentCapturedAt: now,
      marketingConsentState: 'opted_out',
      marketingConsentWordingVersion:
        optionalEnv('HIREFLIP_E2E_CANDIDATE_CONSENT_WORDING_VERSION', 'e2e-candidate-account-v1'),
      notificationPreferences: {
        channels: {
          email: true,
          phone: false,
          sms: false,
        },
        preferredCommunicationChannel: 'email',
      },
      phone,
      preferredCommunicationChannel: 'email',
      profileSettings: {
        accountOnboarding: {
          completedAt: now,
        },
      },
      recruitmentPlatformVisibility: 'visible',
      region: content.area.name,
      sector: content.sector.name,
      workSectorPreferences: preferenceSelection(content.sector.slug),
    },
  });

  const enrollment = await documents(strapi, 'api::enrollment.enrollment').create({
    data: {
      beganClassAt: isoDaysFrom(nowDate, -45),
      candidate: connect(candidate),
      class: connect(content.classRecord),
      completedAt: isoDaysFrom(nowDate, -5),
      completionStatus: 'completed',
      enrolledAt: isoDaysFrom(nowDate, -50),
      enrollmentState: 'interview_phase',
      interviewGuaranteeDeadline: isoDaysFrom(nowDate, 45),
      interviewGuaranteeWindowStartsAt: isoDaysFrom(nowDate, -5),
      passStatus: 'passed',
      passedAt: isoDaysFrom(nowDate, -5),
      paymentStatus: 'paid',
      qualifyingInterviewsDeliveredCount: 1,
      refundEligibilityState: 'not_assessed',
    },
  });

  await documents(strapi, 'api::candidate-profile.candidate-profile').create({
    data: {
      availability: 'Unavailable only on the seeded dates listed for browser testing.',
      availabilityConfirmedAt: isoDaysFrom(nowDate, -1),
      availabilityExpiresAt: isoDaysFrom(nowDate, 29),
      candidate: connect(candidate),
      completedAt: isoDaysFrom(nowDate, -1),
      education: [
        {
          end: {
            month: 6,
            year: 2024,
          },
          institution: 'E2E College',
          level: 'Foundation',
          notes: 'Seeded profile history for browser readiness tests.',
          qualification: 'Marketing Foundation',
          start: {
            month: 9,
            year: 2022,
          },
          subject: 'Marketing',
        },
      ],
      experience: [],
      interviewFormatPreference: 'no_preference',
      location: content.area.name,
      preferredWorkStyle: 'hybrid',
      profileState: 'completed',
      projects: [],
      readinessOverviewAcknowledgedAt: isoDaysFrom(nowDate, -1),
      recruitmentPlatformVisibility: 'visible',
      recruitmentVisibilityWordingVersion: 'e2e-recruitment-visibility-v1',
      skills: {
        strengths: ['Communication', 'Organisation', 'Customer research'],
      },
      summary:
        'I believe I would make a great employee in the marketing space because I communicate clearly, prepare thoroughly, and use feedback to improve how I work with customers and teams.',
      targetRoleTitle: 'Entry-level marketing assistant',
      targetRoleType: 'full_time',
      targetSector: content.sector.slug,
      targetSectorLabel: content.sector.name,
      unavailableDates: [],
      visibilityUpdatedAt: isoDaysFrom(nowDate, -1),
    },
  });

  const interviewRequest = await documents(strapi, 'api::interview-request.interview-request').create({
    data: {
      candidate: connect(candidate),
      candidateVisibleState: 'reviewing_options',
      claimedInterviewCount: 2,
      class: connect(content.classRecord),
      employerResponseDeadline: isoDaysFrom(nowDate, 2),
      enrollment: connect(enrollment),
      fulfilledInterviewCount: 1,
      lastRoutedAt: isoDaysFrom(nowDate, -1),
      region: connect(content.area),
      requestedInterviewCount: 2,
      requestState: 'candidate_reviewing',
      responseSlaWorkingDays: 2,
    },
  });

  const capacityClaim = await documents(strapi, 'api::employer-capacity-claim.employer-capacity-claim').create({
    data: {
      acceptedAt: isoDaysFrom(nowDate, -1),
      assignmentNote,
      claimCount: 1,
      claimState: 'fulfilled',
      employer: connect(employerContext.employer),
      employerContact: connect(employerContext.contact),
      expiresAt: isoDaysFrom(nowDate, 2),
      fulfilledAt: isoDaysFrom(nowDate, -1),
      interviewRequest: connect(interviewRequest),
      notifiedAt: isoDaysFrom(nowDate, -1),
      region: connect(content.area),
      requiredSlotCount: 3,
    },
  });

  const activeOffer = await documents(strapi, 'api::interview-slot-offer.interview-slot-offer').create({
    data: {
      candidate: connect(candidate),
      candidateNotifiedAt: isoDaysFrom(nowDate, -1),
      candidateResponseDeadline: isoDaysFrom(nowDate, 2),
      candidateWarningState: 'none',
      capacityClaim: connect(capacityClaim),
      employer: connect(employerContext.employer),
      employerContact: connect(employerContext.contact),
      enrollment: connect(enrollment),
      interviewRequest: connect(interviewRequest),
      offerState: 'sent',
      requiredSlotCount: 3,
    },
  });

  for (const [index, locationType] of ['in_person', 'online', 'in_person'].entries()) {
    await documents(strapi, 'api::interview-slot.interview-slot').create({
      data: {
        capacity: 1,
        employer: connect(employerContext.employer),
        employerContact: connect(employerContext.contact),
        endTime: isoDaysHoursFrom(nowDate, 8 + index, 1),
        locationDetails: locationType === 'in_person' ? 'E2E Employer Office' : '',
        locationType,
        meetingUrl: locationType === 'online' ? 'https://meet.example.test/e2e-interview' : '',
        region: connect(content.area),
        slotOffer: connect(activeOffer),
        slotState: 'offered',
        startTime: isoDaysFrom(nowDate, 8 + index),
        workSector: connect(content.sector),
      },
    });
  }

  if (!includeHistory) {
    return {
      activeOffer,
      candidate,
    };
  }

  const pendingSlot = await documents(strapi, 'api::interview-slot.interview-slot').create({
    data: {
      capacity: 1,
      employer: connect(employerContext.employer),
      employerContact: connect(employerContext.contact),
      endTime: isoDaysHoursFrom(nowDate, 6, 1),
      locationType: 'to_be_confirmed',
      region: connect(content.area),
      slotState: 'booked',
      startTime: isoDaysFrom(nowDate, 6),
      workSector: connect(content.sector),
    },
  });
  const pendingInterview = await documents(strapi, 'api::interview.interview').create({
    data: {
      candidate: connect(candidate),
      countsTowardGuarantee: false,
      employer: connect(employerContext.employer),
      employerContact: connect(employerContext.contact),
      employerDetailsDueAt: isoDaysFrom(nowDate, -1),
      employerDetailsReleaseEligibleAt: isoDaysFrom(nowDate, 1),
      enrollment: connect(enrollment),
      interviewSlot: connect(pendingSlot),
      interviewState: 'awaiting_employer_details',
      locationType: 'to_be_confirmed',
      scheduledEndTime: isoDaysHoursFrom(nowDate, 6, 1),
      scheduledStartTime: isoDaysFrom(nowDate, 6),
    },
  });
  await documents(strapi, 'api::interview-slot-offer.interview-slot-offer').create({
    data: {
      candidate: connect(candidate),
      candidateInterviewFormatPreference: 'in_person',
      candidateRespondedAt: isoDaysFrom(nowDate, -1),
      candidateResponseDeadline: isoDaysFrom(nowDate, -1),
      capacityClaim: connect(capacityClaim),
      employer: connect(employerContext.employer),
      employerContact: connect(employerContext.contact),
      enrollment: connect(enrollment),
      interviewRequest: connect(interviewRequest),
      offerState: 'candidate_selected',
      requiredSlotCount: 3,
      selectedInterview: connect(pendingInterview),
      selectedSlot: connect(pendingSlot),
    },
  });

  const completedSlot = await documents(strapi, 'api::interview-slot.interview-slot').create({
    data: {
      capacity: 1,
      employer: connect(employerContext.employer),
      employerContact: connect(employerContext.contact),
      endTime: isoDaysHoursFrom(nowDate, -2, 1),
      locationDetails: 'E2E Employer Office',
      locationType: 'in_person',
      region: connect(content.area),
      slotState: 'completed',
      startTime: isoDaysFrom(nowDate, -2),
      workSector: connect(content.sector),
    },
  });
  const completedInterview = await documents(strapi, 'api::interview.interview').create({
    data: {
      arrivalInstructions: 'Report to reception for the E2E interview.',
      candidate: connect(candidate),
      candidateInstructions: 'Bring a notebook and ID.',
      completedAt: isoDaysFrom(nowDate, -2),
      countsTowardGuarantee: true,
      detailsProvidedAt: isoDaysFrom(nowDate, -4),
      employer: connect(employerContext.employer),
      employerContact: connect(employerContext.contact),
      enrollment: connect(enrollment),
      feedbackDueAt: isoDaysFrom(nowDate, -1),
      feedbackOverdueDetectedAt: isoDaysFrom(nowDate, -1),
      interviewSlot: connect(completedSlot),
      interviewerName: 'E2E Interviewer',
      interviewState: 'completed',
      locationDetails: 'E2E Employer Office',
      locationType: 'in_person',
      scheduledEndTime: isoDaysHoursFrom(nowDate, -2, 1),
      scheduledStartTime: isoDaysFrom(nowDate, -2),
    },
  });
  await documents(strapi, 'api::interview-slot-offer.interview-slot-offer').create({
    data: {
      candidate: connect(candidate),
      candidateInterviewFormatPreference: 'in_person',
      candidateRespondedAt: isoDaysFrom(nowDate, -4),
      candidateResponseDeadline: isoDaysFrom(nowDate, -4),
      capacityClaim: connect(capacityClaim),
      employer: connect(employerContext.employer),
      employerContact: connect(employerContext.contact),
      enrollment: connect(enrollment),
      interviewRequest: connect(interviewRequest),
      offerState: 'completed',
      requiredSlotCount: 3,
      selectedInterview: connect(completedInterview),
      selectedSlot: connect(completedSlot),
    },
  });

  await documents(strapi, 'api::interview-feedback-invite.interview-feedback-invite').create({
    data: {
      createdByEmployerContact: connect(employerContext.contact),
      deliveryState: 'not_required',
      employer: connect(employerContext.employer),
      expiresAt: isoDaysFrom(nowDate, 5),
      interview: connect(completedInterview),
      inviteEmail: feedbackInviteEmail,
      inviteState: 'pending',
      inviteeName: 'E2E Feedback Attendee',
      inviteeRoleTitle: 'Panel interviewer',
      metadata: {
        source: 'e2e_fixture_public_feedback_invite',
      },
      tokenHash: hashInviteToken(feedbackInviteToken),
    },
  });

  return {
    candidate,
    completedInterview,
    pendingInterview,
  };
};

const ensureEmployerAvailabilityClaim = async (strapi, content, employerContext) => {
  const email = normalizeEmail(
    optionalEnv('HIREFLIP_E2E_AVAILABILITY_CANDIDATE_EMAIL', 'e2e-availability-candidate@hireflip.work')
  );
  const nowDate = new Date();
  const now = nowDate.toISOString();
  const existing = await findFirst(strapi, 'api::candidate.candidate', { email });

  if (existing?.documentId) {
    await resetCandidateInterviewRecords(strapi, existing);
    await deleteDocument(strapi, 'api::candidate.candidate', existing.documentId);
  }

  const candidate = await documents(strapi, 'api::candidate.candidate').create({
    data: {
      accountCreatedAt: existing?.accountCreatedAt || now,
      accountOnboardingCompletedAt: now,
      accountRestrictionAppealStatus: 'not_applicable',
      accountRestrictionStatus: 'active',
      authProvider: 'manual',
      candidateState: 'interview_phase',
      classAreaPreferences: preferenceSelection(content.area.slug),
      dateOfBirth: '1997-03-10',
      email,
      firstName: 'E2E',
      gender: 'prefer_not_to_say',
      lastName: 'Availability Candidate',
      marketingConsentCapturedAt: now,
      marketingConsentState: 'opted_out',
      marketingConsentWordingVersion: 'e2e-candidate-account-v1',
      notificationPreferences: {
        channels: {
          email: true,
          phone: false,
          sms: false,
        },
        preferredCommunicationChannel: 'email',
      },
      phone: '+447700900126',
      preferredCommunicationChannel: 'email',
      profileSettings: {
        accountOnboarding: {
          completedAt: now,
        },
      },
      recruitmentPlatformVisibility: 'visible',
      region: content.area.name,
      sector: content.sector.name,
      workSectorPreferences: preferenceSelection(content.sector.slug),
    },
  });

  const enrollment = await documents(strapi, 'api::enrollment.enrollment').create({
    data: {
      beganClassAt: isoDaysFrom(nowDate, -40),
      candidate: connect(candidate),
      class: connect(content.classRecord),
      completedAt: isoDaysFrom(nowDate, -4),
      completionStatus: 'completed',
      enrolledAt: isoDaysFrom(nowDate, -45),
      enrollmentState: 'interview_phase',
      interviewGuaranteeDeadline: isoDaysFrom(nowDate, 50),
      interviewGuaranteeWindowStartsAt: isoDaysFrom(nowDate, -4),
      passStatus: 'passed',
      passedAt: isoDaysFrom(nowDate, -4),
      paymentStatus: 'paid',
      qualifyingInterviewsDeliveredCount: 0,
      refundEligibilityState: 'not_assessed',
    },
  });

  const interviewRequest = await documents(strapi, 'api::interview-request.interview-request').create({
    data: {
      candidate: connect(candidate),
      candidateVisibleState: 'arranging_interviews',
      claimedInterviewCount: 1,
      class: connect(content.classRecord),
      employerResponseDeadline: isoDaysFrom(nowDate, 2),
      enrollment: connect(enrollment),
      fulfilledInterviewCount: 0,
      lastRoutedAt: isoDaysFrom(nowDate, -1),
      region: connect(content.area),
      requestedInterviewCount: 2,
      requestState: 'employer_notified',
      responseSlaWorkingDays: 2,
    },
  });

  const capacityClaim = await documents(strapi, 'api::employer-capacity-claim.employer-capacity-claim').create({
    data: {
      assignmentNote: 'E2E browser fixture open employer availability claim.',
      claimCount: 1,
      claimState: 'notified',
      employer: connect(employerContext.employer),
      employerContact: connect(employerContext.contact),
      expiresAt: isoDaysFrom(nowDate, 2),
      interviewRequest: connect(interviewRequest),
      notifiedAt: isoDaysFrom(nowDate, -1),
      region: connect(content.area),
      requiredSlotCount: 3,
    },
  });

  return {
    candidate,
    capacityClaim,
    enrollment,
    interviewRequest,
  };
};

const ensureEmployer = async (strapi, auth0User, content) => {
  const email = normalizeEmail(requireEnv('HIREFLIP_E2E_EMPLOYER_EMAIL'));
  const e2eTeamContactEmail = normalizeEmail(
    optionalEnv('HIREFLIP_E2E_EMPLOYER_TEAM_CONTACT_EMAIL', 'e2e-team-contact@hireflip.work')
  );
  const e2eAdminEmployerInviteEmail = normalizeEmail(
    optionalEnv('HIREFLIP_E2E_ADMIN_EMPLOYER_INVITE_EMAIL', 'e2e-admin-employer-invite@hireflip.work')
  );
  const e2eAdminEmployerInviteCompany = optionalEnv(
    'HIREFLIP_E2E_ADMIN_EMPLOYER_INVITE_COMPANY',
    'HireFlip E2E Admin Invite Employer'
  );
  const now = new Date().toISOString();
  const companyName = optionalEnv('HIREFLIP_E2E_EMPLOYER_COMPANY', 'HireFlip E2E Employer');

  await deleteMany(strapi, 'api::employer-invite.employer-invite', {
    inviteEmail: e2eAdminEmployerInviteEmail,
  });
  await deleteMany(strapi, 'api::employer-contact.employer-contact', {
    email: e2eAdminEmployerInviteEmail,
  });
  const staleAdminInviteEmployers = await documents(strapi, 'api::employer.employer').findMany({
    filters: {
      companyName: e2eAdminEmployerInviteCompany,
    },
    limit: 100,
  });

  for (const staleEmployer of staleAdminInviteEmployers) {
    await deleteMany(strapi, 'api::employer-region-commitment.employer-region-commitment', {
      employer: { documentId: staleEmployer.documentId },
    });
    await deleteDocument(strapi, 'api::employer.employer', staleEmployer.documentId);
  }

  const existingEmployer = await findFirst(strapi, 'api::employer.employer', { companyName }, [
    'operatingRegions',
  ]);
  const employerData = {
    assignmentMode: 'automatic',
    commitmentMode: 'global',
    companyName,
    dashboardOnboardingCompletedAt: now,
    dashboardOnboardingState: 'complete',
    employerState: 'active',
    employerTermsAcceptedAt: now,
    employerTermsAcceptedByEmail: email,
    employerTermsPolicyVersion: 'e2e-employer-terms-v1',
    initialInterviewCommitmentCadence: 'quarterly',
    initialInterviewCommitmentVolume: 6,
    interviewCommitmentCadence: 'quarterly',
    interviewCommitmentVolume: 6,
    operatingRegions: connect(content.area),
    region: content.area.name,
    salesOwnerStaffEmail: normalizeEmail(requireEnv('HIREFLIP_E2E_ADMIN_EMAIL')),
    salesOwnerStaffDisplayName: 'E2E Admin',
  };
  const employer = existingEmployer?.documentId
    ? await documents(strapi, 'api::employer.employer').update({
        documentId: existingEmployer.documentId,
        data: employerData,
        populate: ['operatingRegions'],
      })
    : await documents(strapi, 'api::employer.employer').create({
        data: employerData,
        populate: ['operatingRegions'],
      });

  await deleteMany(strapi, 'api::employer-invite.employer-invite', {
    inviteEmail: e2eTeamContactEmail,
  });
  await deleteMany(strapi, 'api::employer-contact.employer-contact', {
    email: e2eTeamContactEmail,
  });

  const existingContact =
    (await findFirst(strapi, 'api::employer-contact.employer-contact', { email })) ||
    (await findFirst(strapi, 'api::employer-contact.employer-contact', {
      authIdentityId: auth0User.userId,
    }));
  const contactData = {
    accountCreatedAt: now,
    authIdentityId: auth0User.userId,
    authProvider: 'auth0',
    contactRole: 'lead_contact',
    contactState: 'active',
    coverageConfirmedAt: now,
    coverageConfirmedByEmail: email,
    coverageRegions: connect(content.area),
    email,
    employer: connect(employer),
    firstName: optionalEnv('HIREFLIP_E2E_EMPLOYER_FIRST_NAME', 'E2E'),
    lastName: optionalEnv('HIREFLIP_E2E_EMPLOYER_LAST_NAME', 'Employer'),
    notificationPreferences: {
      channels: {
        email: true,
      },
    },
    roleTitle: 'Lead contact',
  };
  const contact = existingContact?.documentId
    ? await documents(strapi, 'api::employer-contact.employer-contact').update({
        documentId: existingContact.documentId,
        data: contactData,
        populate: ['coverageRegions', 'employer'],
      })
    : await documents(strapi, 'api::employer-contact.employer-contact').create({
        data: contactData,
        populate: ['coverageRegions', 'employer'],
      });

  const existingCommitment = await findFirst(
    strapi,
    'api::employer-region-commitment.employer-region-commitment',
    {
      employer: { documentId: employer.documentId },
      region: { documentId: content.area.documentId },
    }
  );
  const commitmentData = {
    commitmentState: 'active',
    effectiveFrom: now,
    employer: connect(employer),
    interviewCommitmentCadence: 'quarterly',
    interviewCommitmentVolume: 6,
    region: connect(content.area),
    updatedByEmployerContactEmail: email,
  };

  if (existingCommitment?.documentId) {
    await documents(strapi, 'api::employer-region-commitment.employer-region-commitment').update({
      documentId: existingCommitment.documentId,
      data: commitmentData,
    });
  } else {
    await documents(strapi, 'api::employer-region-commitment.employer-region-commitment').create({
      data: commitmentData,
    });
  }

  return {
    contact,
    employer,
  };
};

const ensureAdminActionEmployer = async (strapi, content) => {
  const now = new Date().toISOString();
  const companyName = optionalEnv(
    'HIREFLIP_E2E_ADMIN_ACTION_EMPLOYER_COMPANY',
    'HireFlip E2E Admin Action Employer'
  );
  const contactEmail = normalizeEmail(
    optionalEnv('HIREFLIP_E2E_ADMIN_ACTION_EMPLOYER_EMAIL', 'e2e-admin-action-employer@hireflip.work')
  );
  const staleEmployers = await documents(strapi, 'api::employer.employer').findMany({
    filters: {
      companyName,
    },
    limit: 100,
  });

  for (const staleEmployer of staleEmployers) {
    await deleteMany(strapi, 'api::employer-invite.employer-invite', {
      employer: { documentId: staleEmployer.documentId },
    });
    await deleteMany(strapi, 'api::employer-contact.employer-contact', {
      employer: { documentId: staleEmployer.documentId },
    });
    await deleteMany(strapi, 'api::employer-region-commitment.employer-region-commitment', {
      employer: { documentId: staleEmployer.documentId },
    });
    await deleteDocument(strapi, 'api::employer.employer', staleEmployer.documentId);
  }

  await deleteMany(strapi, 'api::employer-contact.employer-contact', {
    email: contactEmail,
  });

  const employer = await documents(strapi, 'api::employer.employer').create({
    data: {
      assignmentMode: 'automatic',
      commitmentMode: 'global',
      companyName,
      dashboardOnboardingCompletedAt: now,
      dashboardOnboardingState: 'complete',
      employerState: 'active',
      employerTermsAcceptedAt: now,
      employerTermsAcceptedByEmail: contactEmail,
      employerTermsPolicyVersion: 'e2e-employer-terms-v1',
      initialInterviewCommitmentCadence: 'quarterly',
      initialInterviewCommitmentVolume: 6,
      interviewCommitmentCadence: 'quarterly',
      interviewCommitmentVolume: 6,
      operatingRegions: connectMany([content.area, content.coverageGapArea]),
      region: content.area.name,
      salesOwnerStaffEmail: normalizeEmail(requireEnv('HIREFLIP_E2E_ADMIN_EMAIL')),
      salesOwnerStaffDisplayName: 'E2E Admin',
    },
    populate: ['operatingRegions'],
  });

  const contact = await documents(strapi, 'api::employer-contact.employer-contact').create({
    data: {
      accountCreatedAt: now,
      authProvider: 'auth0',
      contactRole: 'lead_contact',
      contactState: 'active',
      coverageConfirmedAt: now,
      coverageConfirmedByEmail: contactEmail,
      coverageRegions: connect(content.area),
      email: contactEmail,
      employer: connect(employer),
      firstName: 'E2E',
      lastName: 'Action Employer',
      notificationPreferences: {
        channels: {
          email: true,
        },
      },
      roleTitle: 'Lead contact',
    },
    populate: ['coverageRegions', 'employer'],
  });

  for (const region of [content.area, content.coverageGapArea]) {
    await documents(strapi, 'api::employer-region-commitment.employer-region-commitment').create({
      data: {
        commitmentState: 'active',
        effectiveFrom: now,
        employer: connect(employer),
        interviewCommitmentCadence: 'quarterly',
        interviewCommitmentVolume: 3,
        region: connect(region),
        updatedByEmployerContactEmail: contactEmail,
      },
    });
  }

  return {
    contact,
    employer,
  };
};

const main = async () => {
  const appContext = await compileStrapi();
  const strapi = await createStrapi(appContext).load();

  try {
    const content = await ensureContent(strapi);
    const staffUser = await ensureStaffUser(strapi);
    const candidateAuth0User = await ensureAuth0User({
      connectionName: requireEnv('AUTH0_CANDIDATE_CONNECTION_NAME'),
      email: requireEnv('HIREFLIP_E2E_CANDIDATE_EMAIL'),
      firstName: optionalEnv('HIREFLIP_E2E_CANDIDATE_FIRST_NAME', 'E2E'),
      lastName: optionalEnv('HIREFLIP_E2E_CANDIDATE_LAST_NAME', 'Candidate'),
      password: requireEnv('HIREFLIP_E2E_CANDIDATE_PASSWORD'),
    });
    const interviewCandidateAuth0User = await ensureAuth0User({
      connectionName: requireEnv('AUTH0_CANDIDATE_CONNECTION_NAME'),
      email: optionalEnv('HIREFLIP_E2E_INTERVIEW_CANDIDATE_EMAIL', 'e2e-interview-candidate@hireflip.work'),
      firstName: optionalEnv('HIREFLIP_E2E_INTERVIEW_CANDIDATE_FIRST_NAME', 'E2E'),
      lastName: optionalEnv('HIREFLIP_E2E_INTERVIEW_CANDIDATE_LAST_NAME', 'Interview Candidate'),
      password: optionalEnv('HIREFLIP_E2E_INTERVIEW_CANDIDATE_PASSWORD', requireEnv('HIREFLIP_E2E_CANDIDATE_PASSWORD')),
    });
    const declineCandidateEmail = optionalEnv(
      'HIREFLIP_E2E_DECLINE_CANDIDATE_EMAIL',
      'e2e-decline-candidate@hireflip.work'
    );
    const declineCandidateAuth0User = await ensureAuth0User({
      connectionName: requireEnv('AUTH0_CANDIDATE_CONNECTION_NAME'),
      email: declineCandidateEmail,
      firstName: optionalEnv('HIREFLIP_E2E_DECLINE_CANDIDATE_FIRST_NAME', 'E2E'),
      lastName: optionalEnv('HIREFLIP_E2E_DECLINE_CANDIDATE_LAST_NAME', 'Decline Candidate'),
      password: optionalEnv('HIREFLIP_E2E_DECLINE_CANDIDATE_PASSWORD', requireEnv('HIREFLIP_E2E_CANDIDATE_PASSWORD')),
    });
    const employerAuth0User = await ensureAuth0User({
      connectionName: requireEnv('AUTH0_EMPLOYER_CONNECTION_NAME'),
      email: requireEnv('HIREFLIP_E2E_EMPLOYER_EMAIL'),
      firstName: optionalEnv('HIREFLIP_E2E_EMPLOYER_FIRST_NAME', 'E2E'),
      lastName: optionalEnv('HIREFLIP_E2E_EMPLOYER_LAST_NAME', 'Employer'),
      password: requireEnv('HIREFLIP_E2E_EMPLOYER_PASSWORD'),
    });
    const candidate = await ensureCandidate(strapi, candidateAuth0User, content);
    const employer = await ensureEmployer(strapi, employerAuth0User, content);
    const adminActionEmployer = await ensureAdminActionEmployer(strapi, content);
    const candidatePrivacyExportRequest = await ensureCandidatePrivacyExportRequest(strapi, candidate);
    const candidateNotificationIssue = await ensureCandidateNotificationIssue(strapi, candidate);
    const interviewCandidate = await ensureInterviewCandidate(
      strapi,
      interviewCandidateAuth0User,
      content,
      employer
    );
    const declineCandidate = await ensureInterviewCandidate(
      strapi,
      declineCandidateAuth0User,
      content,
      employer,
      {
        assignmentNote: 'E2E browser fixture decline-all slot offer.',
        email: declineCandidateEmail,
        firstName: optionalEnv('HIREFLIP_E2E_DECLINE_CANDIDATE_FIRST_NAME', 'E2E'),
        includeHistory: false,
        lastName: optionalEnv('HIREFLIP_E2E_DECLINE_CANDIDATE_LAST_NAME', 'Decline Candidate'),
        phone: optionalEnv('HIREFLIP_E2E_DECLINE_CANDIDATE_PHONE', '+447700900125'),
      }
    );
    const availabilityClaim = await ensureEmployerAvailabilityClaim(strapi, content, employer);

    strapi.log.info(
      `E2E fixtures ready: ${JSON.stringify({
        admin: { email: staffUser.email, roleKey: staffUser.roleKey },
        candidate: { documentId: candidate.documentId, email: candidate.email },
        candidatePrivacyExportRequest: {
          documentId: candidatePrivacyExportRequest.documentId,
        },
        candidateNotificationIssue: {
          documentId: candidateNotificationIssue.documentId,
          eventType: candidateNotificationIssue.eventType,
        },
        interviewCandidate: {
          documentId: interviewCandidate.candidate.documentId,
          email: interviewCandidate.candidate.email,
        },
        declineCandidate: {
          documentId: declineCandidate.candidate.documentId,
          email: declineCandidate.candidate.email,
        },
        availabilityClaim: {
          candidateEmail: availabilityClaim.candidate.email,
          documentId: availabilityClaim.capacityClaim.documentId,
        },
        class: {
          documentId: content.classRecord.documentId,
          title: content.classRecord.displayTitle,
        },
        employer: {
          contactDocumentId: employer.contact.documentId,
          documentId: employer.employer.documentId,
          email: employer.contact.email,
        },
        adminActionEmployer: {
          contactDocumentId: adminActionEmployer.contact.documentId,
          documentId: adminActionEmployer.employer.documentId,
          email: adminActionEmployer.contact.email,
        },
      })}`
    );
  } finally {
    await strapi.destroy();
  }
};

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

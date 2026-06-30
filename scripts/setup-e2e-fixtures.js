#!/usr/bin/env node

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

const connect = (record) => ({ connect: [{ documentId: record.documentId }] });

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
  const sectorSlug = safeSlug(optionalEnv('HIREFLIP_E2E_WORK_SECTOR_SLUG', 'e2e-marketing'));
  const classSlug = safeSlug(optionalEnv('HIREFLIP_E2E_CLASS_SLUG', 'hireflip-e2e-checkout-class'));
  const year = Math.max(2026, new Date().getUTCFullYear());
  const area = await upsertBySlug(strapi, 'api::class-area.class-area', areaSlug, {
    country: 'United Kingdom',
    name: optionalEnv('HIREFLIP_E2E_CLASS_AREA_NAME', 'E2E London'),
    slug: areaSlug,
    state: 'active',
  });
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

const ensureCandidate = async (strapi, auth0User, content) => {
  const email = normalizeEmail(requireEnv('HIREFLIP_E2E_CANDIDATE_EMAIL'));
  const now = new Date().toISOString();
  const existing =
    (await findFirst(strapi, 'api::candidate.candidate', { email })) ||
    (await findFirst(strapi, 'api::candidate.candidate', { authIdentityId: auth0User.userId }));

  await resetCandidateCheckoutRecords(strapi, existing);

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

  if (existing?.documentId) {
    return documents(strapi, 'api::candidate.candidate').update({
      documentId: existing.documentId,
      data,
    });
  }

  return documents(strapi, 'api::candidate.candidate').create({ data });
};

const ensureEmployer = async (strapi, auth0User, content) => {
  const email = normalizeEmail(requireEnv('HIREFLIP_E2E_EMPLOYER_EMAIL'));
  const now = new Date().toISOString();
  const companyName = optionalEnv('HIREFLIP_E2E_EMPLOYER_COMPANY', 'HireFlip E2E Employer');
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
    const employerAuth0User = await ensureAuth0User({
      connectionName: requireEnv('AUTH0_EMPLOYER_CONNECTION_NAME'),
      email: requireEnv('HIREFLIP_E2E_EMPLOYER_EMAIL'),
      firstName: optionalEnv('HIREFLIP_E2E_EMPLOYER_FIRST_NAME', 'E2E'),
      lastName: optionalEnv('HIREFLIP_E2E_EMPLOYER_LAST_NAME', 'Employer'),
      password: requireEnv('HIREFLIP_E2E_EMPLOYER_PASSWORD'),
    });
    const candidate = await ensureCandidate(strapi, candidateAuth0User, content);
    const employer = await ensureEmployer(strapi, employerAuth0User, content);

    strapi.log.info(
      `E2E fixtures ready: ${JSON.stringify({
        admin: { email: staffUser.email, roleKey: staffUser.roleKey },
        candidate: { documentId: candidate.documentId, email: candidate.email },
        class: {
          documentId: content.classRecord.documentId,
          title: content.classRecord.displayTitle,
        },
        employer: {
          contactDocumentId: employer.contact.documentId,
          documentId: employer.employer.documentId,
          email: employer.contact.email,
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

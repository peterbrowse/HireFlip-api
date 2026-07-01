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

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

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

const addMinutes = (date, minutes) => {
  const next = new Date(date.getTime());
  next.setUTCMinutes(next.getUTCMinutes() + minutes);
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

const auth0RetryDelayMs = (response, attempt) => {
  const retryAfter = Number(response.headers.get('retry-after'));

  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter * 1000, 60_000);
  }

  return Math.min(2_000 * 2 ** attempt, 30_000);
};

const getManagementToken = async (config) => {
  if (cachedManagementToken?.expiresAt > Date.now() + 60_000) {
    return cachedManagementToken.accessToken;
  }

  let response = null;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    response = await fetch(`https://${config.domain}/oauth/token`, {
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

    if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 5) {
      break;
    }

    await sleep(auth0RetryDelayMs(response, attempt));
  }

  const payload = await parseAuth0Response(response, 'Auth0 Management token request failed.');

  cachedManagementToken = {
    accessToken: payload.access_token,
    expiresAt: Date.now() + Math.max(60, payload.expires_in || 3600) * 1000,
  };

  return cachedManagementToken.accessToken;
};

const requestManagementApi = async (config, path, init = {}) => {
  const accessToken = await getManagementToken(config);
  let response = null;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    response = await fetch(`https://${config.domain}/api/v2${path}`, {
      ...init,
      headers: {
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(init.headers || {}),
        authorization: `Bearer ${accessToken}`,
      },
    });

    if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 5) {
      break;
    }

    await sleep(auth0RetryDelayMs(response, attempt));
  }

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

const ensureActiveEmployerTermsPolicy = async (strapi) => {
  const existingPolicy = await findFirst(strapi, 'api::policy-document.policy-document', {
    policyState: 'active',
    policyType: 'employer_terms',
  });

  if (existingPolicy) {
    return existingPolicy;
  }

  return documents(strapi, 'api::policy-document.policy-document').create({
    data: {
      acceptanceLabel:
        'I confirm I am authorised to set up this employer account and accept the HireFlip employer terms.',
      body: [
        'E2E employer terms paragraph one. Employer dashboard access is provided to invited contacts so they can manage interview availability, assignment, feedback, and participation records.',
        'E2E employer terms paragraph two. Employer contacts must keep dashboard access secure and only use candidate information for the HireFlip interview workflow.',
        'E2E employer terms paragraph three. Interview capacity, operating regions, and employer contact coverage must be kept accurate so candidate expectations remain accurate.',
        'E2E employer terms paragraph four. HireFlip may review, pause, or revoke employer access if records become inaccurate or if candidate privacy and safety requirements are not met.',
        'E2E employer terms paragraph five. These terms exist for browser smoke testing only; final legal wording remains outside this fixture.',
      ].join('\n\n'),
      effectiveFrom: new Date().toISOString(),
      internalNotes:
        'E2E employer terms for onboarding browser smoke tests. Existing active employer terms are left untouched.',
      introCopy: 'Review and accept the employer terms before opening the dashboard.',
      policyKey: 'e2e:employer-terms',
      policyState: 'active',
      policyType: 'employer_terms',
      title: 'E2E Employer Terms',
      version: 'e2e-employer-terms-v1',
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
  await ensureActiveEmployerTermsPolicy(strapi);

  return {
    area,
    classRecord,
    coverageGapArea,
    course,
    sector,
  };
};

const ensureCourseProgressClass = async (strapi, content) => {
  const classSlug = safeSlug(
    optionalEnv('HIREFLIP_E2E_COURSE_CLASS_SLUG', 'hireflip-e2e-course-progress-class')
  );
  const classCode = optionalEnv('HIREFLIP_E2E_COURSE_CLASS_CODE', 'E2E-COURSE-001');
  const year = Math.max(2026, new Date().getUTCFullYear());
  const nowDate = new Date();
  const existingClass =
    (await findFirst(strapi, 'api::class.class', { officialClassCode: classCode })) ||
    (await findFirst(strapi, 'api::class.class', { slug: classSlug }));
  const classData = {
    capacity: 20,
    classArea: connect(content.area),
    course: connect(content.course),
    currency: 'GBP',
    discountedPricePence: Number.parseInt(optionalEnv('HIREFLIP_E2E_CLASS_PRICE_PENCE', '100'), 10),
    displayTitle: optionalEnv('HIREFLIP_E2E_COURSE_CLASS_TITLE', 'HireFlip E2E Course Progress Class'),
    enrollmentOpenedAt: isoDaysFrom(nowDate, -45),
    enrollmentOpenedBy: 'e2e-fixture',
    interviewCapacityContingencyPercentage: 30,
    interviewsGuaranteed: 2,
    level: 'Entry',
    minimumViableCapacity: 1,
    modulesPassCriteriaAttached: true,
    name: optionalEnv('HIREFLIP_E2E_COURSE_CLASS_NAME', 'HireFlip E2E Course Progress Class'),
    officialClassCode: classCode,
    openedAt: isoDaysFrom(nowDate, -45),
    openingMode: 'admin_immediate',
    openingReadinessStatus: 'opened',
    overview: 'A browser e2e fixture class used to verify candidate course progression.',
    pricePence: Number.parseInt(optionalEnv('HIREFLIP_E2E_CLASS_PRICE_PENCE', '100'), 10),
    region: content.area.name,
    remoteInterviewsAllowed: true,
    sector: content.sector.name,
    slug: classSlug,
    startDate: isoDaysFrom(nowDate, -30).slice(0, 10),
    state: 'in_progress',
    workSector: connect(content.sector),
    year,
    yearSequenceNumber: 998,
  };

  return existingClass?.documentId
    ? documents(strapi, 'api::class.class').update({
        documentId: existingClass.documentId,
        data: classData,
        populate: ['classArea', 'workSector', 'course'],
      })
    : documents(strapi, 'api::class.class').create({
        data: classData,
        populate: ['classArea', 'workSector', 'course'],
      });
};

const ensureCourseAssessmentContent = async (strapi, content) => {
  const sectionTitle = 'E2E Appeal Section';
  const moduleTitle = 'E2E Appeal Module';
  const materialTitle = 'E2E Course Reading';
  const testTitle = 'E2E Appeal Assessment';
  const questionPrompt = 'Which answer should pass the E2E appeal assessment?';
  const existingSection = await findFirst(strapi, 'api::course-section.course-section', {
    course: { documentId: content.course.documentId },
    title: sectionTitle,
  });
  const sectionData = {
    course: connect(content.course),
    description: 'Synthetic section for browser assessment appeal coverage.',
    required: true,
    sectionState: 'active',
    sortOrder: 1,
    title: sectionTitle,
  };
  const section = existingSection?.documentId
    ? await documents(strapi, 'api::course-section.course-section').update({
        documentId: existingSection.documentId,
        data: sectionData,
        populate: ['course'],
      })
    : await documents(strapi, 'api::course-section.course-section').create({
        data: sectionData,
        populate: ['course'],
      });
  const existingModule = await findFirst(strapi, 'api::course-module.course-module', {
    courseSection: { documentId: section.documentId },
    title: moduleTitle,
  });
  const moduleData = {
    courseSection: connect(section),
    description: 'Synthetic module for browser assessment appeal coverage.',
    moduleState: 'active',
    required: true,
    sortOrder: 1,
    title: moduleTitle,
  };
  const module = existingModule?.documentId
    ? await documents(strapi, 'api::course-module.course-module').update({
        documentId: existingModule.documentId,
        data: moduleData,
        populate: ['courseSection'],
      })
    : await documents(strapi, 'api::course-module.course-module').create({
        data: moduleData,
        populate: ['courseSection'],
      });
  const existingMaterial = await findFirst(strapi, 'api::course-material.course-material', {
    module: { documentId: module.documentId },
    title: materialTitle,
  });
  const materialData = {
    body:
      'This synthetic lesson exists to verify the candidate course journey in browser tests.\n\nCandidates must read to the end before the completion button is enabled.',
    completionMode: 'read_to_end',
    estimatedDurationMinutes: 2,
    materialState: 'active',
    materialType: 'text',
    module: connect(module),
    required: true,
    requiredCompletionPercentage: 100,
    sortOrder: 1,
    title: materialTitle,
  };
  const material = existingMaterial?.documentId
    ? await documents(strapi, 'api::course-material.course-material').update({
        documentId: existingMaterial.documentId,
        data: materialData,
        populate: ['module'],
      })
    : await documents(strapi, 'api::course-material.course-material').create({
        data: materialData,
        populate: ['module'],
      });
  const existingTest = await findFirst(strapi, 'api::course-test.course-test', {
    courseModule: { documentId: module.documentId },
    title: testTitle,
  });
  const testData = {
    attemptLimit: 2,
    copyPasteRestrictionEnabled: true,
    course: connect(content.course),
    courseModule: connect(module),
    description: 'Synthetic test for browser assessment appeal coverage.',
    maxScore: 1,
    passMark: 100,
    questionRandomizationEnabled: false,
    testState: 'active',
    timeLimitMinutes: 10,
    title: testTitle,
  };
  const test = existingTest?.documentId
    ? await documents(strapi, 'api::course-test.course-test').update({
        documentId: existingTest.documentId,
        data: testData,
        populate: ['course', 'courseModule'],
      })
    : await documents(strapi, 'api::course-test.course-test').create({
        data: testData,
        populate: ['course', 'courseModule'],
      });
  const existingQuestion = await findFirst(strapi, 'api::course-question.course-question', {
    courseTest: { documentId: test.documentId },
    prompt: questionPrompt,
  });
  const questionData = {
    correctAnswerPayload: {
      correctOptionIds: ['correct'],
    },
    courseTest: connect(test),
    options: [
      { id: 'incorrect', label: 'Incorrect E2E option' },
      { id: 'correct', label: 'Correct E2E option' },
    ],
    prompt: questionPrompt,
    questionState: 'active',
    questionType: 'single_choice',
    scoringRubric: {
      maxScore: 1,
      passScore: 1,
    },
    sortOrder: 1,
  };
  const question = existingQuestion?.documentId
    ? await documents(strapi, 'api::course-question.course-question').update({
        documentId: existingQuestion.documentId,
        data: questionData,
        populate: ['courseTest'],
      })
    : await documents(strapi, 'api::course-question.course-question').create({
        data: questionData,
        populate: ['courseTest'],
      });

  return {
    material,
    module,
    question,
    section,
    test,
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

const resetClassAnnouncements = async (strapi, classRecord) => {
  if (!classRecord?.documentId) {
    return 0;
  }

  return deleteMany(strapi, 'api::class-announcement.class-announcement', {
    class: { documentId: classRecord.documentId },
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

const ensureEmployerPrivacyExportRequest = async (strapi, employerContact) => {
  if (!employerContact?.documentId) {
    return null;
  }

  await deleteMany(strapi, 'api::privacy-rights-request.privacy-rights-request', {
    employerContact: { documentId: employerContact.documentId },
  });

  const nowDate = new Date();
  const code = optionalEnv('HIREFLIP_E2E_PRIVACY_DOWNLOAD_CODE', '123456');
  const salt = optionalEnv('HIREFLIP_E2E_PRIVACY_DOWNLOAD_SALT', 'e2e-privacy-download-salt');
  const request = await documents(strapi, 'api::privacy-rights-request.privacy-rights-request').create({
    data: {
      completedAt: isoDaysFrom(nowDate, -1),
      deletionJobStatus: 'not_required',
      downstreamProviderSyncStatus: 'not_required',
      dueAt: isoDaysFrom(nowDate, 30),
      employerContact: connect(employerContact),
      identityVerificationStatus: 'pending',
      receivedAt: isoDaysFrom(nowDate, -2),
      requestingUserId: employerContact.authIdentityId,
      requestingUserType: 'employer_contact',
      requestState: 'completed',
      requestType: 'access',
      subjectUserId: employerContact.documentId,
      subjectUserType: 'employer_contact',
      metadata: {
        exportScope: 'both',
        publicResponse:
          'Your E2E employer privacy export is ready. Use the seeded browser test code to download the PDF.',
        requesterMessage: 'E2E completed employer privacy export fixture for browser download coverage.',
      },
    },
  });
  const downloadChallenge = {
    actorId: employerContact.authIdentityId || null,
    actorType: 'employer_contact',
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

const privacyAnonymisationFixtureKeys = {
  blocked: 'e2e_candidate_privacy_anonymisation_blocked',
  disposable: 'e2e_candidate_privacy_anonymisation_disposable',
};

const deletePrivacyAnonymisationFixtureRequests = async (strapi, fixtureKey, options = {}) => {
  const requests = await documents(strapi, 'api::privacy-rights-request.privacy-rights-request').findMany({
    filters: {
      requestType: { $in: ['deletion', 'erasure'] },
      subjectUserType: 'candidate',
    },
    limit: 200,
    populate: ['candidate'],
  });

  for (const request of requests) {
    if (request.metadata?.e2eFixtureKey !== fixtureKey) {
      continue;
    }

    const linkedCandidate = request.candidate;
    await deleteDocument(strapi, 'api::privacy-rights-request.privacy-rights-request', request.documentId);

    if (options.deleteCandidate && linkedCandidate?.documentId) {
      await resetCandidateReviewRecords(strapi, linkedCandidate);
      await resetCandidatePrivacyRecords(strapi, linkedCandidate);
      await deleteDocument(strapi, 'api::candidate.candidate', linkedCandidate.documentId);
    }
  }
};

const createCandidateDeletionRequest = async (strapi, candidate, fixtureKey, message) => {
  const nowDate = new Date();

  return documents(strapi, 'api::privacy-rights-request.privacy-rights-request').create({
    data: {
      candidate: connect(candidate),
      deletionJobStatus: 'pending',
      downstreamProviderSyncStatus: 'pending',
      dueAt: isoDaysFrom(nowDate, 30),
      identityVerificationStatus: 'verified',
      receivedAt: isoDaysFrom(nowDate, -1),
      requestingUserId: candidate.authIdentityId || candidate.documentId,
      requestingUserType: 'candidate',
      requestState: 'in_review',
      requestType: 'deletion',
      subjectUserId: candidate.documentId,
      subjectUserType: 'candidate',
      metadata: {
        e2eFixtureKey: fixtureKey,
        requesterMessage: message,
      },
    },
  });
};

const ensureCandidatePrivacyAnonymisationFixtures = async (
  strapi,
  content,
  disposableAuth0User,
  blockedCandidate
) => {
  await deletePrivacyAnonymisationFixtureRequests(strapi, privacyAnonymisationFixtureKeys.blocked);
  await deletePrivacyAnonymisationFixtureRequests(strapi, privacyAnonymisationFixtureKeys.disposable, {
    deleteCandidate: true,
  });

  const disposableEmail = normalizeEmail(
    optionalEnv(
      'HIREFLIP_E2E_PRIVACY_ANONYMISE_CANDIDATE_EMAIL',
      'e2e-privacy-anonymise-candidate@hireflip.work'
    )
  );
  const existingDisposable =
    (await findFirst(strapi, 'api::candidate.candidate', { email: disposableEmail })) ||
    (await findFirst(strapi, 'api::candidate.candidate', { authIdentityId: disposableAuth0User.userId }));

  if (existingDisposable?.documentId) {
    await resetCandidateReviewRecords(strapi, existingDisposable);
    await resetCandidatePrivacyRecords(strapi, existingDisposable);
    await deleteDocument(strapi, 'api::candidate.candidate', existingDisposable.documentId);
  }

  const now = new Date().toISOString();
  const disposableCandidate = await documents(strapi, 'api::candidate.candidate').create({
    data: {
      accountCreatedAt: now,
      accountOnboardingCompletedAt: now,
      accountRestrictionAppealStatus: 'not_applicable',
      accountRestrictionStatus: 'active',
      authIdentityId: disposableAuth0User.userId,
      authProvider: 'auth0',
      candidateState: 'unenrolled',
      classAreaPreferences: preferenceSelection(content.area.slug),
      dateOfBirth: '1996-02-20',
      email: disposableEmail,
      firstName: optionalEnv('HIREFLIP_E2E_PRIVACY_ANONYMISE_CANDIDATE_FIRST_NAME', 'E2E'),
      gender: 'prefer_not_to_say',
      lastName: optionalEnv(
        'HIREFLIP_E2E_PRIVACY_ANONYMISE_CANDIDATE_LAST_NAME',
        'Privacy Anonymise Candidate'
      ),
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
      phone: '+447700900137',
      preferredCommunicationChannel: 'email',
      profileSettings: {
        accountOnboarding: {
          completedAt: now,
        },
        e2eFixtureKey: privacyAnonymisationFixtureKeys.disposable,
      },
      recruitmentPlatformVisibility: 'visible',
      region: content.area.name,
      sector: content.sector.name,
      workSectorPreferences: preferenceSelection(content.sector.slug),
    },
  });

  await documents(strapi, 'api::candidate-profile.candidate-profile').create({
    data: {
      candidate: connect(disposableCandidate),
      completedAt: now,
      education: [
        {
          end: { month: 7, year: 2024 },
          institution: 'E2E Privacy College',
          level: 'Foundation',
          qualification: 'Privacy Fixture',
          start: { month: 9, year: 2023 },
          subject: 'Operations',
        },
      ],
      experience: [],
      metadata: {
        e2eFixtureKey: privacyAnonymisationFixtureKeys.disposable,
      },
      profileState: 'completed',
      projects: [],
      recruitmentPlatformVisibility: 'visible',
      skills: ['E2E privacy fixture'],
      summary: 'Disposable candidate profile used for privacy anonymisation browser coverage.',
      targetRoleTitle: 'E2E Privacy Fixture Candidate',
      targetSector: content.sector.slug,
      targetSectorLabel: content.sector.name,
      unavailableDates: [],
      workPreferences: {},
    },
  });

  const blockedRequest = await createCandidateDeletionRequest(
    strapi,
    blockedCandidate,
    privacyAnonymisationFixtureKeys.blocked,
    'E2E deletion request with active course blockers for browser coverage.'
  );
  const disposableRequest = await createCandidateDeletionRequest(
    strapi,
    disposableCandidate,
    privacyAnonymisationFixtureKeys.disposable,
    'E2E deletion request for disposable candidate anonymisation browser coverage.'
  );

  return {
    blockedRequest,
    disposableCandidate,
    disposableRequest,
  };
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

  const supportCases = await documents(strapi, 'api::support-case.support-case').findMany({
    filters: candidateFilter,
    limit: 100,
  });

  for (const supportCase of supportCases) {
    await deleteMany(strapi, 'api::support-message.support-message', {
      supportCase: { documentId: supportCase.documentId },
    });
    await deleteDocument(strapi, 'api::support-case.support-case', supportCase.documentId);
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

const resetCandidateReviewRecords = async (strapi, candidate) => {
  if (!candidate?.documentId) {
    return;
  }

  const candidateFilter = { candidate: { documentId: candidate.documentId } };
  const supportCases = await documents(strapi, 'api::support-case.support-case').findMany({
    filters: candidateFilter,
    limit: 100,
  });

  for (const supportCase of supportCases) {
    await deleteMany(strapi, 'api::support-message.support-message', {
      supportCase: { documentId: supportCase.documentId },
    });
    await deleteDocument(strapi, 'api::support-case.support-case', supportCase.documentId);
  }

  const interviews = await documents(strapi, 'api::interview.interview').findMany({
    filters: candidateFilter,
    limit: 100,
  });

  for (const interview of interviews) {
    await deleteMany(strapi, 'api::interview-feedback.interview-feedback', {
      interview: { documentId: interview.documentId },
    });
    await deleteMany(strapi, 'api::interview-feedback-invite.interview-feedback-invite', {
      interview: { documentId: interview.documentId },
    });
    await deleteMany(strapi, 'api::offer.offer', {
      interview: { documentId: interview.documentId },
    });
    await deleteDocument(strapi, 'api::interview.interview', interview.documentId);
  }

  await deleteMany(strapi, 'api::course-answer-submission.course-answer-submission', candidateFilter);
  await deleteMany(strapi, 'api::assessment-appeal.assessment-appeal', candidateFilter);
  await deleteMany(strapi, 'api::course-test-result.course-test-result', candidateFilter);
  await deleteMany(strapi, 'api::course-progress.course-progress', candidateFilter);
  await deleteMany(strapi, 'api::course-test-attempt.course-test-attempt', candidateFilter);
  await deleteMany(strapi, 'api::course-module-result.course-module-result', candidateFilter);
  await deleteMany(strapi, 'api::course-section-result.course-section-result', candidateFilter);
  await deleteMany(strapi, 'api::course-result.course-result', candidateFilter);
  await deleteMany(strapi, 'api::candidate-interview-strike.candidate-interview-strike', candidateFilter);
  await deleteMany(strapi, 'api::refund.refund', candidateFilter);
  await deleteMany(strapi, 'api::payment.payment', candidateFilter);
  await deleteMany(strapi, 'api::reservation.reservation', candidateFilter);
  await deleteMany(strapi, 'api::notification-event.notification-event', candidateFilter);
  await deleteMany(strapi, 'api::enrollment.enrollment', candidateFilter);
};

const ensureReviewCandidate = async (strapi, content, options) => {
  const email = normalizeEmail(options.email);
  const now = new Date().toISOString();
  const existing = await findFirst(strapi, 'api::candidate.candidate', { email });

  if (existing?.documentId) {
    await resetCandidateReviewRecords(strapi, existing);
    await deleteDocument(strapi, 'api::candidate.candidate', existing.documentId);
  }

  return documents(strapi, 'api::candidate.candidate').create({
    data: {
      accountCreatedAt: now,
      accountOnboardingCompletedAt: now,
      accountRestrictionAppealStatus: 'not_applicable',
      accountRestrictionStatus: 'active',
      authProvider: 'manual',
      candidateState: options.candidateState || 'in_class',
      classAreaPreferences: preferenceSelection(content.area.slug),
      dateOfBirth: options.dateOfBirth || '1998-04-12',
      email,
      firstName: options.firstName || 'E2E',
      gender: 'prefer_not_to_say',
      lastName: options.lastName,
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
      phone: options.phone,
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
};

const createReviewEnrollment = async (strapi, candidate, content, options = {}) => {
  const nowDate = new Date();

  return documents(strapi, 'api::enrollment.enrollment').create({
    data: {
      beganClassAt: isoDaysFrom(nowDate, -35),
      candidate: connect(candidate),
      class: connect(content.classRecord),
      completedAt: options.completedAt ?? null,
      completionStatus: options.completionStatus || 'in_progress',
      courseCompletionDeadline: options.courseCompletionDeadline || isoDaysFrom(nowDate, 10),
      enrolledAt: isoDaysFrom(nowDate, -40),
      enrollmentState: options.enrollmentState || 'in_class',
      interviewGuaranteeDeadline: options.interviewGuaranteeDeadline || isoDaysFrom(nowDate, -2),
      interviewGuaranteeWindowStartsAt: options.interviewGuaranteeWindowStartsAt || isoDaysFrom(nowDate, -20),
      passStatus: options.passStatus || 'not_assessed',
      passedAt: options.passedAt ?? null,
      paymentStatus: options.paymentStatus || 'paid',
      qualifyingInterviewsDeliveredCount: options.qualifyingInterviewsDeliveredCount || 0,
      refundEligibilityState: options.refundEligibilityState || 'not_assessed',
    },
  });
};

const ensureCourseProgressCandidate = async (strapi, auth0User, content, courseClass) => {
  const email = normalizeEmail(
    optionalEnv('HIREFLIP_E2E_COURSE_CANDIDATE_EMAIL', 'e2e-course-candidate@hireflip.work')
  );
  const nowDate = new Date();
  const now = nowDate.toISOString();
  const existing =
    (await findFirst(strapi, 'api::candidate.candidate', { email })) ||
    (await findFirst(strapi, 'api::candidate.candidate', { authIdentityId: auth0User.userId }));

  if (existing?.documentId) {
    await resetCandidateReviewRecords(strapi, existing);
    await resetCandidatePrivacyRecords(strapi, existing);
    await resetCandidateNotificationEvents(strapi, existing);
    await deleteDocument(strapi, 'api::candidate.candidate', existing.documentId);
  }

  const candidate = await documents(strapi, 'api::candidate.candidate').create({
    data: {
      accountCreatedAt: now,
      accountOnboardingCompletedAt: now,
      accountRestrictionAppealStatus: 'not_applicable',
      accountRestrictionStatus: 'active',
      authIdentityId: auth0User.userId,
      authProvider: 'auth0',
      candidateState: 'enrolled',
      classAreaPreferences: preferenceSelection(content.area.slug),
      dateOfBirth: optionalEnv('HIREFLIP_E2E_COURSE_CANDIDATE_DATE_OF_BIRTH', '1997-08-18'),
      email,
      firstName: optionalEnv('HIREFLIP_E2E_COURSE_CANDIDATE_FIRST_NAME', 'E2E'),
      gender: 'prefer_not_to_say',
      lastName: optionalEnv('HIREFLIP_E2E_COURSE_CANDIDATE_LAST_NAME', 'Course Candidate'),
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
      phone: optionalEnv('HIREFLIP_E2E_COURSE_CANDIDATE_PHONE', '+447700900126'),
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
      candidate: connect(candidate),
      class: connect(courseClass),
      completionStatus: 'not_started',
      enrolledAt: isoDaysFrom(nowDate, -20),
      enrollmentState: 'enrolled',
      passStatus: 'not_assessed',
      paymentStatus: 'paid',
      qualifyingInterviewsDeliveredCount: 0,
      refundEligibilityState: 'not_assessed',
    },
  });
  const reservation = await documents(strapi, 'api::reservation.reservation').create({
    data: {
      amountPence: Number.parseInt(optionalEnv('HIREFLIP_E2E_CLASS_PRICE_PENCE', '100'), 10),
      candidate: connect(candidate),
      class: connect(courseClass),
      currency: 'GBP',
      enrollment: connect(enrollment),
      expiresAt: isoDaysFrom(nowDate, -19),
      paidAt: isoDaysFrom(nowDate, -20),
      reservationStartedAt: isoDaysFrom(nowDate, -20),
      reservationState: 'paid',
      source: 'candidate_dashboard',
      termsAcceptedAt: isoDaysFrom(nowDate, -20),
      termsVersion: 'e2e-checkout-terms-v1',
      metadata: {
        scenario: 'course_progress',
        source: 'e2e_fixture',
      },
    },
  });
  await documents(strapi, 'api::payment.payment').create({
    data: {
      amountPence: Number.parseInt(optionalEnv('HIREFLIP_E2E_CLASS_PRICE_PENCE', '100'), 10),
      candidate: connect(candidate),
      createdByService: 'e2e-fixture',
      currency: 'GBP',
      enrollment: connect(enrollment),
      metadata: {
        scenario: 'course_progress',
        source: 'e2e_fixture',
      },
      paidAt: isoDaysFrom(nowDate, -20),
      paymentProvider: 'stripe',
      paymentState: 'paid',
      paymentType: 'course_payment',
      providerCheckoutSessionId: 'cs_test_e2e_course_progress',
      providerPaymentIntentId: 'pi_test_e2e_course_progress',
      reservation: connect(reservation),
    },
  });

  return {
    candidate,
    enrollment,
  };
};

const ensureCourseAppealSubmissionCandidate = async (
  strapi,
  auth0User,
  content,
  courseClass,
  assessmentContent
) => {
  const email = normalizeEmail(
    optionalEnv('HIREFLIP_E2E_COURSE_APPEAL_CANDIDATE_EMAIL', 'e2e-course-appeal-candidate@hireflip.work')
  );
  const nowDate = new Date();
  const now = nowDate.toISOString();
  const existing =
    (await findFirst(strapi, 'api::candidate.candidate', { email })) ||
    (await findFirst(strapi, 'api::candidate.candidate', { authIdentityId: auth0User.userId }));

  if (existing?.documentId) {
    await resetCandidateReviewRecords(strapi, existing);
    await resetCandidatePrivacyRecords(strapi, existing);
    await resetCandidateNotificationEvents(strapi, existing);
    await deleteDocument(strapi, 'api::candidate.candidate', existing.documentId);
  }

  const candidate = await documents(strapi, 'api::candidate.candidate').create({
    data: {
      accountCreatedAt: now,
      accountOnboardingCompletedAt: now,
      accountRestrictionAppealStatus: 'not_applicable',
      accountRestrictionStatus: 'active',
      authIdentityId: auth0User.userId,
      authProvider: 'auth0',
      candidateState: 'in_class',
      classAreaPreferences: preferenceSelection(content.area.slug),
      dateOfBirth: optionalEnv('HIREFLIP_E2E_COURSE_APPEAL_CANDIDATE_DATE_OF_BIRTH', '1997-09-19'),
      email,
      firstName: optionalEnv('HIREFLIP_E2E_COURSE_APPEAL_CANDIDATE_FIRST_NAME', 'E2E'),
      gender: 'prefer_not_to_say',
      lastName: optionalEnv('HIREFLIP_E2E_COURSE_APPEAL_CANDIDATE_LAST_NAME', 'Course Appeal Candidate'),
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
      phone: optionalEnv('HIREFLIP_E2E_COURSE_APPEAL_CANDIDATE_PHONE', '+447700900127'),
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
      beganClassAt: isoDaysFrom(nowDate, -7),
      candidate: connect(candidate),
      class: connect(courseClass),
      completionStatus: 'in_progress',
      courseCompletionDeadline: isoDaysFrom(nowDate, 83),
      enrolledAt: isoDaysFrom(nowDate, -20),
      enrollmentState: 'in_class',
      passStatus: 'failed',
      paymentStatus: 'paid',
      qualifyingInterviewsDeliveredCount: 0,
      refundEligibilityState: 'not_assessed',
    },
  });
  const reservation = await documents(strapi, 'api::reservation.reservation').create({
    data: {
      amountPence: Number.parseInt(optionalEnv('HIREFLIP_E2E_CLASS_PRICE_PENCE', '100'), 10),
      candidate: connect(candidate),
      class: connect(courseClass),
      currency: 'GBP',
      enrollment: connect(enrollment),
      expiresAt: isoDaysFrom(nowDate, -19),
      paidAt: isoDaysFrom(nowDate, -20),
      reservationStartedAt: isoDaysFrom(nowDate, -20),
      reservationState: 'paid',
      source: 'candidate_dashboard',
      termsAcceptedAt: isoDaysFrom(nowDate, -20),
      termsVersion: 'e2e-checkout-terms-v1',
      metadata: {
        scenario: 'course_appeal_submission',
        source: 'e2e_fixture',
      },
    },
  });
  await documents(strapi, 'api::payment.payment').create({
    data: {
      amountPence: Number.parseInt(optionalEnv('HIREFLIP_E2E_CLASS_PRICE_PENCE', '100'), 10),
      candidate: connect(candidate),
      createdByService: 'e2e-fixture',
      currency: 'GBP',
      enrollment: connect(enrollment),
      metadata: {
        scenario: 'course_appeal_submission',
        source: 'e2e_fixture',
      },
      paidAt: isoDaysFrom(nowDate, -20),
      paymentProvider: 'stripe',
      paymentState: 'paid',
      paymentType: 'course_payment',
      providerCheckoutSessionId: 'cs_test_e2e_course_appeal_submission',
      providerPaymentIntentId: 'pi_test_e2e_course_appeal_submission',
      reservation: connect(reservation),
    },
  });
  await documents(strapi, 'api::course-progress.course-progress').create({
    data: {
      candidate: connect(candidate),
      completedAt: isoDaysFrom(nowDate, -4),
      courseMaterial: connect(assessmentContent.material),
      enrollment: connect(enrollment),
      metadata: {
        completionPercentage: 100,
        reachedEnd: true,
        scenario: 'course_appeal_submission',
        source: 'e2e_fixture',
      },
      progressState: 'completed',
      progressType: 'material',
      startedAt: isoDaysFrom(nowDate, -5),
    },
  });
  const attempt = await documents(strapi, 'api::course-test-attempt.course-test-attempt').create({
    data: {
      attemptNumber: 2,
      attemptState: 'failed',
      candidate: connect(candidate),
      courseTest: connect(assessmentContent.test),
      enrollment: connect(enrollment),
      maxScore: 1,
      metadata: {
        scenario: 'course_appeal_submission',
        source: 'e2e_fixture',
      },
      passed: false,
      passMarkSnapshot: 100,
      retryEligibilityState: 'exhausted',
      retryType: 'conditional_retry',
      score: 0,
      startedAt: isoDaysFrom(nowDate, -2),
      submittedAt: isoDaysFrom(nowDate, -1),
      timeTakenSeconds: 420,
    },
  });
  await documents(strapi, 'api::course-answer-submission.course-answer-submission').create({
    data: {
      answerPayload: {
        selectedOptionIds: ['incorrect'],
      },
      candidate: connect(candidate),
      courseQuestion: connect(assessmentContent.question),
      courseTestAttempt: connect(attempt),
      feedback: 'The selected E2E option did not meet the pass criteria.',
      flagState: 'flagged',
      metadata: {
        scenario: 'course_appeal_submission',
        source: 'e2e_fixture',
      },
      score: 0,
      submittedAt: isoDaysFrom(nowDate, -1),
    },
  });
  await documents(strapi, 'api::course-test-result.course-test-result').create({
    data: {
      attemptNumber: attempt.attemptNumber,
      candidate: connect(candidate),
      courseTest: connect(assessmentContent.test),
      courseTestAttempt: connect(attempt),
      decidedAt: isoDaysFrom(nowDate, -1),
      enrollment: connect(enrollment),
      maxScore: 1,
      metadata: {
        scenario: 'course_appeal_submission',
        source: 'e2e_fixture',
      },
      passed: false,
      passMarkSnapshot: 100,
      resultState: 'failed',
      retryEligibilityState: 'exhausted',
      score: 0,
    },
  });
  await documents(strapi, 'api::course-result.course-result').create({
    data: {
      candidate: connect(candidate),
      completionDeadline: enrollment.courseCompletionDeadline,
      course: connect(content.course),
      deadlineExtensionSeconds: 0,
      enrollment: connect(enrollment),
      maxScore: 1,
      metadata: {
        scenario: 'course_appeal_submission',
        source: 'e2e_fixture',
      },
      requiredSectionsPassed: 0,
      requiredSectionsTotal: 1,
      resultState: 'failed',
      score: 0,
      startedAt: isoDaysFrom(nowDate, -7),
    },
  });

  return {
    candidate,
    enrollment,
  };
};

const ensureAssessmentAppealReviewFixture = async (
  strapi,
  content,
  assessmentContent,
  options
) => {
  const nowDate = new Date();
  const candidate = await ensureReviewCandidate(strapi, content, {
    candidateState: 'in_class',
    email: options.email,
    firstName: 'E2E',
    lastName: options.lastName,
    phone: options.phone,
  });
  const enrollment = await createReviewEnrollment(strapi, candidate, content, {
    completionStatus: 'missed_deadline',
    enrollmentState: 'failed',
    passStatus: 'failed',
    refundEligibilityState: 'not_eligible',
  });
  const attempt = await documents(strapi, 'api::course-test-attempt.course-test-attempt').create({
    data: {
      attemptNumber: options.attemptNumber || 2,
      attemptState: 'appealed',
      candidate: connect(candidate),
      courseTest: connect(assessmentContent.test),
      enrollment: connect(enrollment),
      maxScore: 1,
      metadata: {
        scenario: options.scenario,
        source: 'e2e_fixture',
      },
      passed: false,
      passMarkSnapshot: 100,
      retryEligibilityState: 'exhausted',
      retryType: 'conditional_retry',
      score: 0,
      startedAt: isoDaysFrom(nowDate, -3),
      submittedAt: isoDaysFrom(nowDate, -2),
      timeTakenSeconds: 420,
    },
  });
  const answer = await documents(strapi, 'api::course-answer-submission.course-answer-submission').create({
    data: {
      answerPayload: {
        selectedOptionIds: ['incorrect'],
      },
      candidate: connect(candidate),
      courseQuestion: connect(assessmentContent.question),
      courseTestAttempt: connect(attempt),
      feedback: 'The selected E2E option did not meet the pass criteria.',
      flagState: 'flagged',
      score: 0,
      submittedAt: isoDaysFrom(nowDate, -2),
      metadata: {
        scenario: options.scenario,
        source: 'e2e_fixture',
      },
    },
  });
  const testResult = await documents(strapi, 'api::course-test-result.course-test-result').create({
    data: {
      attemptNumber: attempt.attemptNumber,
      candidate: connect(candidate),
      courseTest: connect(assessmentContent.test),
      courseTestAttempt: connect(attempt),
      decidedAt: isoDaysFrom(nowDate, -2),
      enrollment: connect(enrollment),
      maxScore: 1,
      metadata: {
        scenario: options.scenario,
        source: 'e2e_fixture',
      },
      passed: false,
      passMarkSnapshot: 100,
      resultState: 'appealed',
      retryEligibilityState: 'exhausted',
      score: 0,
    },
  });
  await documents(strapi, 'api::course-result.course-result').create({
    data: {
      candidate: connect(candidate),
      completionDeadline: enrollment.courseCompletionDeadline,
      course: connect(content.course),
      deadlineExtensionSeconds: 0,
      enrollment: connect(enrollment),
      metadata: {
        scenario: options.scenario,
        source: 'e2e_fixture',
      },
      requiredSectionsPassed: 0,
      requiredSectionsTotal: 1,
      resultState: 'failed',
      score: 0,
      maxScore: 1,
      startedAt: isoDaysFrom(nowDate, -35),
    },
  });
  const appeal = await documents(strapi, 'api::assessment-appeal.assessment-appeal').create({
    data: {
      appealState: 'submitted',
      candidate: connect(candidate),
      courseAnswerSubmission: connect(answer),
      courseTestAttempt: connect(attempt),
      enrollment: connect(enrollment),
      metadata: {
        scenario: options.scenario,
        source: 'e2e_fixture',
        testResultDocumentId: testResult.documentId,
      },
      reason: options.reason,
      submittedAt: isoDaysFrom(nowDate, -1),
    },
  });

  await documents(strapi, 'api::audit-event.audit-event').create({
    data: {
      actorDisplayName: 'E2E fixture',
      actorId: 'e2e-fixture',
      actorType: 'system',
      eventCategory: 'assessment',
      eventType: 'e2e.assessment_appeal_seeded',
      metadata: {
        answerDocumentId: answer.documentId,
        attemptDocumentId: attempt.documentId,
        scenario: options.scenario,
      },
      occurredAt: isoDaysFrom(nowDate, -1),
      severity: 'info',
      source: 'system',
      subjectDisplayName: `${candidate.firstName} ${candidate.lastName}`.trim(),
      subjectId: appeal.documentId,
      subjectType: 'assessment_appeal',
    },
  });

  return {
    appeal,
    candidate,
    enrollment,
  };
};

const ensureRefundReviewFixture = async (strapi, content, employerContext, options) => {
  const nowDate = new Date();
  const candidate = await ensureReviewCandidate(strapi, content, {
    candidateState: 'interview_phase',
    email: options.email,
    firstName: 'E2E',
    lastName: options.lastName,
    phone: options.phone,
  });
  const enrollment = await createReviewEnrollment(strapi, candidate, content, {
    completedAt: isoDaysFrom(nowDate, -25),
    completionStatus: 'completed',
    enrollmentState: 'interview_phase',
    interviewGuaranteeDeadline: isoDaysFrom(nowDate, -1),
    interviewGuaranteeWindowStartsAt: isoDaysFrom(nowDate, -25),
    passStatus: 'passed',
    passedAt: isoDaysFrom(nowDate, -25),
    qualifyingInterviewsDeliveredCount: 1,
    refundEligibilityState: 'refund_requested',
  });
  const reservation = await documents(strapi, 'api::reservation.reservation').create({
    data: {
      amountPence: options.originalAmountPence,
      candidate: connect(candidate),
      class: connect(content.classRecord),
      currency: 'GBP',
      enrollment: connect(enrollment),
      expiresAt: isoDaysFrom(nowDate, -30),
      paidAt: isoDaysFrom(nowDate, -31),
      reservationStartedAt: isoDaysFrom(nowDate, -32),
      reservationState: 'paid',
      source: 'candidate_dashboard',
      termsAcceptedAt: isoDaysFrom(nowDate, -31),
      termsVersion: 'e2e-checkout-terms-v1',
      metadata: {
        scenario: options.scenario,
        source: 'e2e_fixture',
      },
    },
  });
  const payment = await documents(strapi, 'api::payment.payment').create({
    data: {
      amountPence: options.originalAmountPence,
      candidate: connect(candidate),
      createdByService: 'e2e-fixture',
      currency: 'GBP',
      enrollment: connect(enrollment),
      metadata: {
        scenario: options.scenario,
        source: 'e2e_fixture',
      },
      paidAt: isoDaysFrom(nowDate, -31),
      paymentProvider: 'stripe',
      paymentState: 'paid',
      paymentType: 'course_payment',
      providerCheckoutSessionId: `cs_test_${options.scenario}`,
      providerPaymentIntentId: `pi_test_${options.scenario}`,
      reservation: connect(reservation),
    },
  });
  const interview = await documents(strapi, 'api::interview.interview').create({
    data: {
      candidate: connect(candidate),
      completedAt: isoDaysFrom(nowDate, -10),
      confirmedAt: isoDaysFrom(nowDate, -12),
      countsTowardGuarantee: true,
      employer: connect(employerContext.employer),
      employerContact: connect(employerContext.contact),
      enrollment: connect(enrollment),
      feedbackDueAt: isoDaysFrom(nowDate, -7),
      interviewState: 'completed',
      locationType: 'in_person',
      metadata: {
        scenario: options.scenario,
        source: 'e2e_fixture',
      },
      scheduledEndTime: isoDaysHoursFrom(nowDate, -10, 1),
      scheduledStartTime: isoDaysFrom(nowDate, -10),
    },
  });
  await documents(strapi, 'api::interview-feedback.interview-feedback').create({
    data: {
      candidateReportState: 'pending',
      concerns: 'Candidate needs more practice answering scenario questions.',
      interview: connect(interview),
      metadata: {
        scenario: options.scenario,
        source: 'e2e_fixture',
      },
      nextStep: 'Use the first interview feedback to prepare for the next opportunity.',
      notes: 'Synthetic employer feedback used in refund evidence.',
      outcome: 'neutral',
      rating: 3,
      strengths: 'Arrived prepared and communicated clearly.',
      submittedAt: isoDaysFrom(nowDate, -9),
      submittedById: employerContext.contact.documentId,
      submittedByType: 'employer_contact',
    },
  });
  const refund = await documents(strapi, 'api::refund.refund').create({
    data: {
      amountPence: options.originalAmountPence,
      candidate: connect(candidate),
      currency: 'GBP',
      eligibilitySource: 'candidate_request',
      enrollment: connect(enrollment),
      metadata: {
        originalAmountPence: options.originalAmountPence,
        scenario: options.scenario,
        source: 'e2e_fixture',
      },
      payment: connect(payment),
      paymentProvider: 'stripe',
      qualifyingInterviewsDeliveredCount: 1,
      reason: options.reason,
      refundState: 'requested',
      requestedAt: isoDaysFrom(nowDate, -1),
    },
  });

  await documents(strapi, 'api::audit-event.audit-event').create({
    data: {
      actorDisplayName: 'E2E fixture',
      actorId: 'e2e-fixture',
      actorType: 'system',
      eventCategory: 'refund',
      eventType: 'e2e.refund_review_seeded',
      metadata: {
        paymentDocumentId: payment.documentId,
        scenario: options.scenario,
      },
      occurredAt: isoDaysFrom(nowDate, -1),
      severity: 'info',
      source: 'system',
      subjectDisplayName: `${candidate.firstName} ${candidate.lastName}`.trim(),
      subjectId: refund.documentId,
      subjectType: 'refund',
    },
  });

  return {
    candidate,
    enrollment,
    payment,
    refund,
  };
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

  let activeOffer = null;

  if (options.seedActiveSlotOffer !== false) {
    activeOffer = await documents(strapi, 'api::interview-slot-offer.interview-slot-offer').create({
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
  }

  const activeStrike = options.seedActiveStrike
    ? await documents(strapi, 'api::candidate-interview-strike.candidate-interview-strike').create({
        data: {
          appliedAt: isoDaysFrom(nowDate, -2),
          candidate: connect(candidate),
          enrollment: connect(enrollment),
          metadata: {
            source: 'e2e_fixture',
            scenario: 'candidate_interview_strike_dispute',
          },
          reason: 'candidate_declined_all_slots',
          strikeNumber: 1,
          strikeState: 'active',
        },
      })
    : null;

  if (!includeHistory) {
    return {
      activeOffer,
      candidate,
      activeStrike,
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

  const createCompletedCandidateOffer = async (interview, slot, options = {}) =>
    documents(strapi, 'api::interview-slot-offer.interview-slot-offer').create({
      data: {
        candidate: connect(candidate),
        candidateInterviewFormatPreference: options.formatPreference || 'in_person',
        candidateRespondedAt: isoDaysFrom(nowDate, options.respondedDays ?? -4),
        candidateResponseDeadline: isoDaysFrom(nowDate, options.responseDeadlineDays ?? -4),
        capacityClaim: connect(capacityClaim),
        employer: connect(employerContext.employer),
        employerContact: connect(employerContext.contact),
        enrollment: connect(enrollment),
        interviewRequest: connect(interviewRequest),
        offerState: 'completed',
        requiredSlotCount: 3,
        selectedInterview: connect(interview),
        selectedSlot: connect(slot),
      },
    });

  await createCompletedCandidateOffer(completedInterview, completedSlot);

  const feedbackReportSlot = await documents(strapi, 'api::interview-slot.interview-slot').create({
    data: {
      capacity: 1,
      employer: connect(employerContext.employer),
      employerContact: connect(employerContext.contact),
      endTime: isoDaysHoursFrom(nowDate, -9, 1),
      locationDetails: 'E2E Employer Office',
      locationType: 'in_person',
      region: connect(content.area),
      slotState: 'completed',
      startTime: isoDaysFrom(nowDate, -9),
      workSector: connect(content.sector),
    },
  });
  const feedbackReportInterview = await documents(strapi, 'api::interview.interview').create({
    data: {
      arrivalInstructions: 'Report to reception for the E2E feedback-report interview.',
      candidate: connect(candidate),
      candidateInstructions: 'Bring examples of previous campaign work.',
      completedAt: isoDaysFrom(nowDate, -9),
      countsTowardGuarantee: true,
      detailsProvidedAt: isoDaysFrom(nowDate, -10),
      employer: connect(employerContext.employer),
      employerContact: connect(employerContext.contact),
      enrollment: connect(enrollment),
      interviewSlot: connect(feedbackReportSlot),
      interviewerName: 'E2E Feedback Report Interviewer',
      interviewState: 'completed',
      locationDetails: 'E2E Employer Office',
      locationType: 'in_person',
      scheduledEndTime: isoDaysHoursFrom(nowDate, -9, 1),
      scheduledStartTime: isoDaysFrom(nowDate, -9),
    },
  });
  await createCompletedCandidateOffer(feedbackReportInterview, feedbackReportSlot, {
    respondedDays: -11,
    responseDeadlineDays: -11,
  });
  await documents(strapi, 'api::interview-feedback.interview-feedback').create({
    data: {
      aiModel: 'e2e-fixture',
      aiProvider: 'e2e_fixture',
      aiPromptVersion: 'e2e-feedback-report-v1',
      candidateReportConclusion:
        'E2E generated report conclusion: with focused preparation, the next interview should be stronger.',
      candidateReportGeneratedAt: isoDaysFrom(nowDate, -8),
      candidateReportImprovements:
        'E2E generated report improvements: add more measurable outcomes and tighten answers around the role.',
      candidateReportIntro:
        'E2E generated report overall: the interview went well and the candidate showed clear preparation.',
      candidateReportState: 'generated',
      candidateReportStrengths:
        'E2E generated report strengths: clear communication, calm pacing, and thoughtful questions.',
      candidateReportTakeaways: [
        'Prepare two quantified examples before the next interview.',
        'Ask one sector-specific question about the employer team.',
        'Close answers with a clear link back to the role.',
      ],
      candidateReportVisibleAt: isoDaysFrom(nowDate, -8),
      concerns: 'The candidate should include more measurable campaign examples.',
      interview: connect(feedbackReportInterview),
      metadata: {
        rawFeedbackCandidateVisible: false,
        source: 'e2e_fixture_generated_candidate_report',
      },
      nextStep: 'Use the three takeaways before the next interview.',
      notes: 'E2E raw employer feedback used only to seed a candidate-safe report.',
      outcome: 'positive',
      rating: 5,
      strengths: 'The candidate communicated clearly and asked thoughtful questions.',
      submittedAt: isoDaysFrom(nowDate, -8),
      submittedById: employerContext.contact.documentId,
      submittedByType: 'employer_contact',
    },
  });

  const followUpDueSlot = await documents(strapi, 'api::interview-slot.interview-slot').create({
    data: {
      capacity: 1,
      employer: connect(employerContext.employer),
      employerContact: connect(employerContext.contact),
      endTime: isoDaysHoursFrom(nowDate, -36, 1),
      locationDetails: 'E2E Employer Office',
      locationType: 'in_person',
      region: connect(content.area),
      slotState: 'completed',
      startTime: isoDaysFrom(nowDate, -36),
      workSector: connect(content.sector),
    },
  });
  const followUpDueInterview = await documents(strapi, 'api::interview.interview').create({
    data: {
      arrivalInstructions: 'Report to reception for the E2E follow-up interview.',
      candidate: connect(candidate),
      candidateInstructions: 'Bring your portfolio.',
      completedAt: isoDaysFrom(nowDate, -36),
      countsTowardGuarantee: true,
      detailsProvidedAt: isoDaysFrom(nowDate, -37),
      employer: connect(employerContext.employer),
      employerContact: connect(employerContext.contact),
      enrollment: connect(enrollment),
      interviewSlot: connect(followUpDueSlot),
      interviewerName: 'E2E Follow Up Due Interviewer',
      interviewState: 'completed',
      locationDetails: 'E2E Employer Office',
      locationType: 'in_person',
      scheduledEndTime: isoDaysHoursFrom(nowDate, -36, 1),
      scheduledStartTime: isoDaysFrom(nowDate, -36),
    },
  });
  await createCompletedCandidateOffer(followUpDueInterview, followUpDueSlot, {
    respondedDays: -38,
    responseDeadlineDays: -38,
  });
  await documents(strapi, 'api::offer.offer').create({
    data: {
      candidate: connect(candidate),
      candidateFollowUpDueAt: isoDaysFrom(nowDate, -1),
      candidateFollowUpSentAt: isoDaysFrom(nowDate, -2),
      candidateFollowUpState: 'sent',
      candidateMessage: 'E2E accepted progression request with follow-up due.',
      candidateNotifiedAt: isoDaysFrom(nowDate, -35),
      candidateResponse: 'accepted',
      candidateRespondedAt: isoDaysFrom(nowDate, -34),
      candidateResponseDeadline: isoDaysFrom(nowDate, -33),
      detailsReleasedAt: isoDaysFrom(nowDate, -34),
      employer: connect(employerContext.employer),
      employerFollowUpDueAt: isoDaysFrom(nowDate, -1),
      employerFollowUpSentAt: isoDaysFrom(nowDate, -2),
      employerFollowUpState: 'sent',
      followUpState: 'sent',
      internalProcessNotes: 'E2E seeded accepted progression with one-month follow-up due.',
      interview: connect(followUpDueInterview),
      metadata: {
        source: 'e2e_fixture_progression_follow_up_due',
      },
      progressionState: 'accepted',
      progressionType: 'second_interview',
      requestedByEmployerContact: connect(employerContext.contact),
      requestedDetailsAt: isoDaysFrom(nowDate, -35),
    },
  });

  if (options.seedPublicFeedbackInvite !== false) {
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
  }

  const createCompletedProgressionInterview = async ({ dayOffset, label }) => {
    const slot = await documents(strapi, 'api::interview-slot.interview-slot').create({
      data: {
        capacity: 1,
        employer: connect(employerContext.employer),
        employerContact: connect(employerContext.contact),
        endTime: isoDaysHoursFrom(nowDate, dayOffset, 1),
        locationDetails: 'E2E Employer Office',
        locationType: 'in_person',
        region: connect(content.area),
        slotState: 'completed',
        startTime: isoDaysFrom(nowDate, dayOffset),
        workSector: connect(content.sector),
      },
    });

    return documents(strapi, 'api::interview.interview').create({
      data: {
        arrivalInstructions: `Report to reception for the ${label}.`,
        candidate: connect(candidate),
        candidateInstructions: 'Bring a notebook and ID.',
        completedAt: isoDaysFrom(nowDate, dayOffset),
        countsTowardGuarantee: true,
        detailsProvidedAt: isoDaysFrom(nowDate, dayOffset - 1),
        employer: connect(employerContext.employer),
        employerContact: connect(employerContext.contact),
        enrollment: connect(enrollment),
        interviewSlot: connect(slot),
        interviewerName: `E2E ${label} Interviewer`,
        interviewState: 'completed',
        locationDetails: 'E2E Employer Office',
        locationType: 'in_person',
        scheduledEndTime: isoDaysHoursFrom(nowDate, dayOffset, 1),
        scheduledStartTime: isoDaysFrom(nowDate, dayOffset),
      },
    });
  };

  const createCompletedProgressionOffer = async ({
    candidateFollowUpState = 'not_due',
    dayOffset,
    employerFollowUpState = 'not_due',
    followUpState = 'not_due',
    label,
    progressionState = 'accepted',
    requestedDaysOffset,
    responseDaysOffset,
  }) => {
    const slot = await documents(strapi, 'api::interview-slot.interview-slot').create({
      data: {
        capacity: 1,
        employer: connect(employerContext.employer),
        employerContact: connect(employerContext.contact),
        endTime: isoDaysHoursFrom(nowDate, dayOffset, 1),
        locationDetails: 'E2E Employer Office',
        locationType: 'in_person',
        region: connect(content.area),
        slotState: 'completed',
        startTime: isoDaysFrom(nowDate, dayOffset),
        workSector: connect(content.sector),
      },
    });
    const interview = await documents(strapi, 'api::interview.interview').create({
      data: {
        arrivalInstructions: `Report to reception for the ${label}.`,
        candidate: connect(candidate),
        candidateInstructions: 'Bring a notebook and ID.',
        completedAt: isoDaysFrom(nowDate, dayOffset),
        countsTowardGuarantee: true,
        detailsProvidedAt: isoDaysFrom(nowDate, dayOffset - 1),
        employer: connect(employerContext.employer),
        employerContact: connect(employerContext.contact),
        enrollment: connect(enrollment),
        interviewSlot: connect(slot),
        interviewerName: `E2E ${label} Interviewer`,
        interviewState: 'completed',
        locationDetails: 'E2E Employer Office',
        locationType: 'in_person',
        scheduledEndTime: isoDaysHoursFrom(nowDate, dayOffset, 1),
        scheduledStartTime: isoDaysFrom(nowDate, dayOffset),
      },
    });

    await createCompletedCandidateOffer(interview, slot, {
      respondedDays: dayOffset - 2,
      responseDeadlineDays: dayOffset - 2,
    });

    const requestedAt = isoDaysFrom(nowDate, requestedDaysOffset ?? dayOffset + 1);
    const respondedAt =
      progressionState === 'requested' || progressionState === 'candidate_notified'
        ? null
        : isoDaysFrom(nowDate, responseDaysOffset ?? dayOffset + 2);

    const progressionRequest = await documents(strapi, 'api::offer.offer').create({
      data: {
        candidate: connect(candidate),
        candidateFollowUpDueAt:
          candidateFollowUpState === 'not_due' ? null : isoDaysFrom(nowDate, -1),
        candidateFollowUpSentAt:
          candidateFollowUpState === 'not_due' ? null : isoDaysFrom(nowDate, -2),
        candidateFollowUpState,
        candidateMessage: `E2E ${label} request for browser coverage.`,
        candidateNotifiedAt: requestedAt,
        candidateResponse:
          progressionState === 'accepted'
            ? 'accepted'
            : progressionState === 'declined'
              ? 'declined'
              : progressionState === 'expired'
                ? 'expired'
                : null,
        candidateResponseDeadline:
          progressionState === 'expired' ? isoDaysFrom(nowDate, -1) : isoDaysFrom(nowDate, 5),
        candidateRespondedAt: respondedAt,
        detailsReleasedAt: progressionState === 'accepted' ? respondedAt : null,
        employer: connect(employerContext.employer),
        employerFollowUpDueAt:
          employerFollowUpState === 'not_due' ? null : isoDaysFrom(nowDate, -1),
        employerFollowUpSentAt:
          employerFollowUpState === 'not_due' ? null : isoDaysFrom(nowDate, -2),
        employerFollowUpState,
        followUpState,
        internalProcessNotes: `E2E seeded ${label} progression coverage.`,
        interview: connect(interview),
        metadata: {
          source: 'e2e_fixture_progression_state_coverage',
        },
        progressionState,
        progressionType: 'second_interview',
        requestedByEmployerContact: connect(employerContext.contact),
        requestedDetailsAt: requestedAt,
      },
    });

    return {
      interview,
      progressionRequest,
      slot,
    };
  };

  if (options.seedCandidateProgressionStateCoverage) {
    const confirmedSlot = await documents(strapi, 'api::interview-slot.interview-slot').create({
      data: {
        capacity: 1,
        employer: connect(employerContext.employer),
        employerContact: connect(employerContext.contact),
        endTime: isoDaysHoursFrom(nowDate, 7, 1),
        locationDetails: 'E2E confirmed office',
        locationType: 'in_person',
        region: connect(content.area),
        slotState: 'booked',
        startTime: isoDaysFrom(nowDate, 7),
        workSector: connect(content.sector),
      },
    });
    const confirmedInterview = await documents(strapi, 'api::interview.interview').create({
      data: {
        arrivalInstructions: 'Ask for the E2E confirmed interview team at reception.',
        candidate: connect(candidate),
        candidateInstructions: 'Bring photo ID and your portfolio.',
        confirmedAt: isoDaysFrom(nowDate, -1),
        countsTowardGuarantee: false,
        detailsProvidedAt: isoDaysFrom(nowDate, -1),
        employer: connect(employerContext.employer),
        employerContact: connect(employerContext.contact),
        enrollment: connect(enrollment),
        interviewSlot: connect(confirmedSlot),
        interviewerName: 'E2E Confirmed Interviewer',
        interviewState: 'confirmed',
        locationDetails: 'E2E confirmed office',
        locationType: 'in_person',
        scheduledEndTime: isoDaysHoursFrom(nowDate, 7, 1),
        scheduledStartTime: isoDaysFrom(nowDate, 7),
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
        selectedInterview: connect(confirmedInterview),
        selectedSlot: connect(confirmedSlot),
      },
    });

    await createCompletedProgressionOffer({
      dayOffset: -16,
      label: 'Decline Progression',
      progressionState: 'requested',
      requestedDaysOffset: -15,
    });
    await createCompletedProgressionOffer({
      candidateFollowUpState: 'sent',
      dayOffset: -34,
      followUpState: 'sent',
      label: 'Candidate Normal Follow Up',
      progressionState: 'accepted',
      requestedDaysOffset: -33,
      responseDaysOffset: -32,
    });
    await createCompletedProgressionOffer({
      dayOffset: -20,
      label: 'Declined Progression History',
      progressionState: 'declined',
      requestedDaysOffset: -19,
      responseDaysOffset: -18,
    });
    await createCompletedProgressionOffer({
      dayOffset: -24,
      label: 'Expired Progression History',
      progressionState: 'expired',
      requestedDaysOffset: -23,
      responseDaysOffset: -21,
    });
    await createCompletedProgressionOffer({
      candidateFollowUpState: 'closed_no_response',
      dayOffset: -50,
      followUpState: 'completed',
      label: 'Closed Follow Up History',
      progressionState: 'accepted',
      requestedDaysOffset: -49,
      responseDaysOffset: -48,
    });
  }

  if (options.seedEmployerProgressionFollowUpCoverage) {
    await createCompletedProgressionOffer({
      dayOffset: -35,
      employerFollowUpState: 'sent',
      followUpState: 'sent',
      label: 'Employer Normal Follow Up',
      progressionState: 'accepted',
      requestedDaysOffset: -34,
      responseDaysOffset: -33,
    });
  }

  const expiredProgressionInterview = await createCompletedProgressionInterview({
    dayOffset: -12,
    label: 'Expired Progression',
  });
  await documents(strapi, 'api::offer.offer').create({
    data: {
      candidate: connect(candidate),
      candidateMessage: 'E2E expired progression request for admin interview operations.',
      candidateNotifiedAt: isoDaysFrom(nowDate, -11),
      candidateResponse: 'expired',
      candidateResponseDeadline: isoDaysFrom(nowDate, -9),
      candidateRespondedAt: isoDaysFrom(nowDate, -8),
      employer: connect(employerContext.employer),
      followUpState: 'not_due',
      internalProcessNotes: 'E2E seeded expired progression request.',
      interview: connect(expiredProgressionInterview),
      metadata: {
        source: 'e2e_fixture_progression_expired',
      },
      progressionState: 'expired',
      progressionType: 'second_interview',
      requestedByEmployerContact: connect(employerContext.contact),
      requestedDetailsAt: isoDaysFrom(nowDate, -11),
    },
  });

  const followUpConcernInterview = await createCompletedProgressionInterview({
    dayOffset: -40,
    label: 'Follow Up Concern',
  });
  await documents(strapi, 'api::offer.offer').create({
    data: {
      candidate: connect(candidate),
      candidateFollowUpDueAt: isoDaysFrom(nowDate, -7),
      candidateFollowUpState: 'sent',
      candidateMessage: 'E2E accepted progression request for follow-up concern coverage.',
      candidateNotifiedAt: isoDaysFrom(nowDate, -39),
      candidateResponse: 'accepted',
      candidateRespondedAt: isoDaysFrom(nowDate, -38),
      candidateResponseDeadline: isoDaysFrom(nowDate, -37),
      detailsReleasedAt: isoDaysFrom(nowDate, -38),
      employer: connect(employerContext.employer),
      employerFollowUpCompletedAt: isoDaysFrom(nowDate, -1),
      employerFollowUpDueAt: isoDaysFrom(nowDate, -7),
      employerFollowUpNotes: 'E2E employer could not get a response from the candidate.',
      employerFollowUpOutcome: 'no_response_from_candidate',
      employerFollowUpResponses: {
        candidateRespondedSince: false,
        supportRequested: true,
      },
      employerFollowUpState: 'completed',
      followUpState: 'completed',
      internalProcessNotes: 'E2E seeded progression follow-up concern.',
      interview: connect(followUpConcernInterview),
      metadata: {
        source: 'e2e_fixture_progression_follow_up_concern',
      },
      progressionState: 'accepted',
      progressionType: 'second_interview',
      requestedByEmployerContact: connect(employerContext.contact),
      requestedDetailsAt: isoDaysFrom(nowDate, -39),
    },
  });

  return {
    candidate,
    completedInterview,
    expiredProgressionInterview,
    feedbackReportInterview,
    followUpConcernInterview,
    followUpDueInterview,
    pendingInterview,
  };
};

const ensureEmployerAvailabilityClaims = async (strapi, content, employerContext) => {
  const nowDate = new Date();
  const now = nowDate.toISOString();
  const lockedByEmail = normalizeEmail(
    optionalEnv('HIREFLIP_E2E_AVAILABILITY_LOCK_CONTACT_EMAIL', 'e2e-availability-lock-contact@hireflip.work')
  );

  await deleteMany(strapi, 'api::employer-contact.employer-contact', {
    email: lockedByEmail,
  });

  const lockContact = await documents(strapi, 'api::employer-contact.employer-contact').create({
    data: {
      accountCreatedAt: now,
      authProvider: 'manual',
      contactRole: 'team_contact',
      contactState: 'active',
      coverageConfirmedAt: now,
      coverageConfirmedByEmail: lockedByEmail,
      coverageRegions: connect(content.area),
      email: lockedByEmail,
      employer: connect(employerContext.employer),
      firstName: 'E2E',
      lastName: 'Lock Contact',
      notificationPreferences: {
        channels: {
          email: true,
        },
      },
      roleTitle: 'Interview coordinator',
    },
  });

  const createScenario = async ({
    assignmentNote,
    candidateVisibleState = 'arranging_interviews',
    claimedInterviewCount = 1,
    email,
    firstName = 'E2E',
    fulfilledInterviewCount = 0,
    insufficientCapacityDetectedAt = null,
    insufficientCapacityReason = null,
    lastName,
    metadata = {},
    phone,
    requestState = 'employer_notified',
    requiredSlotCount = 3,
    seedCapacityClaim = true,
    currentlyOpenByContact = null,
  }) => {
    const normalizedEmail = normalizeEmail(email);
    const existing = await findFirst(strapi, 'api::candidate.candidate', { email: normalizedEmail });

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
        email: normalizedEmail,
        firstName,
        gender: 'prefer_not_to_say',
        lastName,
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
        candidateVisibleState,
        claimedInterviewCount,
        class: connect(content.classRecord),
        employerResponseDeadline: isoDaysFrom(nowDate, 2),
        enrollment: connect(enrollment),
        fulfilledInterviewCount,
        insufficientCapacityDetectedAt,
        insufficientCapacityReason,
        lastRoutedAt: isoDaysFrom(nowDate, -1),
        region: connect(content.area),
        requestedInterviewCount: 2,
        requestState,
        responseSlaWorkingDays: 2,
      },
    });

    const capacityClaim = seedCapacityClaim
      ? await documents(strapi, 'api::employer-capacity-claim.employer-capacity-claim').create({
          data: {
            assignmentNote,
            claimCount: 1,
            claimState: 'notified',
            ...(currentlyOpenByContact
              ? {
                  currentlyOpenAt: now,
                  currentlyOpenByContact: connect(currentlyOpenByContact),
                  currentlyOpenExpiresAt: addMinutes(nowDate, 15).toISOString(),
                }
              : {}),
            employer: connect(employerContext.employer),
            employerContact: connect(employerContext.contact),
            expiresAt: isoDaysFrom(nowDate, 2),
            interviewRequest: connect(interviewRequest),
            metadata,
            notifiedAt: isoDaysFrom(nowDate, -1),
            region: connect(content.area),
            requiredSlotCount,
          },
        })
      : null;

    return {
      candidate,
      capacityClaim,
      enrollment,
      interviewRequest,
    };
  };

  const standard = await createScenario({
    assignmentNote: 'E2E browser fixture open employer availability claim.',
    email: optionalEnv('HIREFLIP_E2E_AVAILABILITY_CANDIDATE_EMAIL', 'e2e-availability-candidate@hireflip.work'),
    lastName: 'Availability Candidate',
    phone: '+447700900126',
  });
  const topUp = await createScenario({
    assignmentNote: 'E2E browser fixture reusable top-up availability claim.',
    email: optionalEnv('HIREFLIP_E2E_AVAILABILITY_TOP_UP_CANDIDATE_EMAIL', 'e2e-availability-top-up-candidate@hireflip.work'),
    lastName: 'Availability Top Up Candidate',
    metadata: {
      purpose: 'reusable_slot_top_up',
      source: 'e2e_fixture',
    },
    phone: '+447700900127',
    requiredSlotCount: 1,
  });
  const decline = await createScenario({
    assignmentNote: 'E2E browser fixture employer decline availability claim.',
    email: optionalEnv('HIREFLIP_E2E_AVAILABILITY_DECLINE_CANDIDATE_EMAIL', 'e2e-availability-decline-candidate@hireflip.work'),
    lastName: 'Availability Decline Candidate',
    phone: '+447700900128',
  });
  const locked = await createScenario({
    assignmentNote: 'E2E browser fixture locked employer availability claim.',
    currentlyOpenByContact: lockContact,
    email: optionalEnv('HIREFLIP_E2E_AVAILABILITY_LOCKED_CANDIDATE_EMAIL', 'e2e-availability-locked-candidate@hireflip.work'),
    lastName: 'Availability Locked Candidate',
    phone: '+447700900129',
  });
  const capacityShortfall = await createScenario({
    assignmentNote: 'E2E browser fixture capacity shortfall request.',
    candidateVisibleState: 'arranging_interviews',
    claimedInterviewCount: 0,
    email: optionalEnv('HIREFLIP_E2E_CAPACITY_SHORTFALL_CANDIDATE_EMAIL', 'e2e-capacity-shortfall-candidate@hireflip.work'),
    fulfilledInterviewCount: 0,
    insufficientCapacityDetectedAt: isoDaysFrom(nowDate, -1),
    insufficientCapacityReason: 'E2E capacity shortfall for browser testing.',
    lastName: 'Capacity Shortfall Candidate',
    phone: '+447700900130',
    requestState: 'pending_capacity',
    seedCapacityClaim: false,
  });

  return {
    capacityShortfall,
    decline,
    locked,
    lockContact,
    standard,
    topUp,
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

const ensureOnboardingEmployer = async (strapi, auth0User, content) => {
  const email = normalizeEmail(
    optionalEnv('HIREFLIP_E2E_ONBOARDING_EMPLOYER_EMAIL', 'e2e-onboarding-employer@hireflip.work')
  );
  const teamContactEmail = normalizeEmail(
    optionalEnv(
      'HIREFLIP_E2E_ONBOARDING_EMPLOYER_TEAM_CONTACT_EMAIL',
      'e2e-onboarding-team-contact@hireflip.work'
    )
  );
  const companyName = optionalEnv(
    'HIREFLIP_E2E_ONBOARDING_EMPLOYER_COMPANY',
    'HireFlip E2E Onboarding Employer'
  );
  const now = new Date().toISOString();

  await deleteMany(strapi, 'api::employer-invite.employer-invite', {
    inviteEmail: email,
  });
  await deleteMany(strapi, 'api::employer-contact.employer-contact', {
    email,
  });
  await deleteMany(strapi, 'api::employer-contact.employer-contact', {
    authIdentityId: auth0User.userId,
  });
  await deleteMany(strapi, 'api::employer-contact.employer-contact', {
    email: teamContactEmail,
  });

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

  const employer = await documents(strapi, 'api::employer.employer').create({
    data: {
      assignmentMode: 'automatic',
      commitmentMode: 'global',
      companyName,
      dashboardOnboardingMetadata: {
        fixture: 'employer-onboarding-e2e',
        resetAt: now,
      },
      dashboardOnboardingState: 'not_started',
      employerState: 'invited',
      initialInterviewCommitmentCadence: 'quarterly',
      initialInterviewCommitmentVolume: 6,
      interviewCommitmentCadence: 'quarterly',
      interviewCommitmentVolume: 6,
      operatingRegions: connect(content.area),
      region: content.area.name,
      salesOwnerStaffEmail: normalizeEmail(requireEnv('HIREFLIP_E2E_ADMIN_EMAIL')),
      salesOwnerStaffDisplayName: 'E2E Admin',
    },
    populate: ['operatingRegions'],
  });

  const contact = await documents(strapi, 'api::employer-contact.employer-contact').create({
    data: {
      accountCreatedAt: now,
      authIdentityId: auth0User.userId,
      authProvider: 'auth0',
      contactRole: 'lead_contact',
      contactState: 'active',
      coverageRegions: connect(content.area),
      email,
      employer: connect(employer),
      firstName: '',
      lastName: '',
      notificationPreferences: {
        channels: {
          email: true,
        },
      },
      roleTitle: '',
    },
    populate: ['coverageRegions', 'employer'],
  });

  return {
    contact,
    employer,
  };
};

const ensureInviteCompleteEmployer = async (strapi, auth0User, content) => {
  const email = normalizeEmail(
    optionalEnv(
      'HIREFLIP_E2E_INVITE_COMPLETE_EMPLOYER_EMAIL',
      'e2e-invite-complete-employer@hireflip.work'
    )
  );
  const companyName = optionalEnv(
    'HIREFLIP_E2E_INVITE_COMPLETE_EMPLOYER_COMPANY',
    'HireFlip E2E Invite Complete Employer'
  );
  const inviteToken = optionalEnv(
    'HIREFLIP_E2E_INVITE_COMPLETE_TOKEN',
    'e2e-invite-complete-token'
  );
  const now = new Date().toISOString();

  await deleteMany(strapi, 'api::employer-invite.employer-invite', {
    inviteEmail: email,
  });
  await deleteMany(strapi, 'api::employer-invite.employer-invite', {
    authIdentityId: auth0User.userId,
  });
  await deleteMany(strapi, 'api::employer-contact.employer-contact', {
    email,
  });
  await deleteMany(strapi, 'api::employer-contact.employer-contact', {
    authIdentityId: auth0User.userId,
  });

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

  const employer = await documents(strapi, 'api::employer.employer').create({
    data: {
      assignmentMode: 'automatic',
      commitmentMode: 'global',
      companyName,
      dashboardOnboardingMetadata: {
        fixture: 'employer-invite-complete-e2e',
        resetAt: now,
      },
      dashboardOnboardingState: 'not_started',
      employerState: 'invited',
      initialInterviewCommitmentCadence: 'quarterly',
      initialInterviewCommitmentVolume: 4,
      interviewCommitmentCadence: 'quarterly',
      interviewCommitmentVolume: 4,
      operatingRegions: connect(content.area),
      region: content.area.name,
      salesOwnerStaffEmail: normalizeEmail(requireEnv('HIREFLIP_E2E_ADMIN_EMAIL')),
      salesOwnerStaffDisplayName: 'E2E Admin',
    },
    populate: ['operatingRegions'],
  });

  const contact = await documents(strapi, 'api::employer-contact.employer-contact').create({
    data: {
      authProvider: 'auth0',
      contactRole: 'lead_contact',
      contactState: 'invited',
      coverageRegions: connect(content.area),
      email,
      employer: connect(employer),
      firstName: 'E2E',
      lastName: 'Invite Complete',
      notificationPreferences: {
        channels: {
          email: true,
        },
      },
      roleTitle: 'Hiring lead',
    },
    populate: ['coverageRegions', 'employer'],
  });

  const invite = await documents(strapi, 'api::employer-invite.employer-invite').create({
    data: {
      authIdentityId: auth0User.userId,
      authProvisionedAt: now,
      createdByStaffDisplayName: 'E2E Admin',
      createdByStaffEmail: normalizeEmail(requireEnv('HIREFLIP_E2E_ADMIN_EMAIL')),
      deliveryState: 'queued',
      employer: connect(employer),
      employerContact: connect(contact),
      expiresAt: isoDaysFrom(new Date(), 7),
      inviteEmail: email,
      inviteState: 'pending',
      lastSentAt: now,
      metadata: {
        fixture: 'employer-invite-complete-e2e',
        resetAt: now,
      },
      tokenHash: hashInviteToken(inviteToken),
    },
    populate: ['employer', 'employerContact'],
  });

  return {
    contact,
    employer,
    invite,
  };
};

const resetBlockedEmployerAuth0Fixture = async (strapi, auth0User) => {
  const email = normalizeEmail(
    optionalEnv('HIREFLIP_E2E_BLOCKED_EMPLOYER_EMAIL', 'e2e-blocked-employer@hireflip.work')
  );

  await deleteMany(strapi, 'api::employer-invite.employer-invite', {
    inviteEmail: email,
  });
  await deleteMany(strapi, 'api::employer-contact.employer-contact', {
    email,
  });
  await deleteMany(strapi, 'api::employer-contact.employer-contact', {
    authIdentityId: auth0User.userId,
  });

  return {
    email,
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
    const courseProgressClass = await ensureCourseProgressClass(strapi, content);
    const assessmentContent = await ensureCourseAssessmentContent(strapi, content);
    const staffUser = await ensureStaffUser(strapi);
    const candidateAuth0User = await ensureAuth0User({
      connectionName: requireEnv('AUTH0_CANDIDATE_CONNECTION_NAME'),
      email: requireEnv('HIREFLIP_E2E_CANDIDATE_EMAIL'),
      firstName: optionalEnv('HIREFLIP_E2E_CANDIDATE_FIRST_NAME', 'E2E'),
      lastName: optionalEnv('HIREFLIP_E2E_CANDIDATE_LAST_NAME', 'Candidate'),
      password: requireEnv('HIREFLIP_E2E_CANDIDATE_PASSWORD'),
    });
    const courseCandidateAuth0User = await ensureAuth0User({
      connectionName: requireEnv('AUTH0_CANDIDATE_CONNECTION_NAME'),
      email: optionalEnv('HIREFLIP_E2E_COURSE_CANDIDATE_EMAIL', 'e2e-course-candidate@hireflip.work'),
      firstName: optionalEnv('HIREFLIP_E2E_COURSE_CANDIDATE_FIRST_NAME', 'E2E'),
      lastName: optionalEnv('HIREFLIP_E2E_COURSE_CANDIDATE_LAST_NAME', 'Course Candidate'),
      password: optionalEnv('HIREFLIP_E2E_COURSE_CANDIDATE_PASSWORD', requireEnv('HIREFLIP_E2E_CANDIDATE_PASSWORD')),
    });
    const courseAppealCandidateAuth0User = await ensureAuth0User({
      connectionName: requireEnv('AUTH0_CANDIDATE_CONNECTION_NAME'),
      email: optionalEnv('HIREFLIP_E2E_COURSE_APPEAL_CANDIDATE_EMAIL', 'e2e-course-appeal-candidate@hireflip.work'),
      firstName: optionalEnv('HIREFLIP_E2E_COURSE_APPEAL_CANDIDATE_FIRST_NAME', 'E2E'),
      lastName: optionalEnv('HIREFLIP_E2E_COURSE_APPEAL_CANDIDATE_LAST_NAME', 'Course Appeal Candidate'),
      password: optionalEnv('HIREFLIP_E2E_COURSE_APPEAL_CANDIDATE_PASSWORD', requireEnv('HIREFLIP_E2E_CANDIDATE_PASSWORD')),
    });
    const interviewCandidateAuth0User = await ensureAuth0User({
      connectionName: requireEnv('AUTH0_CANDIDATE_CONNECTION_NAME'),
      email: optionalEnv('HIREFLIP_E2E_INTERVIEW_CANDIDATE_EMAIL', 'e2e-interview-candidate@hireflip.work'),
      firstName: optionalEnv('HIREFLIP_E2E_INTERVIEW_CANDIDATE_FIRST_NAME', 'E2E'),
      lastName: optionalEnv('HIREFLIP_E2E_INTERVIEW_CANDIDATE_LAST_NAME', 'Interview Candidate'),
      password: optionalEnv('HIREFLIP_E2E_INTERVIEW_CANDIDATE_PASSWORD', requireEnv('HIREFLIP_E2E_CANDIDATE_PASSWORD')),
    });
    const progressionCandidateAuth0User = await ensureAuth0User({
      connectionName: requireEnv('AUTH0_CANDIDATE_CONNECTION_NAME'),
      email: optionalEnv('HIREFLIP_E2E_PROGRESSION_CANDIDATE_EMAIL', 'e2e-progression-candidate@hireflip.work'),
      firstName: optionalEnv('HIREFLIP_E2E_PROGRESSION_CANDIDATE_FIRST_NAME', 'E2E'),
      lastName: optionalEnv('HIREFLIP_E2E_PROGRESSION_CANDIDATE_LAST_NAME', 'Progression Candidate'),
      password: optionalEnv('HIREFLIP_E2E_PROGRESSION_CANDIDATE_PASSWORD', requireEnv('HIREFLIP_E2E_CANDIDATE_PASSWORD')),
    });
    const employerFollowUpCandidateAuth0User = await ensureAuth0User({
      connectionName: requireEnv('AUTH0_CANDIDATE_CONNECTION_NAME'),
      email: optionalEnv(
        'HIREFLIP_E2E_EMPLOYER_FOLLOW_UP_CANDIDATE_EMAIL',
        'e2e-employer-follow-up-candidate@hireflip.work'
      ),
      firstName: optionalEnv('HIREFLIP_E2E_EMPLOYER_FOLLOW_UP_CANDIDATE_FIRST_NAME', 'E2E'),
      lastName: optionalEnv(
        'HIREFLIP_E2E_EMPLOYER_FOLLOW_UP_CANDIDATE_LAST_NAME',
        'Employer Follow Up Candidate'
      ),
      password: optionalEnv(
        'HIREFLIP_E2E_EMPLOYER_FOLLOW_UP_CANDIDATE_PASSWORD',
        requireEnv('HIREFLIP_E2E_CANDIDATE_PASSWORD')
      ),
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
    const privacyAnonymiseCandidateAuth0User = await ensureAuth0User({
      connectionName: requireEnv('AUTH0_CANDIDATE_CONNECTION_NAME'),
      email: optionalEnv(
        'HIREFLIP_E2E_PRIVACY_ANONYMISE_CANDIDATE_EMAIL',
        'e2e-privacy-anonymise-candidate@hireflip.work'
      ),
      firstName: optionalEnv('HIREFLIP_E2E_PRIVACY_ANONYMISE_CANDIDATE_FIRST_NAME', 'E2E'),
      lastName: optionalEnv(
        'HIREFLIP_E2E_PRIVACY_ANONYMISE_CANDIDATE_LAST_NAME',
        'Privacy Anonymise Candidate'
      ),
      password: optionalEnv(
        'HIREFLIP_E2E_PRIVACY_ANONYMISE_CANDIDATE_PASSWORD',
        requireEnv('HIREFLIP_E2E_CANDIDATE_PASSWORD')
      ),
    });
    const employerAuth0User = await ensureAuth0User({
      connectionName: requireEnv('AUTH0_EMPLOYER_CONNECTION_NAME'),
      email: requireEnv('HIREFLIP_E2E_EMPLOYER_EMAIL'),
      firstName: optionalEnv('HIREFLIP_E2E_EMPLOYER_FIRST_NAME', 'E2E'),
      lastName: optionalEnv('HIREFLIP_E2E_EMPLOYER_LAST_NAME', 'Employer'),
      password: requireEnv('HIREFLIP_E2E_EMPLOYER_PASSWORD'),
    });
    const onboardingEmployerAuth0User = await ensureAuth0User({
      connectionName: requireEnv('AUTH0_EMPLOYER_CONNECTION_NAME'),
      email: optionalEnv('HIREFLIP_E2E_ONBOARDING_EMPLOYER_EMAIL', 'e2e-onboarding-employer@hireflip.work'),
      firstName: optionalEnv('HIREFLIP_E2E_ONBOARDING_EMPLOYER_FIRST_NAME', 'E2E'),
      lastName: optionalEnv('HIREFLIP_E2E_ONBOARDING_EMPLOYER_LAST_NAME', 'Onboarding Employer'),
      password: optionalEnv('HIREFLIP_E2E_ONBOARDING_EMPLOYER_PASSWORD', requireEnv('HIREFLIP_E2E_EMPLOYER_PASSWORD')),
    });
    const inviteCompleteEmployerAuth0User = await ensureAuth0User({
      connectionName: requireEnv('AUTH0_EMPLOYER_CONNECTION_NAME'),
      email: optionalEnv(
        'HIREFLIP_E2E_INVITE_COMPLETE_EMPLOYER_EMAIL',
        'e2e-invite-complete-employer@hireflip.work'
      ),
      firstName: optionalEnv('HIREFLIP_E2E_INVITE_COMPLETE_EMPLOYER_FIRST_NAME', 'E2E'),
      lastName: optionalEnv(
        'HIREFLIP_E2E_INVITE_COMPLETE_EMPLOYER_LAST_NAME',
        'Invite Complete Employer'
      ),
      password: optionalEnv(
        'HIREFLIP_E2E_INVITE_COMPLETE_EMPLOYER_PASSWORD',
        requireEnv('HIREFLIP_E2E_EMPLOYER_PASSWORD')
      ),
    });
    const blockedEmployerAuth0User = await ensureAuth0User({
      connectionName: requireEnv('AUTH0_EMPLOYER_CONNECTION_NAME'),
      email: optionalEnv('HIREFLIP_E2E_BLOCKED_EMPLOYER_EMAIL', 'e2e-blocked-employer@hireflip.work'),
      firstName: optionalEnv('HIREFLIP_E2E_BLOCKED_EMPLOYER_FIRST_NAME', 'E2E'),
      lastName: optionalEnv('HIREFLIP_E2E_BLOCKED_EMPLOYER_LAST_NAME', 'Blocked Employer'),
      password: optionalEnv('HIREFLIP_E2E_BLOCKED_EMPLOYER_PASSWORD', requireEnv('HIREFLIP_E2E_EMPLOYER_PASSWORD')),
    });
    const candidate = await ensureCandidate(strapi, candidateAuth0User, content);
    const courseProgressCandidate = await ensureCourseProgressCandidate(
      strapi,
      courseCandidateAuth0User,
      content,
      courseProgressClass
    );
    const courseAppealCandidate = await ensureCourseAppealSubmissionCandidate(
      strapi,
      courseAppealCandidateAuth0User,
      content,
      courseProgressClass,
      assessmentContent
    );
    const privacyAnonymisationFixtures = await ensureCandidatePrivacyAnonymisationFixtures(
      strapi,
      content,
      privacyAnonymiseCandidateAuth0User,
      courseProgressCandidate.candidate
    );
    const employer = await ensureEmployer(strapi, employerAuth0User, content);
    const onboardingEmployer = await ensureOnboardingEmployer(
      strapi,
      onboardingEmployerAuth0User,
      content
    );
    const inviteCompleteEmployer = await ensureInviteCompleteEmployer(
      strapi,
      inviteCompleteEmployerAuth0User,
      content
    );
    const blockedEmployer = await resetBlockedEmployerAuth0Fixture(
      strapi,
      blockedEmployerAuth0User
    );
    const adminActionEmployer = await ensureAdminActionEmployer(strapi, content);
    const adminActionCandidate = await ensureReviewCandidate(strapi, content, {
      candidateState: 'in_class',
      email: optionalEnv(
        'HIREFLIP_E2E_ADMIN_ACTION_CANDIDATE_EMAIL',
        'e2e-admin-action-candidate@hireflip.work'
      ),
      firstName: optionalEnv('HIREFLIP_E2E_ADMIN_ACTION_CANDIDATE_FIRST_NAME', 'E2E'),
      lastName: optionalEnv('HIREFLIP_E2E_ADMIN_ACTION_CANDIDATE_LAST_NAME', 'Admin Action Candidate'),
      phone: optionalEnv('HIREFLIP_E2E_ADMIN_ACTION_CANDIDATE_PHONE', '+447700900136'),
    });
    const resetAnnouncements = await resetClassAnnouncements(strapi, content.classRecord);
    const candidatePrivacyExportRequest = await ensureCandidatePrivacyExportRequest(strapi, candidate);
    const employerPrivacyExportRequest = await ensureEmployerPrivacyExportRequest(strapi, employer.contact);
    const candidateNotificationIssue = await ensureCandidateNotificationIssue(strapi, candidate);
    const interviewCandidate = await ensureInterviewCandidate(
      strapi,
      interviewCandidateAuth0User,
      content,
      employer
    );
    const progressionCandidate = await ensureInterviewCandidate(
      strapi,
      progressionCandidateAuth0User,
      content,
      employer,
      {
        email: optionalEnv('HIREFLIP_E2E_PROGRESSION_CANDIDATE_EMAIL', 'e2e-progression-candidate@hireflip.work'),
        firstName: optionalEnv('HIREFLIP_E2E_PROGRESSION_CANDIDATE_FIRST_NAME', 'E2E'),
        lastName: optionalEnv('HIREFLIP_E2E_PROGRESSION_CANDIDATE_LAST_NAME', 'Progression Candidate'),
        phone: optionalEnv('HIREFLIP_E2E_PROGRESSION_CANDIDATE_PHONE', '+447700900137'),
        seedActiveSlotOffer: false,
        seedCandidateProgressionStateCoverage: true,
        seedPublicFeedbackInvite: false,
      }
    );
    const employerFollowUpCandidate = await ensureInterviewCandidate(
      strapi,
      employerFollowUpCandidateAuth0User,
      content,
      employer,
      {
        email: optionalEnv(
          'HIREFLIP_E2E_EMPLOYER_FOLLOW_UP_CANDIDATE_EMAIL',
          'e2e-employer-follow-up-candidate@hireflip.work'
        ),
        firstName: optionalEnv('HIREFLIP_E2E_EMPLOYER_FOLLOW_UP_CANDIDATE_FIRST_NAME', 'E2E'),
        lastName: optionalEnv(
          'HIREFLIP_E2E_EMPLOYER_FOLLOW_UP_CANDIDATE_LAST_NAME',
          'Employer Follow Up Candidate'
        ),
        phone: optionalEnv('HIREFLIP_E2E_EMPLOYER_FOLLOW_UP_CANDIDATE_PHONE', '+447700900138'),
        seedEmployerProgressionFollowUpCoverage: true,
        seedPublicFeedbackInvite: false,
      }
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
        seedActiveStrike: true,
      }
    );
    const availabilityClaims = await ensureEmployerAvailabilityClaims(strapi, content, employer);
    const approvedAppealReview = await ensureAssessmentAppealReviewFixture(
      strapi,
      content,
      assessmentContent,
      {
        email: optionalEnv(
          'HIREFLIP_E2E_APPEAL_APPROVE_CANDIDATE_EMAIL',
          'e2e-appeal-approve-candidate@hireflip.work'
        ),
        lastName: 'Appeal Approve Candidate',
        phone: '+447700900131',
        reason:
          'E2E browser appeal approval fixture: I ran out of attempts while waiting for support review.',
        scenario: 'appeal_approve',
      }
    );
    const rejectedAppealReview = await ensureAssessmentAppealReviewFixture(
      strapi,
      content,
      assessmentContent,
      {
        attemptNumber: 3,
        email: optionalEnv(
          'HIREFLIP_E2E_APPEAL_REJECT_CANDIDATE_EMAIL',
          'e2e-appeal-reject-candidate@hireflip.work'
        ),
        lastName: 'Appeal Reject Candidate',
        phone: '+447700900132',
        reason:
          'E2E browser appeal rejection fixture: I disagree with the score but have no new evidence.',
        scenario: 'appeal_reject',
      }
    );
    const refusedRefundReview = await ensureRefundReviewFixture(strapi, content, employer, {
      email: optionalEnv(
        'HIREFLIP_E2E_REFUND_REFUSE_CANDIDATE_EMAIL',
        'e2e-refund-refuse-candidate@hireflip.work'
      ),
      lastName: 'Refund Refuse Candidate',
      originalAmountPence: 10000,
      phone: '+447700900133',
      reason:
        'E2E browser refund refusal fixture: candidate asks for refund despite receiving qualifying interview support.',
      scenario: 'refund_refuse',
    });
    const escalatedRefundReview = await ensureRefundReviewFixture(strapi, content, employer, {
      email: optionalEnv(
        'HIREFLIP_E2E_REFUND_ESCALATE_CANDIDATE_EMAIL',
        'e2e-refund-escalate-candidate@hireflip.work'
      ),
      lastName: 'Refund Escalate Candidate',
      originalAmountPence: 12000,
      phone: '+447700900134',
      reason:
        'E2E browser refund escalation fixture: candidate missed the guaranteed interview threshold.',
      scenario: 'refund_escalate',
    });

    strapi.log.info(
      `E2E fixtures ready: ${JSON.stringify({
        admin: { email: staffUser.email, roleKey: staffUser.roleKey },
        candidate: { documentId: candidate.documentId, email: candidate.email },
        courseProgressCandidate: {
          classDocumentId: courseProgressClass.documentId,
          documentId: courseProgressCandidate.candidate.documentId,
          email: courseProgressCandidate.candidate.email,
          enrollmentDocumentId: courseProgressCandidate.enrollment.documentId,
        },
        courseAppealCandidate: {
          classDocumentId: courseProgressClass.documentId,
          documentId: courseAppealCandidate.candidate.documentId,
          email: courseAppealCandidate.candidate.email,
          enrollmentDocumentId: courseAppealCandidate.enrollment.documentId,
        },
        candidatePrivacyExportRequest: {
          documentId: candidatePrivacyExportRequest.documentId,
        },
        employerPrivacyExportRequest: {
          documentId: employerPrivacyExportRequest?.documentId || null,
        },
        candidateNotificationIssue: {
          documentId: candidateNotificationIssue.documentId,
          eventType: candidateNotificationIssue.eventType,
        },
        candidatePrivacyAnonymisation: {
          blockedRequestDocumentId: privacyAnonymisationFixtures.blockedRequest.documentId,
          disposableCandidateEmail: privacyAnonymisationFixtures.disposableCandidate.email,
          disposableRequestDocumentId: privacyAnonymisationFixtures.disposableRequest.documentId,
        },
        adminActionCandidate: {
          documentId: adminActionCandidate.documentId,
          email: adminActionCandidate.email,
        },
        interviewCandidate: {
          documentId: interviewCandidate.candidate.documentId,
          email: interviewCandidate.candidate.email,
        },
        progressionCandidate: {
          documentId: progressionCandidate.candidate.documentId,
          email: progressionCandidate.candidate.email,
        },
        employerFollowUpCandidate: {
          documentId: employerFollowUpCandidate.candidate.documentId,
          email: employerFollowUpCandidate.candidate.email,
        },
        declineCandidate: {
          documentId: declineCandidate.candidate.documentId,
          email: declineCandidate.candidate.email,
          strikeDocumentId: declineCandidate.activeStrike?.documentId || null,
        },
        availabilityClaims: {
          standard: {
            candidateEmail: availabilityClaims.standard.candidate.email,
            documentId: availabilityClaims.standard.capacityClaim?.documentId || null,
          },
          topUp: {
            candidateEmail: availabilityClaims.topUp.candidate.email,
            documentId: availabilityClaims.topUp.capacityClaim?.documentId || null,
          },
          decline: {
            candidateEmail: availabilityClaims.decline.candidate.email,
            documentId: availabilityClaims.decline.capacityClaim?.documentId || null,
          },
          locked: {
            candidateEmail: availabilityClaims.locked.candidate.email,
            documentId: availabilityClaims.locked.capacityClaim?.documentId || null,
            lockedBy: availabilityClaims.lockContact.email,
          },
          capacityShortfall: {
            candidateEmail: availabilityClaims.capacityShortfall.candidate.email,
            documentId: availabilityClaims.capacityShortfall.interviewRequest.documentId,
          },
        },
        assessmentAppeals: {
          approve: {
            candidateEmail: approvedAppealReview.candidate.email,
            documentId: approvedAppealReview.appeal.documentId,
          },
          reject: {
            candidateEmail: rejectedAppealReview.candidate.email,
            documentId: rejectedAppealReview.appeal.documentId,
          },
        },
        class: {
          documentId: content.classRecord.documentId,
          resetAnnouncements,
          title: content.classRecord.displayTitle,
        },
        employer: {
          contactDocumentId: employer.contact.documentId,
          documentId: employer.employer.documentId,
          email: employer.contact.email,
        },
        onboardingEmployer: {
          contactDocumentId: onboardingEmployer.contact.documentId,
          documentId: onboardingEmployer.employer.documentId,
          email: onboardingEmployer.contact.email,
        },
        inviteCompleteEmployer: {
          contactDocumentId: inviteCompleteEmployer.contact.documentId,
          documentId: inviteCompleteEmployer.employer.documentId,
          email: inviteCompleteEmployer.contact.email,
          inviteDocumentId: inviteCompleteEmployer.invite.documentId,
        },
        blockedEmployer,
        adminActionEmployer: {
          contactDocumentId: adminActionEmployer.contact.documentId,
          documentId: adminActionEmployer.employer.documentId,
          email: adminActionEmployer.contact.email,
        },
        refundReviews: {
          escalate: {
            candidateEmail: escalatedRefundReview.candidate.email,
            documentId: escalatedRefundReview.refund.documentId,
          },
          refuse: {
            candidateEmail: refusedRefundReview.candidate.email,
            documentId: refusedRefundReview.refund.documentId,
          },
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

#!/usr/bin/env node

const { compileStrapi, createStrapi } = require('@strapi/strapi');

process.env.CLASS_WORKFLOW_BOOTSTRAP_ENABLED = 'false';

const upsertBySlug = async (strapi, uid, slug, data, populate = []) => {
  const existingRecords = await strapi.documents(uid).findMany({
    filters: { slug },
    limit: 1,
    populate,
  });
  const existingRecord = existingRecords[0];

  if (existingRecord) {
    return strapi.documents(uid).update({
      documentId: existingRecord.documentId,
      data,
      populate,
    });
  }

  return strapi.documents(uid).create({
    data,
    populate,
  });
};

const upsertCourse = async (strapi, data) => {
  const existingRecords = await strapi.documents('api::course.course').findMany({
    filters: {
      name: data.name,
      version: data.version,
    },
    limit: 1,
  });
  const existingRecord = existingRecords[0];

  if (existingRecord) {
    return strapi.documents('api::course.course').update({
      documentId: existingRecord.documentId,
      data,
    });
  }

  return strapi.documents('api::course.course').create({ data });
};

const upsertCourseSection = async (strapi, course, data) => {
  const existingRecords = await strapi.documents('api::course-section.course-section').findMany({
    filters: {
      course: {
        documentId: course.documentId,
      },
      title: data.title,
    },
    limit: 1,
    populate: ['course'],
  });
  const existingRecord = existingRecords[0];
  const nextData = {
    ...data,
    course: connectDocument(course),
  };

  if (existingRecord) {
    return strapi.documents('api::course-section.course-section').update({
      documentId: existingRecord.documentId,
      data: nextData,
      populate: ['course'],
    });
  }

  return strapi.documents('api::course-section.course-section').create({
    data: nextData,
    populate: ['course'],
  });
};

const upsertCourseModule = async (strapi, courseSection, data) => {
  const existingRecords = await strapi.documents('api::course-module.course-module').findMany({
    filters: {
      courseSection: {
        documentId: courseSection.documentId,
      },
      title: data.title,
    },
    limit: 1,
    populate: ['courseSection'],
  });
  const existingRecord = existingRecords[0];
  const nextData = {
    ...data,
    courseSection: connectDocument(courseSection),
  };

  if (existingRecord) {
    return strapi.documents('api::course-module.course-module').update({
      documentId: existingRecord.documentId,
      data: nextData,
      populate: ['courseSection'],
    });
  }

  return strapi.documents('api::course-module.course-module').create({
    data: nextData,
    populate: ['courseSection'],
  });
};

const upsertCourseMaterial = async (strapi, courseModule, data) => {
  const existingRecords = await strapi.documents('api::course-material.course-material').findMany({
    filters: {
      module: {
        documentId: courseModule.documentId,
      },
      title: data.title,
    },
    limit: 1,
    populate: ['module'],
  });
  const existingRecord = existingRecords[0];
  const nextData = {
    ...data,
    module: connectDocument(courseModule),
  };

  if (existingRecord) {
    return strapi.documents('api::course-material.course-material').update({
      documentId: existingRecord.documentId,
      data: nextData,
      populate: ['module'],
    });
  }

  return strapi.documents('api::course-material.course-material').create({
    data: nextData,
    populate: ['module'],
  });
};

const upsertCourseTest = async (strapi, courseModule, data) => {
  const existingRecords = await strapi.documents('api::course-test.course-test').findMany({
    filters: {
      courseModule: {
        documentId: courseModule.documentId,
      },
      title: data.title,
    },
    limit: 1,
    populate: ['courseModule'],
  });
  const existingRecord = existingRecords[0];
  const nextData = {
    ...data,
    courseModule: connectDocument(courseModule),
  };

  if (existingRecord) {
    return strapi.documents('api::course-test.course-test').update({
      documentId: existingRecord.documentId,
      data: nextData,
      populate: ['courseModule'],
    });
  }

  return strapi.documents('api::course-test.course-test').create({
    data: nextData,
    populate: ['courseModule'],
  });
};

const upsertCourseQuestion = async (strapi, courseTest, data) => {
  const existingRecords = await strapi.documents('api::course-question.course-question').findMany({
    filters: {
      courseTest: {
        documentId: courseTest.documentId,
      },
      sortOrder: data.sortOrder,
    },
    limit: 1,
    populate: ['courseTest'],
  });
  const existingRecord = existingRecords[0];
  const nextData = {
    ...data,
    courseTest: connectDocument(courseTest),
  };

  if (existingRecord) {
    return strapi.documents('api::course-question.course-question').update({
      documentId: existingRecord.documentId,
      data: nextData,
      populate: ['courseTest'],
    });
  }

  return strapi.documents('api::course-question.course-question').create({
    data: nextData,
    populate: ['courseTest'],
  });
};

const upsertPolicyDocument = async (strapi, data) => {
  const existingRecords = await strapi.documents('api::policy-document.policy-document').findMany({
    filters: {
      policyKey: data.policyKey,
    },
    limit: 1,
  });
  const existingRecord = existingRecords[0];

  if (existingRecord) {
    return strapi.documents('api::policy-document.policy-document').update({
      documentId: existingRecord.documentId,
      data,
    });
  }

  return strapi.documents('api::policy-document.policy-document').create({ data });
};

const upsertClass = async (strapi, data) => {
  const existingRecords = await strapi.documents('api::class.class').findMany({
    filters: { name: data.name },
    limit: 1,
    populate: ['classArea', 'workSector', 'course'],
  });
  const existingRecord = existingRecords[0];

  if (existingRecord) {
    return strapi.documents('api::class.class').update({
      documentId: existingRecord.documentId,
      data,
      populate: ['classArea', 'workSector', 'course'],
    });
  }

  return strapi.documents('api::class.class').create({
    data,
    populate: ['classArea', 'workSector', 'course'],
  });
};

const connectDocument = (record) => ({
  connect: [{ documentId: record.documentId }],
});

const main = async () => {
  const appContext = await compileStrapi();
  const strapi = await createStrapi(appContext).load();

  try {
    const london = await upsertBySlug(strapi, 'api::class-area.class-area', 'london', {
      country: 'United Kingdom',
      name: 'London',
      notes: 'Initial launch area for HireFlip.',
      slug: 'london',
      sortOrder: 10,
      state: 'active',
    });
    const manchester = await upsertBySlug(strapi, 'api::class-area.class-area', 'manchester', {
      country: 'United Kingdom',
      name: 'Manchester',
      notes: 'Planned follow-on city after the London launch.',
      slug: 'manchester',
      sortOrder: 20,
      state: 'coming_soon',
    });
    const marketing = await upsertBySlug(strapi, 'api::work-sector.work-sector', 'marketing', {
      name: 'Marketing',
      notes: 'Initial launch sector for entry-level candidate classes.',
      slug: 'marketing',
      sortOrder: 10,
      state: 'active',
    });

    await upsertBySlug(strapi, 'api::work-sector.work-sector', 'accounting', {
      name: 'Accounting',
      notes: 'Future sector for expansion demand capture.',
      slug: 'accounting',
      sortOrder: 20,
      state: 'coming_soon',
    });

    const launchCourse = await upsertCourse(strapi, {
      description:
        'Launch version of the HireFlip entry-level marketing readiness class. Content will be replaced or expanded once the white-labelled course is selected.',
      name: 'Entry-Level Marketing Readiness',
      sector: 'Marketing',
      sourceReference: 'HireFlip internal launch outline',
      sourceType: 'internal',
      courseState: 'active',
      version: 'launch-v1',
    });

    const demoSection = await upsertCourseSection(strapi, launchCourse, {
      description:
        'Internal demo section used to build and review the course workflow before the final provider course is selected.',
      required: true,
      sectionState: 'active',
      sortOrder: 10,
      title: 'Demo Section: Marketing Foundations',
    });

    const demoModuleOne = await upsertCourseModule(strapi, demoSection, {
      description:
        'A short reading module covering what a junior marketing team does day to day.',
      moduleState: 'active',
      required: true,
      sortOrder: 10,
      title: 'What marketing teams do',
    });
    const demoModuleTwo = await upsertCourseModule(strapi, demoSection, {
      description:
        'A short video module showing how to think about a simple campaign brief.',
      moduleState: 'active',
      required: true,
      sortOrder: 20,
      title: 'Reading a campaign brief',
    });
    const demoModuleThree = await upsertCourseModule(strapi, demoSection, {
      description:
        'A checkpoint module with simple questions so the test flow can be built against real records.',
      moduleState: 'active',
      required: true,
      sortOrder: 30,
      title: 'Campaign readiness checkpoint',
    });

    await upsertCourseMaterial(strapi, demoModuleOne, {
      body: [
        'Marketing teams help a business understand an audience, communicate clearly, and measure whether activity is working.',
        'A junior marketer may help with research, social posts, email checks, campaign reporting, meeting notes, and keeping work organised.',
        'The important skill is not knowing every tool on day one. It is being prepared, curious, reliable, and able to turn feedback into better work.',
      ].join('\n\n'),
      completionMode: 'read_to_end',
      estimatedDurationMinutes: 8,
      materialState: 'active',
      materialType: 'text',
      required: true,
      requiredCompletionPercentage: 100,
      sortOrder: 10,
      sourceReference: 'HireFlip internal demo content',
      title: 'Marketing team basics',
    });

    await upsertCourseMaterial(strapi, demoModuleTwo, {
      completionMode: 'watch_percentage',
      estimatedDurationMinutes: 5,
      materialState: 'active',
      materialType: 'video',
      required: true,
      requiredCompletionPercentage: 90,
      sortOrder: 10,
      sourceReference: 'Vimeo placeholder embed for course workflow development',
      title: 'Demo video: campaign brief walkthrough',
      url: 'https://player.vimeo.com/video/76979871',
    });

    await upsertCourseMaterial(strapi, demoModuleThree, {
      body: [
        'Before answering the checkpoint questions, think about the difference between activity and evidence.',
        'A campaign task is not complete because a post was written. It is complete when the team can explain who it was for, what action was expected, and how success will be checked.',
      ].join('\n\n'),
      completionMode: 'read_to_end',
      estimatedDurationMinutes: 6,
      materialState: 'active',
      materialType: 'text',
      required: true,
      requiredCompletionPercentage: 100,
      sortOrder: 10,
      sourceReference: 'HireFlip internal demo content',
      title: 'Before the checkpoint',
    });

    const demoTest = await upsertCourseTest(strapi, demoModuleThree, {
      attemptLimit: 3,
      copyPasteRestrictionEnabled: true,
      description:
        'Simple internal demo checkpoint used to build the course test flow. This is not production course content.',
      maxScore: 3,
      passMark: 70,
      questionRandomizationEnabled: false,
      testState: 'active',
      timeLimitMinutes: 10,
      title: 'Marketing foundations checkpoint',
    });

    await upsertCourseQuestion(strapi, demoTest, {
      correctAnswerPayload: {
        correctOptionIds: ['audience'],
      },
      options: [
        { id: 'audience', label: 'Who the campaign is trying to reach' },
        { id: 'logo', label: 'Only the colour of the logo' },
        { id: 'lunch', label: 'Where the team is having lunch' },
      ],
      prompt: 'What does audience usually mean in a campaign brief?',
      questionState: 'active',
      questionType: 'single_choice',
      scoringRubric: {
        points: 1,
      },
      sortOrder: 10,
    });
    await upsertCourseQuestion(strapi, demoTest, {
      correctAnswerPayload: {
        correctOptionIds: ['evidence'],
      },
      options: [
        { id: 'guess', label: 'Guess whether the work felt busy' },
        { id: 'evidence', label: 'Use evidence such as clicks, replies, signups, or qualified leads' },
        { id: 'ignore', label: 'Ignore results once the post is live' },
      ],
      prompt: 'What is the best way to check whether a marketing activity worked?',
      questionState: 'active',
      questionType: 'single_choice',
      scoringRubric: {
        points: 1,
      },
      sortOrder: 20,
    });
    await upsertCourseQuestion(strapi, demoTest, {
      correctAnswerPayload: {
        correctOptionIds: ['reliable', 'feedback'],
      },
      options: [
        { id: 'reliable', label: 'Be reliable with small tasks and deadlines' },
        { id: 'feedback', label: 'Use feedback to improve the next piece of work' },
        { id: 'secret', label: 'Avoid asking questions so nobody knows you are new' },
      ],
      prompt: 'Which behaviours help a junior marketer build trust early?',
      questionState: 'active',
      questionType: 'multiple_choice',
      scoringRubric: {
        points: 1,
      },
      sortOrder: 30,
    });

    const checkoutTerms = await upsertPolicyDocument(strapi, {
      acceptanceLabel:
        'I have read and accept the HireFlip class checkout terms for this reservation.',
      body: [
        'Your payment secures one place on the named HireFlip class for the candidate account shown in this checkout. The temporary reservation is only confirmed when HireFlip receives provider-verified payment confirmation.',
        'The checkout reservation is time-limited. If the reservation expires before payment is confirmed, the place may be released or offered to another candidate. If you cancel or a card payment fails while the reservation is still active, you can retry payment from the checkout page until the reservation expires.',
        'HireFlip uses Stripe to process payment. HireFlip does not store raw card details. Stripe may run fraud, authentication, and bank checks before confirming payment.',
        'After payment is confirmed, your dashboard will show the class as enrolled. You are expected to complete the online class work, tests, and interview preparation tasks within the class rules shown in your dashboard.',
        'The HireFlip interview guarantee depends on you meeting the class completion, conduct, availability, and interview-readiness requirements. The checkout summary may show a held guarantee amount for product clarity, but refund eligibility is determined by the published class, guarantee, and refund rules in force for your accepted terms version.',
        'If HireFlip cannot safely apply a provider-confirmed payment to your reservation, the payment may be held for manual review. HireFlip will review the record, update your class state, and contact you if a refund or correction is needed.',
        'HireFlip may update future terms versions. The version accepted for this reservation is recorded with your reservation and audit history. A new reservation or a newer active terms version may require fresh acceptance before payment is unlocked.',
      ].join('\n\n'),
      effectiveFrom: '2026-06-02T00:00:00.000Z',
      internalNotes:
        'Launch checkout terms copy for product testing and admin-managed versioning. Exact legal wording remains subject to legal review.',
      introCopy:
        'Review the class checkout terms before paying. These terms explain how your reservation, payment confirmation, retry window, and interview guarantee handling work.',
      policyKey: 'class_checkout_terms:class-checkout-terms-launch-v1',
      policyState: 'active',
      policyType: 'class_checkout_terms',
      title: 'HireFlip Class Checkout Terms',
      version: 'class-checkout-terms-launch-v1',
    });

    const sharedClassContent = {
      capacity: 30,
      currency: 'GBP',
      discountedPricePence: 32000,
      faqs: [
        {
          question: 'Who is this class for?',
          answer:
            'People preparing for entry-level marketing roles who want structured office-readiness, interview preparation, and a clearer route into first-stage interviews.',
        },
        {
          question: 'When do interviews happen?',
          answer:
            'Successful candidates move into the interview phase after passing the class. Exact interview windows depend on employer availability.',
        },
      ],
      includedItems: [
        'Online marketing fundamentals',
        'Office-readiness and workplace expectations',
        'Module tests and completion tracking',
        'CV and interview preparation support',
        'Two guaranteed first-stage interviews for successful candidates',
      ],
      interviewsGuaranteed: 2,
      level: 'Entry',
      moduleSummary:
        'The class will cover marketing fundamentals, day-to-day junior marketing tasks, office etiquette, communication expectations, interview preparation, and practical readiness checks.',
      overview:
        'A paid online HireFlip class for entry-level marketing candidates. Register interest now and we will notify you when places are ready to secure.',
      employerInterviewAvailabilityThresholdPercentage: 150,
      interestThresholdPercentage: 200,
      modulesPassCriteriaAttached: true,
      openingMode: 'admin_scheduled',
      pricePence: 80000,
      requirements:
        'Candidates should be ready to commit to the full class window, complete module work online, and engage with interview preparation once they pass.',
      scheduleNotes:
        'The first class is planned as a controlled launch class. Exact dates will be confirmed once candidate demand and employer interview capacity are aligned.',
      state: 'coming_soon',
    };

    const londonClass = await upsertClass(strapi, {
      ...sharedClassContent,
      classArea: connectDocument(london),
      course: connectDocument(launchCourse),
      displayTitle: 'London Entry-Level Marketing - First Class',
      name: 'London Entry-Level Marketing - First Class',
      officialClassCode: 'Class 2026-01',
      region: 'London',
      sector: 'Marketing',
      slug: '2026-01-london-marketing-first-class',
      startDate: '2026-07-01',
      workSector: connectDocument(marketing),
      year: 2026,
      yearSequenceNumber: 1,
    });

    const manchesterClass = await upsertClass(strapi, {
      ...sharedClassContent,
      classArea: connectDocument(manchester),
      course: connectDocument(launchCourse),
      displayTitle: 'Manchester Entry-Level Marketing - First Class',
      name: 'Manchester Entry-Level Marketing - First Class',
      officialClassCode: 'Class 2026-02',
      region: 'Manchester',
      sector: 'Marketing',
      slug: '2026-02-manchester-marketing-first-class',
      startDate: '2026-10-01',
      workSector: connectDocument(marketing),
      year: 2026,
      yearSequenceNumber: 2,
    });

    const summary = {
      classAreas: [london.name, manchester.name],
      classes: [londonClass.name, manchesterClass.name],
      course: launchCourse.name,
      demoCourseSetup: {
        modules: [demoModuleOne.title, demoModuleTwo.title, demoModuleThree.title],
        section: demoSection.title,
        test: demoTest.title,
      },
      policies: [checkoutTerms.policyKey],
      workSectors: ['Marketing', 'Accounting'],
    };

    strapi.log.info(`Seeded HireFlip content: ${JSON.stringify(summary)}`);
  } finally {
    await strapi.destroy();
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

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
      modulesPassCriteriaAttached: false,
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

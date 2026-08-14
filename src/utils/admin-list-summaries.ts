type DocumentRecord = Record<string, unknown> & {
  documentId?: string;
};

type DocumentCollection = {
  count(input: Record<string, unknown>): Promise<number>;
  findMany(input: Record<string, unknown>): Promise<DocumentRecord[]>;
  update(input: Record<string, unknown>): Promise<DocumentRecord>;
};

export type SummaryStrapi = {
  documents(uid: string): unknown;
  log?: {
    error?: (message: string, error?: unknown) => void;
  };
};

const documents = (strapi: SummaryStrapi, uid: string) =>
  strapi.documents(uid) as DocumentCollection;

const getDocumentId = (record?: unknown) => {
  if (!record || typeof record !== 'object') {
    return undefined;
  }

  const documentId = (record as DocumentRecord).documentId;
  return typeof documentId === 'string' && documentId ? documentId : undefined;
};

const stringValue = (value: unknown) =>
  typeof value === 'string' ? value.trim() : '';

const displayName = (record?: DocumentRecord | null) =>
  [record?.firstName, record?.lastName]
    .map(stringValue)
    .filter(Boolean)
    .join(' ') || stringValue(record?.email);

const normalizeSortKey = (value: unknown) => stringValue(value).toLocaleLowerCase('en-GB');

const candidateReadinessSummary = (profile?: DocumentRecord | null, now = Date.now()) => {
  if (profile?.profileState !== 'completed') {
    return {
      expiresAt: null,
      rank: 1,
      state: 'incomplete',
    };
  }

  const availabilityConfirmedAt = stringValue(profile.availabilityConfirmedAt);
  const availabilityExpiresAt = stringValue(profile.availabilityExpiresAt);
  const availabilityExpiry = Date.parse(availabilityExpiresAt);

  if (
    availabilityConfirmedAt &&
    availabilityExpiresAt &&
    Number.isFinite(availabilityExpiry) &&
    availabilityExpiry > now
  ) {
    return {
      expiresAt: availabilityExpiresAt,
      rank: 2,
      state: 'ready',
    };
  }

  return {
    expiresAt: availabilityExpiresAt || null,
    rank: 0,
    state: 'availability_expired',
  };
};

const classLabelFromEnrollment = (enrollment?: DocumentRecord | null) => {
  const classRecord = enrollment?.class as DocumentRecord | undefined;

  return stringValue(classRecord?.displayTitle || classRecord?.name) || null;
};

export const selectEmployerLeadContact = (contacts: DocumentRecord[] = []) => {
  const stateRank: Record<string, number> = {
    active: 0,
    listed: 1,
    invited: 2,
    disabled: 3,
    archived: 4,
  };

  return [...contacts].sort((left, right) => {
    const stateDifference =
      (stateRank[stringValue(left.contactState)] ?? 5) -
      (stateRank[stringValue(right.contactState)] ?? 5);

    if (stateDifference !== 0) {
      return stateDifference;
    }

    const roleDifference =
      (left.contactRole === 'lead_contact' ? 0 : 1) -
      (right.contactRole === 'lead_contact' ? 0 : 1);

    if (roleDifference !== 0) {
      return roleDifference;
    }

    return normalizeSortKey(displayName(left)).localeCompare(
      normalizeSortKey(displayName(right)),
      'en-GB'
    );
  })[0] || null;
};

export const rebuildCandidateAdminListSummary = async (
  strapi: SummaryStrapi,
  candidateDocumentId: string
) => {
  const [candidateRecords, enrollments, profiles] = await Promise.all([
    documents(strapi, 'api::candidate.candidate').findMany({
      filters: { documentId: candidateDocumentId },
      limit: 1,
    }),
    documents(strapi, 'api::enrollment.enrollment').findMany({
      filters: {
        candidate: {
          documentId: candidateDocumentId,
        },
      },
      limit: 1,
      populate: ['class'],
      sort: ['updatedAt:desc', 'createdAt:desc'],
    }),
    documents(strapi, 'api::candidate-profile.candidate-profile').findMany({
      filters: {
        candidate: {
          documentId: candidateDocumentId,
        },
      },
      limit: 1,
      sort: ['updatedAt:desc', 'createdAt:desc'],
    }),
  ]);

  if (!candidateRecords[0]) {
    return null;
  }

  const classLabel = classLabelFromEnrollment(enrollments[0]);
  const readiness = candidateReadinessSummary(profiles[0]);

  return documents(strapi, 'api::candidate.candidate').update({
    documentId: candidateDocumentId,
    data: {
      adminListClassLabel: classLabel,
      adminListClassSortKey: normalizeSortKey(classLabel),
      adminListReadinessExpiresAt: readiness.expiresAt,
      adminListReadinessRank: readiness.rank,
      adminListReadinessState: readiness.state,
    },
  });
};

export const rebuildEmployerAdminListSummary = async (
  strapi: SummaryStrapi,
  employerDocumentId: string
) => {
  const [employerRecords, contacts, inviteCount, pendingInviteCount] = await Promise.all([
    documents(strapi, 'api::employer.employer').findMany({
      filters: { documentId: employerDocumentId },
      limit: 1,
    }),
    documents(strapi, 'api::employer-contact.employer-contact').findMany({
      filters: {
        employer: {
          documentId: employerDocumentId,
        },
      },
      limit: 1000,
    }),
    documents(strapi, 'api::employer-invite.employer-invite').count({
      filters: {
        employer: {
          documentId: employerDocumentId,
        },
      },
    }),
    documents(strapi, 'api::employer-invite.employer-invite').count({
      filters: {
        employer: {
          documentId: employerDocumentId,
        },
        inviteState: 'pending',
      },
    }),
  ]);

  if (!employerRecords[0]) {
    return null;
  }

  const leadContact = selectEmployerLeadContact(contacts);

  return documents(strapi, 'api::employer.employer').update({
    documentId: employerDocumentId,
    data: {
      adminListInviteCount: inviteCount,
      adminListLeadContactSortKey: normalizeSortKey(displayName(leadContact)),
      adminListPendingInviteCount: pendingInviteCount,
    },
  });
};

const findAllDocumentIds = async (strapi: SummaryStrapi, uid: string) => {
  const collection = documents(strapi, uid);
  const total = await collection.count({ filters: {} });
  const documentIds: string[] = [];

  for (let start = 0; start < total; start += 100) {
    const records = await collection.findMany({
      fields: ['documentId'],
      limit: 100,
      start,
    });

    documentIds.push(...records.map(getDocumentId).filter((value): value is string => Boolean(value)));
  }

  return documentIds;
};

export const rebuildAllAdminListSummaries = async (strapi: SummaryStrapi) => {
  const [candidateDocumentIds, employerDocumentIds] = await Promise.all([
    findAllDocumentIds(strapi, 'api::candidate.candidate'),
    findAllDocumentIds(strapi, 'api::employer.employer'),
  ]);

  for (const candidateDocumentId of candidateDocumentIds) {
    await rebuildCandidateAdminListSummary(strapi, candidateDocumentId);
  }

  for (const employerDocumentId of employerDocumentIds) {
    await rebuildEmployerAdminListSummary(strapi, employerDocumentId);
  }

  return {
    candidates: candidateDocumentIds.length,
    employers: employerDocumentIds.length,
  };
};

export const reconcileExpiredCandidateReadinessSummaries = async (
  strapi: SummaryStrapi,
  now = new Date()
) => {
  const candidateDocuments = documents(strapi, 'api::candidate.candidate');
  let updated = 0;

  while (true) {
    const dueCandidates = await candidateDocuments.findMany({
      fields: ['documentId'],
      filters: {
        adminListReadinessExpiresAt: {
          $lte: now.toISOString(),
        },
        adminListReadinessState: 'ready',
      },
      limit: 100,
    });

    if (dueCandidates.length === 0) {
      break;
    }

    for (const candidate of dueCandidates) {
      const candidateDocumentId = getDocumentId(candidate);

      if (!candidateDocumentId) {
        continue;
      }

      await candidateDocuments.update({
        documentId: candidateDocumentId,
        data: {
          adminListReadinessRank: 0,
          adminListReadinessState: 'availability_expired',
        },
      });
      updated += 1;
    }
  }

  return updated;
};

export const relatedDocumentId = async (
  strapi: SummaryStrapi,
  uid: string,
  recordDocumentId: string | undefined,
  relation: string
) => {
  if (!recordDocumentId) {
    return undefined;
  }

  const records = await documents(strapi, uid).findMany({
    filters: { documentId: recordDocumentId },
    limit: 1,
    populate: [relation],
  });

  return getDocumentId(records[0]?.[relation]);
};

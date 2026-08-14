import {
  rebuildCandidateAdminListSummary,
  relatedDocumentId,
  type SummaryStrapi,
} from '../../../../utils/admin-list-summaries';

type LifecycleEvent = {
  result?: Record<string, unknown> & { documentId?: string };
};

const runtimeStrapi = () =>
  (globalThis as typeof globalThis & { strapi?: SummaryStrapi }).strapi;

const refreshCandidateSummary = async (event: LifecycleEvent) => {
  const strapi = runtimeStrapi();

  if (!strapi) {
    return;
  }

  const candidateDocumentId = await relatedDocumentId(
    strapi,
    'api::enrollment.enrollment',
    event.result?.documentId,
    'candidate'
  );

  if (candidateDocumentId) {
    await rebuildCandidateAdminListSummary(strapi, candidateDocumentId);
  }
};

export default {
  afterCreate: refreshCandidateSummary,
  afterUpdate: refreshCandidateSummary,
};

import {
  rebuildEmployerAdminListSummary,
  relatedDocumentId,
  type SummaryStrapi,
} from '../../../../utils/admin-list-summaries';

type LifecycleEvent = {
  result?: Record<string, unknown> & { documentId?: string };
};

const runtimeStrapi = () =>
  (globalThis as typeof globalThis & { strapi?: SummaryStrapi }).strapi;

const refreshEmployerSummary = async (event: LifecycleEvent) => {
  const strapi = runtimeStrapi();

  if (!strapi) {
    return;
  }

  const employerDocumentId = await relatedDocumentId(
    strapi,
    'api::employer-invite.employer-invite',
    event.result?.documentId,
    'employer'
  );

  if (employerDocumentId) {
    await rebuildEmployerAdminListSummary(strapi, employerDocumentId);
  }
};

export default {
  afterCreate: refreshEmployerSummary,
  afterUpdate: refreshEmployerSummary,
};

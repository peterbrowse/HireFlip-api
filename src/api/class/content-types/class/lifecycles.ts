import {
  publishCandidateClassRealtimeEvent,
  publishClassRealtimeEvent,
} from '../../../../utils/class-realtime-events';

type DocumentRecord = Record<string, unknown> & {
  documentId?: string;
  candidate?: DocumentRecord;
};

type DocumentCollection = {
  findMany(input: Record<string, unknown>): Promise<DocumentRecord[]>;
};

type StrapiDocumentService = {
  documents(uid: string): unknown;
  log?: {
    error?: (message: string, error?: unknown) => void;
  };
};

type LifecycleEvent = {
  result?: DocumentRecord;
};

const lifecycleRealtimeEnabled = () => {
  const workflowBootstrap = (process.env.CLASS_WORKFLOW_BOOTSTRAP_ENABLED || 'true').toLowerCase();
  const realtimeLifecycle = (process.env.CLASS_REALTIME_LIFECYCLE_ENABLED || 'true').toLowerCase();

  return !['0', 'false', 'no', 'off'].includes(workflowBootstrap) &&
    !['0', 'false', 'no', 'off'].includes(realtimeLifecycle);
};

const documents = (strapi: StrapiDocumentService, uid: string) =>
  strapi.documents(uid) as unknown as DocumentCollection;

const publishClassUpdate = async (strapi: StrapiDocumentService, classRecord?: DocumentRecord) => {
  const classDocumentId = classRecord?.documentId;

  if (!classDocumentId) {
    return;
  }

  await publishClassRealtimeEvent(
    {
      classDocumentId,
      type: 'class_state_changed',
    },
    strapi.log
  );

  const enrollments = await documents(strapi, 'api::enrollment.enrollment').findMany({
    filters: {
      class: {
        documentId: classDocumentId,
      },
    },
    limit: 1000,
    populate: ['candidate'],
  });

  await Promise.all(
    enrollments.map((enrollment) => {
      const candidateDocumentId = enrollment.candidate?.documentId;

      if (!candidateDocumentId) {
        return Promise.resolve();
      }

      return publishCandidateClassRealtimeEvent(
        {
          candidateDocumentId,
          classDocumentId,
          type: 'class_state_changed',
        },
        strapi.log
      );
    })
  );
};

const runtimeStrapi = () => (globalThis as typeof globalThis & { strapi?: StrapiDocumentService }).strapi;

export default {
  async afterCreate(event: LifecycleEvent) {
    const strapi = runtimeStrapi();

    if (!strapi || !lifecycleRealtimeEnabled()) {
      return;
    }

    await publishClassUpdate(strapi, event.result);
  },
  async afterUpdate(event: LifecycleEvent) {
    const strapi = runtimeStrapi();

    if (!strapi || !lifecycleRealtimeEnabled()) {
      return;
    }

    await publishClassUpdate(strapi, event.result);
  },
};

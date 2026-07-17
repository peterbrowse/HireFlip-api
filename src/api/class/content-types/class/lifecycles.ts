import {
  publishCandidateClassRealtimeEvent,
  publishClassRealtimeEvent,
} from '../../../../utils/class-realtime-events';

type DocumentRecord = Record<string, unknown> & {
  documentId?: string;
  candidate?: DocumentRecord;
};

type DocumentCollection = {
  count(input: Record<string, unknown>): Promise<number>;
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

const findAllDocuments = async (
  strapi: StrapiDocumentService,
  uid: string,
  input: Record<string, unknown>,
  pageSize = 100
) => {
  const collection = documents(strapi, uid);
  const total = await collection.count({ filters: input.filters || {} });
  const records: DocumentRecord[] = [];

  for (let start = 0; start < total; start += pageSize) {
    records.push(
      ...(await collection.findMany({
        ...input,
        limit: pageSize,
        start,
      }))
    );
  }

  return records;
};

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

  const enrollments = await findAllDocuments(strapi, 'api::enrollment.enrollment', {
    filters: {
      class: {
        documentId: classDocumentId,
      },
    },
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

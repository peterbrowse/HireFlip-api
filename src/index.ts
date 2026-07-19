import type { Core } from '@strapi/strapi';
import {
  scheduleGuaranteeRefundReconciliationJob,
  scheduleInterviewWorkflowReconciliationJob,
  schedulePaymentReconciliationJob,
  startClassWorkflowWorker,
  stopClassWorkflowQueue,
  syncWaitingListOfferExpiryJobs,
} from './utils/class-workflow-queue';
import { disconnectAdminRealtimePublisher } from './utils/admin-realtime-events';

const backgroundBootstrapEnabled = () => {
  const value = (process.env.CLASS_WORKFLOW_BOOTSTRAP_ENABLED || 'true').toLowerCase();

  return !['0', 'false', 'no', 'off'].includes(value);
};

type MigrationStore = {
  get(input: { key: string }): Promise<unknown>;
  set(input: { key: string; value: unknown }): Promise<void>;
};

type AdminTaskStateMigrationConnection = {
  (tableName: string): {
    delete(): Promise<number>;
    first(): Promise<Record<string, unknown> | undefined>;
    insert(values: Record<string, unknown>): Promise<unknown>;
    select(...columns: string[]): Promise<Record<string, unknown>[]>;
    update(values: Record<string, unknown>): Promise<number>;
    where(values: Record<string, unknown>): AdminTaskStateMigrationConnectionQuery;
    whereIn(column: string, values: string[]): AdminTaskStateMigrationConnectionQuery;
    whereNot(values: Record<string, unknown>): AdminTaskStateMigrationConnectionQuery;
    whereNotNull(column: string): AdminTaskStateMigrationConnectionQuery;
  };
  raw(sql: string, bindings?: unknown[]): unknown;
  schema: {
    hasColumn(tableName: string, columnName: string): Promise<boolean>;
    hasTable(tableName: string): Promise<boolean>;
  };
};

type AdminTaskStateMigrationConnectionQuery = {
  delete(): Promise<number>;
  first(): Promise<Record<string, unknown> | undefined>;
  insert(values: Record<string, unknown>): Promise<unknown>;
  select(...columns: string[]): Promise<Record<string, unknown>[]>;
  update(values: Record<string, unknown>): Promise<number>;
  where(values: Record<string, unknown>): AdminTaskStateMigrationConnectionQuery;
  whereIn(column: string, values: string[]): AdminTaskStateMigrationConnectionQuery;
  whereNot(values: Record<string, unknown>): AdminTaskStateMigrationConnectionQuery;
  whereNotNull(column: string): AdminTaskStateMigrationConnectionQuery;
};

const adminTaskStateMigrationKey = 'admin-task-task-state-column-v1';
const adminTaskStates = ['open', 'acknowledged', 'resolved', 'dismissed'];
const paymentWebhookProviderEventUniqueMigrationKey =
  'payment-webhook-event-provider-event-id-unique-v1';
const paymentWebhookProviderEventUniqueIndex =
  'payment_webhook_events_provider_event_id_uq';
const refundIdempotencyUniqueMigrationKey = 'refund-idempotency-key-unique-v1';
const refundIdempotencyUniqueIndex = 'refunds_idempotency_key_uq';
const auditEventIdempotencyUniqueMigrationKey = 'audit-event-idempotency-key-unique-v1';
const auditEventIdempotencyUniqueIndex = 'audit_events_idempotency_key_uq';

const getMigrationStore = (strapi: Core.Strapi) =>
  strapi.store({
    type: 'plugin',
    name: 'hireflip-migrations',
  }) as unknown as MigrationStore;

const migrateAdminTaskStateColumn = async (strapi: Core.Strapi) => {
  const store = getMigrationStore(strapi);
  const migrationState = (await store.get({ key: adminTaskStateMigrationKey })) as
    | { complete?: boolean }
    | undefined;

  if (migrationState?.complete) {
    return;
  }

  const connection = (strapi as unknown as { db?: { connection?: unknown } }).db
    ?.connection as AdminTaskStateMigrationConnection | undefined;

  if (!connection?.schema || typeof connection.raw !== 'function') {
    return;
  }

  const hasAdminTasksTable = await connection.schema.hasTable('admin_tasks');

  if (!hasAdminTasksTable) {
    return;
  }

  const [hasOldStatusColumn, hasTaskStateColumn] = await Promise.all([
    connection.schema.hasColumn('admin_tasks', 'status'),
    connection.schema.hasColumn('admin_tasks', 'task_state'),
  ]);

  if (hasOldStatusColumn && hasTaskStateColumn) {
    await connection('admin_tasks')
      .whereNotNull('status')
      .whereIn('status', adminTaskStates)
      .update({
        task_state: connection.raw('??', ['status']),
      });
  }

  await store.set({
    key: adminTaskStateMigrationKey,
    value: {
      complete: true,
      migratedAt: new Date().toISOString(),
    },
  });
};

const paymentWebhookStateRank = (state: unknown) => {
  if (state === 'processed') {
    return 0;
  }

  if (state === 'ignored') {
    return 1;
  }

  if (state === 'received') {
    return 2;
  }

  if (state === 'failed') {
    return 3;
  }

  return 4;
};

const timestampValue = (value: unknown) => {
  const timestamp = Date.parse(typeof value === 'string' ? value : '');

  return Number.isFinite(timestamp) ? timestamp : 0;
};

const paymentWebhookKeeperSort = (
  left: Record<string, unknown>,
  right: Record<string, unknown>
) =>
  paymentWebhookStateRank(left.processing_state) - paymentWebhookStateRank(right.processing_state) ||
  timestampValue(right.processed_at) - timestampValue(left.processed_at) ||
  timestampValue(right.updated_at) - timestampValue(left.updated_at) ||
  timestampValue(right.created_at) - timestampValue(left.created_at) ||
  Number(left.id || 0) - Number(right.id || 0);

const copyWebhookRelationLinks = async (
  connection: AdminTaskStateMigrationConnection,
  tableName: string,
  relationColumn: string,
  fromWebhookEventId: unknown,
  toWebhookEventId: unknown
) => {
  const links = await connection(tableName)
    .where({ payment_webhook_event_id: fromWebhookEventId })
    .select(relationColumn);

  for (const link of links) {
    const relationId = link[relationColumn];

    if (!relationId) {
      continue;
    }

    const existingLink = await connection(tableName)
      .where({
        payment_webhook_event_id: toWebhookEventId,
        [relationColumn]: relationId,
      })
      .first();

    if (!existingLink) {
      await connection(tableName).insert({
        payment_webhook_event_id: toWebhookEventId,
        [relationColumn]: relationId,
      });
    }
  }
};

const consolidateDuplicatePaymentWebhookEvents = async (
  connection: AdminTaskStateMigrationConnection
) => {
  const rows = await connection('payment_webhook_events')
    .whereNotNull('provider_event_id')
    .select(
      'id',
      'provider_event_id',
      'processing_state',
      'processed_at',
      'updated_at',
      'created_at'
    );
  const rowsByProviderEventId = rows.reduce<Record<string, Record<string, unknown>[]>>(
    (groups, row) => {
      const providerEventId =
        typeof row.provider_event_id === 'string' ? row.provider_event_id.trim() : '';

      if (!providerEventId) {
        return groups;
      }

      groups[providerEventId] = [...(groups[providerEventId] || []), row];
      return groups;
    },
    {}
  );

  for (const group of Object.values(rowsByProviderEventId)) {
    if (group.length < 2) {
      continue;
    }

    const [keeper, ...duplicates] = [...group].sort(paymentWebhookKeeperSort);

    for (const duplicate of duplicates) {
      await copyWebhookRelationLinks(
        connection,
        'payment_webhook_events_payment_lnk',
        'payment_id',
        duplicate.id,
        keeper.id
      );
      await copyWebhookRelationLinks(
        connection,
        'payment_webhook_events_refund_lnk',
        'refund_id',
        duplicate.id,
        keeper.id
      );
      await connection('payment_webhook_events_payment_lnk')
        .where({ payment_webhook_event_id: duplicate.id })
        .delete();
      await connection('payment_webhook_events_refund_lnk')
        .where({ payment_webhook_event_id: duplicate.id })
        .delete();
      await connection('payment_webhook_events')
        .where({ id: duplicate.id })
        .delete();
    }
  }
};

const migratePaymentWebhookProviderEventUniqueness = async (strapi: Core.Strapi) => {
  const store = getMigrationStore(strapi);
  const migrationState = (await store.get({
    key: paymentWebhookProviderEventUniqueMigrationKey,
  })) as
    | { complete?: boolean }
    | undefined;

  if (migrationState?.complete) {
    return;
  }

  const connection = (strapi as unknown as { db?: { connection?: unknown } }).db
    ?.connection as AdminTaskStateMigrationConnection | undefined;

  if (!connection?.schema || typeof connection.raw !== 'function') {
    return;
  }

  const [hasWebhookTable, hasProviderEventColumn] = await Promise.all([
    connection.schema.hasTable('payment_webhook_events'),
    connection.schema.hasColumn('payment_webhook_events', 'provider_event_id'),
  ]);

  if (!hasWebhookTable || !hasProviderEventColumn) {
    return;
  }

  await consolidateDuplicatePaymentWebhookEvents(connection);
  await connection.raw(
    [
      `create unique index if not exists ${paymentWebhookProviderEventUniqueIndex}`,
      'on payment_webhook_events (provider_event_id)',
      'where provider_event_id is not null',
    ].join(' ')
  );

  await store.set({
    key: paymentWebhookProviderEventUniqueMigrationKey,
    value: {
      complete: true,
      migratedAt: new Date().toISOString(),
    },
  });
};

const migrateRefundIdempotencyUniqueness = async (strapi: Core.Strapi) => {
  const store = getMigrationStore(strapi);
  const migrationState = (await store.get({
    key: refundIdempotencyUniqueMigrationKey,
  })) as
    | { complete?: boolean }
    | undefined;

  if (migrationState?.complete) {
    return;
  }

  const connection = (strapi as unknown as { db?: { connection?: unknown } }).db
    ?.connection as AdminTaskStateMigrationConnection | undefined;

  if (!connection?.schema || typeof connection.raw !== 'function') {
    return;
  }

  const [hasRefundTable, hasIdempotencyColumn] = await Promise.all([
    connection.schema.hasTable('refunds'),
    connection.schema.hasColumn('refunds', 'idempotency_key'),
  ]);

  if (!hasRefundTable || !hasIdempotencyColumn) {
    return;
  }

  await connection.raw(
    [
      `create unique index if not exists ${refundIdempotencyUniqueIndex}`,
      'on refunds (idempotency_key)',
      'where idempotency_key is not null',
    ].join(' ')
  );

  await store.set({
    key: refundIdempotencyUniqueMigrationKey,
    value: {
      complete: true,
      migratedAt: new Date().toISOString(),
    },
  });
};

const migrateAuditEventIdempotencyUniqueness = async (strapi: Core.Strapi) => {
  const store = getMigrationStore(strapi);
  const migrationState = (await store.get({
    key: auditEventIdempotencyUniqueMigrationKey,
  })) as
    | { complete?: boolean }
    | undefined;

  if (migrationState?.complete) {
    return;
  }

  const connection = (strapi as unknown as { db?: { connection?: unknown } }).db
    ?.connection as AdminTaskStateMigrationConnection | undefined;

  if (!connection?.schema || typeof connection.raw !== 'function') {
    return;
  }

  const [hasAuditEventTable, hasIdempotencyColumn] = await Promise.all([
    connection.schema.hasTable('audit_events'),
    connection.schema.hasColumn('audit_events', 'idempotency_key'),
  ]);

  if (!hasAuditEventTable || !hasIdempotencyColumn) {
    return;
  }

  await connection.raw(
    [
      `create unique index if not exists ${auditEventIdempotencyUniqueIndex}`,
      'on audit_events (idempotency_key)',
      'where idempotency_key is not null',
    ].join(' ')
  );

  await store.set({
    key: auditEventIdempotencyUniqueMigrationKey,
    value: {
      complete: true,
      migratedAt: new Date().toISOString(),
    },
  });
};

export default {
  /**
   * An asynchronous register function that runs before
   * your application is initialized.
   *
   * This gives you an opportunity to extend code.
   */
  register(/* { strapi }: { strapi: Core.Strapi } */) {},

  /**
   * An asynchronous bootstrap function that runs before
   * your application gets started.
   *
   * This gives you an opportunity to set up your data model,
   * run jobs, or perform some special logic.
   */
  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    await migrateAdminTaskStateColumn(strapi).catch((error) => {
      strapi.log.error('Admin task state migration failed.', error);
    });
    await migratePaymentWebhookProviderEventUniqueness(strapi).catch((error) => {
      strapi.log.error('Payment webhook provider event uniqueness migration failed.', error);
    });
    await migrateRefundIdempotencyUniqueness(strapi).catch((error) => {
      strapi.log.error('Refund idempotency-key uniqueness migration failed.', error);
    });
    await migrateAuditEventIdempotencyUniqueness(strapi).catch((error) => {
      strapi.log.error('Audit-event idempotency-key uniqueness migration failed.', error);
    });

    if (!backgroundBootstrapEnabled()) {
      return;
    }

    startClassWorkflowWorker(strapi);
    void syncWaitingListOfferExpiryJobs(strapi).catch((error) => {
      strapi.log.error('Waiting-list offer expiry job sync failed.', error);
    });
    void schedulePaymentReconciliationJob().catch((error) => {
      strapi.log.error('Payment reconciliation job scheduling failed.', error);
    });
    void scheduleGuaranteeRefundReconciliationJob().catch((error) => {
      strapi.log.error('Guarantee refund reconciliation job scheduling failed.', error);
    });
    void scheduleInterviewWorkflowReconciliationJob().catch((error) => {
      strapi.log.error('Interview workflow reconciliation job scheduling failed.', error);
    });
  },

  async destroy({ strapi }: { strapi: Core.Strapi }) {
    await disconnectAdminRealtimePublisher().catch((error) => {
      strapi.log.error('Admin realtime publisher shutdown failed.', error);
    });
    await stopClassWorkflowQueue().catch((error) => {
      strapi.log.error('Class workflow queue shutdown failed.', error);
    });
  },
};

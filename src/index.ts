import type { Core } from '@strapi/strapi';
import {
  schedulePaymentReconciliationJob,
  startClassWorkflowWorker,
  stopClassWorkflowQueue,
  syncWaitingListOfferExpiryJobs,
} from './utils/class-workflow-queue';

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
    update(values: Record<string, unknown>): Promise<number>;
    whereIn(column: string, values: string[]): AdminTaskStateMigrationConnectionQuery;
    whereNotNull(column: string): AdminTaskStateMigrationConnectionQuery;
  };
  raw(sql: string, bindings?: unknown[]): unknown;
  schema: {
    hasColumn(tableName: string, columnName: string): Promise<boolean>;
    hasTable(tableName: string): Promise<boolean>;
  };
};

type AdminTaskStateMigrationConnectionQuery = {
  update(values: Record<string, unknown>): Promise<number>;
  whereIn(column: string, values: string[]): AdminTaskStateMigrationConnectionQuery;
  whereNotNull(column: string): AdminTaskStateMigrationConnectionQuery;
};

const adminTaskStateMigrationKey = 'admin-task-task-state-column-v1';
const adminTaskStates = ['open', 'acknowledged', 'resolved', 'dismissed'];

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
  },

  async destroy({ strapi }: { strapi: Core.Strapi }) {
    await stopClassWorkflowQueue().catch((error) => {
      strapi.log.error('Class workflow queue shutdown failed.', error);
    });
  },
};

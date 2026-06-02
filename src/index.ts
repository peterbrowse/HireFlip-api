import type { Core } from '@strapi/strapi';
import {
  schedulePaymentReconciliationJob,
  startClassWorkflowWorker,
  syncWaitingListOfferExpiryJobs,
} from './utils/class-workflow-queue';

const backgroundBootstrapEnabled = () => {
  const value = (process.env.CLASS_WORKFLOW_BOOTSTRAP_ENABLED || 'true').toLowerCase();

  return !['0', 'false', 'no', 'off'].includes(value);
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
  bootstrap({ strapi }: { strapi: Core.Strapi }) {
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
};

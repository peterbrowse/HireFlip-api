const adminDashboardServicePolicy = {
  name: 'global::service-token',
  config: {
    allowedServices: ['admin-dashboard'],
  },
};

export default {
  routes: [
    {
      method: 'POST',
      path: '/internal/admin/refunds/reviews',
      handler: 'admin-refund.list',
      config: {
        auth: false,
        policies: [adminDashboardServicePolicy],
      },
    },
    {
      method: 'POST',
      path: '/internal/admin/refunds/reviews/detail',
      handler: 'admin-refund.detail',
      config: {
        auth: false,
        policies: [adminDashboardServicePolicy],
      },
    },
    {
      method: 'POST',
      path: '/internal/admin/refunds/reviews/refuse',
      handler: 'admin-refund.refuse',
      config: {
        auth: false,
        policies: [adminDashboardServicePolicy],
      },
    },
    {
      method: 'POST',
      path: '/internal/admin/refunds/reviews/escalate',
      handler: 'admin-refund.escalate',
      config: {
        auth: false,
        policies: [adminDashboardServicePolicy],
      },
    },
    {
      method: 'POST',
      path: '/internal/admin/refunds/reviews/execute',
      handler: 'admin-refund.execute',
      config: {
        auth: false,
        policies: [adminDashboardServicePolicy],
      },
    },
  ],
};

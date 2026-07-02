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
      path: '/internal/admin/audit-events/search',
      handler: 'admin-audit.search',
      config: {
        auth: false,
        policies: [adminDashboardServicePolicy],
      },
    },
  ],
};

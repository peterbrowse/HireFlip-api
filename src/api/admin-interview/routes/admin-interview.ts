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
      path: '/internal/admin/interviews/operations',
      handler: 'admin-interview.operations',
      config: {
        auth: false,
        policies: [adminDashboardServicePolicy],
      },
    },
  ],
};

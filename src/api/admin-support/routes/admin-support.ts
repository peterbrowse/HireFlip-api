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
      path: '/internal/admin/support/cases',
      handler: 'admin-support.list',
      config: {
        auth: false,
        policies: [adminDashboardServicePolicy],
      },
    },
    {
      method: 'POST',
      path: '/internal/admin/support/cases/detail',
      handler: 'admin-support.detail',
      config: {
        auth: false,
        policies: [adminDashboardServicePolicy],
      },
    },
    {
      method: 'POST',
      path: '/internal/admin/support/cases/assign',
      handler: 'admin-support.assign',
      config: {
        auth: false,
        policies: [adminDashboardServicePolicy],
      },
    },
  ],
};

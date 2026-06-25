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
      path: '/internal/admin/candidates/list',
      handler: 'admin-candidate.listCandidates',
      config: {
        auth: false,
        policies: [adminDashboardServicePolicy],
      },
    },
    {
      method: 'POST',
      path: '/internal/admin/candidates/detail',
      handler: 'admin-candidate.candidateDetail',
      config: {
        auth: false,
        policies: [adminDashboardServicePolicy],
      },
    },
    {
      method: 'POST',
      path: '/internal/admin/candidates/profile/update',
      handler: 'admin-candidate.updateProfile',
      config: {
        auth: false,
        policies: [adminDashboardServicePolicy],
      },
    },
    {
      method: 'POST',
      path: '/internal/admin/candidates/account/action',
      handler: 'admin-candidate.accountAction',
      config: {
        auth: false,
        policies: [adminDashboardServicePolicy],
      },
    },
    {
      method: 'POST',
      path: '/internal/admin/candidates/support/create',
      handler: 'admin-candidate.createSupportCase',
      config: {
        auth: false,
        policies: [adminDashboardServicePolicy],
      },
    },
    {
      method: 'POST',
      path: '/internal/admin/candidates/strikes/action',
      handler: 'admin-candidate.strikeAction',
      config: {
        auth: false,
        policies: [adminDashboardServicePolicy],
      },
    },
    {
      method: 'POST',
      path: '/internal/admin/candidates/gdpr-export',
      handler: 'admin-candidate.gdprExport',
      config: {
        auth: false,
        policies: [adminDashboardServicePolicy],
      },
    },
  ],
};

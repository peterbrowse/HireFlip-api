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
      path: '/internal/admin/employers',
      handler: 'admin-employer.listEmployers',
      config: {
        auth: false,
        policies: [adminDashboardServicePolicy],
      },
    },
    {
      method: 'POST',
      path: '/internal/admin/employers/detail',
      handler: 'admin-employer.employerDetail',
      config: {
        auth: false,
        policies: [adminDashboardServicePolicy],
      },
    },
    {
      method: 'POST',
      path: '/internal/admin/employers/invites/options',
      handler: 'admin-employer.inviteOptions',
      config: {
        auth: false,
        policies: [adminDashboardServicePolicy],
      },
    },
    {
      method: 'POST',
      path: '/internal/admin/employers/invites',
      handler: 'admin-employer.listInvites',
      config: {
        auth: false,
        policies: [adminDashboardServicePolicy],
      },
    },
    {
      method: 'POST',
      path: '/internal/admin/employers/invites/create',
      handler: 'admin-employer.createInvite',
      config: {
        auth: false,
        policies: [adminDashboardServicePolicy],
      },
    },
    {
      method: 'POST',
      path: '/internal/admin/employers/invites/resend',
      handler: 'admin-employer.resendInvite',
      config: {
        auth: false,
        policies: [adminDashboardServicePolicy],
      },
    },
    {
      method: 'POST',
      path: '/internal/admin/employers/invites/link',
      handler: 'admin-employer.generateInviteLink',
      config: {
        auth: false,
        policies: [adminDashboardServicePolicy],
      },
    },
    {
      method: 'POST',
      path: '/internal/admin/employers/invites/revoke',
      handler: 'admin-employer.revokeInvite',
      config: {
        auth: false,
        policies: [adminDashboardServicePolicy],
      },
    },
  ],
};

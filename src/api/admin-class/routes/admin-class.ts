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
      path: '/internal/admin/classes/list',
      handler: 'admin-class.list',
      config: {
        auth: false,
        policies: [adminDashboardServicePolicy],
      },
    },
    {
      method: 'POST',
      path: '/internal/admin/classes/detail',
      handler: 'admin-class.detail',
      config: {
        auth: false,
        policies: [adminDashboardServicePolicy],
      },
    },
    {
      method: 'POST',
      path: '/internal/admin/classes/options',
      handler: 'admin-class.options',
      config: {
        auth: false,
        policies: [adminDashboardServicePolicy],
      },
    },
    {
      method: 'POST',
      path: '/internal/admin/classes/create',
      handler: 'admin-class.create',
      config: {
        auth: false,
        policies: [adminDashboardServicePolicy],
      },
    },
    {
      method: 'POST',
      path: '/internal/admin/classes/update',
      handler: 'admin-class.update',
      config: {
        auth: false,
        policies: [adminDashboardServicePolicy],
      },
    },
    {
      method: 'POST',
      path: '/internal/admin/classes/announcements/post',
      handler: 'admin-class.postAnnouncement',
      config: {
        auth: false,
        policies: [adminDashboardServicePolicy],
      },
    },
    {
      method: 'POST',
      path: '/internal/admin/classes/announcements/update',
      handler: 'admin-class.updateAnnouncement',
      config: {
        auth: false,
        policies: [adminDashboardServicePolicy],
      },
    },
    {
      method: 'POST',
      path: '/internal/admin/classes/announcements/delete',
      handler: 'admin-class.deleteAnnouncement',
      config: {
        auth: false,
        policies: [adminDashboardServicePolicy],
      },
    },
    {
      method: 'POST',
      path: '/internal/admin/classes/lifecycle',
      handler: 'admin-class.lifecycle',
      config: {
        auth: false,
        policies: [adminDashboardServicePolicy],
      },
    },
  ],
};

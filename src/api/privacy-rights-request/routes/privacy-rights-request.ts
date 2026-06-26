const adminDashboardServicePolicy = {
  name: 'global::service-token',
  config: {
    allowedServices: ['admin-dashboard'],
  },
};

const employerDashboardServicePolicy = {
  name: 'global::service-token',
  config: {
    allowedServices: ['employer-dashboard'],
  },
};

const candidateAuthMiddleware = [
  {
    name: 'global::auth0-jwt',
  },
];

export default {
  routes: [
    {
      method: 'GET',
      path: '/candidates/me/privacy-requests',
      handler: 'privacy-rights-request.candidateList',
      config: {
        auth: false,
        middlewares: candidateAuthMiddleware,
      },
    },
    {
      method: 'POST',
      path: '/candidates/me/privacy-requests',
      handler: 'privacy-rights-request.candidateCreate',
      config: {
        auth: false,
        middlewares: candidateAuthMiddleware,
      },
    },
    {
      method: 'POST',
      path: '/candidates/me/privacy-requests/:requestDocumentId/download-code',
      handler: 'privacy-rights-request.candidateRequestDownloadCode',
      config: {
        auth: false,
        middlewares: candidateAuthMiddleware,
      },
    },
    {
      method: 'POST',
      path: '/candidates/me/privacy-requests/:requestDocumentId/download',
      handler: 'privacy-rights-request.candidateDownloadExport',
      config: {
        auth: false,
        middlewares: candidateAuthMiddleware,
      },
    },
    {
      method: 'POST',
      path: '/candidates/me/privacy-requests/:requestDocumentId/email-link',
      handler: 'privacy-rights-request.candidateEmailDownloadLink',
      config: {
        auth: false,
        middlewares: candidateAuthMiddleware,
      },
    },
    {
      method: 'POST',
      path: '/internal/employer-dashboard/privacy/requests/list',
      handler: 'privacy-rights-request.employerList',
      config: {
        auth: false,
        policies: [employerDashboardServicePolicy],
      },
    },
    {
      method: 'POST',
      path: '/internal/employer-dashboard/privacy/requests/create',
      handler: 'privacy-rights-request.employerCreate',
      config: {
        auth: false,
        policies: [employerDashboardServicePolicy],
      },
    },
    {
      method: 'POST',
      path: '/internal/employer-dashboard/privacy/requests/download-code',
      handler: 'privacy-rights-request.employerRequestDownloadCode',
      config: {
        auth: false,
        policies: [employerDashboardServicePolicy],
      },
    },
    {
      method: 'POST',
      path: '/internal/employer-dashboard/privacy/requests/download',
      handler: 'privacy-rights-request.employerDownloadExport',
      config: {
        auth: false,
        policies: [employerDashboardServicePolicy],
      },
    },
    {
      method: 'POST',
      path: '/internal/employer-dashboard/privacy/requests/email-link',
      handler: 'privacy-rights-request.employerEmailDownloadLink',
      config: {
        auth: false,
        policies: [employerDashboardServicePolicy],
      },
    },
    {
      method: 'POST',
      path: '/internal/admin/privacy/requests/list',
      handler: 'privacy-rights-request.adminList',
      config: {
        auth: false,
        policies: [adminDashboardServicePolicy],
      },
    },
    {
      method: 'POST',
      path: '/internal/admin/privacy/requests/detail',
      handler: 'privacy-rights-request.adminDetail',
      config: {
        auth: false,
        policies: [adminDashboardServicePolicy],
      },
    },
    {
      method: 'POST',
      path: '/internal/admin/privacy/requests/action',
      handler: 'privacy-rights-request.adminAction',
      config: {
        auth: false,
        policies: [adminDashboardServicePolicy],
      },
    },
    {
      method: 'POST',
      path: '/internal/admin/privacy/requests/download-code',
      handler: 'privacy-rights-request.adminRequestDownloadCode',
      config: {
        auth: false,
        policies: [adminDashboardServicePolicy],
      },
    },
    {
      method: 'POST',
      path: '/internal/admin/privacy/requests/download',
      handler: 'privacy-rights-request.adminDownloadExport',
      config: {
        auth: false,
        policies: [adminDashboardServicePolicy],
      },
    },
    {
      method: 'POST',
      path: '/internal/admin/privacy/requests/anonymise-candidate',
      handler: 'privacy-rights-request.adminAnonymiseCandidate',
      config: {
        auth: false,
        policies: [adminDashboardServicePolicy],
      },
    },
  ],
};

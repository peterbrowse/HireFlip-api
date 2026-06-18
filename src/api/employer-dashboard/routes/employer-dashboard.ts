const employerDashboardServicePolicy = {
  name: 'global::service-token',
  config: {
    allowedServices: ['employer-dashboard'],
  },
};

export default {
  routes: [
    {
      method: 'POST',
      path: '/internal/employer-dashboard/overview',
      handler: 'employer-dashboard.overview',
      config: {
        auth: false,
        policies: [employerDashboardServicePolicy],
      },
    },
    {
      method: 'POST',
      path: '/internal/employer-dashboard/interview-slot-offers/create',
      handler: 'employer-dashboard.createInterviewSlotOffer',
      config: {
        auth: false,
        policies: [employerDashboardServicePolicy],
      },
    },
  ],
};

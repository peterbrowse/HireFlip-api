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
	      path: '/internal/employer-dashboard/onboarding',
	      handler: 'employer-dashboard.onboarding',
	      config: {
	        auth: false,
	        policies: [employerDashboardServicePolicy],
	      },
	    },
	    {
	      method: 'POST',
	      path: '/internal/employer-dashboard/onboarding/complete',
	      handler: 'employer-dashboard.completeOnboarding',
	      config: {
	        auth: false,
	        policies: [employerDashboardServicePolicy],
	      },
	    },
	    {
	      method: 'POST',
	      path: '/internal/employer-dashboard/invites/validate',
      handler: 'employer-dashboard.validateInvite',
      config: {
        auth: false,
        policies: [employerDashboardServicePolicy],
      },
    },
    {
      method: 'POST',
      path: '/internal/employer-dashboard/invites/accept',
      handler: 'employer-dashboard.acceptInvite',
      config: {
        auth: false,
        policies: [employerDashboardServicePolicy],
      },
    },
    {
      method: 'POST',
      path: '/internal/employer-dashboard/invites/accept-pending',
      handler: 'employer-dashboard.acceptPendingInvite',
      config: {
        auth: false,
        policies: [employerDashboardServicePolicy],
      },
    },
    {
      method: 'POST',
      path: '/internal/employer-dashboard/invites/setup-ticket',
      handler: 'employer-dashboard.createInviteSetupTicket',
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

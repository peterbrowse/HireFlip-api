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
      path: '/internal/employer-dashboard/support/cases',
      handler: 'employer-dashboard.supportCases',
      config: {
        auth: false,
        policies: [employerDashboardServicePolicy],
      },
    },
    {
      method: 'POST',
      path: '/internal/employer-dashboard/support/cases/detail',
      handler: 'employer-dashboard.supportCase',
      config: {
        auth: false,
        policies: [employerDashboardServicePolicy],
      },
    },
    {
      method: 'POST',
      path: '/internal/employer-dashboard/support/cases/create',
      handler: 'employer-dashboard.createSupportCase',
      config: {
        auth: false,
        policies: [employerDashboardServicePolicy],
      },
    },
    {
      method: 'POST',
      path: '/internal/employer-dashboard/support/cases/reply',
      handler: 'employer-dashboard.replyToSupportCase',
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
	      path: '/internal/employer-dashboard/settings/update',
	      handler: 'employer-dashboard.updateSettings',
	      config: {
	        auth: false,
	        policies: [employerDashboardServicePolicy],
	      },
	    },
	    {
	      method: 'POST',
	      path: '/internal/employer-dashboard/profile/update',
	      handler: 'employer-dashboard.updateProfile',
	      config: {
	        auth: false,
	        policies: [employerDashboardServicePolicy],
	      },
	    },
	    {
	      method: 'POST',
	      path: '/internal/employer-dashboard/profile-image/update',
	      handler: 'employer-dashboard.updateProfileImage',
	      config: {
	        auth: false,
	        policies: [employerDashboardServicePolicy],
	      },
	    },
	    {
	      method: 'POST',
	      path: '/internal/employer-dashboard/team/invite',
	      handler: 'employer-dashboard.inviteTeamContact',
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
      path: '/internal/employer-dashboard/capacity-claims/detail',
      handler: 'employer-dashboard.capacityClaim',
      config: {
        auth: false,
        policies: [employerDashboardServicePolicy],
      },
    },
    {
      method: 'POST',
      path: '/internal/employer-dashboard/capacity-claims/decline',
      handler: 'employer-dashboard.declineCapacityClaim',
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
    {
      method: 'POST',
      path: '/internal/employer-dashboard/interviews/detail',
      handler: 'employer-dashboard.interviewDetail',
      config: {
        auth: false,
        policies: [employerDashboardServicePolicy],
      },
    },
    {
      method: 'POST',
      path: '/internal/employer-dashboard/interviews/setup',
      handler: 'employer-dashboard.updateInterviewSetup',
      config: {
        auth: false,
        policies: [employerDashboardServicePolicy],
      },
    },
    {
      method: 'POST',
      path: '/internal/employer-dashboard/feedback/detail',
      handler: 'employer-dashboard.interviewFeedbackDetail',
      config: {
        auth: false,
        policies: [employerDashboardServicePolicy],
      },
    },
    {
      method: 'POST',
      path: '/internal/employer-dashboard/feedback/submit',
      handler: 'employer-dashboard.submitInterviewFeedback',
      config: {
        auth: false,
        policies: [employerDashboardServicePolicy],
      },
    },
    {
      method: 'POST',
      path: '/internal/employer-dashboard/feedback/invites/create',
      handler: 'employer-dashboard.inviteInterviewFeedbackContributor',
      config: {
        auth: false,
        policies: [employerDashboardServicePolicy],
      },
    },
    {
      method: 'POST',
      path: '/internal/employer-dashboard/feedback/invites/revoke',
      handler: 'employer-dashboard.revokeInterviewFeedbackInvite',
      config: {
        auth: false,
        policies: [employerDashboardServicePolicy],
      },
    },
    {
      method: 'POST',
      path: '/internal/employer-dashboard/feedback/invites/validate',
      handler: 'employer-dashboard.validateInterviewFeedbackInvite',
      config: {
        auth: false,
        policies: [employerDashboardServicePolicy],
      },
    },
    {
      method: 'POST',
      path: '/internal/employer-dashboard/feedback/invites/submit',
      handler: 'employer-dashboard.submitInvitedInterviewFeedback',
      config: {
        auth: false,
        policies: [employerDashboardServicePolicy],
      },
    },
  ],
};

export default {
  routes: [
    {
      method: 'POST',
      path: '/candidates/me',
      handler: 'candidate.me',
      config: {
        auth: false,
        middlewares: [
          {
            name: 'global::auth0-jwt',
          },
        ],
      },
    },
    {
      method: 'PATCH',
      path: '/candidates/me/account',
      handler: 'candidate.updateAccount',
      config: {
        auth: false,
        middlewares: [
          {
            name: 'global::auth0-jwt',
          },
        ],
      },
    },
    {
      method: 'POST',
      path: '/candidates/me/profile-image',
      handler: 'candidate.updateProfileImage',
      config: {
        auth: false,
        middlewares: [
          {
            name: 'global::auth0-jwt',
          },
        ],
      },
    },
    {
      method: 'GET',
      path: '/candidates/preference-options',
      handler: 'candidate.preferenceOptions',
      config: {
        auth: false,
        middlewares: [
          {
            name: 'global::auth0-jwt',
          },
        ],
      },
    },
    {
      method: 'GET',
      path: '/candidates/me/class-interest',
      handler: 'candidate.classInterest',
      config: {
        auth: false,
        middlewares: [
          {
            name: 'global::auth0-jwt',
          },
        ],
      },
    },
    {
      method: 'GET',
      path: '/candidates/me/course',
      handler: 'candidate.course',
      config: {
        auth: false,
        middlewares: [
          {
            name: 'global::auth0-jwt',
          },
        ],
      },
    },
    {
      method: 'POST',
      path: '/candidates/me/course/begin',
      handler: 'candidate.beginCourse',
      config: {
        auth: false,
        middlewares: [
          {
            name: 'global::auth0-jwt',
          },
        ],
      },
    },
    {
      method: 'POST',
      path: '/candidates/me/course/materials/:materialDocumentId/progress',
      handler: 'candidate.recordMaterialProgress',
      config: {
        auth: false,
        middlewares: [
          {
            name: 'global::auth0-jwt',
          },
        ],
      },
    },
    {
      method: 'POST',
      path: '/candidates/me/course/tests/:testDocumentId/submit',
      handler: 'candidate.submitCourseTest',
      config: {
        auth: false,
        middlewares: [
          {
            name: 'global::auth0-jwt',
          },
        ],
      },
    },
    {
      method: 'POST',
      path: '/candidates/me/course/tests/:testDocumentId/appeal',
      handler: 'candidate.createCourseAppeal',
      config: {
        auth: false,
        middlewares: [
          {
            name: 'global::auth0-jwt',
          },
        ],
      },
    },
    {
      method: 'GET',
      path: '/candidates/me/class-events',
      handler: 'candidate.classEvents',
      config: {
        auth: false,
        middlewares: [
          {
            name: 'global::auth0-jwt',
          },
        ],
      },
    },
    {
      method: 'GET',
      path: '/candidates/me/interview-readiness',
      handler: 'candidate.interviewReadiness',
      config: {
        auth: false,
        middlewares: [
          {
            name: 'global::auth0-jwt',
          },
        ],
      },
    },
    {
      method: 'PATCH',
      path: '/candidates/me/interview-readiness',
      handler: 'candidate.updateInterviewReadiness',
      config: {
        auth: false,
        middlewares: [
          {
            name: 'global::auth0-jwt',
          },
        ],
      },
    },
    {
      method: 'POST',
      path: '/candidates/me/interview-readiness/autofill',
      handler: 'candidate.autofillInterviewReadiness',
      config: {
        auth: false,
        middlewares: [
          {
            name: 'global::auth0-jwt',
          },
        ],
      },
    },
    {
      method: 'GET',
      path: '/candidates/me/interview-slot-offers',
      handler: 'candidate.interviewSlotOffers',
      config: {
        auth: false,
        middlewares: [
          {
            name: 'global::auth0-jwt',
          },
        ],
      },
    },
    {
      method: 'POST',
      path: '/candidates/me/interview-slot-offers/:offerDocumentId/accept',
      handler: 'candidate.acceptInterviewSlotOffer',
      config: {
        auth: false,
        middlewares: [
          {
            name: 'global::auth0-jwt',
          },
        ],
      },
    },
    {
      method: 'POST',
      path: '/candidates/me/interview-slot-offers/:offerDocumentId/decline',
      handler: 'candidate.declineInterviewSlotOffer',
      config: {
        auth: false,
        middlewares: [
          {
            name: 'global::auth0-jwt',
          },
        ],
      },
    },
    {
      method: 'POST',
      path: '/candidates/me/interview-progressions/:progressionRequestDocumentId/accept',
      handler: 'candidate.acceptInterviewProgressionRequest',
      config: {
        auth: false,
        middlewares: [
          {
            name: 'global::auth0-jwt',
          },
        ],
      },
    },
    {
      method: 'POST',
      path: '/candidates/me/interview-progressions/:progressionRequestDocumentId/decline',
      handler: 'candidate.declineInterviewProgressionRequest',
      config: {
        auth: false,
        middlewares: [
          {
            name: 'global::auth0-jwt',
          },
        ],
      },
    },
    {
      method: 'POST',
      path: '/candidates/me/interviews/:interviewDocumentId/feedback-report/flag',
      handler: 'candidate.flagInterviewFeedbackReport',
      config: {
        auth: false,
        middlewares: [
          {
            name: 'global::auth0-jwt',
          },
        ],
      },
    },
    {
      method: 'POST',
      path: '/candidates/me/interview-strikes/:strikeDocumentId/dispute',
      handler: 'candidate.disputeInterviewStrike',
      config: {
        auth: false,
        middlewares: [
          {
            name: 'global::auth0-jwt',
          },
        ],
      },
    },
    {
      method: 'GET',
      path: '/candidates/me/support-cases',
      handler: 'candidate.supportCases',
      config: {
        auth: false,
        middlewares: [
          {
            name: 'global::auth0-jwt',
          },
        ],
      },
    },
    {
      method: 'POST',
      path: '/candidates/me/support-cases',
      handler: 'candidate.createSupportCase',
      config: {
        auth: false,
        middlewares: [
          {
            name: 'global::auth0-jwt',
          },
        ],
      },
    },
    {
      method: 'GET',
      path: '/candidates/me/support-cases/:supportCaseDocumentId',
      handler: 'candidate.supportCase',
      config: {
        auth: false,
        middlewares: [
          {
            name: 'global::auth0-jwt',
          },
        ],
      },
    },
    {
      method: 'POST',
      path: '/candidates/me/support-cases/:supportCaseDocumentId/reply',
      handler: 'candidate.replyToSupportCase',
      config: {
        auth: false,
        middlewares: [
          {
            name: 'global::auth0-jwt',
          },
        ],
      },
    },
    {
      method: 'POST',
      path: '/candidates/me/account-restriction/appeal',
      handler: 'candidate.appealAccountRestriction',
      config: {
        auth: false,
        middlewares: [
          {
            name: 'global::auth0-jwt',
          },
        ],
      },
    },
    {
      method: 'POST',
      path: '/candidates/me/class-interest',
      handler: 'candidate.registerClassInterest',
      config: {
        auth: false,
        middlewares: [
          {
            name: 'global::auth0-jwt',
          },
        ],
      },
    },
    {
      method: 'DELETE',
      path: '/candidates/me/class-interest',
      handler: 'candidate.withdrawClassInterest',
      config: {
        auth: false,
        middlewares: [
          {
            name: 'global::auth0-jwt',
          },
        ],
      },
    },
    {
      method: 'POST',
      path: '/candidates/me/class-reservation',
      handler: 'candidate.reserveClassPlace',
      config: {
        auth: false,
        middlewares: [
          {
            name: 'global::auth0-jwt',
          },
        ],
      },
    },
    {
      method: 'GET',
      path: '/candidates/me/class-reservation/:reservationDocumentId',
      handler: 'candidate.classReservation',
      config: {
        auth: false,
        middlewares: [
          {
            name: 'global::auth0-jwt',
          },
        ],
      },
    },
    {
      method: 'POST',
      path: '/candidates/me/class-reservation/:reservationDocumentId/accept-terms',
      handler: 'candidate.acceptClassReservationTerms',
      config: {
        auth: false,
        middlewares: [
          {
            name: 'global::auth0-jwt',
          },
        ],
      },
    },
    {
      method: 'POST',
      path: '/candidates/me/class-reservation/:reservationDocumentId/cancel',
      handler: 'candidate.cancelClassReservation',
      config: {
        auth: false,
        middlewares: [
          {
            name: 'global::auth0-jwt',
          },
        ],
      },
    },
    {
      method: 'POST',
      path: '/candidates/me/class-reservation/:reservationDocumentId/expire',
      handler: 'candidate.expireClassReservation',
      config: {
        auth: false,
        middlewares: [
          {
            name: 'global::auth0-jwt',
          },
        ],
      },
    },
    {
      method: 'POST',
      path: '/candidates/me/waiting-list-offer/:offerDocumentId/decline',
      handler: 'candidate.declineWaitingListOffer',
      config: {
        auth: false,
        middlewares: [
          {
            name: 'global::auth0-jwt',
          },
        ],
      },
    },
    {
      method: 'POST',
      path: '/candidates/me/unlisted-interest',
      handler: 'candidate.createUnlistedInterest',
      config: {
        auth: false,
        middlewares: [
          {
            name: 'global::auth0-jwt',
          },
        ],
      },
    },
  ],
};

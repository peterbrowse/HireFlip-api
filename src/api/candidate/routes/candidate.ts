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
      path: '/candidates/me/class-reservation/:reservationDocumentId/confirm-payment',
      handler: 'candidate.confirmClassReservationPayment',
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

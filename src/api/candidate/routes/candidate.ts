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
  ],
};

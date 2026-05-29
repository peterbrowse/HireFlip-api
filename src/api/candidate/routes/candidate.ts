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
  ],
};

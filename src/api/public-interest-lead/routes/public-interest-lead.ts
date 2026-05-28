export default {
  routes: [
    {
      method: 'POST',
      path: '/public-interest-leads/register-interest',
      handler: 'public-interest-lead.registerInterest',
      config: {
        auth: false,
        policies: [
          {
            name: 'global::service-token',
            config: {
              allowedServices: ['homepage'],
            },
          },
        ],
      },
    },
  ],
};

export default {
  routes: [
    {
      method: 'POST',
      path: '/public-interest-leads/register-interest',
      handler: 'public-interest-lead.registerInterest',
      config: {
        auth: false,
      },
    },
  ],
};

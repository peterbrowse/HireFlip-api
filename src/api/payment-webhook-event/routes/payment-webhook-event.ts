export default {
  routes: [
    {
      method: 'POST',
      path: '/internal/payment-webhooks/stripe',
      handler: 'payment-webhook-event.receiveStripe',
      config: {
        auth: false,
        policies: [
          {
            name: 'global::service-token',
            config: {
              allowedServices: ['payment-service'],
            },
          },
        ],
      },
    },
  ],
};

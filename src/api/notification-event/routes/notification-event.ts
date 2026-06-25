const notificationServicePolicy = {
  name: 'global::service-token',
  config: {
    allowedServices: ['notification-service'],
  },
};

export default {
  routes: [
    {
      method: 'POST',
      path: '/internal/notification-events/provider-status',
      handler: 'notification-event.providerStatus',
      config: {
        auth: false,
        policies: [notificationServicePolicy],
      },
    },
  ],
};

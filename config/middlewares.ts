export default ({ env }) => {
  const mediaSources = [
    "'self'",
    'data:',
    'blob:',
    env('AWS_S3_CSP_SOURCE', 'https://*.s3.amazonaws.com'),
    env('CLOUDINARY_CSP_SOURCE', 'https://res.cloudinary.com'),
  ].filter(Boolean);

  return [
    'strapi::logger',
    'strapi::errors',
    {
      name: 'strapi::security',
      config: {
        contentSecurityPolicy: {
          useDefaults: true,
          directives: {
            'img-src': mediaSources,
            'media-src': mediaSources,
            upgradeInsecureRequests: null,
          },
        },
      },
    },
    {
      name: 'strapi::cors',
      config: {
        origin: env.array('CORS_ORIGINS', ['http://localhost:3000', 'http://127.0.0.1:3000']),
      },
    },
    'strapi::poweredBy',
    'strapi::query',
    'strapi::body',
    'strapi::session',
    'strapi::favicon',
    'strapi::public',
  ];
};

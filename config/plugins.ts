import notificationServiceEmailProvider from '../src/providers/notification-service-email';

export default ({ env }) => {
  const uploadProvider = env('UPLOAD_PROVIDER', 'local');
  const s3Acl = env('AWS_ACL', '').trim() || undefined;
  const useS3SignedUrls = env.bool('AWS_S3_SIGNED_URLS', !s3Acl);
  const providerAcl = useS3SignedUrls ? 'private' : s3Acl;
  const emailProvider = env('STRAPI_EMAIL_PROVIDER', undefined);

  const upload =
    uploadProvider === 'aws-s3'
      ? {
          config: {
            provider: 'aws-s3',
            providerOptions: {
              s3Options: {
                credentials: {
                  accessKeyId: env('AWS_ACCESS_KEY_ID'),
                  secretAccessKey: env('AWS_ACCESS_SECRET'),
                },
                region: env('AWS_REGION', 'eu-west-2'),
                params: {
                  ACL: providerAcl,
                  signedUrlExpires: env.int('AWS_SIGNED_URL_EXPIRES', 15 * 60),
                  Bucket: env('AWS_BUCKET'),
                },
              },
            },
            actionOptions: {
              upload: { ACL: s3Acl },
              uploadStream: { ACL: s3Acl },
              delete: {},
            },
          },
        }
      : {
          config: {
            provider: 'local',
          },
        };

  const email =
    emailProvider === 'notification-service'
      ? {
          config: {
            provider: notificationServiceEmailProvider,
            providerOptions: {
              baseUrl: env('NOTIFICATION_SERVICE_URL'),
              serviceToken: env('NOTIFICATION_SERVICE_TOKEN'),
              timeoutMs: env.int('NOTIFICATION_SERVICE_TIMEOUT_MS', 5000),
            },
            settings: {
              defaultFrom: env('STRAPI_EMAIL_DEFAULT_FROM', 'no-reply@hireflip.work'),
              defaultReplyTo: env('STRAPI_EMAIL_DEFAULT_REPLY_TO', 'support@hireflip.work'),
            },
          },
        }
      : undefined;

  return {
    upload,
    ...(email ? { email } : {}),
  };
};

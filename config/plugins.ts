export default ({ env }) => {
  const uploadProvider = env('UPLOAD_PROVIDER', 'local');

  if (uploadProvider !== 'aws-s3') {
    return {
      upload: {
        config: {
          provider: 'local',
        },
      },
    };
  }

  return {
    upload: {
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
              ACL: env('AWS_ACL', 'private'),
              signedUrlExpires: env.int('AWS_SIGNED_URL_EXPIRES', 15 * 60),
              Bucket: env('AWS_BUCKET'),
            },
          },
        },
        actionOptions: {
          upload: {},
          uploadStream: {},
          delete: {},
        },
      },
    },
  };
};

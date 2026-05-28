export default ({ env }) => {
  const uploadProvider = env('UPLOAD_PROVIDER', 'local');
  const s3Acl = env('AWS_ACL', undefined);

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
              signedUrlExpires: env.int('AWS_SIGNED_URL_EXPIRES', 15 * 60),
              Bucket: env('AWS_BUCKET'),
              ...(s3Acl ? { ACL: s3Acl } : {}),
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

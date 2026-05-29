export default ({ env }) => {
  const publicUrl = env('PUBLIC_URL', undefined);

  return {
    host: env('HOST', '0.0.0.0'),
    port: env.int('PORT', 1337),
    ...(publicUrl ? { url: publicUrl } : {}),
    app: {
      keys: env.array('APP_KEYS'),
    },
  };
};

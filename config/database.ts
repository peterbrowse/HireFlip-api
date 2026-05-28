export default ({ env }) => ({
  connection: {
    client: "postgres",
    connection: {
      connectionString: env("SUPABASE_DATABASE_URL"),
      ssl: {
        rejectUnauthorized: true,
        ca: Buffer.from(env("SUPABASE_DATABASE_SSL_CA"), "base64").toString("utf-8"),
      },
    },
    pool: {
      min: env.int("SUPABASE_DATABASE_POOL_MIN", 2),
      max: env.int("SUPABASE_DATABASE_POOL_MAX", 10),
    },
    acquireConnectionTimeout: env.int("SUPABASE_DATABASE_CONNECTION_TIMEOUT", 60000),
  },
});
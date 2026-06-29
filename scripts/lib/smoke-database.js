const fs = require('node:fs');
const path = require('node:path');

const safeName = (value) => String(value || 'smoke').replace(/[^a-zA-Z0-9-]/g, '-');

const setupSmokeDatabase = ({ runId, scriptName }) => {
  const configuredClient = String(
    process.env.DATABASE_CLIENT || (process.env.DATABASE_URL ? 'postgres' : 'sqlite')
  ).toLowerCase();

  if (
    process.env.SMOKE_USE_SHARED_DATABASE === 'true' ||
    process.env.DATABASE_URL ||
    configuredClient !== 'sqlite'
  ) {
    return {
      cleanup: async () => undefined,
      databaseFilename: process.env.DATABASE_FILENAME,
      isolated: false,
    };
  }

  const smokeDirectory = path.resolve(process.cwd(), '.tmp', 'smoke');
  const databaseFilename = path.join(
    '.tmp',
    'smoke',
    `${safeName(scriptName)}-${safeName(runId)}.db`
  );
  const absoluteDatabaseFilename = path.resolve(process.cwd(), databaseFilename);

  fs.mkdirSync(smokeDirectory, { recursive: true });
  process.env.DATABASE_CLIENT = 'sqlite';
  process.env.DATABASE_FILENAME = databaseFilename;

  return {
    cleanup: async () => {
      await Promise.all(
        ['', '-shm', '-wal'].map((suffix) =>
          fs.promises.rm(`${absoluteDatabaseFilename}${suffix}`, {
            force: true,
          })
        )
      );
    },
    databaseFilename,
    isolated: true,
  };
};

module.exports = {
  setupSmokeDatabase,
};

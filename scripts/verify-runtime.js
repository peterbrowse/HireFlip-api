"use strict";

require("./verify-node-version");

let database;

try {
  const Database = require("better-sqlite3");
  database = new Database(":memory:");
  database.prepare("select 1 as ready").get();
  console.log("better-sqlite3 runtime check passed.");
} catch (error) {
  console.error(
    [
      "better-sqlite3 is not compatible with the active Node.js 22 runtime.",
      "Run `nvm use` and then `npm run sqlite:rebuild` from the HireFlip-api directory.",
      error instanceof Error ? error.message : String(error),
    ].join("\n"),
  );
  process.exitCode = 1;
} finally {
  database?.close();
}

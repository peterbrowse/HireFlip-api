"use strict";

const { execFileSync } = require("node:child_process");

const requiredMajor = 22;
const currentMajor = Number.parseInt(process.versions.node.split(".")[0], 10);

if (currentMajor !== requiredMajor) {
  console.error(
    [
      "HireFlip API requires Node.js 22.x.",
      `Current runtime: ${process.version} (Node ABI ${process.versions.modules}).`,
      "Run `nvm use` from the HireFlip-api directory before installing dependencies or starting Strapi.",
    ].join("\n"),
  );
  process.exit(1);
}

const pathNodeVersion = execFileSync("node", ["--version"], {
  encoding: "utf8",
}).trim();
const pathNodeMajor = Number.parseInt(pathNodeVersion.replace(/^v/, "").split(".")[0], 10);

if (pathNodeMajor !== requiredMajor) {
  console.error(
    [
      "The Node.js executable on PATH must also be Node.js 22.x.",
      `Current process: ${process.version}. PATH resolves node to ${pathNodeVersion}.`,
      "Run `nvm use` from the HireFlip-api directory before continuing.",
    ].join("\n"),
  );
  process.exit(1);
}

console.log(`Node runtime check passed: ${process.version} (ABI ${process.versions.modules}).`);

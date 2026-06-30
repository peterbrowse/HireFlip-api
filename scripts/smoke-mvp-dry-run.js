#!/usr/bin/env node

const { spawn } = require('node:child_process');
const path = require('node:path');

const smokeSuites = {
  core: [
    {
      description: 'payments, reservations, checkout recovery, and class capacity edge cases',
      requiresRedis: true,
      script: 'smoke-payment-edge-cases.js',
    },
    {
      description: 'support case creation, messages, assignment, and candidate-visible filtering',
      script: 'smoke-support-cases.js',
    },
    {
      description: 'course assessment appeal approval, rejection, SLA, audit, and notifications',
      script: 'smoke-assessment-appeals.js',
    },
    {
      description: 'candidate interview slot review, acceptance, decline, expiry, strikes, and disputes',
      script: 'smoke-candidate-interview-slots.js',
    },
    {
      description: 'employer invite, onboarding, settings, capacity, slots, feedback, AI reports, and progression',
      script: 'smoke-employer-dashboard.js',
    },
    {
      description: 'refund exception review and payment-service execution contract',
      script: 'smoke-payment-exception-refund.js',
    },
    {
      description: 'refund provider webhook reconciliation and idempotency',
      script: 'smoke-refund-provider-updates.js',
    },
  ],
  queue: [
    {
      description: 'class allocation locking and capacity decisions',
      requiresRedis: true,
      script: 'smoke-class-allocation.js',
    },
    {
      description: 'waiting-list offer rotation and offer expiry',
      requiresRedis: true,
      script: 'smoke-waiting-list-offers.js',
    },
    {
      description: 'class realtime event streaming',
      requiresRedis: true,
      script: 'smoke-class-realtime.js',
    },
  ],
};

const parseList = (value) =>
  String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const selectedScripts = () => {
  const explicit = parseList(process.env.MVP_DRY_RUN_SMOKES);

  if (explicit.length > 0) {
    return explicit.map((script) => ({
      description: 'custom smoke selected by MVP_DRY_RUN_SMOKES',
      script: script.endsWith('.js') ? script : `${script}.js`,
    }));
  }

  const scripts = [...smokeSuites.core];

  if (process.env.MVP_DRY_RUN_INCLUDE_QUEUE_SMOKES === 'true') {
    scripts.push(...smokeSuites.queue);
  }

  if (process.env.MVP_DRY_RUN_SKIP_REDIS_SMOKES === 'true') {
    return scripts.filter((item) => item.requiresRedis !== true);
  }

  return scripts;
};

const printHelp = () => {
  console.log(`MVP dry-run smoke pack

Usage:
  npm run smoke:mvp-dry-run

Environment:
  MVP_DRY_RUN_BUILD=true                 Run npm run build before the smoke pack.
  MVP_DRY_RUN_INCLUDE_QUEUE_SMOKES=true  Include Redis-backed queue/realtime checks.
  MVP_DRY_RUN_SKIP_REDIS_SMOKES=true     Skip checks that require local/remote Redis.
  MVP_DRY_RUN_SMOKES=a.js,b.js           Run an explicit comma-separated script list.

Default coverage:
${smokeSuites.core.map((item) => `  - ${item.script}: ${item.description}`).join('\n')}

Optional queue coverage:
${smokeSuites.queue.map((item) => `  - ${item.script}: ${item.description}`).join('\n')}

Notes:
  Full default coverage includes payment reservation edge cases and therefore needs class-allocation Redis.
  Use MVP_DRY_RUN_SKIP_REDIS_SMOKES=true when Redis is not available locally.
`);
};

const runCommand = (command, args, env) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env,
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          signal
            ? `${command} ${args.join(' ')} exited with signal ${signal}`
            : `${command} ${args.join(' ')} exited with code ${code}`
        )
      );
    });
  });

const formatDuration = (startedAt) => {
  const seconds = Math.round((Date.now() - startedAt) / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;

  return minutes > 0 ? `${minutes}m ${remainder}s` : `${remainder}s`;
};

const main = async () => {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printHelp();
    return;
  }

  const startedAt = Date.now();
  const scripts = selectedScripts();
  const env = {
    ...process.env,
    CLASS_WORKFLOW_BOOTSTRAP_ENABLED: 'false',
    SMOKE_USE_SHARED_DATABASE: process.env.SMOKE_USE_SHARED_DATABASE || 'false',
  };

  if (process.env.MVP_DRY_RUN_SKIP_REDIS_SMOKES === 'true') {
    env.CLASS_ALLOCATION_REDIS_ENABLED = 'false';
    env.CLASS_WORKFLOW_QUEUE_ENABLED = 'false';
  }

  if (process.env.MVP_DRY_RUN_BUILD === 'true') {
    console.log('Building API before MVP dry-run smoke pack...');
    await runCommand(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], env);
  }

  console.log(`Running MVP dry-run smoke pack (${scripts.length} checks)...`);

  for (const [index, item] of scripts.entries()) {
    const scriptPath = path.join('scripts', item.script);
    const label = `${index + 1}/${scripts.length}`;

    console.log(`\n[${label}] ${item.script}`);
    console.log(`    ${item.description}`);
    await runCommand(process.execPath, [scriptPath], env);
  }

  console.log(`\nMVP dry-run smoke pack passed in ${formatDuration(startedAt)}.`);
};

main().catch((error) => {
  console.error(`\nMVP dry-run smoke pack failed: ${error.message}`);
  process.exit(1);
});

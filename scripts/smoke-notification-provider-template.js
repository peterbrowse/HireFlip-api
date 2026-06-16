#!/usr/bin/env node

const assert = require('node:assert/strict');
const provider = require('../providers/strapi-provider-email-notification-service');

let capturedRequest;

global.fetch = async (url, options) => {
  capturedRequest = {
    body: JSON.parse(options.body),
    headers: options.headers,
    method: options.method,
    url,
  };

  return {
    ok: true,
    status: 202,
    text: async () => '',
  };
};

async function main() {
  const service = provider.init(
    {
      baseUrl: 'https://notification.example.test',
      serviceToken: 'smoke-token',
      timeoutMs: 1000,
    },
    {
      defaultFrom: 'no-reply@hireflip.work',
    }
  );

  await service.send({
    html: '<p>Your HireFlip admin sign-in code is <strong>123456</strong>.</p><p>This code expires in 10 minutes.</p>',
    subject: 'Your HireFlip admin sign-in code',
    text: 'Your HireFlip admin sign-in code is 123456.\n\nThis code expires in 10 minutes.',
    to: 'admin@example.test',
  });

  assert.equal(capturedRequest.method, 'POST');
  assert.equal(capturedRequest.url, 'https://notification.example.test/api/internal/notifications/email');
  assert.equal(capturedRequest.body.html, undefined);
  assert.equal(capturedRequest.body.text, undefined);
  assert.equal(capturedRequest.body.template.key, 'generic_branded_message');
  assert.deepEqual(capturedRequest.body.template.variables.bodyLines, [
    'Your HireFlip admin sign-in code is 123456.',
    'This code expires in 10 minutes.',
  ]);
  assert.equal(capturedRequest.body.template.variables.heading, 'Your HireFlip admin sign-in code');
  assert.equal(capturedRequest.body.to, 'admin@example.test');
  assert.equal(capturedRequest.body.type, 'strapi_system_email');

  console.log('Notification provider template smoke passed.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

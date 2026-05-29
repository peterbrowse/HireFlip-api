const normalizeUrl = (baseUrl) => baseUrl.replace(/\/$/, '');

const normalizeRecipients = (value) => {
  if (!value) {
    return undefined;
  }

  const recipients = Array.isArray(value) ? value : [value];
  const cleanRecipients = recipients.map((recipient) => String(recipient).trim()).filter(Boolean);

  if (cleanRecipients.length === 0) {
    return undefined;
  }

  return Array.isArray(value) ? cleanRecipients : cleanRecipients[0];
};

const compactPayload = (payload) =>
  Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined && value !== null));

const createEndpoint = (baseUrl) => `${normalizeUrl(baseUrl)}/api/internal/notifications/email`;

module.exports = {
  init(providerOptions, settings = {}) {
    const baseUrl = providerOptions.baseUrl;
    const serviceToken = providerOptions.serviceToken;
    const timeoutMs = providerOptions.timeoutMs || 5000;

    if (!baseUrl || !serviceToken) {
      throw new Error('Notification-service email provider requires NOTIFICATION_SERVICE_URL and NOTIFICATION_SERVICE_TOKEN.');
    }

    return {
      async send(options) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        try {
          const response = await fetch(createEndpoint(baseUrl), {
            body: JSON.stringify(
              compactPayload({
                attachments: options.attachments,
                bcc: normalizeRecipients(options.bcc),
                cc: normalizeRecipients(options.cc),
                from: options.from || settings.defaultFrom,
                html: options.html,
                priority: 'transactional',
                replyTo: options.replyTo || settings.defaultReplyTo,
                source: 'strapi',
                subject: options.subject || 'HireFlip notification',
                text: options.text,
                to: normalizeRecipients(options.to),
                type: 'strapi_system_email',
              }),
            ),
            headers: {
              'content-type': 'application/json',
              'x-hireflip-service-name': 'core-api',
              'x-hireflip-service-token': serviceToken,
            },
            method: 'POST',
            signal: controller.signal,
          });

          if (!response.ok) {
            const body = await response.text();
            throw new Error(`Notification service rejected Strapi email with status ${response.status}: ${body}`);
          }
        } finally {
          clearTimeout(timeout);
        }
      },
    };
  },
};

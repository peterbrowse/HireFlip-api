type EmailValue = string | string[] | undefined;

type NotificationServiceEmailProviderOptions = {
  baseUrl?: string;
  serviceToken?: string;
  timeoutMs?: number;
};

type NotificationServiceEmailSettings = {
  defaultFrom?: string;
  defaultReplyTo?: string;
};

type StrapiEmailOptions = {
  to?: EmailValue;
  from?: string;
  replyTo?: string;
  cc?: EmailValue;
  bcc?: EmailValue;
  subject?: string;
  text?: string;
  html?: string;
  attachments?: unknown[];
};

const normalizeUrl = (baseUrl: string) => baseUrl.replace(/\/$/, '');

const normalizeRecipients = (value: EmailValue) => {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
};

const createEndpoint = (baseUrl: string) => `${normalizeUrl(baseUrl)}/api/internal/notifications/email`;

export default {
  init(providerOptions: NotificationServiceEmailProviderOptions, settings: NotificationServiceEmailSettings = {}) {
    const baseUrl = providerOptions.baseUrl;
    const serviceToken = providerOptions.serviceToken;
    const timeoutMs = providerOptions.timeoutMs || 5000;

    if (!baseUrl || !serviceToken) {
      throw new Error('Notification-service email provider requires NOTIFICATION_SERVICE_URL and NOTIFICATION_SERVICE_TOKEN.');
    }

    return {
      async send(options: StrapiEmailOptions) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        try {
          const response = await fetch(createEndpoint(baseUrl), {
            body: JSON.stringify({
              attachments: options.attachments,
              bcc: normalizeRecipients(options.bcc),
              cc: normalizeRecipients(options.cc),
              from: options.from || settings.defaultFrom,
              html: options.html,
              priority: 'transactional',
              replyTo: options.replyTo || settings.defaultReplyTo,
              source: 'strapi',
              subject: options.subject,
              text: options.text,
              to: normalizeRecipients(options.to),
              type: 'strapi_system_email',
            }),
            headers: {
              'content-type': 'application/json',
              'x-hireflip-service-name': 'core-api',
              'x-hireflip-service-token': serviceToken,
            },
            method: 'POST',
            signal: controller.signal,
          });

          if (!response.ok) {
            throw new Error(`Notification service rejected Strapi email with status ${response.status}.`);
          }
        } finally {
          clearTimeout(timeout);
        }
      },
    };
  },
};

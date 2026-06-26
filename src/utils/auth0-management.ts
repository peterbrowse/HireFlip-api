import { randomBytes } from 'node:crypto';
import { errors } from '@strapi/utils';

const { ApplicationError } = errors;

type Auth0TokenResponse = {
  access_token?: string;
  expires_in?: number;
  token_type?: string;
};

type Auth0Identity = {
  connection?: string;
  connection_id?: string;
  provider?: string;
};

export type Auth0User = {
  blocked?: boolean;
  email?: string;
  email_verified?: boolean;
  identities?: Auth0Identity[];
  user_id: string;
};

type Auth0PasswordTicket = {
  ticket?: string;
};

type Auth0ClientConfig = {
  audience: string;
  clientId: string;
  clientSecret: string;
  connectionId?: string;
  connectionName: string;
  domain: string;
  employerAppClientId?: string;
  passwordTicketTtlSeconds: number;
};

type CachedToken = {
  accessToken: string;
  expiresAt: number;
};

let cachedToken: CachedToken | null = null;

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

const normalizeDomain = (value: string) =>
  trimTrailingSlash(value.trim().replace(/^https?:\/\//, ''));

const requireEnv = (key: string) => {
  const value = process.env[key]?.trim();

  if (!value) {
    throw new ApplicationError(`Auth0 Management API is missing ${key}.`);
  }

  return value;
};

const integerEnv = (key: string, fallback: number) => {
  const value = Number.parseInt(process.env[key] || '', 10);

  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const getConfig = (): Auth0ClientConfig => {
  const domain = normalizeDomain(requireEnv('AUTH0_MANAGEMENT_DOMAIN'));

  return {
    audience: `https://${domain}/api/v2/`,
    clientId: requireEnv('AUTH0_MANAGEMENT_CLIENT_ID'),
    clientSecret: requireEnv('AUTH0_MANAGEMENT_CLIENT_SECRET'),
    connectionId: process.env.AUTH0_EMPLOYER_CONNECTION_ID?.trim() || undefined,
    connectionName: requireEnv('AUTH0_EMPLOYER_CONNECTION_NAME'),
    domain,
    employerAppClientId: process.env.AUTH0_EMPLOYER_APP_CLIENT_ID?.trim() || undefined,
    passwordTicketTtlSeconds: integerEnv('AUTH0_EMPLOYER_PASSWORD_TICKET_TTL_SECONDS', 172800),
  };
};

const parseAuth0Response = async <T>(response: Response, fallbackMessage: string): Promise<T> => {
  const payload = (await response.json().catch(() => null)) as T | { message?: string } | null;

  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'message' in payload && payload.message
        ? payload.message
        : fallbackMessage;

    throw new ApplicationError(message);
  }

  return payload as T;
};

const getManagementToken = async (config: Auth0ClientConfig) => {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.accessToken;
  }

  const response = await fetch(`https://${config.domain}/oauth/token`, {
    body: JSON.stringify({
      audience: config.audience,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: 'client_credentials',
    }),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  });
  const payload = await parseAuth0Response<Auth0TokenResponse>(
    response,
    'Auth0 Management token request failed.'
  );

  if (!payload.access_token) {
    throw new ApplicationError('Auth0 Management token response did not include an access token.');
  }

  cachedToken = {
    accessToken: payload.access_token,
    expiresAt: Date.now() + Math.max(60, payload.expires_in || 3600) * 1000,
  };

  return cachedToken.accessToken;
};

const requestManagementApi = async <T>(
  config: Auth0ClientConfig,
  path: string,
  init: RequestInit = {}
) => {
  const accessToken = await getManagementToken(config);
  const response = await fetch(`https://${config.domain}/api/v2${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers || {}),
      authorization: `Bearer ${accessToken}`,
    },
  });

  return parseAuth0Response<T>(response, 'Auth0 Management API request failed.');
};

const isEmployerConnectionUser = (user: Auth0User, config: Auth0ClientConfig) =>
  Array.isArray(user.identities) &&
  user.identities.some(
    (identity) =>
      identity.connection === config.connectionName ||
      (config.connectionId && identity.connection_id === config.connectionId)
  );

const generatedPassword = () => `Hf-${randomBytes(32).toString('base64url')}aA1!`;

export const getAuth0ManagementClient = () => {
  const config = getConfig();

  return {
    async blockUser(userId: string) {
      await requestManagementApi<Auth0User>(
        config,
        `/users/${encodeURIComponent(userId)}`,
        {
          body: JSON.stringify({ blocked: true }),
          method: 'PATCH',
        }
      );
    },

    async unblockUser(userId: string) {
      await requestManagementApi<Auth0User>(
        config,
        `/users/${encodeURIComponent(userId)}`,
        {
          body: JSON.stringify({ blocked: false }),
          method: 'PATCH',
        }
      );
    },

    async deleteUser(userId: string) {
      await requestManagementApi<Record<string, never>>(
        config,
        `/users/${encodeURIComponent(userId)}`,
        {
          method: 'DELETE',
        }
      );
    },

    async createPasswordSetupTicket({
      inviteUrl,
      userId,
    }: {
      inviteUrl: string;
      userId: string;
    }) {
      const redirectPayload = config.employerAppClientId
        ? { client_id: config.employerAppClientId }
        : { result_url: inviteUrl };
      const payload = await requestManagementApi<Auth0PasswordTicket>(
        config,
        '/tickets/password-change',
        {
          body: JSON.stringify({
            ...redirectPayload,
            includeEmailInRedirect: false,
            mark_email_as_verified: true,
            ttl_sec: config.passwordTicketTtlSeconds,
            user_id: userId,
          }),
          method: 'POST',
        }
      );

      if (!payload.ticket) {
        throw new ApplicationError('Auth0 password setup ticket response did not include a ticket.');
      }

      return {
        expiresAt: new Date(Date.now() + config.passwordTicketTtlSeconds * 1000).toISOString(),
        ticketUrl: payload.ticket,
      };
    },

    async getEmployerUser({
      userId,
    }: {
      userId: string;
    }) {
      const user = await requestManagementApi<Auth0User>(
        config,
        `/users/${encodeURIComponent(userId)}`
      );

      if (!isEmployerConnectionUser(user, config)) {
        return null;
      }

      return user;
    },

    async ensureEmployerUser({
      email,
      firstName,
      lastName,
      name,
    }: {
      email: string;
      firstName?: string | null;
      lastName?: string | null;
      name?: string | null;
    }) {
      const normalizedEmail = email.trim().toLowerCase();
      const existingUsers = await requestManagementApi<Auth0User[]>(
        config,
        `/users-by-email?email=${encodeURIComponent(normalizedEmail)}`
      );
      const existingUser = existingUsers.find((user) => isEmployerConnectionUser(user, config));

      if (existingUser) {
        if (existingUser.blocked) {
          await requestManagementApi<Auth0User>(
            config,
            `/users/${encodeURIComponent(existingUser.user_id)}`,
            {
              body: JSON.stringify({ blocked: false, email_verified: true }),
              method: 'PATCH',
            }
          );
        }

        return {
          created: false,
          userId: existingUser.user_id,
        };
      }

      const createdUser = await requestManagementApi<Auth0User>(config, '/users', {
        body: JSON.stringify({
          blocked: false,
          connection: config.connectionName,
          email: normalizedEmail,
          email_verified: true,
          family_name: lastName || undefined,
          given_name: firstName || undefined,
          name: name || [firstName, lastName].filter(Boolean).join(' ') || normalizedEmail,
          password: generatedPassword(),
          verify_email: false,
        }),
        method: 'POST',
      });

      return {
        created: true,
        userId: createdUser.user_id,
      };
    },
  };
};

import { errors } from '@strapi/utils';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

const { UnauthorizedError } = errors;

type Auth0MiddlewareConfig = {
  required?: boolean;
};

type HireFlipAuthState = {
  type: 'auth0';
  subject: string;
  email?: string;
  roles: string[];
  permissions: string[];
  claims: JWTPayload;
};

const jwksByIssuer = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

const normalizeIssuer = (value?: string) => {
  if (!value) {
    return undefined;
  }

  const issuer = value.startsWith('http://') || value.startsWith('https://') ? value : `https://${value}`;
  return issuer.endsWith('/') ? issuer : `${issuer}/`;
};

const getJwks = (issuer: string) => {
  const cached = jwksByIssuer.get(issuer);

  if (cached) {
    return cached;
  }

  const jwks = createRemoteJWKSet(new URL('.well-known/jwks.json', issuer));
  jwksByIssuer.set(issuer, jwks);

  return jwks;
};

const getBearerToken = (authorizationHeader?: string) => {
  if (!authorizationHeader) {
    return undefined;
  }

  const [scheme, token] = authorizationHeader.split(' ');

  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return undefined;
  }

  return token;
};

const toStringArray = (value: unknown) => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string');
};

export default (config: Auth0MiddlewareConfig = {}) => {
  const required = config.required ?? true;

  return async (ctx, next) => {
    const token = getBearerToken(ctx.request.get('authorization'));

    if (!token) {
      if (!required) {
        return next();
      }

      throw new UnauthorizedError('Bearer token is required.');
    }

    const issuer = normalizeIssuer(process.env.AUTH0_ISSUER || process.env.AUTH0_DOMAIN);
    const audience = process.env.AUTH0_AUDIENCE;

    if (!issuer || !audience) {
      throw new UnauthorizedError('Auth0 verification is not configured.');
    }

    const { payload } = await jwtVerify(token, getJwks(issuer), {
      issuer,
      audience,
    });

    if (!payload.sub) {
      throw new UnauthorizedError('Token subject is required.');
    }

    const roleClaim = process.env.AUTH0_ROLE_CLAIM || 'https://hireflip.work/roles';
    const permissionClaim = process.env.AUTH0_PERMISSION_CLAIM || 'permissions';

    ctx.state.hireflipAuth = {
      type: 'auth0',
      subject: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : undefined,
      roles: toStringArray(payload[roleClaim] || payload.roles),
      permissions: toStringArray(payload[permissionClaim]),
      claims: payload,
    } satisfies HireFlipAuthState;

    return next();
  };
};

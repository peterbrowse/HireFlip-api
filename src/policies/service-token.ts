import { createHash, timingSafeEqual } from 'crypto';

type ServiceTokenConfig = {
  allowedServices?: string[];
};

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

const safeEqualHex = (left: string, right: string) => {
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
};

const getAllowedHashes = () =>
  (process.env.SERVICE_TOKEN_SHA256_HASHES || '')
    .split(',')
    .map((hash) => hash.trim().toLowerCase())
    .filter(Boolean);

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

const normalizeServices = (services: unknown) =>
  Array.isArray(services) ? services.filter((service) => typeof service === 'string') : [];

export default (ctx, config: ServiceTokenConfig = {}) => {
  const token = ctx.request.get('x-hireflip-service-token') || getBearerToken(ctx.request.get('authorization'));
  const serviceName = ctx.request.get('x-hireflip-service-name') || 'unknown';
  const allowedServices = normalizeServices(config.allowedServices);

  if (!token) {
    return false;
  }

  if (allowedServices.length > 0 && !allowedServices.includes(serviceName)) {
    return false;
  }

  const tokenHash = hashToken(token);
  const matches = getAllowedHashes().some((allowedHash) => safeEqualHex(tokenHash, allowedHash));

  if (!matches) {
    return false;
  }

  ctx.state.hireflipAuth = {
    type: 'service',
    serviceName,
    tokenHash,
  };

  return true;
};

import { createHash, timingSafeEqual } from 'crypto';

type ServiceTokenConfig = {
  allowedServices?: string[];
};

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const serviceHashPairSeparator = ':';

type ServiceTokenHashEntry = {
  hash: string;
  serviceName: string;
};

const normalizeServiceName = (serviceName: string) => serviceName.trim().toLowerCase();

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

const getServiceBoundHashes = (): ServiceTokenHashEntry[] =>
  (process.env.SERVICE_TOKEN_SHA256_BY_SERVICE || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separatorIndex = entry.indexOf(serviceHashPairSeparator);

      if (separatorIndex <= 0) {
        return undefined;
      }

      const serviceName = normalizeServiceName(entry.slice(0, separatorIndex));
      const hash = entry.slice(separatorIndex + 1).trim().toLowerCase();

      return serviceName && hash ? { serviceName, hash } : undefined;
    })
    .filter((entry): entry is ServiceTokenHashEntry => Boolean(entry));

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
  Array.isArray(services)
    ? services.filter((service) => typeof service === 'string').map(normalizeServiceName)
    : [];

export default (ctx, config: ServiceTokenConfig = {}) => {
  const token = ctx.request.get('x-hireflip-service-token') || getBearerToken(ctx.request.get('authorization'));
  const serviceName = normalizeServiceName(ctx.request.get('x-hireflip-service-name') || '');
  const allowedServices = normalizeServices(config.allowedServices);

  if (!token || !serviceName) {
    return false;
  }

  if (allowedServices.length > 0 && !allowedServices.includes(serviceName)) {
    return false;
  }

  const tokenHash = hashToken(token);
  const serviceBoundHashes = getServiceBoundHashes();
  const serviceHashes = serviceBoundHashes
    .filter((entry) => entry.serviceName === serviceName)
    .map((entry) => entry.hash);
  const hashesToCheck = serviceBoundHashes.length > 0 ? serviceHashes : getAllowedHashes();
  const matches =
    hashesToCheck.length > 0 && hashesToCheck.some((allowedHash) => safeEqualHex(tokenHash, allowedHash));

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

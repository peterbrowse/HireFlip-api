import type { Middleware } from "@strapi/strapi";
import jwt, { JwtHeader, SigningKeyCallback } from "jsonwebtoken";
import jwksClient from "jwks-rsa";

const getRequiredEnv = (key: string): string => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
};

const issuer = process.env.AUTH0_ISSUER || "";
const audience = process.env.AUTH0_AUDIENCE || "";
const jwksUri =
  process.env.AUTH0_JWKS_URI || (issuer ? `${issuer}.well-known/jwks.json` : "");

const jwks = jwksClient({
  jwksUri,
  cache: true,
  cacheMaxEntries: 5,
  cacheMaxAge: 10 * 60 * 1000,
  rateLimit: true,
  jwksRequestsPerMinute: 10,
});

const getKey = (header: JwtHeader, callback: SigningKeyCallback) => {
  if (!header.kid) {
    callback(new Error("No KID found in token header"));
    return;
  }

  jwks.getSigningKey(header.kid, (err, key) => {
    if (err) {
      callback(err);
      return;
    }
    const signingKey = key?.getPublicKey();
    callback(null, signingKey);
  });
};

const verifyToken = (token: string) =>
  new Promise((resolve, reject) => {
    try {
      const iss = issuer || getRequiredEnv("AUTH0_ISSUER");
      const aud = audience || getRequiredEnv("AUTH0_AUDIENCE");

      jwt.verify(
        token,
        getKey,
        {
          algorithms: ["RS256"],
          audience: aud,
          issuer: iss,
        },
        (err, decoded) => {
          if (err || !decoded) {
            reject(err || new Error("Invalid token"));
            return;
          }
          resolve(decoded);
        }
      );
    } catch (err) {
      reject(err);
    }
  });

const auth0Middleware: Middleware = async (ctx, next) => {
  const { url } = ctx.request;

  // Skip non-API routes (e.g. admin, assets) and explicitly public paths.
  if (!url.startsWith("/api")) {
    return next();
  }

  const publicPaths = ["/api/health", "/api/public"];
  if (publicPaths.some((path) => url.startsWith(path))) {
    return next();
  }

  const authHeader = ctx.request.header.authorization;
  if (!authHeader) {
    return ctx.unauthorized("Authorization header missing");
  }

  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    return ctx.unauthorized("Invalid Authorization header format");
  }

  const token = parts[1];

  try {
    const decoded = (await verifyToken(token)) as Record<string, unknown>;
    const roleClaim =
      process.env.AUTH0_ROLE_CLAIM || "https://hireflip.com/roles";

    const rolesClaim = decoded[roleClaim];
    const roles = Array.isArray(rolesClaim)
      ? rolesClaim
      : rolesClaim
      ? [rolesClaim]
      : [];

    const authContext = {
      sub: decoded.sub,
      email: decoded.email,
      roles,
      raw: decoded,
    };

    ctx.state.auth = authContext;

    return await next();
  } catch (err) {
    strapi.log.error("Auth0 verification failed", err);
    return ctx.unauthorized("Invalid or expired token");
  }
};

export default auth0Middleware;

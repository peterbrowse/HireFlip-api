import {
  createHash,
  randomBytes,
  randomInt,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';
import { errors, validateZodSchema, z } from '@strapi/utils';

const { ApplicationError, ForbiddenError, RateLimitError, UnauthorizedError, ValidationError } = errors;

const scryptAsync = promisify(scrypt);
const storeName = 'admin-dashboard-auth';
const sessionTokenBytes = 32;
const defaultCodeTtlSeconds = 10 * 60;
const defaultCodeAttempts = 5;
const defaultResendCooldownSeconds = 60;
const defaultLockoutSeconds = 15 * 60;
const defaultSessionTtlSeconds = 8 * 60 * 60;
const defaultRememberMeTtlSeconds = 7 * 24 * 60 * 60;

type RequestContext = {
  ipAddress?: string;
  requestId?: string;
  serviceName?: string;
  userAgent?: string;
};

type AdminRoleKey = 'admin' | 'sales' | 'super_admin' | 'support';

type AdminUser = Record<string, unknown> & {
  email?: string;
  firstname?: string;
  id?: number | string;
  isActive?: boolean;
  lastname?: string;
  roles?: Array<Record<string, unknown>>;
  username?: string;
};

type AdminSessionUser = {
  displayName: string;
  email: string;
  id: string;
  roleKeys: AdminRoleKey[];
  roles: string[];
};

type TwoFactorChallenge = {
  attempts: number;
  codeHash: string;
  email: string;
  expiresAt: string;
  id: string;
  ipAddress?: string;
  rememberMe: boolean;
  resendAvailableAt: string;
  salt: string;
  user: AdminSessionUser;
  userId: string;
};

type AdminSession = {
  createdAt: string;
  expiresAt: string;
  lastSeenAt?: string;
  rememberMe: boolean;
  sessionHash: string;
  user: AdminSessionUser;
  userId: string;
};

type Store = {
  delete(input: { key: string }): Promise<void>;
  get(input: { key: string }): Promise<unknown>;
  set(input: { key: string; value: unknown }): Promise<void>;
};

type AuditEventService = {
  record(input: Record<string, unknown>): Promise<unknown>;
};

type AdminAuthService = {
  checkCredentials(input: { email: string; password: string }): Promise<[unknown, AdminUser | false, { message?: string }?]>;
  forgotPassword(input: { email: string }): Promise<unknown>;
};

const loginSchema = z
  .object({
    email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
    password: z.string().min(1).max(2048),
    rememberMe: z.boolean().default(false),
  })
  .strict();

const verifyTwoFactorSchema = z
  .object({
    challengeId: z.string().trim().min(1).max(160),
    code: z.string().trim().regex(/^\d{6}$/, 'Code must be a 6-digit number.'),
  })
  .strict();

const resendTwoFactorSchema = z
  .object({
    challengeId: z.string().trim().min(1).max(160),
  })
  .strict();

const sessionTokenSchema = z
  .object({
    sessionToken: z.string().trim().min(32).max(512),
  })
  .strict();

const staffPasswordResetSchema = z
  .object({
    email: z.string().trim().email().max(254).optional().transform((value) => value?.toLowerCase()),
    sessionToken: z.string().trim().min(32).max(512),
    staffUserId: z.union([z.number().int().positive(), z.string().trim().min(1).max(80)]).optional(),
  })
  .strict()
  .refine((value) => Boolean(value.email || value.staffUserId), {
    message: 'Email or staff user ID is required.',
  });

const validateLogin = validateZodSchema(loginSchema);
const validateVerifyTwoFactor = validateZodSchema(verifyTwoFactorSchema);
const validateResendTwoFactor = validateZodSchema(resendTwoFactorSchema);
const validateSessionToken = validateZodSchema(sessionTokenSchema);
const validateStaffPasswordReset = validateZodSchema(staffPasswordResetSchema);

const secondsEnv = (name: string, fallback: number) => {
  const value = Number.parseInt(process.env[name] || '', 10);

  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const config = () => ({
  codeAttempts: secondsEnv('ADMIN_EMAIL_2FA_MAX_ATTEMPTS', defaultCodeAttempts),
  codeTtlSeconds: secondsEnv('ADMIN_EMAIL_2FA_CODE_TTL_SECONDS', defaultCodeTtlSeconds),
  lockoutSeconds: secondsEnv('ADMIN_EMAIL_2FA_LOCKOUT_SECONDS', defaultLockoutSeconds),
  rememberMeSessionTtlSeconds: secondsEnv(
    'ADMIN_DASHBOARD_REMEMBER_ME_TTL_SECONDS',
    defaultRememberMeTtlSeconds
  ),
  resendCooldownSeconds: secondsEnv(
    'ADMIN_EMAIL_2FA_RESEND_COOLDOWN_SECONDS',
    defaultResendCooldownSeconds
  ),
  sessionTtlSeconds: secondsEnv('ADMIN_DASHBOARD_SESSION_TTL_SECONDS', defaultSessionTtlSeconds),
});

const getStore = (): Store =>
  strapi.store({
    type: 'plugin',
    name: storeName,
  }) as unknown as Store;

const hashValue = (value: string) => createHash('sha256').update(value).digest('hex');
const challengeKey = (challengeId: string) => `challenge:${challengeId}`;
const sessionKey = (sessionHash: string) => `session:${sessionHash}`;
const userSessionIndexKey = (userId: string) => `user-sessions:${userId}`;
const lockKey = (scope: string, identifier: string) => `lock:${scope}:${hashValue(identifier)}`;

const numericCode = () => randomInt(0, 1_000_000).toString().padStart(6, '0');
const token = () => randomBytes(sessionTokenBytes).toString('base64url');
const addSeconds = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString();
const isPast = (isoDate?: string) => !isoDate || new Date(isoDate).getTime() <= Date.now();

const createCodeHash = async (challengeId: string, code: string, salt: string) => {
  const derivedKey = (await scryptAsync(`${challengeId}:${code}`, salt, 64)) as Buffer;

  return derivedKey.toString('hex');
};

const safeEqualHex = (left: string, right: string) => {
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
};

const normalizeRole = (value: unknown) =>
  typeof value === 'string'
    ? value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
    : '';

const roleKeyFromRole = (role: Record<string, unknown>): AdminRoleKey | undefined => {
  const name = normalizeRole(role.name);
  const code = normalizeRole(role.code);
  const type = normalizeRole(role.type);
  const values = new Set([name, code, type]);

  if (values.has('super_admin') || values.has('strapi_super_admin')) {
    return 'super_admin';
  }

  if (values.has('admin') || values.has('hireflip_admin')) {
    return 'admin';
  }

  if (values.has('sales') || values.has('hireflip_sales')) {
    return 'sales';
  }

  if (values.has('support') || values.has('hireflip_support')) {
    return 'support';
  }

  return undefined;
};

const roleLabel = (roleKey: AdminRoleKey) => {
  if (roleKey === 'super_admin') {
    return 'Super Admin';
  }

  return `${roleKey.charAt(0).toUpperCase()}${roleKey.slice(1)}`;
};

const displayName = (user: AdminUser) => {
  const firstName = typeof user.firstname === 'string' ? user.firstname.trim() : '';
  const lastName = typeof user.lastname === 'string' ? user.lastname.trim() : '';
  const fullName = `${firstName} ${lastName}`.trim();

  return fullName || String(user.username || user.email || 'Admin user');
};

const getAdminAuthService = () => strapi.service('admin::auth') as unknown as AdminAuthService;
const getAuditEventService = () =>
  strapi.service('api::audit-event.audit-event') as unknown as AuditEventService;

const findAdminUserById = async (id: string | number) =>
  strapi.db.query('admin::user').findOne({
    where: {
      id,
    },
    populate: ['roles'],
  }) as Promise<AdminUser | null>;

const findAdminUserByEmail = async (email: string) =>
  strapi.db.query('admin::user').findOne({
    where: {
      email,
      isActive: true,
    },
    populate: ['roles'],
  }) as Promise<AdminUser | null>;

const toSessionUser = (user: AdminUser): AdminSessionUser => {
  const roleKeys = Array.from(
    new Set((user.roles || []).map(roleKeyFromRole).filter(Boolean) as AdminRoleKey[])
  );

  if (roleKeys.length === 0) {
    throw new ForbiddenError('This staff account does not have a HireFlip admin dashboard role.');
  }

  if (!user.email || !user.id) {
    throw new ValidationError('Staff account is missing required identity fields.');
  }

  return {
    displayName: displayName(user),
    email: user.email,
    id: String(user.id),
    roleKeys,
    roles: roleKeys.map(roleLabel),
  };
};

const maskEmail = (email: string) => {
  const [localPart, domain] = email.split('@');
  const visible = localPart.slice(0, Math.min(localPart.length, 2));

  return `${visible}${'*'.repeat(Math.max(localPart.length - visible.length, 2))}@${domain}`;
};

const recordAuditEvent = async (
  eventType: string,
  context: RequestContext,
  details: Record<string, unknown> = {}
) => {
  try {
    await getAuditEventService().record({
      actorDisplayName: details.actorDisplayName as string | undefined,
      actorEmail: details.actorEmail as string | undefined,
      actorId: details.actorId as string | undefined,
      actorType: details.actorType || 'admin',
      eventCategory: details.eventCategory || 'security',
      eventType,
      ipAddress: context.ipAddress,
      metadata: details.metadata,
      requestId: context.requestId,
      serviceName: context.serviceName,
      severity: details.severity || 'info',
      source: 'admin_dashboard',
      subjectDisplayName: details.subjectDisplayName as string | undefined,
      subjectId: details.subjectId as string | undefined,
      subjectType: details.subjectType as string | undefined,
      userAgent: context.userAgent,
    });
  } catch (error) {
    strapi.log.warn(`Failed to record admin auth audit event ${eventType}.`, error);
  }
};

const assertNotLocked = async (store: Store, scope: string, identifier?: string) => {
  if (!identifier) {
    return;
  }

  const existing = (await store.get({ key: lockKey(scope, identifier) })) as
    | { lockedUntil?: string }
    | undefined;

  if (existing?.lockedUntil && !isPast(existing.lockedUntil)) {
    throw new RateLimitError('Too many authentication attempts. Please try again later.');
  }
};

const recordFailedAttempt = async (
  store: Store,
  scope: string,
  identifier: string | undefined,
  lockoutSeconds: number,
  threshold = defaultCodeAttempts
) => {
  if (!identifier) {
    return;
  }

  const key = lockKey(scope, identifier);
  const existing = (await store.get({ key })) as
    | {
        count?: number;
        lockedUntil?: string;
      }
    | undefined;

  if (existing?.lockedUntil && !isPast(existing.lockedUntil)) {
    throw new RateLimitError('Too many authentication attempts. Please try again later.');
  }

  const count = (existing?.count || 0) + 1;

  await store.set({
    key,
    value: {
      count,
      ...(count >= threshold ? { lockedUntil: addSeconds(lockoutSeconds) } : {}),
    },
  });
};

const clearFailedAttempt = async (store: Store, scope: string, identifier?: string) => {
  if (!identifier) {
    return;
  }

  await store.delete({ key: lockKey(scope, identifier) });
};

const sendTwoFactorEmail = async (email: string, code: string, expiresAt: string) => {
  const expiresAtDate = new Date(expiresAt);
  const expiryMinutes = Math.max(1, Math.round((expiresAtDate.getTime() - Date.now()) / 60000));

  await strapi.plugin('email').service('email').send({
    html: `<p>Your HireFlip admin sign-in code is <strong>${code}</strong>.</p><p>This code expires in ${expiryMinutes} minutes.</p><p>If you did not try to sign in, contact the Super Admin team.</p>`,
    subject: 'Your HireFlip admin sign-in code',
    text: `Your HireFlip admin sign-in code is ${code}. This code expires in ${expiryMinutes} minutes. If you did not try to sign in, contact the Super Admin team.`,
    to: email,
  });
};

const loadChallenge = async (store: Store, challengeId: string) => {
  const challenge = (await store.get({ key: challengeKey(challengeId) })) as
    | TwoFactorChallenge
    | undefined;

  if (!challenge) {
    throw new UnauthorizedError('Two-factor challenge not found. Please sign in again.');
  }

  if (isPast(challenge.expiresAt)) {
    await store.delete({ key: challengeKey(challengeId) });
    throw new UnauthorizedError('Two-factor challenge expired. Please sign in again.');
  }

  return challenge;
};

const addSessionToUserIndex = async (store: Store, userId: string, sessionHash: string) => {
  const key = userSessionIndexKey(userId);
  const existing = ((await store.get({ key })) as string[] | undefined) || [];
  const nextValue = Array.from(new Set([...existing, sessionHash]));

  await store.set({ key, value: nextValue });
};

const removeSessionFromUserIndex = async (store: Store, userId: string, sessionHash: string) => {
  const key = userSessionIndexKey(userId);
  const existing = ((await store.get({ key })) as string[] | undefined) || [];
  const nextValue = existing.filter((value) => value !== sessionHash);

  await store.set({ key, value: nextValue });
};

const createSession = async (store: Store, user: AdminSessionUser, rememberMe: boolean) => {
  const sessionToken = token();
  const sessionHash = hashValue(sessionToken);
  const createdAt = new Date().toISOString();
  const ttlSeconds = rememberMe ? config().rememberMeSessionTtlSeconds : config().sessionTtlSeconds;
  const session: AdminSession = {
    createdAt,
    expiresAt: addSeconds(ttlSeconds),
    rememberMe,
    sessionHash,
    user,
    userId: user.id,
  };

  await store.set({
    key: sessionKey(sessionHash),
    value: session,
  });
  await addSessionToUserIndex(store, user.id, sessionHash);

  return {
    expiresAt: session.expiresAt,
    sessionToken,
    user,
  };
};

const invalidateUserSessions = async (store: Store, userId: string) => {
  const key = userSessionIndexKey(userId);
  const sessionHashes = ((await store.get({ key })) as string[] | undefined) || [];

  await Promise.all(sessionHashes.map((sessionHash) => store.delete({ key: sessionKey(sessionHash) })));
  await store.set({ key, value: [] });

  return sessionHashes.length;
};

const getStoredSession = async (store: Store, sessionToken: string, context?: RequestContext) => {
  const sessionHash = hashValue(sessionToken);
  const session = (await store.get({ key: sessionKey(sessionHash) })) as AdminSession | undefined;

  if (!session) {
    throw new UnauthorizedError('Admin session not found.');
  }

  if (isPast(session.expiresAt)) {
    await store.delete({ key: sessionKey(sessionHash) });
    await removeSessionFromUserIndex(store, session.userId, sessionHash);
    throw new UnauthorizedError('Admin session expired.');
  }

  const nextSession = {
    ...session,
    lastSeenAt: new Date().toISOString(),
  };

  await store.set({
    key: sessionKey(sessionHash),
    value: nextSession,
  });

  if (context) {
    void recordAuditEvent('admin.auth.session_validated', context, {
      actorEmail: session.user.email,
      actorId: session.user.id,
      actorDisplayName: session.user.displayName,
      metadata: {
        rememberMe: session.rememberMe,
        roleKeys: session.user.roleKeys,
      },
    });
  }

  return {
    expiresAt: session.expiresAt,
    rememberMe: session.rememberMe,
    user: session.user,
  };
};

const requireSuperAdminSession = async (store: Store, sessionToken: string, context: RequestContext) => {
  const session = await getStoredSession(store, sessionToken, context);

  if (!session.user.roleKeys.includes('super_admin')) {
    throw new ForbiddenError('Super Admin access is required.');
  }

  return session;
};

export default () => ({
  async createTwoFactorChallenge(input: unknown, requestContext: RequestContext = {}) {
    const body = validateLogin(input);
    const store = getStore();
    const currentConfig = config();

    await assertNotLocked(store, 'login:email', body.email);
    await assertNotLocked(store, 'login:ip', requestContext.ipAddress);

    const [, user, info] = await getAdminAuthService().checkCredentials({
      email: body.email,
      password: body.password,
    });

    if (!user) {
      await recordFailedAttempt(
        store,
        'login:email',
        body.email,
        currentConfig.lockoutSeconds,
        currentConfig.codeAttempts
      );
      await recordFailedAttempt(
        store,
        'login:ip',
        requestContext.ipAddress,
        currentConfig.lockoutSeconds,
        currentConfig.codeAttempts
      );
      await recordAuditEvent('admin.auth.login_failed', requestContext, {
        actorEmail: body.email,
        metadata: {
          reason: info?.message || 'Invalid credentials',
        },
        severity: 'warning',
      });
      throw new UnauthorizedError(info?.message || 'Invalid credentials');
    }

    await clearFailedAttempt(store, 'login:email', body.email);
    await clearFailedAttempt(store, 'login:ip', requestContext.ipAddress);

    const fullUser = await findAdminUserById(user.id || '');
    const sessionUser = toSessionUser(fullUser || user);
    const challengeId = randomUUID();
    const code = numericCode();
    const salt = randomBytes(16).toString('hex');
    const expiresAt = addSeconds(currentConfig.codeTtlSeconds);
    const codeHash = await createCodeHash(challengeId, code, salt);
    const challenge: TwoFactorChallenge = {
      attempts: 0,
      codeHash,
      email: sessionUser.email,
      expiresAt,
      id: challengeId,
      ipAddress: requestContext.ipAddress,
      rememberMe: body.rememberMe,
      resendAvailableAt: addSeconds(currentConfig.resendCooldownSeconds),
      salt,
      user: sessionUser,
      userId: sessionUser.id,
    };

    await store.set({
      key: challengeKey(challengeId),
      value: challenge,
    });
    await recordAuditEvent('admin.auth.2fa_challenge_created', requestContext, {
      actorEmail: sessionUser.email,
      actorId: sessionUser.id,
      actorDisplayName: sessionUser.displayName,
      metadata: {
        rememberMe: body.rememberMe,
        roleKeys: sessionUser.roleKeys,
      },
    });

    try {
      await sendTwoFactorEmail(sessionUser.email, code, expiresAt);
      await recordAuditEvent('admin.auth.2fa_challenge_delivered', requestContext, {
        actorEmail: sessionUser.email,
        actorId: sessionUser.id,
        actorDisplayName: sessionUser.displayName,
      });
    } catch (error) {
      await store.delete({ key: challengeKey(challengeId) });
      await recordAuditEvent('admin.auth.2fa_delivery_failed', requestContext, {
        actorEmail: sessionUser.email,
        actorId: sessionUser.id,
        actorDisplayName: sessionUser.displayName,
        metadata: {
          message: error instanceof Error ? error.message : 'Email delivery failed.',
        },
        severity: 'error',
      });
      throw new ApplicationError(
        'Email verification code could not be sent. Check the notification service and try again.'
      );
    }

    return {
      challengeId,
      expiresAt,
      maskedEmail: maskEmail(sessionUser.email),
      rememberMe: body.rememberMe,
      resendAvailableAt: challenge.resendAvailableAt,
    };
  },

  async resendTwoFactorChallenge(input: unknown, requestContext: RequestContext = {}) {
    const body = validateResendTwoFactor(input);
    const store = getStore();
    const currentConfig = config();
    const challenge = await loadChallenge(store, body.challengeId);

    await assertNotLocked(store, '2fa:email', challenge.email);
    await assertNotLocked(store, '2fa:ip', requestContext.ipAddress || challenge.ipAddress);

    if (!isPast(challenge.resendAvailableAt)) {
      await recordAuditEvent('admin.auth.2fa_rate_limited', requestContext, {
        actorEmail: challenge.email,
        actorId: challenge.userId,
        actorDisplayName: challenge.user.displayName,
        severity: 'warning',
      });
      throw new RateLimitError('Please wait before requesting another code.');
    }

    const code = numericCode();
    const salt = randomBytes(16).toString('hex');
    const expiresAt = addSeconds(currentConfig.codeTtlSeconds);
    const codeHash = await createCodeHash(challenge.id, code, salt);
    const nextChallenge: TwoFactorChallenge = {
      ...challenge,
      attempts: 0,
      codeHash,
      expiresAt,
      resendAvailableAt: addSeconds(currentConfig.resendCooldownSeconds),
      salt,
    };

    await store.set({
      key: challengeKey(challenge.id),
      value: nextChallenge,
    });

    try {
      await sendTwoFactorEmail(challenge.email, code, expiresAt);
    } catch (error) {
      await store.set({
        key: challengeKey(challenge.id),
        value: challenge,
      });
      await recordAuditEvent('admin.auth.2fa_delivery_failed', requestContext, {
        actorEmail: challenge.email,
        actorId: challenge.userId,
        actorDisplayName: challenge.user.displayName,
        metadata: {
          message: error instanceof Error ? error.message : 'Email delivery failed.',
          resent: true,
        },
        severity: 'error',
      });
      throw new ApplicationError(
        'Email verification code could not be sent. Check the notification service and try again.'
      );
    }

    await recordAuditEvent('admin.auth.2fa_challenge_delivered', requestContext, {
      actorEmail: challenge.email,
      actorId: challenge.userId,
      actorDisplayName: challenge.user.displayName,
      metadata: {
        resent: true,
      },
    });

    return {
      challengeId: challenge.id,
      expiresAt,
      maskedEmail: maskEmail(challenge.email),
      resendAvailableAt: nextChallenge.resendAvailableAt,
    };
  },

  async verifyTwoFactorChallenge(input: unknown, requestContext: RequestContext = {}) {
    const body = validateVerifyTwoFactor(input);
    const store = getStore();
    const currentConfig = config();
    const challenge = await loadChallenge(store, body.challengeId);

    await assertNotLocked(store, '2fa:email', challenge.email);
    await assertNotLocked(store, '2fa:ip', requestContext.ipAddress || challenge.ipAddress);

    const codeHash = await createCodeHash(challenge.id, body.code, challenge.salt);
    const isValid = safeEqualHex(codeHash, challenge.codeHash);

    if (!isValid) {
      const attempts = challenge.attempts + 1;

      if (attempts >= currentConfig.codeAttempts) {
        await store.delete({ key: challengeKey(challenge.id) });
        await recordFailedAttempt(
          store,
          '2fa:email',
          challenge.email,
          currentConfig.lockoutSeconds,
          1
        );
        await recordFailedAttempt(
          store,
          '2fa:ip',
          requestContext.ipAddress || challenge.ipAddress,
          currentConfig.lockoutSeconds,
          1
        );
        await recordAuditEvent('admin.auth.2fa_locked', requestContext, {
          actorEmail: challenge.email,
          actorId: challenge.userId,
          actorDisplayName: challenge.user.displayName,
          severity: 'warning',
        });
        throw new RateLimitError('Too many code attempts. Please sign in again later.');
      }

      await store.set({
        key: challengeKey(challenge.id),
        value: {
          ...challenge,
          attempts,
        },
      });
      await recordAuditEvent('admin.auth.2fa_failed', requestContext, {
        actorEmail: challenge.email,
        actorId: challenge.userId,
        actorDisplayName: challenge.user.displayName,
        metadata: {
          attempts,
        },
        severity: 'warning',
      });
      throw new UnauthorizedError('Invalid two-factor code.');
    }

    await store.delete({ key: challengeKey(challenge.id) });
    await clearFailedAttempt(store, '2fa:email', challenge.email);
    await clearFailedAttempt(store, '2fa:ip', requestContext.ipAddress || challenge.ipAddress);

    const session = await createSession(store, challenge.user, challenge.rememberMe);

    await recordAuditEvent('admin.auth.2fa_passed', requestContext, {
      actorEmail: challenge.email,
      actorId: challenge.userId,
      actorDisplayName: challenge.user.displayName,
      metadata: {
        rememberMe: challenge.rememberMe,
        roleKeys: challenge.user.roleKeys,
      },
    });
    await recordAuditEvent('admin.auth.session_created', requestContext, {
      actorEmail: challenge.email,
      actorId: challenge.userId,
      actorDisplayName: challenge.user.displayName,
      metadata: {
        rememberMe: challenge.rememberMe,
      },
    });

    return session;
  },

  async getSession(input: unknown, requestContext: RequestContext = {}) {
    const body = validateSessionToken(input);

    return getStoredSession(getStore(), body.sessionToken, requestContext);
  },

  async logout(input: unknown, requestContext: RequestContext = {}) {
    const body = validateSessionToken(input);
    const store = getStore();
    const sessionHash = hashValue(body.sessionToken);
    const session = (await store.get({ key: sessionKey(sessionHash) })) as AdminSession | undefined;

    if (session) {
      await store.delete({ key: sessionKey(sessionHash) });
      await removeSessionFromUserIndex(store, session.userId, sessionHash);
      await recordAuditEvent('admin.auth.session_logged_out', requestContext, {
        actorEmail: session.user.email,
        actorId: session.user.id,
        actorDisplayName: session.user.displayName,
      });
    }

    return {
      loggedOut: true,
    };
  },

  async requestStaffPasswordReset(input: unknown, requestContext: RequestContext = {}) {
    const body = validateStaffPasswordReset(input);
    const store = getStore();
    const actorSession = await requireSuperAdminSession(store, body.sessionToken, requestContext);
    const targetUser = body.staffUserId
      ? await findAdminUserById(body.staffUserId)
      : body.email
        ? await findAdminUserByEmail(body.email)
        : null;

    if (!targetUser?.email || !targetUser.id) {
      throw new ValidationError('Staff user could not be found.');
    }

    await getAdminAuthService().forgotPassword({ email: targetUser.email });
    const invalidatedSessions = await invalidateUserSessions(store, String(targetUser.id));

    await recordAuditEvent('admin.staff.reset_password_requested', requestContext, {
      actorEmail: actorSession.user.email,
      actorId: actorSession.user.id,
      actorDisplayName: actorSession.user.displayName,
      eventCategory: 'admin',
      metadata: {
        invalidatedSessions,
      },
      subjectDisplayName: displayName(targetUser),
      subjectId: String(targetUser.id),
      subjectType: 'admin_user',
    });

    return {
      invalidatedSessions,
      resetRequested: true,
      staffUser: {
        displayName: displayName(targetUser),
        email: targetUser.email,
        id: String(targetUser.id),
      },
    };
  },
});

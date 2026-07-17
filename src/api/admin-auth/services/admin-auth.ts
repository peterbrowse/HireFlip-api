import {
  createHash,
  randomBytes,
  randomInt,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from 'node:crypto';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { errors, validateZodSchema, z } from '@strapi/utils';
import sharp from 'sharp';

const { ApplicationError, ForbiddenError, RateLimitError, UnauthorizedError, ValidationError } = errors;

const scryptAsync = promisify(scrypt);
const storeName = 'admin-dashboard-auth';
const sessionTokenBytes = 32;
const resetPasswordTokenBytes = 20;
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
  blocked?: boolean;
  createdAt?: string;
  registrationToken?: string;
  roles?: Array<Record<string, unknown>>;
  updatedAt?: string;
  username?: string;
};

type AdminSessionUser = {
  displayName: string;
  email: string;
  firstname: string;
  id: string;
  lastname: string;
  profileImage?: StaffProfileImage | null;
  roleKeys: AdminRoleKey[];
  roles: string[];
};

type StaffProfileImage = {
  alternativeText?: string | null;
  documentId?: string | null;
  ext?: string | null;
  height?: number | null;
  id?: number | string | null;
  mime?: string | null;
  name?: string | null;
  size?: number | null;
  url: string;
  width?: number | null;
};

type StaffUserStatus = 'active' | 'blocked' | 'inactive' | 'pending_invite';

type StaffUserSummaryPayload = {
  createdAt: string | null;
  displayName: string;
  email: string;
  id: string;
  roleKeys: AdminRoleKey[];
  roles: string[];
  status: StaffUserStatus;
  updatedAt: string | null;
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
};

type AdminUserService = {
  create(input: Record<string, unknown>): Promise<AdminUser>;
  deleteById(id: string | number): Promise<AdminUser | null>;
  findRegistrationInfo(registrationToken: string): Promise<Pick<AdminUser, 'email' | 'firstname' | 'lastname'> | undefined>;
  register(input: {
    registrationToken: string;
    userInfo: {
      firstname: string;
      lastname?: string | null;
      password: string;
    };
  }): Promise<AdminUser>;
  updateById(id: string | number, input: Record<string, unknown>): Promise<AdminUser | null>;
};

type DocumentRecord = Record<string, unknown> & {
  adminUserId?: string;
  documentId?: string;
  id?: number | string;
  profileImage?: Record<string, unknown> | null;
};

type DocumentCollection = {
  create(input: Record<string, unknown>): Promise<DocumentRecord>;
  findMany(input: Record<string, unknown>): Promise<DocumentRecord[]>;
  update(input: Record<string, unknown>): Promise<DocumentRecord>;
};

type UploadedFile = {
  filepath?: string;
  mimetype?: string;
  originalFilename?: string;
  path?: string;
  size?: number;
};

type AdminRoleService = {
  findOne(input: Record<string, unknown>): Promise<Record<string, unknown> | null>;
  getSuperAdmin(): Promise<Record<string, unknown> | null>;
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

const staffUserActionSchema = z
  .object({
    sessionToken: z.string().trim().min(32).max(512),
    staffUserId: z.union([z.number().int().positive(), z.string().trim().min(1).max(80)]),
  })
  .strict();

const staffUserStatusSchema = staffUserActionSchema
  .extend({
    isActive: z.boolean(),
  })
  .strict();

const staffRoleKeySchema = z.enum(['admin', 'sales', 'super_admin', 'support']);

const staffListSortKeySchema = z.enum(['createdAt', 'displayName', 'email', 'role', 'status']);
const staffListSortDirectionSchema = z.enum(['asc', 'desc']);

const staffListSchema = sessionTokenSchema
  .extend({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(10).max(100).default(25),
    roleKey: staffRoleKeySchema.optional(),
    search: z.string().trim().max(120).optional().transform((value) => value || undefined),
    sortBy: staffListSortKeySchema.default('createdAt'),
    sortDirection: staffListSortDirectionSchema.default('desc'),
  })
  .strict();

const staffProfileUpdateSchema = sessionTokenSchema
  .extend({
    firstname: z.string().trim().min(1).max(80),
    lastname: z.string().trim().max(80).optional().transform((value) => value || ''),
  })
  .strict();

const staffUserRoleSchema = staffUserActionSchema
  .extend({
    roleKey: staffRoleKeySchema,
  })
  .strict();

const staffInviteSchema = z
  .object({
    email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
    firstname: z.string().trim().min(1).max(80),
    lastname: z.string().trim().max(80).optional().transform((value) => value || undefined),
    roleKey: staffRoleKeySchema,
    sessionToken: z.string().trim().min(32).max(512),
  })
  .strict();

const staffInviteInfoSchema = z
  .object({
    registrationToken: z.string().trim().min(16).max(256),
  })
  .strict();

const staffPasswordSchema = z
  .string()
  .min(8)
  .max(128)
  .refine((value) => /[A-Z]/.test(value), 'Password must include an uppercase letter.')
  .refine((value) => /\d/.test(value), 'Password must include a number.')
  .refine((value) => Buffer.byteLength(value, 'utf8') <= 72, 'Password is too long.');

const staffInviteAcceptanceSchema = z
  .object({
    firstname: z.string().trim().min(1).max(80),
    lastname: z.string().trim().max(80).optional().transform((value) => value || undefined),
    password: staffPasswordSchema,
    registrationToken: z.string().trim().min(16).max(256),
  })
  .strict();

const staffPasswordResetInfoSchema = z
  .object({
    resetPasswordToken: z.string().trim().min(16).max(256),
  })
  .strict();

const staffPasswordResetCompletionSchema = z
  .object({
    password: staffPasswordSchema,
    resetPasswordToken: z.string().trim().min(16).max(256),
  })
  .strict();

const validateLogin = validateZodSchema(loginSchema);
const validateVerifyTwoFactor = validateZodSchema(verifyTwoFactorSchema);
const validateResendTwoFactor = validateZodSchema(resendTwoFactorSchema);
const validateSessionToken = validateZodSchema(sessionTokenSchema);
const validateStaffList = validateZodSchema(staffListSchema);
const validateStaffProfileUpdate = validateZodSchema(staffProfileUpdateSchema);
const validateStaffPasswordReset = validateZodSchema(staffPasswordResetSchema);
const validateStaffUserAction = validateZodSchema(staffUserActionSchema);
const validateStaffUserRole = validateZodSchema(staffUserRoleSchema);
const validateStaffUserStatus = validateZodSchema(staffUserStatusSchema);
const validateStaffInvite = validateZodSchema(staffInviteSchema);
const validateStaffInviteAcceptance = validateZodSchema(staffInviteAcceptanceSchema);
const validateStaffInviteInfo = validateZodSchema(staffInviteInfoSchema);
const validateStaffPasswordResetCompletion = validateZodSchema(staffPasswordResetCompletionSchema);
const validateStaffPasswordResetInfo = validateZodSchema(staffPasswordResetInfoSchema);

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
const resetPasswordToken = () => randomBytes(resetPasswordTokenBytes).toString('hex');
const addSeconds = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString();
const isPast = (isoDate?: string) => !isoDate || new Date(isoDate).getTime() <= Date.now();
const profileImageFormats = ['webp', 'avif'] as const;

const envFlag = (name: string) => process.env[name]?.trim().toLowerCase() === 'true';

const envList = (name: string) =>
  (process.env[name] || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

const e2eTwoFactorCode = (email: string) => {
  if (!envFlag('HIREFLIP_E2E_AUTH_ENABLED')) {
    return undefined;
  }

  const code = process.env.HIREFLIP_E2E_ADMIN_OTP?.trim();

  if (!code || !/^\d{6}$/.test(code)) {
    return undefined;
  }

  const normalizedEmail = email.trim().toLowerCase();
  const allowedEmails = new Set([
    ...envList('HIREFLIP_E2E_ADMIN_EMAILS'),
    ...(process.env.HIREFLIP_E2E_ADMIN_EMAIL
      ? [process.env.HIREFLIP_E2E_ADMIN_EMAIL.trim().toLowerCase()]
      : []),
  ]);

  return allowedEmails.has(normalizedEmail) ? code : undefined;
};

const shouldSkipE2eTwoFactorEmail = (email: string) =>
  Boolean(e2eTwoFactorCode(email)) && envFlag('HIREFLIP_E2E_ADMIN_OTP_SKIP_EMAIL');

const getUploadedFilePath = (file?: UploadedFile) => file?.filepath || file?.path;

const profileImageFormat = () => {
  const configuredFormat = (process.env.ADMIN_PROFILE_IMAGE_FORMAT || 'webp').toLowerCase();

  return profileImageFormats.includes(configuredFormat as (typeof profileImageFormats)[number])
    ? (configuredFormat as (typeof profileImageFormats)[number])
    : 'webp';
};

const profileImageMime = (format: (typeof profileImageFormats)[number]) =>
  format === 'avif' ? 'image/avif' : 'image/webp';

const processProfileImage = async (file?: UploadedFile) => {
  const inputPath = getUploadedFilePath(file);

  if (!inputPath) {
    throw new ValidationError('A profile image file is required.');
  }

  const maxBytes = secondsEnv('ADMIN_PROFILE_IMAGE_MAX_BYTES', 6 * 1024 * 1024);

  if (file?.size && file.size > maxBytes) {
    throw new ValidationError('Profile image is too large.');
  }

  const format = profileImageFormat();
  const mime = profileImageMime(format);
  const size = secondsEnv('ADMIN_PROFILE_IMAGE_SIZE', 512);
  const quality = Math.min(
    100,
    Math.max(1, secondsEnv('ADMIN_PROFILE_IMAGE_QUALITY', format === 'avif' ? 58 : 82))
  );
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'hireflip-admin-profile-image-'));
  const outputPath = path.join(tmpDir, `profile-image.${format}`);

  try {
    const transformer = sharp(inputPath, { failOn: 'error' })
      .rotate()
      .resize(size, size, {
        fit: 'cover',
        position: 'attention',
      });

    if (format === 'avif') {
      await transformer.avif({ quality }).toFile(outputPath);
    } else {
      await transformer.webp({ quality }).toFile(outputPath);
    }

    const outputStats = await stat(outputPath);

    return {
      format,
      mime,
      outputPath,
      sizeInBytes: outputStats.size,
      tmpDir,
    };
  } catch (error) {
    await rm(tmpDir, { force: true, recursive: true });

    throw new ValidationError(
      error instanceof Error ? `Profile image could not be processed: ${error.message}` : 'Profile image could not be processed.'
    );
  }
};

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
const getAdminUserService = () => strapi.service('admin::user') as unknown as AdminUserService;
const getAdminRoleService = () => strapi.service('admin::role') as unknown as AdminRoleService;
const getAuditEventService = () =>
  strapi.service('api::audit-event.audit-event') as unknown as AuditEventService;
const documents = (uid: string) => strapi.documents(uid as never) as DocumentCollection;

const findStaffProfile = async (adminUserId: string) => {
  const profiles = await documents('api::staff-profile.staff-profile').findMany({
    filters: {
      adminUserId,
    },
    limit: 1,
    populate: ['profileImage'],
  });

  return profiles[0] || null;
};

const recoverUploadPath = (file) => {
  if (!file?.url || file.path || !file.hash) {
    return file;
  }

  try {
    const objectKey = decodeURIComponent(new URL(file.url).pathname.replace(/^\/+/, ''));
    const expectedFileName = `${file.hash}${file.ext || ''}`;

    if (!expectedFileName || !objectKey.endsWith(expectedFileName)) {
      return file;
    }

    const prefix = objectKey.slice(0, -expectedFileName.length).replace(/\/+$/, '');

    return prefix
      ? {
          ...file,
          path: prefix,
        }
      : file;
  } catch {
    return file;
  }
};

const withRecoveredUploadPath = (file) => {
  const recoveredFile = recoverUploadPath(file);

  if (!recoveredFile?.formats) {
    return recoveredFile;
  }

  return {
    ...recoveredFile,
    formats: Object.fromEntries(
      Object.entries(recoveredFile.formats).map(([key, format]) => [
        key,
        recoverUploadPath(format),
      ])
    ),
  };
};

const sanitizeStaffProfileImage = async (profileImage?: Record<string, unknown> | null): Promise<StaffProfileImage | null> => {
  if (!profileImage) {
    return null;
  }

  const signedProfileImage = await strapi
    .plugin('upload')
    .service('file')
    .signFileUrls(withRecoveredUploadPath(profileImage));

  if (!signedProfileImage?.url) {
    return null;
  }

  return {
    id: signedProfileImage.id,
    documentId: signedProfileImage.documentId,
    name: signedProfileImage.name,
    alternativeText: signedProfileImage.alternativeText,
    ext: signedProfileImage.ext,
    mime: signedProfileImage.mime,
    size: signedProfileImage.size,
    width: signedProfileImage.width,
    height: signedProfileImage.height,
    url: signedProfileImage.url,
  };
};

const profileImageForStaffUser = async (staffUserId: string) => {
  const staffProfile = await findStaffProfile(staffUserId);

  return sanitizeStaffProfileImage(staffProfile?.profileImage);
};

const staffRoleDefinitions: Record<Exclude<AdminRoleKey, 'super_admin'>, { code: string; label: string }> = {
  admin: {
    code: 'hireflip-admin',
    label: 'Admin',
  },
  sales: {
    code: 'hireflip-sales',
    label: 'Sales',
  },
  support: {
    code: 'hireflip-support',
    label: 'Support',
  },
};

const staffStatusLabels: Record<StaffUserStatus, string> = {
  active: 'Active',
  blocked: 'Blocked',
  inactive: 'Inactive',
  pending_invite: 'Pending invite',
};

const staffSortCollator = new Intl.Collator('en-GB', {
  numeric: true,
  sensitivity: 'base',
});

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

const findAnyAdminUserByEmail = async (email: string) =>
  strapi.db.query('admin::user').findOne({
    where: {
      email: {
        $eqi: email,
      },
    },
    populate: ['roles'],
  }) as Promise<AdminUser | null>;

const findAdminUserByRegistrationToken = async (registrationToken: string) =>
  strapi.db.query('admin::user').findOne({
    where: {
      registrationToken,
    },
    populate: ['roles'],
  }) as Promise<AdminUser | null>;

const findAdminUserByResetPasswordToken = async (passwordResetToken: string) =>
  strapi.db.query('admin::user').findOne({
    where: {
      resetPasswordToken: passwordResetToken,
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
    firstname: typeof user.firstname === 'string' ? user.firstname : '',
    id: String(user.id),
    lastname: typeof user.lastname === 'string' ? user.lastname : '',
    profileImage: null,
    roleKeys,
    roles: roleKeys.map(roleLabel),
  };
};

const toSessionUserWithProfile = async (user: AdminUser): Promise<AdminSessionUser> => {
  const sessionUser = toSessionUser(user);

  return {
    ...sessionUser,
    profileImage: await profileImageForStaffUser(sessionUser.id),
  };
};

const maskEmail = (email: string) => {
  const [localPart, domain] = email.split('@');
  const visible = localPart.slice(0, Math.min(localPart.length, 2));

  return `${visible}${'*'.repeat(Math.max(localPart.length - visible.length, 2))}@${domain}`;
};

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (character) => {
    const replacements: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };

    return replacements[character] || character;
  });

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

const adminDashboardPublicUrl = () => {
  const value = process.env.ADMIN_DASHBOARD_PUBLIC_URL;

  if (!value) {
    throw new ApplicationError('Admin dashboard public URL is not configured.');
  }

  return trimTrailingSlash(value);
};

const getStaffRole = async (roleKey: AdminRoleKey) => {
  const roleService = getAdminRoleService();

  if (roleKey === 'super_admin') {
    const superAdminRole = await roleService.getSuperAdmin();

    if (!superAdminRole) {
      throw new ApplicationError('The Super Admin role is not available.');
    }

    return superAdminRole;
  }

  const definition = staffRoleDefinitions[roleKey];
  const role =
    (await roleService.findOne({ code: definition.code })) ||
    (await roleService.findOne({ name: definition.label }));

  if (!role) {
    throw new ApplicationError('HireFlip admin roles are not seeded. Run npm run seed:admin-roles.');
  }

  return role;
};

const staffUserPayload = (user: AdminUser) => {
  const sessionUser = toSessionUser(user);

  return {
    displayName: sessionUser.displayName,
    email: sessionUser.email,
    id: sessionUser.id,
    roleKeys: sessionUser.roleKeys,
    roles: sessionUser.roles,
  };
};

const staffUserSummaryPayload = (user: AdminUser): StaffUserSummaryPayload | null => {
  if (!user.id || !user.email) {
    return null;
  }

  const roleKeys = Array.from(
    new Set((user.roles || []).map(roleKeyFromRole).filter(Boolean) as AdminRoleKey[])
  );

  if (roleKeys.length === 0) {
    return null;
  }

  const status = user.blocked
    ? 'blocked'
    : user.isActive
      ? 'active'
      : user.registrationToken
        ? 'pending_invite'
        : 'inactive';

  return {
    createdAt: user.createdAt || null,
    displayName: displayName(user),
    email: user.email,
    id: String(user.id),
    roleKeys,
    roles: roleKeys.map(roleLabel),
    status,
    updatedAt: user.updatedAt || null,
  };
};

const staffUserCreatedAtTimestamp = (staffUser: StaffUserSummaryPayload) =>
  staffUser.createdAt ? new Date(staffUser.createdAt).getTime() : 0;

const staffListRoleIds = async (roleKey?: AdminRoleKey) => {
  const roleKeys: AdminRoleKey[] = roleKey
    ? [roleKey]
    : ['admin', 'sales', 'super_admin', 'support'];
  const roles = await Promise.all(roleKeys.map(getStaffRole));

  return roles
    .map((role) => role.id)
    .filter((id): id is string | number => typeof id === 'string' || typeof id === 'number');
};

const staffListWhere = async (roleKey?: AdminRoleKey, search?: string) => {
  const roleIds = await staffListRoleIds(roleKey);
  const andFilters: Record<string, unknown>[] = [
    {
      roles: {
        id: {
          $in: roleIds,
        },
      },
    },
  ];

  if (search) {
    andFilters.push({
      $or: [
        { email: { $containsi: search } },
        { firstname: { $containsi: search } },
        { lastname: { $containsi: search } },
        { username: { $containsi: search } },
      ],
    });
  }

  return {
    $and: andFilters,
  };
};

const staffListOrderBy = (
  sortBy: 'createdAt' | 'displayName' | 'email' | 'role' | 'status',
  sortDirection: 'asc' | 'desc'
) => {
  if (sortBy === 'displayName') {
    return [{ firstname: sortDirection }, { lastname: sortDirection }, { email: sortDirection }];
  }

  if (sortBy === 'email') {
    return [{ email: sortDirection }, { firstname: 'asc' }, { lastname: 'asc' }];
  }

  if (sortBy === 'role') {
    return [{ roles: { name: sortDirection } }, { firstname: 'asc' }, { lastname: 'asc' }];
  }

  if (sortBy === 'status') {
    return [
      { blocked: sortDirection },
      { isActive: sortDirection },
      { registrationToken: sortDirection },
      { firstname: 'asc' },
      { lastname: 'asc' },
    ];
  }

  return [{ createdAt: sortDirection }, { firstname: 'asc' }, { lastname: 'asc' }];
};

const compareStaffUsers = (
  leftStaffUser: StaffUserSummaryPayload,
  rightStaffUser: StaffUserSummaryPayload,
  sortBy: 'createdAt' | 'displayName' | 'email' | 'role' | 'status',
  sortDirection: 'asc' | 'desc'
) => {
  let result = 0;

  if (sortBy === 'createdAt') {
    result = staffUserCreatedAtTimestamp(leftStaffUser) - staffUserCreatedAtTimestamp(rightStaffUser);
  } else if (sortBy === 'displayName') {
    result = staffSortCollator.compare(leftStaffUser.displayName, rightStaffUser.displayName);
  } else if (sortBy === 'email') {
    result = staffSortCollator.compare(leftStaffUser.email, rightStaffUser.email);
  } else if (sortBy === 'role') {
    result = staffSortCollator.compare(leftStaffUser.roles[0] || '', rightStaffUser.roles[0] || '');
  } else if (sortBy === 'status') {
    result = staffSortCollator.compare(
      staffStatusLabels[leftStaffUser.status],
      staffStatusLabels[rightStaffUser.status]
    );
  }

  if (result === 0 && sortBy !== 'displayName') {
    result = staffSortCollator.compare(leftStaffUser.displayName, rightStaffUser.displayName);
  }

  return sortDirection === 'asc' ? result : -result;
};

const staffUserMatchesSearch = (staffUser: StaffUserSummaryPayload, search?: string) => {
  const normalizedSearch = search?.trim().toLowerCase();

  if (!normalizedSearch) {
    return true;
  }

  return [
    staffUser.displayName,
    staffUser.email,
    staffUser.roles.join(' '),
    staffStatusLabels[staffUser.status],
  ].some((value) => value.toLowerCase().includes(normalizedSearch));
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

const sendStaffInviteEmail = async (user: AdminUser, registrationToken: string) => {
  if (!user.email) {
    throw new ValidationError('Staff account is missing an email address.');
  }

  const url = new URL('/staff/accept-invite', adminDashboardPublicUrl());
  url.searchParams.set('token', registrationToken);

  const safeDisplayName = escapeHtml(displayName(user));
  const safeUrl = escapeHtml(url.toString());

  await strapi.plugin('email').service('email').send({
    html: `<p>${safeDisplayName}, you have been invited to HireFlip admin.</p><p>Use this link to set your password:</p><p><a href="${safeUrl}">${safeUrl}</a></p><p>After setting your password, sign in with your staff email and email verification code.</p><p>If you were not expecting this invitation, ignore this email and contact the Super Admin team.</p>`,
    subject: 'Your HireFlip admin invitation',
    text: `${displayName(user)}, you have been invited to HireFlip admin.\n\nSet your password here: ${url.toString()}\n\nAfter setting your password, sign in with your staff email and email verification code.\n\nIf you were not expecting this invitation, ignore this email and contact the Super Admin team.`,
    to: user.email,
  });
};

const sendStaffPasswordResetEmail = async (user: AdminUser, passwordResetToken: string) => {
  if (!user.email) {
    throw new ValidationError('Staff account is missing an email address.');
  }

  const url = new URL('/staff/reset-password', adminDashboardPublicUrl());
  url.searchParams.set('token', passwordResetToken);

  const safeDisplayName = escapeHtml(displayName(user));
  const safeUrl = escapeHtml(url.toString());

  await strapi.plugin('email').service('email').send({
    html: `<p>${safeDisplayName}, a password reset was requested for your HireFlip admin account.</p><p>Use this link to set a new password:</p><p><a href="${safeUrl}">${safeUrl}</a></p><p>After setting your new password, sign in with your staff email and email verification code.</p><p>If you were not expecting this reset, contact the Super Admin team.</p>`,
    subject: 'Reset your HireFlip admin password',
    text: `${displayName(user)}, a password reset was requested for your HireFlip admin account.\n\nSet a new password here: ${url.toString()}\n\nAfter setting your new password, sign in with your staff email and email verification code.\n\nIf you were not expecting this reset, contact the Super Admin team.`,
    to: user.email,
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

  const currentUser = await findAdminUserById(session.userId).catch(() => null);
  const hydratedUser = currentUser ? await toSessionUserWithProfile(currentUser) : session.user;
  const nextSession = {
    ...session,
    lastSeenAt: new Date().toISOString(),
    user: hydratedUser,
  };

  await store.set({
    key: sessionKey(sessionHash),
    value: nextSession,
  });

  if (context) {
    void recordAuditEvent('admin.auth.session_validated', context, {
      actorEmail: hydratedUser.email,
      actorId: hydratedUser.id,
      actorDisplayName: hydratedUser.displayName,
      metadata: {
        rememberMe: session.rememberMe,
        roleKeys: hydratedUser.roleKeys,
      },
    });
  }

  return {
    expiresAt: session.expiresAt,
    rememberMe: session.rememberMe,
    user: hydratedUser,
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
    const sessionUser = await toSessionUserWithProfile(fullUser || user);
    const challengeId = randomUUID();
    const code = e2eTwoFactorCode(sessionUser.email) || numericCode();
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
      if (!shouldSkipE2eTwoFactorEmail(sessionUser.email)) {
        await sendTwoFactorEmail(sessionUser.email, code, expiresAt);
      }
      await recordAuditEvent('admin.auth.2fa_challenge_delivered', requestContext, {
        actorEmail: sessionUser.email,
        actorId: sessionUser.id,
        actorDisplayName: sessionUser.displayName,
        metadata: {
          e2eFixedCode: Boolean(e2eTwoFactorCode(sessionUser.email)),
          emailSkipped: shouldSkipE2eTwoFactorEmail(sessionUser.email),
        },
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

    const code = e2eTwoFactorCode(challenge.email) || numericCode();
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
      if (!shouldSkipE2eTwoFactorEmail(challenge.email)) {
        await sendTwoFactorEmail(challenge.email, code, expiresAt);
      }
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
        e2eFixedCode: Boolean(e2eTwoFactorCode(challenge.email)),
        emailSkipped: shouldSkipE2eTwoFactorEmail(challenge.email),
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

	  async updateCurrentStaffProfile(input: unknown, requestContext: RequestContext = {}) {
	    const body = validateStaffProfileUpdate(input);
	    const store = getStore();
	    const sessionHash = hashValue(body.sessionToken);
	    const session = await getStoredSession(store, body.sessionToken, requestContext);
	    const updatedUser = await getAdminUserService().updateById(session.user.id, {
	      firstname: body.firstname,
	      lastname: body.lastname || null,
	    });

	    if (!updatedUser?.id) {
	      throw new ValidationError('Staff profile could not be updated.');
	    }

	    const fullStaffUser = await findAdminUserById(updatedUser.id);
	    const sessionUser = await toSessionUserWithProfile(fullStaffUser || updatedUser);
	    const nextSession: AdminSession = {
	      ...(await store.get({ key: sessionKey(sessionHash) }) as AdminSession),
	      user: sessionUser,
	      userId: sessionUser.id,
	    };

	    await store.set({
	      key: sessionKey(sessionHash),
	      value: nextSession,
	    });

	    await recordAuditEvent('admin.staff.profile_updated', requestContext, {
	      actorEmail: sessionUser.email,
	      actorId: sessionUser.id,
	      actorDisplayName: sessionUser.displayName,
	      eventCategory: 'security',
	      metadata: {
	        changedFields: ['firstname', 'lastname'],
	      },
	      subjectDisplayName: sessionUser.displayName,
	      subjectId: sessionUser.id,
	      subjectType: 'admin_user',
	    });

	    return {
	      staffUser: sessionUser,
	      updated: true,
	    };
	  },

	  async updateCurrentStaffProfileImage(
	    input: unknown,
	    file: UploadedFile | undefined,
	    requestContext: RequestContext = {}
	  ) {
	    const body = validateSessionToken(input);
	    const store = getStore();
	    const sessionHash = hashValue(body.sessionToken);
	    const session = await getStoredSession(store, body.sessionToken, requestContext);
	    const processedImage = await processProfileImage(file);
	    let staffProfile = await findStaffProfile(session.user.id);
	    const previousProfileImage = staffProfile?.profileImage || null;

	    try {
	      if (!staffProfile?.documentId) {
	        staffProfile = await documents('api::staff-profile.staff-profile').create({
	          data: {
	            adminUserId: session.user.id,
	          },
	        });
	      }

	      if (!staffProfile?.id || !staffProfile.documentId) {
	        throw new ValidationError('Staff profile record could not be created.');
	      }

	      const uploadedFiles = await strapi.plugin('upload').service('upload').upload({
	        data: {
	          fileInfo: {
	            alternativeText: `${session.user.displayName} profile image`,
	            name: `admin-profile-${session.user.id}.${processedImage.format}`,
	          },
	          field: 'profileImage',
	          ref: 'api::staff-profile.staff-profile',
	          refId: staffProfile.id,
	        },
	        files: {
	          filepath: processedImage.outputPath,
	          mimetype: processedImage.mime,
	          originalFilename: `admin-profile-${session.user.id}.${processedImage.format}`,
	          size: processedImage.sizeInBytes,
	        },
	      });

	      const uploadedFile = uploadedFiles[0];

	      if (!uploadedFile?.id) {
	        throw new ValidationError('Profile image upload did not return a stored file.');
	      }

	      const updatedProfile = await documents('api::staff-profile.staff-profile').update({
	        documentId: staffProfile.documentId,
	        data: {
	          profileImage: uploadedFile.id,
	        },
	        populate: ['profileImage'],
	      });
	      const profileImage = await sanitizeStaffProfileImage(updatedProfile.profileImage);
	      const nextSessionUser: AdminSessionUser = {
	        ...session.user,
	        profileImage,
	      };
	      const nextSession: AdminSession = {
	        ...(await store.get({ key: sessionKey(sessionHash) }) as AdminSession),
	        user: nextSessionUser,
	      };

	      await store.set({
	        key: sessionKey(sessionHash),
	        value: nextSession,
	      });

	      await recordAuditEvent('admin.staff.profile_image_updated', requestContext, {
	        actorEmail: nextSessionUser.email,
	        actorId: nextSessionUser.id,
	        actorDisplayName: nextSessionUser.displayName,
	        eventCategory: 'security',
	        newState: {
	          profileImage,
	        },
	        subjectDisplayName: nextSessionUser.displayName,
	        subjectId: nextSessionUser.id,
	        subjectType: 'admin_user',
	      });

	      if (previousProfileImage?.id && previousProfileImage.id !== uploadedFile.id) {
	        await strapi.plugin('upload').service('upload').remove(previousProfileImage).catch((error) => {
	          strapi.log.warn(
	            `Could not remove previous admin profile image ${previousProfileImage.id}: ${
	              error instanceof Error ? error.message : String(error)
	            }`
	          );
	        });
	      }

	      return {
	        profileImage,
	        staffUser: nextSessionUser,
	        updated: true,
	      };
	    } finally {
	      await rm(processedImage.tmpDir, { force: true, recursive: true });
	    }
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

    if (!targetUser.isActive) {
      throw new ValidationError('Staff user must be active before a password reset link can be sent.');
    }

    const passwordResetToken = resetPasswordToken();
    const resetUser = await getAdminUserService().updateById(targetUser.id, {
      resetPasswordToken: passwordResetToken,
    });

    if (!resetUser) {
      throw new ValidationError('Staff user could not be updated.');
    }

    try {
      await sendStaffPasswordResetEmail(resetUser, passwordResetToken);
    } catch (error) {
      await recordAuditEvent('admin.staff.reset_password_email_delivery_failed', requestContext, {
        actorEmail: actorSession.user.email,
        actorId: actorSession.user.id,
        actorDisplayName: actorSession.user.displayName,
        eventCategory: 'admin',
        metadata: {
          message: error instanceof Error ? error.message : 'Email delivery failed.',
        },
        severity: 'error',
        subjectDisplayName: displayName(targetUser),
        subjectId: String(targetUser.id),
        subjectType: 'admin_user',
      });
      throw new ApplicationError(
        'Password reset link could not be sent. Check the notification service and try again.'
      );
    }

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

  async listStaffUsers(input: unknown, requestContext: RequestContext = {}) {
    const body = validateStaffList(input);
    const store = getStore();

    await requireSuperAdminSession(store, body.sessionToken, requestContext);

    const where = await staffListWhere(body.roleKey, body.search);
    const filteredStaffUsersCount = await strapi.db.query('admin::user').count({ where });
    const allStaffUsersCount = await strapi.db.query('admin::user').count({
      where: await staffListWhere(),
    });
    const pageCount = Math.max(1, Math.ceil(filteredStaffUsersCount / body.pageSize));
    const page = Math.min(body.page, pageCount);
    const users = (await strapi.db.query('admin::user').findMany({
      limit: body.pageSize,
      offset: (page - 1) * body.pageSize,
      orderBy: staffListOrderBy(body.sortBy, body.sortDirection),
      populate: ['roles'],
      where,
    })) as AdminUser[];
    const staffUsers = users
      .map(staffUserSummaryPayload)
      .filter((staffUser): staffUser is StaffUserSummaryPayload => Boolean(staffUser));

    return {
      filteredStaffUsers: filteredStaffUsersCount,
      pagination: {
        page,
        pageCount,
        pageSize: body.pageSize,
        total: filteredStaffUsersCount,
      },
      staffUsers,
      totalStaffUsers: allStaffUsersCount,
    };
  },

  async updateStaffUserStatus(input: unknown, requestContext: RequestContext = {}) {
    const body = validateStaffUserStatus(input);
    const store = getStore();
    const actorSession = await requireSuperAdminSession(store, body.sessionToken, requestContext);
    const targetUser = await findAdminUserById(body.staffUserId);

    if (!targetUser?.id || !targetUser.email) {
      throw new ValidationError('Staff user could not be found.');
    }

    if (!body.isActive && String(targetUser.id) === actorSession.user.id) {
      throw new ValidationError('You cannot deactivate your own staff account.');
    }

    if (body.isActive && targetUser.registrationToken) {
      throw new ValidationError('Pending staff invitations must be accepted before activation.');
    }

    const updatedUser = await getAdminUserService().updateById(targetUser.id, {
      isActive: body.isActive,
    });

    if (!updatedUser) {
      throw new ValidationError('Staff user could not be updated.');
    }

    const invalidatedSessions = body.isActive
      ? 0
      : await invalidateUserSessions(store, String(targetUser.id));

    await recordAuditEvent(
      body.isActive ? 'admin.staff.activated' : 'admin.staff.deactivated',
      requestContext,
      {
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
      }
    );

    return {
      staffUser: staffUserSummaryPayload(updatedUser),
      updated: true,
    };
  },

  async updateStaffUserRole(input: unknown, requestContext: RequestContext = {}) {
    const body = validateStaffUserRole(input);
    const store = getStore();
    const actorSession = await requireSuperAdminSession(store, body.sessionToken, requestContext);
    const targetUser = await findAdminUserById(body.staffUserId);

    if (!targetUser?.id || !targetUser.email) {
      throw new ValidationError('Staff user could not be found.');
    }

    const currentRoleKeys = Array.from(
      new Set((targetUser.roles || []).map(roleKeyFromRole).filter(Boolean) as AdminRoleKey[])
    );

    if (String(targetUser.id) === actorSession.user.id && body.roleKey !== 'super_admin') {
      throw new ValidationError('You cannot remove your own Super Admin access.');
    }

    const role = await getStaffRole(body.roleKey);
    const roleId = role.id;

    if (!roleId) {
      throw new ApplicationError('Selected staff role is missing an ID.');
    }

    const updatedUser = await getAdminUserService().updateById(targetUser.id, {
      roles: [roleId],
    });

    if (!updatedUser) {
      throw new ValidationError('Staff user could not be updated.');
    }

    const invalidatedSessions = await invalidateUserSessions(store, String(targetUser.id));

    await recordAuditEvent('admin.staff.role_updated', requestContext, {
      actorEmail: actorSession.user.email,
      actorId: actorSession.user.id,
      actorDisplayName: actorSession.user.displayName,
      eventCategory: 'admin',
      metadata: {
        invalidatedSessions,
        nextRoleKey: body.roleKey,
        previousRoleKeys: currentRoleKeys,
      },
      severity: currentRoleKeys.includes('super_admin') || body.roleKey === 'super_admin' ? 'warning' : 'info',
      subjectDisplayName: displayName(targetUser),
      subjectId: String(targetUser.id),
      subjectType: 'admin_user',
    });

    return {
      staffUser: staffUserSummaryPayload(updatedUser),
      updated: true,
    };
  },

  async deleteStaffUser(input: unknown, requestContext: RequestContext = {}) {
    const body = validateStaffUserAction(input);
    const store = getStore();
    const actorSession = await requireSuperAdminSession(store, body.sessionToken, requestContext);
    const targetUser = await findAdminUserById(body.staffUserId);

    if (!targetUser?.id || !targetUser.email) {
      throw new ValidationError('Staff user could not be found.');
    }

    if (String(targetUser.id) === actorSession.user.id) {
      throw new ValidationError('You cannot delete your own staff account.');
    }

    const invalidatedSessions = await invalidateUserSessions(store, String(targetUser.id));
    const deletedUser = await getAdminUserService().deleteById(targetUser.id);

    if (!deletedUser) {
      throw new ValidationError('Staff user could not be deleted.');
    }

    await recordAuditEvent('admin.staff.deleted', requestContext, {
      actorEmail: actorSession.user.email,
      actorId: actorSession.user.id,
      actorDisplayName: actorSession.user.displayName,
      eventCategory: 'admin',
      metadata: {
        invalidatedSessions,
      },
      severity: 'warning',
      subjectDisplayName: displayName(targetUser),
      subjectId: String(targetUser.id),
      subjectType: 'admin_user',
    });

    return {
      deleted: true,
      staffUser: {
        displayName: displayName(targetUser),
        email: targetUser.email,
        id: String(targetUser.id),
      },
    };
  },

  async inviteStaffUser(input: unknown, requestContext: RequestContext = {}) {
    const body = validateStaffInvite(input);
    const store = getStore();
    const actorSession = await requireSuperAdminSession(store, body.sessionToken, requestContext);
    const role = await getStaffRole(body.roleKey);
    const roleId = role.id;

    if (!roleId) {
      throw new ApplicationError('Selected staff role is missing an ID.');
    }

    const existingUser = await findAnyAdminUserByEmail(body.email);
    let staffUser: AdminUser | null = null;
    let registrationToken: string | undefined;
    let resentExistingInvite = false;

    if (existingUser) {
      if (existingUser.isActive || !existingUser.registrationToken || !existingUser.id) {
        throw new ApplicationError('A staff user with this email already exists.');
      }

      staffUser = await getAdminUserService().updateById(existingUser.id, {
        firstname: body.firstname,
        lastname: body.lastname || null,
        roles: [roleId],
        isActive: false,
      });
      registrationToken = existingUser.registrationToken;
      resentExistingInvite = true;
    } else {
      staffUser = await getAdminUserService().create({
        email: body.email,
        firstname: body.firstname,
        lastname: body.lastname || null,
        roles: [roleId],
        isActive: false,
      });
      registrationToken = staffUser.registrationToken;
    }

    if (!staffUser?.id || !staffUser.email || !registrationToken) {
      throw new ApplicationError('Staff invite could not be created.');
    }

    await recordAuditEvent('admin.staff.invite_created', requestContext, {
      actorEmail: actorSession.user.email,
      actorId: actorSession.user.id,
      actorDisplayName: actorSession.user.displayName,
      eventCategory: 'admin',
      metadata: {
        resentExistingInvite,
        roleKey: body.roleKey,
      },
      subjectDisplayName: displayName(staffUser),
      subjectId: String(staffUser.id),
      subjectType: 'admin_user',
    });

    try {
      await sendStaffInviteEmail(staffUser, registrationToken);
      await recordAuditEvent('admin.staff.invite_email_delivered', requestContext, {
        actorEmail: actorSession.user.email,
        actorId: actorSession.user.id,
        actorDisplayName: actorSession.user.displayName,
        eventCategory: 'admin',
        metadata: {
          resentExistingInvite,
          roleKey: body.roleKey,
        },
        subjectDisplayName: displayName(staffUser),
        subjectId: String(staffUser.id),
        subjectType: 'admin_user',
      });
    } catch (error) {
      await recordAuditEvent('admin.staff.invite_email_delivery_failed', requestContext, {
        actorEmail: actorSession.user.email,
        actorId: actorSession.user.id,
        actorDisplayName: actorSession.user.displayName,
        eventCategory: 'admin',
        metadata: {
          message: error instanceof Error ? error.message : 'Email delivery failed.',
          resentExistingInvite,
          roleKey: body.roleKey,
        },
        severity: 'error',
        subjectDisplayName: displayName(staffUser),
        subjectId: String(staffUser.id),
        subjectType: 'admin_user',
      });
      throw new ApplicationError(
        'Staff invite was created, but the invite email could not be sent. Check the notification service and try again.'
      );
    }

    return {
      inviteSent: true,
      resentExistingInvite,
      staffUser: staffUserPayload(staffUser),
    };
  },

  async resendStaffInvite(input: unknown, requestContext: RequestContext = {}) {
    const body = validateStaffUserAction(input);
    const store = getStore();
    const actorSession = await requireSuperAdminSession(store, body.sessionToken, requestContext);
    const targetUser = await findAdminUserById(body.staffUserId);

    if (!targetUser?.id || !targetUser.email) {
      throw new ValidationError('Staff user could not be found.');
    }

    if (targetUser.blocked || targetUser.isActive || !targetUser.registrationToken) {
      throw new ValidationError('Only pending staff invitations can be resent.');
    }

    const roleKeys = Array.from(
      new Set((targetUser.roles || []).map(roleKeyFromRole).filter(Boolean) as AdminRoleKey[])
    );

    await recordAuditEvent('admin.staff.invite_resend_requested', requestContext, {
      actorEmail: actorSession.user.email,
      actorId: actorSession.user.id,
      actorDisplayName: actorSession.user.displayName,
      eventCategory: 'admin',
      metadata: {
        roleKeys,
      },
      subjectDisplayName: displayName(targetUser),
      subjectId: String(targetUser.id),
      subjectType: 'admin_user',
    });

    try {
      await sendStaffInviteEmail(targetUser, targetUser.registrationToken);
      await recordAuditEvent('admin.staff.invite_resend_email_delivered', requestContext, {
        actorEmail: actorSession.user.email,
        actorId: actorSession.user.id,
        actorDisplayName: actorSession.user.displayName,
        eventCategory: 'admin',
        metadata: {
          roleKeys,
        },
        subjectDisplayName: displayName(targetUser),
        subjectId: String(targetUser.id),
        subjectType: 'admin_user',
      });
    } catch (error) {
      await recordAuditEvent('admin.staff.invite_resend_email_delivery_failed', requestContext, {
        actorEmail: actorSession.user.email,
        actorId: actorSession.user.id,
        actorDisplayName: actorSession.user.displayName,
        eventCategory: 'admin',
        metadata: {
          message: error instanceof Error ? error.message : 'Email delivery failed.',
          roleKeys,
        },
        severity: 'error',
        subjectDisplayName: displayName(targetUser),
        subjectId: String(targetUser.id),
        subjectType: 'admin_user',
      });
      throw new ApplicationError(
        'Staff invite could not be resent. Check the notification service and try again.'
      );
    }

    return {
      inviteSent: true,
      resentExistingInvite: true,
      staffUser: staffUserPayload(targetUser),
    };
  },

  async getStaffInviteInfo(input: unknown) {
    const body = validateStaffInviteInfo(input);
    const inviteInfo = await getAdminUserService().findRegistrationInfo(body.registrationToken);

    if (!inviteInfo?.email) {
      throw new ValidationError('Staff invitation is invalid or has already been used.');
    }

    return {
      email: inviteInfo.email,
      firstname: inviteInfo.firstname || '',
      lastname: inviteInfo.lastname || '',
    };
  },

  async getStaffPasswordResetInfo(input: unknown) {
    const body = validateStaffPasswordResetInfo(input);
    const staffUser = await findAdminUserByResetPasswordToken(body.resetPasswordToken);

    if (!staffUser?.email) {
      throw new ValidationError('Password reset link is invalid or has already been used.');
    }

    return {
      displayName: displayName(staffUser),
      email: staffUser.email,
    };
  },

  async resetStaffPassword(input: unknown, requestContext: RequestContext = {}) {
    const body = validateStaffPasswordResetCompletion(input);
    const pendingUser = await findAdminUserByResetPasswordToken(body.resetPasswordToken);

    if (!pendingUser?.id || !pendingUser.email) {
      await recordAuditEvent('admin.staff.password_reset_failed', requestContext, {
        actorType: 'staff_password_reset',
        eventCategory: 'security',
        metadata: {
          reason: 'invalid_reset_password_token',
        },
        severity: 'warning',
      });
      throw new ValidationError('Password reset link is invalid or has already been used.');
    }

    const staffUser = await getAdminUserService().updateById(pendingUser.id, {
      password: body.password,
      resetPasswordToken: null,
    });

    if (!staffUser?.id) {
      throw new ValidationError('Password could not be reset.');
    }

    const fullStaffUser = await findAdminUserById(staffUser.id || pendingUser.id);
    const sessionUser = staffUserPayload(fullStaffUser || staffUser);
    const invalidatedSessions = await invalidateUserSessions(getStore(), sessionUser.id);

    await recordAuditEvent('admin.staff.password_reset_completed', requestContext, {
      actorEmail: sessionUser.email,
      actorId: sessionUser.id,
      actorDisplayName: sessionUser.displayName,
      eventCategory: 'security',
      metadata: {
        invalidatedSessions,
        roleKeys: sessionUser.roleKeys,
      },
      subjectDisplayName: sessionUser.displayName,
      subjectId: sessionUser.id,
      subjectType: 'admin_user',
    });

    return {
      invalidatedSessions,
      reset: true,
      staffUser: sessionUser,
    };
  },

  async acceptStaffInvite(input: unknown, requestContext: RequestContext = {}) {
    const body = validateStaffInviteAcceptance(input);
    const pendingUser = await findAdminUserByRegistrationToken(body.registrationToken);

    if (!pendingUser?.id || !pendingUser.email) {
      await recordAuditEvent('admin.staff.invite_accept_failed', requestContext, {
        actorType: 'staff_invite',
        eventCategory: 'security',
        metadata: {
          reason: 'invalid_registration_token',
        },
        severity: 'warning',
      });
      throw new ValidationError('Staff invitation is invalid or has already been used.');
    }

    const staffUser = await getAdminUserService().register({
      registrationToken: body.registrationToken,
      userInfo: {
        firstname: body.firstname,
        lastname: body.lastname || null,
        password: body.password,
      },
    });

    const fullStaffUser = await findAdminUserById(staffUser.id || pendingUser.id);
    const sessionUser = staffUserPayload(fullStaffUser || staffUser);

    await recordAuditEvent('admin.staff.invite_accepted', requestContext, {
      actorEmail: sessionUser.email,
      actorId: sessionUser.id,
      actorDisplayName: sessionUser.displayName,
      eventCategory: 'security',
      metadata: {
        roleKeys: sessionUser.roleKeys,
      },
      subjectDisplayName: sessionUser.displayName,
      subjectId: sessionUser.id,
      subjectType: 'admin_user',
    });

    return {
      accepted: true,
      staffUser: sessionUser,
    };
  },
});

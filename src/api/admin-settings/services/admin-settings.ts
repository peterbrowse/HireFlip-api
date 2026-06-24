import { errors, validateZodSchema, z } from '@strapi/utils';

const { ForbiddenError } = errors;

type RequestContext = {
  ipAddress?: string;
  requestId?: string;
  serviceName?: string;
  userAgent?: string;
};

type AdminSession = {
  user: {
    displayName: string;
    email: string;
    id: string;
    roleKeys: string[];
    roles: string[];
  };
};

type AdminAuthService = {
  getSession(input: unknown, context: RequestContext): Promise<AdminSession>;
};

type DocumentRecord = Record<string, unknown> & {
  createdAt?: string;
  documentId?: string;
  id?: number | string;
  numberValue?: number | string | null;
  settingKey?: string;
  updatedAt?: string;
  updatedByStaffEmail?: string | null;
};

type DocumentCollection = {
  create(input: Record<string, unknown>): Promise<DocumentRecord>;
  findMany(input: Record<string, unknown>): Promise<DocumentRecord[]>;
  update(input: Record<string, unknown>): Promise<DocumentRecord>;
};

type StrapiDocumentService = {
  documents(uid: string): unknown;
  service(uid: string): unknown;
};

const aiSettingsInputSchema = z
  .object({
    sessionToken: z.string().trim().min(32).max(512),
  })
  .strict();

const aiSettingsUpdateSchema = aiSettingsInputSchema
  .extend({
    monthlySpendLimitGbp: z.number().min(1).max(100000),
  })
  .strict();

const validateAiSettingsInput = validateZodSchema(aiSettingsInputSchema);
const validateAiSettingsUpdate = validateZodSchema(aiSettingsUpdateSchema);

const documents = (strapi: StrapiDocumentService, uid: string) =>
  strapi.documents(uid) as unknown as DocumentCollection;

const adminAuthService = (strapi: StrapiDocumentService) =>
  strapi.service('api::admin-auth.admin-auth') as unknown as AdminAuthService;

const aiMonthlyBudgetSettingKey = 'ai.monthly_spend_limit_gbp';
const defaultAiMonthlyBudgetGbp = () => {
  const parsed = Number.parseInt(process.env.AI_MONTHLY_SPEND_LIMIT_GBP || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 100;
};

const assertSuperAdminSession = async (
  strapi: StrapiDocumentService,
  sessionToken: string,
  requestContext: RequestContext
) => {
  const session = await adminAuthService(strapi).getSession({ sessionToken }, requestContext);

  if (!session.user.roleKeys.includes('super_admin')) {
    throw new ForbiddenError('Super Admin access is required for AI settings.');
  }

  return session;
};

const findSetting = async (strapi: StrapiDocumentService, settingKey: string) => {
  const settings = await documents(strapi, 'api::platform-setting.platform-setting').findMany({
    filters: {
      settingKey,
    },
    limit: 1,
  });

  return settings[0] || null;
};

const numericSettingValue = (setting?: DocumentRecord | null, fallback = 0) => {
  const parsed = Number(setting?.numberValue);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const publicAiSettings = (setting?: DocumentRecord | null) => ({
  defaultMonthlySpendLimitGbp: defaultAiMonthlyBudgetGbp(),
  monthlySpendLimitGbp: numericSettingValue(setting, defaultAiMonthlyBudgetGbp()),
  settingDocumentId: setting?.documentId || null,
  updatedAt: setting?.updatedAt || null,
  updatedByStaffEmail: setting?.updatedByStaffEmail || null,
});

export default ({ strapi }: { strapi: StrapiDocumentService }) => ({
  async getAiSettings(input: unknown, requestContext: RequestContext = {}) {
    const body = validateAiSettingsInput(input);
    const session = await assertSuperAdminSession(strapi, body.sessionToken, requestContext);
    const setting = await findSetting(strapi, aiMonthlyBudgetSettingKey);

    return {
      ai: publicAiSettings(setting),
      generatedAt: new Date().toISOString(),
      user: session.user,
    };
  },

  async updateAiSettings(input: unknown, requestContext: RequestContext = {}) {
    const body = validateAiSettingsUpdate(input);
    const session = await assertSuperAdminSession(strapi, body.sessionToken, requestContext);
    const existing = await findSetting(strapi, aiMonthlyBudgetSettingKey);
    const data = {
      description: 'Monthly AI spend warning threshold in GBP.',
      numberValue: body.monthlySpendLimitGbp,
      settingKey: aiMonthlyBudgetSettingKey,
      updatedByStaffEmail: session.user.email,
    };
    const setting = existing?.documentId
      ? await documents(strapi, 'api::platform-setting.platform-setting').update({
          documentId: existing.documentId,
          data,
        })
      : await documents(strapi, 'api::platform-setting.platform-setting').create({
          data,
        });

    return {
      ai: publicAiSettings(setting),
      updated: true,
      user: session.user,
    };
  },
});

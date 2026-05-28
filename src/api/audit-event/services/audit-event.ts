import { factories } from '@strapi/strapi';
import { validateZodSchema, z } from '@strapi/utils';

const auditEventSchema = z.object({
  eventType: z.string().trim().min(1).max(160),
  eventCategory: z.enum([
    'admin',
    'assessment',
    'candidate',
    'course',
    'employer',
    'file',
    'interview',
    'notification',
    'offer',
    'payment',
    'privacy',
    'recruitment',
    'refund',
    'security',
    'system',
  ]),
  severity: z.enum(['info', 'warning', 'error', 'critical']).default('info'),
  source: z
    .enum([
      'core_api',
      'strapi_admin',
      'candidate_dashboard',
      'employer_dashboard',
      'admin_dashboard',
      'payment_service',
      'notification_service',
      'ai_service',
      'recruitment_platform',
      'system',
    ])
    .default('core_api'),
  actorType: z
    .enum(['candidate', 'employer_contact', 'recruiter', 'admin', 'service', 'system', 'anonymous'])
    .default('system'),
  actorId: z.string().trim().max(160).optional(),
  actorEmail: z.string().trim().email().max(254).optional(),
  actorDisplayName: z.string().trim().max(240).optional(),
  subjectType: z.string().trim().max(120).optional(),
  subjectId: z.string().trim().max(160).optional(),
  subjectDisplayName: z.string().trim().max(240).optional(),
  occurredAt: z.string().datetime().default(() => new Date().toISOString()),
  requestId: z.string().trim().max(160).optional(),
  correlationId: z.string().trim().max(160).optional(),
  serviceName: z.string().trim().max(120).optional(),
  ipAddress: z.string().trim().max(120).optional(),
  userAgent: z.string().trim().max(500).optional(),
  previousState: z.unknown().optional(),
  newState: z.unknown().optional(),
  metadata: z.unknown().optional(),
});

const validateAuditEvent = validateZodSchema(auditEventSchema);

export default factories.createCoreService('api::audit-event.audit-event', ({ strapi }) => ({
  async record(input: unknown) {
    const data = validateAuditEvent(input);

    return strapi.documents('api::audit-event.audit-event').create({ data: data as any });
  },
}));

import type { Schema, Struct } from '@strapi/strapi';

export interface AdminApiToken extends Struct.CollectionTypeSchema {
  collectionName: 'strapi_api_tokens';
  info: {
    description: '';
    displayName: 'Api Token';
    name: 'Api Token';
    pluralName: 'api-tokens';
    singularName: 'api-token';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    accessKey: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    adminPermissions: Schema.Attribute.Relation<
      'oneToMany',
      'admin::permission'
    >;
    adminUserOwner: Schema.Attribute.Relation<'manyToOne', 'admin::user'>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    description: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }> &
      Schema.Attribute.DefaultTo<''>;
    encryptedKey: Schema.Attribute.Text &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    expiresAt: Schema.Attribute.DateTime;
    kind: Schema.Attribute.Enumeration<['content-api', 'admin']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'content-api'>;
    lastUsedAt: Schema.Attribute.DateTime;
    lifespan: Schema.Attribute.BigInteger;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<'oneToMany', 'admin::api-token'> &
      Schema.Attribute.Private;
    name: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    permissions: Schema.Attribute.Relation<
      'oneToMany',
      'admin::api-token-permission'
    >;
    publishedAt: Schema.Attribute.DateTime;
    type: Schema.Attribute.Enumeration<['read-only', 'full-access', 'custom']> &
      Schema.Attribute.DefaultTo<'read-only'>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface AdminApiTokenPermission extends Struct.CollectionTypeSchema {
  collectionName: 'strapi_api_token_permissions';
  info: {
    description: '';
    displayName: 'API Token Permission';
    name: 'API Token Permission';
    pluralName: 'api-token-permissions';
    singularName: 'api-token-permission';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    action: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'admin::api-token-permission'
    > &
      Schema.Attribute.Private;
    publishedAt: Schema.Attribute.DateTime;
    token: Schema.Attribute.Relation<'manyToOne', 'admin::api-token'>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface AdminPermission extends Struct.CollectionTypeSchema {
  collectionName: 'admin_permissions';
  info: {
    description: '';
    displayName: 'Permission';
    name: 'Permission';
    pluralName: 'permissions';
    singularName: 'permission';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    action: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    actionParameters: Schema.Attribute.JSON & Schema.Attribute.DefaultTo<{}>;
    apiToken: Schema.Attribute.Relation<'manyToOne', 'admin::api-token'>;
    conditions: Schema.Attribute.JSON & Schema.Attribute.DefaultTo<[]>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<'oneToMany', 'admin::permission'> &
      Schema.Attribute.Private;
    properties: Schema.Attribute.JSON & Schema.Attribute.DefaultTo<{}>;
    publishedAt: Schema.Attribute.DateTime;
    role: Schema.Attribute.Relation<'manyToOne', 'admin::role'>;
    subject: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface AdminRole extends Struct.CollectionTypeSchema {
  collectionName: 'admin_roles';
  info: {
    description: '';
    displayName: 'Role';
    name: 'Role';
    pluralName: 'roles';
    singularName: 'role';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    code: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    description: Schema.Attribute.String;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<'oneToMany', 'admin::role'> &
      Schema.Attribute.Private;
    name: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    permissions: Schema.Attribute.Relation<'oneToMany', 'admin::permission'>;
    publishedAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    users: Schema.Attribute.Relation<'manyToMany', 'admin::user'>;
  };
}

export interface AdminSession extends Struct.CollectionTypeSchema {
  collectionName: 'strapi_sessions';
  info: {
    description: 'Session Manager storage';
    displayName: 'Session';
    name: 'Session';
    pluralName: 'sessions';
    singularName: 'session';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
    i18n: {
      localized: false;
    };
  };
  attributes: {
    absoluteExpiresAt: Schema.Attribute.DateTime & Schema.Attribute.Private;
    childId: Schema.Attribute.String & Schema.Attribute.Private;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    deviceId: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Private;
    expiresAt: Schema.Attribute.DateTime &
      Schema.Attribute.Required &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<'oneToMany', 'admin::session'> &
      Schema.Attribute.Private;
    origin: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Private;
    publishedAt: Schema.Attribute.DateTime;
    sessionId: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Private &
      Schema.Attribute.Unique;
    status: Schema.Attribute.String & Schema.Attribute.Private;
    type: Schema.Attribute.String & Schema.Attribute.Private;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    userId: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Private;
  };
}

export interface AdminTransferToken extends Struct.CollectionTypeSchema {
  collectionName: 'strapi_transfer_tokens';
  info: {
    description: '';
    displayName: 'Transfer Token';
    name: 'Transfer Token';
    pluralName: 'transfer-tokens';
    singularName: 'transfer-token';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    accessKey: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    description: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }> &
      Schema.Attribute.DefaultTo<''>;
    expiresAt: Schema.Attribute.DateTime;
    lastUsedAt: Schema.Attribute.DateTime;
    lifespan: Schema.Attribute.BigInteger;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'admin::transfer-token'
    > &
      Schema.Attribute.Private;
    name: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    permissions: Schema.Attribute.Relation<
      'oneToMany',
      'admin::transfer-token-permission'
    >;
    publishedAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface AdminTransferTokenPermission
  extends Struct.CollectionTypeSchema {
  collectionName: 'strapi_transfer_token_permissions';
  info: {
    description: '';
    displayName: 'Transfer Token Permission';
    name: 'Transfer Token Permission';
    pluralName: 'transfer-token-permissions';
    singularName: 'transfer-token-permission';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    action: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'admin::transfer-token-permission'
    > &
      Schema.Attribute.Private;
    publishedAt: Schema.Attribute.DateTime;
    token: Schema.Attribute.Relation<'manyToOne', 'admin::transfer-token'>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface AdminUser extends Struct.CollectionTypeSchema {
  collectionName: 'admin_users';
  info: {
    description: '';
    displayName: 'User';
    name: 'User';
    pluralName: 'users';
    singularName: 'user';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    apiTokens: Schema.Attribute.Relation<'oneToMany', 'admin::api-token'> &
      Schema.Attribute.Private;
    blocked: Schema.Attribute.Boolean &
      Schema.Attribute.Private &
      Schema.Attribute.DefaultTo<false>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    email: Schema.Attribute.Email &
      Schema.Attribute.Required &
      Schema.Attribute.Private &
      Schema.Attribute.Unique &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 6;
      }>;
    firstname: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    isActive: Schema.Attribute.Boolean &
      Schema.Attribute.Private &
      Schema.Attribute.DefaultTo<false>;
    lastname: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<'oneToMany', 'admin::user'> &
      Schema.Attribute.Private;
    password: Schema.Attribute.Password &
      Schema.Attribute.Private &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 6;
      }>;
    preferedLanguage: Schema.Attribute.String;
    publishedAt: Schema.Attribute.DateTime;
    registrationToken: Schema.Attribute.String & Schema.Attribute.Private;
    resetPasswordToken: Schema.Attribute.String & Schema.Attribute.Private;
    roles: Schema.Attribute.Relation<'manyToMany', 'admin::role'> &
      Schema.Attribute.Private;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    username: Schema.Attribute.String;
  };
}

export interface ApiAdminReviewClaimAdminReviewClaim
  extends Struct.CollectionTypeSchema {
  collectionName: 'admin_review_claims';
  info: {
    description: 'Short-lived staff review claims that prevent overlapping admin actions.';
    displayName: 'Admin Review Claim';
    pluralName: 'admin-review-claims';
    singularName: 'admin-review-claim';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    claimedAt: Schema.Attribute.DateTime & Schema.Attribute.Required;
    claimedByDisplayName: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 240;
        minLength: 1;
      }>;
    claimedByEmail: Schema.Attribute.Email &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 254;
      }>;
    claimedByRoleKeys: Schema.Attribute.JSON;
    claimedByStaffUserId: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 160;
        minLength: 1;
      }>;
    claimKey: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 360;
        minLength: 1;
      }>;
    claimToken: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 160;
        minLength: 32;
      }>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    expiresAt: Schema.Attribute.DateTime & Schema.Attribute.Required;
    heartbeatAt: Schema.Attribute.DateTime;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::admin-review-claim.admin-review-claim'
    > &
      Schema.Attribute.Private;
    metadata: Schema.Attribute.JSON;
    publishedAt: Schema.Attribute.DateTime;
    releasedAt: Schema.Attribute.DateTime;
    releaseReason: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 80;
      }>;
    resourceDocumentId: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 160;
      }>;
    resourceKey: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 300;
        minLength: 1;
      }>;
    resourceLabel: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 240;
      }>;
    resourceType: Schema.Attribute.Enumeration<
      ['admin_task', 'assessment_appeal', 'refund_review', 'support_case']
    > &
      Schema.Attribute.Required;
    takeoverCount: Schema.Attribute.Integer &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      > &
      Schema.Attribute.DefaultTo<0>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiAdminTaskAdminTask extends Struct.CollectionTypeSchema {
  collectionName: 'admin_tasks';
  info: {
    description: 'Operational tasks surfaced in the custom admin dashboard.';
    displayName: 'Admin Task';
    pluralName: 'admin-tasks';
    singularName: 'admin-task';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    actionLabel: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 80;
        minLength: 1;
      }>;
    actionPath: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 500;
        minLength: 1;
      }>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    lastDetectedAt: Schema.Attribute.DateTime;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::admin-task.admin-task'
    > &
      Schema.Attribute.Private;
    metadata: Schema.Attribute.JSON;
    priority: Schema.Attribute.Enumeration<
      ['low', 'normal', 'high', 'urgent']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'normal'>;
    publishedAt: Schema.Attribute.DateTime;
    relatedDocumentId: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 160;
      }>;
    relatedType: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 120;
      }>;
    resolvedAt: Schema.Attribute.DateTime;
    sourceDocumentId: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 160;
      }>;
    sourceType: Schema.Attribute.Enumeration<
      [
        'assessment_appeal',
        'payment',
        'refund',
        'reservation',
        'enrollment',
        'notification_event',
        'audit_event',
      ]
    > &
      Schema.Attribute.Required;
    summary: Schema.Attribute.Text;
    taskKey: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 220;
        minLength: 1;
      }>;
    taskState: Schema.Attribute.Enumeration<
      ['open', 'acknowledged', 'resolved', 'dismissed']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'open'>;
    taskType: Schema.Attribute.Enumeration<
      [
        'assessment_appeal',
        'payment_review',
        'refund_review',
        'notification_failure',
        'system_alert',
      ]
    > &
      Schema.Attribute.Required;
    title: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 180;
        minLength: 1;
      }>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiAssessmentAppealAssessmentAppeal
  extends Struct.CollectionTypeSchema {
  collectionName: 'assessment_appeals';
  info: {
    description: 'Candidate appeal against an answer, test attempt, flag, or assessment outcome.';
    displayName: 'Assessment Appeal';
    pluralName: 'assessment-appeals';
    singularName: 'assessment-appeal';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    appealState: Schema.Attribute.Enumeration<
      ['submitted', 'under_review', 'approved', 'rejected', 'withdrawn']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'submitted'>;
    candidate: Schema.Attribute.Relation<
      'manyToOne',
      'api::candidate.candidate'
    >;
    courseAnswerSubmission: Schema.Attribute.Relation<
      'manyToOne',
      'api::course-answer-submission.course-answer-submission'
    >;
    courseTestAttempt: Schema.Attribute.Relation<
      'manyToOne',
      'api::course-test-attempt.course-test-attempt'
    >;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    decision: Schema.Attribute.Text;
    enrollment: Schema.Attribute.Relation<
      'manyToOne',
      'api::enrollment.enrollment'
    >;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::assessment-appeal.assessment-appeal'
    > &
      Schema.Attribute.Private;
    metadata: Schema.Attribute.JSON;
    outcomeAdjustment: Schema.Attribute.JSON;
    publishedAt: Schema.Attribute.DateTime;
    reason: Schema.Attribute.Text & Schema.Attribute.Required;
    reviewedAt: Schema.Attribute.DateTime;
    reviewedByAdminId: Schema.Attribute.String;
    submittedAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiAuditEventAuditEvent extends Struct.CollectionTypeSchema {
  collectionName: 'audit_events';
  info: {
    description: 'Immutable business, security, workflow, and dispute-support events.';
    displayName: 'Audit Event';
    pluralName: 'audit-events';
    singularName: 'audit-event';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    actorDisplayName: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 240;
      }>;
    actorEmail: Schema.Attribute.Email &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 254;
      }>;
    actorId: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 160;
      }>;
    actorType: Schema.Attribute.Enumeration<
      [
        'candidate',
        'employer_contact',
        'recruiter',
        'admin',
        'service',
        'system',
        'anonymous',
      ]
    > &
      Schema.Attribute.Required;
    correlationId: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 160;
      }>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    eventCategory: Schema.Attribute.Enumeration<
      [
        'admin',
        'assessment',
        'candidate',
        'course',
        'employer',
        'file',
        'interview',
        'notification',
        'payment',
        'privacy',
        'progression',
        'recruitment',
        'refund',
        'security',
        'system',
      ]
    > &
      Schema.Attribute.Required;
    eventType: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 160;
        minLength: 1;
      }>;
    ipAddress: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 120;
      }>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::audit-event.audit-event'
    > &
      Schema.Attribute.Private;
    metadata: Schema.Attribute.JSON;
    newState: Schema.Attribute.JSON;
    occurredAt: Schema.Attribute.DateTime & Schema.Attribute.Required;
    previousState: Schema.Attribute.JSON;
    publishedAt: Schema.Attribute.DateTime;
    requestId: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 160;
      }>;
    serviceName: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 120;
      }>;
    severity: Schema.Attribute.Enumeration<
      ['info', 'warning', 'error', 'critical']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'info'>;
    source: Schema.Attribute.Enumeration<
      [
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
      ]
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'core_api'>;
    subjectDisplayName: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 240;
      }>;
    subjectId: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 160;
      }>;
    subjectType: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 120;
      }>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    userAgent: Schema.Attribute.Text;
  };
}

export interface ApiCandidateInterviewStrikeCandidateInterviewStrike
  extends Struct.CollectionTypeSchema {
  collectionName: 'candidate_interview_strikes';
  info: {
    description: 'Strike record for candidate no-show or declined confirmed interview.';
    displayName: 'Candidate Interview Strike';
    pluralName: 'candidate-interview-strikes';
    singularName: 'candidate-interview-strike';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    appealedAt: Schema.Attribute.DateTime;
    appliedAt: Schema.Attribute.DateTime;
    candidate: Schema.Attribute.Relation<
      'manyToOne',
      'api::candidate.candidate'
    >;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    enrollment: Schema.Attribute.Relation<
      'manyToOne',
      'api::enrollment.enrollment'
    >;
    interview: Schema.Attribute.Relation<
      'manyToOne',
      'api::interview.interview'
    >;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::candidate-interview-strike.candidate-interview-strike'
    > &
      Schema.Attribute.Private;
    metadata: Schema.Attribute.JSON;
    publishedAt: Schema.Attribute.DateTime;
    reason: Schema.Attribute.Enumeration<
      [
        'candidate_no_show',
        'candidate_declined_confirmed_interview',
        'admin_applied',
        'other',
      ]
    > &
      Schema.Attribute.Required;
    reviewDecision: Schema.Attribute.Text;
    reviewedAt: Schema.Attribute.DateTime;
    reviewedByAdminId: Schema.Attribute.String;
    strikeNumber: Schema.Attribute.Integer;
    strikeState: Schema.Attribute.Enumeration<
      ['active', 'appealed', 'upheld', 'removed', 'expired']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'active'>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiCandidateProfileCandidateProfile
  extends Struct.CollectionTypeSchema {
  collectionName: 'candidate_profiles';
  info: {
    description: 'Structured candidate CV/profile data used for generated documents and recruitment search.';
    displayName: 'Candidate Profile';
    pluralName: 'candidate-profiles';
    singularName: 'candidate-profile';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    availability: Schema.Attribute.String;
    candidate: Schema.Attribute.Relation<
      'manyToOne',
      'api::candidate.candidate'
    >;
    completedAt: Schema.Attribute.DateTime;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    education: Schema.Attribute.JSON;
    experience: Schema.Attribute.JSON;
    generatedCvFile: Schema.Attribute.Relation<
      'oneToOne',
      'api::stored-file.stored-file'
    >;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::candidate-profile.candidate-profile'
    > &
      Schema.Attribute.Private;
    location: Schema.Attribute.String;
    metadata: Schema.Attribute.JSON;
    profileState: Schema.Attribute.Enumeration<
      ['draft', 'in_review', 'completed', 'archived']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'draft'>;
    publishedAt: Schema.Attribute.DateTime;
    recruitmentPlatformVisibility: Schema.Attribute.Enumeration<
      ['not_set', 'visible', 'hidden']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'not_set'>;
    skills: Schema.Attribute.JSON;
    summary: Schema.Attribute.Text;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    visibilityUpdatedAt: Schema.Attribute.DateTime;
    workPreferences: Schema.Attribute.JSON;
  };
}

export interface ApiCandidateCandidate extends Struct.CollectionTypeSchema {
  collectionName: 'candidates';
  info: {
    description: 'People interested in, enrolled in, or progressed through HireFlip classes.';
    displayName: 'Candidate';
    pluralName: 'candidates';
    singularName: 'candidate';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    accountCreatedAt: Schema.Attribute.DateTime;
    accountOnboardingCompletedAt: Schema.Attribute.DateTime;
    accountRestrictedAt: Schema.Attribute.DateTime;
    accountRestrictedBy: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 160;
      }>;
    accountRestrictionAppealStatus: Schema.Attribute.Enumeration<
      [
        'not_applicable',
        'not_started',
        'submitted',
        'under_review',
        'upheld',
        'rejected',
      ]
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'not_applicable'>;
    accountRestrictionEvidenceReference: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 240;
      }>;
    accountRestrictionMessage: Schema.Attribute.Text;
    accountRestrictionReason: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 160;
      }>;
    accountRestrictionStatus: Schema.Attribute.Enumeration<
      ['active', 'suspended', 'blacklisted']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'active'>;
    authIdentityId: Schema.Attribute.String &
      Schema.Attribute.Unique &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 160;
      }>;
    authProvider: Schema.Attribute.Enumeration<['auth0', 'manual', 'unknown']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'unknown'>;
    candidateState: Schema.Attribute.Enumeration<
      [
        'interest_registered',
        'account_created',
        'unenrolled',
        'enrolled',
        'alumni',
        'in_class',
        'course_completed',
        'passed',
        'failed',
        'interview_phase',
        'hired',
        'refunded',
        'suspended',
        'blacklisted',
        'archived',
      ]
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'account_created'>;
    classAreaPreferences: Schema.Attribute.JSON;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    dateOfBirth: Schema.Attribute.Date;
    email: Schema.Attribute.Email &
      Schema.Attribute.Required &
      Schema.Attribute.Unique &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 254;
      }>;
    firstName: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 120;
      }>;
    gender: Schema.Attribute.Enumeration<
      ['man', 'woman', 'non_binary', 'self_describe', 'prefer_not_to_say']
    >;
    genderSelfDescription: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 120;
      }>;
    lastName: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 120;
      }>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::candidate.candidate'
    > &
      Schema.Attribute.Private;
    marketingConsentCapturedAt: Schema.Attribute.DateTime;
    marketingConsentState: Schema.Attribute.Enumeration<
      ['not_asked', 'opted_in', 'opted_out', 'withdrawn']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'not_asked'>;
    marketingConsentWordingVersion: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 80;
      }>;
    notificationPreferences: Schema.Attribute.JSON;
    phone: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 40;
      }>;
    preferredCommunicationChannel: Schema.Attribute.Enumeration<
      ['not_set', 'email', 'sms', 'phone']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'not_set'>;
    profileImage: Schema.Attribute.Media<'images'>;
    profileSettings: Schema.Attribute.JSON;
    publishedAt: Schema.Attribute.DateTime;
    recruitmentPlatformVisibility: Schema.Attribute.Enumeration<
      ['not_set', 'visible', 'hidden']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'not_set'>;
    region: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 120;
      }>;
    registeredInterestAt: Schema.Attribute.DateTime;
    sector: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 120;
      }>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    workSectorPreferences: Schema.Attribute.JSON;
  };
}

export interface ApiClassAnnouncementClassAnnouncement
  extends Struct.CollectionTypeSchema {
  collectionName: 'class_announcements';
  info: {
    description: 'Candidate-visible class announcements shown on the class noticeboard.';
    displayName: 'Class Announcement';
    pluralName: 'class-announcements';
    singularName: 'class-announcement';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    announcementState: Schema.Attribute.Enumeration<
      ['draft', 'published', 'archived']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'published'>;
    body: Schema.Attribute.Text & Schema.Attribute.Required;
    class: Schema.Attribute.Relation<'manyToOne', 'api::class.class'>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    expiresAt: Schema.Attribute.DateTime;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::class-announcement.class-announcement'
    > &
      Schema.Attribute.Private;
    metadata: Schema.Attribute.JSON;
    postedByStaffDisplayName: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 160;
      }>;
    postedByStaffEmail: Schema.Attribute.Email;
    postedByStaffUserId: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 160;
      }>;
    priority: Schema.Attribute.Enumeration<['normal', 'important', 'urgent']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'normal'>;
    publishedAt: Schema.Attribute.DateTime;
    title: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 160;
        minLength: 1;
      }>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    visibleFrom: Schema.Attribute.DateTime;
  };
}

export interface ApiClassAreaClassArea extends Struct.CollectionTypeSchema {
  collectionName: 'class_areas';
  info: {
    description: 'Geographic or delivery areas candidates can select for HireFlip classes.';
    displayName: 'Class Area';
    pluralName: 'class-areas';
    singularName: 'class-area';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    classes: Schema.Attribute.Relation<'oneToMany', 'api::class.class'>;
    country: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 120;
      }> &
      Schema.Attribute.DefaultTo<'United Kingdom'>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::class-area.class-area'
    > &
      Schema.Attribute.Private;
    name: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 120;
        minLength: 1;
      }>;
    notes: Schema.Attribute.Text;
    publishedAt: Schema.Attribute.DateTime;
    slug: Schema.Attribute.UID<'name'> & Schema.Attribute.Required;
    sortOrder: Schema.Attribute.Integer &
      Schema.Attribute.SetMinMax<
        {
          max: 10000;
          min: 0;
        },
        number
      > &
      Schema.Attribute.DefaultTo<100>;
    state: Schema.Attribute.Enumeration<
      ['active', 'coming_soon', 'hidden', 'archived']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'active'>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiClassClass extends Struct.CollectionTypeSchema {
  collectionName: 'classes';
  info: {
    description: 'A scheduled HireFlip class for a region, sector, and course version.';
    displayName: 'Class';
    pluralName: 'classes';
    singularName: 'class';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    automaticOpeningReadinessStatus: Schema.Attribute.Enumeration<
      ['not_checked', 'not_ready', 'ready', 'opened']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'not_checked'>;
    capacity: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<
        {
          max: 1000;
          min: 1;
        },
        number
      >;
    classArea: Schema.Attribute.Relation<
      'manyToOne',
      'api::class-area.class-area'
    >;
    closedAt: Schema.Attribute.DateTime;
    completionDeadline: Schema.Attribute.DateTime;
    course: Schema.Attribute.Relation<'manyToOne', 'api::course.course'>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    currency: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 3;
        minLength: 3;
      }>;
    discountedPricePence: Schema.Attribute.Integer &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      >;
    displayTitle: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 160;
        minLength: 1;
      }>;
    employerInterviewAvailabilityThresholdPercentage: Schema.Attribute.Integer &
      Schema.Attribute.SetMinMax<
        {
          max: 1000;
          min: 1;
        },
        number
      > &
      Schema.Attribute.DefaultTo<150>;
    endDate: Schema.Attribute.Date;
    enrollmentOpenedAt: Schema.Attribute.DateTime;
    enrollmentOpenedBy: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 160;
      }>;
    faqs: Schema.Attribute.JSON;
    includedItems: Schema.Attribute.JSON;
    interestThresholdPercentage: Schema.Attribute.Integer &
      Schema.Attribute.SetMinMax<
        {
          max: 1000;
          min: 1;
        },
        number
      > &
      Schema.Attribute.DefaultTo<200>;
    interviewGuaranteeDeadline: Schema.Attribute.DateTime;
    interviewsGuaranteed: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<
        {
          max: 50;
          min: 0;
        },
        number
      >;
    level: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 80;
      }>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<'oneToMany', 'api::class.class'> &
      Schema.Attribute.Private;
    modulesPassCriteriaAttached: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<false>;
    moduleSummary: Schema.Attribute.Text;
    name: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 160;
        minLength: 1;
      }>;
    officialClassCode: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 40;
        minLength: 1;
      }>;
    openedAt: Schema.Attribute.DateTime;
    openingMode: Schema.Attribute.Enumeration<
      ['admin_scheduled', 'admin_immediate', 'automatic']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'admin_scheduled'>;
    overview: Schema.Attribute.Text;
    pricePence: Schema.Attribute.Integer &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      >;
    publishedAt: Schema.Attribute.DateTime;
    region: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 120;
      }>;
    requirements: Schema.Attribute.Text;
    scheduledEnrollmentOpenAt: Schema.Attribute.DateTime;
    scheduleNotes: Schema.Attribute.Text;
    sector: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 120;
      }>;
    slug: Schema.Attribute.UID<'displayTitle'>;
    startDate: Schema.Attribute.Date;
    state: Schema.Attribute.Enumeration<
      [
        'draft',
        'coming_soon',
        'waitlist_open',
        'open',
        'full',
        'in_progress',
        'completion_window',
        'interview_window',
        'completed',
        'cancelled',
        'archived',
      ]
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'draft'>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    workSector: Schema.Attribute.Relation<
      'manyToOne',
      'api::work-sector.work-sector'
    >;
    year: Schema.Attribute.Integer &
      Schema.Attribute.SetMinMax<
        {
          max: 2100;
          min: 2026;
        },
        number
      >;
    yearSequenceNumber: Schema.Attribute.Integer &
      Schema.Attribute.SetMinMax<
        {
          max: 999;
          min: 1;
        },
        number
      >;
  };
}

export interface ApiCourseAnswerSubmissionCourseAnswerSubmission
  extends Struct.CollectionTypeSchema {
  collectionName: 'course_answer_submissions';
  info: {
    description: 'Candidate answer submitted during a HireFlip course test attempt.';
    displayName: 'Course Answer Submission';
    pluralName: 'course-answer-submissions';
    singularName: 'course-answer-submission';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    answerPayload: Schema.Attribute.JSON;
    candidate: Schema.Attribute.Relation<
      'manyToOne',
      'api::candidate.candidate'
    >;
    courseQuestion: Schema.Attribute.Relation<
      'manyToOne',
      'api::course-question.course-question'
    >;
    courseTestAttempt: Schema.Attribute.Relation<
      'manyToOne',
      'api::course-test-attempt.course-test-attempt'
    >;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    feedback: Schema.Attribute.Text;
    flagState: Schema.Attribute.Enumeration<
      ['none', 'flagged', 'cleared', 'confirmed']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'none'>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::course-answer-submission.course-answer-submission'
    > &
      Schema.Attribute.Private;
    metadata: Schema.Attribute.JSON;
    publishedAt: Schema.Attribute.DateTime;
    score: Schema.Attribute.Decimal;
    submittedAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiCourseMaterialCourseMaterial
  extends Struct.CollectionTypeSchema {
  collectionName: 'course_materials';
  info: {
    description: 'Learning material inside a course module.';
    displayName: 'Course Material';
    pluralName: 'course-materials';
    singularName: 'course-material';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    body: Schema.Attribute.RichText;
    completionMode: Schema.Attribute.Enumeration<
      ['read_to_end', 'watch_percentage', 'external_signal', 'not_required']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'read_to_end'>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    estimatedDurationMinutes: Schema.Attribute.Integer;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::course-material.course-material'
    > &
      Schema.Attribute.Private;
    materialState: Schema.Attribute.Enumeration<
      ['draft', 'active', 'archived']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'draft'>;
    materialType: Schema.Attribute.Enumeration<
      [
        'text',
        'video',
        'file_download',
        'link',
        'embedded_content',
        'external_white_label',
      ]
    > &
      Schema.Attribute.Required;
    module: Schema.Attribute.Relation<
      'manyToOne',
      'api::course-module.course-module'
    >;
    publishedAt: Schema.Attribute.DateTime;
    required: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<true>;
    requiredCompletionPercentage: Schema.Attribute.Integer &
      Schema.Attribute.SetMinMax<
        {
          max: 100;
          min: 0;
        },
        number
      >;
    sortOrder: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<0>;
    sourceReference: Schema.Attribute.String;
    storedFile: Schema.Attribute.Relation<
      'oneToOne',
      'api::stored-file.stored-file'
    >;
    title: Schema.Attribute.String & Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    url: Schema.Attribute.String;
  };
}

export interface ApiCourseModuleResultCourseModuleResult
  extends Struct.CollectionTypeSchema {
  collectionName: 'course_module_results';
  info: {
    description: 'Snapshot result for a candidate module outcome.';
    displayName: 'Course Module Result';
    pluralName: 'course-module-results';
    singularName: 'course-module-result';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    candidate: Schema.Attribute.Relation<
      'manyToOne',
      'api::candidate.candidate'
    >;
    courseModule: Schema.Attribute.Relation<
      'manyToOne',
      'api::course-module.course-module'
    >;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    decidedAt: Schema.Attribute.DateTime;
    enrollment: Schema.Attribute.Relation<
      'manyToOne',
      'api::enrollment.enrollment'
    >;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::course-module-result.course-module-result'
    > &
      Schema.Attribute.Private;
    maxScore: Schema.Attribute.Decimal;
    metadata: Schema.Attribute.JSON;
    publishedAt: Schema.Attribute.DateTime;
    requiredItemsCompleted: Schema.Attribute.Integer;
    requiredItemsTotal: Schema.Attribute.Integer;
    resultState: Schema.Attribute.Enumeration<
      ['not_started', 'in_progress', 'passed', 'failed', 'appealed', 'skipped']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'not_started'>;
    score: Schema.Attribute.Decimal;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiCourseModuleCourseModule
  extends Struct.CollectionTypeSchema {
  collectionName: 'course_modules';
  info: {
    description: 'A module within a HireFlip course.';
    displayName: 'Course Module';
    pluralName: 'course-modules';
    singularName: 'course-module';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    courseSection: Schema.Attribute.Relation<
      'manyToOne',
      'api::course-section.course-section'
    >;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    description: Schema.Attribute.Text;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::course-module.course-module'
    > &
      Schema.Attribute.Private;
    materials: Schema.Attribute.Relation<
      'oneToMany',
      'api::course-material.course-material'
    >;
    moduleState: Schema.Attribute.Enumeration<['draft', 'active', 'archived']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'draft'>;
    publishedAt: Schema.Attribute.DateTime;
    required: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<true>;
    sortOrder: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      > &
      Schema.Attribute.DefaultTo<0>;
    title: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 160;
        minLength: 1;
      }>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiCourseProgressCourseProgress
  extends Struct.CollectionTypeSchema {
  collectionName: 'course_progress_records';
  info: {
    description: 'Candidate progress through class, module, material, test, and question milestones.';
    displayName: 'Course Progress';
    pluralName: 'course-progress-records';
    singularName: 'course-progress';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    attemptNumber: Schema.Attribute.Integer;
    candidate: Schema.Attribute.Relation<
      'manyToOne',
      'api::candidate.candidate'
    >;
    completedAt: Schema.Attribute.DateTime;
    courseMaterial: Schema.Attribute.Relation<
      'manyToOne',
      'api::course-material.course-material'
    >;
    courseModule: Schema.Attribute.Relation<
      'manyToOne',
      'api::course-module.course-module'
    >;
    courseQuestion: Schema.Attribute.Relation<
      'manyToOne',
      'api::course-question.course-question'
    >;
    courseSection: Schema.Attribute.Relation<
      'manyToOne',
      'api::course-section.course-section'
    >;
    courseTest: Schema.Attribute.Relation<
      'manyToOne',
      'api::course-test.course-test'
    >;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    enrollment: Schema.Attribute.Relation<
      'manyToOne',
      'api::enrollment.enrollment'
    >;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::course-progress.course-progress'
    > &
      Schema.Attribute.Private;
    metadata: Schema.Attribute.JSON;
    progressState: Schema.Attribute.Enumeration<
      ['not_started', 'in_progress', 'completed', 'failed', 'skipped']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'not_started'>;
    progressType: Schema.Attribute.Enumeration<
      ['class', 'section', 'module', 'material', 'test', 'question']
    > &
      Schema.Attribute.Required;
    publishedAt: Schema.Attribute.DateTime;
    score: Schema.Attribute.Decimal;
    startedAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiCourseQuestionCourseQuestion
  extends Struct.CollectionTypeSchema {
  collectionName: 'course_questions';
  info: {
    description: 'Assessment question and scoring definition for a HireFlip course test.';
    displayName: 'Course Question';
    pluralName: 'course-questions';
    singularName: 'course-question';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    correctAnswerPayload: Schema.Attribute.JSON;
    courseTest: Schema.Attribute.Relation<
      'manyToOne',
      'api::course-test.course-test'
    >;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::course-question.course-question'
    > &
      Schema.Attribute.Private;
    options: Schema.Attribute.JSON;
    prompt: Schema.Attribute.RichText & Schema.Attribute.Required;
    publishedAt: Schema.Attribute.DateTime;
    questionState: Schema.Attribute.Enumeration<
      ['draft', 'active', 'archived']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'draft'>;
    questionType: Schema.Attribute.Enumeration<
      [
        'short_text',
        'long_text',
        'single_choice',
        'multiple_choice',
        'file_upload',
        'ai_reviewed',
        'external',
      ]
    > &
      Schema.Attribute.Required;
    randomizationGroup: Schema.Attribute.String;
    scoringRubric: Schema.Attribute.JSON;
    sortOrder: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<0>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiCourseResultCourseResult
  extends Struct.CollectionTypeSchema {
  collectionName: 'course_results';
  info: {
    description: 'Snapshot result for a candidate course outcome.';
    displayName: 'Course Result';
    pluralName: 'course-results';
    singularName: 'course-result';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    candidate: Schema.Attribute.Relation<
      'manyToOne',
      'api::candidate.candidate'
    >;
    completedAt: Schema.Attribute.DateTime;
    completionDeadline: Schema.Attribute.DateTime;
    course: Schema.Attribute.Relation<'manyToOne', 'api::course.course'>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    credentialLabelSnapshot: Schema.Attribute.String;
    deadlineExtensionSeconds: Schema.Attribute.Integer &
      Schema.Attribute.DefaultTo<0>;
    enrollment: Schema.Attribute.Relation<
      'oneToOne',
      'api::enrollment.enrollment'
    >;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::course-result.course-result'
    > &
      Schema.Attribute.Private;
    maxScore: Schema.Attribute.Decimal;
    metadata: Schema.Attribute.JSON;
    passedAt: Schema.Attribute.DateTime;
    publishedAt: Schema.Attribute.DateTime;
    requiredSectionsPassed: Schema.Attribute.Integer;
    requiredSectionsTotal: Schema.Attribute.Integer;
    resultState: Schema.Attribute.Enumeration<
      ['not_started', 'in_progress', 'passed', 'failed', 'appealed', 'expired']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'not_started'>;
    score: Schema.Attribute.Decimal;
    startedAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiCourseSectionResultCourseSectionResult
  extends Struct.CollectionTypeSchema {
  collectionName: 'course_section_results';
  info: {
    description: 'Snapshot result for a candidate course section outcome.';
    displayName: 'Course Section Result';
    pluralName: 'course-section-results';
    singularName: 'course-section-result';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    candidate: Schema.Attribute.Relation<
      'manyToOne',
      'api::candidate.candidate'
    >;
    courseSection: Schema.Attribute.Relation<
      'manyToOne',
      'api::course-section.course-section'
    >;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    decidedAt: Schema.Attribute.DateTime;
    enrollment: Schema.Attribute.Relation<
      'manyToOne',
      'api::enrollment.enrollment'
    >;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::course-section-result.course-section-result'
    > &
      Schema.Attribute.Private;
    metadata: Schema.Attribute.JSON;
    publishedAt: Schema.Attribute.DateTime;
    requiredModulesPassed: Schema.Attribute.Integer;
    requiredModulesTotal: Schema.Attribute.Integer;
    resultState: Schema.Attribute.Enumeration<
      ['not_started', 'in_progress', 'passed', 'failed', 'appealed', 'skipped']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'not_started'>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiCourseSectionCourseSection
  extends Struct.CollectionTypeSchema {
  collectionName: 'course_sections';
  info: {
    description: 'A major section inside a HireFlip course.';
    displayName: 'Course Section';
    pluralName: 'course-sections';
    singularName: 'course-section';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    course: Schema.Attribute.Relation<'manyToOne', 'api::course.course'>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    description: Schema.Attribute.Text;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::course-section.course-section'
    > &
      Schema.Attribute.Private;
    modules: Schema.Attribute.Relation<
      'oneToMany',
      'api::course-module.course-module'
    >;
    publishedAt: Schema.Attribute.DateTime;
    required: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<true>;
    sectionState: Schema.Attribute.Enumeration<
      ['draft', 'active', 'archived']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'draft'>;
    sortOrder: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      > &
      Schema.Attribute.DefaultTo<0>;
    title: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 160;
        minLength: 1;
      }>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiCourseTestAttemptCourseTestAttempt
  extends Struct.CollectionTypeSchema {
  collectionName: 'course_test_attempts';
  info: {
    description: 'One candidate attempt at a HireFlip course test.';
    displayName: 'Course Test Attempt';
    pluralName: 'course-test-attempts';
    singularName: 'course-test-attempt';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    attemptNumber: Schema.Attribute.Integer & Schema.Attribute.Required;
    attemptState: Schema.Attribute.Enumeration<
      [
        'in_progress',
        'submitted',
        'scored',
        'passed',
        'failed',
        'appealed',
        'void',
      ]
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'in_progress'>;
    candidate: Schema.Attribute.Relation<
      'manyToOne',
      'api::candidate.candidate'
    >;
    courseTest: Schema.Attribute.Relation<
      'manyToOne',
      'api::course-test.course-test'
    >;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    enrollment: Schema.Attribute.Relation<
      'manyToOne',
      'api::enrollment.enrollment'
    >;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::course-test-attempt.course-test-attempt'
    > &
      Schema.Attribute.Private;
    maxScore: Schema.Attribute.Decimal;
    metadata: Schema.Attribute.JSON;
    passed: Schema.Attribute.Boolean;
    passMarkSnapshot: Schema.Attribute.Decimal;
    publishedAt: Schema.Attribute.DateTime;
    retryEligibilityState: Schema.Attribute.Enumeration<
      [
        'not_assessed',
        'eligible_open_retry',
        'eligible_conditional_retry',
        'not_eligible',
        'exhausted',
      ]
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'not_assessed'>;
    retryType: Schema.Attribute.Enumeration<
      ['first_attempt', 'open_retry', 'conditional_retry', 'admin_override']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'first_attempt'>;
    score: Schema.Attribute.Decimal;
    startedAt: Schema.Attribute.DateTime;
    submittedAt: Schema.Attribute.DateTime;
    timeTakenSeconds: Schema.Attribute.Integer;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiCourseTestResultCourseTestResult
  extends Struct.CollectionTypeSchema {
  collectionName: 'course_test_results';
  info: {
    description: 'Snapshot result for a candidate course test attempt.';
    displayName: 'Course Test Result';
    pluralName: 'course-test-results';
    singularName: 'course-test-result';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    attemptNumber: Schema.Attribute.Integer;
    candidate: Schema.Attribute.Relation<
      'manyToOne',
      'api::candidate.candidate'
    >;
    courseTest: Schema.Attribute.Relation<
      'manyToOne',
      'api::course-test.course-test'
    >;
    courseTestAttempt: Schema.Attribute.Relation<
      'oneToOne',
      'api::course-test-attempt.course-test-attempt'
    >;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    decidedAt: Schema.Attribute.DateTime;
    enrollment: Schema.Attribute.Relation<
      'manyToOne',
      'api::enrollment.enrollment'
    >;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::course-test-result.course-test-result'
    > &
      Schema.Attribute.Private;
    maxScore: Schema.Attribute.Decimal;
    metadata: Schema.Attribute.JSON;
    passed: Schema.Attribute.Boolean;
    passMarkSnapshot: Schema.Attribute.Decimal;
    publishedAt: Schema.Attribute.DateTime;
    resultState: Schema.Attribute.Enumeration<
      ['not_assessed', 'passed', 'failed', 'appealed', 'void']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'not_assessed'>;
    retryEligibilityState: Schema.Attribute.Enumeration<
      [
        'not_assessed',
        'eligible_open_retry',
        'eligible_conditional_retry',
        'not_eligible',
        'exhausted',
      ]
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'not_assessed'>;
    score: Schema.Attribute.Decimal;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiCourseTestCourseTest extends Struct.CollectionTypeSchema {
  collectionName: 'course_tests';
  info: {
    description: 'Assessment attached to a HireFlip course or module.';
    displayName: 'Course Test';
    pluralName: 'course-tests';
    singularName: 'course-test';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    attemptLimit: Schema.Attribute.Integer;
    copyPasteRestrictionEnabled: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<true>;
    course: Schema.Attribute.Relation<'manyToOne', 'api::course.course'>;
    courseModule: Schema.Attribute.Relation<
      'manyToOne',
      'api::course-module.course-module'
    >;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    description: Schema.Attribute.Text;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::course-test.course-test'
    > &
      Schema.Attribute.Private;
    maxScore: Schema.Attribute.Decimal;
    passMark: Schema.Attribute.Decimal;
    publishedAt: Schema.Attribute.DateTime;
    questionRandomizationEnabled: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<true>;
    questions: Schema.Attribute.Relation<
      'oneToMany',
      'api::course-question.course-question'
    >;
    testState: Schema.Attribute.Enumeration<['draft', 'active', 'archived']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'draft'>;
    timeLimitMinutes: Schema.Attribute.Integer;
    title: Schema.Attribute.String & Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiCourseCourse extends Struct.CollectionTypeSchema {
  collectionName: 'courses';
  info: {
    description: 'A versioned HireFlip course definition.';
    displayName: 'Course';
    pluralName: 'courses';
    singularName: 'course';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    classes: Schema.Attribute.Relation<'oneToMany', 'api::class.class'>;
    courseState: Schema.Attribute.Enumeration<['draft', 'active', 'archived']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'draft'>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    description: Schema.Attribute.Text;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::course.course'
    > &
      Schema.Attribute.Private;
    name: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 160;
        minLength: 1;
      }>;
    publishedAt: Schema.Attribute.DateTime;
    sections: Schema.Attribute.Relation<
      'oneToMany',
      'api::course-section.course-section'
    >;
    sector: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 120;
      }>;
    sourceReference: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 240;
      }>;
    sourceType: Schema.Attribute.Enumeration<
      ['internal', 'white_label', 'external']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'internal'>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    version: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 80;
        minLength: 1;
      }>;
  };
}

export interface ApiEmployerCapacityChangeRequestEmployerCapacityChangeRequest
  extends Struct.CollectionTypeSchema {
  collectionName: 'employer_capacity_change_requests';
  info: {
    description: 'Employer representative request to change interview volume or cadence after onboarding.';
    displayName: 'Employer Capacity Change Request';
    pluralName: 'employer-capacity-change-requests';
    singularName: 'employer-capacity-change-request';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    currentInterviewCommitmentCadence: Schema.Attribute.Enumeration<
      ['not_set', 'quarterly', 'biannually', 'annually']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'not_set'>;
    currentInterviewCommitmentVolume: Schema.Attribute.Integer &
      Schema.Attribute.SetMinMax<
        {
          max: 1000;
          min: 0;
        },
        number
      >;
    employer: Schema.Attribute.Relation<'manyToOne', 'api::employer.employer'>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::employer-capacity-change-request.employer-capacity-change-request'
    > &
      Schema.Attribute.Private;
    metadata: Schema.Attribute.JSON;
    publishedAt: Schema.Attribute.DateTime;
    reason: Schema.Attribute.Text;
    requestedByEmployerContact: Schema.Attribute.Relation<
      'manyToOne',
      'api::employer-contact.employer-contact'
    >;
    requestedInterviewCommitmentCadence: Schema.Attribute.Enumeration<
      ['not_set', 'quarterly', 'biannually', 'annually']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'not_set'>;
    requestedInterviewCommitmentVolume: Schema.Attribute.Integer &
      Schema.Attribute.SetMinMax<
        {
          max: 1000;
          min: 0;
        },
        number
      >;
    requestState: Schema.Attribute.Enumeration<
      ['pending', 'approved', 'denied', 'cancelled']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'pending'>;
    reviewedAt: Schema.Attribute.DateTime;
    reviewedBy: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 160;
      }>;
    reviewNotes: Schema.Attribute.Text;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiEmployerContactEmployerContact
  extends Struct.CollectionTypeSchema {
  collectionName: 'employer_contacts';
  info: {
    description: 'Nominated contacts who manage employer participation and interview workflows.';
    displayName: 'Employer Contact';
    pluralName: 'employer-contacts';
    singularName: 'employer-contact';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    accountCreatedAt: Schema.Attribute.DateTime;
    authIdentityId: Schema.Attribute.String &
      Schema.Attribute.Unique &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 160;
      }>;
    authProvider: Schema.Attribute.Enumeration<['auth0', 'manual', 'unknown']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'unknown'>;
    contactState: Schema.Attribute.Enumeration<
      ['invited', 'listed', 'active', 'disabled', 'archived']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'invited'>;
    coverageRegions: Schema.Attribute.Relation<
      'manyToMany',
      'api::class-area.class-area'
    >;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    email: Schema.Attribute.Email &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 254;
      }>;
    employer: Schema.Attribute.Relation<'manyToOne', 'api::employer.employer'>;
    firstName: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 120;
      }>;
    invitedAt: Schema.Attribute.DateTime;
    lastName: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 120;
      }>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::employer-contact.employer-contact'
    > &
      Schema.Attribute.Private;
    notificationPreferences: Schema.Attribute.JSON;
    phone: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 40;
      }>;
    publishedAt: Schema.Attribute.DateTime;
    roleTitle: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 160;
      }>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiEmployerInviteEmployerInvite
  extends Struct.CollectionTypeSchema {
  collectionName: 'employer_invites';
  info: {
    description: 'Invite/session-key record for gated employer dashboard onboarding.';
    displayName: 'Employer Invite';
    pluralName: 'employer-invites';
    singularName: 'employer-invite';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    acceptedAt: Schema.Attribute.DateTime;
    acceptedByAuthIdentityId: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 160;
      }>;
    acceptedByEmail: Schema.Attribute.Email &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 254;
      }>;
    authIdentityId: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 160;
      }>;
    authPasswordTicketCreatedAt: Schema.Attribute.DateTime;
    authPasswordTicketExpiresAt: Schema.Attribute.DateTime;
    authPasswordTicketUrl: Schema.Attribute.Text & Schema.Attribute.Private;
    authProvisionedAt: Schema.Attribute.DateTime;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    createdByStaffDisplayName: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 240;
      }>;
    createdByStaffEmail: Schema.Attribute.Email &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 254;
      }>;
    createdByStaffUserId: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 160;
      }>;
    deliveryFailureMessage: Schema.Attribute.Text;
    deliveryState: Schema.Attribute.Enumeration<
      ['not_required', 'queued', 'failed']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'not_required'>;
    employer: Schema.Attribute.Relation<'manyToOne', 'api::employer.employer'>;
    employerContact: Schema.Attribute.Relation<
      'manyToOne',
      'api::employer-contact.employer-contact'
    >;
    expiresAt: Schema.Attribute.DateTime & Schema.Attribute.Required;
    inviteEmail: Schema.Attribute.Email &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 254;
      }>;
    inviteState: Schema.Attribute.Enumeration<
      ['pending', 'accepted', 'revoked', 'expired']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'pending'>;
    lastSentAt: Schema.Attribute.DateTime;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::employer-invite.employer-invite'
    > &
      Schema.Attribute.Private;
    metadata: Schema.Attribute.JSON;
    notificationServiceJobId: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 160;
      }>;
    publishedAt: Schema.Attribute.DateTime;
    revokedAt: Schema.Attribute.DateTime;
    tokenHash: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 128;
      }>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiEmployerEmployer extends Struct.CollectionTypeSchema {
  collectionName: 'employers';
  info: {
    description: 'Companies participating in HireFlip hiring workflows.';
    displayName: 'Employer';
    pluralName: 'employers';
    singularName: 'employer';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    assignmentMode: Schema.Attribute.Enumeration<
      ['automatic', 'manual_masked_cv_review', 'criteria_matching']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'automatic'>;
    capacityChangeRequests: Schema.Attribute.Relation<
      'oneToMany',
      'api::employer-capacity-change-request.employer-capacity-change-request'
    >;
    capacityChangeRequestStatus: Schema.Attribute.Enumeration<
      ['none', 'pending', 'approved', 'denied']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'none'>;
    commitmentMode: Schema.Attribute.Enumeration<['global', 'per_region']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'global'>;
    companyName: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 200;
        minLength: 1;
      }>;
    contacts: Schema.Attribute.Relation<
      'oneToMany',
      'api::employer-contact.employer-contact'
    >;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    dashboardOnboardingCompletedAt: Schema.Attribute.DateTime;
    dashboardOnboardingMetadata: Schema.Attribute.JSON;
    dashboardOnboardingState: Schema.Attribute.Enumeration<
      ['not_started', 'in_progress', 'complete']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'not_started'>;
    employerState: Schema.Attribute.Enumeration<
      ['prospect', 'invited', 'active', 'paused', 'archived']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'prospect'>;
    employerTermsAcceptedAt: Schema.Attribute.DateTime;
    employerTermsAcceptedByEmail: Schema.Attribute.Email &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 254;
      }>;
    employerTermsPolicyDocumentId: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 120;
      }>;
    employerTermsPolicyVersion: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 120;
      }>;
    initialInterviewCommitmentCadence: Schema.Attribute.Enumeration<
      ['not_set', 'quarterly', 'biannually', 'annually']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'not_set'>;
    initialInterviewCommitmentVolume: Schema.Attribute.Integer &
      Schema.Attribute.SetMinMax<
        {
          max: 1000;
          min: 0;
        },
        number
      >;
    interviewCommitmentCadence: Schema.Attribute.Enumeration<
      ['not_set', 'quarterly', 'biannually', 'annually']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'not_set'>;
    interviewCommitmentVolume: Schema.Attribute.Integer &
      Schema.Attribute.SetMinMax<
        {
          max: 1000;
          min: 0;
        },
        number
      >;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::employer.employer'
    > &
      Schema.Attribute.Private;
    notes: Schema.Attribute.Text;
    operatingRegions: Schema.Attribute.Relation<
      'manyToMany',
      'api::class-area.class-area'
    >;
    publishedAt: Schema.Attribute.DateTime;
    region: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 120;
      }>;
    roleInterests: Schema.Attribute.JSON;
    sectorInterests: Schema.Attribute.JSON;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiEnrollmentEnrollment extends Struct.CollectionTypeSchema {
  collectionName: 'enrollments';
  info: {
    description: 'Connects a candidate to a HireFlip class and tracks class-level eligibility state.';
    displayName: 'Enrollment';
    pluralName: 'enrollments';
    singularName: 'enrollment';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    beganClassAt: Schema.Attribute.DateTime;
    candidate: Schema.Attribute.Relation<
      'manyToOne',
      'api::candidate.candidate'
    >;
    class: Schema.Attribute.Relation<'manyToOne', 'api::class.class'>;
    completedAt: Schema.Attribute.DateTime;
    completionStatus: Schema.Attribute.Enumeration<
      ['not_started', 'in_progress', 'completed', 'missed_deadline']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'not_started'>;
    courseCompletionDeadline: Schema.Attribute.DateTime;
    courseDeadlineExtensionSeconds: Schema.Attribute.Integer &
      Schema.Attribute.DefaultTo<0>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    enrolledAt: Schema.Attribute.DateTime;
    enrollmentState: Schema.Attribute.Enumeration<
      [
        'interest_registered',
        'interest_withdrawn',
        'enrollment_open',
        'place_reserved',
        'waiting_list',
        'missed_out',
        'enrolled',
        'payment_exception',
        'in_class',
        'interview_phase',
        'completed',
        'failed',
        'withdrawn',
        'refunded',
        'removed_no_refund',
        'removed_partial_refund',
        'removed_full_refund',
      ]
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'interest_registered'>;
    interestRegisteredAt: Schema.Attribute.DateTime;
    interviewGuaranteeDeadline: Schema.Attribute.DateTime;
    interviewGuaranteeWindowStartsAt: Schema.Attribute.DateTime;
    invitedToJoinAt: Schema.Attribute.DateTime;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::enrollment.enrollment'
    > &
      Schema.Attribute.Private;
    metadata: Schema.Attribute.JSON;
    missedOutAt: Schema.Attribute.DateTime;
    passedAt: Schema.Attribute.DateTime;
    passStatus: Schema.Attribute.Enumeration<
      ['not_assessed', 'passed', 'failed', 'appealed']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'not_assessed'>;
    paymentStatus: Schema.Attribute.Enumeration<
      [
        'not_required',
        'pending',
        'paid',
        'requires_review',
        'failed',
        'partially_refunded',
        'refunded',
      ]
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'pending'>;
    publishedAt: Schema.Attribute.DateTime;
    qualifyingInterviewsDeliveredCount: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<0>;
    refundEligibilityState: Schema.Attribute.Enumeration<
      [
        'not_assessed',
        'not_eligible',
        'potentially_eligible',
        'eligible_25',
        'eligible_50',
        'refund_requested',
        'refund_processed',
        'forfeited',
      ]
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'not_assessed'>;
    reservationExpiresAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    waitingListPosition: Schema.Attribute.Integer &
      Schema.Attribute.SetMinMax<
        {
          min: 1;
        },
        number
      >;
  };
}

export interface ApiInterviewFeedbackInterviewFeedback
  extends Struct.CollectionTypeSchema {
  collectionName: 'interview_feedback';
  info: {
    description: 'Candidate or employer feedback after an interview.';
    displayName: 'Interview Feedback';
    pluralName: 'interview-feedback-records';
    singularName: 'interview-feedback';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    concerns: Schema.Attribute.Text;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    interview: Schema.Attribute.Relation<
      'manyToOne',
      'api::interview.interview'
    >;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::interview-feedback.interview-feedback'
    > &
      Schema.Attribute.Private;
    metadata: Schema.Attribute.JSON;
    nextStep: Schema.Attribute.Text;
    notes: Schema.Attribute.Text;
    outcome: Schema.Attribute.Enumeration<
      [
        'positive',
        'neutral',
        'negative',
        'progressing',
        'not_progressing',
        'offer_expected',
        'unknown',
      ]
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'unknown'>;
    publishedAt: Schema.Attribute.DateTime;
    rating: Schema.Attribute.Integer;
    strengths: Schema.Attribute.Text;
    submittedAt: Schema.Attribute.DateTime;
    submittedById: Schema.Attribute.String;
    submittedByType: Schema.Attribute.Enumeration<
      ['candidate', 'employer_contact', 'admin', 'system']
    > &
      Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiInterviewSlotOfferInterviewSlotOffer
  extends Struct.CollectionTypeSchema {
  collectionName: 'interview_slot_offers';
  info: {
    description: 'A grouped 3-option employer interview slot offer for candidate selection.';
    displayName: 'Interview Slot Offer';
    pluralName: 'interview-slot-offers';
    singularName: 'interview-slot-offer';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    candidate: Schema.Attribute.Relation<
      'manyToOne',
      'api::candidate.candidate'
    >;
    candidateNotifiedAt: Schema.Attribute.DateTime;
    candidateRespondedAt: Schema.Attribute.DateTime;
    candidateResponseDeadline: Schema.Attribute.DateTime;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    declineNote: Schema.Attribute.Text;
    declineReason: Schema.Attribute.Enumeration<
      [
        'health_or_family_emergency',
        'another_interview',
        'travel_disruption',
        'other',
      ]
    >;
    employer: Schema.Attribute.Relation<'manyToOne', 'api::employer.employer'>;
    employerContact: Schema.Attribute.Relation<
      'manyToOne',
      'api::employer-contact.employer-contact'
    >;
    enrollment: Schema.Attribute.Relation<
      'manyToOne',
      'api::enrollment.enrollment'
    >;
    internalNote: Schema.Attribute.Text;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::interview-slot-offer.interview-slot-offer'
    > &
      Schema.Attribute.Private;
    metadata: Schema.Attribute.JSON;
    offerState: Schema.Attribute.Enumeration<
      [
        'draft',
        'submitted',
        'sent',
        'candidate_selected',
        'candidate_declined',
        'expired',
        'cancelled',
        'completed',
        'replacement_required',
      ]
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'submitted'>;
    publishedAt: Schema.Attribute.DateTime;
    selectedInterview: Schema.Attribute.Relation<
      'manyToOne',
      'api::interview.interview'
    >;
    selectedSlot: Schema.Attribute.Relation<
      'manyToOne',
      'api::interview-slot.interview-slot'
    >;
    slots: Schema.Attribute.Relation<
      'oneToMany',
      'api::interview-slot.interview-slot'
    >;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiInterviewSlotInterviewSlot
  extends Struct.CollectionTypeSchema {
  collectionName: 'interview_slots';
  info: {
    description: 'Employer availability that can be offered or assigned to candidates.';
    displayName: 'Interview Slot';
    pluralName: 'interview-slots';
    singularName: 'interview-slot';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    capacity: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<1>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    employer: Schema.Attribute.Relation<'manyToOne', 'api::employer.employer'>;
    employerContact: Schema.Attribute.Relation<
      'manyToOne',
      'api::employer-contact.employer-contact'
    >;
    endTime: Schema.Attribute.DateTime & Schema.Attribute.Required;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::interview-slot.interview-slot'
    > &
      Schema.Attribute.Private;
    locationDetails: Schema.Attribute.Text;
    locationType: Schema.Attribute.Enumeration<
      ['online', 'phone', 'in_person', 'to_be_confirmed']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'online'>;
    meetingUrl: Schema.Attribute.String;
    metadata: Schema.Attribute.JSON;
    publishedAt: Schema.Attribute.DateTime;
    slotOffer: Schema.Attribute.Relation<
      'manyToOne',
      'api::interview-slot-offer.interview-slot-offer'
    >;
    slotState: Schema.Attribute.Enumeration<
      [
        'draft',
        'available',
        'offered',
        'held',
        'booked',
        'completed',
        'cancelled',
        'expired',
      ]
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'available'>;
    startTime: Schema.Attribute.DateTime & Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiInterviewInterview extends Struct.CollectionTypeSchema {
  collectionName: 'interviews';
  info: {
    description: 'Scheduled candidate interview with an employer.';
    displayName: 'Interview';
    pluralName: 'interviews';
    singularName: 'interview';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    candidate: Schema.Attribute.Relation<
      'manyToOne',
      'api::candidate.candidate'
    >;
    candidateStrikeApplied: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<false>;
    completedAt: Schema.Attribute.DateTime;
    confirmedAt: Schema.Attribute.DateTime;
    countsTowardGuarantee: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<false>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    employer: Schema.Attribute.Relation<'manyToOne', 'api::employer.employer'>;
    employerCancellation: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<false>;
    employerContact: Schema.Attribute.Relation<
      'manyToOne',
      'api::employer-contact.employer-contact'
    >;
    enrollment: Schema.Attribute.Relation<
      'manyToOne',
      'api::enrollment.enrollment'
    >;
    interviewSlot: Schema.Attribute.Relation<
      'manyToOne',
      'api::interview-slot.interview-slot'
    >;
    interviewState: Schema.Attribute.Enumeration<
      [
        'offered',
        'candidate_selected',
        'confirmed',
        'completed',
        'candidate_no_show',
        'candidate_declined',
        'employer_cancelled',
        'rescheduled',
        'cancelled',
      ]
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'offered'>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::interview.interview'
    > &
      Schema.Attribute.Private;
    metadata: Schema.Attribute.JSON;
    publishedAt: Schema.Attribute.DateTime;
    scheduledEndTime: Schema.Attribute.DateTime;
    scheduledStartTime: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiNotificationEventNotificationEvent
  extends Struct.CollectionTypeSchema {
  collectionName: 'notification_events';
  info: {
    description: 'Notification request and delivery state coordinated with the notification service.';
    displayName: 'Notification Event';
    pluralName: 'notification-events';
    singularName: 'notification-event';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    candidate: Schema.Attribute.Relation<
      'manyToOne',
      'api::candidate.candidate'
    >;
    channel: Schema.Attribute.Enumeration<['email', 'sms', 'in_app']> &
      Schema.Attribute.Required;
    class: Schema.Attribute.Relation<'manyToOne', 'api::class.class'>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    deliveredAt: Schema.Attribute.DateTime;
    deliveryState: Schema.Attribute.Enumeration<
      [
        'queued',
        'scheduled',
        'sending',
        'sent',
        'delivered',
        'failed',
        'cancelled',
        'suppressed',
      ]
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'queued'>;
    employer: Schema.Attribute.Relation<'manyToOne', 'api::employer.employer'>;
    errorMessage: Schema.Attribute.Text;
    eventType: Schema.Attribute.String & Schema.Attribute.Required;
    failedAt: Schema.Attribute.DateTime;
    interview: Schema.Attribute.Relation<
      'manyToOne',
      'api::interview.interview'
    >;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::notification-event.notification-event'
    > &
      Schema.Attribute.Private;
    metadata: Schema.Attribute.JSON;
    payment: Schema.Attribute.Relation<'manyToOne', 'api::payment.payment'>;
    priority: Schema.Attribute.Enumeration<
      ['low', 'normal', 'high', 'urgent']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'normal'>;
    provider: Schema.Attribute.String;
    providerMessageId: Schema.Attribute.String;
    publishedAt: Schema.Attribute.DateTime;
    recipientEmail: Schema.Attribute.Email;
    recipientId: Schema.Attribute.String;
    recipientPhone: Schema.Attribute.String;
    recipientType: Schema.Attribute.Enumeration<
      [
        'candidate',
        'employer_contact',
        'recruiter',
        'admin',
        'public_lead',
        'other',
      ]
    > &
      Schema.Attribute.Required;
    refund: Schema.Attribute.Relation<'manyToOne', 'api::refund.refund'>;
    relatedId: Schema.Attribute.String;
    relatedType: Schema.Attribute.String;
    scheduledAt: Schema.Attribute.DateTime;
    sentAt: Schema.Attribute.DateTime;
    templateKey: Schema.Attribute.String;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiOfferOffer extends Struct.CollectionTypeSchema {
  collectionName: 'offers';
  info: {
    description: 'Non-binding employer request for candidate details so the employer can progress the candidate internally.';
    displayName: 'Progression Request';
    pluralName: 'offers';
    singularName: 'offer';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    candidate: Schema.Attribute.Relation<
      'manyToOne',
      'api::candidate.candidate'
    >;
    candidateNotifiedAt: Schema.Attribute.DateTime;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    detailsReleasedAt: Schema.Attribute.DateTime;
    employer: Schema.Attribute.Relation<'manyToOne', 'api::employer.employer'>;
    internalProcessNotes: Schema.Attribute.Text;
    interview: Schema.Attribute.Relation<
      'manyToOne',
      'api::interview.interview'
    >;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<'oneToMany', 'api::offer.offer'> &
      Schema.Attribute.Private;
    metadata: Schema.Attribute.JSON;
    progressionState: Schema.Attribute.Enumeration<
      [
        'draft',
        'requested',
        'candidate_notified',
        'details_released',
        'closed',
        'cancelled',
      ]
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'requested'>;
    publishedAt: Schema.Attribute.DateTime;
    requestedByEmployerContact: Schema.Attribute.Relation<
      'manyToOne',
      'api::employer-contact.employer-contact'
    >;
    requestedDetailsAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiPaymentWebhookEventPaymentWebhookEvent
  extends Struct.CollectionTypeSchema {
  collectionName: 'payment_webhook_events';
  info: {
    description: 'Recorded payment-provider webhook/event state received through the payment service.';
    displayName: 'Payment Webhook Event';
    pluralName: 'payment-webhook-events';
    singularName: 'payment-webhook-event';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    eventType: Schema.Attribute.String & Schema.Attribute.Required;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::payment-webhook-event.payment-webhook-event'
    > &
      Schema.Attribute.Private;
    metadata: Schema.Attribute.JSON;
    payload: Schema.Attribute.JSON;
    payment: Schema.Attribute.Relation<'manyToOne', 'api::payment.payment'>;
    paymentProvider: Schema.Attribute.Enumeration<['stripe']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'stripe'>;
    processedAt: Schema.Attribute.DateTime;
    processingError: Schema.Attribute.Text;
    processingState: Schema.Attribute.Enumeration<
      ['received', 'processed', 'ignored', 'failed']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'received'>;
    providerEventId: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique;
    publishedAt: Schema.Attribute.DateTime;
    receivedAt: Schema.Attribute.DateTime;
    refund: Schema.Attribute.Relation<'manyToOne', 'api::refund.refund'>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiPaymentPayment extends Struct.CollectionTypeSchema {
  collectionName: 'payments';
  info: {
    description: 'Internal product payment state, without raw card data.';
    displayName: 'Payment';
    pluralName: 'payments';
    singularName: 'payment';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    amountPence: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      >;
    cancelledAt: Schema.Attribute.DateTime;
    candidate: Schema.Attribute.Relation<
      'manyToOne',
      'api::candidate.candidate'
    >;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    createdByService: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 120;
      }>;
    currency: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 3;
        minLength: 3;
      }> &
      Schema.Attribute.DefaultTo<'GBP'>;
    enrollment: Schema.Attribute.Relation<
      'manyToOne',
      'api::enrollment.enrollment'
    >;
    expiredAt: Schema.Attribute.DateTime;
    failedAt: Schema.Attribute.DateTime;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::payment.payment'
    > &
      Schema.Attribute.Private;
    metadata: Schema.Attribute.JSON;
    paidAt: Schema.Attribute.DateTime;
    paymentProvider: Schema.Attribute.Enumeration<['stripe']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'stripe'>;
    paymentState: Schema.Attribute.Enumeration<
      [
        'draft',
        'checkout_created',
        'pending',
        'paid',
        'requires_review',
        'failed',
        'cancelled',
        'expired',
        'partially_refunded',
        'refunded',
      ]
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'draft'>;
    paymentType: Schema.Attribute.Enumeration<
      ['course_payment', 'subscription', 'other']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'course_payment'>;
    providerCheckoutSessionId: Schema.Attribute.String &
      Schema.Attribute.Unique &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 255;
      }>;
    providerCustomerId: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 255;
      }>;
    providerPaymentIntentId: Schema.Attribute.String &
      Schema.Attribute.Unique &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 255;
      }>;
    publishedAt: Schema.Attribute.DateTime;
    reservation: Schema.Attribute.Relation<
      'manyToOne',
      'api::reservation.reservation'
    >;
    slotReservationExpiresAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiPolicyDocumentPolicyDocument
  extends Struct.CollectionTypeSchema {
  collectionName: 'policy_documents';
  info: {
    description: 'Versioned legal, policy, and terms content used across HireFlip surfaces.';
    displayName: 'Policy Document';
    pluralName: 'policy-documents';
    singularName: 'policy-document';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    acceptanceLabel: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 280;
      }>;
    acceptedReservations: Schema.Attribute.Relation<
      'oneToMany',
      'api::reservation.reservation'
    >;
    body: Schema.Attribute.Text & Schema.Attribute.Required;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    effectiveFrom: Schema.Attribute.DateTime;
    internalNotes: Schema.Attribute.Text;
    introCopy: Schema.Attribute.Text;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::policy-document.policy-document'
    > &
      Schema.Attribute.Private;
    policyKey: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 200;
        minLength: 1;
      }>;
    policyState: Schema.Attribute.Enumeration<['draft', 'active', 'archived']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'draft'>;
    policyType: Schema.Attribute.Enumeration<
      [
        'class_checkout_terms',
        'candidate_terms',
        'website_terms',
        'privacy_policy',
        'cookie_policy',
        'refund_policy',
        'employer_terms',
      ]
    > &
      Schema.Attribute.Required;
    publishedAt: Schema.Attribute.DateTime;
    title: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 180;
        minLength: 1;
      }>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    version: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 120;
        minLength: 1;
      }>;
  };
}

export interface ApiPrivacyRightsRequestPrivacyRightsRequest
  extends Struct.CollectionTypeSchema {
  collectionName: 'privacy_rights_requests';
  info: {
    description: 'Data access, correction, deletion, erasure, portability, objection, or restriction request.';
    displayName: 'Privacy Rights Request';
    pluralName: 'privacy-rights-requests';
    singularName: 'privacy-rights-request';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    adminOwnerId: Schema.Attribute.String;
    candidate: Schema.Attribute.Relation<
      'manyToOne',
      'api::candidate.candidate'
    >;
    clarificationRequestedAt: Schema.Attribute.DateTime;
    completedAt: Schema.Attribute.DateTime;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    deletionJobStatus: Schema.Attribute.Enumeration<
      ['not_required', 'pending', 'in_progress', 'completed', 'failed']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'not_required'>;
    downstreamProviderSyncStatus: Schema.Attribute.Enumeration<
      ['not_required', 'pending', 'in_progress', 'completed', 'failed']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'not_required'>;
    dueAt: Schema.Attribute.DateTime;
    employerContact: Schema.Attribute.Relation<
      'manyToOne',
      'api::employer-contact.employer-contact'
    >;
    exportFile: Schema.Attribute.Relation<
      'oneToOne',
      'api::stored-file.stored-file'
    >;
    identityVerificationStatus: Schema.Attribute.Enumeration<
      ['not_started', 'pending', 'verified', 'failed', 'not_required']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'not_started'>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::privacy-rights-request.privacy-rights-request'
    > &
      Schema.Attribute.Private;
    metadata: Schema.Attribute.JSON;
    publicInterestLead: Schema.Attribute.Relation<
      'manyToOne',
      'api::public-interest-lead.public-interest-lead'
    >;
    publishedAt: Schema.Attribute.DateTime;
    receivedAt: Schema.Attribute.DateTime;
    rejectionReason: Schema.Attribute.Text;
    requestingUserId: Schema.Attribute.String;
    requestingUserType: Schema.Attribute.Enumeration<
      [
        'candidate',
        'employer_contact',
        'recruiter',
        'public_lead',
        'admin',
        'unknown',
      ]
    > &
      Schema.Attribute.Required;
    requestState: Schema.Attribute.Enumeration<
      [
        'received',
        'identity_verification_required',
        'in_review',
        'clarification_requested',
        'processing',
        'completed',
        'partially_fulfilled',
        'rejected',
        'cancelled',
      ]
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'received'>;
    requestType: Schema.Attribute.Enumeration<
      [
        'access',
        'correction',
        'deletion',
        'erasure',
        'portability',
        'objection',
        'restriction',
        'other',
      ]
    > &
      Schema.Attribute.Required;
    retentionReasons: Schema.Attribute.JSON;
    subjectUserId: Schema.Attribute.String;
    subjectUserType: Schema.Attribute.Enumeration<
      ['candidate', 'employer_contact', 'recruiter', 'public_lead', 'unknown']
    >;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiPublicInterestLeadPublicInterestLead
  extends Struct.CollectionTypeSchema {
  collectionName: 'public_interest_leads';
  info: {
    description: 'Public-site register-interest or enquiry submission before full account creation.';
    displayName: 'Public Interest Lead';
    pluralName: 'public-interest-leads';
    singularName: 'public-interest-lead';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    candidateStatus: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 120;
      }>;
    company: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 160;
      }>;
    consentCapturedAt: Schema.Attribute.DateTime;
    consentState: Schema.Attribute.Enumeration<
      [
        'not_requested',
        'operational_only',
        'marketing_opted_in',
        'marketing_withdrawn',
      ]
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'not_requested'>;
    consentWordingVersion: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 80;
      }>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    email: Schema.Attribute.Email &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 254;
      }>;
    employerInterviewCapacity: Schema.Attribute.Integer &
      Schema.Attribute.SetMinMax<
        {
          max: 1000;
          min: 0;
        },
        number
      >;
    enquiryLawfulBasis: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 120;
      }>;
    leadType: Schema.Attribute.Enumeration<
      [
        'candidate_interest',
        'employer_enquiry',
        'unsupported_region_sector',
        'other',
      ]
    > &
      Schema.Attribute.Required;
    linkedCandidate: Schema.Attribute.Relation<
      'manyToOne',
      'api::candidate.candidate'
    >;
    linkedEmployer: Schema.Attribute.Relation<
      'manyToOne',
      'api::employer.employer'
    >;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::public-interest-lead.public-interest-lead'
    > &
      Schema.Attribute.Private;
    mailingPlatformContactId: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 160;
      }>;
    mailingPlatformListId: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 160;
      }>;
    mailingPlatformProvider: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 80;
      }>;
    marketingChannels: Schema.Attribute.JSON;
    marketingLawfulBasis: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 120;
      }>;
    metadata: Schema.Attribute.JSON;
    name: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 120;
      }>;
    privacyNoticeVersion: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 80;
      }>;
    publishedAt: Schema.Attribute.DateTime;
    region: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 120;
      }>;
    sector: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 120;
      }>;
    sourceForm: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 80;
      }>;
    suppressionStatus: Schema.Attribute.Enumeration<
      ['not_suppressed', 'suppressed', 'deleted', 'anonymised']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'not_suppressed'>;
    syncError: Schema.Attribute.Text;
    syncStatus: Schema.Attribute.Enumeration<
      ['not_required', 'pending', 'synced', 'failed']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'not_required'>;
    unsubscribedAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiRefundRefund extends Struct.CollectionTypeSchema {
  collectionName: 'refunds';
  info: {
    description: 'Internal refund state linked to guarantee and payment workflows.';
    displayName: 'Refund';
    pluralName: 'refunds';
    singularName: 'refund';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    amountPence: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      >;
    approvedAt: Schema.Attribute.DateTime;
    candidate: Schema.Attribute.Relation<
      'manyToOne',
      'api::candidate.candidate'
    >;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    currency: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 3;
        minLength: 3;
      }> &
      Schema.Attribute.DefaultTo<'GBP'>;
    eligibilitySource: Schema.Attribute.Enumeration<
      [
        'interview_guarantee',
        'admin_override',
        'candidate_request',
        'payment_error',
        'other',
      ]
    >;
    enrollment: Schema.Attribute.Relation<
      'manyToOne',
      'api::enrollment.enrollment'
    >;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::refund.refund'
    > &
      Schema.Attribute.Private;
    metadata: Schema.Attribute.JSON;
    payment: Schema.Attribute.Relation<'manyToOne', 'api::payment.payment'>;
    paymentProvider: Schema.Attribute.Enumeration<['stripe']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'stripe'>;
    processedAt: Schema.Attribute.DateTime;
    providerRefundId: Schema.Attribute.String &
      Schema.Attribute.Unique &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 255;
      }>;
    publishedAt: Schema.Attribute.DateTime;
    qualifyingInterviewsDeliveredCount: Schema.Attribute.Integer &
      Schema.Attribute.SetMinMax<
        {
          max: 1000;
          min: 0;
        },
        number
      >;
    reason: Schema.Attribute.Text;
    refundPercentage: Schema.Attribute.Decimal &
      Schema.Attribute.SetMinMax<
        {
          max: 100;
          min: 0;
        },
        number
      >;
    refundState: Schema.Attribute.Enumeration<
      [
        'draft',
        'requested',
        'approved',
        'rejected',
        'submitted_to_provider',
        'processing',
        'completed',
        'failed',
        'cancelled',
      ]
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'draft'>;
    requestedAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiReservationReservation extends Struct.CollectionTypeSchema {
  collectionName: 'reservations';
  info: {
    description: 'Timed attempts to reserve a class place before payment is completed.';
    displayName: 'Reservation';
    pluralName: 'reservations';
    singularName: 'reservation';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    acceptedTermsPolicyDocument: Schema.Attribute.Relation<
      'manyToOne',
      'api::policy-document.policy-document'
    >;
    amountPence: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      >;
    cancelledAt: Schema.Attribute.DateTime;
    candidate: Schema.Attribute.Relation<
      'manyToOne',
      'api::candidate.candidate'
    >;
    class: Schema.Attribute.Relation<'manyToOne', 'api::class.class'>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    currency: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 3;
        minLength: 3;
      }> &
      Schema.Attribute.DefaultTo<'GBP'>;
    enrollment: Schema.Attribute.Relation<
      'manyToOne',
      'api::enrollment.enrollment'
    >;
    expiredAt: Schema.Attribute.DateTime;
    expiresAt: Schema.Attribute.DateTime & Schema.Attribute.Required;
    idempotencyKey: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 160;
      }>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::reservation.reservation'
    > &
      Schema.Attribute.Private;
    metadata: Schema.Attribute.JSON;
    paidAt: Schema.Attribute.DateTime;
    publishedAt: Schema.Attribute.DateTime;
    reservationStartedAt: Schema.Attribute.DateTime & Schema.Attribute.Required;
    reservationState: Schema.Attribute.Enumeration<
      [
        'active',
        'cancelled',
        'expired',
        'payment_exception',
        'paid',
        'released',
      ]
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'active'>;
    source: Schema.Attribute.Enumeration<
      ['candidate_dashboard', 'waiting_list_offer', 'admin']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'candidate_dashboard'>;
    termsAcceptedAt: Schema.Attribute.DateTime;
    termsVersion: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 120;
      }>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiStoredFileStoredFile extends Struct.CollectionTypeSchema {
  collectionName: 'stored_files';
  info: {
    description: 'Metadata for files stored outside the database.';
    displayName: 'Stored File';
    pluralName: 'stored-files';
    singularName: 'stored-file';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    bucket: Schema.Attribute.String;
    checksum: Schema.Attribute.String;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    deletedAt: Schema.Attribute.DateTime;
    fileState: Schema.Attribute.Enumeration<
      ['pending', 'uploaded', 'generated', 'deleted', 'quarantined']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'pending'>;
    generatedByService: Schema.Attribute.String;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::stored-file.stored-file'
    > &
      Schema.Attribute.Private;
    metadata: Schema.Attribute.JSON;
    mimeType: Schema.Attribute.String;
    objectKey: Schema.Attribute.String & Schema.Attribute.Required;
    originalFilename: Schema.Attribute.String;
    ownerId: Schema.Attribute.String;
    ownerType: Schema.Attribute.Enumeration<
      [
        'candidate',
        'employer_contact',
        'recruiter',
        'admin',
        'service',
        'system',
      ]
    >;
    provider: Schema.Attribute.Enumeration<['s3', 'local', 'cloudinary']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'s3'>;
    publishedAt: Schema.Attribute.DateTime;
    purpose: Schema.Attribute.Enumeration<
      [
        'course_material',
        'generated_cv_pdf',
        'candidate_activity_report',
        'privacy_export',
        'assessment_appeal_attachment',
        'dispute_attachment',
        'admin_attachment',
        'other',
      ]
    > &
      Schema.Attribute.Required;
    relatedId: Schema.Attribute.String;
    relatedType: Schema.Attribute.String;
    retentionState: Schema.Attribute.Enumeration<
      ['active', 'retention_hold', 'delete_requested', 'deleted', 'anonymised']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'active'>;
    sizeBytes: Schema.Attribute.BigInteger;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    uploadedAt: Schema.Attribute.DateTime;
    uploadedById: Schema.Attribute.String;
    uploadedByType: Schema.Attribute.Enumeration<
      [
        'candidate',
        'employer_contact',
        'recruiter',
        'admin',
        'service',
        'system',
      ]
    >;
    versionId: Schema.Attribute.String;
    visibility: Schema.Attribute.Enumeration<
      ['private', 'internal', 'public']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'private'>;
  };
}

export interface ApiSupportCaseSupportCase extends Struct.CollectionTypeSchema {
  collectionName: 'support_cases';
  info: {
    description: 'Reusable support/ticket case for candidate, refund, payment, and admin workflows.';
    displayName: 'Support Case';
    pluralName: 'support-cases';
    singularName: 'support-case';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    assignedAt: Schema.Attribute.DateTime;
    candidate: Schema.Attribute.Relation<
      'manyToOne',
      'api::candidate.candidate'
    >;
    caseKey: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 180;
      }>;
    caseState: Schema.Attribute.Enumeration<
      [
        'open',
        'awaiting_candidate',
        'awaiting_staff',
        'in_progress',
        'resolved',
        'closed',
      ]
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'open'>;
    caseType: Schema.Attribute.Enumeration<
      [
        'general',
        'refund',
        'payment',
        'course',
        'interview',
        'account',
        'privacy',
        'other',
      ]
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'general'>;
    closedAt: Schema.Attribute.DateTime;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    enrollment: Schema.Attribute.Relation<
      'manyToOne',
      'api::enrollment.enrollment'
    >;
    lastMessageAt: Schema.Attribute.DateTime;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::support-case.support-case'
    > &
      Schema.Attribute.Private;
    metadata: Schema.Attribute.JSON;
    openedAt: Schema.Attribute.DateTime;
    openedByDisplayName: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 240;
      }>;
    openedByEmail: Schema.Attribute.Email &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 254;
      }>;
    openedByStaffUserId: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 160;
      }>;
    openedByType: Schema.Attribute.Enumeration<
      ['candidate', 'admin', 'service', 'system']
    > &
      Schema.Attribute.DefaultTo<'system'>;
    ownerRoleKey: Schema.Attribute.Enumeration<
      ['admin', 'sales', 'super_admin', 'support']
    >;
    ownerStaffDisplayName: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 240;
      }>;
    ownerStaffEmail: Schema.Attribute.Email &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 254;
      }>;
    ownerStaffUserId: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 160;
      }>;
    payment: Schema.Attribute.Relation<'manyToOne', 'api::payment.payment'>;
    priority: Schema.Attribute.Enumeration<
      ['low', 'normal', 'high', 'urgent']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'normal'>;
    publishedAt: Schema.Attribute.DateTime;
    refund: Schema.Attribute.Relation<'manyToOne', 'api::refund.refund'>;
    resolvedAt: Schema.Attribute.DateTime;
    source: Schema.Attribute.Enumeration<
      [
        'candidate_dashboard',
        'admin_dashboard',
        'payment_service',
        'notification_service',
        'core_api',
        'system',
        'other',
      ]
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'core_api'>;
    summary: Schema.Attribute.Text;
    title: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 180;
        minLength: 1;
      }>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiSupportMessageSupportMessage
  extends Struct.CollectionTypeSchema {
  collectionName: 'support_messages';
  info: {
    description: 'Messages, notes, and system updates attached to support cases.';
    displayName: 'Support Message';
    pluralName: 'support-messages';
    singularName: 'support-message';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    body: Schema.Attribute.Text & Schema.Attribute.Required;
    candidate: Schema.Attribute.Relation<
      'manyToOne',
      'api::candidate.candidate'
    >;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    deliveredAt: Schema.Attribute.DateTime;
    deliveryState: Schema.Attribute.Enumeration<
      ['not_required', 'queued', 'sent', 'delivered', 'failed']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'not_required'>;
    direction: Schema.Attribute.Enumeration<
      ['inbound', 'outbound', 'internal', 'system']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'system'>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::support-message.support-message'
    > &
      Schema.Attribute.Private;
    messageType: Schema.Attribute.Enumeration<
      [
        'candidate_message',
        'staff_reply',
        'staff_note',
        'system_update',
        'outbound_email',
        'refund_refusal',
        'refund_acceptance',
        'refund_provider_update',
      ]
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'system_update'>;
    metadata: Schema.Attribute.JSON;
    notificationEvent: Schema.Attribute.Relation<
      'manyToOne',
      'api::notification-event.notification-event'
    >;
    payment: Schema.Attribute.Relation<'manyToOne', 'api::payment.payment'>;
    publishedAt: Schema.Attribute.DateTime;
    refund: Schema.Attribute.Relation<'manyToOne', 'api::refund.refund'>;
    senderDisplayName: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 240;
      }>;
    senderEmail: Schema.Attribute.Email &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 254;
      }>;
    senderId: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 160;
      }>;
    senderType: Schema.Attribute.Enumeration<
      ['candidate', 'admin', 'service', 'system']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'system'>;
    sentAt: Schema.Attribute.DateTime;
    subject: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 180;
      }>;
    supportCase: Schema.Attribute.Relation<
      'manyToOne',
      'api::support-case.support-case'
    > &
      Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    visibility: Schema.Attribute.Enumeration<['public', 'internal']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'internal'>;
  };
}

export interface ApiUnlistedInterestUnlistedInterest
  extends Struct.CollectionTypeSchema {
  collectionName: 'unlisted_interests';
  info: {
    description: 'Candidate suggestions for class areas or work sectors that are not currently listed.';
    displayName: 'Unlisted Interest';
    pluralName: 'unlisted-interests';
    singularName: 'unlisted-interest';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    candidate: Schema.Attribute.Relation<
      'manyToOne',
      'api::candidate.candidate'
    >;
    candidateEmail: Schema.Attribute.Email &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 254;
      }>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    interestType: Schema.Attribute.Enumeration<['class_area', 'work_sector']> &
      Schema.Attribute.Required;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::unlisted-interest.unlisted-interest'
    > &
      Schema.Attribute.Private;
    metadata: Schema.Attribute.JSON;
    publishedAt: Schema.Attribute.DateTime;
    reviewState: Schema.Attribute.Enumeration<
      ['new', 'reviewed', 'planned', 'rejected', 'archived']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'new'>;
    source: Schema.Attribute.Enumeration<
      ['class_page', 'onboarding', 'settings']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'settings'>;
    suggestedValue: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 160;
        minLength: 1;
      }>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiWaitingListOfferWaitingListOffer
  extends Struct.CollectionTypeSchema {
  collectionName: 'waiting_list_offers';
  info: {
    description: 'Exclusive timed offers to waiting-list candidates when a class place may become available.';
    displayName: 'Waiting List Offer';
    pluralName: 'waiting-list-offers';
    singularName: 'waiting-list-offer';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    candidate: Schema.Attribute.Relation<
      'manyToOne',
      'api::candidate.candidate'
    >;
    claimedAt: Schema.Attribute.DateTime;
    class: Schema.Attribute.Relation<'manyToOne', 'api::class.class'>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    declinedAt: Schema.Attribute.DateTime;
    enrollment: Schema.Attribute.Relation<
      'manyToOne',
      'api::enrollment.enrollment'
    >;
    expiredAt: Schema.Attribute.DateTime;
    expiresAt: Schema.Attribute.DateTime & Schema.Attribute.Required;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::waiting-list-offer.waiting-list-offer'
    > &
      Schema.Attribute.Private;
    metadata: Schema.Attribute.JSON;
    offeredAt: Schema.Attribute.DateTime & Schema.Attribute.Required;
    offerState: Schema.Attribute.Enumeration<
      [
        'active',
        'claimed',
        'declined',
        'expired',
        'skipped_ineligible',
        'superseded',
      ]
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'active'>;
    publishedAt: Schema.Attribute.DateTime;
    reservation: Schema.Attribute.Relation<
      'oneToOne',
      'api::reservation.reservation'
    >;
    skippedAt: Schema.Attribute.DateTime;
    sourceTrigger: Schema.Attribute.Enumeration<
      [
        'expired_reservation',
        'cancelled_reservation',
        'enrolled_candidate_withdrawal',
        'admin_released_place',
        'payment_failure_after_expiry',
        'payment_exception_release',
        'admin_ineligibility_removal',
        'waiting_list_offer_declined',
        'waiting_list_offer_expired',
        'system_reconciliation',
      ]
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'system_reconciliation'>;
    supersededAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    waitingListJoinedAt: Schema.Attribute.DateTime;
    waitingListPositionAtOffer: Schema.Attribute.Integer &
      Schema.Attribute.SetMinMax<
        {
          min: 1;
        },
        number
      >;
  };
}

export interface ApiWorkSectorWorkSector extends Struct.CollectionTypeSchema {
  collectionName: 'work_sectors';
  info: {
    description: 'Work sectors candidates can select for HireFlip class and career interest.';
    displayName: 'Work Sector';
    pluralName: 'work-sectors';
    singularName: 'work-sector';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    classes: Schema.Attribute.Relation<'oneToMany', 'api::class.class'>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::work-sector.work-sector'
    > &
      Schema.Attribute.Private;
    name: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 120;
        minLength: 1;
      }>;
    notes: Schema.Attribute.Text;
    publishedAt: Schema.Attribute.DateTime;
    slug: Schema.Attribute.UID<'name'> & Schema.Attribute.Required;
    sortOrder: Schema.Attribute.Integer &
      Schema.Attribute.SetMinMax<
        {
          max: 10000;
          min: 0;
        },
        number
      > &
      Schema.Attribute.DefaultTo<100>;
    state: Schema.Attribute.Enumeration<
      ['active', 'coming_soon', 'hidden', 'archived']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'active'>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface PluginContentReleasesRelease
  extends Struct.CollectionTypeSchema {
  collectionName: 'strapi_releases';
  info: {
    displayName: 'Release';
    pluralName: 'releases';
    singularName: 'release';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    actions: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::content-releases.release-action'
    >;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::content-releases.release'
    > &
      Schema.Attribute.Private;
    name: Schema.Attribute.String & Schema.Attribute.Required;
    publishedAt: Schema.Attribute.DateTime;
    releasedAt: Schema.Attribute.DateTime;
    scheduledAt: Schema.Attribute.DateTime;
    status: Schema.Attribute.Enumeration<
      ['ready', 'blocked', 'failed', 'done', 'empty']
    > &
      Schema.Attribute.Required;
    timezone: Schema.Attribute.String;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface PluginContentReleasesReleaseAction
  extends Struct.CollectionTypeSchema {
  collectionName: 'strapi_release_actions';
  info: {
    displayName: 'Release Action';
    pluralName: 'release-actions';
    singularName: 'release-action';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    contentType: Schema.Attribute.String & Schema.Attribute.Required;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    entryDocumentId: Schema.Attribute.String;
    isEntryValid: Schema.Attribute.Boolean;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::content-releases.release-action'
    > &
      Schema.Attribute.Private;
    publishedAt: Schema.Attribute.DateTime;
    release: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::content-releases.release'
    >;
    type: Schema.Attribute.Enumeration<['publish', 'unpublish']> &
      Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface PluginI18NLocale extends Struct.CollectionTypeSchema {
  collectionName: 'i18n_locale';
  info: {
    collectionName: 'locales';
    description: '';
    displayName: 'Locale';
    pluralName: 'locales';
    singularName: 'locale';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    code: Schema.Attribute.String & Schema.Attribute.Unique;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::i18n.locale'
    > &
      Schema.Attribute.Private;
    name: Schema.Attribute.String &
      Schema.Attribute.SetMinMax<
        {
          max: 50;
          min: 1;
        },
        number
      >;
    publishedAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface PluginReviewWorkflowsWorkflow
  extends Struct.CollectionTypeSchema {
  collectionName: 'strapi_workflows';
  info: {
    description: '';
    displayName: 'Workflow';
    name: 'Workflow';
    pluralName: 'workflows';
    singularName: 'workflow';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    contentTypes: Schema.Attribute.JSON &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'[]'>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::review-workflows.workflow'
    > &
      Schema.Attribute.Private;
    name: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique;
    publishedAt: Schema.Attribute.DateTime;
    stageRequiredToPublish: Schema.Attribute.Relation<
      'oneToOne',
      'plugin::review-workflows.workflow-stage'
    >;
    stages: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::review-workflows.workflow-stage'
    >;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface PluginReviewWorkflowsWorkflowStage
  extends Struct.CollectionTypeSchema {
  collectionName: 'strapi_workflows_stages';
  info: {
    description: '';
    displayName: 'Stages';
    name: 'Workflow Stage';
    pluralName: 'workflow-stages';
    singularName: 'workflow-stage';
  };
  options: {
    draftAndPublish: false;
    version: '1.1.0';
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    color: Schema.Attribute.String & Schema.Attribute.DefaultTo<'#4945FF'>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::review-workflows.workflow-stage'
    > &
      Schema.Attribute.Private;
    name: Schema.Attribute.String;
    permissions: Schema.Attribute.Relation<'manyToMany', 'admin::permission'>;
    publishedAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    workflow: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::review-workflows.workflow'
    >;
  };
}

export interface PluginUploadFile extends Struct.CollectionTypeSchema {
  collectionName: 'files';
  info: {
    description: '';
    displayName: 'File';
    pluralName: 'files';
    singularName: 'file';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    alternativeText: Schema.Attribute.Text;
    caption: Schema.Attribute.Text;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    ext: Schema.Attribute.String;
    focalPoint: Schema.Attribute.JSON;
    folder: Schema.Attribute.Relation<'manyToOne', 'plugin::upload.folder'> &
      Schema.Attribute.Private;
    folderPath: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Private &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    formats: Schema.Attribute.JSON;
    hash: Schema.Attribute.String & Schema.Attribute.Required;
    height: Schema.Attribute.Integer;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::upload.file'
    > &
      Schema.Attribute.Private;
    mime: Schema.Attribute.String & Schema.Attribute.Required;
    name: Schema.Attribute.String & Schema.Attribute.Required;
    previewUrl: Schema.Attribute.Text;
    provider: Schema.Attribute.String & Schema.Attribute.Required;
    provider_metadata: Schema.Attribute.JSON;
    publishedAt: Schema.Attribute.DateTime;
    related: Schema.Attribute.Relation<'morphToMany'>;
    size: Schema.Attribute.Decimal & Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    url: Schema.Attribute.Text & Schema.Attribute.Required;
    width: Schema.Attribute.Integer;
  };
}

export interface PluginUploadFolder extends Struct.CollectionTypeSchema {
  collectionName: 'upload_folders';
  info: {
    displayName: 'Folder';
    pluralName: 'folders';
    singularName: 'folder';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    children: Schema.Attribute.Relation<'oneToMany', 'plugin::upload.folder'>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    files: Schema.Attribute.Relation<'oneToMany', 'plugin::upload.file'>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::upload.folder'
    > &
      Schema.Attribute.Private;
    name: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    parent: Schema.Attribute.Relation<'manyToOne', 'plugin::upload.folder'>;
    path: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    pathId: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.Unique;
    publishedAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface PluginUsersPermissionsPermission
  extends Struct.CollectionTypeSchema {
  collectionName: 'up_permissions';
  info: {
    description: '';
    displayName: 'Permission';
    name: 'permission';
    pluralName: 'permissions';
    singularName: 'permission';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    action: Schema.Attribute.String & Schema.Attribute.Required;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::users-permissions.permission'
    > &
      Schema.Attribute.Private;
    publishedAt: Schema.Attribute.DateTime;
    role: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::users-permissions.role'
    >;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface PluginUsersPermissionsRole
  extends Struct.CollectionTypeSchema {
  collectionName: 'up_roles';
  info: {
    description: '';
    displayName: 'Role';
    name: 'role';
    pluralName: 'roles';
    singularName: 'role';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    description: Schema.Attribute.String;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::users-permissions.role'
    > &
      Schema.Attribute.Private;
    name: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 3;
      }>;
    permissions: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::users-permissions.permission'
    >;
    publishedAt: Schema.Attribute.DateTime;
    type: Schema.Attribute.String & Schema.Attribute.Unique;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    users: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::users-permissions.user'
    >;
  };
}

export interface PluginUsersPermissionsUser
  extends Struct.CollectionTypeSchema {
  collectionName: 'up_users';
  info: {
    description: '';
    displayName: 'User';
    name: 'user';
    pluralName: 'users';
    singularName: 'user';
  };
  options: {
    draftAndPublish: false;
    timestamps: true;
  };
  attributes: {
    blocked: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    confirmationToken: Schema.Attribute.String & Schema.Attribute.Private;
    confirmed: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    email: Schema.Attribute.Email &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 6;
      }>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::users-permissions.user'
    > &
      Schema.Attribute.Private;
    password: Schema.Attribute.Password &
      Schema.Attribute.Private &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 6;
      }>;
    provider: Schema.Attribute.String;
    publishedAt: Schema.Attribute.DateTime;
    resetPasswordToken: Schema.Attribute.String & Schema.Attribute.Private;
    role: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::users-permissions.role'
    >;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    username: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 3;
      }>;
  };
}

declare module '@strapi/strapi' {
  export module Public {
    export interface ContentTypeSchemas {
      'admin::api-token': AdminApiToken;
      'admin::api-token-permission': AdminApiTokenPermission;
      'admin::permission': AdminPermission;
      'admin::role': AdminRole;
      'admin::session': AdminSession;
      'admin::transfer-token': AdminTransferToken;
      'admin::transfer-token-permission': AdminTransferTokenPermission;
      'admin::user': AdminUser;
      'api::admin-review-claim.admin-review-claim': ApiAdminReviewClaimAdminReviewClaim;
      'api::admin-task.admin-task': ApiAdminTaskAdminTask;
      'api::assessment-appeal.assessment-appeal': ApiAssessmentAppealAssessmentAppeal;
      'api::audit-event.audit-event': ApiAuditEventAuditEvent;
      'api::candidate-interview-strike.candidate-interview-strike': ApiCandidateInterviewStrikeCandidateInterviewStrike;
      'api::candidate-profile.candidate-profile': ApiCandidateProfileCandidateProfile;
      'api::candidate.candidate': ApiCandidateCandidate;
      'api::class-announcement.class-announcement': ApiClassAnnouncementClassAnnouncement;
      'api::class-area.class-area': ApiClassAreaClassArea;
      'api::class.class': ApiClassClass;
      'api::course-answer-submission.course-answer-submission': ApiCourseAnswerSubmissionCourseAnswerSubmission;
      'api::course-material.course-material': ApiCourseMaterialCourseMaterial;
      'api::course-module-result.course-module-result': ApiCourseModuleResultCourseModuleResult;
      'api::course-module.course-module': ApiCourseModuleCourseModule;
      'api::course-progress.course-progress': ApiCourseProgressCourseProgress;
      'api::course-question.course-question': ApiCourseQuestionCourseQuestion;
      'api::course-result.course-result': ApiCourseResultCourseResult;
      'api::course-section-result.course-section-result': ApiCourseSectionResultCourseSectionResult;
      'api::course-section.course-section': ApiCourseSectionCourseSection;
      'api::course-test-attempt.course-test-attempt': ApiCourseTestAttemptCourseTestAttempt;
      'api::course-test-result.course-test-result': ApiCourseTestResultCourseTestResult;
      'api::course-test.course-test': ApiCourseTestCourseTest;
      'api::course.course': ApiCourseCourse;
      'api::employer-capacity-change-request.employer-capacity-change-request': ApiEmployerCapacityChangeRequestEmployerCapacityChangeRequest;
      'api::employer-contact.employer-contact': ApiEmployerContactEmployerContact;
      'api::employer-invite.employer-invite': ApiEmployerInviteEmployerInvite;
      'api::employer.employer': ApiEmployerEmployer;
      'api::enrollment.enrollment': ApiEnrollmentEnrollment;
      'api::interview-feedback.interview-feedback': ApiInterviewFeedbackInterviewFeedback;
      'api::interview-slot-offer.interview-slot-offer': ApiInterviewSlotOfferInterviewSlotOffer;
      'api::interview-slot.interview-slot': ApiInterviewSlotInterviewSlot;
      'api::interview.interview': ApiInterviewInterview;
      'api::notification-event.notification-event': ApiNotificationEventNotificationEvent;
      'api::offer.offer': ApiOfferOffer;
      'api::payment-webhook-event.payment-webhook-event': ApiPaymentWebhookEventPaymentWebhookEvent;
      'api::payment.payment': ApiPaymentPayment;
      'api::policy-document.policy-document': ApiPolicyDocumentPolicyDocument;
      'api::privacy-rights-request.privacy-rights-request': ApiPrivacyRightsRequestPrivacyRightsRequest;
      'api::public-interest-lead.public-interest-lead': ApiPublicInterestLeadPublicInterestLead;
      'api::refund.refund': ApiRefundRefund;
      'api::reservation.reservation': ApiReservationReservation;
      'api::stored-file.stored-file': ApiStoredFileStoredFile;
      'api::support-case.support-case': ApiSupportCaseSupportCase;
      'api::support-message.support-message': ApiSupportMessageSupportMessage;
      'api::unlisted-interest.unlisted-interest': ApiUnlistedInterestUnlistedInterest;
      'api::waiting-list-offer.waiting-list-offer': ApiWaitingListOfferWaitingListOffer;
      'api::work-sector.work-sector': ApiWorkSectorWorkSector;
      'plugin::content-releases.release': PluginContentReleasesRelease;
      'plugin::content-releases.release-action': PluginContentReleasesReleaseAction;
      'plugin::i18n.locale': PluginI18NLocale;
      'plugin::review-workflows.workflow': PluginReviewWorkflowsWorkflow;
      'plugin::review-workflows.workflow-stage': PluginReviewWorkflowsWorkflowStage;
      'plugin::upload.file': PluginUploadFile;
      'plugin::upload.folder': PluginUploadFolder;
      'plugin::users-permissions.permission': PluginUsersPermissionsPermission;
      'plugin::users-permissions.role': PluginUsersPermissionsRole;
      'plugin::users-permissions.user': PluginUsersPermissionsUser;
    }
  }
}

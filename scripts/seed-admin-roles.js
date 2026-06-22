#!/usr/bin/env node

const { compileStrapi, createStrapi } = require('@strapi/strapi');

process.env.CLASS_WORKFLOW_BOOTSTRAP_ENABLED = 'false';

const roleDefinitions = [
  {
    code: 'hireflip-admin',
    description:
      'HireFlip day-to-day operations role for the custom admin dashboard. Native Strapi permissions should stay minimal unless explicitly required.',
    name: 'Admin',
  },
  {
    code: 'hireflip-sales',
    description:
      'HireFlip employer and client-services role for the custom admin dashboard. Access is constrained by custom admin API permissions.',
    name: 'Sales',
  },
  {
    code: 'hireflip-support',
    description:
      'HireFlip support role for the custom admin dashboard. Access is constrained by custom admin API permissions.',
    name: 'Support',
  },
];

const retiredDefaultRoles = [
  {
    code: 'strapi-editor',
    name: 'Editor',
  },
  {
    code: 'strapi-author',
    name: 'Author',
  },
];

const findExistingRole = async (roleService, definition) => {
  const byCode = await roleService.findOne({ code: definition.code });

  if (byCode) {
    return byCode;
  }

  return roleService.findOne({ name: definition.name });
};

const upsertRole = async (roleService, definition) => {
  const existingRole = await findExistingRole(roleService, definition);

  if (!existingRole) {
    const createdRole = await roleService.create(definition);

    return {
      code: createdRole.code,
      id: createdRole.id,
      name: createdRole.name,
      status: 'created',
    };
  }

  const nextData = {};

  if (existingRole.name !== definition.name) {
    nextData.name = definition.name;
  }

  if (existingRole.description !== definition.description) {
    nextData.description = definition.description;
  }

  const updatedRole =
    Object.keys(nextData).length > 0
      ? await roleService.update({ id: existingRole.id }, nextData)
      : existingRole;

  return {
    code: updatedRole.code,
    expectedCode: definition.code,
    id: updatedRole.id,
    name: updatedRole.name,
    status: Object.keys(nextData).length > 0 ? 'updated' : 'unchanged',
  };
};

const removeRetiredDefaultRole = async (roleService, definition) => {
  const existingRole =
    (await roleService.findOne({ code: definition.code })) ||
    (await roleService.findOne({ name: definition.name }));

  if (!existingRole) {
    return {
      code: definition.code,
      name: definition.name,
      status: 'absent',
    };
  }

  const usersCount = await roleService.getUsersCount(existingRole.id);

  if (usersCount > 0) {
    return {
      code: existingRole.code,
      id: existingRole.id,
      name: existingRole.name,
      status: 'skipped_assigned_users',
      usersCount,
    };
  }

  await roleService.deleteByIds([existingRole.id]);

  return {
    code: existingRole.code,
    id: existingRole.id,
    name: existingRole.name,
    status: 'deleted',
  };
};

const main = async () => {
  const appContext = await compileStrapi();
  const strapi = await createStrapi(appContext).load();

  try {
    const roleService = strapi.service('admin::role');
    const superAdminRole = await roleService.getSuperAdmin();
    const summary = [];
    const retiredSummary = [];

    for (const definition of roleDefinitions) {
      summary.push(await upsertRole(roleService, definition));
    }

    for (const definition of retiredDefaultRoles) {
      retiredSummary.push(await removeRetiredDefaultRole(roleService, definition));
    }

    strapi.log.info(
      `Seeded HireFlip admin roles: ${JSON.stringify({
        customRoles: summary,
        retiredDefaultRoles: retiredSummary,
        superAdminRole: superAdminRole ? 'present' : 'missing',
      })}`
    );
  } finally {
    await strapi.destroy();
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

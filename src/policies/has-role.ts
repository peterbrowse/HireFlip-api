type HasRoleConfig = {
  roles?: string[];
  mode?: 'any' | 'all';
};

const normalizeRoles = (roles: unknown) => (Array.isArray(roles) ? roles.filter((role) => typeof role === 'string') : []);

export default (ctx, config: HasRoleConfig = {}) => {
  const requiredRoles = normalizeRoles(config.roles);

  if (requiredRoles.length === 0) {
    return false;
  }

  const userRoles = normalizeRoles(ctx.state?.hireflipAuth?.roles);

  if (config.mode === 'all') {
    return requiredRoles.every((role) => userRoles.includes(role));
  }

  return requiredRoles.some((role) => userRoles.includes(role));
};

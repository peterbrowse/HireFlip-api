import type { PolicyContext } from "@strapi/strapi";

type PolicyConfig = {
  roles?: string[];
};

export default (
  policyContext: PolicyContext,
  config: PolicyConfig = {}
) => {
  const allowedRoles = config.roles || [];
  const userRoles =
    (policyContext.state as any)?.auth?.roles ||
    (policyContext.state as any)?.user?.roles ||
    [];

  if (allowedRoles.length === 0) {
    return true;
  }

  const hasMatch = Array.isArray(userRoles)
    ? userRoles.some((role) => allowedRoles.includes(role))
    : false;

  if (!hasMatch) {
    return policyContext.forbidden("You do not have access to this resource");
  }

  return true;
};

import { factories } from "@strapi/strapi";

export default factories.createCoreRouter("api::employer.employer", {
  config: {
    find: {
      policies: ["global::has-role"],
      config: {
        roles: ["admin"],
      },
    },
    findOne: {
      policies: ["global::has-role"],
      config: {
        roles: ["admin"],
      },
    },
    create: {
      policies: ["global::has-role"],
      config: {
        roles: ["admin"],
      },
    },
    update: {
      policies: ["global::has-role"],
      config: {
        roles: ["admin"],
      },
    },
    delete: {
      policies: ["global::has-role"],
      config: {
        roles: ["admin"],
      },
    },
  },
});

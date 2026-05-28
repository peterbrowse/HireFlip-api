import { factories } from "@strapi/strapi";

export default factories.createCoreRouter("api::course-module.course-module", {
  config: {
    find: {
      policies: ["global::has-role"],
      config: {
        roles: ["admin", "candidate"],
      },
    },
    findOne: {
      policies: ["global::has-role"],
      config: {
        roles: ["admin", "candidate"],
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

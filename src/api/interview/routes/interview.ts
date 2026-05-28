import { factories } from "@strapi/strapi";

export default factories.createCoreRouter("api::interview.interview", {
  config: {
    find: {
      policies: ["global::has-role"],
      config: {
        roles: ["admin", "employer", "candidate"],
      },
    },
    findOne: {
      policies: ["global::has-role"],
      config: {
        roles: ["admin", "employer", "candidate"],
      },
    },
    create: {
      policies: ["global::has-role"],
      config: {
        roles: ["admin", "employer"],
      },
    },
    update: {
      policies: ["global::has-role"],
      config: {
        roles: ["admin", "employer"],
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

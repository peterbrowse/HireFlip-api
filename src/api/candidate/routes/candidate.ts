import { factories } from "@strapi/strapi";

export default factories.createCoreRouter("api::candidate.candidate", {
  config: {
    find: {
      policies: ["global::has-role"],
      middlewares: [],
      config: {
        roles: ["admin"],
      },
    },
    findOne: {
      policies: ["global::has-role"],
      middlewares: [],
      config: {
        roles: ["admin"],
      },
    },
    create: {
      policies: ["global::has-role"],
      middlewares: [],
      config: {
        roles: ["admin"],
      },
    },
    update: {
      policies: ["global::has-role"],
      middlewares: [],
      config: {
        roles: ["admin"],
      },
    },
    delete: {
      policies: ["global::has-role"],
      middlewares: [],
      config: {
        roles: ["admin"],
      },
    },
  },
});

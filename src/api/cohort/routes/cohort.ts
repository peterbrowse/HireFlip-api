import { factories } from "@strapi/strapi";

export default factories.createCoreRouter("api::cohort.cohort", {
  config: {
    find: {
      policies: ["global::has-role"],
      config: {
        roles: ["admin", "candidate", "employer", "recruiter"],
      },
    },
    findOne: {
      policies: ["global::has-role"],
      config: {
        roles: ["admin", "candidate", "employer", "recruiter"],
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

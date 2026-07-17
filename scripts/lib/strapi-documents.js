const findAllDocuments = async (strapi, uid, input = {}, pageSize = 100) => {
  const collection = strapi.documents(uid);
  const filters = input.filters || {};
  const total = typeof collection.count === 'function'
    ? await collection.count({ filters })
    : undefined;
  const records = [];
  const effectivePageSize = Math.max(Number(pageSize) || 100, 1);

  for (let start = 0; typeof total === 'number' ? start < total : true; start += effectivePageSize) {
    const page = await collection.findMany({
      ...input,
      limit: effectivePageSize,
      start,
    });

    records.push(...page);

    if (typeof total !== 'number' && page.length < effectivePageSize) {
      break;
    }
  }

  return records;
};

const documents = (strapi, uid) => {
  const collection = strapi.documents(uid);

  return {
    ...collection,
    findMany: async (input = {}) => {
      const requestedLimit = Number(input.limit || 0);

      if (requestedLimit === 1) {
        return collection.findMany(input);
      }

      const { limit, start, ...cursorInput } = input;
      return findAllDocuments(strapi, uid, cursorInput, Math.max(requestedLimit, 100));
    },
  };
};

module.exports = {
  documents,
  findAllDocuments,
};

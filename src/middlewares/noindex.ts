const robotsHeader = 'noindex, nofollow, noarchive';

export default () => {
  return async (ctx, next) => {
    ctx.set('X-Robots-Tag', robotsHeader);

    await next();

    ctx.set('X-Robots-Tag', robotsHeader);
  };
};

#!/usr/bin/env node

const path = require('node:path');
const { compileStrapi, createStrapi } = require('@strapi/strapi');
const sharp = require('sharp');

process.env.CLASS_WORKFLOW_BOOTSTRAP_ENABLED = 'false';

const allowedTargets = new Set(['authLogo', 'menuLogo']);
const allowedMimeTypes = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/svg+xml', '.svg'],
]);
const defaultLogoUrl = 'https://hireflip.work/auth0-logo.png';
const defaultLogoFilename = 'hireflip.png';
const maxLogoDimension = 750;
const maxLogoFileSize = 1024 * 1024;

const filenameReservedRegex = /[<>:"/\\|?*\u0000-\u001F]/;
const windowsReservedNameRegex = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

const assertValidFilename = (filename) => {
  if (
    !filename ||
    filename.length > 255 ||
    filenameReservedRegex.test(filename) ||
    windowsReservedNameRegex.test(filename) ||
    filename === '.' ||
    filename === '..'
  ) {
    throw new Error(`Invalid logo filename: ${filename}`);
  }
};

const parseTargets = () => {
  const rawTargets = process.env.STRAPI_PROJECT_LOGO_TARGETS || 'authLogo,menuLogo';
  const targets = rawTargets
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  if (!targets.length) {
    throw new Error('STRAPI_PROJECT_LOGO_TARGETS must include at least one target.');
  }

  for (const target of targets) {
    if (!allowedTargets.has(target)) {
      throw new Error(
        `Unsupported project logo target "${target}". Use one or both of: authLogo, menuLogo.`
      );
    }
  }

  return Array.from(new Set(targets));
};

const downloadLogo = async ({ logoUrl }) => {
  const response = await fetch(logoUrl);

  if (!response.ok) {
    throw new Error(`Logo download failed with ${response.status} ${response.statusText}.`);
  }

  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();

  if (!contentType || !allowedMimeTypes.has(contentType)) {
    throw new Error(`Unsupported logo content type: ${contentType || 'unknown'}.`);
  }

  const body = Buffer.from(await response.arrayBuffer());

  if (!body.length) {
    throw new Error('Logo download returned an empty response body.');
  }

  return {
    body,
    contentType,
  };
};

const bytesToKbytes = (bytes) => Math.round((bytes / 1000) * 100) / 100;

const buildLogoAsset = async ({ body, contentType, filename, logoUrl }) => {
  if (body.length > maxLogoFileSize) {
    throw new Error(`Logo file is too large: ${body.length} bytes.`);
  }

  const metadata = await sharp(body).metadata();
  const width = metadata.width || null;
  const height = metadata.height || null;

  if ((width && width > maxLogoDimension) || (height && height > maxLogoDimension)) {
    throw new Error(
      `Logo dimensions are too large: ${width || 'unknown'}x${height || 'unknown'}.`
    );
  }

  const expectedExtension = allowedMimeTypes.get(contentType);
  const filenameExtension = path.extname(filename).toLowerCase();

  if (filenameExtension && filenameExtension !== expectedExtension) {
    throw new Error(
      `Logo filename extension ${filenameExtension} does not match ${contentType}.`
    );
  }

  return {
    ext: filenameExtension || expectedExtension,
    height,
    name: filename,
    provider: 'external',
    size: bytesToKbytes(body.length),
    url: logoUrl,
    width,
  };
};

const getAdminProjectSettingsStore = (strapi) =>
  strapi.store({
    type: 'core',
    name: 'admin',
  });

const getProjectSettings = async (store) =>
  (await store.get({
    key: 'project-settings',
  })) || {};

const needsUpdate = (settings, targets, logoAsset) =>
  targets.some((target) => {
    const currentLogo = settings[target];

    return (
      currentLogo?.name !== logoAsset.name ||
      currentLogo?.url !== logoAsset.url ||
      currentLogo?.width !== logoAsset.width ||
      currentLogo?.height !== logoAsset.height ||
      currentLogo?.ext !== logoAsset.ext ||
      currentLogo?.size !== logoAsset.size ||
      currentLogo?.provider !== logoAsset.provider
    );
  });

const seedProjectLogos = async ({ logoAsset, settings, store, targets }) => {
  const nextSettings = {
    ...settings,
  };

  for (const target of targets) {
    nextSettings[target] = logoAsset;
  }

  await store.set({
    key: 'project-settings',
    value: nextSettings,
  });
};

const main = async () => {
  const logoUrl = process.env.STRAPI_PROJECT_LOGO_URL || defaultLogoUrl;
  const filename = process.env.STRAPI_PROJECT_LOGO_FILENAME || defaultLogoFilename;
  const targets = parseTargets();

  assertValidFilename(filename);

  const logoDownload = await downloadLogo({ logoUrl });
  const logoAsset = await buildLogoAsset({
    ...logoDownload,
    filename,
    logoUrl,
  });

  const appContext = await compileStrapi();
  const strapi = await createStrapi(appContext).load();

  try {
    const store = getAdminProjectSettingsStore(strapi);
    const currentSettings = await getProjectSettings(store);

    if (!needsUpdate(currentSettings, targets, logoAsset)) {
      strapi.log.info(
        `Seeded HireFlip project logos: ${JSON.stringify({
          filename,
          logoUrl,
          status: 'unchanged',
          targets,
        })}`
      );
      return;
    }

    await seedProjectLogos({
      logoAsset,
      settings: currentSettings,
      store,
      targets,
    });

    strapi.log.info(
      `Seeded HireFlip project logos: ${JSON.stringify({
        filename,
        logoUrl,
        status: 'updated',
        targets: targets.map((target) => ({
          target,
          name: logoAsset.name,
          url: logoAsset.url,
        })),
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

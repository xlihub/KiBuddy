const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { isDeepStrictEqual } = require('node:util');
const yaml = require('js-yaml');
const { readKiCorePin } = require('./kiCoreRelease');
const { resolveKiBuddyPackagingIdentity } = require('./kiBuddyPackagingIdentity');
const productExperienceRegistry = require('../../desktop/src/common/platform/ki-buddy/experience/registry.json');

const KI_BUDDY_PRODUCT = 'Ki-Buddy';
const KI_BUDDY_SOURCE_REPOSITORY = 'xlihub/KiBuddy';
const KI_BUDDY_HISTORICAL_PUBLIC_REPOSITORY = 'xlihub/Ki-Buddy';
const AION_UI_REPOSITORY = 'iOfficeAI/AionUi';
const PRODUCT_CONFIG_FILE = 'ki-buddy-product.json';
const PRODUCT_EXPERIENCE_REGISTRY_FILE = 'packages/desktop/src/common/platform/ki-buddy/experience/registry.json';
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const PACKAGE_VERSION_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const SHA40_PATTERN = /^[0-9a-f]{40}$/;
const PRODUCT_FEATURE_IDS = Object.keys(productExperienceRegistry.features);
const PRODUCT_RESOURCE_KINDS = Object.keys(productExperienceRegistry.resourceKinds);
const PRODUCT_RESOURCE_ORIGINS = Object.keys(productExperienceRegistry.resourceOrigins);
const PRODUCT_FEATURE_DEPENDENCIES = Object.entries(productExperienceRegistry.features).flatMap(
  ([featureId, definition]) => definition.dependsOn.map((parentId) => [featureId, parentId])
);

function requireExactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const actual = Object.keys(value).toSorted();
  const expected = keys.toSorted();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} has unexpected or missing fields`);
  }
}

function requireEnum(value, allowed, label) {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new Error(`${label} must be one of ${allowed.join(', ')}`);
  }
}

function validateProductExperiencePolicy(policy) {
  requireExactKeys(policy, ['schemaVersion', 'features', 'resources', 'behaviorDefaults'], 'Product experience policy');
  if (policy.schemaVersion !== 1) throw new Error('Unsupported product experience policy schema');

  requireExactKeys(policy.features, PRODUCT_FEATURE_IDS, 'Product experience features');
  for (const featureId of PRODUCT_FEATURE_IDS) {
    requireEnum(policy.features[featureId], ['enabled', 'disabled'], `Product feature ${featureId}`);
  }
  for (const [child, parent] of PRODUCT_FEATURE_DEPENDENCIES) {
    if (policy.features[child] === 'enabled' && policy.features[parent] !== 'enabled') {
      throw new Error(`Product feature ${child} requires enabled parent ${parent}`);
    }
  }
  for (const [featureId, definition] of Object.entries(productExperienceRegistry.features)) {
    if (definition.requiredState && policy.features[featureId] !== definition.requiredState) {
      throw new Error(`Product feature ${featureId} must be ${definition.requiredState}`);
    }
  }

  requireExactKeys(policy.resources, PRODUCT_RESOURCE_KINDS, 'Product experience resources');
  for (const kind of PRODUCT_RESOURCE_KINDS) {
    const access = policy.resources[kind];
    requireExactKeys(access, PRODUCT_RESOURCE_ORIGINS, `Product resource ${kind}`);
    for (const origin of PRODUCT_RESOURCE_ORIGINS) {
      requireEnum(access[origin], ['hidden', 'use', 'manage'], `Product resource ${kind}.${origin}`);
    }
  }

  requireExactKeys(
    policy.behaviorDefaults,
    ['scheduledTaskExecutor', 'autoInjectedSkillExclusions'],
    'Product experience behavior defaults'
  );
  requireEnum(
    policy.behaviorDefaults.scheduledTaskExecutor,
    ['assistant', 'assistant-or-team'],
    'Product scheduled task executor'
  );
  const exclusions = policy.behaviorDefaults.autoInjectedSkillExclusions;
  if (
    !Array.isArray(exclusions) ||
    exclusions.some((item) => typeof item !== 'string' || item.trim() === '') ||
    new Set(exclusions).size !== exclusions.length
  ) {
    throw new Error('Product auto-injected skill exclusions must contain unique non-empty strings');
  }
}

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read ${label}: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
}

function normalizeGitHubRepository(remoteUrl) {
  const value = String(remoteUrl || '').trim();
  const scpMatch = value.match(/^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/);
  if (scpMatch) return scpMatch[1];
  try {
    const url = new URL(value);
    if (url.hostname !== 'github.com') return null;
    return url.pathname.replace(/^\//, '').replace(/\.git$/, '') || null;
  } catch {
    return null;
  }
}

function readOriginRepository(projectRoot) {
  let remoteUrl;
  try {
    remoteUrl = execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    throw new Error('Cannot read the Ki-Buddy origin repository', { cause: error });
  }
  const repository = normalizeGitHubRepository(remoteUrl);
  if (!repository) throw new Error('Ki-Buddy origin must be a GitHub repository');
  return repository;
}

function requirePackageMetadataUrl(value, label, allowGitPrefix = false) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty URL`);
  }
  const urlValue = allowGitPrefix && value.startsWith('git+') ? value.slice(4) : value;
  try {
    const url = new URL(urlValue);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol');
  } catch {
    throw new Error(`${label} must be an absolute HTTP(S) URL`);
  }
}

function readProductVersion(projectRoot) {
  const version = fs.readFileSync(path.join(projectRoot, 'ki-buddy-version.txt'), 'utf8').trim();
  if (!SEMVER_PATTERN.test(version)) {
    throw new Error('ki-buddy-version.txt must contain one stable SemVer version');
  }
  return version;
}

function readProductConfig(projectRoot) {
  const config = readJson(path.join(projectRoot, PRODUCT_CONFIG_FILE), 'Ki-Buddy product configuration');
  requireExactKeys(
    config,
    [
      'schemaVersion',
      'runtimeIdentity',
      'source',
      'internalRelease',
      'publicDistribution',
      'defaults',
      'experience',
      'locale',
      'themes',
      'runtimeDependencies',
      'brand',
      'assets',
      'packageMetadata',
      'electronBuilder',
      'webCli',
      'updates',
      'kiCore',
    ],
    'Ki-Buddy product configuration'
  );
  if (config.schemaVersion !== 4) throw new Error('Unsupported Ki-Buddy product configuration schema');
  if (typeof config.runtimeIdentity !== 'string' || config.runtimeIdentity.trim() === '') {
    throw new Error('Ki-Buddy runtime identity must be a non-empty string');
  }
  requireExactKeys(config.source, ['repository', 'url'], 'Ki-Buddy source');
  if (
    config.source.repository !== KI_BUDDY_SOURCE_REPOSITORY ||
    config.source.url !== 'https://github.com/xlihub/KiBuddy'
  ) {
    throw new Error('Ki-Buddy source repository identity is invalid');
  }
  requireExactKeys(
    config.internalRelease,
    ['provider', 'repository', 'tagPrefix', 'releasePageUrl'],
    'Ki-Buddy internal release'
  );
  if (
    config.internalRelease.provider !== 'github' ||
    config.internalRelease.repository !== KI_BUDDY_SOURCE_REPOSITORY ||
    config.internalRelease.tagPrefix !== 'ki-buddy-v' ||
    config.internalRelease.releasePageUrl !== 'https://github.com/xlihub/KiBuddy/releases'
  ) {
    throw new Error('Ki-Buddy internal release identity is invalid');
  }
  requireExactKeys(
    config.publicDistribution,
    ['provider', 'repository', 'releasePageUrl'],
    'Ki-Buddy public distribution'
  );
  if (
    config.publicDistribution.provider !== 'github' ||
    config.publicDistribution.repository !== KI_BUDDY_HISTORICAL_PUBLIC_REPOSITORY ||
    config.publicDistribution.releasePageUrl !== 'https://github.com/xlihub/Ki-Buddy/releases'
  ) {
    throw new Error('Ki-Buddy public distribution identity is invalid');
  }
  requireExactKeys(config.defaults, ['agentsBaseUrl', 'language'], 'Ki-Buddy product defaults');
  if (typeof config.defaults.agentsBaseUrl !== 'string' || config.defaults.agentsBaseUrl.trim() === '') {
    throw new Error('Ki-Buddy default Agents base URL must be a non-empty string');
  }
  try {
    const agentsUrl = new URL(config.defaults.agentsBaseUrl);
    if (!['http:', 'https:'].includes(agentsUrl.protocol)) throw new Error('unsupported protocol');
  } catch {
    throw new Error('Ki-Buddy default Agents base URL must be an HTTP(S) URL');
  }
  if (typeof config.defaults.language !== 'string' || config.defaults.language.trim() === '') {
    throw new Error('Ki-Buddy default language must be a non-empty string');
  }
  validateProductExperiencePolicy(config.experience);
  requireExactKeys(config.locale, ['namespace'], 'Ki-Buddy locale');
  if (typeof config.locale.namespace !== 'string' || config.locale.namespace.trim() === '') {
    throw new Error('Ki-Buddy locale namespace must be a non-empty string');
  }
  requireExactKeys(config.themes, ['light', 'dark'], 'Ki-Buddy themes');
  for (const [appearance, resourceId] of Object.entries(config.themes)) {
    if (typeof resourceId !== 'string' || resourceId.trim() === '') {
      throw new Error(`Ki-Buddy ${appearance} theme must be a non-empty resource id`);
    }
  }
  if (
    !config.runtimeDependencies ||
    typeof config.runtimeDependencies !== 'object' ||
    Array.isArray(config.runtimeDependencies) ||
    Object.keys(config.runtimeDependencies).length === 0
  ) {
    throw new Error('Ki-Buddy runtime dependencies must be a non-empty object');
  }
  for (const [name, version] of Object.entries(config.runtimeDependencies)) {
    if (name.trim() === '' || typeof version !== 'string' || version.trim() === '') {
      throw new Error('Ki-Buddy runtime dependencies must use non-empty names and versions');
    }
  }
  requireExactKeys(config.brand, ['productName', 'shortName', 'cliName', 'description', 'links'], 'Ki-Buddy brand');
  for (const [brandField, value] of Object.entries(config.brand).filter(([field]) => field !== 'links')) {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`Ki-Buddy brand ${brandField} must be a non-empty string`);
    }
  }
  if (config.brand.productName !== KI_BUDDY_PRODUCT) {
    throw new Error('Ki-Buddy brand product name is invalid');
  }
  requireExactKeys(
    config.brand.links,
    ['homepage', 'repository', 'releases', 'support', 'feedback'],
    'Ki-Buddy brand links'
  );
  for (const [name, value] of Object.entries(config.brand.links)) {
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol');
    } catch {
      throw new Error(`Ki-Buddy brand link ${name} must be an absolute HTTP(S) URL`);
    }
  }
  if (
    config.brand.links.homepage !== config.source.url ||
    config.brand.links.repository !== config.source.url ||
    config.brand.links.releases !== config.publicDistribution.releasePageUrl ||
    config.brand.links.support !== `${config.source.url}/issues` ||
    config.brand.links.feedback !== `${config.source.url}/issues/new`
  ) {
    throw new Error('Ki-Buddy brand links do not match their configured sources');
  }
  requireExactKeys(config.assets, ['platform', 'packaged', 'renderer'], 'Ki-Buddy assets');
  requireExactKeys(config.assets.platform, ['png', 'ico', 'icns'], 'Ki-Buddy platform assets');
  requireExactKeys(config.assets.packaged, ['icon'], 'Ki-Buddy packaged assets');
  requireExactKeys(config.assets.renderer, ['logo', 'mascot'], 'Ki-Buddy renderer assets');
  for (const [name, value] of Object.entries(config.assets.platform)) {
    if (typeof value !== 'string' || !value.startsWith('resources/ki-buddy/')) {
      throw new Error(`Ki-Buddy platform asset ${name} must be product-owned`);
    }
  }
  for (const [name, value] of Object.entries(config.assets.renderer)) {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`Ki-Buddy renderer asset ${name} must be a non-empty resource id`);
    }
  }
  if (typeof config.assets.packaged.icon !== 'string' || config.assets.packaged.icon.trim() === '') {
    throw new Error('Ki-Buddy packaged icon must be a non-empty string');
  }
  requireExactKeys(
    config.packageMetadata,
    ['name', 'description', 'author', 'repository', 'homepage', 'bugs', 'productName'],
    'Ki-Buddy package metadata'
  );
  if (config.packageMetadata.name !== 'ki-buddy' || config.packageMetadata.productName !== KI_BUDDY_PRODUCT) {
    throw new Error('Ki-Buddy package metadata identity is invalid');
  }
  if (config.packageMetadata.description !== config.brand.description) {
    throw new Error('Ki-Buddy package metadata description must match the product brand');
  }
  requireExactKeys(config.packageMetadata.author, ['name'], 'Ki-Buddy package author');
  if (typeof config.packageMetadata.author.name !== 'string' || config.packageMetadata.author.name.trim() === '') {
    throw new Error('Ki-Buddy package author name must be a non-empty string');
  }
  requireExactKeys(config.packageMetadata.repository, ['type', 'url'], 'Ki-Buddy package repository');
  if (config.packageMetadata.repository.type !== 'git') {
    throw new Error('Ki-Buddy package repository type must be git');
  }
  requirePackageMetadataUrl(config.packageMetadata.repository.url, 'Ki-Buddy package repository URL', true);
  requirePackageMetadataUrl(config.packageMetadata.homepage, 'Ki-Buddy package homepage');
  requireExactKeys(config.packageMetadata.bugs, ['url'], 'Ki-Buddy package bugs');
  requirePackageMetadataUrl(config.packageMetadata.bugs.url, 'Ki-Buddy package bugs URL');
  if (
    config.packageMetadata.repository.url !== `git+${config.source.url}.git` ||
    config.packageMetadata.homepage !== `${config.source.url}#readme` ||
    config.packageMetadata.bugs.url !== `${config.source.url}/issues`
  ) {
    throw new Error('Ki-Buddy package metadata does not match the source repository');
  }
  if (config.runtimeIdentity !== config.packageMetadata.name) {
    throw new Error('Ki-Buddy runtime identity must match package metadata name');
  }
  requireExactKeys(
    config.electronBuilder,
    ['appId', 'productName', 'executableName', 'copyright', 'protocols', 'publish', 'linux'],
    'Ki-Buddy electron-builder configuration'
  );
  if (
    config.electronBuilder.appId !== 'com.xlihub.ki-buddy' ||
    config.electronBuilder.productName !== KI_BUDDY_PRODUCT ||
    config.electronBuilder.executableName !== KI_BUDDY_PRODUCT
  ) {
    throw new Error('Ki-Buddy desktop application identity is invalid');
  }
  if (!Array.isArray(config.electronBuilder.protocols) || config.electronBuilder.protocols.length !== 1) {
    throw new Error('Ki-Buddy protocol configuration must contain exactly one protocol');
  }
  const [protocol] = config.electronBuilder.protocols;
  requireExactKeys(protocol, ['name', 'schemes'], 'Ki-Buddy protocol configuration');
  if (protocol.name !== 'Ki-Buddy Protocol' || !Array.isArray(protocol.schemes)) {
    throw new Error('Ki-Buddy protocol configuration identity is invalid');
  }
  const schemes = config.electronBuilder.protocols?.flatMap((protocolEntry) => protocolEntry?.schemes || []);
  if (!Array.isArray(schemes) || JSON.stringify(schemes) !== JSON.stringify(['ki-buddy'])) {
    throw new Error('Ki-Buddy protocol configuration must contain only the independent product protocol');
  }
  requireExactKeys(
    config.electronBuilder.publish,
    ['provider', 'owner', 'repo', 'tagNamePrefix'],
    'Ki-Buddy electron-builder publish configuration'
  );
  if (
    config.electronBuilder.publish?.provider !== 'github' ||
    `${config.electronBuilder.publish?.owner}/${config.electronBuilder.publish?.repo}` !==
      config.internalRelease.repository ||
    config.electronBuilder.publish?.tagNamePrefix !== 'ki-buddy-v'
  ) {
    throw new Error('Ki-Buddy electron-builder publish identity is invalid');
  }
  requireExactKeys(config.electronBuilder.linux, ['maintainer', 'vendor', 'desktop'], 'Ki-Buddy Linux configuration');
  requireExactKeys(config.electronBuilder.linux.desktop, ['entry'], 'Ki-Buddy Linux desktop configuration');
  requireExactKeys(
    config.electronBuilder.linux.desktop.entry,
    ['Name', 'Comment', 'Icon', 'Categories', 'MimeType'],
    'Ki-Buddy Linux desktop entry'
  );
  const linuxEntry = config.electronBuilder.linux.desktop.entry;
  if (
    config.electronBuilder.linux.maintainer !== 'xlihub' ||
    config.electronBuilder.linux.vendor !== 'xlihub' ||
    linuxEntry.Name !== KI_BUDDY_PRODUCT ||
    linuxEntry.Comment !== '${description}' ||
    linuxEntry.Icon !== KI_BUDDY_PRODUCT ||
    linuxEntry.Categories !== 'Office;Utility;' ||
    linuxEntry.MimeType !== 'x-scheme-handler/ki-buddy;'
  ) {
    throw new Error('Ki-Buddy Linux desktop identity is invalid');
  }
  requireExactKeys(
    config.webCli,
    ['packageName', 'archiveName', 'bundleDirectory', 'executableName'],
    'Ki-Buddy web CLI configuration'
  );
  if (config.webCli.packageName !== 'ki-buddy-web' || config.webCli.archiveName !== 'ki-buddy-web') {
    throw new Error('Ki-Buddy web CLI identity is invalid');
  }
  requireExactKeys(
    config.updates,
    ['provider', 'repository', 'tagPrefix', 'releasePageUrl'],
    'Ki-Buddy update configuration'
  );
  if (
    config.updates.provider !== 'github' ||
    config.updates.repository !== KI_BUDDY_HISTORICAL_PUBLIC_REPOSITORY ||
    config.updates.tagPrefix !== 'ki-buddy-v' ||
    config.updates.releasePageUrl !== 'https://github.com/xlihub/Ki-Buddy/releases'
  ) {
    throw new Error('Ki-Buddy update configuration is invalid');
  }
  if (
    config.updates.provider !== config.publicDistribution.provider ||
    config.updates.repository !== config.publicDistribution.repository ||
    config.updates.releasePageUrl !== config.publicDistribution.releasePageUrl
  ) {
    throw new Error('Ki-Buddy runtime update source must match the current public distribution source');
  }
  return config;
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function createSourceStateSha256(projectRoot) {
  const hash = crypto.createHash('sha256');
  hash.update(
    execFileSync('git', ['diff', '--binary', 'HEAD', '--'], {
      cwd: projectRoot,
      encoding: 'buffer',
      maxBuffer: 100 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  );
  const untrackedFiles = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], {
    cwd: projectRoot,
    encoding: 'buffer',
    maxBuffer: 100 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .toSorted();
  for (const relativePath of untrackedFiles) {
    hash.update(`untracked\0${relativePath}\0`);
    const filePath = path.join(projectRoot, relativePath);
    const stats = fs.lstatSync(filePath);
    hash.update(stats.isSymbolicLink() ? fs.readlinkSync(filePath) : fs.readFileSync(filePath));
    hash.update('\0');
  }
  return hash.digest('hex');
}

/** Writes immutable evidence tying one packaged client to its product policy sources and source commit. */
function createKiBuddyBuildEvidence(projectRoot, outputPath, options = {}) {
  const productConfig = readProductConfig(projectRoot);
  const packagingIdentity = resolveKiBuddyPackagingIdentity(productConfig, options.packagingOverlay);
  const sourceCommit = String(
    options.commit ||
      execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: projectRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
  ).trim();
  if (!SHA40_PATTERN.test(sourceCommit)) {
    throw new Error('Ki-Buddy build evidence requires a full lowercase source commit SHA');
  }
  const sourceTreeDirty =
    options.dirty ??
    Boolean(
      execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {
        cwd: projectRoot,
        encoding: 'utf8',
        maxBuffer: 100 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim()
    );
  const sourceStateSha256 = options.sourceStateSha256 || createSourceStateSha256(projectRoot);

  const evidence = {
    schemaVersion: 2,
    product: {
      runtimeIdentity: packagingIdentity.product.runtimeIdentity,
      productName: packagingIdentity.desktop.productName,
    },
    ...(options.packagingOverlay ? { packagingIdentity } : {}),
    source: {
      repository: productConfig.source.repository,
      commit: sourceCommit,
      treeDirty: sourceTreeDirty,
      stateSha256: sourceStateSha256,
    },
    release: {
      internal: { ...productConfig.internalRelease },
      publicDistribution: { ...productConfig.publicDistribution },
      runtimeUpdates: { ...productConfig.updates },
    },
    policySources: {
      productConfig: {
        path: PRODUCT_CONFIG_FILE,
        sha256: sha256File(path.join(projectRoot, PRODUCT_CONFIG_FILE)),
      },
      experienceRegistry: {
        path: PRODUCT_EXPERIENCE_REGISTRY_FILE,
        sha256: sha256File(path.join(projectRoot, PRODUCT_EXPERIENCE_REGISTRY_FILE)),
      },
    },
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  return evidence;
}

/**
 * Creates package metadata for one resolved Ki-Buddy packaging identity without modifying the root package.json.
 * @param {string} projectRoot Repository root containing the Ki-Buddy product configuration.
 * @param {{ packagingOverlay?: object, version?: string }} [options] Optional resolved identity and package version.
 * @returns {object} Effective package metadata consumed by electron-builder.
 */
function createEffectivePackageJson(projectRoot, options = {}) {
  const upstreamPackage = readJson(path.join(projectRoot, 'package.json'), 'AionUi package.json');
  const productConfig = readProductConfig(projectRoot);
  const packagingIdentity = resolveKiBuddyPackagingIdentity(productConfig, options.packagingOverlay);
  const version = options.version || readProductVersion(projectRoot);
  if (!PACKAGE_VERSION_PATTERN.test(version)) throw new Error('Effective Ki-Buddy package version must be SemVer');
  return {
    ...upstreamPackage,
    ...packagingIdentity.packageMetadata,
    productRuntime: packagingIdentity.product.runtimeIdentity,
    version,
  };
}

/**
 * Writes the electron-builder configuration and evidence for one resolved Ki-Buddy packaging identity.
 * @param {string} projectRoot Repository root containing product and upstream builder configuration.
 * @param {string} outputPath Destination for the generated electron-builder JSON configuration.
 * @param {{ commit?: string, packagingOverlay?: object, version?: string }} [options] Packaging inputs.
 * @returns {object} Generated electron-builder configuration.
 */
function createElectronBuilderConfig(projectRoot, outputPath, options = {}) {
  const productConfig = readProductConfig(projectRoot);
  const packagingIdentity = resolveKiBuddyPackagingIdentity(productConfig, options.packagingOverlay);
  for (const [kind, relativePath] of Object.entries(packagingIdentity.resources.platform)) {
    if (!fs.existsSync(path.join(projectRoot, relativePath))) {
      throw new Error(`Packaging platform asset ${kind} does not exist: ${relativePath}`);
    }
  }
  const effectivePackage = createEffectivePackageJson(projectRoot, {
    ...options,
    packagingOverlay: packagingIdentity,
  });
  const upstreamBuilderPath = path.join(projectRoot, 'packages/desktop/electron-builder.yml');
  const upstreamBuilderConfig = yaml.load(fs.readFileSync(upstreamBuilderPath, 'utf8'));
  if (!upstreamBuilderConfig || typeof upstreamBuilderConfig !== 'object' || Array.isArray(upstreamBuilderConfig)) {
    throw new Error('Upstream electron-builder configuration must be an object');
  }
  const upstreamExtraResources = Array.isArray(upstreamBuilderConfig.extraResources)
    ? upstreamBuilderConfig.extraResources
    : [];
  const defaultIdentity = resolveKiBuddyPackagingIdentity(productConfig);
  const productExtraResources = upstreamExtraResources.map((resource) => {
    if (!resource || typeof resource !== 'object') return resource;
    if (resource.to === defaultIdentity.resources.packaged.applicationIcon) {
      return Object.assign({}, resource, {
        from: packagingIdentity.resources.platform.png,
        to: packagingIdentity.resources.packaged.applicationIcon,
      });
    }
    return resource;
  });
  if (packagingIdentity.resources.packaged.runtimeIcon !== packagingIdentity.resources.packaged.applicationIcon) {
    productExtraResources.push({
      from: packagingIdentity.resources.platform.png,
      to: packagingIdentity.resources.packaged.runtimeIcon,
    });
  }
  const buildEvidencePath = path.join(path.dirname(outputPath), packagingIdentity.resources.packaged.buildEvidence);
  createKiBuddyBuildEvidence(projectRoot, buildEvidencePath, {
    commit: options.commit,
    ...(options.packagingOverlay ? { packagingOverlay: packagingIdentity } : {}),
  });
  productExtraResources.push({
    from: buildEvidencePath,
    to: packagingIdentity.resources.packaged.buildEvidence,
  });
  const config = {
    ...upstreamBuilderConfig,
    ...packagingIdentity.desktop,
    win: { ...upstreamBuilderConfig.win, icon: packagingIdentity.resources.platform.ico },
    mac: { ...upstreamBuilderConfig.mac, icon: packagingIdentity.resources.platform.icns },
    linux: {
      ...upstreamBuilderConfig.linux,
      ...packagingIdentity.desktop.linux,
      icon: packagingIdentity.resources.platform.png,
    },
    extraResources: productExtraResources,
    extraMetadata: Object.fromEntries(
      [
        'name',
        'version',
        'description',
        'author',
        'repository',
        'homepage',
        'bugs',
        'productName',
        'productRuntime',
      ].map((key) => [key, effectivePackage[key]])
    ),
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return config;
}

function validateAionUi(aionUi) {
  requireExactKeys(aionUi, ['repository', 'tag', 'commit'], 'AionUi mapping');
  if (aionUi.repository !== AION_UI_REPOSITORY) {
    throw new Error(`AionUi mapping repository must be ${AION_UI_REPOSITORY}`);
  }
  if (!/^v\d+\.\d+\.\d+$/.test(aionUi.tag)) {
    throw new Error('AionUi mapping tag must use the full vX.Y.Z form');
  }
  if (!SHA40_PATTERN.test(aionUi.commit)) {
    throw new Error('AionUi mapping commit must be a full lowercase commit SHA');
  }
}

function validateMappedAionCore(aionCore) {
  requireExactKeys(aionCore, ['repository', 'tag', 'commit'], 'AionCore mapping');
  if (aionCore.repository !== 'iOfficeAI/AionCore') {
    throw new Error('AionCore mapping repository must be iOfficeAI/AionCore');
  }
  if (!/^v\d+\.\d+\.\d+$/.test(aionCore.tag)) {
    throw new Error('AionCore mapping tag must use the full vX.Y.Z form');
  }
  if (!SHA40_PATTERN.test(aionCore.commit)) {
    throw new Error('AionCore mapping commit must be a full lowercase commit SHA');
  }
}

function validateMappedKiCore(kiCore) {
  requireExactKeys(kiCore, ['repository', 'version', 'tag', 'commit', 'aionCore'], 'Ki-Core mapping');
  if (kiCore.repository !== 'xlihub/Ki-Core') {
    throw new Error('Ki-Core mapping repository must be xlihub/Ki-Core');
  }
  if (!SEMVER_PATTERN.test(kiCore.version) || kiCore.tag !== `ki-core-v${kiCore.version}`) {
    throw new Error('Ki-Core mapping version and tag do not match');
  }
  if (!SHA40_PATTERN.test(kiCore.commit)) {
    throw new Error('Ki-Core mapping commit must be a full lowercase commit SHA');
  }
  validateMappedAionCore(kiCore.aionCore);
}

function readReleaseMapping(projectRoot, version) {
  const mapping = readJson(path.join(projectRoot, 'ki-buddy-release.json'), 'Ki-Buddy release mapping');
  requireExactKeys(mapping, ['schemaVersion', 'product', 'repository', 'release'], 'Ki-Buddy release mapping');
  if (mapping.schemaVersion !== 1) throw new Error('Unsupported Ki-Buddy release mapping schema');
  if (mapping.product !== KI_BUDDY_PRODUCT || mapping.repository !== KI_BUDDY_SOURCE_REPOSITORY) {
    throw new Error('Ki-Buddy release mapping product identity is invalid');
  }
  const release = mapping.release;
  requireExactKeys(release, ['version', 'tag', 'aionUi', 'kiCore'], 'Ki-Buddy release entry');
  if (!SEMVER_PATTERN.test(release.version) || release.tag !== `ki-buddy-v${release.version}`) {
    throw new Error('Ki-Buddy release mapping version and tag do not match');
  }
  if (release.version !== version) {
    throw new Error(`Ki-Buddy release mapping must describe current version ${version}`);
  }
  validateAionUi(release.aionUi);
  validateMappedKiCore(release.kiCore);
  return release;
}

function validateCorePin(projectRoot, versionEntry) {
  const pin = readKiCorePin(projectRoot);
  const mapped = versionEntry.kiCore;
  if (
    pin.repository !== mapped.repository ||
    pin.tag !== mapped.tag ||
    pin.commit !== mapped.commit ||
    pin.aionCore.repository !== mapped.aionCore.repository ||
    pin.aionCore.tag !== mapped.aionCore.tag ||
    pin.aionCore.peeledCommit !== mapped.aionCore.commit
  ) {
    throw new Error('Ki-Buddy product Ki-Core pin does not match the current version mapping');
  }
}

function readReleaseContext(versionEntry, env) {
  const explicitTag = String(env.KI_BUDDY_RELEASE_TAG || '').trim();
  const githubTag = String(env.GITHUB_REF || '').startsWith('refs/tags/')
    ? String(env.GITHUB_REF_NAME || env.GITHUB_REF.slice('refs/tags/'.length)).trim()
    : '';
  const releaseTag = explicitTag || githubTag;
  const releaseCommit = String(env.KI_BUDDY_RELEASE_COMMIT || (releaseTag ? env.GITHUB_SHA : '') || '').trim();

  if (releaseTag && releaseTag !== versionEntry.tag) {
    throw new Error(`Release tag ${releaseTag} does not match mapped tag ${versionEntry.tag}`);
  }
  if (releaseTag && !SHA40_PATTERN.test(releaseCommit)) {
    throw new Error('A Ki-Buddy release tag requires a full lowercase release commit SHA');
  }
  if (!releaseTag && releaseCommit) {
    throw new Error('Ki-Buddy release commit cannot be set without a release tag');
  }
  return { releaseCommit: releaseCommit || null, releaseTag: releaseTag || null };
}

function validateChangelog(projectRoot, version) {
  const changelog = fs.readFileSync(path.join(projectRoot, 'CHANGELOG.ki-buddy.md'), 'utf8');
  const heading = new RegExp(`^## \\[${version.replaceAll('.', '\\.')}\\](?: - \\d{4}-\\d{2}-\\d{2})?\\s*$`, 'm');
  if (!heading.test(changelog)) {
    throw new Error(`CHANGELOG.ki-buddy.md is missing the ${version} release entry`);
  }
  for (const section of ['Ki-Buddy 定制变化', 'AionUi 上游更新', 'Ki-Core 更新']) {
    if (!changelog.includes(`### ${section}`)) {
      throw new Error(`CHANGELOG.ki-buddy.md is missing section: ${section}`);
    }
  }
  return changelog;
}

function verifyAionUiTag(projectRoot, versionEntry) {
  let commit;
  try {
    commit = execFileSync('git', ['rev-parse', `${versionEntry.aionUi.tag}^{commit}`], {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    throw new Error(`Cannot resolve mapped AionUi tag ${versionEntry.aionUi.tag}`, { cause: error });
  }
  if (commit !== versionEntry.aionUi.commit) {
    throw new Error(`AionUi tag ${versionEntry.aionUi.tag} does not resolve to the mapped commit`);
  }
}

function verifyProductPackageJson(currentPackage, upstreamPackage, runtimeDependencies) {
  const comparablePackage = structuredClone(currentPackage);
  const upstreamDependencies = upstreamPackage.dependencies || {};
  for (const [name, version] of Object.entries(runtimeDependencies)) {
    if (Object.hasOwn(upstreamDependencies, name)) {
      throw new Error(`Ki-Buddy runtime dependency ${name} conflicts with the mapped AionUi package.json`);
    }
    if (comparablePackage.dependencies?.[name] !== version) {
      throw new Error(`Ki-Buddy runtime dependency ${name} must match the product configuration`);
    }
    delete comparablePackage.dependencies[name];
  }
  if (!isDeepStrictEqual(comparablePackage, upstreamPackage)) {
    throw new Error('Root package.json may differ from the mapped AionUi commit only by declared product dependencies');
  }
}

function verifyUpstreamPackageJson(projectRoot, aionUi) {
  let upstreamPackageText;
  try {
    upstreamPackageText = execFileSync('git', ['show', `${aionUi.commit}:package.json`], {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    throw new Error(`Cannot read package.json from mapped AionUi commit ${aionUi.commit}`, { cause: error });
  }
  const upstreamPackage = JSON.parse(upstreamPackageText);
  const currentPackage = readJson(path.join(projectRoot, 'package.json'), 'Ki-Buddy package.json');
  const { runtimeDependencies } = readProductConfig(projectRoot);
  verifyProductPackageJson(currentPackage, upstreamPackage, runtimeDependencies);
}

function readKiBuddyRelease(projectRoot, env = process.env) {
  const version = readProductVersion(projectRoot);
  const productConfig = readProductConfig(projectRoot);
  const versionEntry = readReleaseMapping(projectRoot, version);
  validateCorePin(projectRoot, versionEntry);
  validateChangelog(projectRoot, version);
  const release = readReleaseContext(versionEntry, env);
  return {
    kiBuddy: {
      repository: productConfig.internalRelease.repository,
      version,
      tag: versionEntry.tag,
      releaseCommit: release.releaseCommit,
    },
    kiBuddySource: { ...productConfig.source },
    publicDistribution: { ...productConfig.publicDistribution },
    runtimeUpdates: { ...productConfig.updates },
    aionUi: { ...versionEntry.aionUi },
    kiCore: {
      repository: versionEntry.kiCore.repository,
      version: versionEntry.kiCore.version,
      tag: versionEntry.kiCore.tag,
      releaseCommit: versionEntry.kiCore.commit,
    },
    aionCore: {
      repository: versionEntry.kiCore.aionCore.repository,
      tag: versionEntry.kiCore.aionCore.tag,
      peeledCommit: versionEntry.kiCore.aionCore.commit,
    },
  };
}

function verifyKiBuddyRelease(projectRoot, options = {}) {
  const env = { ...process.env };
  if (options.tag) env.KI_BUDDY_RELEASE_TAG = options.tag;
  if (options.commit) env.KI_BUDDY_RELEASE_COMMIT = options.commit;
  const identity = readKiBuddyRelease(projectRoot, env);
  const repository = options.repository || (options.skipGit ? null : readOriginRepository(projectRoot));
  if (repository && repository !== identity.kiBuddy.repository) {
    throw new Error(`Ki-Buddy release repository must be ${identity.kiBuddy.repository}`);
  }
  if (!options.skipGit) {
    verifyAionUiTag(projectRoot, { aionUi: identity.aionUi });
    verifyUpstreamPackageJson(projectRoot, identity.aionUi);
  }
  return identity;
}

function extractReleaseNotes(projectRoot, version) {
  const changelog = validateChangelog(projectRoot, version);
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex((line) => new RegExp(`^## \\[${version.replaceAll('.', '\\.')}\\]`).test(line));
  const end = lines.findIndex((line, index) => index > start && line.startsWith('## ['));
  return `${lines
    .slice(start, end === -1 ? lines.length : end)
    .join('\n')
    .trim()}\n`;
}

function parseCliArgs(args) {
  const [command = 'verify', ...rest] = args;
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    const value = rest[index + 1];
    if (!key?.startsWith('--') || value === undefined) throw new Error(`Invalid argument: ${key || ''}`);
    options[key.slice(2)] = value;
  }
  return { command, options };
}

function runCli() {
  const projectRoot = path.resolve(__dirname, '../../..');
  const { command, options } = parseCliArgs(process.argv.slice(2));
  if (command === 'verify') {
    const identity = verifyKiBuddyRelease(projectRoot, {
      commit: options.commit,
      repository: options.repository,
      skipGit: options['skip-git'] === 'true',
      tag: options.tag,
    });
    process.stdout.write(`${JSON.stringify(identity, null, 2)}\n`);
    return;
  }
  if (command === 'notes') {
    const version = options.version || readProductVersion(projectRoot);
    const notes = extractReleaseNotes(projectRoot, version);
    if (!options.output) throw new Error('notes command requires --output');
    fs.writeFileSync(path.resolve(options.output), notes, 'utf8');
    return;
  }
  if (command === 'builder-config') {
    if (!options.output) throw new Error('builder-config command requires --output');
    createElectronBuilderConfig(projectRoot, path.resolve(options.output), {
      version: options.version,
    });
    return;
  }
  throw new Error(`Unsupported Ki-Buddy release command: ${command}`);
}

if (require.main === module) {
  try {
    runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

module.exports = {
  createSourceStateSha256,
  createKiBuddyBuildEvidence,
  createEffectivePackageJson,
  createElectronBuilderConfig,
  extractReleaseNotes,
  readKiBuddyRelease,
  readProductConfig,
  readProductVersion,
  readReleaseMapping,
  verifyKiBuddyRelease,
  verifyProductPackageJson,
};

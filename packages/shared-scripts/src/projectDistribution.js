const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { resolveKiBuddyPackagingIdentity } = require('./kiBuddyPackagingIdentity');

const REGISTRATION_SCHEMA = require('../../../distributions/schemas/registration.schema.json');
const MANIFEST_SCHEMA = require('../../../distributions/schemas/manifest.schema.json');
const DEFAULT_PRODUCT_CONFIG = require('../../../ki-buddy-product.json');

const SHA40_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const DISTRIBUTION_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PROTOCOL_PATTERN = /^[a-z][a-z0-9+.-]*$/;
const PACKAGE_NAME_PATTERN = /^[a-z0-9]+(?:[-._][a-z0-9]+)*$/;
const SENSITIVE_KEY_PATTERN =
  /(api.?key|access.?key|authorization|bearer|cookie|session|secret|token|password|credential|private.?key)/iu;
const IDENTITY_KEYS = [
  'appId',
  'applicationName',
  'executableName',
  'protocolScheme',
  'dataDirectory',
  'credentialNamespace',
];
const UNIQUE_IDENTITY_KEYS = IDENTITY_KEYS.filter((key) => key !== 'applicationName');
const SUPPORTED_PLATFORMS = ['macos-arm64'];
const SUPPORTED_INTEGRATIONS = ['agentsGateway'];
const AIONUI_RESERVED_IDENTITY = {
  appId: 'com.aionui.app',
  applicationName: 'AionUi',
  executableName: 'AionUi',
  protocolScheme: 'aionui',
  dataDirectory: 'AionUi',
  credentialNamespace: 'aionui',
};

function clone(value) {
  return structuredClone(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function requireRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

function requireExactKeys(value, keys, label) {
  const record = requireRecord(value, label);
  const missing = keys.filter((key) => !(key in record));
  const unexpected = Object.keys(record).filter((key) => !keys.includes(key));
  if (missing.length === 0 && unexpected.length === 0) return record;
  const details = [
    missing.length ? `missing ${missing.join(', ')}` : '',
    unexpected.length ? `unexpected ${unexpected.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('; ');
  throw new Error(`${label} has invalid fields: ${details}`);
}

function requireSchemaKeys(value, schema, label) {
  return requireExactKeys(value, Object.keys(schema.properties), label);
}

function requireString(value, label) {
  if (typeof value !== 'string' || value.trim() === '' || value !== value.trim()) {
    throw new Error(`${label} must be a non-empty trimmed string`);
  }
  return value;
}

function requireEnum(value, allowed, label) {
  if (!allowed.includes(value)) throw new Error(`${label} must be one of ${allowed.join(', ')}`);
  return value;
}

function requireUniqueStrings(value, label) {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== 'string' || item.trim() === '' || item !== item.trim()) ||
    new Set(value).size !== value.length
  ) {
    throw new Error(`${label} must contain unique non-empty strings`);
  }
  return value;
}

function requireSafeRelativePath(value, label) {
  requireString(value, label);
  if (path.isAbsolute(value) || value.split(/[\\/]/u).includes('..')) {
    throw new Error(`${label} must be a safe relative path`);
  }
  return value;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .toSorted()
      .map((key) => [key, canonicalize(value[key])])
  );
}

function digestJson(value) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(canonicalize(value)), 'utf8')
    .digest('hex');
}

function requireIdentity(value, label) {
  const identity = requireExactKeys(value, IDENTITY_KEYS, label);
  for (const key of IDENTITY_KEYS) requireString(identity[key], `${label} ${key}`);
  if (!/^[A-Za-z0-9.-]+$/u.test(identity.appId)) throw new Error(`${label} appId is invalid`);
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]*$/u.test(identity.applicationName)) {
    throw new Error(`${label} applicationName is invalid`);
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(identity.executableName)) {
    throw new Error(`${label} executableName is invalid`);
  }
  if (!PROTOCOL_PATTERN.test(identity.protocolScheme)) throw new Error(`${label} protocolScheme is invalid`);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(identity.dataDirectory)) {
    throw new Error(`${label} dataDirectory is invalid`);
  }
  if (!DISTRIBUTION_ID_PATTERN.test(identity.credentialNamespace)) {
    throw new Error(`${label} credentialNamespace is invalid`);
  }
  return identity;
}

function identityCollisionKey(value) {
  return value.toLowerCase();
}

function reserveIdentity(seenIdentityValues, identity, label) {
  for (const key of UNIQUE_IDENTITY_KEYS) {
    seenIdentityValues.get(key).set(identityCollisionKey(identity[key]), `${label} ${key}`);
  }
}

function validateRegistry(value, baseProductConfig) {
  const registry = requireSchemaKeys(value, REGISTRATION_SCHEMA, 'Project distribution registry');
  if (registry.schemaVersion !== 1) throw new Error('Unsupported project distribution registry schema');
  if (!Array.isArray(registry.registrations)) throw new Error('Project distribution registrations must be an array');

  const registrationKeys = REGISTRATION_SCHEMA.properties.registrations.items.required;
  const seenDistributionIds = new Set();
  const seenIdentityValues = new Map(UNIQUE_IDENTITY_KEYS.map((key) => [key, new Map()]));
  const defaultPackagingIdentity = resolveKiBuddyPackagingIdentity(baseProductConfig);
  reserveIdentity(
    seenIdentityValues,
    {
      appId: defaultPackagingIdentity.desktop.appId,
      applicationName: defaultPackagingIdentity.desktop.productName,
      executableName: defaultPackagingIdentity.desktop.executableName,
      protocolScheme: defaultPackagingIdentity.desktop.protocols[0].schemes[0],
      dataDirectory: defaultPackagingIdentity.desktop.productName,
      credentialNamespace: 'ki-buddy',
    },
    'default Ki-Buddy'
  );
  reserveIdentity(seenIdentityValues, AIONUI_RESERVED_IDENTITY, 'AionUi');

  for (const rawRegistration of registry.registrations) {
    const registration = requireExactKeys(rawRegistration, registrationKeys, 'Project distribution registration');
    if (!DISTRIBUTION_ID_PATTERN.test(registration.distributionId)) {
      throw new Error('Project distributionId must be a lowercase kebab-case slug');
    }
    if (seenDistributionIds.has(registration.distributionId)) {
      throw new Error(`Duplicate project distributionId: ${registration.distributionId}`);
    }
    seenDistributionIds.add(registration.distributionId);
    requireEnum(registration.lifecycle, ['active', 'suspended', 'retired'], 'Project registration lifecycle');
    requireEnum(registration.identityMode, ['local', 'agents'], 'Project registration identityMode');
    const identities = requireExactKeys(registration.identities, ['formal', 'preview'], 'Project identities');
    for (const mode of ['formal', 'preview']) {
      const identity = requireIdentity(identities[mode], `Project ${mode} identity`);
      for (const key of UNIQUE_IDENTITY_KEYS) {
        const valuesForKey = seenIdentityValues.get(key);
        const collisionKey = identityCollisionKey(identity[key]);
        const existing = valuesForKey.get(collisionKey);
        if (existing) {
          throw new Error(
            `Project identity collision: ${registration.distributionId}.${mode}.${key} collides with ${existing}`
          );
        }
        valuesForKey.set(collisionKey, `${registration.distributionId}.${mode}.${key}`);
      }
    }
    const allowed = requireExactKeys(
      registration.allowed,
      ['platforms', 'integrations', 'disabledFeatures', 'nonSensitiveConfigKeys'],
      'Project allowed scope'
    );
    requireUniqueStrings(allowed.platforms, 'Project allowed platforms').forEach((platform) =>
      requireEnum(platform, SUPPORTED_PLATFORMS, 'Project allowed platform')
    );
    requireUniqueStrings(allowed.integrations, 'Project allowed integrations').forEach((integration) =>
      requireEnum(integration, SUPPORTED_INTEGRATIONS, 'Project allowed integration')
    );
    requireUniqueStrings(allowed.disabledFeatures, 'Project allowed disabled features');
    requireUniqueStrings(allowed.nonSensitiveConfigKeys, 'Project allowed non-sensitive configuration keys');
  }
  return registry;
}

function requireNonSensitiveConfig(value, label = 'Project manifest nonSensitiveConfig', pathParts = []) {
  const record = requireRecord(value, label);
  for (const [key, child] of Object.entries(record)) {
    const childPath = [...pathParts, key];
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      throw new Error(`${label} contains sensitive key ${childPath.join('.')}`);
    }
    if (child && typeof child === 'object') {
      if (Array.isArray(child)) {
        for (const [index, item] of child.entries()) {
          if (item && typeof item === 'object') requireNonSensitiveConfig(item, label, [...childPath, String(index)]);
        }
      } else {
        requireNonSensitiveConfig(child, label, childPath);
      }
    }
  }
  return record;
}

function validateManifest(value) {
  const manifest = requireSchemaKeys(value, MANIFEST_SCHEMA, 'Project distribution manifest');
  if (manifest.schemaVersion !== 1) throw new Error('Unsupported project distribution manifest schema');
  if (!DISTRIBUTION_ID_PATTERN.test(manifest.distributionId)) {
    throw new Error('Project manifest distributionId must be a lowercase kebab-case slug');
  }
  if (!SEMVER_PATTERN.test(manifest.version)) throw new Error('Project manifest version must be stable SemVer');
  const baseline = requireExactKeys(manifest.baseline, ['repository', 'commit'], 'Project manifest baseline');
  if (baseline.repository !== 'xlihub/KiBuddy') throw new Error('Project manifest baseline repository is invalid');
  if (!SHA40_PATTERN.test(baseline.commit))
    throw new Error('Project manifest baseline commit must be a full lowercase SHA');
  const brand = requireExactKeys(
    manifest.brand,
    ['productName', 'packageName', 'description'],
    'Project manifest brand'
  );
  if (brand.productName !== 'Ki-Buddy') throw new Error('Project manifest productName must remain Ki-Buddy');
  if (!PACKAGE_NAME_PATTERN.test(brand.packageName)) throw new Error('Project manifest packageName is invalid');
  requireString(brand.description, 'Project manifest description');
  requireEnum(manifest.identityMode, ['local', 'agents'], 'Project manifest identityMode');
  requireUniqueStrings(manifest.integrations, 'Project manifest integrations');
  requireUniqueStrings(manifest.disabledFeatures, 'Project manifest disabledFeatures');
  requireNonSensitiveConfig(manifest.nonSensitiveConfig);
  const resources = requireExactKeys(manifest.resources, ['png', 'ico', 'icns'], 'Project manifest resources');
  for (const [kind, resourcePath] of Object.entries(resources)) {
    requireSafeRelativePath(resourcePath, `Project manifest resource ${kind}`);
  }
  requireUniqueStrings(manifest.platforms, 'Project manifest platforms').forEach((platform) =>
    requireEnum(platform, SUPPORTED_PLATFORMS, 'Project manifest platform')
  );
  return manifest;
}

function validateSource(value) {
  const source = requireExactKeys(value, ['repository', 'commit', 'treeState'], 'Project source evidence');
  if (source.repository !== 'xlihub/KiBuddy') throw new Error('Project source repository must be xlihub/KiBuddy');
  if (!SHA40_PATTERN.test(source.commit)) {
    throw new Error('Project source commit must be a full lowercase commit SHA');
  }
  if (source.treeState !== 'committed') throw new Error('Project source must identify committed source state');
  return source;
}

function validateKiCore(value, platform) {
  const kiCore = requireExactKeys(
    value,
    ['repository', 'tag', 'commit', 'aionCore', 'checksums'],
    'Ki-Core provenance'
  );
  if (kiCore.repository !== 'xlihub/Ki-Core') throw new Error('Ki-Core repository is invalid');
  requireString(kiCore.tag, 'Ki-Core tag');
  if (!SHA40_PATTERN.test(kiCore.commit)) throw new Error('Ki-Core commit must be a full lowercase SHA');
  const aionCore = requireExactKeys(kiCore.aionCore, ['repository', 'tag', 'peeledCommit'], 'AionCore provenance');
  if (aionCore.repository !== 'iOfficeAI/AionCore') throw new Error('AionCore repository is invalid');
  requireString(aionCore.tag, 'AionCore tag');
  if (!SHA40_PATTERN.test(aionCore.peeledCommit)) throw new Error('AionCore commit must be a full lowercase SHA');
  const checksums = requireRecord(kiCore.checksums, 'Ki-Core checksums');
  if (!SHA256_PATTERN.test(checksums[platform] ?? '')) {
    throw new Error(`Ki-Core checksum for ${platform} is missing or invalid`);
  }
  return kiCore;
}

function createPackagingIdentity(baseProductConfig, manifest, identity) {
  const packagingIdentity = clone(resolveKiBuddyPackagingIdentity(baseProductConfig));
  packagingIdentity.packageMetadata.name = manifest.brand.packageName;
  packagingIdentity.packageMetadata.description = manifest.brand.description;
  packagingIdentity.packageMetadata.productName = identity.applicationName;
  packagingIdentity.desktop.appId = identity.appId;
  packagingIdentity.desktop.productName = identity.applicationName;
  packagingIdentity.desktop.executableName = identity.executableName;
  packagingIdentity.desktop.protocols = [
    { name: `${manifest.brand.productName} Protocol`, schemes: [identity.protocolScheme] },
  ];
  packagingIdentity.desktop.linux.desktop.entry.Name = identity.applicationName;
  packagingIdentity.desktop.linux.desktop.entry.Icon = identity.executableName;
  packagingIdentity.desktop.linux.desktop.entry.MimeType = `x-scheme-handler/${identity.protocolScheme};`;
  packagingIdentity.resources.platform = clone(manifest.resources);
  packagingIdentity.resources.packaged.applicationIcon = 'project-distribution/application.png';
  packagingIdentity.resources.packaged.buildEvidence = 'project-distribution/project-build-evidence.json';
  return resolveKiBuddyPackagingIdentity(baseProductConfig, packagingIdentity);
}

function createEffectiveProductConfig(baseProductConfig, manifest, registration, identity, mode) {
  const productConfig = clone(baseProductConfig);
  for (const featureId of manifest.disabledFeatures) {
    if (!(featureId in productConfig.experience.features)) {
      throw new Error(`Project manifest feature ${featureId} is not a product capability`);
    }
    productConfig.experience.features[featureId] = 'disabled';
  }
  productConfig.packageMetadata.name = manifest.brand.packageName;
  productConfig.packageMetadata.description = manifest.brand.description;
  productConfig.packageMetadata.productName = identity.applicationName;
  productConfig.electronBuilder.appId = identity.appId;
  productConfig.electronBuilder.productName = identity.applicationName;
  productConfig.electronBuilder.executableName = identity.executableName;
  productConfig.electronBuilder.protocols = [
    { name: `${manifest.brand.productName} Protocol`, schemes: [identity.protocolScheme] },
  ];
  productConfig.electronBuilder.linux.desktop.entry.Name = identity.applicationName;
  productConfig.electronBuilder.linux.desktop.entry.Icon = identity.executableName;
  productConfig.electronBuilder.linux.desktop.entry.MimeType = `x-scheme-handler/${identity.protocolScheme};`;
  productConfig.distribution = {
    schemaVersion: 1,
    distributionId: registration.distributionId,
    identityMode: registration.identityMode,
    integrations: [...manifest.integrations],
    mode,
    dataDirectory: identity.dataDirectory,
    credentialNamespace: identity.credentialNamespace,
    nonSensitiveConfig: clone(manifest.nonSensitiveConfig),
  };
  return productConfig;
}

/** Resolves all project distribution policy into the only plan consumed by preview build stages. */
function resolveProjectDistributionBuildPlan(input) {
  const request = requireExactKeys(
    input,
    ['registry', 'manifest', 'mode', 'source', 'registrationRevision', 'requestedPlatforms', 'kiCore'],
    'Project distribution build request'
  );
  const baseProductConfig = DEFAULT_PRODUCT_CONFIG;
  const registry = validateRegistry(request.registry, baseProductConfig);
  const manifest = validateManifest(request.manifest);
  if (request.mode !== 'preview') throw new Error('This build contract currently supports preview mode only');
  const registration = registry.registrations.find((item) => item.distributionId === manifest.distributionId);
  if (!registration) throw new Error(`Project distribution ${manifest.distributionId} is not registered`);
  if (registration.lifecycle === 'retired') {
    throw new Error('Retired project registrations cannot create previews');
  }
  if (manifest.identityMode !== registration.identityMode) {
    throw new Error('Project manifest identityMode does not match its registration');
  }
  if (manifest.identityMode === 'local') {
    if (!manifest.disabledFeatures.includes('account')) {
      throw new Error('Local project distributions must disable account');
    }
  }
  for (const integration of manifest.integrations) {
    if (!registration.allowed.integrations.includes(integration)) {
      throw new Error(`Project manifest integration ${integration} is not allowed by its registration`);
    }
  }
  for (const configKey of Object.keys(manifest.nonSensitiveConfig)) {
    if (!registration.allowed.nonSensitiveConfigKeys.includes(configKey)) {
      throw new Error(`Project manifest nonSensitiveConfig key ${configKey} is not allowed by its registration`);
    }
  }
  for (const feature of manifest.disabledFeatures) {
    if (!registration.allowed.disabledFeatures.includes(feature)) {
      throw new Error(`Project manifest feature ${feature} is not allowed by its registration`);
    }
  }
  if (
    manifest.disabledFeatures.length !== registration.allowed.disabledFeatures.length ||
    registration.allowed.disabledFeatures.some((feature) => !manifest.disabledFeatures.includes(feature))
  ) {
    throw new Error('Project manifest disabled features must match its registration');
  }
  const requestedPlatforms = requireUniqueStrings(request.requestedPlatforms, 'Requested project platforms');
  if (requestedPlatforms.length === 0) throw new Error('At least one project platform must be requested');
  for (const platform of requestedPlatforms) {
    if (!manifest.platforms.includes(platform) || !registration.allowed.platforms.includes(platform)) {
      throw new Error(`Requested project platform ${platform} is not allowed`);
    }
  }
  const source = validateSource(request.source);
  if (!SHA40_PATTERN.test(request.registrationRevision)) {
    throw new Error('Project registration revision must be a full lowercase commit SHA');
  }
  const identity = registration.identities.preview;
  const platform = requestedPlatforms[0];
  const kiCore = validateKiCore(request.kiCore, platform);
  const packagingIdentity = createPackagingIdentity(baseProductConfig, manifest, identity);
  const productConfig = createEffectiveProductConfig(baseProductConfig, manifest, registration, identity, request.mode);

  return deepFreeze({
    schemaVersion: 1,
    mode: 'preview',
    distributionId: manifest.distributionId,
    version: manifest.version,
    identityMode: manifest.identityMode,
    source: clone(source),
    registration: { revision: request.registrationRevision },
    manifest: { digest: digestJson(manifest) },
    baseline: clone(manifest.baseline),
    platforms: [...requestedPlatforms],
    integrations: [...manifest.integrations],
    disabledFeatures: [...manifest.disabledFeatures],
    runtimeIdentity: {
      dataDirectory: identity.dataDirectory,
      credentialNamespace: identity.credentialNamespace,
    },
    packagingIdentity,
    productConfig,
    secretScope: { kind: 'none', names: [] },
    kiCore: {
      repository: kiCore.repository,
      tag: kiCore.tag,
      commit: kiCore.commit,
      aionCore: clone(kiCore.aionCore),
      platform,
      checksum: kiCore.checksums[platform],
    },
  });
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

function runCli() {
  const [command, ...args] = process.argv.slice(2);
  const value = (flag) => {
    const index = args.indexOf(flag);
    if (index < 0 || !args[index + 1]) throw new Error(`${command} requires ${flag}`);
    return args[index + 1];
  };
  if (command === 'verify-unpacked') {
    const buildPlan = readJson(value('--build-plan'), 'resolved project distribution build plan');
    if (buildPlan.schemaVersion !== 1 || buildPlan.mode !== 'preview') {
      throw new Error('Resolved project distribution build plan is invalid');
    }
    const { verifyKiBuddyUnpacked } = require('./kiBuddyUnpacked');
    const result = verifyKiBuddyUnpacked(
      path.resolve(value('--project-root')),
      path.resolve(value('--path')),
      value('--platform'),
      buildPlan.packagingIdentity,
      buildPlan
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (command !== 'resolve') throw new Error(`Unsupported project distribution command: ${command}`);
  const productConfig = readJson(value('--product-config'), 'Ki-Buddy product configuration');
  const platform = value('--platform');
  const plan = resolveProjectDistributionBuildPlan({
    registry: readJson(value('--registry'), 'project distribution registry'),
    manifest: readJson(value('--manifest'), 'project distribution manifest'),
    mode: 'preview',
    source: {
      repository: 'xlihub/KiBuddy',
      commit: value('--source-sha'),
      treeState: 'committed',
    },
    registrationRevision: value('--registration-revision'),
    requestedPlatforms: [platform],
    kiCore: productConfig.kiCore,
  });
  const outputPath = path.resolve(value('--output'));
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
}

if (require.main === module) {
  try {
    runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

module.exports = { resolveProjectDistributionBuildPlan };

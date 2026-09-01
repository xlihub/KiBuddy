const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { listFilesRecursively, requireSinglePath } = require('./artifactFiles');
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
const BUILD_CREDENTIAL_NAME_PATTERN = /^[A-Z][A-Z0-9_]*$/;
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
const PROJECT_PLATFORM_CONFIG = {
  'macos-x64': {
    os: 'macos-14',
    arch: 'x64',
    runtimePlatform: 'darwin',
    command: 'node scripts/build-with-builder.js x64 --mac --x64',
    installerExtension: '.dmg',
    unpackedDirectory: 'mac',
  },
  'macos-arm64': {
    os: 'macos-14',
    arch: 'arm64',
    runtimePlatform: 'darwin',
    command: 'node scripts/build-with-builder.js arm64 --mac --arm64',
    installerExtension: '.dmg',
    unpackedDirectory: 'mac-arm64',
  },
  'windows-x64': {
    os: 'windows-2022',
    arch: 'x64',
    runtimePlatform: 'win32',
    command: 'node scripts/build-with-builder.js x64 --win --x64',
    installerExtension: '.exe',
    unpackedDirectory: 'win-unpacked',
  },
  'windows-arm64': {
    os: 'windows-11-arm',
    arch: 'arm64',
    runtimePlatform: 'win32',
    command: 'node scripts/build-with-builder.js arm64 --win --arm64',
    installerExtension: '.exe',
    unpackedDirectory: 'win-arm64-unpacked',
  },
  'linux-x64': {
    os: 'ubuntu-latest',
    arch: 'x64',
    runtimePlatform: 'linux',
    command: 'node scripts/build-with-builder.js x64 --linux --x64',
    installerExtension: '.deb',
    unpackedDirectory: 'linux-unpacked',
  },
  'linux-arm64': {
    os: 'ubuntu-24.04-arm',
    arch: 'arm64',
    runtimePlatform: 'linux',
    command: 'node scripts/build-with-builder.js arm64 --linux --arm64',
    installerExtension: '.deb',
    unpackedDirectory: 'linux-arm64-unpacked',
  },
};
const SUPPORTED_PLATFORMS = Object.keys(PROJECT_PLATFORM_CONFIG);
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

function requireModePlatformPolicy(value, label) {
  const policy = requireExactKeys(value, ['preview', 'formal'], `${label} mode policy`);
  for (const mode of ['preview', 'formal']) {
    requireUniqueStrings(policy[mode], `${label} ${mode}`).forEach((platform) =>
      requireEnum(platform, SUPPORTED_PLATFORMS, `${label} ${mode}`)
    );
  }
  return policy;
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
  if (registry.schemaVersion !== 2) {
    throw new Error('Unsupported project distribution registry schema');
  }
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
      [
        'platforms',
        'requiredPlatforms',
        'integrations',
        'disabledFeatures',
        'nonSensitiveConfigKeys',
        'buildCredentialNames',
      ],
      'Project allowed scope'
    );
    const allowedPlatforms = requireModePlatformPolicy(allowed.platforms, 'Project allowed platforms');
    const requiredPlatforms = requireModePlatformPolicy(allowed.requiredPlatforms, 'Project required platforms');
    for (const mode of ['preview', 'formal']) {
      if (requiredPlatforms[mode].some((platform) => !allowedPlatforms[mode].includes(platform))) {
        throw new Error(`Project required platforms ${mode} must be allowed`);
      }
    }
    requireUniqueStrings(allowed.integrations, 'Project allowed integrations').forEach((integration) =>
      requireEnum(integration, SUPPORTED_INTEGRATIONS, 'Project allowed integration')
    );
    requireUniqueStrings(allowed.disabledFeatures, 'Project allowed disabled features');
    requireUniqueStrings(allowed.nonSensitiveConfigKeys, 'Project allowed non-sensitive configuration keys');
    requireUniqueStrings(allowed.buildCredentialNames, 'Project allowed build credential names').forEach((name) => {
      if (!BUILD_CREDENTIAL_NAME_PATTERN.test(name)) {
        throw new Error('Project allowed build credential name must use UPPER_SNAKE_CASE');
      }
    });
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
  if (manifest.schemaVersion !== 2) {
    throw new Error('Unsupported project distribution manifest schema');
  }
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
  requireModePlatformPolicy(manifest.platforms, 'Project manifest platforms');
  return manifest;
}

function validateSource(value, mode, distributionId) {
  const keys =
    mode === 'formal'
      ? ['repository', 'commit', 'treeState', 'branch', 'branchHead', 'ruleset']
      : ['repository', 'commit', 'treeState'];
  const source = requireExactKeys(value, keys, 'Project source evidence');
  if (source.repository !== 'xlihub/KiBuddy') throw new Error('Project source repository must be xlihub/KiBuddy');
  if (!SHA40_PATTERN.test(source.commit)) {
    throw new Error('Project source commit must be a full lowercase commit SHA');
  }
  if (source.treeState !== 'committed') throw new Error('Project source must identify committed source state');
  if (mode === 'formal') {
    const expectedBranch = `distribution/${distributionId}`;
    if (source.branch !== expectedBranch) {
      throw new Error(`Formal project source branch must be ${expectedBranch}`);
    }
    if (!SHA40_PATTERN.test(source.branchHead)) {
      throw new Error('Formal project source branch head must be a full lowercase commit SHA');
    }
    const ruleset = requireExactKeys(source.ruleset, ['ruleTypes', 'rulesetIds'], 'Formal branch ruleset evidence');
    const ruleTypes = requireUniqueStrings(ruleset.ruleTypes, 'Formal branch ruleset rule types');
    for (const requiredRule of ['deletion', 'non_fast_forward']) {
      if (!ruleTypes.includes(requiredRule)) {
        throw new Error(`Formal project branch ruleset must enforce ${requiredRule}`);
      }
    }
    if (
      !Array.isArray(ruleset.rulesetIds) ||
      ruleset.rulesetIds.length === 0 ||
      ruleset.rulesetIds.some((id) => !Number.isSafeInteger(id) || id <= 0) ||
      new Set(ruleset.rulesetIds).size !== ruleset.rulesetIds.length
    ) {
      throw new Error('Formal branch ruleset evidence must identify active rulesets');
    }
  }
  return source;
}

function validateDeliveryRecords(value) {
  const records = requireExactKeys(value, ['schemaVersion', 'deliveries'], 'Project delivery records');
  if (records.schemaVersion !== 1) throw new Error('Unsupported project delivery records schema');
  if (!Array.isArray(records.deliveries)) throw new Error('Project deliveries must be an array');
  const seenVersions = new Set();
  for (const rawDelivery of records.deliveries) {
    const delivery = requireExactKeys(
      rawDelivery,
      [
        'distributionId',
        'version',
        'sourceCommit',
        'registrationRevision',
        'manifestDigest',
        'platforms',
        'candidate',
        'installerChecksums',
        'custodyReference',
      ],
      'Project delivery record'
    );
    if (!DISTRIBUTION_ID_PATTERN.test(delivery.distributionId)) {
      throw new Error('Project delivery distributionId must be a lowercase kebab-case slug');
    }
    if (!SEMVER_PATTERN.test(delivery.version)) throw new Error('Project delivery version must be stable SemVer');
    if (!SHA40_PATTERN.test(delivery.sourceCommit)) {
      throw new Error('Project delivery source commit must be a full lowercase commit SHA');
    }
    if (!SHA40_PATTERN.test(delivery.registrationRevision)) {
      throw new Error('Project delivery registration revision must be a full lowercase commit SHA');
    }
    if (!SHA256_PATTERN.test(delivery.manifestDigest)) {
      throw new Error('Project delivery manifest digest must be SHA-256');
    }
    const platforms = requireUniqueStrings(delivery.platforms, 'Project delivery platforms');
    if (platforms.length === 0) throw new Error('Project delivery must identify at least one platform');
    for (const platform of platforms) requireEnum(platform, SUPPORTED_PLATFORMS, 'Project delivery platform');
    validateCandidateAttempt(delivery.candidate);
    const checksums = requireRecord(delivery.installerChecksums, 'Project delivery installer checksums');
    if (
      Object.keys(checksums).length !== platforms.length ||
      platforms.some((platform) => !SHA256_PATTERN.test(checksums[platform] ?? ''))
    ) {
      throw new Error('Project delivery installer checksums must cover every delivered platform');
    }
    requireString(delivery.custodyReference, 'Project delivery custody reference');
    const versionKey = `${delivery.distributionId}@${delivery.version}`;
    if (seenVersions.has(versionKey)) throw new Error(`Duplicate project delivery version: ${versionKey}`);
    seenVersions.add(versionKey);
  }
  return records;
}

function validateCandidateAttempt(value) {
  const candidate = requireExactKeys(value, ['runId', 'runAttempt'], 'Project candidate attempt');
  if (!Number.isSafeInteger(candidate.runId) || candidate.runId <= 0) {
    throw new Error('Project candidate runId must be a positive integer');
  }
  if (!Number.isSafeInteger(candidate.runAttempt) || candidate.runAttempt <= 0) {
    throw new Error('Project candidate runAttempt must be a positive integer');
  }
  return candidate;
}

/**
 * Normalizes verified Ki-Core candidate output into project build provenance.
 * @param {object} result Verified Ki-Core candidate download result.
 * @param {string} platform Canonical project platform key.
 * @returns {object} Immutable Ki-Core candidate provenance.
 * @throws {Error} When candidate metadata does not match the project provenance contract.
 */
function createProjectKiCoreCandidateProvenance(result, platform) {
  const candidateResult = requireExactKeys(result, ['manifest', 'source'], 'Verified Ki-Core candidate result');
  const manifest = requireExactKeys(candidateResult.manifest, ['product', 'upstream'], 'Ki-Core candidate manifest');
  const product = requireExactKeys(
    manifest.product,
    ['version', 'tag', 'releaseCommit'],
    'Ki-Core candidate product provenance'
  );
  const source = requireExactKeys(
    candidateResult.source,
    ['policy', 'repository', 'workflow', 'runId', 'headSha', 'version', 'artifactName', 'checksum', 'url'],
    'Ki-Core candidate source provenance'
  );
  const normalized = {
    sourcePolicy: source.policy,
    repository: source.repository,
    version: product.version,
    tag: product.tag,
    commit: product.releaseCommit,
    aionCore: clone(manifest.upstream),
    checksums: { [platform]: source.checksum },
    candidate: {
      workflow: source.workflow,
      runId: Number(source.runId),
      artifacts: { [platform]: source.artifactName },
    },
  };
  validateKiCore(normalized, [platform]);
  if (source.headSha !== normalized.commit || source.version !== normalized.version) {
    throw new Error('Ki-Core candidate source does not match its source metadata');
  }
  return deepFreeze(normalized);
}

function selectImmutableKiCoreCandidateSource(value) {
  return {
    sourcePolicy: value.sourcePolicy,
    repository: value.repository,
    version: value.version,
    tag: value.tag,
    commit: value.commit,
    aionCore: value.aionCore,
    workflow: value.candidate.workflow,
    runId: value.candidate.runId,
  };
}

/** Combines per-platform Ki-Core candidate artifacts after proving their immutable source metadata is identical. */
function mergeProjectKiCoreCandidateProvenance(provenances, requestedPlatforms) {
  const platforms = requireUniqueStrings(requestedPlatforms, 'Requested Ki-Core candidate platforms');
  if (platforms.length === 0) throw new Error('At least one Ki-Core candidate platform must be requested');
  if (!Array.isArray(provenances) || provenances.length !== platforms.length) {
    throw new Error('Ki-Core candidate provenance must cover every requested platform');
  }
  const byPlatform = new Map();
  for (const provenance of provenances) {
    const checksumPlatforms = Object.keys(requireRecord(provenance?.checksums, 'Ki-Core candidate checksums'));
    if (checksumPlatforms.length !== 1) {
      throw new Error('Each Ki-Core candidate provenance must identify exactly one platform');
    }
    const platform = checksumPlatforms[0];
    validateKiCore(provenance, [platform]);
    if (byPlatform.has(platform)) throw new Error(`Duplicate Ki-Core candidate platform: ${platform}`);
    byPlatform.set(platform, provenance);
  }
  if (platforms.some((platform) => !byPlatform.has(platform))) {
    throw new Error('Ki-Core candidate provenance must cover every requested platform');
  }
  const first = byPlatform.get(platforms[0]);
  for (const platform of platforms.slice(1)) {
    if (
      digestJson(selectImmutableKiCoreCandidateSource(byPlatform.get(platform))) !==
      digestJson(selectImmutableKiCoreCandidateSource(first))
    ) {
      throw new Error('Ki-Core candidate provenance must remain consistent across selected platforms');
    }
  }
  return deepFreeze({
    sourcePolicy: first.sourcePolicy,
    repository: first.repository,
    version: first.version,
    tag: first.tag,
    commit: first.commit,
    aionCore: clone(first.aionCore),
    checksums: Object.fromEntries(
      platforms.map((platform) => [platform, byPlatform.get(platform).checksums[platform]])
    ),
    candidate: {
      workflow: first.candidate.workflow,
      runId: first.candidate.runId,
      artifacts: Object.fromEntries(
        platforms.map((platform) => [platform, byPlatform.get(platform).candidate.artifacts[platform]])
      ),
    },
  });
}

/**
 * Converts active GitHub branch rules into immutable formal source evidence.
 * @param {object[]} rules Active rules returned by the GitHub branch rules API.
 * @returns {{ruleTypes: string[], rulesetIds: number[]}} Immutable Ruleset evidence.
 * @throws {Error} When deletion or non-fast-forward protection is absent.
 */
function createFormalBranchRulesetEvidence(rules) {
  if (!Array.isArray(rules)) throw new Error('GitHub branch rules response must be an array');
  const ruleTypes = [...new Set(rules.map((rule) => rule?.type).filter((type) => typeof type === 'string'))].toSorted();
  const rulesetIds = [
    ...new Set(rules.map((rule) => rule?.ruleset_id).filter((id) => Number.isSafeInteger(id) && id > 0)),
  ].toSorted((left, right) => left - right);
  const evidence = { ruleTypes, rulesetIds };
  const requiredRules = ['deletion', 'non_fast_forward'];
  for (const requiredRule of requiredRules) {
    if (!ruleTypes.includes(requiredRule)) {
      throw new Error(`Formal project branch ruleset must enforce ${requiredRule}`);
    }
  }
  if (rulesetIds.length === 0) throw new Error('Formal project branch has no active Ruleset');
  return deepFreeze(evidence);
}

/**
 * Verifies that a formal source commit is reachable from the fetched distribution branch.
 * @param {string} repositoryPath Local Git repository path.
 * @param {string} sourceSha Full lowercase project source commit SHA.
 * @param {string} sourceBranch Registered distribution branch name.
 * @returns {{commit: string, branch: string, branchHead: string}} Immutable reachability evidence.
 * @throws {Error} When the source or branch is invalid, missing, or unreachable.
 */
function verifyFormalSourceReachability(repositoryPath, sourceSha, sourceBranch) {
  if (!SHA40_PATTERN.test(sourceSha)) {
    throw new Error('Formal project source commit must be a full lowercase commit SHA');
  }
  if (!/^distribution\/[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(sourceBranch)) {
    throw new Error('Formal project source branch must use distribution/<distributionId>');
  }
  const remoteBranchRef = `refs/remotes/origin/${sourceBranch}`;
  try {
    const branchHead = execFileSync('git', ['rev-parse', '--verify', remoteBranchRef], {
      cwd: repositoryPath,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    execFileSync('git', ['merge-base', '--is-ancestor', sourceSha, remoteBranchRef], {
      cwd: repositoryPath,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    if (!SHA40_PATTERN.test(branchHead)) throw new Error('invalid branch head');
    return deepFreeze({ commit: sourceSha, branch: sourceBranch, branchHead });
  } catch (error) {
    throw new Error(`Formal project source commit is not reachable from ${sourceBranch}`, { cause: error });
  }
}

/** Creates one platform verification after its installer and unpacked application pass independent checks. */
function createProjectDistributionPlatformVerification(buildPlan, installer) {
  if (buildPlan?.schemaVersion !== 1 || buildPlan?.mode !== 'formal') {
    throw new Error('Project platform verification requires a validated formal build plan');
  }
  const artifact = requireExactKeys(installer, ['platform', 'fileName', 'checksum'], 'Project candidate installer');
  if (!buildPlan.platforms.includes(artifact.platform)) {
    throw new Error('Project candidate installer platform is not present in the build plan');
  }
  requireString(artifact.fileName, 'Project candidate installer file name');
  if (!SHA256_PATTERN.test(artifact.checksum)) throw new Error('Project candidate installer checksum must be SHA-256');
  return deepFreeze({
    schemaVersion: 1,
    kind: 'project-distribution-platform-verification',
    buildPlanDigest: digestJson(buildPlan),
    platform: artifact.platform,
    artifact: { fileName: artifact.fileName, checksum: artifact.checksum },
    attempt: clone(buildPlan.candidate),
    provenance: {
      distributionId: buildPlan.distributionId,
      version: buildPlan.version,
      sourceCommit: buildPlan.source.commit,
      registrationRevision: buildPlan.registration.revision,
      manifestDigest: buildPlan.manifest.digest,
      baselineCommit: buildPlan.baseline.commit,
      kiCoreDigest: digestJson(buildPlan.kiCore),
    },
  });
}

/** Creates an atomic candidate only after all selected platform verifications agree with one formal plan. */
function createProjectDistributionCandidateRecord(buildPlan, platformVerifications) {
  if (buildPlan?.schemaVersion !== 1 || buildPlan?.mode !== 'formal') {
    throw new Error('Project candidate requires a validated formal build plan');
  }
  if (!Array.isArray(platformVerifications)) {
    throw new Error('Project candidate platform verifications must be an array');
  }
  const expectedPlanDigest = digestJson(buildPlan);
  const expectedProvenance = {
    distributionId: buildPlan.distributionId,
    version: buildPlan.version,
    sourceCommit: buildPlan.source.commit,
    registrationRevision: buildPlan.registration.revision,
    manifestDigest: buildPlan.manifest.digest,
    baselineCommit: buildPlan.baseline.commit,
    kiCoreDigest: digestJson(buildPlan.kiCore),
  };
  const byPlatform = new Map();
  for (const value of platformVerifications) {
    const verification = requireExactKeys(
      value,
      ['schemaVersion', 'kind', 'buildPlanDigest', 'platform', 'artifact', 'attempt', 'provenance'],
      'Project platform verification'
    );
    if (
      verification.schemaVersion !== 1 ||
      verification.kind !== 'project-distribution-platform-verification' ||
      verification.buildPlanDigest !== expectedPlanDigest ||
      digestJson(verification.provenance) !== digestJson(expectedProvenance) ||
      digestJson(verification.attempt) !== digestJson(buildPlan.candidate)
    ) {
      throw new Error('Project platform verification provenance does not match the shared build plan');
    }
    if (!buildPlan.platforms.includes(verification.platform) || byPlatform.has(verification.platform)) {
      throw new Error('Project candidate platform verifications must cover every selected platform exactly once');
    }
    const artifact = requireExactKeys(
      verification.artifact,
      ['fileName', 'checksum'],
      'Project platform verification artifact'
    );
    requireString(artifact.fileName, 'Project candidate installer file name');
    if (!SHA256_PATTERN.test(artifact.checksum)) {
      throw new Error('Project candidate installer checksum must be SHA-256');
    }
    byPlatform.set(verification.platform, artifact);
  }
  if (
    byPlatform.size !== buildPlan.platforms.length ||
    buildPlan.platforms.some((platform) => !byPlatform.has(platform))
  ) {
    throw new Error('Project candidate platform verifications must cover every selected platform');
  }
  return deepFreeze({
    schemaVersion: 1,
    kind: 'project-distribution-candidate',
    distributionId: buildPlan.distributionId,
    version: buildPlan.version,
    attempt: clone(buildPlan.candidate),
    source: clone(buildPlan.source),
    registration: clone(buildPlan.registration),
    manifest: clone(buildPlan.manifest),
    deliveryHistory: clone(buildPlan.deliveryHistory),
    baseline: clone(buildPlan.baseline),
    platforms: [...buildPlan.platforms],
    identity: {
      appId: buildPlan.packagingIdentity.desktop.appId,
      executableName: buildPlan.packagingIdentity.desktop.executableName,
      protocolSchemes: buildPlan.packagingIdentity.desktop.protocols.flatMap((protocol) => protocol.schemes),
      dataDirectory: buildPlan.runtimeIdentity.dataDirectory,
      credentialNamespace: buildPlan.runtimeIdentity.credentialNamespace,
    },
    artifacts: buildPlan.platforms.map((platform) => ({ platform, ...clone(byPlatform.get(platform)) })),
    kiCore: clone(buildPlan.kiCore),
  });
}

function validateKiCore(value, platforms) {
  const sourcePolicy = value?.sourcePolicy ?? 'release-pinned';
  const keys =
    sourcePolicy === 'candidate'
      ? ['sourcePolicy', 'repository', 'version', 'tag', 'commit', 'aionCore', 'checksums', 'candidate']
      : ['repository', 'tag', 'commit', 'aionCore', 'checksums'];
  const kiCore = requireExactKeys(value, keys, 'Ki-Core provenance');
  requireEnum(sourcePolicy, ['release-pinned', 'candidate'], 'Ki-Core source policy');
  if (kiCore.repository !== 'xlihub/Ki-Core') throw new Error('Ki-Core repository is invalid');
  if (!SHA40_PATTERN.test(kiCore.commit)) throw new Error('Ki-Core commit must be a full lowercase SHA');
  const aionCore = requireExactKeys(kiCore.aionCore, ['repository', 'tag', 'peeledCommit'], 'AionCore provenance');
  if (aionCore.repository !== 'iOfficeAI/AionCore') throw new Error('AionCore repository is invalid');
  requireString(aionCore.tag, 'AionCore tag');
  if (!SHA40_PATTERN.test(aionCore.peeledCommit)) throw new Error('AionCore commit must be a full lowercase SHA');
  const checksums = requireRecord(kiCore.checksums, 'Ki-Core checksums');
  for (const platform of platforms) {
    if (!SHA256_PATTERN.test(checksums[platform] ?? '')) {
      throw new Error(`Ki-Core checksum for ${platform} is missing or invalid`);
    }
  }
  if (sourcePolicy === 'release-pinned') {
    requireString(kiCore.tag, 'Ki-Core tag');
    if (!/^ki-core-v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(kiCore.tag)) {
      throw new Error('Ki-Core release tag must use ki-core-vX.Y.Z');
    }
    return {
      ...kiCore,
      sourcePolicy,
      version: kiCore.tag.slice('ki-core-v'.length),
      checksums: Object.fromEntries(platforms.map((platform) => [platform, checksums[platform]])),
    };
  }
  if (!SEMVER_PATTERN.test(kiCore.version) || kiCore.tag !== null) {
    throw new Error('Ki-Core candidate must identify its version without a release tag');
  }
  const candidate = requireExactKeys(
    kiCore.candidate,
    ['workflow', 'runId', 'artifacts'],
    'Ki-Core candidate provenance'
  );
  if (candidate.workflow !== 'build-manual.yml') {
    throw new Error('Ki-Core candidate workflow must be build-manual.yml');
  }
  if (!Number.isSafeInteger(candidate.runId) || candidate.runId <= 0) {
    throw new Error('Ki-Core candidate runId must be a positive integer');
  }
  const artifacts = requireRecord(candidate.artifacts, 'Ki-Core candidate artifacts');
  if (
    Object.keys(artifacts).length !== platforms.length ||
    platforms.some((platform) => artifacts[platform] !== `ki-core-candidate-${platform}`)
  ) {
    throw new Error('Ki-Core candidate artifacts must cover every selected platform');
  }
  return {
    ...kiCore,
    checksums: Object.fromEntries(platforms.map((platform) => [platform, checksums[platform]])),
    candidate: {
      ...candidate,
      artifacts: Object.fromEntries(platforms.map((platform) => [platform, artifacts[platform]])),
    },
  };
}

function createProjectDistributionBuildMatrix(buildPlan) {
  if (buildPlan?.schemaVersion !== 1 || !['preview', 'formal'].includes(buildPlan?.mode)) {
    throw new Error('Project build matrix requires a validated project build plan');
  }
  return deepFreeze({
    include: buildPlan.platforms.map((platform) => {
      const config = PROJECT_PLATFORM_CONFIG[platform];
      if (!config) throw new Error(`Unsupported project build platform: ${platform}`);
      return { platform, ...clone(config) };
    }),
  });
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

/** Resolves all project distribution policy into the only plan consumed by project build stages. */
function resolveProjectDistributionBuildPlan(input) {
  const inputRecord = requireRecord(input, 'Project distribution build request');
  const requestKeys =
    inputRecord.mode === 'formal'
      ? [
          'registry',
          'manifest',
          'deliveryRecords',
          'mode',
          'source',
          'registrationRevision',
          'requestedPlatforms',
          'requestedCredentialNames',
          'candidate',
          'kiCore',
        ]
      : ['registry', 'manifest', 'mode', 'source', 'registrationRevision', 'requestedPlatforms', 'kiCore'];
  const request = requireExactKeys(inputRecord, requestKeys, 'Project distribution build request');
  const baseProductConfig = DEFAULT_PRODUCT_CONFIG;
  const registry = validateRegistry(request.registry, baseProductConfig);
  const manifest = validateManifest(request.manifest);
  requireEnum(request.mode, ['preview', 'formal'], 'Project distribution build mode');
  const registration = registry.registrations.find((item) => item.distributionId === manifest.distributionId);
  if (!registration) throw new Error(`Project distribution ${manifest.distributionId} is not registered`);
  if (request.mode === 'formal' && registration.lifecycle !== 'active') {
    throw new Error('Only active project registrations can create formal candidates');
  }
  if (request.mode === 'formal' && registration.identityMode !== 'local') {
    throw new Error('Only local project registrations can create formal candidates');
  }
  if (request.mode === 'preview' && registration.lifecycle === 'retired') {
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
  const manifestPlatforms = requireModePlatformPolicy(manifest.platforms, 'Project manifest platforms')[request.mode];
  const allowedPlatforms = requireModePlatformPolicy(registration.allowed.platforms, 'Project allowed platforms')[
    request.mode
  ];
  const requiredPlatforms = requireModePlatformPolicy(
    registration.allowed.requiredPlatforms,
    'Project required platforms'
  )[request.mode];
  for (const platform of requestedPlatforms) {
    if (!manifestPlatforms.includes(platform) || !allowedPlatforms.includes(platform)) {
      throw new Error(`Requested project platform ${platform} is not allowed`);
    }
  }
  if (
    requestedPlatforms.length !== manifestPlatforms.length ||
    manifestPlatforms.some((platform) => !requestedPlatforms.includes(platform))
  ) {
    throw new Error('Requested project platforms must exactly match the manifest platform set for the selected mode');
  }
  for (const platform of requiredPlatforms) {
    if (!requestedPlatforms.includes(platform)) {
      throw new Error(`Required project platform ${platform} must be requested`);
    }
  }
  const requestedCredentialNames =
    request.mode === 'formal'
      ? requireUniqueStrings(request.requestedCredentialNames, 'Requested project build credential names')
      : [];
  for (const credentialName of requestedCredentialNames) {
    if (!BUILD_CREDENTIAL_NAME_PATTERN.test(credentialName)) {
      throw new Error('Requested project build credential name must use UPPER_SNAKE_CASE');
    }
    if (!registration.allowed.buildCredentialNames.includes(credentialName)) {
      throw new Error(`Project build credential ${credentialName} is not allowed by its registration`);
    }
  }
  const source = validateSource(request.source, request.mode, manifest.distributionId);
  if (!SHA40_PATTERN.test(request.registrationRevision)) {
    throw new Error('Project registration revision must be a full lowercase commit SHA');
  }
  const deliveryRecords = request.mode === 'formal' ? validateDeliveryRecords(request.deliveryRecords) : null;
  if (
    deliveryRecords?.deliveries.some(
      (delivery) => delivery.distributionId === manifest.distributionId && delivery.version === manifest.version
    )
  ) {
    throw new Error(`Project version ${manifest.version} has already been delivered`);
  }
  const candidate = request.mode === 'formal' ? validateCandidateAttempt(request.candidate) : null;
  const identity = registration.identities[request.mode];
  const kiCore = validateKiCore(request.kiCore, requestedPlatforms);
  const packagingIdentity = createPackagingIdentity(baseProductConfig, manifest, identity);
  const productConfig = createEffectiveProductConfig(baseProductConfig, manifest, registration, identity, request.mode);

  return deepFreeze({
    schemaVersion: 1,
    mode: request.mode,
    distributionId: manifest.distributionId,
    version: manifest.version,
    identityMode: manifest.identityMode,
    source: clone(source),
    registration: { revision: request.registrationRevision, lifecycle: registration.lifecycle },
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
    secretScope:
      request.mode === 'formal'
        ? {
            kind: 'distribution',
            distributionId: manifest.distributionId,
            mode: 'formal',
            names: [...requestedCredentialNames],
          }
        : { kind: 'none', names: [] },
    ...(deliveryRecords
      ? {
          deliveryHistory: {
            digest: digestJson(deliveryRecords),
            deliveredVersions: deliveryRecords.deliveries
              .filter((delivery) => delivery?.distributionId === manifest.distributionId)
              .map((delivery) => delivery.version),
          },
          candidate: clone(candidate),
        }
      : {}),
    kiCore: {
      sourcePolicy: kiCore.sourcePolicy,
      repository: kiCore.repository,
      version: kiCore.version,
      tag: kiCore.tag,
      commit: kiCore.commit,
      aionCore: clone(kiCore.aionCore),
      checksums: clone(kiCore.checksums),
      ...(kiCore.candidate ? { candidate: clone(kiCore.candidate) } : {}),
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

function findDirectoriesRecursively(rootPath, baseName) {
  if (!fs.existsSync(rootPath)) return [];
  const matches = [];
  for (const entry of fs.readdirSync(rootPath, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const entryPath = path.join(rootPath, entry.name);
    if (entry.name === baseName) matches.push(entryPath);
    matches.push(...findDirectoriesRecursively(entryPath, baseName));
  }
  return matches;
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function verifyProjectDistributionArtifact({
  buildPlan,
  projectRoot,
  artifactsRoot,
  platform,
  outputDirectory,
  materializeInstaller,
  verifyUnpacked,
  verifyWindowsInstallation,
}) {
  if (buildPlan?.schemaVersion !== 1 || !['preview', 'formal'].includes(buildPlan.mode)) {
    throw new Error('Project artifact verification requires a validated build plan');
  }
  if (!buildPlan.platforms.includes(platform)) {
    throw new Error(`Project artifact platform ${platform} is not selected by the build plan`);
  }
  const config = PROJECT_PLATFORM_CONFIG[platform];
  if (!config) throw new Error(`Unsupported project artifact platform: ${platform}`);
  const unpackedDirectories = findDirectoriesRecursively(artifactsRoot, config.unpackedDirectory);
  const installerPath = requireSinglePath(
    listFilesRecursively(artifactsRoot).filter(
      (filePath) =>
        filePath.endsWith(config.installerExtension) &&
        unpackedDirectories.every((directory) => !filePath.startsWith(`${directory}${path.sep}`))
    ),
    `${platform} installer`
  );
  const standaloneEvidencePath = requireSinglePath(
    listFilesRecursively(artifactsRoot).filter(
      (filePath) =>
        path.basename(filePath) === 'project-build-evidence.json' &&
        unpackedDirectories.every((directory) => !filePath.startsWith(`${directory}${path.sep}`))
    ),
    `${platform} standalone build evidence`
  );
  const unpackedVerification = require('./kiBuddyUnpacked');
  const materialized = (materializeInstaller ?? unpackedVerification.materializeKiBuddyInstaller)(
    installerPath,
    platform,
    buildPlan.packagingIdentity
  );
  try {
    const verification = (verifyUnpacked ?? unpackedVerification.verifyKiBuddyUnpacked)(
      path.resolve(projectRoot),
      materialized.unpackedPath,
      config.runtimePlatform,
      buildPlan.packagingIdentity,
      buildPlan,
      materialized.packageRoot,
      { expectedPlatform: platform }
    );
    if (config.runtimePlatform === 'win32') {
      (verifyWindowsInstallation ?? unpackedVerification.verifyKiBuddyWindowsInstallation)(
        materialized.unpackedPath,
        buildPlan.packagingIdentity,
        platform
      );
    }
    if (!fs.readFileSync(standaloneEvidencePath).equals(fs.readFileSync(verification.buildEvidencePath))) {
      throw new Error('Standalone project build evidence does not match the packaged evidence');
    }
  } finally {
    materialized.cleanup();
  }
  fs.mkdirSync(path.join(outputDirectory, 'installers'), { recursive: true });
  const copiedInstallerPath = path.join(outputDirectory, 'installers', path.basename(installerPath));
  fs.copyFileSync(installerPath, copiedInstallerPath);
  fs.copyFileSync(standaloneEvidencePath, path.join(outputDirectory, 'project-build-evidence.json'));
  const installer = {
    platform,
    fileName: path.basename(installerPath),
    checksum: sha256File(installerPath),
  };
  const platformVerification =
    buildPlan.mode === 'formal' ? createProjectDistributionPlatformVerification(buildPlan, installer) : null;
  if (platformVerification) {
    fs.writeFileSync(
      path.join(outputDirectory, 'project-platform-verification.json'),
      `${JSON.stringify(platformVerification, null, 2)}\n`,
      'utf8'
    );
  }
  return deepFreeze({ installer, verifiedFromInstaller: true });
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
    if (buildPlan.schemaVersion !== 1 || !['preview', 'formal'].includes(buildPlan.mode)) {
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
  if (command === 'resolve-ki-core-candidate') {
    const platform = value('--platform');
    const platformConfig = PROJECT_PLATFORM_CONFIG[platform];
    if (!platformConfig) throw new Error(`Unsupported formal project candidate platform: ${platform}`);
    const { downloadAndVerifyCandidate } = require('./prepare-aioncore');
    const result = downloadAndVerifyCandidate(
      platformConfig.runtimePlatform,
      platformConfig.arch,
      value('--run-id'),
      value('--head-sha'),
      (process.env.KI_CORE_ACTIONS_TOKEN || '').trim()
    );
    try {
      const provenance = createProjectKiCoreCandidateProvenance(result, platform);
      const outputPath = path.resolve(value('--output'));
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, `${JSON.stringify(provenance, null, 2)}\n`, 'utf8');
    } finally {
      if (result.tempDir) fs.rmSync(result.tempDir, { recursive: true, force: true });
    }
    return;
  }
  if (command === 'merge-ki-core-candidates') {
    const platforms = JSON.parse(value('--platforms-json'));
    const directory = path.resolve(value('--directory'));
    const provenances = platforms.map((platform) =>
      readJson(path.join(directory, `${platform}.json`), `${platform} Ki-Core candidate provenance`)
    );
    const provenance = mergeProjectKiCoreCandidateProvenance(provenances, platforms);
    const outputPath = path.resolve(value('--output'));
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(provenance, null, 2)}\n`, 'utf8');
    return;
  }
  if (command === 'create-build-matrix') {
    const matrix = createProjectDistributionBuildMatrix(
      readJson(value('--build-plan'), 'resolved project distribution build plan')
    );
    const outputPath = path.resolve(value('--output'));
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(matrix)}\n`, 'utf8');
    return;
  }
  if (command === 'resolve-branch-rules') {
    const rules = readJson(value('--rules'), 'GitHub branch rules');
    const evidence = createFormalBranchRulesetEvidence(rules);
    const outputPath = path.resolve(value('--output'));
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    return;
  }
  if (command === 'verify-source-reachability') {
    const evidence = verifyFormalSourceReachability(
      path.resolve(value('--repository')),
      value('--source-sha'),
      value('--source-branch')
    );
    const outputPath = path.resolve(value('--output'));
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    return;
  }
  if (command === 'create-candidate') {
    const buildPlan = readJson(value('--build-plan'), 'resolved project distribution build plan');
    const artifactsRoot = path.resolve(value('--verifications'));
    const platformVerifications = listFilesRecursively(artifactsRoot)
      .filter((filePath) => path.basename(filePath) === 'project-platform-verification.json')
      .map((filePath) => readJson(filePath, 'project platform verification'));
    for (const verification of platformVerifications) {
      const installerPath = requireSinglePath(
        listFilesRecursively(artifactsRoot).filter(
          (filePath) => path.basename(filePath) === verification.artifact.fileName
        ),
        `${verification.platform} verified installer`
      );
      if (sha256File(installerPath) !== verification.artifact.checksum) {
        throw new Error(`Verified installer checksum mismatch for ${verification.platform}`);
      }
    }
    const record = createProjectDistributionCandidateRecord(buildPlan, platformVerifications);
    const outputPath = path.resolve(value('--output'));
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    return;
  }
  if (command === 'verify-artifact') {
    const buildPlan = readJson(value('--build-plan'), 'resolved project distribution build plan');
    const result = verifyProjectDistributionArtifact({
      buildPlan,
      projectRoot: path.resolve(value('--project-root')),
      artifactsRoot: path.resolve(value('--artifacts-root')),
      platform: value('--platform'),
      outputDirectory: path.resolve(value('--output-directory')),
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (command !== 'resolve') throw new Error(`Unsupported project distribution command: ${command}`);
  const productConfig = readJson(value('--product-config'), 'Ki-Buddy product configuration');
  const requestedPlatforms = JSON.parse(value('--platforms-json'));
  const modeIndex = args.indexOf('--mode');
  const mode = modeIndex === -1 ? 'preview' : args[modeIndex + 1];
  const isFormal = mode === 'formal';
  const source = isFormal
    ? (() => {
        const reachability = readJson(value('--source-reachability'), 'formal source reachability evidence');
        if (reachability.commit !== value('--source-sha') || reachability.branch !== value('--source-branch')) {
          throw new Error('Formal source reachability evidence does not match the build request');
        }
        return {
          repository: 'xlihub/KiBuddy',
          commit: reachability.commit,
          treeState: 'committed',
          branch: reachability.branch,
          branchHead: reachability.branchHead,
          ruleset: readJson(value('--ruleset-evidence'), 'formal branch ruleset evidence'),
        };
      })()
    : {
        repository: 'xlihub/KiBuddy',
        commit: value('--source-sha'),
        treeState: 'committed',
      };
  const plan = resolveProjectDistributionBuildPlan({
    registry: readJson(value('--registry'), 'project distribution registry'),
    manifest: readJson(value('--manifest'), 'project distribution manifest'),
    ...(isFormal
      ? {
          deliveryRecords: readJson(value('--delivery-records'), 'project delivery records'),
          requestedCredentialNames: JSON.parse(value('--build-credential-names')),
          candidate: {
            runId: Number(value('--run-id')),
            runAttempt: Number(value('--run-attempt')),
          },
        }
      : {}),
    mode,
    source,
    registrationRevision: value('--registration-revision'),
    requestedPlatforms,
    kiCore:
      isFormal && args.includes('--ki-core-provenance')
        ? readJson(value('--ki-core-provenance'), 'verified Ki-Core provenance')
        : productConfig.kiCore,
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

module.exports = {
  createFormalBranchRulesetEvidence,
  createProjectDistributionBuildMatrix,
  createProjectDistributionCandidateRecord,
  createProjectDistributionPlatformVerification,
  createProjectKiCoreCandidateProvenance,
  mergeProjectKiCoreCandidateProvenance,
  resolveProjectDistributionBuildPlan,
  verifyFormalSourceReachability,
  verifyProjectDistributionArtifact,
};

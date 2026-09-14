import defaultProductConfig from '../../../../../../ki-buddy-product.json';
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from '@/common/config/i18n';
import { normalizeAgentsBaseUrl } from './deploymentUrl';
import {
  deepFreeze,
  parseProductExperiencePolicy,
  type DeepReadonly,
  type ProductExperienceSnapshot,
} from './experience';

export const KI_BUDDY_PRODUCT_RUNTIME = 'ki-buddy' as const;

declare const __KI_BUDDY_EFFECTIVE_PRODUCT_CONFIG__: unknown;

export type KiBuddyDistributionIdentityMode = 'agents' | 'local';
export type KiBuddyProductIntegration = 'agentsGateway';

/** Non-sensitive installation defaults, independently versioned from saved connections. */
export type KiBuddyModelPreset = {
  id: string;
  name: string;
  endpoint: string;
  modelIds: string[];
  headerNames: string[];
  manual: true;
  protocol: 'chat_completions';
  bearer: boolean;
  proxy: 'default' | 'direct';
  streamOptions: boolean;
};

/** Reject credentials and unknown options before publishing a renderer capability. */
export function parseKiBuddyModelPreset(value: unknown): KiBuddyModelPreset | undefined {
  if (value === undefined) return undefined;
  const preset = requireRecord(value, 'Ki-Buddy model preset');
  requireExactKeys(
    preset,
    ['id', 'name', 'endpoint', 'modelIds', 'headerNames', 'manual', 'protocol', 'bearer', 'proxy', 'streamOptions'],
    'Ki-Buddy model preset'
  );
  const invalid = () => new Error('Invalid Ki-Buddy model preset');
  if (typeof preset.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(preset.id)) throw invalid();
  if (typeof preset.name !== 'string' || !preset.name.trim()) throw invalid();
  if (typeof preset.endpoint !== 'string') throw invalid();
  try {
    const url = new URL(preset.endpoint);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw invalid();
  } catch {
    throw invalid();
  }
  if (
    !Array.isArray(preset.modelIds) ||
    !preset.modelIds.length ||
    preset.modelIds.some((model) => typeof model !== 'string' || !model.trim())
  )
    throw invalid();
  if (
    !Array.isArray(preset.headerNames) ||
    preset.headerNames.length > 64 ||
    preset.headerNames.some((name) => typeof name !== 'string' || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name))
  )
    throw invalid();
  const headers = preset.headerNames.map((name: string) => name.toLowerCase());
  if (
    new Set(headers).size !== headers.length ||
    headers.some((name) =>
      [
        'content-type',
        'content-length',
        'transfer-encoding',
        'host',
        'connection',
        'proxy-authorization',
        'proxy-authenticate',
        'trailer',
        'upgrade',
        'te',
      ].includes(name)
    ) ||
    (preset.bearer && headers.includes('authorization'))
  )
    throw invalid();
  if (
    preset.manual !== true ||
    preset.protocol !== 'chat_completions' ||
    typeof preset.bearer !== 'boolean' ||
    typeof preset.streamOptions !== 'boolean' ||
    !['default', 'direct'].includes(String(preset.proxy))
  )
    throw invalid();
  return {
    id: preset.id,
    name: preset.name,
    endpoint: preset.endpoint,
    modelIds: [...preset.modelIds],
    headerNames: [...preset.headerNames],
    manual: true,
    protocol: 'chat_completions',
    bearer: preset.bearer,
    proxy: preset.proxy as 'default' | 'direct',
    streamOptions: preset.streamOptions,
  };
}

export type KiBuddyProductConfig = DeepReadonly<{
  assets: {
    packaged: {
      icon: string;
    };
    platform: {
      icns: string;
      ico: string;
      png: string;
    };
    renderer: {
      logo: string;
      mascot: string;
    };
  };
  brand: {
    cliName: string;
    description: string;
    links: {
      feedback: string;
      homepage: string;
      releases: string;
      repository: string;
      support: string;
    };
    productName: string;
    shortName: string;
  };
  defaults: {
    agentsBaseUrl: string;
    language: SupportedLanguage;
  };
  distribution: {
    credentialNamespace: string;
    dataDirectory: string;
    distributionId: string;
    identityMode: KiBuddyDistributionIdentityMode;
    integrations: readonly KiBuddyProductIntegration[];
    mode: 'formal' | 'preview';
    nonSensitiveConfig: Record<string, unknown>;
    schemaVersion: 1;
  } | null;
  electronBuilder: {
    appId: string;
    protocolScheme: string;
  };
  experience: ProductExperienceSnapshot;
  locale: {
    namespace: string;
  };
  runtimeIdentity: typeof KI_BUDDY_PRODUCT_RUNTIME;
  publicDistribution: {
    provider: 'github';
    releasePageUrl: string;
    repository: string;
  };
  schemaVersion: 4;
  source: {
    repository: string;
    url: string;
  };
  themes: {
    dark: string;
    light: string;
  };
  updates: {
    provider: string;
    releasePageUrl: string;
    repository: string;
    tagPrefix: string;
  };
}>;

export type KiBuddyProductConfigLoadResult =
  | Readonly<{ config: KiBuddyProductConfig; error: null }>
  | Readonly<{ config: null; error: string }>;

const PRODUCT_CONFIG_TOP_LEVEL_KEYS = [
  'schemaVersion',
  'runtimeIdentity',
  'source',
  'internalRelease',
  'publicDistribution',
  'defaults',
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
  'experience',
  'distribution',
] as const;

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireKeys(
  value: Record<string, unknown>,
  requiredKeys: readonly string[],
  allowedKeys: readonly string[],
  label: string
): void {
  const missing = requiredKeys.filter((key) => !(key in value));
  const unexpected = Object.keys(value).filter((key) => !allowedKeys.includes(key));
  if (missing.length > 0 || unexpected.length > 0) {
    const details = [
      missing.length > 0 ? `missing ${missing.join(', ')}` : '',
      unexpected.length > 0 ? `unexpected ${unexpected.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('; ');
    throw new Error(`${label} has invalid fields: ${details}`);
  }
}

function requireExactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  requireKeys(value, keys, keys, label);
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} must be a non-empty string`);
  return value;
}

function requireSupportedString<const Expected extends string>(
  value: unknown,
  expected: Expected,
  label: string
): Expected {
  const result = requireString(value, label);
  if (result !== expected) throw new Error(`${label} must be ${expected}`);
  return expected;
}

function requireProtocolScheme(value: unknown): string {
  if (!Array.isArray(value) || value.length !== 1) {
    throw new Error('Ki-Buddy electron-builder protocols must contain exactly one protocol');
  }
  const protocol = requireRecord(value[0], 'Ki-Buddy electron-builder protocol');
  requireExactKeys(protocol, ['name', 'schemes'], 'Ki-Buddy electron-builder protocol');
  requireString(protocol.name, 'Ki-Buddy electron-builder protocol name');
  if (!Array.isArray(protocol.schemes) || protocol.schemes.length !== 1) {
    throw new Error('Ki-Buddy electron-builder protocol schemes must contain exactly one scheme');
  }
  const scheme = requireString(protocol.schemes[0], 'Ki-Buddy electron-builder protocol scheme');
  if (!/^[a-z][a-z0-9+.-]*$/i.test(scheme)) {
    throw new Error('Ki-Buddy electron-builder protocol scheme must be a valid URL scheme');
  }
  return scheme;
}

function requireHttpUrl(value: unknown, label: string): string {
  const raw = requireString(value, label);
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol');
    return url.toString();
  } catch {
    throw new Error(`${label} must be an absolute HTTP(S) URL`);
  }
}

function repositoryPathFromUrl(url: string): string {
  return new URL(url).pathname.replace(/^\//, '').replace(/\.git$/, '');
}

function requireRepository(value: unknown, label: string): string {
  const repository = requireString(value, label);
  if (!/^[^/\s]+\/[^/\s]+$/.test(repository)) {
    throw new Error(`${label} must use owner/repo format`);
  }
  return repository;
}

function requireIdentitySegment(value: unknown, label: string): string {
  const segment = requireString(value, label);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(segment)) {
    throw new Error(`${label} must be a safe directory or namespace segment`);
  }
  return segment;
}

function parseDistribution(value: unknown): KiBuddyProductConfig['distribution'] {
  if (value === undefined) return null;
  const distribution = requireRecord(value, 'Ki-Buddy distribution');
  requireExactKeys(
    distribution,
    [
      'schemaVersion',
      'distributionId',
      'identityMode',
      'integrations',
      'mode',
      'dataDirectory',
      'credentialNamespace',
      'nonSensitiveConfig',
    ],
    'Ki-Buddy distribution'
  );
  if (distribution.schemaVersion !== 1) throw new Error('Unsupported Ki-Buddy distribution schema');
  const distributionId = requireString(distribution.distributionId, 'Ki-Buddy distribution id');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(distributionId)) {
    throw new Error('Ki-Buddy distribution id must be a lowercase slug');
  }
  const identityMode = requireString(distribution.identityMode, 'Ki-Buddy distribution identity mode');
  if (!['agents', 'local'].includes(identityMode)) {
    throw new Error('Ki-Buddy distribution identity mode must be agents or local');
  }
  const mode = requireString(distribution.mode, 'Ki-Buddy distribution mode');
  if (!['formal', 'preview'].includes(mode)) {
    throw new Error('Ki-Buddy distribution mode must be formal or preview');
  }
  if (!Array.isArray(distribution.integrations)) {
    throw new Error('Ki-Buddy distribution integrations must be an array');
  }
  const integrations = distribution.integrations.map((integration) => {
    if (integration !== 'agentsGateway') {
      throw new Error('Ki-Buddy distribution integration must be agentsGateway');
    }
    return integration;
  });
  if (new Set(integrations).size !== integrations.length) {
    throw new Error('Ki-Buddy distribution integrations must be unique');
  }
  const nonSensitiveConfig = requireRecord(distribution.nonSensitiveConfig, 'Ki-Buddy distribution configuration');
  parseKiBuddyModelPreset(nonSensitiveConfig.modelPreset);
  return deepFreeze({
    schemaVersion: 1,
    distributionId,
    identityMode: identityMode as KiBuddyDistributionIdentityMode,
    integrations,
    mode: mode as 'formal' | 'preview',
    dataDirectory: requireIdentitySegment(distribution.dataDirectory, 'Ki-Buddy distribution data directory'),
    credentialNamespace: requireIdentitySegment(
      distribution.credentialNamespace,
      'Ki-Buddy distribution credential namespace'
    ),
    nonSensitiveConfig,
  });
}

/** Validates the runtime-owned subset of Ki-Buddy product configuration. */
export function parseKiBuddyProductConfig(value: unknown): KiBuddyProductConfig {
  const config = requireRecord(value, 'Ki-Buddy product configuration');
  requireKeys(
    config,
    [
      'schemaVersion',
      'runtimeIdentity',
      'source',
      'publicDistribution',
      'defaults',
      'locale',
      'themes',
      'brand',
      'assets',
      'electronBuilder',
      'updates',
      'experience',
    ],
    PRODUCT_CONFIG_TOP_LEVEL_KEYS,
    'Ki-Buddy product configuration'
  );
  if (config.schemaVersion !== 4) throw new Error('Unsupported Ki-Buddy product configuration schema');
  const runtimeIdentity = requireSupportedString(
    config.runtimeIdentity,
    KI_BUDDY_PRODUCT_RUNTIME,
    'Ki-Buddy runtime identity'
  );
  const source = requireRecord(config.source, 'Ki-Buddy source');
  requireExactKeys(source, ['repository', 'url'], 'Ki-Buddy source');
  const sourceRepository = requireRepository(source.repository, 'Ki-Buddy source repository');
  const sourceUrl = requireHttpUrl(source.url, 'Ki-Buddy source URL');
  const sourceUrlRepository = repositoryPathFromUrl(sourceUrl);
  if (sourceUrlRepository !== sourceRepository) {
    throw new Error('Ki-Buddy source URL must match the source repository');
  }
  const publicDistribution = requireRecord(config.publicDistribution, 'Ki-Buddy public distribution');
  requireExactKeys(publicDistribution, ['provider', 'repository', 'releasePageUrl'], 'Ki-Buddy public distribution');
  const publicDistributionProvider = requireSupportedString(
    publicDistribution.provider,
    'github',
    'Ki-Buddy public distribution provider'
  );
  const publicDistributionRepository = requireRepository(
    publicDistribution.repository,
    'Ki-Buddy public distribution repository'
  );
  const publicDistributionReleasePageUrl = requireHttpUrl(
    publicDistribution.releasePageUrl,
    'Ki-Buddy public distribution release page'
  );
  const defaults = requireRecord(config.defaults, 'Ki-Buddy product defaults');
  requireExactKeys(defaults, ['agentsBaseUrl', 'language'], 'Ki-Buddy product defaults');
  if (typeof defaults.agentsBaseUrl !== 'string' || defaults.agentsBaseUrl.trim() === '') {
    throw new Error('Ki-Buddy default Agents base URL must be a non-empty string');
  }
  const agentsBaseUrl = normalizeAgentsBaseUrl(defaults.agentsBaseUrl);
  if (!agentsBaseUrl) throw new Error('Ki-Buddy default Agents base URL must be a canonical HTTP(S) deployment URL');
  if (typeof defaults.language !== 'string' || !SUPPORTED_LANGUAGES.includes(defaults.language as SupportedLanguage)) {
    throw new Error('Ki-Buddy default language must be supported');
  }
  const brand = requireRecord(config.brand, 'Ki-Buddy brand');
  requireExactKeys(brand, ['productName', 'shortName', 'cliName', 'description', 'links'], 'Ki-Buddy brand');
  const links = requireRecord(brand.links, 'Ki-Buddy brand links');
  requireExactKeys(links, ['homepage', 'repository', 'releases', 'support', 'feedback'], 'Ki-Buddy brand links');
  const assets = requireRecord(config.assets, 'Ki-Buddy assets');
  requireExactKeys(assets, ['platform', 'packaged', 'renderer'], 'Ki-Buddy assets');
  const platformAssets = requireRecord(assets.platform, 'Ki-Buddy platform assets');
  requireExactKeys(platformAssets, ['png', 'ico', 'icns'], 'Ki-Buddy platform assets');
  const packagedAssets = requireRecord(assets.packaged, 'Ki-Buddy packaged assets');
  requireExactKeys(packagedAssets, ['icon'], 'Ki-Buddy packaged assets');
  const rendererAssets = requireRecord(assets.renderer, 'Ki-Buddy renderer assets');
  requireExactKeys(rendererAssets, ['logo', 'mascot'], 'Ki-Buddy renderer assets');
  const locale = requireRecord(config.locale, 'Ki-Buddy locale');
  requireExactKeys(locale, ['namespace'], 'Ki-Buddy locale');
  const themes = requireRecord(config.themes, 'Ki-Buddy themes');
  requireExactKeys(themes, ['light', 'dark'], 'Ki-Buddy themes');
  const electronBuilder = requireRecord(config.electronBuilder, 'Ki-Buddy electron-builder configuration');
  requireKeys(
    electronBuilder,
    ['appId', 'protocols'],
    ['appId', 'productName', 'executableName', 'copyright', 'protocols', 'publish', 'linux'],
    'Ki-Buddy electron-builder configuration'
  );
  const updates = requireRecord(config.updates, 'Ki-Buddy updates');
  requireExactKeys(updates, ['provider', 'repository', 'tagPrefix', 'releasePageUrl'], 'Ki-Buddy updates');
  const updateProvider = requireString(updates.provider, 'Ki-Buddy update provider');
  const updateRepository = requireString(updates.repository, 'Ki-Buddy update repository');
  const updateTagPrefix = requireString(updates.tagPrefix, 'Ki-Buddy update tag prefix');
  const updateReleasePageUrl = requireHttpUrl(updates.releasePageUrl, 'Ki-Buddy update release page');
  const protocolScheme = requireProtocolScheme(electronBuilder.protocols);
  const distribution = parseDistribution(config.distribution);
  const experience = parseProductExperiencePolicy(config.experience);
  if (distribution?.identityMode === 'local' && experience.features.account !== 'disabled') {
    throw new Error('Local Ki-Buddy distributions must disable account');
  }
  const brandRepositoryUrl = requireHttpUrl(links.repository, 'Ki-Buddy brand link repository');
  const brandRepositoryPath = repositoryPathFromUrl(brandRepositoryUrl);
  if (brandRepositoryPath !== sourceRepository) {
    throw new Error('Ki-Buddy brand repository must match the configured source repository');
  }
  if (
    updateProvider !== publicDistributionProvider ||
    updateRepository !== publicDistributionRepository ||
    updateReleasePageUrl !== publicDistributionReleasePageUrl
  ) {
    throw new Error('Ki-Buddy update source must match the public distribution source');
  }
  return deepFreeze({
    schemaVersion: 4,
    runtimeIdentity,
    source: {
      repository: sourceRepository,
      url: sourceUrl,
    },
    publicDistribution: {
      provider: publicDistributionProvider,
      repository: publicDistributionRepository,
      releasePageUrl: publicDistributionReleasePageUrl,
    },
    brand: {
      cliName: requireString(brand.cliName, 'Ki-Buddy CLI name'),
      productName: requireString(brand.productName, 'Ki-Buddy product name'),
      shortName: requireString(brand.shortName, 'Ki-Buddy short name'),
      description: requireString(brand.description, 'Ki-Buddy product description'),
      links: {
        homepage: requireHttpUrl(links.homepage, 'Ki-Buddy brand link homepage'),
        repository: brandRepositoryUrl,
        releases: requireHttpUrl(links.releases, 'Ki-Buddy brand link releases'),
        support: requireHttpUrl(links.support, 'Ki-Buddy brand link support'),
        feedback: requireHttpUrl(links.feedback, 'Ki-Buddy brand link feedback'),
      },
    },
    assets: {
      packaged: {
        icon: requireString(packagedAssets.icon, 'Ki-Buddy packaged icon'),
      },
      platform: {
        png: requireString(platformAssets.png, 'Ki-Buddy PNG asset'),
        ico: requireString(platformAssets.ico, 'Ki-Buddy ICO asset'),
        icns: requireString(platformAssets.icns, 'Ki-Buddy ICNS asset'),
      },
      renderer: {
        logo: requireSupportedString(rendererAssets.logo, 'ki-buddy-app', 'Ki-Buddy renderer logo asset'),
        mascot: requireSupportedString(rendererAssets.mascot, 'ki-buddy-mascot', 'Ki-Buddy renderer mascot asset'),
      },
    },
    defaults: {
      agentsBaseUrl,
      language: defaults.language as SupportedLanguage,
    },
    distribution,
    electronBuilder: {
      appId: requireString(electronBuilder.appId, 'Ki-Buddy electron-builder app id'),
      protocolScheme,
    },
    locale: {
      namespace: requireString(locale.namespace, 'Ki-Buddy locale namespace'),
    },
    themes: {
      light: requireSupportedString(themes.light, 'ki-buddy-light', 'Ki-Buddy light theme'),
      dark: requireSupportedString(themes.dark, 'ki-buddy-dark', 'Ki-Buddy dark theme'),
    },
    experience,
    updates: {
      provider: updateProvider,
      repository: updateRepository,
      tagPrefix: updateTagPrefix,
      releasePageUrl: updateReleasePageUrl,
    },
  });
}

/** Captures packaged configuration failures without aborting main or preload module evaluation. */
export function loadKiBuddyProductConfig(value: unknown): KiBuddyProductConfigLoadResult {
  try {
    return deepFreeze({ config: parseKiBuddyProductConfig(value), error: null });
  } catch (error) {
    return deepFreeze({
      config: null,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const effectiveProductConfig =
  typeof __KI_BUDDY_EFFECTIVE_PRODUCT_CONFIG__ === 'undefined'
    ? defaultProductConfig
    : __KI_BUDDY_EFFECTIVE_PRODUCT_CONFIG__;

export const KI_BUDDY_PRODUCT_CONFIG_RESULT = loadKiBuddyProductConfig(effectiveProductConfig);

const path = require('node:path');

const DEFAULT_PACKAGED_RESOURCES = {
  applicationIcon: 'app.png',
  buildEvidence: 'ki-buddy-build-evidence.json',
  agentsMcpAdapter: 'app.asar.unpacked/out/main/builtin-mcp-agents.js',
  bundledAionCore: 'bundled-aioncore',
};

function clone(value) {
  return structuredClone(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function requireExactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  if (JSON.stringify(Object.keys(value).toSorted()) !== JSON.stringify(keys.toSorted())) {
    throw new Error(`${label} has unexpected or missing fields`);
  }
}

function requireSafeRelativePath(value, label) {
  if (
    typeof value !== 'string' ||
    value.trim() === '' ||
    path.isAbsolute(value) ||
    value.split(/[\\/]/u).includes('..')
  ) {
    throw new Error(`${label} must be a safe relative path`);
  }
}

function requireNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function requireAbsoluteHttpUrl(value, label, allowGitPrefix = false) {
  requireNonEmptyString(value, label);
  const normalizedValue = allowGitPrefix && value.startsWith('git+') ? value.slice(4) : value;
  let url;
  try {
    url = new URL(normalizedValue);
  } catch {
    throw new Error(`${label} must be an absolute HTTP(S) URL`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`${label} must be an absolute HTTP(S) URL`);
  }
}

function requireMatchingLinuxProtocolHandlers(protocols, mimeType) {
  const expectedHandlers = protocols
    .flatMap((protocol) => protocol.schemes)
    .map((scheme) => `x-scheme-handler/${scheme}`)
    .toSorted();
  const actualHandlers = mimeType
    .split(';')
    .map((handler) => handler.trim())
    .filter(Boolean)
    .toSorted();
  if (JSON.stringify(actualHandlers) !== JSON.stringify(expectedHandlers)) {
    throw new Error('Packaging Linux protocol handlers must match protocol schemes');
  }
}

/** Resolves the immutable packaging identity consumed by every Ki-Buddy packaging stage. */
function resolveKiBuddyPackagingIdentity(productConfig, overlay) {
  const hasOverlay = overlay !== undefined;
  if (hasOverlay) {
    requireExactKeys(
      overlay,
      ['schemaVersion', 'product', 'packageMetadata', 'desktop', 'resources'],
      'Packaging overlay'
    );
    if (overlay.schemaVersion !== 1) throw new Error('Unsupported packaging overlay schema');
    requireExactKeys(overlay.product, ['runtimeIdentity'], 'Packaging product identity');
    requireNonEmptyString(overlay.product.runtimeIdentity, 'Packaging runtime identity');
    if (overlay.product.runtimeIdentity !== productConfig.runtimeIdentity) {
      throw new Error(`Packaging runtime identity must remain ${productConfig.runtimeIdentity}`);
    }
    requireExactKeys(
      overlay.desktop,
      ['appId', 'productName', 'executableName', 'copyright', 'protocols', 'publish', 'linux'],
      'Packaging desktop identity'
    );
    requireNonEmptyString(overlay.desktop.appId, 'Packaging app id');
    if (!Array.isArray(overlay.desktop.protocols) || overlay.desktop.protocols.length === 0) {
      throw new Error('Packaging protocols must be a non-empty array');
    }
    for (const protocol of overlay.desktop.protocols) {
      requireExactKeys(protocol, ['name', 'schemes'], 'Packaging protocol');
      requireNonEmptyString(protocol.name, 'Packaging protocol name');
      if (
        !Array.isArray(protocol.schemes) ||
        protocol.schemes.length === 0 ||
        protocol.schemes.some((scheme) => typeof scheme !== 'string' || scheme.trim() === '') ||
        new Set(protocol.schemes).size !== protocol.schemes.length
      ) {
        throw new Error('Packaging protocol schemes must contain non-empty unique strings');
      }
    }
    const protocolSchemes = overlay.desktop.protocols.flatMap((protocol) => protocol.schemes);
    if (new Set(protocolSchemes).size !== protocolSchemes.length) {
      throw new Error('Packaging protocol schemes must be globally unique');
    }
    requireExactKeys(
      overlay.packageMetadata,
      ['name', 'description', 'author', 'repository', 'homepage', 'bugs', 'productName'],
      'Packaging package metadata'
    );
    requireExactKeys(overlay.packageMetadata.author, ['name'], 'Packaging package author');
    requireExactKeys(overlay.packageMetadata.repository, ['type', 'url'], 'Packaging package repository');
    requireExactKeys(overlay.packageMetadata.bugs, ['url'], 'Packaging package bugs');
    requireExactKeys(
      overlay.desktop.publish,
      ['provider', 'owner', 'repo', 'tagNamePrefix'],
      'Packaging publish configuration'
    );
    requireExactKeys(overlay.desktop.linux, ['maintainer', 'vendor', 'desktop'], 'Packaging Linux identity');
    requireExactKeys(overlay.desktop.linux.desktop, ['entry'], 'Packaging Linux desktop identity');
    requireExactKeys(
      overlay.desktop.linux.desktop.entry,
      ['Name', 'Comment', 'Icon', 'Categories', 'MimeType'],
      'Packaging Linux desktop entry'
    );
    requireNonEmptyString(overlay.packageMetadata.name, 'Packaging package name');
    requireNonEmptyString(overlay.packageMetadata.description, 'Packaging package description');
    requireNonEmptyString(overlay.packageMetadata.author.name, 'Packaging package author name');
    if (overlay.packageMetadata.repository.type !== 'git') {
      throw new Error('Packaging package repository type must be git');
    }
    requireAbsoluteHttpUrl(overlay.packageMetadata.repository.url, 'Packaging package repository URL', true);
    requireAbsoluteHttpUrl(overlay.packageMetadata.homepage, 'Packaging package homepage');
    requireAbsoluteHttpUrl(overlay.packageMetadata.bugs.url, 'Packaging package bugs URL');
    requireNonEmptyString(overlay.packageMetadata.productName, 'Packaging package product name');
    requireNonEmptyString(overlay.desktop.productName, 'Packaging product name');
    requireNonEmptyString(overlay.desktop.executableName, 'Packaging executable name');
    requireNonEmptyString(overlay.desktop.copyright, 'Packaging copyright');
    for (const key of ['provider', 'owner', 'repo', 'tagNamePrefix']) {
      requireNonEmptyString(overlay.desktop.publish[key], `Packaging publish ${key}`);
    }
    requireNonEmptyString(overlay.desktop.linux.maintainer, 'Packaging Linux maintainer');
    requireNonEmptyString(overlay.desktop.linux.vendor, 'Packaging Linux vendor');
    for (const [key, value] of Object.entries(overlay.desktop.linux.desktop.entry)) {
      requireNonEmptyString(value, `Packaging Linux desktop entry ${key}`);
    }
    requireMatchingLinuxProtocolHandlers(overlay.desktop.protocols, overlay.desktop.linux.desktop.entry.MimeType);
    if (overlay.packageMetadata.productName !== overlay.desktop.productName) {
      throw new Error('Packaging product names must match');
    }
    if (overlay.desktop.linux.desktop.entry.Name !== overlay.desktop.productName) {
      throw new Error('Packaging Linux desktop name must match the product name');
    }
    requireExactKeys(overlay.resources, ['platform', 'packaged'], 'Packaging resources');
    requireExactKeys(overlay.resources.platform, ['png', 'ico', 'icns'], 'Packaging platform assets');
    requireExactKeys(
      overlay.resources.packaged,
      ['applicationIcon', 'runtimeIcon', 'buildEvidence', 'agentsMcpAdapter', 'bundledAionCore'],
      'Packaging packaged assets'
    );
    for (const [kind, resourcePath] of Object.entries(overlay.resources.platform)) {
      requireSafeRelativePath(resourcePath, `Packaging platform asset ${kind}`);
    }
    for (const [kind, resourcePath] of Object.entries(overlay.resources.packaged)) {
      requireSafeRelativePath(resourcePath, `Packaging packaged resource ${kind}`);
    }
    if (overlay.resources.packaged.runtimeIcon !== productConfig.assets.packaged.icon) {
      throw new Error('Packaging runtime icon path cannot be remapped');
    }
    if (overlay.resources.packaged.agentsMcpAdapter !== DEFAULT_PACKAGED_RESOURCES.agentsMcpAdapter) {
      throw new Error('Packaging Agents MCP Adapter path cannot be remapped');
    }
    if (overlay.resources.packaged.bundledAionCore !== DEFAULT_PACKAGED_RESOURCES.bundledAionCore) {
      throw new Error('Packaging bundled AionCore path cannot be remapped');
    }
  }
  const identity = hasOverlay
    ? clone(overlay)
    : {
        schemaVersion: 1,
        product: { runtimeIdentity: productConfig.runtimeIdentity },
        packageMetadata: clone(productConfig.packageMetadata),
        desktop: clone(productConfig.electronBuilder),
        resources: {
          platform: clone(productConfig.assets.platform),
          packaged: {
            ...DEFAULT_PACKAGED_RESOURCES,
            runtimeIcon: productConfig.assets.packaged.icon,
          },
        },
      };
  return deepFreeze(identity);
}

module.exports = { resolveKiBuddyPackagingIdentity };

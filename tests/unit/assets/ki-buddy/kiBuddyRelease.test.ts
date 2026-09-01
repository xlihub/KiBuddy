import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { load as loadYaml } from 'js-yaml';
import sharp from 'sharp';
import { createProjectPackagingOverlay } from './packagingIdentity.fixture';

const {
  createKiBuddyBuildEvidence,
  createSourceStateSha256,
  createEffectivePackageJson,
  createElectronBuilderConfig,
  readKiBuddyRelease,
  readProductConfig,
  readProductVersion,
  verifyKiBuddyRelease,
  verifyProductPackageJson,
} = require('../../../../packages/shared-scripts/src/kiBuddyRelease');
const projectRoot = resolve(__dirname, '../../../..');

function readPngDimensions(relativePath: string): { height: number; width: number } {
  const data = readFileSync(join(projectRoot, relativePath));
  expect(data.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

function readLargestIcnsPng(relativePath: string): Buffer {
  const data = readFileSync(join(projectRoot, relativePath));
  expect(data.subarray(0, 4).toString('ascii')).toBe('icns');

  let largestPng: Buffer | null = null;
  let largestWidth = 0;
  for (let offset = 8; offset < data.length; ) {
    const chunkLength = data.readUInt32BE(offset + 4);
    expect(chunkLength).toBeGreaterThanOrEqual(8);
    const payload = data.subarray(offset + 8, offset + chunkLength);
    if (payload.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') {
      const width = payload.readUInt32BE(16);
      if (width > largestWidth) {
        largestPng = payload;
        largestWidth = width;
      }
    }
    offset += chunkLength;
  }

  expect(largestPng).not.toBeNull();
  return largestPng!;
}

async function readTransparentMargins(input: Buffer): Promise<{
  bottom: number;
  left: number;
  right: number;
  top: number;
}> {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let minX = info.width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[(y * info.width + x) * info.channels + 3] === 0) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  expect(maxX).toBeGreaterThanOrEqual(0);
  expect(maxY).toBeGreaterThanOrEqual(0);
  return {
    bottom: info.height - maxY - 1,
    left: minX,
    right: info.width - maxX - 1,
    top: minY,
  };
}

function sha256(relativePath: string): string {
  return createHash('sha256')
    .update(readFileSync(join(projectRoot, relativePath)))
    .digest('hex');
}

describe('Ki-Buddy product release identity', () => {
  it('separates source, internal release, public distribution, and runtime update identities', () => {
    expect(readProductConfig(projectRoot)).toMatchObject({
      source: {
        repository: 'xlihub/KiBuddy',
        url: 'https://github.com/xlihub/KiBuddy',
      },
      internalRelease: {
        provider: 'github',
        repository: 'xlihub/KiBuddy',
        tagPrefix: 'ki-buddy-v',
        releasePageUrl: 'https://github.com/xlihub/KiBuddy/releases',
      },
      publicDistribution: {
        provider: 'github',
        repository: 'xlihub/Ki-Buddy',
        releasePageUrl: 'https://github.com/xlihub/Ki-Buddy/releases',
      },
      updates: {
        provider: 'github',
        repository: 'xlihub/Ki-Buddy',
        tagPrefix: 'ki-buddy-v',
        releasePageUrl: 'https://github.com/xlihub/Ki-Buddy/releases',
      },
    });
  });

  it('validates the current product mapping without requiring repository history', () => {
    expect(() => verifyKiBuddyRelease(projectRoot, { skipGit: true })).not.toThrow();
  });

  it('validates the 0.1.8 release context for the private source repository', () => {
    expect(
      verifyKiBuddyRelease(projectRoot, {
        commit: 'a'.repeat(40),
        repository: 'xlihub/KiBuddy',
        skipGit: true,
        tag: 'ki-buddy-v0.1.8',
      })
    ).toMatchObject({
      kiBuddy: {
        repository: 'xlihub/KiBuddy',
        version: '0.1.8',
        tag: 'ki-buddy-v0.1.8',
        releaseCommit: 'a'.repeat(40),
      },
    });
  });

  it.each(['xlihub/Ki-Buddy', 'xlihub/Ki-Core', 'iOfficeAI/AionCore', 'iOfficeAI/AionUi', 'xlihub/Other'])(
    'rejects release preflight from a non-source repository: %s',
    (repository) => {
      expect(() =>
        verifyKiBuddyRelease(projectRoot, {
          commit: 'a'.repeat(40),
          repository,
          skipGit: true,
          tag: 'ki-buddy-v0.1.8',
        })
      ).toThrow('Ki-Buddy release repository must be xlihub/KiBuddy');
    }
  );

  it('allows only declared product dependencies in the upstream package comparison', () => {
    const upstreamPackage = { name: 'AionUi', dependencies: { react: '^19.0.0' } };
    const currentPackage = {
      name: 'AionUi',
      dependencies: { react: '^19.0.0', keytar: '^7.9.0' },
    };

    expect(() => verifyProductPackageJson(currentPackage, upstreamPackage, { keytar: '^7.9.0' })).not.toThrow();
    expect(() =>
      verifyProductPackageJson({ ...currentPackage, name: 'Ki-Buddy' }, upstreamPackage, { keytar: '^7.9.0' })
    ).toThrow('only by declared product dependencies');
    expect(() =>
      verifyProductPackageJson(
        { ...currentPackage, dependencies: { ...currentPackage.dependencies, keytar: '^8.0.0' } },
        upstreamPackage,
        { keytar: '^7.9.0' }
      )
    ).toThrow('must match the product configuration');
  });

  it('stores only the current product release mapping', () => {
    const mapping = JSON.parse(readFileSync(join(projectRoot, 'ki-buddy-release.json'), 'utf8'));

    expect(mapping).not.toHaveProperty('versions');
    expect(mapping.release.version).toBe(readProductVersion(projectRoot));
  });

  it('keeps the Ki-Buddy defaults in the product configuration', () => {
    const config = readProductConfig(projectRoot);
    expect(config.schemaVersion).toBe(4);
    expect(config.defaults).toEqual({
      agentsBaseUrl: 'https://ksapi.kingsware.cn',
      language: 'zh-CN',
    });
    expect(config.experience.features.team).toBe('disabled');
    expect(config.experience.behaviorDefaults.scheduledTaskExecutor).toBe('assistant');
    expect(config.brand.cliName).toBe('Ki CLI');
    expect(config.locale).toEqual({ namespace: 'kiBuddy' });
    expect(config.themes).toEqual({ light: 'ki-buddy-light', dark: 'ki-buddy-dark' });
  });

  it('rejects incomplete or invalid product experience policy at the build boundary', () => {
    const source = JSON.parse(readFileSync(join(projectRoot, 'ki-buddy-product.json'), 'utf8'));
    for (const mutate of [
      (config: typeof source) => {
        delete config.experience.features.team;
      },
      (config: typeof source) => {
        config.experience.features.team = 'preview';
      },
      (config: typeof source) => {
        config.experience.resources.skill.unexpected = 'manage';
      },
      (config: typeof source) => {
        config.experience.features.guid = 'disabled';
        config.experience.features.guidFeedback = 'enabled';
      },
    ]) {
      const tempDir = mkdtempSync(join(tmpdir(), 'ki-buddy-product-config-'));
      try {
        const config = structuredClone(source);
        mutate(config);
        writeFileSync(join(tempDir, 'ki-buddy-product.json'), JSON.stringify(config));
        expect(() => readProductConfig(tempDir)).toThrow();
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    }
  });

  it('declares existing independent platform and renderer brand resources', () => {
    const config = readProductConfig(projectRoot);
    for (const relativePath of Object.values(config.assets.platform)) {
      expect(existsSync(join(projectRoot, relativePath))).toBe(true);
    }
    expect(config.assets.renderer).toEqual({ logo: 'ki-buddy-app', mascot: 'ki-buddy-mascot' });
    expect(readPngDimensions(config.assets.platform.png)).toEqual({ width: 1024, height: 1024 });
    expect(readFileSync(join(projectRoot, config.assets.platform.ico)).subarray(0, 4).toString('hex')).toBe('00000100');
    expect(readFileSync(join(projectRoot, config.assets.platform.icns)).subarray(0, 4).toString('ascii')).toBe('icns');
    expect(readPngDimensions('packages/desktop/src/renderer/assets/ki-buddy/app.png')).toEqual({
      width: 128,
      height: 128,
    });
    expect(readPngDimensions('packages/desktop/src/renderer/assets/ki-buddy/mascot.png')).toEqual({
      width: 256,
      height: 256,
    });
  });

  it('keeps the macOS app artwork centered inside the Dock icon safe area', async () => {
    const largestIcon = readLargestIcnsPng('resources/ki-buddy/app.icns');

    expect(await sharp(largestIcon).metadata()).toMatchObject({ height: 1024, width: 1024 });
    expect(await readTransparentMargins(largestIcon)).toEqual({
      bottom: 100,
      left: 100,
      right: 100,
      top: 100,
    });
  });

  const productConfigSource = JSON.parse(readFileSync(join(projectRoot, 'ki-buddy-product.json'), 'utf8'));

  it.each([
    {
      name: 'an empty runtime identity',
      expectedError: 'Ki-Buddy runtime identity must be a non-empty string',
      mutate: (config: typeof productConfigSource) => {
        config.runtimeIdentity = '';
      },
    },
    {
      name: 'the historical public repository as the source identity',
      expectedError: 'Ki-Buddy source repository identity is invalid',
      mutate: (config: typeof productConfigSource) => {
        config.source.repository = 'xlihub/Ki-Buddy';
      },
    },
    {
      name: 'the historical public repository as the internal release identity',
      expectedError: 'Ki-Buddy internal release identity is invalid',
      mutate: (config: typeof productConfigSource) => {
        config.internalRelease.repository = 'xlihub/Ki-Buddy';
      },
    },
    {
      name: 'the private source repository as the public distribution identity',
      expectedError: 'Ki-Buddy public distribution identity is invalid',
      mutate: (config: typeof productConfigSource) => {
        config.publicDistribution.repository = 'xlihub/KiBuddy';
      },
    },
    {
      name: 'the private source repository as the runtime update identity',
      expectedError: 'Ki-Buddy update configuration is invalid',
      mutate: (config: typeof productConfigSource) => {
        config.updates.repository = 'xlihub/KiBuddy';
      },
    },
    {
      name: 'a non-HTTP Agents base URL',
      expectedError: 'Ki-Buddy default Agents base URL must be an HTTP(S) URL',
      mutate: (config: typeof productConfigSource) => {
        config.defaults.agentsBaseUrl = 'ftp://agents.example.com';
      },
    },
    {
      name: 'an empty default language',
      expectedError: 'Ki-Buddy default language must be a non-empty string',
      mutate: (config: typeof productConfigSource) => {
        config.defaults.language = '';
      },
    },
    {
      name: 'an empty locale namespace',
      expectedError: 'Ki-Buddy locale namespace must be a non-empty string',
      mutate: (config: typeof productConfigSource) => {
        config.locale.namespace = '';
      },
    },
    {
      name: 'an empty dark theme resource id',
      expectedError: 'Ki-Buddy dark theme must be a non-empty resource id',
      mutate: (config: typeof productConfigSource) => {
        config.themes.dark = '';
      },
    },
    {
      name: 'an additional protocol scheme',
      expectedError: 'Ki-Buddy protocol configuration must contain only the independent product protocol',
      mutate: (config: typeof productConfigSource) => {
        config.electronBuilder.protocols[0].schemes.push('unexpected');
      },
    },
    {
      name: 'an unexpected protocol field',
      expectedError: 'Ki-Buddy protocol configuration has unexpected or missing fields',
      mutate: (config: typeof productConfigSource) => {
        config.electronBuilder.protocols[0].unexpected = true;
      },
    },
    {
      name: 'a missing protocol name',
      expectedError: 'Ki-Buddy protocol configuration has unexpected or missing fields',
      mutate: (config: typeof productConfigSource) => {
        delete config.electronBuilder.protocols[0].name;
      },
    },
    {
      name: 'an unexpected publish field',
      expectedError: 'Ki-Buddy electron-builder publish configuration has unexpected or missing fields',
      mutate: (config: typeof productConfigSource) => {
        config.electronBuilder.publish.unexpected = true;
      },
    },
    {
      name: 'a missing publish owner',
      expectedError: 'Ki-Buddy electron-builder publish configuration has unexpected or missing fields',
      mutate: (config: typeof productConfigSource) => {
        delete config.electronBuilder.publish.owner;
      },
    },
    {
      name: 'an unexpected Linux configuration field',
      expectedError: 'Ki-Buddy Linux configuration has unexpected or missing fields',
      mutate: (config: typeof productConfigSource) => {
        config.electronBuilder.linux.unexpected = true;
      },
    },
    {
      name: 'a missing Linux maintainer',
      expectedError: 'Ki-Buddy Linux configuration has unexpected or missing fields',
      mutate: (config: typeof productConfigSource) => {
        delete config.electronBuilder.linux.maintainer;
      },
    },
    {
      name: 'an unexpected Linux desktop field',
      expectedError: 'Ki-Buddy Linux desktop configuration has unexpected or missing fields',
      mutate: (config: typeof productConfigSource) => {
        config.electronBuilder.linux.desktop.unexpected = true;
      },
    },
    {
      name: 'an unexpected Linux desktop entry field',
      expectedError: 'Ki-Buddy Linux desktop entry has unexpected or missing fields',
      mutate: (config: typeof productConfigSource) => {
        config.electronBuilder.linux.desktop.entry.unexpected = true;
      },
    },
    {
      name: 'a missing Linux desktop entry name',
      expectedError: 'Ki-Buddy Linux desktop entry has unexpected or missing fields',
      mutate: (config: typeof productConfigSource) => {
        delete config.electronBuilder.linux.desktop.entry.Name;
      },
    },
    {
      name: 'an incorrect product name',
      expectedError: 'Ki-Buddy brand product name is invalid',
      mutate: (config: typeof productConfigSource) => {
        config.brand.productName = 'Wrong Product';
      },
    },
    {
      name: 'null package author metadata',
      expectedError: 'Ki-Buddy package author must be an object',
      mutate: (config: typeof productConfigSource) => {
        config.packageMetadata.author = null;
      },
    },
    {
      name: 'a non-HTTP package repository URL',
      expectedError: 'Ki-Buddy package repository URL must be an absolute HTTP(S) URL',
      mutate: (config: typeof productConfigSource) => {
        config.packageMetadata.repository.url = 'ftp://github.com/xlihub/KiBuddy.git';
      },
    },
    {
      name: 'a relative package homepage URL',
      expectedError: 'Ki-Buddy package homepage must be an absolute HTTP(S) URL',
      mutate: (config: typeof productConfigSource) => {
        config.packageMetadata.homepage = '/readme';
      },
    },
    {
      name: 'null package bugs metadata',
      expectedError: 'Ki-Buddy package bugs must be an object',
      mutate: (config: typeof productConfigSource) => {
        config.packageMetadata.bugs = null;
      },
    },
  ])('rejects $name', ({ expectedError, mutate }) => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ki-buddy-product-config-'));
    try {
      const config = structuredClone(productConfigSource);
      mutate(config);
      writeFileSync(join(tempDir, 'ki-buddy-product.json'), JSON.stringify(config));
      expect(() => readProductConfig(tempDir)).toThrow(expectedError);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects unknown product configuration fields at the build boundary', () => {
    const source = JSON.parse(readFileSync(join(projectRoot, 'ki-buddy-product.json'), 'utf8'));
    const tempDir = mkdtempSync(join(tmpdir(), 'ki-buddy-product-config-'));
    try {
      source.unexpected = true;
      writeFileSync(join(tempDir, 'ki-buddy-product.json'), JSON.stringify(source));
      expect(() => readProductConfig(tempDir)).toThrow('unexpected or missing fields');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects a release mapping that does not describe the current product version', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ki-buddy-release-mapping-'));
    try {
      for (const file of [
        'ki-buddy-product.json',
        'ki-buddy-version.txt',
        'ki-buddy-release.json',
        'CHANGELOG.ki-buddy.md',
      ]) {
        copyFileSync(join(projectRoot, file), join(tempDir, file));
      }
      writeFileSync(join(tempDir, 'ki-buddy-version.txt'), '9.9.9\n');

      expect(() => readKiBuddyRelease(tempDir)).toThrow('Ki-Buddy release mapping must describe current version 9.9.9');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('combines upstream package data with independent Ki-Buddy product metadata', () => {
    const upstreamPackage = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));
    const productConfig = readProductConfig(projectRoot);
    const productVersion = readProductVersion(projectRoot);
    const effectivePackage = createEffectivePackageJson(projectRoot);

    expect(effectivePackage).toMatchObject({
      ...productConfig.packageMetadata,
      productRuntime: 'ki-buddy',
      version: productVersion,
      main: upstreamPackage.main,
      dependencies: upstreamPackage.dependencies,
    });
    expect(effectivePackage.name).not.toBe(upstreamPackage.name);
    expect(effectivePackage.productName).not.toBe(upstreamPackage.productName);
  });

  it('creates effective package metadata from a resolved project packaging overlay', () => {
    const overlay = createProjectPackagingOverlay();

    expect(createEffectivePackageJson(projectRoot, { packagingOverlay: overlay, version: '3.2.1' })).toMatchObject({
      ...overlay.packageMetadata,
      productRuntime: 'ki-buddy',
      version: '3.2.1',
    });
  });

  it('generates the final electron-builder overlay without modifying package.json', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ki-buddy-builder-config-'));
    const outputPath = join(tempDir, 'electron-builder.json');
    const originalPackage = readFileSync(join(projectRoot, 'package.json'), 'utf8');
    try {
      const config = createElectronBuilderConfig(projectRoot, outputPath);
      const productConfig = readProductConfig(projectRoot);
      const productVersion = readProductVersion(projectRoot);
      expect(config).toMatchObject({
        ...productConfig.electronBuilder,
        win: { icon: 'resources/ki-buddy/app.ico', target: ['nsis'] },
        mac: { icon: 'resources/ki-buddy/app.icns', target: ['dmg', 'zip'] },
        linux: { ...productConfig.electronBuilder.linux, icon: 'resources/ki-buddy/app.png' },
        extraMetadata: {
          ...productConfig.packageMetadata,
          productRuntime: 'ki-buddy',
          version: productVersion,
        },
      });
      expect(config).not.toHaveProperty('extends');
      expect(config.protocols).toEqual(productConfig.electronBuilder.protocols);
      const upstreamBuilder = loadYaml(
        readFileSync(join(projectRoot, 'packages/desktop/electron-builder.yml'), 'utf8')
      ) as { extraResources: Array<{ from: string; to: string }> };
      const expectedResources = upstreamBuilder.extraResources.map((resource) =>
        resource.to === 'app.png' ? Object.assign({}, resource, { from: productConfig.assets.platform.png }) : resource
      );
      expectedResources.push({ from: productConfig.assets.platform.png, to: productConfig.assets.packaged.icon });
      const evidencePath = join(tempDir, 'ki-buddy-build-evidence.json');
      expectedResources.push({ from: evidencePath, to: 'ki-buddy-build-evidence.json' });
      expect(config.extraResources).toEqual(expectedResources);
      expect(JSON.parse(readFileSync(evidencePath, 'utf8'))).toMatchObject({
        schemaVersion: 2,
        product: { runtimeIdentity: 'ki-buddy', productName: 'Ki-Buddy' },
        source: {
          repository: 'xlihub/KiBuddy',
          commit: expect.stringMatching(/^[0-9a-f]{40}$/),
        },
      });
      expect(JSON.parse(readFileSync(outputPath, 'utf8'))).toEqual(config);
      expect(readFileSync(join(projectRoot, 'package.json'), 'utf8')).toBe(originalPackage);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('generates electron-builder configuration from a resolved project packaging overlay', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'project-builder-config-'));
    const outputPath = join(tempDir, 'electron-builder.json');
    const overlay = createProjectPackagingOverlay();
    const originalPackage = readFileSync(join(projectRoot, 'package.json'), 'utf8');
    try {
      const config = createElectronBuilderConfig(projectRoot, outputPath, {
        packagingOverlay: overlay,
        version: '3.2.1',
      });

      expect(config).toMatchObject({
        ...overlay.desktop,
        win: { icon: overlay.resources.platform.ico },
        mac: { icon: overlay.resources.platform.icns },
        linux: { ...overlay.desktop.linux, icon: overlay.resources.platform.png },
        extraMetadata: {
          ...overlay.packageMetadata,
          productRuntime: overlay.product.runtimeIdentity,
          version: '3.2.1',
        },
      });
      expect(config.extraResources).toContainEqual({
        from: overlay.resources.platform.png,
        to: overlay.resources.packaged.applicationIcon,
      });
      expect(config.extraResources).toContainEqual({
        from: overlay.resources.platform.png,
        to: overlay.resources.packaged.runtimeIcon,
      });
      expect(config.extraResources).toContainEqual({
        from: 'resources/bundled-aioncore',
        to: overlay.resources.packaged.bundledAionCore,
      });
      expect(JSON.parse(readFileSync(join(tempDir, overlay.resources.packaged.buildEvidence), 'utf8'))).toMatchObject({
        product: {
          runtimeIdentity: overlay.product.runtimeIdentity,
          productName: overlay.desktop.productName,
        },
        packagingIdentity: overlay,
      });
      expect(readFileSync(join(projectRoot, 'package.json'), 'utf8')).toBe(originalPackage);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('keeps the application name generic while identifying project distribution artifacts', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'project-artifact-name-'));
    const outputPath = join(tempDir, 'electron-builder.json');
    const overlay = createProjectPackagingOverlay();
    overlay.packageMetadata.name = 'ki-buddy-zxjt';
    overlay.packageMetadata.productName = 'Ki-Buddy';
    overlay.desktop.productName = 'Ki-Buddy';
    overlay.desktop.linux.desktop.entry.Name = 'Ki-Buddy';

    try {
      const config = createElectronBuilderConfig(projectRoot, outputPath, {
        packagingOverlay: overlay,
        version: '3.2.1',
        distributionBuildPlan: { distributionId: 'zxjt' },
      });

      expect(config.productName).toBe('Ki-Buddy');
      expect(config.extraMetadata.productName).toBe('Ki-Buddy');
      for (const target of [config.win, config.nsis, config.mac, config.linux]) {
        expect(target.artifactName).toBe('ki-buddy-zxjt-${version}-${os}-${arch}.${ext}');
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('records the exact product policy sources, tested commit, and source-tree state in packaged build evidence', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ki-buddy-build-evidence-'));
    const outputPath = join(tempDir, 'ki-buddy-build-evidence.json');
    const testedCommit = 'a'.repeat(40);
    try {
      const sourceStateSha256 = 'c'.repeat(64);
      const evidence = createKiBuddyBuildEvidence(projectRoot, outputPath, {
        commit: testedCommit,
        dirty: false,
        sourceStateSha256,
      });

      expect(evidence).toEqual({
        schemaVersion: 2,
        product: {
          runtimeIdentity: 'ki-buddy',
          productName: 'Ki-Buddy',
        },
        source: {
          repository: 'xlihub/KiBuddy',
          commit: testedCommit,
          treeDirty: false,
          stateSha256: sourceStateSha256,
        },
        release: {
          internal: {
            provider: 'github',
            repository: 'xlihub/KiBuddy',
            tagPrefix: 'ki-buddy-v',
            releasePageUrl: 'https://github.com/xlihub/KiBuddy/releases',
          },
          publicDistribution: {
            provider: 'github',
            repository: 'xlihub/Ki-Buddy',
            releasePageUrl: 'https://github.com/xlihub/Ki-Buddy/releases',
          },
          runtimeUpdates: {
            provider: 'github',
            repository: 'xlihub/Ki-Buddy',
            tagPrefix: 'ki-buddy-v',
            releasePageUrl: 'https://github.com/xlihub/Ki-Buddy/releases',
          },
        },
        policySources: {
          productConfig: {
            path: 'ki-buddy-product.json',
            sha256: sha256('ki-buddy-product.json'),
          },
          experienceRegistry: {
            path: 'packages/desktop/src/common/platform/ki-buddy/experience/registry.json',
            sha256: sha256('packages/desktop/src/common/platform/ki-buddy/experience/registry.json'),
          },
        },
      });
      expect(JSON.parse(readFileSync(outputPath, 'utf8'))).toEqual(evidence);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('marks build evidence when the packaged source tree contains uncommitted changes', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ki-buddy-dirty-build-evidence-'));
    try {
      expect(
        createKiBuddyBuildEvidence(projectRoot, join(tempDir, 'evidence.json'), {
          commit: 'b'.repeat(40),
          dirty: true,
          sourceStateSha256: 'd'.repeat(64),
        })
      ).toMatchObject({
        source: {
          repository: 'xlihub/KiBuddy',
          commit: 'b'.repeat(40),
          treeDirty: true,
          stateSha256: 'd'.repeat(64),
        },
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('records the immutable project distribution inputs without credential values', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'project-build-evidence-'));
    const sourceCommit = 'a'.repeat(40);
    const buildPlan = {
      schemaVersion: 1,
      distributionId: 'zxjt',
      mode: 'preview',
      version: '0.1.0',
      identityMode: 'local',
      source: { repository: 'xlihub/KiBuddy', commit: sourceCommit, treeState: 'committed' },
      registration: { revision: 'b'.repeat(40) },
      manifest: { digest: 'c'.repeat(64) },
      baseline: { repository: 'xlihub/KiBuddy', commit: 'd'.repeat(40) },
      platforms: ['macos-arm64'],
      integrations: [],
      disabledFeatures: ['account', 'agents', 'about', 'feedback', 'githubResources'],
      runtimeIdentity: {
        dataDirectory: 'Ki-Buddy-ZXJT-Preview',
        credentialNamespace: 'ki-buddy-zxjt-preview',
      },
      kiCore: {
        repository: 'xlihub/Ki-Core',
        tag: 'ki-core-v0.1.4',
        commit: 'e'.repeat(40),
        aionCore: { repository: 'iOfficeAI/AionCore', tag: 'v0.1.72', peeledCommit: 'f'.repeat(40) },
        platform: 'macos-arm64',
        checksum: '1'.repeat(64),
      },
      secretScope: { kind: 'none', names: [] },
    };
    try {
      const evidence = createKiBuddyBuildEvidence(projectRoot, join(tempDir, 'evidence.json'), {
        commit: sourceCommit,
        dirty: false,
        sourceStateSha256: '2'.repeat(64),
        distributionBuildPlan: buildPlan,
      });

      expect(evidence.distribution).toEqual(buildPlan);
      expect(JSON.stringify(evidence.distribution)).not.toMatch(/password|privateKey|token|secretValue/iu);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('changes source-state evidence for package.json, other tracked files, and untracked files', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ki-buddy-source-state-'));
    const packagePath = join(tempDir, 'package.json');
    const trackedPath = join(tempDir, 'tracked.txt');
    const packageContents = '{"name":"upstream"}\n';
    const trackedContents = 'tracked baseline\n';
    try {
      execFileSync('git', ['init', '--quiet'], { cwd: tempDir });
      writeFileSync(packagePath, packageContents);
      writeFileSync(trackedPath, trackedContents);
      execFileSync('git', ['add', 'package.json', 'tracked.txt'], { cwd: tempDir });
      execFileSync(
        'git',
        [
          '-c',
          'user.name=Ki-Buddy Test',
          '-c',
          'user.email=ki-buddy-test@example.com',
          'commit',
          '--quiet',
          '-m',
          'base',
        ],
        { cwd: tempDir }
      );

      const baseline = createSourceStateSha256(tempDir);
      writeFileSync(packagePath, '{"name":"modified-product"}\n');
      expect(createSourceStateSha256(tempDir)).not.toBe(baseline);

      writeFileSync(packagePath, packageContents);
      writeFileSync(trackedPath, 'tracked modification\n');
      expect(createSourceStateSha256(tempDir)).not.toBe(baseline);

      writeFileSync(trackedPath, trackedContents);
      writeFileSync(join(tempDir, 'untracked.txt'), 'untracked evidence\n');
      expect(createSourceStateSha256(tempDir)).not.toBe(baseline);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('excludes temporary build-output backups from source-state evidence', () => {
    const backupOutDir = join(projectRoot, `.tmp-out-backup-${process.pid}-${randomUUID()}`);
    const baseline = createSourceStateSha256(projectRoot);
    try {
      mkdirSync(backupOutDir, { recursive: true });
      writeFileSync(join(backupOutDir, '.build-hash'), 'temporary build cache\n');

      expect(createSourceStateSha256(projectRoot)).toBe(baseline);
    } finally {
      rmSync(backupOutDir, { recursive: true, force: true });
    }
  });

  it('records the full AionUi, Ki-Core and AionCore mapping', () => {
    const identity = readKiBuddyRelease(projectRoot);
    expect(identity.kiBuddySource).toEqual({
      repository: 'xlihub/KiBuddy',
      url: 'https://github.com/xlihub/KiBuddy',
    });
    expect(identity.publicDistribution).toEqual({
      provider: 'github',
      repository: 'xlihub/Ki-Buddy',
      releasePageUrl: 'https://github.com/xlihub/Ki-Buddy/releases',
    });
    expect(identity.runtimeUpdates).toEqual({
      provider: 'github',
      repository: 'xlihub/Ki-Buddy',
      tagPrefix: 'ki-buddy-v',
      releasePageUrl: 'https://github.com/xlihub/Ki-Buddy/releases',
    });
    expect(identity.kiBuddy.tag).toBe(`ki-buddy-v${identity.kiBuddy.version}`);
    expect(identity.kiCore.tag).toBe(`ki-core-v${identity.kiCore.version}`);
    expect(identity.aionUi.tag).toMatch(/^v\d+\.\d+\.\d+$/);
    expect(identity.aionUi.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(identity.aionCore.tag).toMatch(/^v\d+\.\d+\.\d+$/);
    expect(identity.aionCore.peeledCommit).toMatch(/^[0-9a-f]{40}$/);
  });
});

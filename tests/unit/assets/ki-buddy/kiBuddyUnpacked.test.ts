import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createProjectPackagingOverlay } from './packagingIdentity.fixture';

const {
  materializeKiBuddyInstaller,
  verifyKiBuddyUnpacked,
  verifyKiBuddyWindowsInstallation,
} = require('../../../../packages/shared-scripts/src/kiBuddyUnpacked');
const { readProductConfig } = require('../../../../packages/shared-scripts/src/kiBuddyRelease');
const { resolveKiBuddyPackagingIdentity } = require('../../../../packages/shared-scripts/src/kiBuddyPackagingIdentity');
const projectRoot = resolve(__dirname, '../../../..');

function projectBuildPlan(packagingIdentity, platform = 'linux-x64') {
  return {
    schemaVersion: 1,
    distributionId: 'zxjt',
    mode: 'preview',
    version: '0.1.0',
    identityMode: 'local',
    source: { repository: 'xlihub/KiBuddy', commit: 'a'.repeat(40), treeState: 'committed' },
    registration: { revision: 'b'.repeat(40) },
    manifest: { digest: 'c'.repeat(64) },
    baseline: { repository: 'xlihub/KiBuddy', commit: 'd'.repeat(40) },
    platforms: [platform],
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
      sourcePolicy: 'release-pinned',
      version: '0.1.4',
      checksums: { [platform]: '1'.repeat(64) },
    },
    secretScope: { kind: 'none', names: [] },
    packagingIdentity,
  };
}

function distributionEvidence(buildPlan) {
  return Object.fromEntries(
    [
      'schemaVersion',
      'distributionId',
      'mode',
      'version',
      'identityMode',
      'source',
      'registration',
      'manifest',
      'baseline',
      'platforms',
      'integrations',
      'disabledFeatures',
      'runtimeIdentity',
      'kiCore',
      'secretScope',
    ].map((key) => [key, buildPlan[key]])
  );
}

function writePeFile(filePath: string, arch: 'x64' | 'arm64') {
  const contents = Buffer.alloc(128);
  contents.write('MZ', 0, 'ascii');
  contents.writeUInt32LE(64, 0x3c);
  contents.writeUInt32LE(0x00004550, 64);
  contents.writeUInt16LE(arch === 'x64' ? 0x8664 : 0xaa64, 68);
  writeFileSync(filePath, contents);
}

function createLinuxFixture(expectedIdentity?, expectedBuildPlan?) {
  const packagingIdentity = expectedIdentity ?? resolveKiBuddyPackagingIdentity(readProductConfig(projectRoot));
  const root = mkdtempSync(join(tmpdir(), 'ki-buddy-unpacked-'));
  const resourcesDir = join(root, 'resources');
  mkdirSync(dirname(join(resourcesDir, packagingIdentity.resources.packaged.applicationIcon)), { recursive: true });
  mkdirSync(dirname(join(resourcesDir, packagingIdentity.resources.packaged.runtimeIcon)), { recursive: true });
  mkdirSync(dirname(join(resourcesDir, packagingIdentity.resources.packaged.buildEvidence)), { recursive: true });
  mkdirSync(dirname(join(resourcesDir, packagingIdentity.resources.packaged.agentsMcpAdapter)), { recursive: true });
  const runtimeDirectory = join(resourcesDir, packagingIdentity.resources.packaged.bundledAionCore, 'linux-x64');
  const managedResourcesDir = join(runtimeDirectory, 'managed-resources');
  mkdirSync(join(managedResourcesDir, 'node', 'node-v24-linux-x64', 'bin'), { recursive: true });
  writeFileSync(
    join(resourcesDir, 'app.asar'),
    packagingIdentity.desktop.protocols.flatMap((protocol) => protocol.schemes).join('\n')
  );
  writeFileSync(join(root, packagingIdentity.desktop.executableName), 'executable');
  copyFileSync(
    join(projectRoot, packagingIdentity.resources.platform.png),
    join(resourcesDir, packagingIdentity.resources.packaged.applicationIcon)
  );
  copyFileSync(
    join(projectRoot, packagingIdentity.resources.platform.png),
    join(resourcesDir, packagingIdentity.resources.packaged.runtimeIcon)
  );
  writeFileSync(join(resourcesDir, packagingIdentity.resources.packaged.agentsMcpAdapter), 'adapter');
  if (expectedBuildPlan) {
    writeFileSync(
      join(runtimeDirectory, 'manifest.json'),
      JSON.stringify({
        schemaVersion: 3,
        platform: 'linux',
        arch: 'x64',
        source: {
          policy: expectedBuildPlan.kiCore.sourcePolicy,
          repository: expectedBuildPlan.kiCore.repository,
          tag: expectedBuildPlan.kiCore.tag,
        },
        kiCore: {
          version: expectedBuildPlan.kiCore.version,
          tag: expectedBuildPlan.kiCore.tag,
          releaseCommit: expectedBuildPlan.kiCore.commit,
        },
        aionCore: expectedBuildPlan.kiCore.aionCore,
      })
    );
  }
  const evidence = {
    schemaVersion: 2,
    product: {
      runtimeIdentity: packagingIdentity.product.runtimeIdentity,
      productName: packagingIdentity.desktop.productName,
    },
    ...(expectedIdentity ? { packagingIdentity } : {}),
    ...(expectedBuildPlan ? { distribution: distributionEvidence(expectedBuildPlan) } : {}),
    ...(expectedBuildPlan
      ? {
          source: {
            repository: expectedBuildPlan.source.repository,
            commit: expectedBuildPlan.source.commit,
            treeDirty: false,
            stateSha256: '2'.repeat(64),
          },
        }
      : {}),
  };
  writeFileSync(join(resourcesDir, packagingIdentity.resources.packaged.buildEvidence), JSON.stringify(evidence));
  writeFileSync(
    join(managedResourcesDir, 'manifest.json'),
    JSON.stringify({
      schemaVersion: 2,
      runtimeKey: 'linux-x64',
      node: {
        version: '24.0.0',
        root: 'node/node-v24-linux-x64',
        executable: 'bin/node',
      },
      clis: [],
    })
  );
  writeFileSync(join(managedResourcesDir, 'node', 'node-v24-linux-x64', 'bin', 'node'), 'node');
  return root;
}

function createWindowsFixture(
  identity,
  buildPlan,
  {
    executableArch,
    nativeModuleArch,
    runtimeArch,
  }: { executableArch?: 'x64' | 'arm64'; nativeModuleArch?: 'x64' | 'arm64'; runtimeArch?: 'x64' | 'arm64' } = {}
) {
  const selectedPlatform = buildPlan.platforms.find((platform: string) => platform.startsWith('windows-'));
  const expectedArch = selectedPlatform?.slice('windows-'.length);
  if (expectedArch !== 'x64' && expectedArch !== 'arm64') throw new Error('Windows fixture requires one platform');
  const fixtureRuntimeArch = runtimeArch ?? expectedArch;
  const root = createLinuxFixture(identity, buildPlan);
  const resourcesDir = join(root, 'resources');
  const linuxRuntimeDirectory = join(resourcesDir, identity.resources.packaged.bundledAionCore, 'linux-x64');
  const windowsRuntimeDirectory = join(
    resourcesDir,
    identity.resources.packaged.bundledAionCore,
    `win32-${fixtureRuntimeArch}`
  );
  const windowsNodeRoot = join(
    windowsRuntimeDirectory,
    'managed-resources',
    'node',
    `node-v24-win-${fixtureRuntimeArch}`
  );
  const executablePath = join(root, `${identity.desktop.executableName}.exe`);

  renameSync(join(root, identity.desktop.executableName), executablePath);
  writePeFile(executablePath, executableArch ?? expectedArch);
  renameSync(linuxRuntimeDirectory, windowsRuntimeDirectory);
  renameSync(join(windowsRuntimeDirectory, 'managed-resources', 'node', 'node-v24-linux-x64'), windowsNodeRoot);
  renameSync(join(windowsNodeRoot, 'bin', 'node'), join(windowsNodeRoot, 'node.exe'));

  const nativeModulePath = join(
    resourcesDir,
    'app.asar.unpacked',
    'node_modules',
    'better-sqlite3',
    'build',
    'Release',
    'better_sqlite3.node'
  );
  mkdirSync(dirname(nativeModulePath), { recursive: true });
  writePeFile(nativeModulePath, nativeModuleArch ?? expectedArch);

  const runtimeManifestPath = join(windowsRuntimeDirectory, 'manifest.json');
  const runtimeManifest = JSON.parse(readFileSync(runtimeManifestPath, 'utf8'));
  runtimeManifest.platform = 'win32';
  runtimeManifest.arch = fixtureRuntimeArch;
  writeFileSync(runtimeManifestPath, JSON.stringify(runtimeManifest));

  const managedManifestPath = join(windowsRuntimeDirectory, 'managed-resources', 'manifest.json');
  const managedManifest = JSON.parse(readFileSync(managedManifestPath, 'utf8'));
  managedManifest.runtimeKey = `win32-${fixtureRuntimeArch}`;
  managedManifest.node.root = `node/node-v24-win-${fixtureRuntimeArch}`;
  managedManifest.node.executable = 'node.exe';
  writeFileSync(managedManifestPath, JSON.stringify(managedManifest));
  return root;
}

function createMacFixture(expectedIdentity, bundleIdentifier: string, expectedBuildPlan?) {
  const packagingIdentity = expectedIdentity;
  const root = mkdtempSync(join(tmpdir(), 'ki-buddy-mac-unpacked-'));
  const applicationRoot = join(root, `${packagingIdentity.desktop.productName}.app`);
  const contentsDir = join(applicationRoot, 'Contents');
  const resourcesDir = join(contentsDir, 'Resources');
  const executablePath = join(contentsDir, 'MacOS', packagingIdentity.desktop.executableName);
  const runtimeKey = expectedBuildPlan ? 'darwin-arm64' : 'darwin-x64';
  const runtimeDirectory = join(resourcesDir, packagingIdentity.resources.packaged.bundledAionCore, runtimeKey);
  const managedResourcesDir = join(runtimeDirectory, 'managed-resources');
  mkdirSync(dirname(executablePath), { recursive: true });
  mkdirSync(dirname(join(resourcesDir, packagingIdentity.resources.packaged.applicationIcon)), { recursive: true });
  mkdirSync(dirname(join(resourcesDir, packagingIdentity.resources.packaged.runtimeIcon)), { recursive: true });
  mkdirSync(dirname(join(resourcesDir, packagingIdentity.resources.packaged.buildEvidence)), { recursive: true });
  mkdirSync(dirname(join(resourcesDir, packagingIdentity.resources.packaged.agentsMcpAdapter)), { recursive: true });
  mkdirSync(join(managedResourcesDir, 'node', `node-v24-${runtimeKey}`, 'bin'), { recursive: true });
  writeFileSync(
    join(resourcesDir, 'app.asar'),
    packagingIdentity.desktop.protocols.flatMap((protocol) => protocol.schemes).join('\n')
  );
  writeFileSync(executablePath, 'executable');
  copyFileSync(
    join(projectRoot, packagingIdentity.resources.platform.png),
    join(resourcesDir, packagingIdentity.resources.packaged.applicationIcon)
  );
  copyFileSync(
    join(projectRoot, packagingIdentity.resources.platform.png),
    join(resourcesDir, packagingIdentity.resources.packaged.runtimeIcon)
  );
  writeFileSync(join(resourcesDir, packagingIdentity.resources.packaged.agentsMcpAdapter), 'adapter');
  writeFileSync(
    join(resourcesDir, packagingIdentity.resources.packaged.buildEvidence),
    JSON.stringify({
      schemaVersion: 2,
      product: {
        runtimeIdentity: packagingIdentity.product.runtimeIdentity,
        productName: packagingIdentity.desktop.productName,
      },
      packagingIdentity,
      ...(expectedBuildPlan ? { distribution: distributionEvidence(expectedBuildPlan) } : {}),
      ...(expectedBuildPlan
        ? {
            source: {
              repository: expectedBuildPlan.source.repository,
              commit: expectedBuildPlan.source.commit,
              treeDirty: false,
              stateSha256: '2'.repeat(64),
            },
          }
        : {}),
    })
  );
  if (expectedBuildPlan) {
    const sourcePolicy = expectedBuildPlan.kiCore.sourcePolicy ?? 'release-pinned';
    writeFileSync(
      join(runtimeDirectory, 'manifest.json'),
      JSON.stringify({
        schemaVersion: 3,
        platform: 'darwin',
        arch: 'arm64',
        source: {
          policy: sourcePolicy,
          repository: expectedBuildPlan.kiCore.repository,
          ...(sourcePolicy === 'candidate'
            ? {
                workflow: expectedBuildPlan.kiCore.candidate.workflow,
                runId: String(expectedBuildPlan.kiCore.candidate.runId),
                headSha: expectedBuildPlan.kiCore.commit,
                artifactName: expectedBuildPlan.kiCore.candidate.artifacts['macos-arm64'],
                checksum: expectedBuildPlan.kiCore.checksums['macos-arm64'],
              }
            : { tag: expectedBuildPlan.kiCore.tag }),
        },
        kiCore: {
          version: expectedBuildPlan.kiCore.version ?? expectedBuildPlan.kiCore.tag.replace(/^ki-core-v/u, ''),
          tag: expectedBuildPlan.kiCore.tag,
          releaseCommit: expectedBuildPlan.kiCore.commit,
        },
        aionCore: expectedBuildPlan.kiCore.aionCore,
      })
    );
  }
  writeFileSync(
    join(managedResourcesDir, 'manifest.json'),
    JSON.stringify({
      schemaVersion: 2,
      runtimeKey,
      node: {
        version: '24.0.0',
        root: `node/node-v24-${runtimeKey}`,
        executable: 'bin/node',
      },
      clis: [],
    })
  );
  writeFileSync(join(managedResourcesDir, 'node', `node-v24-${runtimeKey}`, 'bin', 'node'), 'node');
  writeFileSync(
    join(contentsDir, 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDisplayName</key><string>${packagingIdentity.desktop.productName}</string>
  <key>CFBundleExecutable</key><string>${packagingIdentity.desktop.executableName}</string>
  <key>CFBundleIdentifier</key><string>${bundleIdentifier}</string>
  <key>CFBundleURLTypes</key>
  <array><dict><key>CFBundleURLSchemes</key><array><string>${packagingIdentity.desktop.protocols[0].schemes[0]}</string></array></dict></array>
</dict>
</plist>`
  );
  return root;
}

describe('Ki-Buddy unpacked product verification', () => {
  it('runs artifact validation without installing build-only dependencies', () => {
    const isolatedRoot = mkdtempSync(join(tmpdir(), 'ki-buddy-verifier-dependencies-'));
    try {
      const scripts = 'packages/shared-scripts/src';
      cpSync(join(projectRoot, scripts), join(isolatedRoot, scripts), { recursive: true });
      const registry = 'packages/desktop/src/common/platform/ki-buddy/experience/registry.json';
      mkdirSync(dirname(join(isolatedRoot, registry)), { recursive: true });
      copyFileSync(join(projectRoot, registry), join(isolatedRoot, registry));
      copyFileSync(join(projectRoot, 'ki-buddy-product.json'), join(isolatedRoot, 'ki-buddy-product.json'));

      const output = execFileSync(
        process.execPath,
        [
          '-e',
          `const { verifyKiBuddyUnpacked } = require('./packages/shared-scripts/src/kiBuddyUnpacked');
           try { verifyKiBuddyUnpacked(process.cwd(), 'missing-application', 'win32'); }
           catch (error) { process.stdout.write(error.message); }`,
        ],
        { cwd: isolatedRoot, env: { ...process.env, NODE_PATH: '' }, encoding: 'utf8', stdio: 'pipe' }
      );

      expect(output).toContain('win32 packaged executable is missing:');
    } finally {
      rmSync(isolatedRoot, { recursive: true, force: true });
    }
  });

  it('materializes a Linux application from the installer payload', () => {
    const identity = createProjectPackagingOverlay();
    const tempRoot = mkdtempSync(join(tmpdir(), 'ki-buddy-installer-test-'));
    const installerPath = join(tempRoot, 'ki-buddy-zxjt.deb');
    writeFileSync(installerPath, 'installer');
    const calls: Array<{ command: string; args: string[] }> = [];
    const materialized = materializeKiBuddyInstaller(installerPath, 'linux-x64', identity, {
      tempRoot,
      execute(command: string, args: string[]) {
        calls.push({ command, args });
        const applicationRoot = join(tempRoot, 'package', 'opt', 'Ki-Buddy');
        mkdirSync(dirname(join(applicationRoot, 'resources', identity.resources.packaged.buildEvidence)), {
          recursive: true,
        });
        writeFileSync(join(applicationRoot, 'resources', identity.resources.packaged.buildEvidence), '{}');
      },
    });

    expect(calls).toEqual([
      {
        command: 'dpkg-deb',
        args: ['--extract', installerPath, join(tempRoot, 'package')],
      },
    ]);
    expect(materialized.unpackedPath).toBe(join(tempRoot, 'package', 'opt', 'Ki-Buddy'));
    materialized.cleanup();
    expect(existsSync(tempRoot)).toBe(false);
  });

  it('fails when a Windows installer does not produce an installed application', () => {
    const identity = createProjectPackagingOverlay();
    const tempRoot = mkdtempSync(join(tmpdir(), 'ki-buddy-installer-test-'));
    const installerPath = join(tempRoot, 'ki-buddy-zxjt.exe');
    writeFileSync(installerPath, 'installer');

    expect(() =>
      materializeKiBuddyInstaller(installerPath, 'windows-arm64', identity, {
        tempRoot,
        execute() {},
      })
    ).toThrow('did not create the requested installation directory');
    expect(existsSync(tempRoot)).toBe(false);
  });

  it('materializes and cleans a Windows application installed by the NSIS executable', () => {
    const identity = createProjectPackagingOverlay();
    const tempRoot = mkdtempSync(join(tmpdir(), 'ki-buddy-installer-test-'));
    const installerPath = join(tempRoot, 'ki-buddy-zxjt.exe');
    const installPath = join(tempRoot, 'installed');
    const uninstallPath = join(installPath, `Uninstall ${identity.desktop.productName}.exe`);
    writeFileSync(installerPath, 'installer');
    const calls: Array<{ command: string; args: string[] }> = [];

    const materialized = materializeKiBuddyInstaller(installerPath, 'windows-x64', identity, {
      tempRoot,
      execute(command: string, args: string[]) {
        calls.push({ command, args });
        if (command === installerPath) {
          mkdirSync(installPath, { recursive: true });
          writeFileSync(uninstallPath, 'uninstaller');
        }
      },
    });

    expect(materialized).toMatchObject({ packageRoot: installPath, unpackedPath: installPath });
    materialized.cleanup();
    expect(calls).toEqual([
      { command: installerPath, args: ['/S', `/D=${installPath}`] },
      { command: uninstallPath, args: ['/S'] },
    ]);
    expect(existsSync(tempRoot)).toBe(false);
  });

  it('accepts an unpacked app with the configured executable and product icons', () => {
    const fixture = createLinuxFixture();
    try {
      expect(verifyKiBuddyUnpacked(projectRoot, fixture, 'linux')).toMatchObject({
        platform: 'linux',
        productName: 'Ki-Buddy',
        agentsMcpAdapterPath: expect.stringContaining('builtin-mcp-agents.js'),
        managedNodePath: expect.stringContaining(join('node-v24-linux-x64', 'bin', 'node')),
      });
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('accepts an unpacked app that matches an expected project packaging identity', () => {
    const identity = createProjectPackagingOverlay();
    const fixture = createLinuxFixture(identity);
    try {
      expect(verifyKiBuddyUnpacked(projectRoot, fixture, 'linux', identity)).toMatchObject({
        platform: 'linux',
        productName: 'Acme Buddy',
        executablePath: expect.stringContaining('Acme-Buddy'),
      });
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('checks Linux installer desktop metadata, protocol handler, and installed icon', () => {
    const identity = createProjectPackagingOverlay();
    const fixture = createLinuxFixture(identity);
    const desktopDirectory = join(fixture, 'usr', 'share', 'applications');
    const iconDirectory = join(fixture, 'usr', 'share', 'icons', 'hicolor', '512x512', 'apps');
    mkdirSync(desktopDirectory, { recursive: true });
    mkdirSync(iconDirectory, { recursive: true });
    writeFileSync(
      join(desktopDirectory, `${identity.desktop.executableName}.desktop`),
      `[Desktop Entry]\nName=${identity.desktop.productName}\nExec=/opt/Ki-Buddy/${identity.desktop.executableName} %U\nIcon=${identity.desktop.executableName}\nMimeType=x-scheme-handler/${identity.desktop.protocols[0].schemes[0]};\n`
    );
    copyFileSync(
      join(projectRoot, identity.resources.platform.png),
      join(iconDirectory, `${identity.desktop.executableName}.png`)
    );
    try {
      expect(verifyKiBuddyUnpacked(projectRoot, fixture, 'linux', identity, undefined, fixture)).toMatchObject({
        platform: 'linux',
      });
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('rejects a Linux installer desktop entry with the wrong protocol handler', () => {
    const identity = createProjectPackagingOverlay();
    const fixture = createLinuxFixture(identity);
    const desktopDirectory = join(fixture, 'usr', 'share', 'applications');
    const iconDirectory = join(fixture, 'usr', 'share', 'icons', 'hicolor', '512x512', 'apps');
    mkdirSync(desktopDirectory, { recursive: true });
    mkdirSync(iconDirectory, { recursive: true });
    writeFileSync(
      join(desktopDirectory, `${identity.desktop.executableName}.desktop`),
      `[Desktop Entry]\nName=${identity.desktop.productName}\nExec=/opt/Ki-Buddy/${identity.desktop.executableName} %U\nIcon=${identity.desktop.executableName}\nMimeType=x-scheme-handler/wrong-protocol;\n`
    );
    writeFileSync(join(iconDirectory, `${identity.desktop.executableName}.png`), 'icon');
    try {
      expect(() => verifyKiBuddyUnpacked(projectRoot, fixture, 'linux', identity, undefined, fixture)).toThrow(
        'Linux desktop metadata does not match'
      );
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('requires complete project evidence when a default-valued identity is passed explicitly', () => {
    const identity = resolveKiBuddyPackagingIdentity(readProductConfig(projectRoot));
    const fixture = createLinuxFixture();
    try {
      expect(() => verifyKiBuddyUnpacked(projectRoot, fixture, 'linux', identity)).toThrow(
        'Project packaging build evidence is missing its resolved identity'
      );
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('accepts complete project evidence for an explicitly passed default-valued identity', () => {
    const identity = resolveKiBuddyPackagingIdentity(readProductConfig(projectRoot));
    const fixture = createLinuxFixture(identity);
    try {
      expect(verifyKiBuddyUnpacked(projectRoot, fixture, 'linux', identity)).toMatchObject({
        platform: 'linux',
        productName: 'Ki-Buddy',
      });
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('accepts project evidence that matches the immutable distribution build plan', () => {
    const identity = createProjectPackagingOverlay();
    const buildPlan = projectBuildPlan(identity);
    const fixture = createLinuxFixture(identity, buildPlan);
    try {
      expect(verifyKiBuddyUnpacked(projectRoot, fixture, 'linux', identity, buildPlan)).toMatchObject({
        platform: 'linux',
      });
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it.each(['windows-x64', 'windows-arm64'])(
    'verifies %s unpacked output through the existing CLI without installing it',
    (platform) => {
      const identity = resolveKiBuddyPackagingIdentity(readProductConfig(projectRoot));
      const fixture = createWindowsFixture(identity, projectBuildPlan(identity, platform));
      try {
        const output = execFileSync(
          process.execPath,
          [
            join(projectRoot, 'packages/shared-scripts/src/kiBuddyUnpacked.js'),
            '--platform',
            'win32',
            '--path',
            fixture,
          ],
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
        );

        expect(JSON.parse(output)).toMatchObject({
          platform: 'win32',
          executablePath: join(fixture, `${identity.desktop.executableName}.exe`),
        });
      } finally {
        rmSync(fixture, { recursive: true, force: true });
      }
    }
  );

  it.each(['windows-x64', 'windows-arm64'])(
    'accepts a %s installation with matching architecture, metadata, protocol, and provenance',
    (platform) => {
      const identity = createProjectPackagingOverlay();
      const buildPlan = projectBuildPlan(identity, platform);
      const fixture = createWindowsFixture(identity, buildPlan);
      const executablePath = join(fixture, `${identity.desktop.executableName}.exe`);
      let inspectedSchemes: string[] = [];

      try {
        expect(verifyKiBuddyUnpacked(projectRoot, fixture, 'win32', identity, buildPlan)).toMatchObject({
          platform: 'win32',
          executablePath,
        });
        expect(() =>
          verifyKiBuddyWindowsInstallation(fixture, identity, platform, {
            readWindowsExecutableMetadata: () => ({
              productName: identity.desktop.productName,
              iconWidth: 32,
              iconHeight: 32,
            }),
            readWindowsProtocolRegistrations: (schemes: string[]) => {
              inspectedSchemes = schemes;
              return schemes.map((scheme) => ({
                scheme,
                urlProtocolPresent: true,
                command: `"${executablePath}" "%1"`,
              }));
            },
          })
        ).not.toThrow();
        expect(inspectedSchemes).toEqual(identity.desktop.protocols[0].schemes);
      } finally {
        rmSync(fixture, { recursive: true, force: true });
      }
    }
  );

  it('rejects an x64 Windows executable for an ARM64 artifact', () => {
    const identity = createProjectPackagingOverlay();
    const buildPlan = projectBuildPlan(identity, 'windows-arm64');
    const fixture = createWindowsFixture(identity, buildPlan, { executableArch: 'x64' });
    try {
      expect(() => verifyKiBuddyWindowsInstallation(fixture, identity, 'windows-arm64')).toThrow(
        'Windows executable architecture does not match the artifact platform'
      );
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('rejects an x64 native module for an ARM64 artifact', () => {
    const identity = createProjectPackagingOverlay();
    const buildPlan = projectBuildPlan(identity, 'windows-arm64');
    const fixture = createWindowsFixture(identity, buildPlan, { nativeModuleArch: 'x64' });
    try {
      expect(() => verifyKiBuddyWindowsInstallation(fixture, identity, 'windows-arm64')).toThrow(
        'Windows better-sqlite3 architecture does not match the artifact platform'
      );
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('rejects a Windows executable without a valid associated icon', () => {
    const identity = createProjectPackagingOverlay();
    const buildPlan = projectBuildPlan(identity, 'windows-x64');
    const fixture = createWindowsFixture(identity, buildPlan);
    try {
      expect(() =>
        verifyKiBuddyWindowsInstallation(fixture, identity, 'windows-x64', {
          readWindowsExecutableMetadata: () => ({
            productName: identity.desktop.productName,
            iconWidth: 0,
            iconHeight: 0,
          }),
        })
      ).toThrow('Windows executable metadata or icon does not match');
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('rejects a Windows installation whose protocol command does not open the installed executable', () => {
    const identity = createProjectPackagingOverlay();
    const buildPlan = projectBuildPlan(identity, 'windows-x64');
    const fixture = createWindowsFixture(identity, buildPlan);
    try {
      expect(() =>
        verifyKiBuddyWindowsInstallation(fixture, identity, 'windows-x64', {
          readWindowsExecutableMetadata: () => ({
            productName: identity.desktop.productName,
            iconWidth: 32,
            iconHeight: 32,
          }),
          readWindowsProtocolRegistrations: (schemes: string[]) =>
            schemes.map((scheme) => ({
              scheme,
              urlProtocolPresent: true,
              command: '"C:\\Other\\Application.exe" "%1"',
            })),
        })
      ).toThrow('Windows URL protocol registration does not match');
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('rejects a packaged app that does not contain its configured protocol', () => {
    const identity = createProjectPackagingOverlay();
    const fixture = createLinuxFixture(identity);
    try {
      writeFileSync(join(fixture, 'resources', 'app.asar'), 'no configured protocol');
      expect(() => verifyKiBuddyUnpacked(projectRoot, fixture, 'linux', identity)).toThrow(
        'Packaged app protocol does not match'
      );
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('rejects project evidence whose source no longer matches the resolved build plan', () => {
    const identity = createProjectPackagingOverlay();
    const packagedPlan = projectBuildPlan(identity);
    const expectedPlan = structuredClone(packagedPlan);
    expectedPlan.source.commit = '9'.repeat(40);
    const fixture = createLinuxFixture(identity, packagedPlan);
    try {
      expect(() => verifyKiBuddyUnpacked(projectRoot, fixture, 'linux', identity, expectedPlan)).toThrow(
        'distribution does not match'
      );
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('rejects project evidence produced from a dirty source tree', () => {
    const identity = createProjectPackagingOverlay();
    const buildPlan = projectBuildPlan(identity);
    const fixture = createLinuxFixture(identity, buildPlan);
    try {
      const evidencePath = join(fixture, 'resources', identity.resources.packaged.buildEvidence);
      const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
      evidence.source.treeDirty = true;
      writeFileSync(evidencePath, JSON.stringify(evidence));

      expect(() => verifyKiBuddyUnpacked(projectRoot, fixture, 'linux', identity, buildPlan)).toThrow(
        'clean committed source'
      );
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('rejects packaged evidence that does not match the expected installation identity', () => {
    const packagedIdentity = createProjectPackagingOverlay();
    const expectedIdentity = structuredClone(packagedIdentity);
    expectedIdentity.desktop.appId = 'com.example.different';
    const fixture = createLinuxFixture(packagedIdentity);
    try {
      expect(() => verifyKiBuddyUnpacked(projectRoot, fixture, 'linux', expectedIdentity)).toThrow(
        'Packaging build evidence resolved identity does not match the expected identity'
      );
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it.runIf(process.platform === 'darwin')('accepts a macOS project app with release-pinned Ki-Core provenance', () => {
    const identity = createProjectPackagingOverlay();
    const buildPlan = projectBuildPlan(identity, 'macos-arm64');
    const fixture = createMacFixture(identity, identity.desktop.appId, buildPlan);
    try {
      expect(verifyKiBuddyUnpacked(projectRoot, fixture, 'darwin', identity, buildPlan)).toMatchObject({
        platform: 'darwin',
        managedNodePath: expect.stringContaining('darwin-arm64'),
      });
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it.runIf(process.platform === 'darwin')(
    'accepts a macOS project app with verified Ki-Core candidate provenance',
    () => {
      const identity = createProjectPackagingOverlay();
      const buildPlan = projectBuildPlan(identity, 'macos-arm64');
      buildPlan.kiCore = {
        ...buildPlan.kiCore,
        sourcePolicy: 'candidate',
        version: '0.1.5',
        tag: null,
        candidate: {
          workflow: 'build-manual.yml',
          runId: 801,
          artifacts: { 'macos-arm64': 'ki-core-candidate-macos-arm64' },
        },
      };
      const fixture = createMacFixture(identity, identity.desktop.appId, buildPlan);
      try {
        expect(verifyKiBuddyUnpacked(projectRoot, fixture, 'darwin', identity, buildPlan)).toMatchObject({
          platform: 'darwin',
          managedNodePath: expect.stringContaining('darwin-arm64'),
        });
      } finally {
        rmSync(fixture, { recursive: true, force: true });
      }
    }
  );

  it.runIf(process.platform === 'darwin')('rejects a macOS project app with unapproved Ki-Core provenance', () => {
    const identity = createProjectPackagingOverlay();
    const buildPlan = projectBuildPlan(identity, 'macos-arm64');
    const fixture = createMacFixture(identity, identity.desktop.appId, buildPlan);
    try {
      const manifestPath = join(
        fixture,
        `${identity.desktop.productName}.app`,
        'Contents',
        'Resources',
        identity.resources.packaged.bundledAionCore,
        'darwin-arm64',
        'manifest.json'
      );
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      manifest.source.policy = 'development';
      writeFileSync(manifestPath, JSON.stringify(manifest));

      expect(() => verifyKiBuddyUnpacked(projectRoot, fixture, 'darwin', identity, buildPlan)).toThrow(
        'Ki-Core provenance does not match'
      );
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it.runIf(process.platform === 'darwin')(
    'rejects a macOS app whose bundle identifier does not match the project identity',
    () => {
      const identity = createProjectPackagingOverlay();
      const fixture = createMacFixture(identity, 'com.example.wrong');
      try {
        expect(() => verifyKiBuddyUnpacked(projectRoot, fixture, 'darwin', identity)).toThrow(
          'CFBundleIdentifier does not match'
        );
      } finally {
        rmSync(fixture, { recursive: true, force: true });
      }
    }
  );

  it('rejects an unpacked app without build evidence', () => {
    const fixture = createLinuxFixture();
    try {
      rmSync(join(fixture, 'resources', 'ki-buddy-build-evidence.json'));
      expect(() => verifyKiBuddyUnpacked(projectRoot, fixture, 'linux')).toThrow('Packaging build evidence is missing');
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('rejects a packaged icon that does not use the configured project resource', () => {
    const identity = createProjectPackagingOverlay();
    const fixture = createLinuxFixture(identity);
    try {
      writeFileSync(join(fixture, 'resources', identity.resources.packaged.applicationIcon), 'packaged app icon');

      expect(() => verifyKiBuddyUnpacked(projectRoot, fixture, 'linux', identity)).toThrow(
        'linux application icon must use the configured project resource'
      );
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('rejects an empty packaged project icon', () => {
    const identity = createProjectPackagingOverlay();
    const fixture = createLinuxFixture(identity);
    try {
      writeFileSync(join(fixture, 'resources', identity.resources.packaged.applicationIcon), '');

      expect(() => verifyKiBuddyUnpacked(projectRoot, fixture, 'linux', identity)).toThrow(
        'linux application icon packaged resource must not be empty'
      );
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('rejects an unpacked app missing the Agents MCP Adapter entry', () => {
    const fixture = createLinuxFixture();
    try {
      rmSync(join(fixture, 'resources', 'app.asar.unpacked', 'out', 'main', 'builtin-mcp-agents.js'));
      expect(() => verifyKiBuddyUnpacked(projectRoot, fixture, 'linux')).toThrow('Agents MCP Adapter is missing');
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('rejects an unpacked app missing the managed Node executable', () => {
    const fixture = createLinuxFixture();
    try {
      rmSync(
        join(
          fixture,
          'resources',
          'bundled-aioncore',
          'linux-x64',
          'managed-resources',
          'node',
          'node-v24-linux-x64',
          'bin',
          'node'
        )
      );
      expect(() => verifyKiBuddyUnpacked(projectRoot, fixture, 'linux')).toThrow('managed Node executable is missing');
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});

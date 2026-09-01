import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createProjectPackagingOverlay } from './packagingIdentity.fixture';

const { verifyKiBuddyUnpacked } = require('../../../../packages/shared-scripts/src/kiBuddyUnpacked');
const { readProductConfig } = require('../../../../packages/shared-scripts/src/kiBuddyRelease');
const { resolveKiBuddyPackagingIdentity } = require('../../../../packages/shared-scripts/src/kiBuddyPackagingIdentity');
const projectRoot = resolve(__dirname, '../../../..');

function projectBuildPlan(packagingIdentity) {
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

function createLinuxFixture(expectedIdentity?, expectedBuildPlan?) {
  const packagingIdentity = expectedIdentity ?? resolveKiBuddyPackagingIdentity(readProductConfig(projectRoot));
  const root = mkdtempSync(join(tmpdir(), 'ki-buddy-unpacked-'));
  const resourcesDir = join(root, 'resources');
  mkdirSync(dirname(join(resourcesDir, packagingIdentity.resources.packaged.applicationIcon)), { recursive: true });
  mkdirSync(dirname(join(resourcesDir, packagingIdentity.resources.packaged.runtimeIcon)), { recursive: true });
  mkdirSync(dirname(join(resourcesDir, packagingIdentity.resources.packaged.buildEvidence)), { recursive: true });
  mkdirSync(dirname(join(resourcesDir, packagingIdentity.resources.packaged.agentsMcpAdapter)), { recursive: true });
  const managedResourcesDir = join(
    resourcesDir,
    packagingIdentity.resources.packaged.bundledAionCore,
    'linux-x64',
    'managed-resources'
  );
  mkdirSync(join(managedResourcesDir, 'node', 'node-v24-linux-x64', 'bin'), { recursive: true });
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
                artifactName: expectedBuildPlan.kiCore.candidate.artifactName,
                checksum: expectedBuildPlan.kiCore.checksum,
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
    const buildPlan = projectBuildPlan(identity);
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
      const buildPlan = projectBuildPlan(identity);
      buildPlan.kiCore = {
        ...buildPlan.kiCore,
        sourcePolicy: 'candidate',
        version: '0.1.5',
        tag: null,
        candidate: {
          workflow: 'build-manual.yml',
          runId: 801,
          artifactName: 'ki-core-candidate-macos-arm64',
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
    const buildPlan = projectBuildPlan(identity);
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

  it('rejects an unpacked app containing an upstream icon', () => {
    const fixture = createLinuxFixture();
    try {
      writeFileSync(join(fixture, 'resources/app.png'), 'upstream icon');
      expect(() => verifyKiBuddyUnpacked(projectRoot, fixture, 'linux')).toThrow(
        'does not match the configured Ki-Buddy product resource'
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

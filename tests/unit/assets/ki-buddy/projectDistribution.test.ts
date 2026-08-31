import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

const { resolveProjectDistributionBuildPlan } = require('../../../../packages/shared-scripts/src/projectDistribution');

const SOURCE_SHA = '1234567890abcdef1234567890abcdef12345678';
const REGISTRATION_REVISION = 'abcdef1234567890abcdef1234567890abcdef12';
const BASELINE_SHA = 'fedcba0987654321fedcba0987654321fedcba09';

function createRegistration(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    registrations: [
      {
        distributionId: 'zxjt',
        lifecycle: 'active',
        identityMode: 'local',
        identities: {
          formal: {
            appId: 'com.xlihub.ki-buddy.zxjt',
            applicationName: 'Ki-Buddy',
            executableName: 'Ki-Buddy-ZXJT',
            protocolScheme: 'ki-buddy-zxjt',
            dataDirectory: 'Ki-Buddy-ZXJT',
            credentialNamespace: 'ki-buddy-zxjt',
          },
          preview: {
            appId: 'com.xlihub.ki-buddy.zxjt.preview',
            applicationName: 'Ki-Buddy',
            executableName: 'Ki-Buddy-ZXJT-Preview',
            protocolScheme: 'ki-buddy-zxjt-preview',
            dataDirectory: 'Ki-Buddy-ZXJT-Preview',
            credentialNamespace: 'ki-buddy-zxjt-preview',
          },
        },
        allowed: {
          platforms: ['macos-arm64'],
          integrations: [],
          disabledFeatures: ['account', 'about', 'feedback', 'githubResources'],
          nonSensitiveConfigKeys: [],
        },
        ...overrides,
      },
    ],
  };
}

function createManifest(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    distributionId: 'zxjt',
    version: '0.1.0',
    baseline: {
      repository: 'xlihub/KiBuddy',
      commit: BASELINE_SHA,
    },
    brand: {
      productName: 'Ki-Buddy',
      packageName: 'ki-buddy-zxjt',
      description: 'Ki-Buddy is an AI agent desktop workspace.',
    },
    identityMode: 'local',
    integrations: [],
    disabledFeatures: ['account', 'about', 'feedback', 'githubResources'],
    nonSensitiveConfig: {},
    resources: {
      png: 'resources/ki-buddy/app.png',
      ico: 'resources/ki-buddy/app.ico',
      icns: 'resources/ki-buddy/app.icns',
    },
    platforms: ['macos-arm64'],
    ...overrides,
  };
}

function createKiCore() {
  return {
    repository: 'xlihub/Ki-Core',
    tag: 'ki-core-v0.1.4',
    commit: '3c4055eb65b7b9d1f2f80ce6008bdf1dae9469cc',
    aionCore: {
      repository: 'iOfficeAI/AionCore',
      tag: 'v0.1.72',
      peeledCommit: '57a34cc1b1a3b17bcc023de06b9e6768fceac36f',
    },
    checksums: {
      'macos-arm64': '95d91e02ee3c4da693e7c51ecfa6b732176e8bea92bb028990da6de9033941c9',
    },
  };
}

function resolve(
  overrides: {
    registry?: unknown;
    manifest?: unknown;
    source?: unknown;
    requestedPlatforms?: string[];
  } = {}
) {
  return resolveProjectDistributionBuildPlan({
    registry: overrides.registry ?? createRegistration(),
    manifest: overrides.manifest ?? createManifest(),
    mode: 'preview',
    source: overrides.source ?? ({ repository: 'xlihub/KiBuddy', commit: SOURCE_SHA, treeState: 'committed' } as const),
    registrationRevision: REGISTRATION_REVISION,
    requestedPlatforms: overrides.requestedPlatforms ?? ['macos-arm64'],
    kiCore: createKiCore(),
  });
}

describe('project distribution build contract', () => {
  it('keeps the checked-in zxjt registration and distribution manifest example resolvable together', () => {
    const projectRoot = resolvePath(__dirname, '../../../..');
    const registry = JSON.parse(readFileSync(resolvePath(projectRoot, 'distributions/registry.json'), 'utf8'));
    const manifest = JSON.parse(
      readFileSync(resolvePath(projectRoot, 'distributions/examples/zxjt.manifest.json'), 'utf8')
    );
    const branchManifest = JSON.parse(readFileSync(resolvePath(projectRoot, 'distribution-manifest.json'), 'utf8'));

    expect(branchManifest).toEqual(manifest);

    expect(resolve({ registry, manifest })).toMatchObject({
      distributionId: 'zxjt',
      identityMode: 'local',
      packagingIdentity: {
        desktop: {
          appId: 'com.xlihub.ki-buddy.zxjt.preview',
          productName: 'Ki-Buddy',
        },
      },
    });
    expect(() =>
      execFileSync('git', ['merge-base', '--is-ancestor', manifest.baseline.commit, 'HEAD'], {
        cwd: projectRoot,
        stdio: 'ignore',
      })
    ).not.toThrow();
  });

  it('resolves a frozen local preview plan with isolated identity and no credential scope', () => {
    const plan = resolve();

    expect(plan).toMatchObject({
      schemaVersion: 1,
      mode: 'preview',
      distributionId: 'zxjt',
      version: '0.1.0',
      identityMode: 'local',
      source: { repository: 'xlihub/KiBuddy', commit: SOURCE_SHA },
      registration: { revision: REGISTRATION_REVISION },
      baseline: { commit: BASELINE_SHA },
      platforms: ['macos-arm64'],
      runtimeIdentity: {
        dataDirectory: 'Ki-Buddy-ZXJT-Preview',
        credentialNamespace: 'ki-buddy-zxjt-preview',
      },
      packagingIdentity: {
        desktop: {
          appId: 'com.xlihub.ki-buddy.zxjt.preview',
          executableName: 'Ki-Buddy-ZXJT-Preview',
          productName: 'Ki-Buddy',
        },
      },
      secretScope: { kind: 'none', names: [] },
      productConfig: {
        distribution: {
          distributionId: 'zxjt',
          identityMode: 'local',
          integrations: [],
          mode: 'preview',
        },
        experience: {
          features: {
            account: 'disabled',
            agents: 'enabled',
            about: 'disabled',
            feedback: 'disabled',
            githubResources: 'disabled',
          },
        },
      },
    });
    expect(plan.manifest.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(plan.kiCore.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.isFrozen(plan)).toBe(true);
  });

  it('rejects unknown registration fields', () => {
    expect(() => resolve({ registry: createRegistration({ customer: 'hidden' }) })).toThrowError(
      /registration.*invalid fields/i
    );
  });

  it.each([
    ['invalid SemVer', createManifest({ version: '1.0' }), /version.*SemVer/i],
    ['external identity', createManifest({ identityMode: 'external' }), /identityMode.*local, agents/i],
    ['distribution mismatch', createManifest({ distributionId: 'project-002' }), /not registered/i],
    [
      'scope expansion',
      createManifest({ integrations: ['agentsGateway'] }),
      /integration agentsGateway is not allowed/i,
    ],
    [
      'feature scope expansion',
      createManifest({ disabledFeatures: ['account', 'about', 'feedback', 'system'] }),
      /feature system is not allowed/i,
    ],
  ])('rejects %s in the project manifest', (_label, manifest, error) => {
    expect(() => resolve({ manifest })).toThrowError(error as RegExp);
  });

  it('rejects a manifest that omits a feature required to be disabled for this product package', () => {
    const manifest = createManifest();
    manifest.disabledFeatures = manifest.disabledFeatures.filter((feature) => feature !== 'feedback');

    expect(() => resolve({ manifest })).toThrowError(/disabled features.*match/i);
  });

  it('rejects identity collisions across registered distributions', () => {
    const registry = createRegistration();
    registry.registrations.push({
      ...structuredClone(registry.registrations[0]),
      distributionId: 'project-002',
    });

    expect(() => resolve({ registry })).toThrowError(/identity collision/i);
  });

  it('allows the generic Ki-Buddy display name when technical identities remain isolated', () => {
    const registry = createRegistration();
    const second = structuredClone(registry.registrations[0]);
    second.distributionId = 'project-002';
    for (const mode of ['formal', 'preview'] as const) {
      const identity = second.identities[mode];
      identity.appId += '.project-002';
      identity.executableName += '-Project-002';
      identity.protocolScheme += '-project-002';
      identity.dataDirectory += '-Project-002';
      identity.credentialNamespace += '-project-002';
    }
    registry.registrations.push(second);

    expect(() => resolve({ registry })).not.toThrow();
  });

  it('rejects case-insensitive identity collisions with AionUi', () => {
    const registry = createRegistration();
    registry.registrations[0].identities.preview.appId = 'COM.AIONUI.APP';

    expect(() => resolve({ registry })).toThrowError(/identity collision.*AionUi appId/i);
  });

  it('rejects data and credential collisions with the default Ki-Buddy profile', () => {
    const dataRegistry = createRegistration();
    dataRegistry.registrations[0].identities.preview.dataDirectory = 'ki-buddy';
    const credentialRegistry = createRegistration();
    credentialRegistry.registrations[0].identities.preview.credentialNamespace = 'ki-buddy';

    expect(() => resolve({ registry: dataRegistry })).toThrowError(/identity collision.*dataDirectory/i);
    expect(() => resolve({ registry: credentialRegistry })).toThrowError(/identity collision.*credentialNamespace/i);
  });

  it('rejects project identities that can escape their installation namespace', () => {
    const registry = createRegistration();
    registry.registrations[0].identities.preview.dataDirectory = '../Ki-Buddy';

    expect(() => resolve({ registry })).toThrowError(/dataDirectory.*invalid/i);
  });

  it('allows preview builds while a project registration is suspended', () => {
    expect(() => resolve({ registry: createRegistration({ lifecycle: 'suspended' }) })).not.toThrow();
  });

  it('rejects preview builds after a project registration is retired', () => {
    expect(() => resolve({ registry: createRegistration({ lifecycle: 'retired' }) })).toThrowError(
      /retired project registrations cannot create previews/i
    );
  });

  it('rejects invalid source evidence before resolving project code', () => {
    expect(() =>
      resolve({ source: { repository: 'xlihub/KiBuddy', commit: 'main', treeState: 'committed' } })
    ).toThrowError(/source commit.*full lowercase/i);
  });

  it.each(['apiToken', 'apiKey', 'accessKey', 'authorization', 'bearer', 'cookie', 'session'])(
    'rejects sensitive key %s in non-sensitive project configuration',
    (key) => {
      expect(() =>
        resolve({ manifest: createManifest({ nonSensitiveConfig: { [key]: 'should-not-be-here' } }) })
      ).toThrowError(/nonSensitiveConfig.*sensitive key/i);
    }
  );

  it('rejects harmless-looking configuration that is not allowed by the trusted registration', () => {
    expect(() => resolve({ manifest: createManifest({ nonSensitiveConfig: { deployment: 'local' } }) })).toThrowError(
      /nonSensitiveConfig.*not allowed/i
    );
  });

  it('rejects preview requests for a formal credential scope', () => {
    expect(() =>
      resolve({ manifest: createManifest({ nonSensitiveConfig: { credentialScope: 'formal' } }) })
    ).toThrowError(/credential/i);
  });
});

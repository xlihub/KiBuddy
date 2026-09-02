import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve as resolvePath } from 'node:path';

const {
  createFormalBranchRulesetEvidence,
  createProjectDistributionBuildMatrix,
  createProjectDistributionCandidateRecord,
  createProjectDistributionPlatformVerification,
  createProjectKiCoreCandidateProvenance,
  mergeProjectKiCoreCandidateProvenance,
  resolveProjectDistributionBuildPlan,
  verifyFormalSourceReachability,
  verifyProjectDistributionArtifact,
} = require('../../../../packages/shared-scripts/src/projectDistribution');

const SOURCE_SHA = '1234567890abcdef1234567890abcdef12345678';
const REGISTRATION_REVISION = 'abcdef1234567890abcdef1234567890abcdef12';
const BASELINE_SHA = 'fedcba0987654321fedcba0987654321fedcba09';

function createRegistration(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 2,
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
          platforms: {
            preview: ['macos-arm64'],
            formal: ['macos-arm64'],
          },
          requiredPlatforms: {
            preview: [],
            formal: [],
          },
          integrations: [],
          disabledFeatures: ['account', 'about', 'feedback', 'githubResources'],
          nonSensitiveConfigKeys: [],
          buildCredentialNames: [],
        },
        ...overrides,
      },
    ],
  };
}

function createManifest(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 2,
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
    platforms: {
      preview: ['macos-arm64'],
      formal: ['macos-arm64'],
    },
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
      'macos-x64': '258570bdb23bc519ca31ddaab65515a77aeea0dc485ec418ea3acbf29dabb270',
      'macos-arm64': '95d91e02ee3c4da693e7c51ecfa6b732176e8bea92bb028990da6de9033941c9',
      'windows-x64': 'f596000c538c94257988c69c28635d2a1a80e26d01ebdfb619d04e94adea21ec',
      'windows-arm64': '281a5ee61d81a1368b52f1cb5fa5a05aa0b9b0b7eedfb12b8a713c0625f0bf90',
      'linux-x64': '9c835ed206e85b4285486bf8bed7d1acfdfdaacc149822f310305a785977a617',
      'linux-arm64': '2776ddb271261498ec37b10817ee77af2db5f1b49afcacdd5c183f3d234c8d9a',
    },
  };
}

function createCandidateKiCore() {
  return {
    sourcePolicy: 'candidate',
    repository: 'xlihub/Ki-Core',
    version: '0.1.5',
    tag: null,
    commit: '34567890abcdef1234567890abcdef1234567890',
    aionCore: {
      repository: 'iOfficeAI/AionCore',
      tag: 'v0.1.73',
      peeledCommit: '4567890abcdef1234567890abcdef12345678901',
    },
    checksums: { 'macos-arm64': '3'.repeat(64) },
    candidate: {
      workflow: 'build-manual.yml',
      runId: 801,
      artifacts: { 'macos-arm64': 'ki-core-candidate-macos-arm64' },
    },
  };
}

function createMultiPlatformFormalPlan() {
  const platforms = ['macos-x64', 'macos-arm64', 'windows-x64', 'windows-arm64', 'linux-x64', 'linux-arm64'];
  const registry = createRegistration();
  registry.registrations[0].allowed.platforms = { preview: platforms, formal: platforms };
  const manifest = createManifest({ platforms: { preview: platforms, formal: platforms } });
  const kiCore = createKiCore();
  kiCore.checksums = {
    'macos-x64': '1'.repeat(64),
    'macos-arm64': '2'.repeat(64),
    'windows-x64': '3'.repeat(64),
    'windows-arm64': '4'.repeat(64),
    'linux-x64': '5'.repeat(64),
    'linux-arm64': '6'.repeat(64),
  };
  return resolveFormal({ registry, manifest, requestedPlatforms: platforms, kiCore });
}

function createPlatformVerifications(buildPlan: ReturnType<typeof resolveFormal>) {
  const extensions: Record<string, string> = {
    'macos-x64': 'dmg',
    'macos-arm64': 'dmg',
    'windows-x64': 'exe',
    'windows-arm64': 'exe',
    'linux-x64': 'deb',
    'linux-arm64': 'deb',
  };
  return buildPlan.platforms.map((platform: string, index: number) =>
    createProjectDistributionPlatformVerification(buildPlan, {
      platform,
      fileName: `ki-buddy-zxjt-${platform}.${extensions[platform]}`,
      checksum: String(index + 4).repeat(64),
    })
  );
}

function createDeliveryRecords(deliveries: unknown[] = []) {
  return { schemaVersion: 1, deliveries };
}

function resolveFormal(
  overrides: {
    registry?: unknown;
    manifest?: unknown;
    source?: unknown;
    deliveryRecords?: unknown;
    requestedPlatforms?: string[];
    candidate?: unknown;
    kiCore?: unknown;
    requestedCredentialNames?: string[];
  } = {}
) {
  return resolveProjectDistributionBuildPlan({
    registry: overrides.registry ?? createRegistration(),
    manifest: overrides.manifest ?? createManifest(),
    deliveryRecords: overrides.deliveryRecords ?? createDeliveryRecords(),
    mode: 'formal',
    source:
      overrides.source ??
      ({
        repository: 'xlihub/KiBuddy',
        commit: SOURCE_SHA,
        treeState: 'committed',
        branch: 'distribution/zxjt',
        branchHead: '234567890abcdef1234567890abcdef123456789',
        ruleset: { ruleTypes: ['deletion', 'non_fast_forward'], rulesetIds: [17] },
      } as const),
    registrationRevision: REGISTRATION_REVISION,
    requestedPlatforms: overrides.requestedPlatforms ?? ['macos-arm64'],
    requestedCredentialNames: overrides.requestedCredentialNames ?? [],
    candidate: overrides.candidate ?? { runId: 4501, runAttempt: 2 },
    kiCore: overrides.kiCore ?? createKiCore(),
  });
}

function resolve(
  overrides: {
    registry?: unknown;
    manifest?: unknown;
    source?: unknown;
    requestedPlatforms?: string[];
    kiCore?: unknown;
  } = {}
) {
  return resolveProjectDistributionBuildPlan({
    registry: overrides.registry ?? createRegistration(),
    manifest: overrides.manifest ?? createManifest(),
    mode: 'preview',
    source: overrides.source ?? ({ repository: 'xlihub/KiBuddy', commit: SOURCE_SHA, treeState: 'committed' } as const),
    registrationRevision: REGISTRATION_REVISION,
    requestedPlatforms: overrides.requestedPlatforms ?? ['macos-arm64'],
    kiCore: overrides.kiCore ?? createKiCore(),
  });
}

function createReachabilityRepository() {
  const repository = mkdtempSync(resolvePath(tmpdir(), 'project-source-reachability-'));
  execFileSync('git', ['init'], { cwd: repository, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'tests@example.com'], { cwd: repository });
  execFileSync('git', ['config', 'user.name', 'Project Tests'], { cwd: repository });
  writeFileSync(resolvePath(repository, 'source.txt'), 'protected\n');
  execFileSync('git', ['add', 'source.txt'], { cwd: repository });
  execFileSync('git', ['commit', '-m', 'protected source'], { cwd: repository, stdio: 'ignore' });
  const protectedSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim();
  execFileSync('git', ['update-ref', 'refs/remotes/origin/distribution/zxjt', protectedSha], {
    cwd: repository,
  });
  writeFileSync(resolvePath(repository, 'source.txt'), 'unreachable\n');
  execFileSync('git', ['commit', '-am', 'unreachable source'], { cwd: repository, stdio: 'ignore' });
  const unreachableSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim();
  return { repository, protectedSha, unreachableSha };
}

describe('project distribution build contract', () => {
  it('normalizes active GitHub branch rules into immutable source evidence', () => {
    const evidence = createFormalBranchRulesetEvidence([
      { type: 'non_fast_forward', ruleset_id: 17 },
      { type: 'deletion', ruleset_id: 17 },
    ]);

    expect(evidence).toEqual({ ruleTypes: ['deletion', 'non_fast_forward'], rulesetIds: [17] });
    expect(Object.isFrozen(evidence)).toBe(true);
  });

  it('rejects branch rules without non-fast-forward protection', () => {
    expect(() => createFormalBranchRulesetEvidence([{ type: 'deletion', ruleset_id: 17 }])).toThrowError(
      /non_fast_forward/i
    );
  });

  it('accepts a source SHA reachable from the fetched distribution branch', () => {
    const { repository, protectedSha } = createReachabilityRepository();
    try {
      expect(verifyFormalSourceReachability(repository, protectedSha, 'distribution/zxjt')).toEqual({
        commit: protectedSha,
        branch: 'distribution/zxjt',
        branchHead: protectedSha,
      });
    } finally {
      rmSync(repository, { recursive: true, force: true });
    }
  });

  it('rejects a source SHA that is not reachable from the fetched distribution branch', () => {
    const { repository, unreachableSha } = createReachabilityRepository();
    try {
      expect(() => verifyFormalSourceReachability(repository, unreachableSha, 'distribution/zxjt')).toThrowError(
        /not reachable/i
      );
    } finally {
      rmSync(repository, { recursive: true, force: true });
    }
  });

  it('normalizes a verified Ki-Core Actions artifact for the formal contract', () => {
    const provenance = createProjectKiCoreCandidateProvenance(
      {
        manifest: {
          product: { version: '0.1.5', tag: null, releaseCommit: '3'.repeat(40) },
          upstream: { repository: 'iOfficeAI/AionCore', tag: 'v0.1.73', peeledCommit: '4'.repeat(40) },
        },
        source: {
          policy: 'candidate',
          repository: 'xlihub/Ki-Core',
          workflow: 'build-manual.yml',
          runId: '801',
          headSha: '3'.repeat(40),
          version: '0.1.5',
          artifactName: 'ki-core-candidate-macos-arm64',
          checksum: '5'.repeat(64),
          url: 'https://api.github.com/repos/xlihub/Ki-Core/actions/artifacts/12/zip',
        },
      },
      'macos-arm64'
    );

    expect(provenance).toEqual({
      sourcePolicy: 'candidate',
      repository: 'xlihub/Ki-Core',
      version: '0.1.5',
      tag: null,
      commit: '3'.repeat(40),
      aionCore: { repository: 'iOfficeAI/AionCore', tag: 'v0.1.73', peeledCommit: '4'.repeat(40) },
      checksums: { 'macos-arm64': '5'.repeat(64) },
      candidate: {
        workflow: 'build-manual.yml',
        runId: 801,
        artifacts: { 'macos-arm64': 'ki-core-candidate-macos-arm64' },
      },
    });
  });

  it('merges verified Ki-Core artifacts without allowing their immutable provenance to diverge', () => {
    const macos = createProjectKiCoreCandidateProvenance(
      {
        manifest: {
          product: { version: '0.1.5', tag: null, releaseCommit: '3'.repeat(40) },
          upstream: { repository: 'iOfficeAI/AionCore', tag: 'v0.1.73', peeledCommit: '4'.repeat(40) },
        },
        source: {
          policy: 'candidate',
          repository: 'xlihub/Ki-Core',
          workflow: 'build-manual.yml',
          runId: '801',
          headSha: '3'.repeat(40),
          version: '0.1.5',
          artifactName: 'ki-core-candidate-macos-arm64',
          checksum: '5'.repeat(64),
          url: 'https://api.github.com/repos/xlihub/Ki-Core/actions/artifacts/12/zip',
        },
      },
      'macos-arm64'
    );
    const windows = structuredClone(macos);
    windows.checksums = { 'windows-x64': '6'.repeat(64) };
    windows.candidate.artifacts = { 'windows-x64': 'ki-core-candidate-windows-x64' };

    expect(mergeProjectKiCoreCandidateProvenance([macos, windows], ['macos-arm64', 'windows-x64'])).toMatchObject({
      checksums: { 'macos-arm64': '5'.repeat(64), 'windows-x64': '6'.repeat(64) },
      candidate: {
        workflow: 'build-manual.yml',
        runId: 801,
        artifacts: {
          'macos-arm64': 'ki-core-candidate-macos-arm64',
          'windows-x64': 'ki-core-candidate-windows-x64',
        },
      },
    });

    windows.commit = '7'.repeat(40);
    expect(() => mergeProjectKiCoreCandidateProvenance([macos, windows], ['macos-arm64', 'windows-x64'])).toThrowError(
      /provenance.*consistent/i
    );
  });

  it('keeps the checked-in zxjt registration and distribution manifest example resolvable together', () => {
    const projectRoot = resolvePath(__dirname, '../../../..');
    const registry = JSON.parse(readFileSync(resolvePath(projectRoot, 'distributions/registry.json'), 'utf8'));
    const manifest = JSON.parse(
      readFileSync(resolvePath(projectRoot, 'distributions/examples/zxjt.manifest.json'), 'utf8')
    );
    const branchManifest = JSON.parse(readFileSync(resolvePath(projectRoot, 'distribution-manifest.json'), 'utf8'));
    const deliveryRecords = JSON.parse(
      readFileSync(resolvePath(projectRoot, 'distributions/delivery-records.json'), 'utf8')
    );

    expect(branchManifest).toEqual(manifest);
    expect(manifest).toMatchObject({
      schemaVersion: 2,
      platforms: {
        preview: ['macos-arm64'],
        formal: ['windows-x64', 'windows-arm64'],
      },
    });
    expect(registry.registrations[0].allowed).toMatchObject({
      platforms: {
        preview: ['macos-arm64'],
        formal: ['windows-x64', 'windows-arm64'],
      },
      requiredPlatforms: {
        preview: ['macos-arm64'],
        formal: ['windows-x64', 'windows-arm64'],
      },
    });

    expect(resolve({ registry, manifest, requestedPlatforms: ['macos-arm64'] })).toMatchObject({
      distributionId: 'zxjt',
      identityMode: 'local',
      platforms: ['macos-arm64'],
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
    expect(
      resolveFormal({
        registry,
        manifest,
        deliveryRecords,
        requestedPlatforms: ['windows-x64', 'windows-arm64'],
      }).deliveryHistory.deliveredVersions
    ).toEqual([]);
  });

  it('keeps delivery record schema platforms and checksums aligned with the supported project build matrix', () => {
    const projectRoot = resolvePath(__dirname, '../../../..');
    const schema = JSON.parse(
      readFileSync(resolvePath(projectRoot, 'distributions/schemas/delivery-record.schema.json'), 'utf8')
    );
    const supportedPlatforms = createProjectDistributionBuildMatrix(createMultiPlatformFormalPlan()).include.map(
      ({ platform }) => platform
    );

    const deliveryProperties = schema.properties.deliveries.items.properties;

    expect(deliveryProperties.platforms.items.enum).toEqual(supportedPlatforms);
    expect(deliveryProperties.installerChecksums).toMatchObject({
      minProperties: 1,
      propertyNames: { enum: supportedPlatforms },
    });
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
    expect(plan.kiCore.checksums['macos-arm64']).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.isFrozen(plan)).toBe(true);
  });

  it('resolves preview platforms from a mode-specific schema v2 policy', () => {
    const registry = createRegistration();
    registry.registrations[0].allowed.platforms = {
      preview: ['macos-arm64'],
      formal: ['windows-x64', 'windows-arm64'],
    };
    registry.registrations[0].allowed.requiredPlatforms = {
      preview: ['macos-arm64'],
      formal: ['windows-x64', 'windows-arm64'],
    };
    const manifest = createManifest({
      platforms: {
        preview: ['macos-arm64'],
        formal: ['windows-x64', 'windows-arm64'],
      },
    });

    const plan = resolve({ registry, manifest, requestedPlatforms: ['macos-arm64'] });

    expect(plan.platforms).toEqual(['macos-arm64']);
    expect(createProjectDistributionBuildMatrix(plan).include).toEqual([
      expect.objectContaining({ platform: 'macos-arm64', os: 'macos-14', runtimePlatform: 'darwin' }),
    ]);
  });

  it('creates a preview build matrix for all six supported project platforms', () => {
    const platforms = ['macos-x64', 'macos-arm64', 'windows-x64', 'windows-arm64', 'linux-x64', 'linux-arm64'];
    const registry = createRegistration();
    registry.registrations[0].allowed.platforms = { preview: platforms, formal: platforms };
    const manifest = createManifest({ platforms: { preview: platforms, formal: platforms } });
    const kiCore = createKiCore();
    kiCore.checksums = Object.fromEntries(platforms.map((platform, index) => [platform, String(index + 1).repeat(64)]));

    const plan = resolve({ registry, manifest, requestedPlatforms: platforms, kiCore });

    expect(createProjectDistributionBuildMatrix(plan).include.map(({ platform }) => platform)).toEqual(platforms);
  });

  it('rejects schema v1 registries and manifests', () => {
    const registry = createRegistration();
    registry.schemaVersion = 1;
    const manifest = createManifest();
    manifest.schemaVersion = 1;

    expect(() => resolve({ registry })).toThrowError(/unsupported project distribution registry schema/i);
    expect(() => resolve({ manifest })).toThrowError(/unsupported project distribution manifest schema/i);
  });

  it('rejects a required platform outside the trusted allowlist', () => {
    const registry = createRegistration();
    registry.registrations[0].allowed.requiredPlatforms.formal = ['windows-arm64'];

    expect(() => resolve({ registry })).toThrowError(/required platforms formal must be allowed/i);
  });

  it('rejects a partial platform request for a multi-platform manifest', () => {
    const platforms = ['macos-x64', 'macos-arm64', 'windows-x64', 'windows-arm64', 'linux-x64', 'linux-arm64'];
    const registry = createRegistration();
    registry.registrations[0].allowed.platforms = { preview: platforms, formal: platforms };
    const manifest = createManifest({ platforms: { preview: platforms, formal: platforms } });

    expect(() =>
      resolveFormal({ registry, manifest, requestedPlatforms: ['windows-x64'], kiCore: createKiCore() })
    ).toThrowError(/must exactly match.*manifest/i);
  });

  it('isolates formal platforms from the preview platform policy in schema v2', () => {
    const registry = createRegistration();
    registry.registrations[0].allowed.platforms = {
      preview: ['macos-arm64'],
      formal: ['windows-x64', 'windows-arm64'],
    };
    registry.registrations[0].allowed.requiredPlatforms = {
      preview: [],
      formal: ['windows-x64', 'windows-arm64'],
    };
    const manifest = createManifest({
      platforms: {
        preview: ['macos-arm64'],
        formal: ['windows-x64', 'windows-arm64'],
      },
    });

    expect(
      resolveFormal({ registry, manifest, requestedPlatforms: ['windows-x64', 'windows-arm64'] }).platforms
    ).toEqual(['windows-x64', 'windows-arm64']);
    expect(() => resolveFormal({ registry, manifest, requestedPlatforms: ['windows-x64'] })).toThrowError(
      /must exactly match.*manifest/i
    );
    expect(() => resolveFormal({ registry, manifest, requestedPlatforms: ['macos-arm64'] })).toThrowError(
      /macos-arm64 is not allowed/i
    );
  });

  it('resolves a formal candidate from the protected distribution branch with the approved identity', () => {
    const plan = resolveFormal();

    expect(plan).toMatchObject({
      mode: 'formal',
      distributionId: 'zxjt',
      version: '0.1.0',
      source: {
        commit: SOURCE_SHA,
        branch: 'distribution/zxjt',
        ruleset: { ruleTypes: ['deletion', 'non_fast_forward'], rulesetIds: [17] },
      },
      registration: { revision: REGISTRATION_REVISION, lifecycle: 'active' },
      candidate: { runId: 4501, runAttempt: 2 },
      runtimeIdentity: {
        dataDirectory: 'Ki-Buddy-ZXJT',
        credentialNamespace: 'ki-buddy-zxjt',
      },
      packagingIdentity: {
        desktop: {
          appId: 'com.xlihub.ki-buddy.zxjt',
          executableName: 'Ki-Buddy-ZXJT',
        },
      },
      secretScope: { kind: 'distribution', distributionId: 'zxjt', mode: 'formal', names: [] },
      deliveryHistory: { deliveredVersions: [] },
    });
    expect(plan.deliveryHistory.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('fixes verified Ki-Core candidate provenance in the formal build plan', () => {
    const plan = resolveFormal({ kiCore: createCandidateKiCore() });

    expect(plan.kiCore).toEqual({
      sourcePolicy: 'candidate',
      repository: 'xlihub/Ki-Core',
      version: '0.1.5',
      tag: null,
      commit: '34567890abcdef1234567890abcdef1234567890',
      aionCore: {
        repository: 'iOfficeAI/AionCore',
        tag: 'v0.1.73',
        peeledCommit: '4567890abcdef1234567890abcdef12345678901',
      },
      checksums: { 'macos-arm64': '3'.repeat(64) },
      candidate: {
        workflow: 'build-manual.yml',
        runId: 801,
        artifacts: { 'macos-arm64': 'ki-core-candidate-macos-arm64' },
      },
    });
  });

  it('resolves one immutable plan and build matrix for every selected formal platform', () => {
    const plan = createMultiPlatformFormalPlan();

    expect(plan.platforms).toEqual([
      'macos-x64',
      'macos-arm64',
      'windows-x64',
      'windows-arm64',
      'linux-x64',
      'linux-arm64',
    ]);
    expect(plan.kiCore.checksums).toEqual({
      'macos-x64': '1'.repeat(64),
      'macos-arm64': '2'.repeat(64),
      'windows-x64': '3'.repeat(64),
      'windows-arm64': '4'.repeat(64),
      'linux-x64': '5'.repeat(64),
      'linux-arm64': '6'.repeat(64),
    });
    expect(createProjectDistributionBuildMatrix(plan).include).toEqual([
      expect.objectContaining({ platform: 'macos-x64', os: 'macos-14', runtimePlatform: 'darwin' }),
      expect.objectContaining({ platform: 'macos-arm64', os: 'macos-14', runtimePlatform: 'darwin' }),
      expect.objectContaining({ platform: 'windows-x64', os: 'windows-2022', runtimePlatform: 'win32' }),
      expect.objectContaining({ platform: 'windows-arm64', os: 'windows-11-arm', runtimePlatform: 'win32' }),
      expect.objectContaining({ platform: 'linux-x64', os: 'ubuntu-latest', runtimePlatform: 'linux' }),
      expect.objectContaining({ platform: 'linux-arm64', os: 'ubuntu-24.04-arm', runtimePlatform: 'linux' }),
    ]);
  });

  it('rejects unverified Ki-Core candidate sources', () => {
    const kiCore = createCandidateKiCore();
    kiCore.candidate.workflow = 'untrusted.yml';

    expect(() => resolveFormal({ kiCore })).toThrowError(/candidate workflow.*build-manual/i);
  });

  it('rejects a formal build credential that is not authorized by the project registration', () => {
    expect(() => resolveFormal({ requestedCredentialNames: ['PROJECT_LICENSE_KEY'] })).toThrowError(
      /credential PROJECT_LICENSE_KEY is not allowed/i
    );
  });

  it('records an explicitly authorized project build credential in the formal secret scope', () => {
    const registry = createRegistration();
    registry.registrations[0].allowed.buildCredentialNames = ['PROJECT_LICENSE_KEY'];

    expect(resolveFormal({ registry, requestedCredentialNames: ['PROJECT_LICENSE_KEY'] }).secretScope).toEqual({
      kind: 'distribution',
      distributionId: 'zxjt',
      mode: 'formal',
      names: ['PROJECT_LICENSE_KEY'],
    });
  });

  it('rejects duplicate project build credential requests', () => {
    const registry = createRegistration();
    registry.registrations[0].allowed.buildCredentialNames = ['PROJECT_LICENSE_KEY'];

    expect(() =>
      resolveFormal({
        registry,
        requestedCredentialNames: ['PROJECT_LICENSE_KEY', 'PROJECT_LICENSE_KEY'],
      })
    ).toThrowError(/credential names.*unique/i);
  });

  it('rejects a project build credential name outside the trusted naming contract', () => {
    const registry = createRegistration();
    registry.registrations[0].allowed.buildCredentialNames = ['project-license-key'];

    expect(() => resolveFormal({ registry })).toThrowError(/credential name.*UPPER_SNAKE_CASE/i);
  });

  it('creates independent immutable records for repeated formal candidate attempts', () => {
    const firstPlan = resolveFormal({ candidate: { runId: 4501, runAttempt: 1 } });
    const secondPlan = resolveFormal({ candidate: { runId: 4501, runAttempt: 2 } });
    const firstVerifications = createPlatformVerifications(firstPlan);
    const secondVerifications = createPlatformVerifications(secondPlan);

    const first = createProjectDistributionCandidateRecord(firstPlan, firstVerifications);
    const second = createProjectDistributionCandidateRecord(secondPlan, secondVerifications);

    expect(first.attempt).toEqual({ runId: 4501, runAttempt: 1 });
    expect(second.attempt).toEqual({ runId: 4501, runAttempt: 2 });
    expect(Object.isFrozen(first)).toBe(true);
  });

  it('rejects candidate creation from a preview build plan', () => {
    const verification = { platform: 'macos-arm64', fileName: 'ki-buddy-zxjt.dmg', checksum: '6'.repeat(64) };

    expect(() => createProjectDistributionCandidateRecord(resolve(), [verification])).toThrowError(
      /validated formal build plan/i
    );
  });

  it('creates a candidate only when every selected platform has verified matching provenance', () => {
    const plan = createMultiPlatformFormalPlan();
    const verifications = createPlatformVerifications(plan);

    expect(createProjectDistributionCandidateRecord(plan, verifications)).toMatchObject({
      platforms: ['macos-x64', 'macos-arm64', 'windows-x64', 'windows-arm64', 'linux-x64', 'linux-arm64'],
      artifacts: [
        { platform: 'macos-x64', checksum: '4'.repeat(64) },
        { platform: 'macos-arm64', checksum: '5'.repeat(64) },
        { platform: 'windows-x64', checksum: '6'.repeat(64) },
        { platform: 'windows-arm64', checksum: '7'.repeat(64) },
        { platform: 'linux-x64', checksum: '8'.repeat(64) },
        { platform: 'linux-arm64', checksum: '9'.repeat(64) },
      ],
      attempt: { runId: 4501, runAttempt: 2 },
    });
  });

  it.each([
    ['macos-arm64', 'mac-arm64', '.dmg'],
    ['windows-x64', 'win-unpacked', '.exe'],
    ['windows-arm64', 'win-arm64-unpacked', '.exe'],
  ])(
    'verifies the %s application materialized from the installer instead of a sibling unpacked directory',
    (platform, unpackedDirectory, extension) => {
      const directory = mkdtempSync(resolvePath(tmpdir(), 'project-installer-verification-'));
      const artifactsRoot = resolvePath(directory, 'artifacts');
      const plan = createMultiPlatformFormalPlan();
      const installerName = `ki-buddy-zxjt-${platform}${extension}`;
      const installerPath = resolvePath(artifactsRoot, installerName);
      const standaloneEvidencePath = resolvePath(artifactsRoot, 'project-build-evidence.json');
      const packagedEvidencePath = resolvePath(directory, 'installed', 'project-build-evidence.json');
      const outputDirectory = resolvePath(directory, 'verified');
      let cleanupCalled = false;
      let windowsInstallationChecks = 0;
      try {
        mkdirSync(resolvePath(artifactsRoot, unpackedDirectory), { recursive: true });
        mkdirSync(resolvePath(directory, 'installed'), { recursive: true });
        writeFileSync(installerPath, 'formal installer');
        writeFileSync(standaloneEvidencePath, 'immutable evidence');
        writeFileSync(packagedEvidencePath, 'immutable evidence');

        const result = verifyProjectDistributionArtifact({
          buildPlan: plan,
          projectRoot: process.cwd(),
          artifactsRoot,
          platform,
          outputDirectory,
          materializeInstaller(actualInstallerPath: string) {
            expect(actualInstallerPath).toBe(installerPath);
            return {
              unpackedPath: resolvePath(directory, 'installed'),
              packageRoot: resolvePath(directory, 'installed'),
              cleanup() {
                cleanupCalled = true;
              },
            };
          },
          verifyUnpacked(
            _projectRoot: string,
            unpackedPath: string,
            _runtimePlatform: string,
            _identity: unknown,
            _buildPlan: unknown,
            _packageRoot: string,
            options: { expectedPlatform: string }
          ) {
            expect(unpackedPath).toBe(resolvePath(directory, 'installed'));
            expect(options).toEqual({ expectedPlatform: platform });
            return { buildEvidencePath: packagedEvidencePath };
          },
          verifyWindowsInstallation(applicationRoot: string, identity: unknown, expectedPlatform: string) {
            expect({ applicationRoot, identity, expectedPlatform, cleanupCalled }).toEqual({
              applicationRoot: resolvePath(directory, 'installed'),
              identity: plan.packagingIdentity,
              expectedPlatform: platform,
              cleanupCalled: false,
            });
            windowsInstallationChecks += 1;
          },
        });

        expect(result).toMatchObject({ verifiedFromInstaller: true, installer: { platform } });
        expect(windowsInstallationChecks).toBe(platform.startsWith('windows-') ? 1 : 0);
        expect(cleanupCalled).toBe(true);
        expect(readFileSync(resolvePath(outputDirectory, 'installers', installerName), 'utf8')).toBe(
          'formal installer'
        );
        expect(existsSync(resolvePath(outputDirectory, 'project-platform-verification.json'))).toBe(true);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    }
  );

  it.each([
    { validationFails: true, cleanupFails: false },
    { validationFails: true, cleanupFails: true },
    { validationFails: false, cleanupFails: true },
  ])(
    'preserves failures and publishes no output with $validationFails validation / $cleanupFails cleanup',
    ({ validationFails, cleanupFails }) => {
      const directory = mkdtempSync(resolvePath(tmpdir(), 'project-windows-verification-failure-'));
      const artifactsRoot = resolvePath(directory, 'artifacts');
      const outputDirectory = resolvePath(directory, 'verified');
      const plan = createMultiPlatformFormalPlan();
      let cleanupCalled = false;
      try {
        mkdirSync(artifactsRoot, { recursive: true });
        writeFileSync(resolvePath(artifactsRoot, 'ki-buddy-zxjt.exe'), 'formal installer');
        writeFileSync(resolvePath(artifactsRoot, 'project-build-evidence.json'), 'immutable evidence');

        expect(() =>
          verifyProjectDistributionArtifact({
            buildPlan: plan,
            projectRoot: process.cwd(),
            artifactsRoot,
            platform: 'windows-arm64',
            outputDirectory,
            materializeInstaller() {
              return {
                unpackedPath: resolvePath(directory, 'installed'),
                cleanup() {
                  cleanupCalled = true;
                  if (cleanupFails) throw new Error('installer cleanup failed');
                },
              };
            },
            verifyUnpacked() {
              return { buildEvidencePath: resolvePath(artifactsRoot, 'project-build-evidence.json') };
            },
            verifyWindowsInstallation() {
              if (validationFails) throw new Error('Windows installation verification failed');
            },
          })
        ).toThrow(
          validationFails
            ? cleanupFails
              ? /Windows installation verification failed[\s\S]*installer cleanup failed/
              : /Windows installation verification failed/
            : /installer cleanup failed/
        );
        expect(cleanupCalled).toBe(true);
        expect(existsSync(outputDirectory)).toBe(false);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    }
  );

  it('cleans materialized installer contents when packaged verification fails', () => {
    const directory = mkdtempSync(resolvePath(tmpdir(), 'project-installer-verification-failure-'));
    const artifactsRoot = resolvePath(directory, 'artifacts');
    const plan = resolveFormal();
    let cleanupCalled = false;
    try {
      mkdirSync(artifactsRoot, { recursive: true });
      writeFileSync(resolvePath(artifactsRoot, 'ki-buddy-zxjt.dmg'), 'formal installer');
      writeFileSync(resolvePath(artifactsRoot, 'project-build-evidence.json'), 'immutable evidence');

      expect(() =>
        verifyProjectDistributionArtifact({
          buildPlan: plan,
          projectRoot: process.cwd(),
          artifactsRoot,
          platform: 'macos-arm64',
          outputDirectory: resolvePath(directory, 'verified'),
          materializeInstaller() {
            return {
              unpackedPath: resolvePath(directory, 'installed'),
              packageRoot: resolvePath(directory, 'installed'),
              cleanup() {
                cleanupCalled = true;
              },
            };
          },
          verifyUnpacked() {
            throw new Error('packaged verification failed');
          },
        })
      ).toThrow('packaged verification failed');
      expect(cleanupCalled).toBe(true);
      expect(existsSync(resolvePath(directory, 'verified'))).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects candidate creation when a selected platform verification is missing', () => {
    const plan = createMultiPlatformFormalPlan();
    const verifications = createPlatformVerifications(plan);

    expect(() => createProjectDistributionCandidateRecord(plan, verifications.slice(0, -1))).toThrowError(
      /must cover every selected platform/i
    );
  });

  it('rejects candidate creation when an installer checksum is invalid', () => {
    const plan = resolveFormal();
    const verification = structuredClone(
      createProjectDistributionPlatformVerification(plan, {
        platform: 'macos-arm64',
        fileName: 'ki-buddy-zxjt.dmg',
        checksum: '6'.repeat(64),
      })
    );
    verification.artifact.checksum = 'invalid';

    expect(() => createProjectDistributionCandidateRecord(plan, [verification])).toThrowError(
      /checksum must be SHA-256/i
    );
  });

  it('rejects candidate creation when platform provenance does not match the shared build plan', () => {
    const plan = createMultiPlatformFormalPlan();
    const verifications = createPlatformVerifications(plan);
    verifications[1] = { ...verifications[1], buildPlanDigest: 'f'.repeat(64) };

    expect(() => createProjectDistributionCandidateRecord(plan, verifications)).toThrowError(/provenance.*build plan/i);
  });

  it('rejects legacy candidate creation without platform verification evidence', () => {
    const directory = mkdtempSync(resolvePath(tmpdir(), 'project-candidate-failure-'));
    const buildPlanPath = resolvePath(directory, 'formal-plan.json');
    const installerPath = resolvePath(directory, 'candidate.dmg');
    const outputPath = resolvePath(directory, 'project-candidate.json');
    const scriptPath = resolvePath(process.cwd(), 'packages/shared-scripts/src/projectDistribution.js');
    try {
      writeFileSync(buildPlanPath, JSON.stringify(resolveFormal()));
      writeFileSync(installerPath, 'not a verified formal package');

      expect(() =>
        execFileSync(
          process.execPath,
          [
            scriptPath,
            'create-candidate',
            '--build-plan',
            buildPlanPath,
            '--installer',
            installerPath,
            '--platform',
            'macos-arm64',
            '--output',
            outputPath,
          ],
          { stdio: 'ignore' }
        )
      ).toThrow();
      expect(existsSync(outputPath)).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('recomputes verified installer checksums before the CLI writes an atomic candidate', () => {
    const directory = mkdtempSync(resolvePath(tmpdir(), 'project-candidate-aggregate-'));
    const buildPlanPath = resolvePath(directory, 'formal-plan.json');
    const verificationsPath = resolvePath(directory, 'verifications', 'macos-arm64');
    const installerPath = resolvePath(verificationsPath, 'installers', 'ki-buddy-zxjt.dmg');
    const verificationPath = resolvePath(verificationsPath, 'project-platform-verification.json');
    const outputPath = resolvePath(directory, 'project-candidate.json');
    const scriptPath = resolvePath(process.cwd(), 'packages/shared-scripts/src/projectDistribution.js');
    const buildPlan = resolveFormal();
    try {
      mkdirSync(resolvePath(verificationsPath, 'installers'), { recursive: true });
      writeFileSync(buildPlanPath, JSON.stringify(buildPlan));
      writeFileSync(installerPath, 'verified installer');
      const checksum = require('node:crypto').createHash('sha256').update('verified installer').digest('hex');
      writeFileSync(
        verificationPath,
        JSON.stringify(
          createProjectDistributionPlatformVerification(buildPlan, {
            platform: 'macos-arm64',
            fileName: 'ki-buddy-zxjt.dmg',
            checksum,
          })
        )
      );
      writeFileSync(installerPath, 'tampered installer');

      expect(() =>
        execFileSync(
          process.execPath,
          [
            scriptPath,
            'create-candidate',
            '--build-plan',
            buildPlanPath,
            '--verifications',
            resolvePath(directory, 'verifications'),
            '--output',
            outputPath,
          ],
          { stdio: 'ignore' }
        )
      ).toThrow();
      expect(existsSync(outputPath)).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each(['suspended', 'retired'])('rejects formal candidates while the project registration is %s', (lifecycle) => {
    expect(() => resolveFormal({ registry: createRegistration({ lifecycle }) })).toThrowError(
      /only active project registrations/i
    );
  });

  it('rejects a formal candidate for a non-local project registration', () => {
    expect(() =>
      resolveFormal({
        registry: createRegistration({ identityMode: 'agents' }),
        manifest: createManifest({ identityMode: 'agents' }),
      })
    ).toThrowError(/only local project registrations/i);
  });

  it('rejects a version that already has a confirmed delivery record', () => {
    const delivered = {
      distributionId: 'zxjt',
      version: '0.1.0',
      sourceCommit: SOURCE_SHA,
      registrationRevision: REGISTRATION_REVISION,
      manifestDigest: '1'.repeat(64),
      platforms: ['macos-arm64'],
      candidate: { runId: 4400, runAttempt: 1 },
      installerChecksums: { 'macos-arm64': '2'.repeat(64) },
      custodyReference: 'vault://zxjt/0.1.0',
    };

    expect(() => resolveFormal({ deliveryRecords: createDeliveryRecords([delivered]) })).toThrowError(
      /version 0\.1\.0 has already been delivered/i
    );
  });

  it.each([
    [
      'a mutable source ref',
      { repository: 'xlihub/KiBuddy', commit: 'distribution/zxjt', treeState: 'committed' },
      /source evidence.*invalid fields|source commit.*full lowercase/i,
    ],
    [
      'a different distribution branch',
      {
        repository: 'xlihub/KiBuddy',
        commit: SOURCE_SHA,
        treeState: 'committed',
        branch: 'distribution/other',
        branchHead: '234567890abcdef1234567890abcdef123456789',
        ruleset: { ruleTypes: ['deletion', 'non_fast_forward'], rulesetIds: [17] },
      },
      /source branch must be distribution\/zxjt/i,
    ],
    [
      'a branch without non-fast-forward protection',
      {
        repository: 'xlihub/KiBuddy',
        commit: SOURCE_SHA,
        treeState: 'committed',
        branch: 'distribution/zxjt',
        branchHead: '234567890abcdef1234567890abcdef123456789',
        ruleset: { ruleTypes: ['deletion'], rulesetIds: [17] },
      },
      /ruleset must enforce non_fast_forward/i,
    ],
  ])('rejects formal source evidence for %s', (_label, source, error) => {
    expect(() => resolveFormal({ source })).toThrowError(error as RegExp);
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

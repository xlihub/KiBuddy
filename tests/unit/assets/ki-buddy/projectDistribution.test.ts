import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve as resolvePath } from 'node:path';

const {
  createFormalBranchRulesetEvidence,
  createProjectDistributionCandidateRecord,
  createProjectKiCoreCandidateProvenance,
  resolveProjectDistributionBuildPlan,
  verifyFormalSourceReachability,
} = require('../../../../packages/shared-scripts/src/projectDistribution');

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
          buildCredentialNames: [],
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
      artifactName: 'ki-core-candidate-macos-arm64',
    },
  };
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
        artifactName: 'ki-core-candidate-macos-arm64',
      },
    });
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
    expect(resolveFormal({ registry, manifest, deliveryRecords }).deliveryHistory.deliveredVersions).toEqual([]);
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
      platform: 'macos-arm64',
      checksum: '3'.repeat(64),
      candidate: {
        workflow: 'build-manual.yml',
        runId: 801,
        artifactName: 'ki-core-candidate-macos-arm64',
      },
    });
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
    const installer = { platform: 'macos-arm64', fileName: 'ki-buddy-zxjt.dmg', checksum: '6'.repeat(64) };

    const first = createProjectDistributionCandidateRecord(firstPlan, installer);
    const second = createProjectDistributionCandidateRecord(secondPlan, installer);

    expect(first.attempt).toEqual({ runId: 4501, runAttempt: 1 });
    expect(second.attempt).toEqual({ runId: 4501, runAttempt: 2 });
    expect(Object.isFrozen(first)).toBe(true);
  });

  it('rejects candidate creation from a preview build plan', () => {
    const installer = { platform: 'macos-arm64', fileName: 'ki-buddy-zxjt.dmg', checksum: '6'.repeat(64) };

    expect(() => createProjectDistributionCandidateRecord(resolve(), installer)).toThrowError(
      /validated formal build plan/i
    );
  });

  it('rejects candidate creation with an invalid installer checksum', () => {
    const installer = { platform: 'macos-arm64', fileName: 'ki-buddy-zxjt.dmg', checksum: 'invalid' };

    expect(() => createProjectDistributionCandidateRecord(resolveFormal(), installer)).toThrowError(
      /checksum must be SHA-256/i
    );
  });

  it('leaves no candidate record when candidate creation fails', () => {
    const directory = mkdtempSync(resolvePath(tmpdir(), 'project-candidate-failure-'));
    const buildPlanPath = resolvePath(directory, 'preview-plan.json');
    const installerPath = resolvePath(directory, 'candidate.dmg');
    const outputPath = resolvePath(directory, 'project-candidate.json');
    const scriptPath = resolvePath(process.cwd(), 'packages/shared-scripts/src/projectDistribution.js');
    try {
      writeFileSync(buildPlanPath, JSON.stringify(resolve()));
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

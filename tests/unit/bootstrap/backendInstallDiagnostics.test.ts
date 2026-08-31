import { describe, expect, it } from 'vitest';
import { collectBackendInstallDiagnostics } from '@/process/startup/backendInstallDiagnostics';
import { appendAutoUpdateDiagnosticEvent } from '@/process/services/autoUpdateDiagnostics';

const FIXTURE_KI_BUDDY_VERSION = '7.8.9';
const FIXTURE_KI_CORE_VERSION = '4.3.2';
const FIXTURE_AION_UI_TAG = 'v6.5.4';
const FIXTURE_AION_CORE_TAG = 'v3.2.1';

describe('collectBackendInstallDiagnostics', () => {
  it('records packaged runtime manifest and missing backend binary metadata', () => {
    const files = new Map<string, { mtimeMs: number; size: number; content?: string }>([
      ['C:\\AionUi\\resources', { mtimeMs: 1000, size: 0 }],
      ['C:\\AionUi\\resources\\bundled-aioncore\\win32-x64', { mtimeMs: 2000, size: 0 }],
      [
        'C:\\AionUi\\resources\\bundled-aioncore\\win32-x64\\manifest.json',
        {
          mtimeMs: 3000,
          size: 88,
          content: JSON.stringify({
            version: 'v0.9.0',
            generatedAt: '2026-05-29T12:00:00.000Z',
            sourceType: 'download',
            files: ['aioncore.exe', 'managed-resources/'],
          }),
        },
      ],
    ]);

    const diagnostics = collectBackendInstallDiagnostics(
      {
        runtimeKey: 'win32-x64',
        binaryName: 'aioncore.exe',
        resourcesPath: 'C:\\AionUi\\resources',
        checkedBundledPath: 'C:\\AionUi\\resources\\bundled-aioncore\\win32-x64\\aioncore.exe',
      },
      {
        appVersion: '2.1.7',
        arch: 'x64',
        execPath: 'C:\\AionUi\\AionUi.exe',
        isPackaged: true,
        platform: 'win32',
        readFile: (filePath) => files.get(filePath)?.content,
        stat: (filePath) => files.get(filePath),
      }
    );

    expect(diagnostics).toEqual({
      appVersion: '2.1.7',
      arch: 'x64',
      binaryExists: false,
      binaryName: 'aioncore.exe',
      binaryPath: 'C:\\AionUi\\resources\\bundled-aioncore\\win32-x64\\aioncore.exe',
      bundledDirPath: 'C:\\AionUi\\resources\\bundled-aioncore',
      execPath: 'C:\\AionUi\\AionUi.exe',
      isPackaged: true,
      manifestExists: true,
      manifestFiles: ['aioncore.exe', 'managed-resources/'],
      manifestGeneratedAt: '2026-05-29T12:00:00.000Z',
      manifestPath: 'C:\\AionUi\\resources\\bundled-aioncore\\win32-x64\\manifest.json',
      manifestSize: 88,
      manifestMtimeMs: 3000,
      manifestSourceType: 'download',
      manifestVersion: 'v0.9.0',
      platform: 'win32',
      resourcesDirMtimeMs: 1000,
      resourcesPath: 'C:\\AionUi\\resources',
      runtimeDirMtimeMs: 2000,
      runtimeDirPath: 'C:\\AionUi\\resources\\bundled-aioncore\\win32-x64',
      runtimeKey: 'win32-x64',
    });
  });

  it('exposes verified Ki-Core and AionCore provenance for support reports', () => {
    const manifestPath = '/opt/Ki-Buddy/resources/bundled-aioncore/linux-x64/manifest.json';
    const diagnostics = collectBackendInstallDiagnostics(
      {
        runtimeKey: 'linux-x64',
        binaryName: 'aioncore',
        resourcesPath: '/opt/Ki-Buddy/resources',
      },
      {
        platform: 'linux',
        readFile: (filePath) =>
          filePath === manifestPath
            ? JSON.stringify({
                schemaVersion: 2,
                version: FIXTURE_KI_CORE_VERSION,
                generatedAt: '2026-08-05T00:00:00.000Z',
                sourceType: 'actions-artifact',
                files: ['aioncore', 'managed-resources/'],
                kiCore: { version: FIXTURE_KI_CORE_VERSION, tag: null, releaseCommit: null },
                aionCore: {
                  repository: 'iOfficeAI/AionCore',
                  tag: 'v0.1.58',
                  peeledCommit: 'b'.repeat(40),
                },
                source: {
                  policy: 'candidate',
                  type: 'actions-artifact',
                  repository: 'xlihub/Ki-Core',
                  workflow: 'build-manual.yml',
                  runId: '12345',
                  headSha: 'a'.repeat(40),
                  artifactName: 'ki-core-candidate-linux-x64',
                },
              })
            : undefined,
        stat: (filePath) => (filePath === manifestPath ? { mtimeMs: 1, size: 2 } : undefined),
      }
    );

    expect(diagnostics.kiCoreVersion).toBe(FIXTURE_KI_CORE_VERSION);
    expect(diagnostics.aionCoreTag).toBe('v0.1.58');
    expect(diagnostics.aionCorePeeledCommit).toBe('b'.repeat(40));
    expect(diagnostics.manifestSourceRunId).toBe('12345');
    expect(diagnostics.manifestSourceHeadSha).toBe('a'.repeat(40));
  });

  it('reports malformed provenance without crashing startup diagnostics', () => {
    const diagnostics = collectBackendInstallDiagnostics(
      { runtimeKey: 'linux-x64', resourcesPath: '/resources' },
      {
        platform: 'linux',
        readFile: () => JSON.stringify({ schemaVersion: 2, kiCore: 'invalid', aionCore: null, source: [] }),
        stat: () => ({ mtimeMs: 1, size: 2 }),
      }
    );

    expect(diagnostics.manifestValidationError).toBe('Bundle manifest provenance objects are malformed');
    expect(diagnostics.manifestParseError).toBeUndefined();
  });

  it('exposes Ki-Buddy and mapped AionUi identity from schema 3 manifests', () => {
    const diagnostics = collectBackendInstallDiagnostics(
      { runtimeKey: 'linux-x64', resourcesPath: '/resources' },
      {
        platform: 'linux',
        readFile: () =>
          JSON.stringify({
            schemaVersion: 3,
            version: FIXTURE_KI_BUDDY_VERSION,
            kiBuddy: {
              repository: 'xlihub/KiBuddy',
              version: FIXTURE_KI_BUDDY_VERSION,
              tag: `ki-buddy-v${FIXTURE_KI_BUDDY_VERSION}`,
              releaseCommit: null,
            },
            aionUi: {
              repository: 'iOfficeAI/AionUi',
              tag: FIXTURE_AION_UI_TAG,
              commit: 'a'.repeat(40),
            },
            kiCore: {
              version: FIXTURE_KI_CORE_VERSION,
              tag: `ki-core-v${FIXTURE_KI_CORE_VERSION}`,
              releaseCommit: 'b'.repeat(40),
            },
            aionCore: {
              repository: 'iOfficeAI/AionCore',
              tag: FIXTURE_AION_CORE_TAG,
              peeledCommit: 'c'.repeat(40),
            },
            source: { policy: 'release-pinned', type: 'github-release' },
          }),
        stat: () => ({ mtimeMs: 1, size: 2 }),
      }
    );

    expect(diagnostics.manifestSchemaVersion).toBe(3);
    expect(diagnostics.kiBuddyTag).toBe(`ki-buddy-v${FIXTURE_KI_BUDDY_VERSION}`);
    expect(diagnostics.aionUiTag).toBe(FIXTURE_AION_UI_TAG);
    expect(diagnostics.manifestValidationError).toBeUndefined();
  });
});

describe('appendAutoUpdateDiagnosticEvent', () => {
  it('records macOS native updater readiness events with platform and elapsed time', () => {
    const state = appendAutoUpdateDiagnosticEvent(
      {
        currentAppVersion: '2.1.27',
        events: [],
      },
      {
        at: '2026-07-01T09:40:33.000Z',
        elapsedMs: 1234,
        platform: 'darwin',
        status: 'native-update-ready',
        version: '2.1.28',
      }
    );

    expect(state.lastEvent).toEqual({
      at: '2026-07-01T09:40:33.000Z',
      elapsedMs: 1234,
      platform: 'darwin',
      status: 'native-update-ready',
      version: '2.1.28',
    });
    expect(state.lastQuitAndInstallAt).toBeUndefined();
  });

  it('keeps recent updater events and records quitAndInstall separately', () => {
    const state = appendAutoUpdateDiagnosticEvent(
      {
        currentAppVersion: '2.1.7',
        events: [],
      },
      {
        at: '2026-05-30T08:00:00.000Z',
        status: 'downloaded',
        version: '2.1.8',
      }
    );

    const next = appendAutoUpdateDiagnosticEvent(state, {
      at: '2026-05-30T08:01:00.000Z',
      status: 'quit-and-install',
    });

    expect(next).toEqual({
      currentAppVersion: '2.1.7',
      events: [
        {
          at: '2026-05-30T08:00:00.000Z',
          status: 'downloaded',
          version: '2.1.8',
        },
        {
          at: '2026-05-30T08:01:00.000Z',
          status: 'quit-and-install',
        },
      ],
      lastEvent: {
        at: '2026-05-30T08:01:00.000Z',
        status: 'quit-and-install',
      },
      lastQuitAndInstallAt: '2026-05-30T08:01:00.000Z',
    });
  });
});

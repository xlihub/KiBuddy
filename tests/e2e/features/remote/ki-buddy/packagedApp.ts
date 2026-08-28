import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { _electron as electron } from 'playwright';
import { createE2EEnvironment, resolveMainWindow, resolvePackagedApp, type PackagedApp } from '../../../fixtures';
import { FIRST_RELEASE_MATRIX } from './firstReleaseMatrix';

type KiCoreReleaseIdentity = Readonly<{
  releaseCommit: string;
  repository: string;
  tag: string;
  version: string;
}>;

const { createSourceStateSha256, readKiBuddyRelease } =
  require('../../../../../packages/shared-scripts/src/kiBuddyRelease.js') as {
    createSourceStateSha256: (root: string) => string;
    readKiBuddyRelease: (root: string) => Readonly<{ kiCore: KiCoreReleaseIdentity }>;
  };

export type ProductBuildEvidence = Readonly<{
  schemaVersion: 2;
  product: Readonly<{
    productName: string;
    runtimeIdentity: string;
  }>;
  source: Readonly<{
    commit: string;
    repository: string;
    stateSha256: string;
    treeDirty: boolean;
  }>;
  release: Readonly<{
    internal: Readonly<{ repository: string }>;
    publicDistribution: Readonly<{ repository: string }>;
    runtimeUpdates: Readonly<{ repository: string }>;
  }>;
  policySources: Readonly<{
    experienceRegistry: Readonly<{ path: string; sha256: string }>;
    productConfig: Readonly<{ path: string; sha256: string }>;
  }>;
}>;

export type BackendBundleEvidence = Readonly<{
  kiCore: Readonly<{ releaseCommit: string; tag: string }>;
  source: Readonly<{ policy: string; repository: string; tag: string; type: string }>;
}>;

export type LaunchedPackagedApp = Readonly<{
  electronApp: ElectronApplication;
  logs: string[];
  package: PackagedApp;
  page: Page;
  processId: number;
  sandboxDir: string;
}>;

const KI_BUDDY_FORBIDDEN_UI_SELECTORS = [
  '[data-testid="installation-integrity-dialog"]',
  ...new Set(Object.values(FIRST_RELEASE_MATRIX.disabledFeatureEvidence.flashObserved).flat()),
];

export const projectRoot = path.resolve(__dirname, '../../../../..');

function packageRoot(kind: 'aionui' | 'ki-buddy'): string {
  return kind === 'ki-buddy' ? path.join(projectRoot, 'out') : path.join(projectRoot, 'out', 'aionui-e2e');
}

export async function launchPackagedApp(
  kind: 'aionui' | 'ki-buddy',
  existingSandboxDir?: string
): Promise<LaunchedPackagedApp> {
  const packaged = resolvePackagedApp(packageRoot(kind));
  if (!packaged) {
    throw new Error(
      `${kind} packaged E2E artifact is missing under ${packageRoot(kind)}. Build both unpacked applications first.`
    );
  }

  const sandboxDir = existingSandboxDir ?? fs.mkdtempSync(path.join(os.tmpdir(), `${kind}-matrix-e2e-`));
  const launchArgs = process.platform === 'linux' && process.env.CI ? ['--no-sandbox'] : [];
  const electronApp = await electron.launch({
    executablePath: packaged.executablePath,
    args: launchArgs,
    cwd: packaged.cwd,
    env: {
      ...createE2EEnvironment(sandboxDir, path.join(sandboxDir, 'extension-states.json')),
      AIONUI_CDP_PORT: '0',
      ...(kind === 'ki-buddy'
        ? { AIONUI_E2E_FORBIDDEN_SELECTORS: JSON.stringify(KI_BUDDY_FORBIDDEN_UI_SELECTORS) }
        : {}),
      AIONUI_EXTENSIONS_PATH: path.join(projectRoot, 'examples'),
      NODE_ENV: 'production',
    },
    timeout: 60_000,
  });
  const processId = electronApp.process().pid;
  if (typeof processId !== 'number') {
    await electronApp.close().catch(() => undefined);
    throw new Error(`Unable to resolve the ${kind} packaged application process ID.`);
  }
  const logs: string[] = [];
  electronApp.process().stdout?.on('data', (chunk) => logs.push(`[main:stdout] ${String(chunk).trimEnd()}`));
  electronApp.process().stderr?.on('data', (chunk) => logs.push(`[main:stderr] ${String(chunk).trimEnd()}`));
  const page = await resolveMainWindow(electronApp);
  page.on('console', (message) => logs.push(`[renderer:${message.type()}] ${message.text()}`));
  page.on('pageerror', (error) => logs.push(`[renderer:pageerror] ${error.message}`));

  return {
    electronApp,
    logs,
    package: packaged,
    page,
    processId,
    sandboxDir,
  };
}

export async function closePackagedApp(app: LaunchedPackagedApp, removeSandbox = true): Promise<void> {
  await app.electronApp.close().catch(() => undefined);
  if (removeSandbox) fs.rmSync(app.sandboxDir, { recursive: true, force: true });
}

export function readProductBuildEvidence(packaged: PackagedApp): ProductBuildEvidence {
  const evidencePath = path.join(packaged.resourcesPath, 'ki-buddy-build-evidence.json');
  return JSON.parse(fs.readFileSync(evidencePath, 'utf8')) as ProductBuildEvidence;
}

export function readBackendBundleEvidence(packaged: PackagedApp): BackendBundleEvidence {
  const runtimeKey = `${process.platform}-${process.arch}`;
  const evidencePath = path.join(packaged.resourcesPath, 'bundled-aioncore', runtimeKey, 'manifest.json');
  return JSON.parse(fs.readFileSync(evidencePath, 'utf8')) as BackendBundleEvidence;
}

export function currentSourceCommit(): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot, encoding: 'utf8' }).trim();
}

export function currentKiCoreRelease(): KiCoreReleaseIdentity {
  return readKiBuddyRelease(projectRoot).kiCore;
}

export function currentSourceStateSha256(): string {
  return createSourceStateSha256(projectRoot);
}

export function isSourceTreeDirty(): boolean {
  return Boolean(
    execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {
      cwd: projectRoot,
      encoding: 'utf8',
    }).trim()
  );
}

export function sha256Source(relativePath: string): string {
  return createHash('sha256')
    .update(fs.readFileSync(path.join(projectRoot, relativePath)))
    .digest('hex');
}

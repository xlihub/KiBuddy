import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const projectRoot = resolve(__dirname, '../..');
const itWithBash = spawnSync('bash', ['--version'], { encoding: 'utf8' }).status === 0 ? it : it.skip;

function readProjectFile(path: string): string {
  return readFileSync(resolve(projectRoot, path), 'utf8');
}

function yamlBlock(content: string, key: string): string {
  const startMatch = content.match(new RegExp(`^${key}:\\s*$`, 'm'));
  if (!startMatch || startMatch.index === undefined) return '';

  const blockStart = startMatch.index + startMatch[0].length;
  const rest = content.slice(blockStart);
  const nextTopLevelKey = rest.search(/^[a-zA-Z][a-zA-Z0-9]*:\s*$/m);
  return nextTopLevelKey === -1 ? rest : rest.slice(0, nextTopLevelKey);
}

function workflowStep(content: string, name: string): string {
  const marker = `      - name: ${name}`;
  const start = content.indexOf(marker);
  if (start === -1) return '';

  const rest = content.slice(start + marker.length);
  const nextStep = rest.indexOf('\n      - name: ');
  return nextStep === -1 ? rest : rest.slice(0, nextStep);
}

function workflowJob(content: string, name: string): string {
  const marker = `  ${name}:`;
  const start = content.indexOf(marker);
  if (start === -1) return '';

  const rest = content.slice(start + marker.length);
  const nextJob = rest.search(/^  [a-zA-Z][a-zA-Z0-9-]*:\s*$/m);
  return nextJob === -1 ? rest : rest.slice(0, nextJob);
}

describe('release packaging configuration', () => {
  it('checks out complete history before project distribution unit tests', () => {
    const workflow = readProjectFile('.github/workflows/pr-checks.yml');
    const unitTestsJob = workflowJob(workflow, 'unit-tests');
    const checkoutStep = workflowStep(unitTestsJob, 'Checkout code');

    expect(checkoutStep).toContain('fetch-depth: 0');
  });

  it.each([
    ['build-and-release.yml', 'Fetch mapped AionUi tag'],
    ['build-and-release.yml', 'Validate tag, mapping and upstream package'],
    ['pr-checks.yml', 'Fetch mapped AionUi tag'],
    ['pr-checks.yml', 'Validate Ki-Buddy product release mapping'],
  ])('binds %s / %s preflight to the current GitHub repository', (workflowName, stepName) => {
    const workflow = readProjectFile(`.github/workflows/${workflowName}`);
    const step = workflowStep(workflow, stepName);

    expect(step).toContain('kiBuddyRelease.js verify');
    expect(step).toContain('--repository "$GITHUB_REPOSITORY"');
  });

  it('keeps Manual Build on the reusable release-pinned or candidate Ki-Core pipeline', () => {
    const workflow = readProjectFile('.github/workflows/build-manual.yml');

    expect(workflow).toContain('          - release-pinned\n          - candidate');
    expect(workflow).toContain('uses: ./.github/workflows/_build-reusable.yml');
    expect(workflow).toContain('ki_core_source_policy: ${{ inputs.ki_core_source_policy }}');
  });

  it('keeps the Web CLI installer on the historical public distribution source', () => {
    const installer = readProjectFile('scripts/install-web.sh');

    expect(installer).toContain(
      'https://raw.githubusercontent.com/xlihub/Ki-Buddy/product/main/scripts/install-web.sh'
    );
    expect(installer).toContain('MIRROR="${MIRROR:-https://github.com/xlihub/Ki-Buddy/releases/download}"');
    expect(installer).toContain('https://api.github.com/repos/xlihub/Ki-Buddy/releases/latest');
  });

  it('keeps mac zip artifacts enabled', () => {
    const config = readProjectFile('packages/desktop/electron-builder.yml');
    const macBlock = yamlBlock(config, 'mac');

    expect(macBlock).toContain('    - dmg');
    expect(macBlock).toContain('    - zip');
  });

  it('does not build Windows zip artifacts', () => {
    const config = readProjectFile('packages/desktop/electron-builder.yml');
    const winBlock = yamlBlock(config, 'win');

    expect(winBlock).toContain('    - nsis');
    expect(winBlock).not.toContain('    - zip');
  });

  it('validates the packaged executable from the product identity at every installation phase', () => {
    const productConfig = JSON.parse(readProjectFile('ki-buddy-product.json')) as {
      electronBuilder: { executableName: string };
    };
    const installerChecks = [
      readProjectFile('resources/windows/installer-observability.nsh'),
      readProjectFile('resources/windows/installer-update-verify.nsh'),
    ];

    expect(productConfig.electronBuilder.executableName).toBe('Ki-Buddy');
    for (const installerCheck of installerChecks) {
      expect(installerCheck).toContain('"$INSTDIR\\${AIONUI_APP_EXECUTABLE_FILENAME}"');
      expect(installerCheck).not.toContain('$INSTDIR\\AionUi.exe');
    }
  });

  it('passes branded executable names to external Windows locker diagnostics', () => {
    const processControl = readProjectFile('resources/windows/installer-process-control.nsh');
    const queryLockers = readProjectFile('resources/windows/support/query-lockers.ps1');

    expect(processControl).toContain('-AppExecutableFilename "${AIONUI_APP_EXECUTABLE_FILENAME}"');
    expect(processControl).toContain('-UninstallFilename "${UNINSTALL_FILENAME}"');
    expect(queryLockers).not.toMatch(/['"](?:Uninstall )?AionUi\.exe['"]/);
  });

  it.each(['_build-reusable.yml', 'pr-checks.yml'])(
    'fails %s Windows installation smoke tests on a non-zero installer exit code',
    (workflowName) => {
      const workflow = readProjectFile(`.github/workflows/${workflowName}`);
      const smokeStep = workflowStep(workflow, 'Silent install smoke test (Windows x64)');

      expect(smokeStep).toContain('-PassThru');
      expect(smokeStep).toContain('$process.ExitCode -ne 0');
      expect(smokeStep).toContain('throw "Windows installer exited with code $($process.ExitCode)"');
    }
  );

  it('includes and unpacks the native keytar credential module', () => {
    const config = readProjectFile('packages/desktop/electron-builder.yml');
    const filesBlock = yamlBlock(config, 'files');
    const asarUnpackBlock = yamlBlock(config, 'asarUnpack');

    expect(filesBlock).toContain('  - node_modules/keytar/**/*');
    expect(asarUnpackBlock).toContain("  - '**/node_modules/keytar/**/*'");
  });

  it('rebuilds keytar for cross-architecture macOS artifacts', () => {
    const script = readProjectFile('scripts/rebuildNativeModules.js');

    expect(script).toContain("return ['better-sqlite3', 'keytar'];");
    expect(script).toContain("keytar: [path.join(moduleRoot, 'build', 'Release', 'keytar.node')]");
  });

  it('uploads mac zip artifacts without a stale Windows zip glob', () => {
    const workflow = readProjectFile('.github/workflows/_build-reusable.yml');

    expect(workflow).toContain('out/Ki-Buddy-*-mac-*.zip');
    expect(workflow).not.toContain('out/Ki-Buddy-*-win32-*.zip');
  });

  it('retries mac prepackaged builds with both dmg and zip targets', () => {
    const script = readProjectFile('scripts/build-with-builder.js');

    expect(script).toMatch(/--mac\s+dmg\s+zip\s+--\$\{targetArch\}\s+--prepackaged/);
  });

  itWithBash('fails release asset preparation when a mac zip is missing', () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), 'aionui-release-assets-'));
    const artifactsDir = resolve(tempDir, 'build-artifacts');
    const outputDir = resolve(tempDir, 'release-assets');

    try {
      const env = { ...process.env, MOCK_VERSION: '1.0.0' };
      const createResult = spawnSync('bash', ['scripts/create-mock-release-artifacts.sh', artifactsDir], {
        cwd: projectRoot,
        env,
        encoding: 'utf8',
      });
      expect(createResult.status).toBe(0);

      rmSync(resolve(artifactsDir, 'macos-build-arm64', 'Ki-Buddy-1.0.0-mac-arm64.zip'), { force: true });

      const prepareResult = spawnSync('bash', ['scripts/prepare-release-assets.sh', artifactsDir, outputDir], {
        cwd: projectRoot,
        env,
        encoding: 'utf8',
      });

      expect(prepareResult.status).not.toBe(0);
      expect(`${prepareResult.stdout}\n${prepareResult.stderr}`).toContain('Missing macOS zip artifact');
    } finally {
      rmSync(tempDir, { force: true, recursive: true });
    }
  });
});

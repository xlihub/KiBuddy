import { afterEach, describe, expect, it } from 'vitest';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { crc32 } from 'node:zlib';

const {
  getActionsArtifactName,
  getActionsArtifactMissingMessage,
  prepareAioncore,
} = require('../../../packages/shared-scripts/src/prepare-aioncore');
const { selectCandidateArtifact, validateCandidateRun } = require('../../../packages/shared-scripts/src/kiCoreRelease');
const { readKiBuddyRelease } = require('../../../packages/shared-scripts/src/kiBuddyRelease');

type TarModule = {
  c: (options: { cwd: string; file: string; gzip: true }, files: string[]) => Promise<void>;
};

const requireFromSharedScripts = createRequire(join(process.cwd(), 'packages/shared-scripts/package.json'));
const tar = requireFromSharedScripts('tar') as TarModule;
const VALID_SHA = 'a'.repeat(40);
const CANDIDATE_VERSION = '7.8.9';

function copyProductIdentity(projectRoot: string) {
  mkdirSync(projectRoot, { recursive: true });
  for (const file of [
    'ki-buddy-product.json',
    'ki-buddy-version.txt',
    'ki-buddy-release.json',
    'CHANGELOG.ki-buddy.md',
  ]) {
    copyFileSync(join(process.cwd(), file), join(projectRoot, file));
  }
}

function writeStoredZip(filePath: string, entries: Array<{ name: string; content: string | Buffer }>) {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const content = Buffer.from(entry.content);
    const checksum = crc32(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, content);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(content.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + content.length;
  }

  const centralSize = centralParts.reduce((total, part) => total + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  writeFileSync(filePath, Buffer.concat([...localParts, ...centralParts, end]));
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

async function createCandidateToolchain(root: string) {
  const sourceDir = join(root, 'source');
  const archiveName = `ki-core-v${CANDIDATE_VERSION}-x86_64-unknown-linux-gnu.tar.gz`;
  const archivePath = join(root, archiveName);
  const artifactZip = join(root, 'candidate.zip');
  const versionContent = Buffer.from(`${CANDIDATE_VERSION}\n`).toString('base64');
  const upstreamContent = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      repository: 'iOfficeAI/AionCore',
      tag: 'v0.1.73',
      peeledCommit: 'b'.repeat(40),
    })
  ).toString('base64');
  const binaryPath = join(sourceDir, 'aioncore');
  mkdirSync(sourceDir, { recursive: true });
  writeFileSync(
    binaryPath,
    `#!/usr/bin/env bash
set -euo pipefail
if [[ -n "\${KI_CORE_ACTIONS_TOKEN:-}" ]]; then exit 91; fi
bundle=''
while [[ $# -gt 0 ]]; do
  if [[ "$1" == '--bundle-out' ]]; then shift; bundle="$1"; fi
  shift || true
done
mkdir -p "$bundle/node/node-v24-linux-x64/bin"
mkdir -p "$bundle/cli/claude/2.1.215/linux-x64"
mkdir -p "$bundle/cli/codex/0.144.6/linux-x64/vendor/x86_64-unknown-linux-musl/bin"
mkdir -p "$bundle/cli/codex/0.144.6/linux-x64/vendor/x86_64-unknown-linux-musl/codex-path"
: > "$bundle/node/node-v24-linux-x64/bin/node"
: > "$bundle/cli/claude/2.1.215/linux-x64/claude"
: > "$bundle/cli/codex/0.144.6/linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex"
: > "$bundle/cli/codex/0.144.6/linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex-code-mode-host"
: > "$bundle/cli/codex/0.144.6/linux-x64/vendor/x86_64-unknown-linux-musl/codex-path/rg"
cat > "$bundle/manifest.json" <<'JSON'
{"schemaVersion":2,"runtimeKey":"linux-x64","node":{"version":"24.0.0","root":"node/node-v24-linux-x64","executable":"bin/node"},"clis":[{"name":"claude","version":"2.1.215","root":"cli/claude/2.1.215/linux-x64","platformDirectory":"linux-x64","executable":"claude","requiredFiles":[],"requiredDirectories":[]},{"name":"codex","version":"0.144.6","root":"cli/codex/0.144.6/linux-x64","platformDirectory":"linux-x64","executable":"vendor/x86_64-unknown-linux-musl/bin/codex","requiredFiles":[],"requiredDirectories":["vendor/x86_64-unknown-linux-musl"]}]}
JSON
`
  );
  chmodSync(binaryPath, 0o755);
  await tar.c({ cwd: sourceDir, file: archivePath, gzip: true }, ['aioncore']);

  writeStoredZip(artifactZip, [{ name: archiveName, content: readFileSync(archivePath) }]);

  const binDir = join(root, 'bin');
  const curlPath = join(binDir, 'curl');
  mkdirSync(binDir, { recursive: true });
  writeFileSync(
    curlPath,
    `#!/usr/bin/env bash
set -euo pipefail
out=''
url=''
while [[ $# -gt 0 ]]; do
  if [[ "$1" == '-o' ]]; then shift; out="$1"; else url="$1"; fi
  shift || true
done
if [[ "$url" == *'/actions/runs/123/artifacts?per_page=100' ]]; then
  printf '%s' '{"artifacts":[{"id":456,"name":"ki-core-candidate-linux-x64","expired":false,"archive_download_url":"https://example.invalid/candidate.zip"}]}'
elif [[ "$url" == *'/actions/runs/123' ]]; then
  printf '%s' '{"conclusion":"success","event":"workflow_dispatch","head_branch":"product/main","head_sha":"${VALID_SHA}","path":".github/workflows/build-manual.yml","repository":{"full_name":"xlihub/Ki-Core"},"status":"completed"}'
elif [[ "$url" == *'/contents/ki-core-version.txt?ref=${VALID_SHA}' ]]; then
  printf '%s' '{"encoding":"base64","content":"${versionContent}"}'
elif [[ "$url" == *'/contents/ki-core-upstream.json?ref=${VALID_SHA}' ]]; then
  printf '%s' '{"encoding":"base64","content":"${upstreamContent}"}'
elif [[ "$url" == 'https://example.invalid/candidate.zip' ]]; then
  cp ${shellQuote(artifactZip)} "$out"
else
  exit 22
fi
`
  );
  chmodSync(curlPath, 0o755);
  const ghPath = join(binDir, 'gh');
  writeFileSync(ghPath, '#!/usr/bin/env bash\nexit 1\n');
  chmodSync(ghPath, 0o755);
  return binDir;
}

function validRun(overrides = {}) {
  return {
    conclusion: 'success',
    event: 'workflow_dispatch',
    head_branch: 'product/main',
    head_sha: VALID_SHA,
    path: '.github/workflows/build-manual.yml',
    repository: { full_name: 'xlihub/Ki-Core' },
    status: 'completed',
    ...overrides,
  };
}

afterEach(() => {
  delete process.env.AIONUI_BACKEND_EXPECTED_SHA;
  delete process.env.AIONUI_BACKEND_LOCAL_BINARY;
  delete process.env.AIONUI_BACKEND_RUN_ID;
  delete process.env.AIONUI_BACKEND_SOURCE_POLICY;
  delete process.env.KI_CORE_ACTIONS_TOKEN;
});

describe('Ki-Core candidate artifact mapping', () => {
  it.each([
    ['win32', 'x64', 'ki-core-candidate-windows-x64'],
    ['win32', 'arm64', 'ki-core-candidate-windows-arm64'],
    ['darwin', 'x64', 'ki-core-candidate-macos-x64'],
    ['darwin', 'arm64', 'ki-core-candidate-macos-arm64'],
    ['linux', 'x64', 'ki-core-candidate-linux-x64'],
    ['linux', 'arm64', 'ki-core-candidate-linux-arm64'],
  ])('maps %s-%s to %s', (platform, arch, artifactName) => {
    expect(getActionsArtifactName(platform, arch)).toBe(artifactName);
  });

  it('reports the canonical artifact required by a missing candidate', () => {
    expect(
      getActionsArtifactMissingMessage({
        runId: '27319522909',
        platform: 'win32',
        arch: 'x64',
        expectedArtifactName: 'ki-core-candidate-windows-x64',
        availableArtifactNames: ['ki-core-candidate-macos-arm64'],
      })
    ).toContain('Re-run Ki-Core Candidate Build with platform [ windows-x64 ] or all.');
  });
});

describe('Ki-Core candidate run identity', () => {
  it('accepts the expected repository, workflow, successful conclusion, branch, and head SHA', () => {
    expect(() => validateCandidateRun(validRun(), { headSha: VALID_SHA })).not.toThrow();
  });

  it.each([
    ['repository', { repository: { full_name: 'iOfficeAI/AionCore' } }],
    ['workflow', { path: '.github/workflows/release.yml' }],
    ['event', { event: 'push' }],
    ['conclusion', { conclusion: 'failure' }],
    ['status', { status: 'in_progress' }],
    ['head SHA', { head_sha: 'b'.repeat(40) }],
    ['branch', { head_branch: 'feature/untrusted' }],
  ])('rejects a candidate with the wrong %s', (_label, override) => {
    expect(() => validateCandidateRun(validRun(override), { headSha: VALID_SHA })).toThrow(/Ki-Core candidate/);
  });

  it('rejects missing, expired, or duplicate platform artifacts', () => {
    const expectedName = 'ki-core-candidate-linux-x64';
    expect(() => selectCandidateArtifact([], expectedName)).toThrow(/exactly one/);
    expect(() => selectCandidateArtifact([{ name: expectedName, expired: true }], expectedName)).toThrow(/exactly one/);
    expect(() =>
      selectCandidateArtifact(
        [
          { name: expectedName, expired: false },
          { name: expectedName, expired: false },
        ],
        expectedName
      )
    ).toThrow(/exactly one/);
  });
});

describe('Ki-Core candidate source policy', () => {
  it('does not require a cross-repository token for the public Ki-Core repository', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'ki-core-public-candidate-'));
    process.env.AIONUI_BACKEND_SOURCE_POLICY = 'candidate';
    process.env.AIONUI_BACKEND_RUN_ID = '';
    process.env.AIONUI_BACKEND_EXPECTED_SHA = VALID_SHA;
    try {
      expect(() => prepareAioncore({ projectRoot, platform: 'linux', arch: 'x64', version: null })).toThrow(
        /run ID must be numeric/
      );
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('downloads, verifies, installs, and records a public candidate without exposing a token to the binary', async () => {
    if (process.platform === 'win32') return;
    const root = mkdtempSync(join(tmpdir(), 'ki-core-candidate-e2e-'));
    const projectRoot = join(root, 'project');
    const fakeBin = await createCandidateToolchain(root);
    const previousPath = process.env.PATH;
    process.env.PATH = `${fakeBin}${delimiter}${previousPath || ''}`;
    process.env.AIONUI_BACKEND_SOURCE_POLICY = 'candidate';
    process.env.AIONUI_BACKEND_RUN_ID = '123';
    process.env.AIONUI_BACKEND_EXPECTED_SHA = VALID_SHA;
    process.env.KI_CORE_ACTIONS_TOKEN = 'must-not-reach-candidate-binary';
    copyProductIdentity(projectRoot);

    try {
      const result = prepareAioncore({ projectRoot, platform: 'linux', arch: 'x64', version: null });
      const bundleDir = join(projectRoot, 'resources', 'bundled-aioncore', 'linux-x64');
      const manifest = JSON.parse(readFileSync(join(bundleDir, 'manifest.json'), 'utf8'));
      expect(result).toMatchObject({ prepared: true, sourceType: 'actions-artifact' });
      expect(readFileSync(join(bundleDir, 'aioncore'), 'utf8')).toContain('#!/usr/bin/env bash');
      expect(manifest.source).toMatchObject({
        policy: 'candidate',
        repository: 'xlihub/Ki-Core',
        runId: '123',
        headSha: VALID_SHA,
        version: CANDIDATE_VERSION,
        artifactName: 'ki-core-candidate-linux-x64',
      });
      expect(manifest.kiCore).toEqual({ version: CANDIDATE_VERSION, tag: null, releaseCommit: VALID_SHA });
      expect(manifest.aionCore).toEqual({
        repository: 'iOfficeAI/AionCore',
        tag: 'v0.1.73',
        peeledCommit: 'b'.repeat(40),
      });
      const productIdentity = readKiBuddyRelease(process.cwd());
      expect(manifest).toMatchObject({
        schemaVersion: 3,
        version: productIdentity.kiBuddy.version,
        kiBuddy: productIdentity.kiBuddy,
        aionUi: productIdentity.aionUi,
      });
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps local binary development behavior without stable provenance', () => {
    if (process.platform === 'win32') return;
    const root = mkdtempSync(join(tmpdir(), 'ki-core-local-binary-'));
    const projectRoot = join(root, 'project');
    const localBinary = join(root, 'aioncore');
    mkdirSync(dirname(localBinary), { recursive: true });
    writeFileSync(localBinary, '#!/usr/bin/env bash\nexit 0\n');
    chmodSync(localBinary, 0o755);
    process.env.AIONUI_BACKEND_LOCAL_BINARY = localBinary;
    copyProductIdentity(projectRoot);

    try {
      expect(() => prepareAioncore({ projectRoot, platform: 'linux', arch: 'x64', version: 'v8.7.6' })).toThrow(
        /managed-resources\/manifest\.json/
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

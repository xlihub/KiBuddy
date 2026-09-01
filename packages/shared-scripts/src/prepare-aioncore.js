/**
 * Prepare the aioncore runtime binary for Ki-Buddy packaging.
 *
 * Source policies:
 *  - release-pinned: immutable xlihub/Ki-Core release configured in ki-buddy-product.json
 *  - candidate: verified xlihub/Ki-Core Actions candidate run
 *  - development: explicit local inputs or the legacy AionCore development release path
 *
 * @module prepare-aioncore
 */

const { execFileSync, execSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  KI_CORE_REPOSITORY,
  createBundleProvenance,
  extractArchiveSafely,
  getArchiveName,
  getCanonicalTarget,
  getReleaseUrl,
  getSourcePolicy,
  inspectArchiveSafely,
  readKiCorePin,
  selectCandidateArtifact,
  sha256File,
  validateCandidateRun,
  validateDownloadedAssets,
} = require('./kiCoreRelease');
const { validateEntries } = require('./safeExtractArchive');
const { verifyBundledAioncoreResources } = require('./verify-bundled-aioncore-resources');
const { readKiBuddyRelease } = require('./kiBuddyRelease');

const LEGACY_GITHUB_OWNER = 'iOfficeAI';
const LEGACY_GITHUB_REPO = 'AionCore';

function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function removeDirectorySafe(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

function copyFileSafe(sourcePath, targetPath) {
  ensureDirectory(path.dirname(targetPath));
  fs.copyFileSync(sourcePath, targetPath);
}

function copyDirectorySafe(sourcePath, targetPath) {
  ensureDirectory(path.dirname(targetPath));
  fs.cpSync(sourcePath, targetPath, { recursive: true, force: true });
}

function ensureExecutableMode(filePath) {
  if (process.platform === 'win32') return;
  try {
    fs.chmodSync(filePath, 0o755);
  } catch {}
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function getBinaryName(platform) {
  return platform === 'win32' ? 'aioncore.exe' : 'aioncore';
}

function getActionsArtifactName(platform, arch) {
  return `ki-core-candidate-${getCanonicalTarget(platform, arch).platformKey}`;
}

function getActionsArtifactMissingMessage({ runId, platform, arch, expectedArtifactName, availableArtifactNames }) {
  const available =
    Array.isArray(availableArtifactNames) && availableArtifactNames.length > 0
      ? availableArtifactNames.join(', ')
      : '(none)';
  return [
    `Ki-Core run ${runId} does not contain artifact [ ${expectedArtifactName} ] required for [ ${platform}-${arch} ].`,
    `Available artifacts: ${available}.`,
    `Re-run Ki-Core Candidate Build with platform [ ${getCanonicalTarget(platform, arch).platformKey} ] or all.`,
  ].join(' ');
}

function prepareManagedResources(binaryPath, targetDir) {
  const bundleOut = path.join(targetDir, 'managed-resources');
  const dataDir = path.join(targetDir, '.prepare-data');

  removeDirectorySafe(bundleOut);
  removeDirectorySafe(dataDir);
  ensureDirectory(bundleOut);
  ensureDirectory(dataDir);

  console.log(`  Preparing managed resources under ${path.relative(process.cwd(), bundleOut)}`);
  const childEnv = {
    ...process.env,
    AIONUI_BUNDLED_MANAGED_RESOURCES: '',
  };
  delete childEnv.KI_CORE_ACTIONS_TOKEN;
  execFileSync(binaryPath, ['--data-dir', dataDir, 'prepare-managed-resources', '--bundle-out', bundleOut], {
    stdio: 'inherit',
    env: childEnv,
  });

  removeDirectorySafe(dataDir);
  return bundleOut;
}

function verifyPreparedAioncoreBundle(projectRoot, platform, arch) {
  const result = verifyBundledAioncoreResources({
    resourcesDir: path.join(projectRoot, 'resources'),
    electronPlatformName: platform,
    targetArch: arch,
  });
  if (result.missing.length > 0 || result.failures.length > 0) {
    const summary = result.missing.length > 0 ? result.missing.join(', ') : JSON.stringify(result.failures);
    throw new Error(`Prepared aioncore bundle is missing required bundled resource(s): ${summary}`);
  }
  return result;
}

function getGitHubToken() {
  return process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
}

function downloadFile(url, outputPath, token = '') {
  console.log(`  Downloading Ki-Core asset from ${url}`);
  if (process.platform === 'win32') {
    const headers = token ? ` -Headers @{ Authorization = 'Bearer ${token.replace(/'/g, "''")}' }` : '';
    const ps = `$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri '${url.replace(/'/g, "''")}' -OutFile '${outputPath.replace(/'/g, "''")}'${headers}`;
    execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 120000 });
    return;
  }

  const headers = token ? ['-H', `Authorization: Bearer ${token}`] : [];
  try {
    execFileSync('curl', ['-L', '--fail', '--silent', '--show-error', ...headers, '-o', outputPath, url], {
      timeout: 120000,
    });
  } catch (error) {
    if (token) throw error;
    execFileSync('wget', ['-q', '-O', outputPath, url], { timeout: 120000 });
  }
}

function githubApiGetJson(apiPath, token) {
  if (token) {
    try {
      return JSON.parse(
        execFileSync('gh', ['api', apiPath], {
          encoding: 'utf8',
          timeout: 15000,
          env: { ...process.env, GH_TOKEN: token },
        })
      );
    } catch {}
  }

  const headers = ['-H', 'Accept: application/vnd.github+json'];
  if (token) headers.push('-H', `Authorization: Bearer ${token}`);
  const out = execFileSync('curl', ['-fsSL', ...headers, `https://api.github.com/${apiPath}`], {
    encoding: 'utf8',
    timeout: 15000,
  });
  return JSON.parse(out);
}

function githubApiGetContent(pathname, ref, token) {
  const response = githubApiGetJson(
    `repos/${KI_CORE_REPOSITORY}/contents/${pathname}?ref=${encodeURIComponent(ref)}`,
    token
  );
  if (response?.encoding !== 'base64' || typeof response.content !== 'string') {
    throw new Error(`Ki-Core candidate source metadata is missing: ${pathname}`);
  }
  return Buffer.from(response.content.replaceAll('\n', ''), 'base64').toString('utf8');
}

function readCandidateSourceMetadata(expectedSha, version, token) {
  const sourceVersion = githubApiGetContent('ki-core-version.txt', expectedSha, token).trim();
  if (sourceVersion !== version) {
    throw new Error('Ki-Core candidate archive version does not match its source metadata');
  }
  let upstream;
  try {
    upstream = JSON.parse(githubApiGetContent('ki-core-upstream.json', expectedSha, token));
  } catch (error) {
    throw new Error('Ki-Core candidate AionCore mapping is invalid', { cause: error });
  }
  if (
    upstream?.schemaVersion !== 1 ||
    upstream?.repository !== 'iOfficeAI/AionCore' ||
    typeof upstream.tag !== 'string' ||
    !/^v\d+\.\d+\.\d+$/u.test(upstream.tag) ||
    typeof upstream.peeledCommit !== 'string' ||
    !/^[0-9a-f]{40}$/u.test(upstream.peeledCommit)
  ) {
    throw new Error('Ki-Core candidate AionCore mapping is invalid');
  }
  return {
    product: { version, tag: null, releaseCommit: expectedSha },
    upstream: {
      repository: upstream.repository,
      tag: upstream.tag,
      peeledCommit: upstream.peeledCommit,
    },
  };
}

function resolveLatestLegacyTag() {
  const token = getGitHubToken();
  try {
    const out = execSync(`gh api repos/${LEGACY_GITHUB_OWNER}/${LEGACY_GITHUB_REPO}/releases/latest --jq .tag_name`, {
      encoding: 'utf8',
      timeout: 15000,
    }).trim();
    if (out) return out;
  } catch {}

  try {
    const headers = token ? ['-H', `Authorization: Bearer ${token}`] : [];
    const out = execFileSync(
      'curl',
      [
        '-fsSL',
        ...headers,
        `https://api.github.com/repos/${LEGACY_GITHUB_OWNER}/${LEGACY_GITHUB_REPO}/releases/latest`,
      ],
      { encoding: 'utf8', timeout: 15000 }
    );
    return JSON.parse(out).tag_name || null;
  } catch {
    return null;
  }
}

function getLegacyAssetName(platform, arch, tag) {
  const archMap = { x64: 'x86_64', arm64: 'aarch64' };
  const platformMap = { darwin: 'apple-darwin', linux: 'unknown-linux-gnu', win32: 'pc-windows-msvc' };
  if (!archMap[arch] || !platformMap[platform]) return null;
  return `aioncore-${tag}-${archMap[arch]}-${platformMap[platform]}${platform === 'win32' ? '.zip' : '.tar.gz'}`;
}

function createFreshTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function extractExpectedArchive(archivePath, tempDir, binaryName) {
  const extractDir = path.join(tempDir, 'binary');
  extractArchiveSafely(archivePath, extractDir, [binaryName]);
  return path.join(extractDir, binaryName);
}

function downloadAndVerifyStable(platform, arch, pin) {
  const target = getCanonicalTarget(platform, arch);
  const archiveName = getArchiveName(pin.tag, target);
  const tempDir = createFreshTempDir('ki-core-release-');
  const checksumPath = path.join(tempDir, 'ki-core-checksums.txt');
  const archivePath = path.join(tempDir, archiveName);

  try {
    downloadFile(getReleaseUrl(pin.tag, 'ki-core-checksums.txt'), checksumPath);
    downloadFile(getReleaseUrl(pin.tag, archiveName), archivePath);
    validateDownloadedAssets({
      platformKey: target.platformKey,
      tag: pin.tag,
      checksumPath,
      archivePath,
      pinnedChecksums: pin.checksums,
    });
    const binaryPath = extractExpectedArchive(archivePath, tempDir, target.executable);
    const version = pin.tag.replace(/^ki-core-v/, '');
    return {
      binaryPath,
      manifest: {
        product: { version, tag: pin.tag, releaseCommit: pin.commit },
        upstream: pin.aionCore,
      },
      tempDir,
      source: {
        policy: 'release-pinned',
        type: 'github-release',
        repository: KI_CORE_REPOSITORY,
        tag: pin.tag,
        assetName: archiveName,
        url: getReleaseUrl(pin.tag, archiveName),
      },
    };
  } catch (error) {
    removeDirectorySafe(tempDir);
    throw error;
  }
}

function validateCandidateArtifactEntries(entries, target) {
  const archivePattern = new RegExp(
    `^ki-core-v(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)-${target.target.replaceAll('.', '\\.')}${target.extension.replaceAll('.', '\\.')}$`
  );
  const archiveNames = entries.map((entry) => entry.name).filter((name) => archivePattern.test(name));
  if (archiveNames.length !== 1) {
    throw new Error('Ki-Core candidate artifact must contain exactly one canonical platform archive');
  }
  const expectedEntries = [archiveNames[0]];
  validateEntries(entries, expectedEntries);
  const version = archivePattern.exec(archiveNames[0]).slice(1, 4).join('.');
  return { archiveName: archiveNames[0], expectedEntries, version };
}

/**
 * Downloads and verifies one successful Ki-Core Actions candidate for a fixed source commit.
 * @param {string} platform Electron platform name.
 * @param {string} arch Electron target architecture.
 * @param {string} runId Successful Ki-Core Candidate Build run ID.
 * @param {string} expectedSha Full lowercase Ki-Core source commit SHA.
 * @param {string} token Optional GitHub API token.
 * @returns {{binaryPath: string, manifest: object, tempDir: string, source: object}} Verified candidate inputs.
 * @throws {Error} When the run, artifact, archive, source metadata, or checksum cannot be verified.
 */
function downloadAndVerifyCandidate(platform, arch, runId, expectedSha, token) {
  if (!/^[1-9]\d*$/.test(runId)) throw new Error('Ki-Core candidate run ID must be numeric');
  if (!/^[0-9a-f]{40}$/.test(expectedSha))
    throw new Error('Ki-Core candidate head SHA must be a full lowercase commit SHA');
  const target = getCanonicalTarget(platform, arch);
  const run = githubApiGetJson(`repos/${KI_CORE_REPOSITORY}/actions/runs/${runId}`, token);
  validateCandidateRun(run, { headSha: expectedSha });
  const artifactResponse = githubApiGetJson(
    `repos/${KI_CORE_REPOSITORY}/actions/runs/${runId}/artifacts?per_page=100`,
    token
  );
  const artifacts = Array.isArray(artifactResponse?.artifacts) ? artifactResponse.artifacts : [];
  const expectedArtifactName = getActionsArtifactName(platform, arch);
  let artifact;
  try {
    artifact = selectCandidateArtifact(artifacts, expectedArtifactName);
  } catch {
    throw new Error(
      getActionsArtifactMissingMessage({
        runId,
        platform,
        arch,
        expectedArtifactName,
        availableArtifactNames: artifacts
          .map((entry) => entry?.name)
          .filter(Boolean)
          .toSorted(),
      })
    );
  }

  const tempDir = createFreshTempDir('ki-core-candidate-');
  const artifactZipPath = path.join(tempDir, `${expectedArtifactName}.zip`);
  const artifactDir = path.join(tempDir, 'artifact');
  const downloadUrl =
    artifact.archive_download_url ||
    `https://api.github.com/repos/${KI_CORE_REPOSITORY}/actions/artifacts/${artifact.id}/zip`;

  try {
    downloadFile(downloadUrl, artifactZipPath, token);
    const { archiveName, expectedEntries, version } = validateCandidateArtifactEntries(
      inspectArchiveSafely(artifactZipPath),
      target
    );
    extractArchiveSafely(artifactZipPath, artifactDir, expectedEntries);
    const archivePath = path.join(artifactDir, archiveName);
    const binaryPath = extractExpectedArchive(archivePath, tempDir, target.executable);
    return {
      binaryPath,
      manifest: readCandidateSourceMetadata(expectedSha, version, token),
      tempDir,
      source: {
        policy: 'candidate',
        type: 'actions-artifact',
        repository: KI_CORE_REPOSITORY,
        workflow: 'build-manual.yml',
        runId,
        headSha: expectedSha,
        version,
        artifactName: expectedArtifactName,
        checksum: sha256File(archivePath),
        url: downloadUrl,
      },
    };
  } catch (error) {
    removeDirectorySafe(tempDir);
    throw error;
  }
}

function downloadLegacyDevelopment(platform, arch, requestedVersion) {
  const tag =
    requestedVersion === 'latest'
      ? resolveLatestLegacyTag()
      : requestedVersion?.startsWith('v')
        ? requestedVersion
        : `v${requestedVersion}`;
  if (!tag) throw new Error('Failed to resolve the legacy AionCore development release tag');
  const assetName = getLegacyAssetName(platform, arch, tag);
  if (!assetName) throw new Error(`Unsupported AionCore development target: ${platform}-${arch}`);

  const tempDir = createFreshTempDir('aioncore-development-');
  const archivePath = path.join(tempDir, assetName);
  const url = `https://github.com/${LEGACY_GITHUB_OWNER}/${LEGACY_GITHUB_REPO}/releases/download/${tag}/${assetName}`;
  try {
    downloadFile(url, archivePath);
    return {
      binaryPath: extractExpectedArchive(archivePath, tempDir, getBinaryName(platform)),
      manifest: null,
      tempDir,
      source: { policy: 'development', type: 'legacy-release', repository: 'iOfficeAI/AionCore', tag, url },
    };
  } catch (error) {
    removeDirectorySafe(tempDir);
    throw error;
  }
}

function buildBundleManifest({ projectRoot, platform, arch, manifest, source, sourceType, binaryName }) {
  return {
    ...createBundleProvenance(manifest, source, readKiBuddyRelease(projectRoot)),
    platform,
    arch,
    generatedAt: new Date().toISOString(),
    sourceType,
    files: [binaryName, 'managed-resources/'],
  };
}

/**
 * @param {object} options
 * @param {string} options.projectRoot
 * @param {string} options.platform
 * @param {string} options.arch
 * @param {string | null} [options.version]
 * @param {'release-pinned' | 'candidate' | 'development'} [options.sourcePolicy]
 * @returns {{ prepared: true; dir: string; sourceType: string }}
 */
function prepareAioncore(options) {
  const { projectRoot, platform, arch, version = 'latest' } = options;
  const sourcePolicy = getSourcePolicy(options.sourcePolicy);
  const runtimeKey = `${platform}-${arch}`;
  const targetDir = path.join(projectRoot, 'resources', 'bundled-aioncore', runtimeKey);
  const binaryName = getBinaryName(platform);
  const targetBinaryPath = path.join(targetDir, binaryName);
  let tempDir = null;

  removeDirectorySafe(targetDir);
  ensureDirectory(targetDir);

  try {
    if (sourcePolicy === 'development') {
      const localBundleDir = (process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR || '').trim();
      if (localBundleDir) {
        const resolvedLocalBundleDir = path.resolve(localBundleDir);
        const localBinaryPath = path.join(resolvedLocalBundleDir, binaryName);
        const localManagedResourcesDir = path.join(resolvedLocalBundleDir, 'managed-resources');
        if (
          fs.existsSync(resolvedLocalBundleDir) &&
          fs.statSync(resolvedLocalBundleDir).isDirectory() &&
          fs.existsSync(localBinaryPath) &&
          fs.existsSync(localManagedResourcesDir)
        ) {
          copyDirectorySafe(resolvedLocalBundleDir, targetDir);
          ensureExecutableMode(targetBinaryPath);
          writeJson(
            path.join(targetDir, 'manifest.json'),
            buildBundleManifest({
              projectRoot,
              platform,
              arch,
              manifest: null,
              source: { policy: 'development', type: 'local-bundle', path: resolvedLocalBundleDir },
              sourceType: 'local-bundle',
              binaryName,
            })
          );
          verifyPreparedAioncoreBundle(projectRoot, platform, arch);
          return { prepared: true, dir: targetDir, sourceType: 'local-bundle' };
        }
        console.warn(`  Local aioncore bundle is incomplete or missing: ${resolvedLocalBundleDir}`);
      }
    } else if (process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR || process.env.AIONUI_BACKEND_LOCAL_BINARY) {
      throw new Error(`Local Ki-Core inputs are forbidden by the ${sourcePolicy} source policy`);
    }

    let result;
    if (sourcePolicy === 'release-pinned') {
      if (process.env.AIONUI_BACKEND_RUN_ID || process.env.AIONUI_BACKEND_VERSION) {
        throw new Error('release-pinned policy forbids Actions run IDs and version overrides');
      }
      result = downloadAndVerifyStable(platform, arch, readKiCorePin(projectRoot));
    } else if (sourcePolicy === 'candidate') {
      if (process.env.AIONUI_BACKEND_VERSION) {
        throw new Error('candidate policy forbids stable version overrides');
      }
      const runId = (process.env.AIONUI_BACKEND_RUN_ID || '').trim();
      const expectedSha = (process.env.AIONUI_BACKEND_EXPECTED_SHA || '').trim();
      const token = (process.env.KI_CORE_ACTIONS_TOKEN || '').trim();
      result = downloadAndVerifyCandidate(platform, arch, runId, expectedSha, token);
    } else {
      const localBinary = (process.env.AIONUI_BACKEND_LOCAL_BINARY || '').trim();
      if (localBinary) {
        const resolvedLocalBinary = path.resolve(localBinary);
        if (!fs.existsSync(resolvedLocalBinary) || !fs.statSync(resolvedLocalBinary).isFile()) {
          throw new Error(`Local aioncore binary not found: ${resolvedLocalBinary}`);
        }
        result = {
          binaryPath: resolvedLocalBinary,
          manifest: null,
          tempDir: null,
          source: { policy: 'development', type: 'local-binary', path: resolvedLocalBinary },
        };
      } else {
        result = downloadLegacyDevelopment(platform, arch, version || 'latest');
      }
    }

    tempDir = result.tempDir;
    copyFileSafe(result.binaryPath, targetBinaryPath);
    ensureExecutableMode(targetBinaryPath);
    const bundledManagedResourcesDir = prepareManagedResources(targetBinaryPath, targetDir);
    const sourceType = result.source.type;
    writeJson(
      path.join(targetDir, 'manifest.json'),
      buildBundleManifest({
        projectRoot,
        platform,
        arch,
        manifest: result.manifest,
        source: result.source,
        sourceType,
        binaryName,
      })
    );
    verifyPreparedAioncoreBundle(projectRoot, platform, arch);
    console.log(`  Bundled aioncore prepared: resources/bundled-aioncore/${runtimeKey}/${binaryName}`);
    console.log(`  Bundled managed resources prepared: ${bundledManagedResourcesDir}`);
    return { prepared: true, dir: targetDir, sourceType };
  } catch (error) {
    removeDirectorySafe(targetDir);
    throw error;
  } finally {
    if (tempDir) removeDirectorySafe(tempDir);
  }
}

module.exports = {
  downloadAndVerifyCandidate,
  getActionsArtifactMissingMessage,
  getActionsArtifactName,
  prepareAioncore,
  verifyPreparedAioncoreBundle,
};

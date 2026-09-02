const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { isDeepStrictEqual } = require('node:util');
const { listFilesRecursively, requireSinglePath } = require('./artifactFiles');
const { readProductConfig } = require('./kiBuddyRelease');
const { resolveKiBuddyPackagingIdentity } = require('./kiBuddyPackagingIdentity');

function requireFile(filePath, label) {
  if (!fs.statSync(filePath, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`${label} is missing: ${filePath}`);
  }
  return filePath;
}

function requirePackagedResource(sourcePath, packagedPath, label) {
  for (const [filePath, kind] of [
    [sourcePath, 'source'],
    [packagedPath, 'packaged resource'],
  ]) {
    requireFile(filePath, `${label} ${kind}`);
    if (fs.statSync(filePath).size === 0) {
      throw new Error(`${label} ${kind} must not be empty`);
    }
  }
  if (!fs.readFileSync(sourcePath).equals(fs.readFileSync(packagedPath))) {
    throw new Error(`${label} must use the configured project resource`);
  }
}

function requireRelativePath(value, label) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value) || value.split(/[\\/]/u).includes('..')) {
    throw new Error(`${label} must be a safe relative path`);
  }
  return value;
}

function resolveBundledRuntime(resourcesDir, platform, bundledAionCorePath) {
  const bundledRoot = path.join(resourcesDir, bundledAionCorePath);
  const runtimeDirectories = fs
    .readdirSync(bundledRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(`${platform}-`));
  if (runtimeDirectories.length !== 1) {
    throw new Error(`Expected one ${platform} bundled AionCore runtime in ${bundledRoot}`);
  }
  return path.join(bundledRoot, runtimeDirectories[0].name);
}

function resolveManagedNode(runtimeDirectory, platform) {
  const managedResourcesDir = path.join(runtimeDirectory, 'managed-resources');
  const manifestPath = requireFile(
    path.join(managedResourcesDir, 'manifest.json'),
    `${platform} managed Node manifest`
  );
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    throw new Error(`${platform} managed Node manifest is invalid JSON`);
  }
  if (!manifest?.node || typeof manifest.node !== 'object') {
    throw new Error(`${platform} managed Node manifest does not declare Node`);
  }
  const nodeRoot = requireRelativePath(manifest.node.root, `${platform} managed Node root`);
  const nodeExecutable = requireRelativePath(manifest.node.executable, `${platform} managed Node executable`);
  return requireFile(path.join(managedResourcesDir, nodeRoot, nodeExecutable), `${platform} managed Node executable`);
}

function verifyKiCoreProvenance(runtimeDirectory, platform, expectedBuildPlan, expectedPlatform) {
  if (!expectedBuildPlan) return;
  const platformPrefix = platform === 'darwin' ? 'macos-' : platform === 'win32' ? 'windows-' : `${platform}-`;
  const runtimeKey = path.basename(runtimeDirectory);
  const runtimePrefix = `${platform}-`;
  if (!runtimeKey.startsWith(runtimePrefix)) {
    throw new Error('Bundled Ki-Core runtime target does not match the resolved build plan');
  }
  const arch = runtimeKey.slice(runtimePrefix.length);
  const selectedPlatform = `${platformPrefix}${arch}`;
  if (!expectedBuildPlan.platforms.includes(selectedPlatform)) {
    throw new Error('Bundled Ki-Core runtime target is not selected by the resolved build plan');
  }
  if (expectedPlatform && selectedPlatform !== expectedPlatform) {
    throw new Error('Bundled Ki-Core runtime target does not match the artifact platform');
  }
  const manifestPath = requireFile(path.join(runtimeDirectory, 'manifest.json'), 'Bundled Ki-Core manifest');
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    throw new Error('Bundled Ki-Core manifest is invalid JSON');
  }
  const expected = expectedBuildPlan.kiCore;
  const expectedSourcePolicy = expected.sourcePolicy ?? 'release-pinned';
  const expectedVersion = expected.version ?? expected.tag?.replace(/^ki-core-v/u, '');
  const commonMatches =
    manifest?.platform === platform &&
    manifest?.arch === arch &&
    manifest?.source?.policy === expectedSourcePolicy &&
    manifest?.source?.repository === expected.repository &&
    manifest?.kiCore?.version === expectedVersion &&
    manifest?.kiCore?.tag === expected.tag &&
    manifest?.kiCore?.releaseCommit === expected.commit &&
    isDeepStrictEqual(manifest?.aionCore, expected.aionCore);
  const sourceMatches =
    expectedSourcePolicy === 'candidate'
      ? manifest?.source?.workflow === expected.candidate?.workflow &&
        Number(manifest?.source?.runId) === expected.candidate?.runId &&
        manifest?.source?.headSha === expected.commit &&
        manifest?.source?.artifactName === expected.candidate?.artifacts?.[selectedPlatform] &&
        manifest?.source?.checksum === expected.checksums?.[selectedPlatform]
      : manifest?.source?.tag === expected.tag;
  if (!commonMatches || !sourceMatches) {
    throw new Error('Bundled Ki-Core provenance does not match the resolved build plan');
  }
}

function resolveMacApp(inputPath, productName) {
  if (inputPath.endsWith('.app')) return inputPath;
  const appName = `${productName}.app`;
  const direct = path.join(inputPath, appName);
  if (fs.statSync(direct, { throwIfNoEntry: false })?.isDirectory()) return direct;
  const matches = fs
    .readdirSync(inputPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.endsWith('.app'));
  if (matches.length !== 1) throw new Error(`Expected one unpacked macOS app in ${inputPath}`);
  return path.join(inputPath, matches[0].name);
}

function readMacInfoPlist(infoPlistPath) {
  const output = execFileSync('plutil', ['-convert', 'json', '-o', '-', infoPlistPath], { encoding: 'utf8' });
  return JSON.parse(output);
}

function readWindowsExecutableMetadata(executablePath) {
  const escapedPath = executablePath.replaceAll("'", "''");
  const output = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `Add-Type -AssemblyName System.Drawing; $item = Get-Item -LiteralPath '${escapedPath}'; $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($item.FullName); $width = if ($null -eq $icon) { 0 } else { $icon.Width }; $height = if ($null -eq $icon) { 0 } else { $icon.Height }; if ($null -ne $icon) { $icon.Dispose() }; [PSCustomObject]@{ productName = $item.VersionInfo.ProductName; iconWidth = $width; iconHeight = $height } | ConvertTo-Json -Compress`,
    ],
    { encoding: 'utf8' }
  );
  return JSON.parse(output);
}

function readWindowsPeArchitecture(filePath) {
  const contents = fs.readFileSync(filePath);
  if (contents.length < 64 || contents[0] !== 0x4d || contents[1] !== 0x5a) {
    throw new Error(`Windows PE file has an invalid DOS header: ${filePath}`);
  }
  const peOffset = contents.readUInt32LE(0x3c);
  if (
    peOffset > contents.length - 6 ||
    contents[peOffset] !== 0x50 ||
    contents[peOffset + 1] !== 0x45 ||
    contents[peOffset + 2] !== 0 ||
    contents[peOffset + 3] !== 0
  ) {
    throw new Error(`Windows PE file has an invalid PE signature: ${filePath}`);
  }
  const machine = contents.readUInt16LE(peOffset + 4);
  if (machine === 0x8664) return 'x64';
  if (machine === 0xaa64) return 'arm64';
  throw new Error(`Windows PE file has an unsupported machine type 0x${machine.toString(16)}: ${filePath}`);
}

function readWindowsProtocolRegistrations(schemes) {
  const schemesJson = JSON.stringify(schemes).replaceAll("'", "''");
  const output = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `$schemes = ConvertFrom-Json '${schemesJson}'; $registrations = @($schemes | ForEach-Object { $scheme = $_; $keyPath = "Registry::HKEY_CLASSES_ROOT\\$scheme"; $commandPath = "$keyPath\\shell\\open\\command"; if ((Test-Path -LiteralPath $keyPath) -and (Test-Path -LiteralPath $commandPath)) { $key = Get-Item -LiteralPath $keyPath; $commandKey = Get-Item -LiteralPath $commandPath; [PSCustomObject]@{ scheme = $scheme; urlProtocolPresent = $null -ne $key.GetValue('URL Protocol', $null); command = $commandKey.GetValue($null, $null) } } else { [PSCustomObject]@{ scheme = $scheme; urlProtocolPresent = $false; command = $null } } }); [PSCustomObject]@{ registrations = $registrations } | ConvertTo-Json -Compress -Depth 3`,
    ],
    { encoding: 'utf8' }
  );
  return JSON.parse(output).registrations;
}

function verifyMacIdentity(appPath, packagingIdentity) {
  const info = readMacInfoPlist(requireFile(path.join(appPath, 'Contents', 'Info.plist'), 'macOS Info.plist'));
  if (info.CFBundleIdentifier !== packagingIdentity.desktop.appId) {
    throw new Error('macOS CFBundleIdentifier does not match the expected application identity');
  }
  if (info.CFBundleDisplayName !== packagingIdentity.desktop.productName) {
    throw new Error('macOS CFBundleDisplayName does not match the expected product name');
  }
  if (info.CFBundleExecutable !== packagingIdentity.desktop.executableName) {
    throw new Error('macOS CFBundleExecutable does not match the expected executable name');
  }
  const schemes = (info.CFBundleURLTypes || []).flatMap((entry) => entry.CFBundleURLSchemes || []);
  const configuredSchemes = packagingIdentity.desktop.protocols.flatMap((protocol) => protocol.schemes);
  if (JSON.stringify(schemes) !== JSON.stringify(configuredSchemes)) {
    throw new Error('macOS URL schemes do not match the expected packaging identity');
  }
}

function verifyPackagedProtocol(resourcesDir, packagingIdentity) {
  const appArchive = fs.readFileSync(requireFile(path.join(resourcesDir, 'app.asar'), 'Packaged app archive'));
  const protocolSchemes = packagingIdentity.desktop.protocols.flatMap((protocol) => protocol.schemes);
  if (protocolSchemes.some((scheme) => !appArchive.includes(Buffer.from(scheme, 'utf8')))) {
    throw new Error('Packaged app protocol does not match the expected packaging identity');
  }
}

function readDesktopEntry(filePath) {
  return Object.fromEntries(
    fs
      .readFileSync(filePath, 'utf8')
      .split(/\r?\n/u)
      .filter((line) => line && !line.startsWith('#') && !line.startsWith('[') && line.includes('='))
      .map((line) => {
        const separator = line.indexOf('=');
        return [line.slice(0, separator), line.slice(separator + 1)];
      })
  );
}

function verifyLinuxPackageIdentity(packageRoot, packagingIdentity) {
  const desktopEntryPath = requireSinglePath(
    listFilesRecursively(packageRoot).filter(
      (filePath) => path.basename(filePath) === `${packagingIdentity.desktop.executableName}.desktop`
    ),
    'Linux desktop entry'
  );
  const entry = readDesktopEntry(desktopEntryPath);
  const protocolSchemes = packagingIdentity.desktop.protocols.flatMap((protocol) => protocol.schemes);
  const protocolHandlers = new Set(
    String(entry.MimeType || '')
      .split(';')
      .filter(Boolean)
  );
  if (
    entry.Name !== packagingIdentity.desktop.productName ||
    entry.Icon !== packagingIdentity.desktop.executableName ||
    !String(entry.Exec || '').includes(`/${packagingIdentity.desktop.executableName}`) ||
    protocolSchemes.some((scheme) => !protocolHandlers.has(`x-scheme-handler/${scheme}`))
  ) {
    throw new Error('Linux desktop metadata does not match the expected packaging identity');
  }
  const installedIcons = listFilesRecursively(packageRoot).filter(
    (filePath) =>
      path.basename(filePath) === `${packagingIdentity.desktop.executableName}.png` && fs.statSync(filePath).size > 0
  );
  if (installedIcons.length === 0) {
    throw new Error('Linux installer does not contain the expected application icon');
  }
}

function resolveLinuxApplicationRoot(packageRoot, packagingIdentity) {
  const buildEvidencePath = packagingIdentity.resources.packaged.buildEvidence;
  const matches = listFilesRecursively(packageRoot)
    .filter((filePath) => filePath.endsWith(path.join('resources', buildEvidencePath)))
    .map((filePath) => filePath.slice(0, -path.join('resources', buildEvidencePath).length).replace(/[\\/]$/u, ''));
  return requireSinglePath([...new Set(matches)], 'Linux installed application');
}

/** Materializes the application contained in one platform-native installer for packaged verification. */
function materializeKiBuddyInstaller(installerPath, platform, packagingIdentity, options = {}) {
  const execute = options.execute ?? execFileSync;
  const tempRoot = options.tempRoot ?? fs.mkdtempSync(path.join(os.tmpdir(), 'ki-buddy-installer-'));
  const cleanup = (detachPath, uninstallPath) => {
    if (detachPath) {
      try {
        execute('hdiutil', ['detach', detachPath], { stdio: ['ignore', 'ignore', 'ignore'] });
      } catch {
        // The runner is ephemeral; verification failures must not be replaced by detach failures.
      }
    }
    if (uninstallPath) {
      try {
        execute(uninstallPath, ['/S', `_?=${path.dirname(uninstallPath)}`], {
          windowsVerbatimArguments: true,
          stdio: ['ignore', 'ignore', 'ignore'],
        });
      } catch {
        // Verification already completed; removal of the ephemeral install directory still continues.
      }
    }
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  };
  try {
    if (platform.startsWith('macos-')) {
      const mountPath = path.join(tempRoot, 'mount');
      fs.mkdirSync(mountPath, { recursive: true });
      execute('hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mountPath, installerPath], {
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      return { packageRoot: mountPath, unpackedPath: mountPath, cleanup: () => cleanup(mountPath) };
    }
    if (platform.startsWith('windows-')) {
      const installPath = path.join(tempRoot, 'installed');
      execute(installerPath, ['/S', `/D=${installPath}`], {
        windowsVerbatimArguments: true,
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      if (!fs.statSync(installPath, { throwIfNoEntry: false })?.isDirectory()) {
        throw new Error('Windows installer did not create the requested installation directory');
      }
      const uninstallPath = listFilesRecursively(installPath).find((filePath) =>
        /^uninstall.*\.exe$/iu.test(path.basename(filePath))
      );
      return { packageRoot: installPath, unpackedPath: installPath, cleanup: () => cleanup(undefined, uninstallPath) };
    }
    if (platform.startsWith('linux-')) {
      const packageRoot = path.join(tempRoot, 'package');
      fs.mkdirSync(packageRoot, { recursive: true });
      execute('dpkg-deb', ['--extract', installerPath, packageRoot], { stdio: ['ignore', 'ignore', 'pipe'] });
      return {
        packageRoot,
        unpackedPath: resolveLinuxApplicationRoot(packageRoot, packagingIdentity),
        cleanup: () => cleanup(),
      };
    }
    throw new Error(`Unsupported Ki-Buddy installer platform: ${platform}`);
  } catch (error) {
    cleanup();
    throw error;
  }
}

function toDistributionEvidence(buildPlan) {
  return {
    schemaVersion: buildPlan.schemaVersion,
    distributionId: buildPlan.distributionId,
    mode: buildPlan.mode,
    version: buildPlan.version,
    identityMode: buildPlan.identityMode,
    source: buildPlan.source,
    registration: buildPlan.registration,
    manifest: buildPlan.manifest,
    baseline: buildPlan.baseline,
    platforms: buildPlan.platforms,
    integrations: buildPlan.integrations,
    disabledFeatures: buildPlan.disabledFeatures,
    runtimeIdentity: buildPlan.runtimeIdentity,
    kiCore: buildPlan.kiCore,
    secretScope: buildPlan.secretScope,
    ...(buildPlan.deliveryHistory ? { deliveryHistory: buildPlan.deliveryHistory } : {}),
    ...(buildPlan.candidate ? { candidate: buildPlan.candidate } : {}),
  };
}

function verifyBuildEvidence(resourcesDir, packagingIdentity, expectsPackagingIdentity, expectedBuildPlan) {
  const evidencePath = requireFile(
    path.join(resourcesDir, packagingIdentity.resources.packaged.buildEvidence),
    'Packaging build evidence'
  );
  let evidence;
  try {
    evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  } catch {
    throw new Error('Packaging build evidence is invalid JSON');
  }
  if (
    evidence?.schemaVersion !== 2 ||
    evidence?.product?.runtimeIdentity !== packagingIdentity.product.runtimeIdentity ||
    evidence?.product?.productName !== packagingIdentity.desktop.productName
  ) {
    throw new Error('Packaging build evidence product identity does not match the expected identity');
  }
  if (expectsPackagingIdentity && !evidence.packagingIdentity) {
    throw new Error('Project packaging build evidence is missing its resolved identity');
  }
  if (evidence.packagingIdentity && !isDeepStrictEqual(evidence.packagingIdentity, packagingIdentity)) {
    throw new Error('Packaging build evidence resolved identity does not match the expected identity');
  }
  if (expectedBuildPlan && !isDeepStrictEqual(evidence.distribution, toDistributionEvidence(expectedBuildPlan))) {
    throw new Error('Packaging build evidence distribution does not match the resolved build plan');
  }
  if (
    expectedBuildPlan &&
    (evidence.source?.repository !== expectedBuildPlan.source.repository ||
      evidence.source?.commit !== expectedBuildPlan.source.commit ||
      evidence.source?.treeDirty !== false)
  ) {
    throw new Error('Project packaging build evidence must identify the clean committed source from the build plan');
  }
  return evidencePath;
}

/** Verifies product identity in an electron-builder unpacked output. */
function verifyKiBuddyUnpacked(
  projectRoot,
  unpackedPath,
  platform = process.platform,
  expectedIdentity,
  expectedBuildPlan,
  packageRoot,
  options = {}
) {
  const productConfig = readProductConfig(projectRoot);
  const expectsPackagingIdentity = expectedIdentity !== undefined;
  const packagingIdentity = resolveKiBuddyPackagingIdentity(productConfig, expectedIdentity);
  const absoluteInput = path.resolve(unpackedPath);
  const productIcon = path.join(projectRoot, packagingIdentity.resources.platform.png);
  let applicationRoot;
  let resourcesDir;
  let executablePath;

  if (platform === 'darwin') {
    applicationRoot = resolveMacApp(absoluteInput, packagingIdentity.desktop.productName);
    resourcesDir = path.join(applicationRoot, 'Contents', 'Resources');
    executablePath = path.join(applicationRoot, 'Contents', 'MacOS', packagingIdentity.desktop.executableName);
    verifyMacIdentity(applicationRoot, packagingIdentity);
  } else {
    applicationRoot = absoluteInput;
    resourcesDir = path.join(applicationRoot, 'resources');
    executablePath = path.join(
      applicationRoot,
      `${packagingIdentity.desktop.executableName}${platform === 'win32' ? '.exe' : ''}`
    );
  }

  requireFile(executablePath, `${platform} packaged executable`);
  requirePackagedResource(
    productIcon,
    path.join(resourcesDir, packagingIdentity.resources.packaged.applicationIcon),
    `${platform} application icon`
  );
  requirePackagedResource(
    productIcon,
    path.join(resourcesDir, packagingIdentity.resources.packaged.runtimeIcon),
    `${platform} runtime icon`
  );
  const agentsMcpAdapterPath = requireFile(
    path.join(resourcesDir, packagingIdentity.resources.packaged.agentsMcpAdapter),
    `${platform} Agents MCP Adapter`
  );
  const bundledRuntimeDirectory = resolveBundledRuntime(
    resourcesDir,
    platform,
    packagingIdentity.resources.packaged.bundledAionCore
  );
  const expectedPlatform =
    options.expectedPlatform ??
    (expectedBuildPlan?.platforms?.length === 1 ? expectedBuildPlan.platforms[0] : undefined);
  verifyKiCoreProvenance(bundledRuntimeDirectory, platform, expectedBuildPlan, expectedPlatform);
  const managedNodePath = resolveManagedNode(bundledRuntimeDirectory, platform);
  verifyPackagedProtocol(resourcesDir, packagingIdentity);
  const buildEvidencePath = verifyBuildEvidence(
    resourcesDir,
    packagingIdentity,
    expectsPackagingIdentity,
    expectedBuildPlan
  );

  if (platform === 'linux' && packageRoot) {
    verifyLinuxPackageIdentity(packageRoot, packagingIdentity);
  }

  return {
    agentsMcpAdapterPath,
    applicationRoot,
    buildEvidencePath,
    executablePath,
    managedNodePath,
    platform,
    productName: packagingIdentity.desktop.productName,
  };
}

/** Verifies Windows architecture, metadata, and protocol registration after installing a project EXE. */
function verifyKiBuddyWindowsInstallation(applicationRoot, packagingIdentity, expectedPlatform, options = {}) {
  if (!expectedPlatform?.startsWith('windows-')) {
    throw new Error('Windows artifact verification requires its canonical platform');
  }
  const executablePath = path.join(applicationRoot, `${packagingIdentity.desktop.executableName}.exe`);
  const expectedArchitecture = expectedPlatform.slice('windows-'.length);
  if (readWindowsPeArchitecture(executablePath) !== expectedArchitecture) {
    throw new Error('Windows executable architecture does not match the artifact platform');
  }
  const nativeModulePath = requireFile(
    path.join(
      applicationRoot,
      'resources',
      'app.asar.unpacked',
      'node_modules',
      'better-sqlite3',
      'build',
      'Release',
      'better_sqlite3.node'
    ),
    'Windows better-sqlite3 native module'
  );
  if (readWindowsPeArchitecture(nativeModulePath) !== expectedArchitecture) {
    throw new Error('Windows better-sqlite3 architecture does not match the artifact platform');
  }
  const metadata = (options.readWindowsExecutableMetadata ?? readWindowsExecutableMetadata)(executablePath);
  if (
    metadata?.productName !== packagingIdentity.desktop.productName ||
    !Number.isSafeInteger(metadata?.iconWidth) ||
    metadata.iconWidth < 16 ||
    !Number.isSafeInteger(metadata?.iconHeight) ||
    metadata.iconHeight < 16
  ) {
    throw new Error('Windows executable metadata or icon does not match the expected packaging identity');
  }
  const protocolSchemes = packagingIdentity.desktop.protocols.flatMap((protocol) => protocol.schemes);
  const registrationResult = (options.readWindowsProtocolRegistrations ?? readWindowsProtocolRegistrations)(
    protocolSchemes
  );
  const registrations = Array.isArray(registrationResult) ? registrationResult : [];
  const normalizedExecutablePath = executablePath.replaceAll('\\', '/').toLowerCase();
  if (
    protocolSchemes.some((scheme) => {
      const registration = registrations.find((entry) => entry?.scheme === scheme);
      return (
        registration?.urlProtocolPresent !== true ||
        typeof registration.command !== 'string' ||
        !registration.command.replaceAll('\\', '/').toLowerCase().includes(normalizedExecutablePath)
      );
    })
  ) {
    throw new Error('Windows URL protocol registration does not match the installed application');
  }
}

function runCli() {
  const args = process.argv.slice(2);
  const pathIndex = args.indexOf('--path');
  const platformIndex = args.indexOf('--platform');
  if (pathIndex === -1 || !args[pathIndex + 1]) throw new Error('verify unpacked requires --path');
  const projectRoot = path.resolve(__dirname, '../../..');
  const result = verifyKiBuddyUnpacked(
    projectRoot,
    path.resolve(args[pathIndex + 1]),
    platformIndex === -1 ? process.platform : args[platformIndex + 1]
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) {
  try {
    runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

module.exports = { materializeKiBuddyInstaller, verifyKiBuddyUnpacked, verifyKiBuddyWindowsInstallation };

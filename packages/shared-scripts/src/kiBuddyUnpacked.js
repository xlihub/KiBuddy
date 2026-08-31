const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { isDeepStrictEqual } = require('node:util');
const { readProductConfig } = require('./kiBuddyRelease');
const { resolveKiBuddyPackagingIdentity } = require('./kiBuddyPackagingIdentity');

function requireFile(filePath, label) {
  if (!fs.statSync(filePath, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`${label} is missing: ${filePath}`);
  }
  return filePath;
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function requireMatchingFile(expectedPath, actualPath, label) {
  requireFile(expectedPath, `${label} source`);
  requireFile(actualPath, `${label} packaged resource`);
  if (sha256(expectedPath) !== sha256(actualPath)) {
    throw new Error(`${label} does not match the configured Ki-Buddy product resource`);
  }
}

function requireRelativePath(value, label) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value) || value.split(/[\\/]/u).includes('..')) {
    throw new Error(`${label} must be a safe relative path`);
  }
  return value;
}

function resolveManagedNode(resourcesDir, platform, bundledAionCorePath) {
  const bundledRoot = path.join(resourcesDir, bundledAionCorePath);
  const runtimeDirectories = fs
    .readdirSync(bundledRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(`${platform}-`));
  if (runtimeDirectories.length !== 1) {
    throw new Error(`Expected one ${platform} bundled AionCore runtime in ${bundledRoot}`);
  }
  const managedResourcesDir = path.join(bundledRoot, runtimeDirectories[0].name, 'managed-resources');
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

function readWindowsProductName(executablePath) {
  const escapedPath = executablePath.replaceAll("'", "''");
  return execFileSync(
    'powershell.exe',
    ['-NoProfile', '-Command', `(Get-Item -LiteralPath '${escapedPath}').VersionInfo.ProductName`],
    { encoding: 'utf8' }
  ).trim();
}

function verifyMacIdentity(appPath, packagingIdentity) {
  const info = readMacInfoPlist(requireFile(path.join(appPath, 'Contents', 'Info.plist'), 'macOS Info.plist'));
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

function verifyBuildEvidence(resourcesDir, packagingIdentity, expectsPackagingIdentity) {
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
  return evidencePath;
}

/** Verifies product identity in an electron-builder unpacked output. */
function verifyKiBuddyUnpacked(projectRoot, unpackedPath, platform = process.platform, expectedIdentity) {
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
  requireMatchingFile(
    productIcon,
    path.join(resourcesDir, packagingIdentity.resources.packaged.applicationIcon),
    `${platform} application icon`
  );
  requireMatchingFile(
    productIcon,
    path.join(resourcesDir, packagingIdentity.resources.packaged.runtimeIcon),
    `${platform} runtime icon`
  );
  const agentsMcpAdapterPath = requireFile(
    path.join(resourcesDir, packagingIdentity.resources.packaged.agentsMcpAdapter),
    `${platform} Agents MCP Adapter`
  );
  const managedNodePath = resolveManagedNode(
    resourcesDir,
    platform,
    packagingIdentity.resources.packaged.bundledAionCore
  );
  const buildEvidencePath = verifyBuildEvidence(resourcesDir, packagingIdentity, expectsPackagingIdentity);

  if (platform === 'win32' && readWindowsProductName(executablePath) !== packagingIdentity.desktop.productName) {
    throw new Error('Windows executable ProductName does not match the expected product name');
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

module.exports = { verifyKiBuddyUnpacked };

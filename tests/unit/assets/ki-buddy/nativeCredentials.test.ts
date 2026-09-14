import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, cpSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, win32 } from 'node:path';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const projectRoot = resolve(__dirname, '../../../..');
const localRequire = createRequire(join(projectRoot, 'package.json'));
const asarPath = localRequire.resolve('@electron/asar', { paths: [dirname(localRequire.resolve('electron-builder'))] });
const asar = localRequire(asarPath);
type BuildContext = {
  arch: string;
  electronPlatformName: string;
  appOutDir: string;
  packager: {
    projectDir: string;
    info: { appDir: string; electronVersion: string };
    appInfo: { productFilename: string };
  };
};
type NativeModules = {
  beforePack: (context: BuildContext) => Promise<void>;
  verifyPackagedKeytar: (resourcesDir: string, platform: string, arch: string) => void;
  [name: string]: unknown;
};

function loadScript<T>(file: string, overrides: Record<string, unknown>): T {
  const scriptPath = resolve(projectRoot, 'scripts', file);
  const scriptRequire = createRequire(scriptPath);
  const module = { exports: {} };
  runInNewContext(readFileSync(scriptPath, 'utf8'), {
    module,
    exports: module.exports,
    __dirname: dirname(scriptPath),
    process: { ...process, env: {} },
    console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    require: Object.assign((name: string) => overrides[name] ?? scriptRequire(name), {
      resolve: scriptRequire.resolve,
    }),
  });
  return module.exports as T;
}

describe('packaged native credentials', () => {
  let root: string;
  let context: BuildContext;
  let keytarRoot: string;
  let packagedKeytarRoot: string;
  let execFile: ReturnType<typeof vi.fn>;
  let nativeModules: NativeModules;

  function writeBinary(moduleRoot: string, name = 'keytar'): void {
    const binary = join(moduleRoot, 'build', 'Release', `${name}.node`);
    mkdirSync(dirname(binary), { recursive: true });
    writeFileSync(binary, 'test native binary');
  }

  async function writePackagedArchive(indexed = true, unpacked = true): Promise<void> {
    const source = join(root, 'archive-source');
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, 'package.json'), '{}');
    if (indexed) writeBinary(join(source, 'node_modules/keytar'));
    const archivePath = join(context.appOutDir, 'Ki-Buddy.app/Contents/Resources/app.asar');
    await asar.createPackageWithOptions(
      source,
      archivePath,
      unpacked ? { unpackDir: '**/node_modules/keytar/**/*' } : {}
    );
  }

  function afterPack(buildArch = 'x64'): (value: BuildContext) => Promise<void> {
    return loadScript('afterPack.js', {
      os: { arch: () => buildArch },
      './rebuildNativeModules': nativeModules,
      '../packages/shared-scripts/src/verify-bundled-aioncore-resources': {
        verifyBundledAioncoreResources: () => ({ missing: [], checked: [], runtimeKey: 'darwin-x64' }),
      },
    });
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ki-native-credentials-'));
    context = {
      arch: 'x64',
      electronPlatformName: 'darwin',
      appOutDir: join(root, 'out'),
      packager: {
        projectDir: root,
        info: { appDir: root, electronVersion: '37.10.3' },
        appInfo: { productFilename: 'Ki-Buddy' },
      },
    };
    keytarRoot = join(root, 'node_modules', 'keytar');
    packagedKeytarRoot = join(
      context.appOutDir,
      'Ki-Buddy.app/Contents/Resources/app.asar.unpacked/node_modules/keytar'
    );
    mkdirSync(keytarRoot, { recursive: true });
    mkdirSync(packagedKeytarRoot, { recursive: true });
    writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: { keytar: '^7.9.0' } }));
    writeFileSync(
      join(keytarRoot, 'package.json'),
      JSON.stringify({ name: 'keytar', version: '7.9.0', config: { runtime: 'napi', target: 3 } })
    );
    execFile = vi.fn((command: string, _args: string[], options?: { cwd: string }) => {
      if (command === 'lipo') return 'x86_64\n';
      if (options) writeBinary(options.cwd);
      return '';
    });
    nativeModules = loadScript('rebuildNativeModules.js', {
      child_process: { execFileSync: execFile, execSync: vi.fn(), spawnSync: () => ({ status: 1 }) },
    });
  });

  afterEach(() => {
    asar.uncacheAll();
    rmSync(root, { recursive: true, force: true });
  });

  it('rejects a same-architecture app with no keytar binary', async () => {
    await expect(afterPack()(context)).rejects.toThrow(/keytar/);
  });

  it('rejects an app with the entire keytar directory missing', async () => {
    rmSync(packagedKeytarRoot, { recursive: true });
    await expect(afterPack('arm64')(context)).rejects.toThrow(/keytar/);
  });

  it('does not accept an unrelated native binary in place of keytar.node', async () => {
    writeBinary(packagedKeytarRoot, 'unrelated');
    await expect(afterPack()(context)).rejects.toThrow(/keytar/);
  });

  it('rejects the wrong macOS architecture even when keytar.node exists', async () => {
    writeBinary(packagedKeytarRoot);
    execFile.mockReturnValue('arm64\n');
    await expect(afterPack()(context)).rejects.toThrow(/keytar/);
  });

  it('rejects a binary without its ASAR archive', async () => {
    writeBinary(packagedKeytarRoot);
    await expect(afterPack()(context)).rejects.toThrow(/keytar ASAR entry/);
  });

  it.each([true, false])('validates the ASAR index with Windows path semantics (indexed: %s)', async (indexed) => {
    await writePackagedArchive(indexed);
    writeBinary(packagedKeytarRoot);
    const resourcesDir = join(context.appOutDir, 'Ki-Buddy.app/Contents/Resources');
    const virtualResourcesDir = 'C:\\Ki-Buddy\\resources';
    // Use the installed ASAR lookup implementation with Windows paths on every test host.
    const { Filesystem } = loadScript<{
      Filesystem: new (source: string) => { header: unknown; getFile: (filename: string) => unknown };
    }>(join(dirname(asarPath), 'filesystem.js'), { path: win32 });
    const filesystem = new Filesystem(virtualResourcesDir);
    filesystem.header = asar.getRawHeader(join(resourcesDir, 'app.asar')).header;
    const windowsModules = loadScript<NativeModules>('rebuildNativeModules.js', {
      path: win32,
      fs: {
        statSync: (filename: string) =>
          statSync(join(resourcesDir, ...win32.relative(virtualResourcesDir, filename).split(win32.sep)), {
            throwIfNoEntry: false,
          }),
      },
      [asarPath]: {
        uncache: vi.fn(),
        statFile: (_archivePath: string, filename: string) => filesystem.getFile(filename),
      },
    });
    const verify = (): void => windowsModules.verifyPackagedKeytar(virtualResourcesDir, 'win32', 'x64');
    if (indexed) {
      expect(verify).not.toThrow();
    } else {
      expect(verify).toThrow(/keytar ASAR entry/);
    }
  });

  it.each([
    ['missing', false, true],
    ['packed', true, false],
  ] as const)('rejects a %s ASAR entry even if the external binary exists', async (_kind, indexed, unpacked) => {
    writeBinary(packagedKeytarRoot);
    await writePackagedArchive(indexed, unpacked);
    await expect(afterPack()(context)).rejects.toThrow(/keytar ASAR entry/);
  });

  it('accepts a binary whose size changes during signing after ASAR creation', async () => {
    await writePackagedArchive();
    writeFileSync(join(packagedKeytarRoot, 'build/Release/keytar.node'), 'test native binary with signature');
    await expect(afterPack()(context)).resolves.toBeUndefined();
  });

  it('reads the replacement archive instead of reusing a cached index', async () => {
    await writePackagedArchive();
    await expect(afterPack()(context)).resolves.toBeUndefined();
    const archivePath = join(context.appOutDir, 'Ki-Buddy.app/Contents/Resources/app.asar');
    writeFileSync(archivePath, 'invalid archive');
    await expect(afterPack()(context)).rejects.toThrow(/keytar ASAR entry/);
  });

  it('prepares the N-API binary for the target before ASAR creation', async () => {
    await nativeModules.beforePack(context);
    expect(execFile).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(['--runtime=napi', '--target=3', '--arch=x64']),
      expect.objectContaining({ cwd: keytarRoot })
    );
    expect(existsSync(join(keytarRoot, 'build/Release/keytar.node'))).toBe(true);
  });

  it('fails preparation when the download command reports success without a binary', async () => {
    execFile.mockReturnValue('');
    await expect(nativeModules.beforePack(context)).rejects.toThrow(/keytar/);
  });

  it('fails preparation when keytar is declared but not installed', async () => {
    rmSync(keytarRoot, { recursive: true });
    await expect(nativeModules.beforePack(context)).rejects.toThrow(/keytar/);
  });

  it('keeps builds without the credential dependency independent of keytar', async () => {
    writeFileSync(join(root, 'package.json'), '{}');
    await nativeModules.beforePack(context);
    expect(execFile).not.toHaveBeenCalled();
  });

  it('accepts a packaged app that does not declare the credential dependency', async () => {
    writeFileSync(join(root, 'package.json'), '{}');
    rmSync(packagedKeytarRoot, { recursive: true });
    await expect(afterPack()(context)).resolves.toBeUndefined();
  });

  it('includes the prepared binary in both the ASAR index and unpacked files', async () => {
    await nativeModules.beforePack(context);
    const appDir = join(root, 'app');
    cpSync(keytarRoot, join(appDir, 'node_modules/keytar'), { recursive: true });
    const archivePath = join(root, 'app.asar');
    await asar.createPackageWithOptions(appDir, archivePath, { unpackDir: '**/node_modules/keytar/**/*' });
    const binaryPath = join('node_modules', 'keytar', 'build', 'Release', 'keytar.node');
    expect(asar.statFile(archivePath, binaryPath)).toMatchObject({ unpacked: true });
    expect(existsSync(join(`${archivePath}.unpacked`, binaryPath))).toBe(true);
  });

  it('preserves the prepared credential binary through cross-architecture afterPack', async () => {
    await writePackagedArchive();
    await afterPack('arm64')(context);
    expect(existsSync(join(packagedKeytarRoot, 'build/Release/keytar.node'))).toBe(true);
    expect(execFile.mock.calls.filter(([command]) => command !== 'lipo')).toHaveLength(0);
  });

  it('registers a callable beforePack hook using the installed electron-builder resolver', async () => {
    const builderRoot = dirname(
      localRequire.resolve('app-builder-lib/package.json', {
        paths: [dirname(localRequire.resolve('electron-builder'))],
      })
    );
    const { resolveFunction } = localRequire(join(builderRoot, 'out/util/resolve.js'));
    const hook = await resolveFunction(
      'commonjs',
      join(projectRoot, 'scripts/rebuildNativeModules.js'),
      'beforePack',
      projectRoot
    );
    expect(typeof hook).toBe('function');
    expect(readFileSync(join(projectRoot, 'packages/desktop/electron-builder.yml'), 'utf8')).toContain(
      'beforePack: scripts/rebuildNativeModules.js'
    );
  });
});

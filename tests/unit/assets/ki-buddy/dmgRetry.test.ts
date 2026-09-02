import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const projectRoot = resolve(__dirname, '../../../..');
const scriptRequire = createRequire(join(projectRoot, 'scripts/build-with-builder.js'));
const asar = scriptRequire(
  scriptRequire.resolve('@electron/asar', { paths: [dirname(scriptRequire.resolve('electron-builder'))] })
);
const binaryPath = 'node_modules/keytar/build/Release/keytar.node';

describe('macOS distributable retry validation', () => {
  let root: string;
  let configPath: string;
  let appPath: string;
  let exec: ReturnType<typeof vi.fn>;
  let spawn: ReturnType<typeof vi.fn>;
  let lipo: ReturnType<typeof vi.fn>;
  let build: (cmd: string, arch: string, config: string) => void;
  const initialError = new Error('initial packaging failed');

  async function packageApp(target = appPath, indexed = true, unpacked = true): Promise<void> {
    const source = join(root, 'source');
    rmSync(source, { recursive: true, force: true });
    mkdirSync(join(source, dirname(binaryPath)), { recursive: true });
    writeFileSync(join(source, 'package.json'), '{}');
    if (indexed) writeFileSync(join(source, binaryPath), 'native binary');
    const resources = join(target, 'Contents/Resources');
    mkdirSync(resources, { recursive: true });
    await asar.createPackageWithOptions(
      source,
      join(resources, 'app.asar'),
      unpacked ? { unpackDir: '**/node_modules/keytar/**/*' } : {}
    );
    if (!indexed || !unpacked) {
      const externalBinary = join(resources, 'app.asar.unpacked', binaryPath);
      mkdirSync(dirname(externalBinary), { recursive: true });
      writeFileSync(externalBinary, 'native binary');
    }
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ki-dmg-retry-'));
    mkdirSync(join(root, 'out'), { recursive: true });
    writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: { keytar: '^7.9.0' } }));
    configPath = join(root, 'out/builder.json');
    writeFileSync(configPath, JSON.stringify({ productName: 'Ki-Buddy', executableName: 'Ki-Buddy' }));
    appPath = join(root, 'out/mac/Ki-Buddy.app');
    exec = vi.fn().mockImplementationOnce(() => {
      throw initialError;
    });
    spawn = vi.fn(() => ({ status: 0 }));
    lipo = vi.fn(() => 'x86_64\n');
    const nativeModule = { exports: {} };
    const mockRequire = Object.assign(
      (name: string) =>
        name === 'child_process' ? { execSync: exec, spawnSync: spawn, execFileSync: lipo } : scriptRequire(name),
      { resolve: scriptRequire.resolve }
    );
    const globals = {
      __dirname: join(root, 'scripts'),
      process: { ...process, platform: 'darwin', env: {} },
      console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };
    runInNewContext(readFileSync(join(projectRoot, 'scripts/rebuildNativeModules.js'), 'utf8'), {
      ...globals,
      module: nativeModule,
      require: mockRequire,
    });
    const buildModule = { exports: {} as { buildWithDmgRetry: typeof build } };
    // Load CLI function declarations without executing the build entry point.
    const source = readFileSync(join(projectRoot, 'scripts/build-with-builder.js'), 'utf8').split(
      '// Parse command line arguments'
    )[0];
    runInNewContext(`${source}\nmodule.exports = { buildWithDmgRetry };`, {
      ...globals,
      module: buildModule,
      require: Object.assign(
        (name: string) => (name === './rebuildNativeModules' ? nativeModule.exports : mockRequire(name)),
        { resolve: scriptRequire.resolve }
      ),
    });
    build = buildModule.exports.buildWithDmgRetry;
  });

  afterEach(() => {
    asar.uncacheAll();
    rmSync(root, { recursive: true, force: true });
  });

  it('stops without retrying or sleeping when the packaged binary is missing', async () => {
    await packageApp();
    rmSync(join(appPath, 'Contents/Resources/app.asar.unpacked', binaryPath));
    expect(() => build('initial build', 'x64', configPath)).toThrow(/keytar/);
    expect(exec).toHaveBeenCalledTimes(1);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('stops when the packaged binary targets another architecture', async () => {
    await packageApp();
    lipo.mockReturnValue('arm64\n');
    expect(() => build('initial build', 'x64', configPath)).toThrow(/keytar/);
    expect(exec).toHaveBeenCalledTimes(1);
    expect(spawn).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', false, true],
    ['packed', true, false],
  ] as const)('stops when the ASAR entry is %s despite an external binary', async (_kind, indexed, unpacked) => {
    await packageApp(appPath, indexed, unpacked);
    expect(() => build('initial build', 'x64', configPath)).toThrow(/keytar/);
    expect(exec).toHaveBeenCalledTimes(1);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('retries a valid app after a transient DMG failure using the validated path', async () => {
    await packageApp();
    await packageApp(join(root, 'out/mac/A-Other.app'));
    build('initial build', 'x64', configPath);
    expect(exec).toHaveBeenCalledTimes(2);
    expect(exec.mock.calls[1][0]).toContain(`--prepackaged "${appPath}"`);
    expect(lipo).toHaveBeenCalledWith(
      'lipo',
      ['-archs', join(appPath, 'Contents/Resources/app.asar.unpacked', binaryPath)],
      { encoding: 'utf8' }
    );
  });

  it.each(['mac/Ki-Other.app', 'mac-arm64/Ki-Buddy.app'])(
    'does not select a leftover %s for an x64 build',
    async (relativePath) => {
      await packageApp(join(root, 'out', relativePath));
      expect(() => build('initial build', 'x64', configPath)).toThrow(initialError);
      expect(exec).toHaveBeenCalledTimes(1);
      expect(spawn).not.toHaveBeenCalled();
    }
  );

  it('honors the generated mac executable name and default architecture', async () => {
    writeFileSync(
      configPath,
      JSON.stringify({
        productName: 'Other',
        executableName: 'Ignored',
        mac: { executableName: 'Ki Buddy', defaultArch: 'arm64' },
      })
    );
    appPath = join(root, 'out/mac-x64/Ki Buddy.app');
    await packageApp();
    build('initial build', 'x64', configPath);
    expect(exec.mock.calls[1][0]).toContain(`--prepackaged "${appPath}"`);
  });

  it('checks the binary again before each retry', async () => {
    await packageApp();
    exec.mockImplementationOnce(() => {
      rmSync(join(appPath, 'Contents/Resources/app.asar.unpacked', binaryPath));
      throw new Error('transient DMG failure');
    });
    expect(() => build('initial build', 'x64', configPath)).toThrow(/keytar/);
    expect(exec).toHaveBeenCalledTimes(2);
    expect(spawn.mock.calls.filter(([cmd]) => cmd === 'sleep')).toHaveLength(1);
  });

  it('retries a valid binary whose size changed during signing', async () => {
    await packageApp();
    writeFileSync(join(appPath, 'Contents/Resources/app.asar.unpacked', binaryPath), 'native binary with signature');
    build('initial build', 'x64', configPath);
    expect(exec).toHaveBeenCalledTimes(2);
    expect(exec.mock.calls[1][0]).toContain(`--prepackaged "${appPath}"`);
  });

  it('retains bounded retries for a valid app when DMG creation keeps failing', async () => {
    await packageApp();
    exec.mockImplementation(() => {
      throw new Error('persistent DMG failure');
    });
    expect(() => build('initial build', 'x64', configPath)).toThrow('persistent DMG failure');
    expect(exec).toHaveBeenCalledTimes(4);
  });
});

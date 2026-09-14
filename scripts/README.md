# Build Scripts Documentation

This directory contains scripts for building and packaging AionUi across different platforms and architectures.

## Scripts Overview

| Script                    | Lines | Purpose                                         |
| ------------------------- | ----- | ----------------------------------------------- |
| `build-with-builder.js`   | 116   | Coordinates Electron Forge and electron-builder |
| `rebuildNativeModules.js` | 219   | **Unified native module rebuild utility**       |
| `beforeBuild.js`          | 38    | Pre-packaging native module rebuild hook        |
| `afterPack.js`            | 67    | Post-packaging verification (Linux only)        |
| `afterSign.js`            | 47    | macOS code signing and notarization             |

**Total**: 487 lines (down from 711 lines before optimization)

## Architecture

### Build Flow

```
npm run dist:*
    ↓
build-with-builder.js
    ↓
    ├─→ Electron Forge (webpack compilation)
    ↓
electron-builder
    ↓
    ├─→ beforeBuild.js → rebuildNativeModules.js (all platforms)
    ├─→ Package app
    ├─→ afterPack.js → rebuildNativeModules.js (Linux only)
    └─→ afterSign.js (macOS only)
```

## Native Module Rebuild Strategy

### Ki-Buddy 凭据模块

`electron-builder.yml` 的 `beforePack` hook 调用 `rebuildNativeModules.js` 导出的同名函数。在创建 ASAR 前，为目标平台与架构准备 `keytar`；同架构构建也执行。keytar 7.9.0 使用其 package metadata 声明的 N-API v3 预编译包，不能使用 Electron ABI 资产名下载。

`afterPack.js` 通过共享的 `verifyPackagedKeytar` 检查 `app.asar.unpacked/node_modules/keytar/build/Release/keytar.node` 是否存在、ASAR 索引是否标记为 unpacked，并在 macOS 上用 `lipo -archs` 检查目标架构。文件缺失、架构不符或索引异常会终止打包。macOS 签名可能改变解包二进制的大小，因此不要求文件大小与签名前的索引记录相等。跨架构的 `afterPack` 不再删除或重建已准备的 keytar 文件；它们必须与 ASAR 创建时的文件索引保持一致。

macOS DMG 重试根据生成的 electron-builder 配置及目标架构定位具体 `.app`，每次调用 `--prepackaged` 前对同一路径执行共享校验。校验失败会直接抛出错误，不等待或继续重试；有效应用仍可重试临时 DMG 制作失败。这样可避免 `--prepackaged` 跳过 hooks 后将凭据模块不完整的应用制作为安装包。

回归验证：`bun run test tests/unit/assets/ki-buddy/nativeCredentials.test.ts tests/unit/assets/ki-buddy/dmgRetry.test.ts`。测试隔离下载、编译及 DMG 命令，覆盖文件缺失、错误架构、未安装依赖、真实 ASAR 索引与解包文件、产品和架构目录选择，以及重试退出条件；目标机器上的完整登录仍需用重新构建的安装包验收。

### `rebuildNativeModules.js` - Unified Rebuild Utility

This is the core module that handles all native module rebuilding. It provides:

#### Functions

1. **`rebuildWithElectronRebuild(options)`**
   - Used by: `beforeBuild.js`
   - Rebuilds all native modules in source directory
   - Modules: `better-sqlite3`

2. **`rebuildSingleModule(options)`**
   - Used by: `afterPack.js`
   - Rebuilds a single module in packaged app
   - Strategy: Try prebuild-install first, fall back to electron-rebuild

3. **`verifyModuleBinary(moduleRoot, moduleName)`**
   - Verifies native binary exists after rebuild

4. **Helper utilities**:
   - `normalizeArch()`: Normalize architecture names
   - `getModulesToRebuild()`: Get platform-specific module list
   - `buildEnvironment()`: Create rebuild environment variables

### Platform-Specific Behavior

#### Windows

- **Modules rebuilt**: `better-sqlite3`
- **Skipped**: `node-pty` (uses prebuilt binaries)
- **Environment**: MSVS 2022, Windows SDK 10.0.19041.0

#### macOS

- **Modules rebuilt**: `better-sqlite3`
- **When**: `beforeBuild` hook only
- **Post-build**: Code signing and notarization

#### Linux

- **Modules rebuilt**: `better-sqlite3`
- **When**:
  - `beforeBuild`: Rebuild in source directory
  - `afterPack`: Rebuild `better-sqlite3` in packaged app
- **Strategy**: Download prebuilt binary first, compile if unavailable

## Usage Examples

### Building for specific platform

```bash
# Build for macOS
npm run dist:mac

# Build for Windows
npm run dist:win

# Build for Linux
npm run dist:linux
```

### Manual native module rebuild

```javascript
const { rebuildWithElectronRebuild } = require('./scripts/rebuildNativeModules');

rebuildWithElectronRebuild({
  platform: 'linux',
  arch: 'arm64',
  electronVersion: '37.3.1',
});
```

### Rebuild single module in packaged app

```javascript
const { rebuildSingleModule } = require('./scripts/rebuildNativeModules');

rebuildSingleModule({
  moduleName: 'better-sqlite3',
  moduleRoot: '/path/to/app.asar.unpacked/node_modules/better-sqlite3',
  platform: 'linux',
  arch: 'arm64',
  electronVersion: '37.3.1',
});
```

## Why Two Rebuild Stages?

### beforeBuild (All Platforms)

- Rebuilds modules in **source directory** (`node_modules/`)
- Ensures correct binaries are packaged
- Uses `electron-rebuild` for all modules

### afterPack (Linux Only)

- Rebuilds `better-sqlite3` in **packaged app** (`app.asar.unpacked/`)
- Handles cross-compilation issues
- Uses `prebuild-install` for faster builds (downloads prebuilt binary)

## Troubleshooting

### Module not found after packaging

**Symptom**: `Error: Cannot find module 'better-sqlite3'`

**Solution**: Check that:

1. Module is in `packages/desktop/electron-builder.yml` → `files` section
2. Module is in `packages/desktop/electron-builder.yml` → `asarUnpack` section
3. `beforeBuild.js` ran successfully during build
4. For Linux: `afterPack.js` ran successfully

### Native module crashes on launch

**Symptom**: App crashes with segfault or binary incompatibility error

**Solution**:

1. Verify target architecture matches build architecture
2. Check that `beforeBuild.js` rebuilt for correct architecture
3. For Linux ARM64: Ensure `afterPack.js` rebuilt the module

### Cross-compilation fails

**Symptom**: Native module rebuild fails during cross-arch build

**Solution**:

- Windows: This is expected for `node-pty` (uses prebuilt binaries)
- macOS/Linux: Ensure build tools for target architecture are installed
- Consider building on native architecture instead

## Optimization History

### Version 1.0 (Before Optimization)

- Total: 711 lines across 5 files
- Duplication: Rebuild logic in both `beforeBuild` and `afterPack`

### Version 2.0 (Current)

- Total: 487 lines across 5 files
- Savings: 224 lines (31% reduction)
- Changes:
  - ✅ Deleted `release.sh` (67 lines) - use `npm version` instead
  - ✅ Created `rebuildNativeModules.js` (219 lines) - unified utility
  - ✅ Simplified `build-with-builder.js`: 321 → 116 lines
  - ✅ Simplified `beforeBuild.js`: 95 → 38 lines
  - ✅ Simplified `afterPack.js`: 181 → 67 lines

## Contributing

When modifying build scripts:

1. **Test on all platforms** before committing
2. **Update this documentation** if behavior changes
3. **Maintain the unified rebuild utility** - avoid duplicating logic
4. **Keep error messages clear** - they help users troubleshoot

## Related Files

- `/packages/desktop/electron-builder.yml` - electron-builder configuration
- `/forge.config.ts` - Electron Forge configuration
- `/.github/workflows/build-and-release.yml` - CI/CD pipeline
- `/package.json` - Build scripts and dependencies

/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const installTransportMock = vi.fn();
const productMigrationMocks = vi.hoisted(() => ({
  agentsMcp: vi.fn(),
  channel: vi.fn(),
  generic: vi.fn(),
}));

vi.mock('@/common/adapter/httpBridge', () => ({
  setHttpRequestTransport: installTransportMock,
}));
vi.mock('electron', () => ({
  app: { getPath: vi.fn() },
  BrowserWindow: vi.fn(),
  ipcMain: { handle: vi.fn() },
  session: { defaultSession: { cookies: { remove: vi.fn(), set: vi.fn() } } },
}));
vi.mock('@/common/config/configMigration', () => ({
  migrateLegacyChannelSettings: productMigrationMocks.channel,
}));
vi.mock('@/process/utils/runBackendMigrations', () => ({
  runBackendMigrations: productMigrationMocks.generic,
}));
vi.mock('@/process/ki-buddy/agents/registration', () => ({
  ensureAgentsMcpRegistration: productMigrationMocks.agentsMcp,
}));

const {
  MAIN_PRODUCT_LIFECYCLE_REGISTRY,
  createKiBuddyProductBootstrap,
  createKiBuddyProductIntegrityWindow,
  createKiBuddyRuntime,
  resolveMainProductExperience,
  runProductBackendMigrations,
  shouldStartProductBusinessLifecycle,
  startAgentsMcpProductLifecycle,
  startProductFeatureLifecycles,
} = await import('@/process/ki-buddy');
const { configureKiBuddyCliSafeDirectories } = await import('@/process/ki-buddy/runtimeIdentity');
const { BrowserWindow } = await import('electron');
const { KI_BUDDY_PRODUCT_CONFIG_RESULT, createAionUiProductExperience, createKiBuddyProductExperience } =
  await import('@/common/platform/ki-buddy');
const { NodePlatformServices } = await import('@/common/platform/NodePlatformServices');
const { registerPlatformServices } = await import('@/common/platform');
const { getConfigPath, getDataPath } = await import('@process/utils');
const { KiBuddyGitHubProvider } = await import('@/process/ki-buddy/update/githubUpdateProvider');

function createAppPath(productRuntime?: string): string {
  const appPath = mkdtempSync(join(tmpdir(), 'ki-buddy-runtime-'));
  writeFileSync(join(appPath, 'package.json'), JSON.stringify(productRuntime ? { productRuntime } : {}));
  return appPath;
}

describe('Ki-Buddy main-process runtime facade', () => {
  const appPaths: string[] = [];

  afterEach(() => {
    installTransportMock.mockReset();
    vi.mocked(BrowserWindow).mockReset();
    for (const appPath of appPaths.splice(0)) rmSync(appPath, { recursive: true, force: true });
  });

  it('keeps product-specific main lifecycles in one stable registry', () => {
    expect(MAIN_PRODUCT_LIFECYCLE_REGISTRY).toEqual({
      accountCoreTransport: { featureId: 'account' },
      agentsMcp: { featureId: 'tools' },
      channelsMigration: { featureId: 'channels' },
      desktopPet: { featureId: 'desktopPet' },
      scheduledTasks: { featureId: 'scheduledTasks' },
      webUi: { featureId: 'webUi' },
    });
  });

  it('runs Channels migration only for product adapters that enable its lifecycle', async () => {
    const configFile = {} as never;
    const kiBuddyExperience = createKiBuddyProductExperience(KI_BUDDY_PRODUCT_CONFIG_RESULT.config?.experience);

    await runProductBackendMigrations(configFile, kiBuddyExperience);
    expect(productMigrationMocks.generic).toHaveBeenCalledOnce();
    expect(productMigrationMocks.channel).not.toHaveBeenCalled();

    await runProductBackendMigrations(configFile, createAionUiProductExperience());
    expect(productMigrationMocks.generic).toHaveBeenCalledTimes(2);
    expect(productMigrationMocks.channel).toHaveBeenCalledOnce();
  });

  it('registers the Agents MCP only when both capability and integration policy allow it', async () => {
    const configFile = {} as never;
    const kiBuddyExperience = createKiBuddyProductExperience(KI_BUDDY_PRODUCT_CONFIG_RESULT.config?.experience);

    await runProductBackendMigrations(configFile, kiBuddyExperience, 'ki-buddy');
    expect(productMigrationMocks.agentsMcp).toHaveBeenCalledOnce();

    await runProductBackendMigrations(configFile, kiBuddyExperience, 'ki-buddy', []);
    expect(productMigrationMocks.agentsMcp).toHaveBeenCalledOnce();

    await runProductBackendMigrations(configFile, kiBuddyExperience, 'ki-buddy', ['agentsGateway']);
    expect(productMigrationMocks.agentsMcp).toHaveBeenCalledTimes(2);

    await runProductBackendMigrations(configFile, createAionUiProductExperience(), null);
    expect(productMigrationMocks.agentsMcp).toHaveBeenCalledTimes(2);
  });

  it('starts and cleans up the Agents MCP bridge when the Tools capability is present', async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const startRuntimeBridge = vi.fn().mockResolvedValue({ close });
    const onWillQuit = vi.fn();
    const experience = createKiBuddyProductExperience(KI_BUDDY_PRODUCT_CONFIG_RESULT.config?.experience);

    await expect(startAgentsMcpProductLifecycle(experience, {} as never, onWillQuit, startRuntimeBridge)).resolves.toBe(
      true
    );

    expect(startRuntimeBridge).toHaveBeenCalledOnce();
    expect(onWillQuit).toHaveBeenCalledOnce();
    await onWillQuit.mock.calls[0][0]();
    expect(close).toHaveBeenCalledOnce();
  });

  it('does not start the Agents MCP bridge when the Tools capability is absent', async () => {
    const startRuntimeBridge = vi.fn();
    const onWillQuit = vi.fn();
    const config = KI_BUDDY_PRODUCT_CONFIG_RESULT.config!.experience;
    const experience = createKiBuddyProductExperience({
      ...config,
      features: { ...config.features, tools: 'disabled' },
    });

    await expect(startAgentsMcpProductLifecycle(experience, {} as never, onWillQuit, startRuntimeBridge)).resolves.toBe(
      false
    );

    expect(startRuntimeBridge).not.toHaveBeenCalled();
    expect(onWillQuit).not.toHaveBeenCalled();
  });

  it('does not start the Agents MCP bridge when the integration is absent', async () => {
    const startRuntimeBridge = vi.fn();
    const onWillQuit = vi.fn();
    const experience = createKiBuddyProductExperience(KI_BUDDY_PRODUCT_CONFIG_RESULT.config?.experience);

    await expect(
      startAgentsMcpProductLifecycle(experience, {} as never, onWillQuit, startRuntimeBridge, [])
    ).resolves.toBe(false);

    expect(startRuntimeBridge).not.toHaveBeenCalled();
    expect(onWillQuit).not.toHaveBeenCalled();
  });

  it('does not initialize product transport when the runtime capability is absent', () => {
    const appPath = createAppPath();
    appPaths.push(appPath);

    expect(createKiBuddyRuntime({ appPath, resetPassword: false, webUi: false })).toEqual({
      status: 'absent',
      productIdentity: null,
      runtime: null,
      error: null,
    });
    expect(installTransportMock).not.toHaveBeenCalled();
  });

  it('initializes product transport only for the explicit Ki-Buddy desktop runtime', () => {
    const appPath = createAppPath('ki-buddy');
    appPaths.push(appPath);

    const selection = createKiBuddyRuntime({ appPath, resetPassword: false, webUi: false });
    const runtime = selection.runtime!;
    const bootstrap = createKiBuddyProductBootstrap(selection);
    expect(selection.status).toBe('ready');
    expect(bootstrap).toMatchObject({
      status: 'ready',
      productIdentity: 'ki-buddy',
      capability: { experience: { features: { team: 'disabled' } } },
      error: null,
    });
    expect(runtime).toMatchObject({
      brand: {
        productName: 'Ki-Buddy',
      },
      productIdentity: 'ki-buddy',
    });
    expect(runtime.brand.iconPath).toBe(KI_BUDDY_PRODUCT_CONFIG_RESULT.config?.assets.packaged.icon);
    expect(runtime.productCapability.experience).toBe(KI_BUDDY_PRODUCT_CONFIG_RESULT.config?.experience);
    expect(Object.isFrozen(bootstrap)).toBe(true);
    expect(Object.isFrozen(bootstrap.capability?.brand)).toBe(true);
    expect(Object.isFrozen(bootstrap.capability?.brand.links)).toBe(true);
    expect(Object.isFrozen(bootstrap.capability?.experience.resources.assistant)).toBe(true);
    expect(runtime.productExperience.featureState('team')).toBe('disabled');
    expect(runtime.updateBridge).toEqual({
      allowRepositoryOverride: false,
      repository: 'xlihub/KiBuddy',
      source: 'github',
      tagPrefix: 'ki-buddy-v',
      userAgent: 'Ki-Buddy',
    });
    expect(runtime.updateFeed).toEqual({
      feedOptions: {
        owner: 'xlihub',
        provider: 'custom',
        repo: 'KiBuddy',
        tagPrefix: 'ki-buddy-v',
        updateProvider: KiBuddyGitHubProvider,
      },
      label: 'Ki-Buddy GitHub provider',
      updaterCacheDirName: 'com.xlihub.ki-buddy',
    });
    expect(installTransportMock).toHaveBeenCalledOnce();
  });

  it('disables GitHub updates through product capability independently of Agents identity', () => {
    const appPath = createAppPath('ki-buddy');
    appPaths.push(appPath);
    const baseConfig = KI_BUDDY_PRODUCT_CONFIG_RESULT.config!;
    const selection = createKiBuddyRuntime(
      { appPath, resetPassword: false, webUi: false },
      {
        config: {
          ...baseConfig,
          experience: {
            ...baseConfig.experience,
            features: { ...baseConfig.experience.features, githubResources: 'disabled' },
          },
        },
        error: null,
      }
    );

    expect(selection.runtime?.identityMode).toBe('agents');
    expect(selection.runtime?.updateBridge).toBeNull();
    expect(selection.runtime?.updateFeed).toBeNull();
  });

  it('starts a local project runtime without installing the Agents account transport', () => {
    const appPath = createAppPath('ki-buddy');
    appPaths.push(appPath);
    const baseConfig = KI_BUDDY_PRODUCT_CONFIG_RESULT.config!;
    const selection = createKiBuddyRuntime(
      { appPath, resetPassword: false, webUi: false },
      {
        config: {
          ...baseConfig,
          distribution: {
            schemaVersion: 1,
            distributionId: 'zxjt',
            identityMode: 'local',
            mode: 'preview',
            dataDirectory: 'Ki-Buddy-ZXJT-Preview',
            credentialNamespace: 'ki-buddy-zxjt-preview',
            integrations: [],
            nonSensitiveConfig: {},
          },
          experience: {
            ...baseConfig.experience,
            features: {
              ...baseConfig.experience.features,
              account: 'disabled',
              agents: 'enabled',
              about: 'disabled',
              feedback: 'disabled',
              githubResources: 'disabled',
            },
          },
        },
        error: null,
      }
    );

    expect(selection.runtime).toMatchObject({
      coreAuthOptions: null,
      identityMode: 'local',
      integrations: [],
      productExperience: expect.any(Object),
      registerAuthBridge: null,
      updateBridge: null,
      updateFeed: null,
    });
    expect(selection.runtime?.productExperience.featureState('account')).toBe('disabled');
    expect(selection.runtime?.productExperience.featureState('agents')).toBe('enabled');
    expect(selection.runtime?.productCapability.integrations).toEqual([]);
    expect(createKiBuddyProductBootstrap(selection)).toMatchObject({
      status: 'ready',
      identityMode: 'local',
    });
    expect(installTransportMock).not.toHaveBeenCalled();
  });

  it('exposes account-aware migration scheduling only through the Ki-Buddy runtime', async () => {
    const appPath = createAppPath('ki-buddy');
    appPaths.push(appPath);
    const runtime = createKiBuddyRuntime({ appPath, resetPassword: false, webUi: false }).runtime!;
    const run = vi.fn().mockResolvedValue(undefined);

    runtime.createBackendMigrationScheduler({ isReady: () => true, onError: vi.fn(), run }).trigger('core-user-a');

    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
  });

  it('uses the Ki-Buddy data alias while preserving AionUi defaults', () => {
    const homePath = mkdtempSync(join(tmpdir(), 'ki-buddy-home-'));
    const dataPath = join(homePath, 'Application Support', 'Ki-Buddy');
    const kiBuddyAppPath = createAppPath('ki-buddy');
    const aionUiAppPath = createAppPath();
    appPaths.push(homePath, kiBuddyAppPath, aionUiAppPath);
    const platformServices = new NodePlatformServices();
    platformServices.paths = {
      ...platformServices.paths,
      getDataDir: () => dataPath,
      getHomeDir: () => homePath,
      isPackaged: () => true,
      needsCliSafeSymlinks: () => true,
    };
    registerPlatformServices(platformServices);

    configureKiBuddyCliSafeDirectories(kiBuddyAppPath);
    expect(getDataPath()).toBe(join(homePath, '.ki-buddy'));
    expect(getConfigPath()).toBe(join(homePath, '.ki-buddy-config'));

    configureKiBuddyCliSafeDirectories(aionUiAppPath);
    expect(getDataPath()).toBe(join(homePath, '.aionui'));
    expect(getConfigPath()).toBe(join(homePath, '.aionui-config'));
  });

  it('keeps a recognized Ki-Buddy runtime invalid without starting product side effects', () => {
    const appPath = createAppPath('ki-buddy');
    appPaths.push(appPath);

    const selection = createKiBuddyRuntime(
      { appPath, resetPassword: false, webUi: false },
      { config: null, error: 'Product experience features has invalid fields: missing team' }
    );

    expect(selection).toEqual({
      status: 'invalid',
      productIdentity: 'ki-buddy',
      runtime: null,
      error: expect.stringContaining('missing team'),
    });
    const bootstrap = createKiBuddyProductBootstrap(selection);
    expect(Object.isFrozen(bootstrap)).toBe(true);
    expect(bootstrap).toMatchObject({
      status: 'invalid',
      capability: null,
      error: expect.stringContaining('missing team'),
    });
    expect(shouldStartProductBusinessLifecycle(selection)).toBe(false);
    expect(resolveMainProductExperience(selection, true, { config: null, error: 'missing team' })).toBeNull();
    expect(installTransportMock).not.toHaveBeenCalled();
  });

  it.each([
    { mode: 'WebUI', resetPassword: false, webUi: true },
    { mode: 'password reset', resetPassword: true, webUi: false },
  ])('keeps invalid Ki-Buddy configuration isolated in $mode mode', ({ resetPassword, webUi }) => {
    const appPath = createAppPath('ki-buddy');
    appPaths.push(appPath);

    const selection = createKiBuddyRuntime(
      { appPath, resetPassword, webUi },
      { config: null, error: 'Product runtime identity is invalid' }
    );

    expect(selection.status).toBe('invalid');
    expect(createKiBuddyProductBootstrap(selection).status).toBe('invalid');
    expect(shouldStartProductBusinessLifecycle(selection)).toBe(false);
  });

  it('keeps the Ki-Buddy lifecycle policy in WebUI mode without starting product transport', () => {
    const appPath = createAppPath('ki-buddy');
    appPaths.push(appPath);

    const selection = createKiBuddyRuntime({ appPath, resetPassword: false, webUi: true });
    const experience = resolveMainProductExperience(selection, true);

    expect(selection.status).toBe('absent');
    expect(experience.featureState('webUi')).toBe('disabled');
    expect(experience.featureState('scheduledTasks')).toBe('enabled');
    expect(installTransportMock).not.toHaveBeenCalled();
  });

  it('starts the business lifecycle for valid Ki-Buddy and ordinary AionUi selections', () => {
    const kiBuddyAppPath = createAppPath('ki-buddy');
    const aionUiAppPath = createAppPath();
    appPaths.push(kiBuddyAppPath, aionUiAppPath);

    expect(
      shouldStartProductBusinessLifecycle(
        createKiBuddyRuntime({ appPath: kiBuddyAppPath, resetPassword: false, webUi: false })
      )
    ).toBe(true);
    expect(
      shouldStartProductBusinessLifecycle(
        createKiBuddyRuntime({ appPath: aionUiAppPath, resetPassword: false, webUi: false })
      )
    ).toBe(true);
  });

  it('creates the product-owned integrity window without initializing a business host', () => {
    const integrityWindow = {
      isDestroyed: vi.fn(() => false),
      loadFile: vi.fn(() => Promise.resolve()),
      loadURL: vi.fn(() => Promise.resolve()),
      once: vi.fn((_event: string, listener: () => void) => listener()),
      show: vi.fn(),
    };
    vi.mocked(BrowserWindow).mockImplementation(function BrowserWindowMock() {
      return integrityWindow as never;
    });

    const window = createKiBuddyProductIntegrityWindow({
      isPackaged: true,
      preloadPath: '/app/preload.js',
      rendererFile: '/app/renderer/index.html',
    });

    expect(window).toBe(integrityWindow);
    expect(BrowserWindow).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Ki-Buddy', webPreferences: { preload: '/app/preload.js' } })
    );
    expect(integrityWindow.loadFile).toHaveBeenCalledWith('/app/renderer/index.html');
    expect(integrityWindow.loadURL).not.toHaveBeenCalled();
    expect(integrityWindow.show).toHaveBeenCalledOnce();
  });

  it('retains existing Team main lifecycles for the AionUi adapter', () => {
    const startTeam = vi.fn();

    startProductFeatureLifecycles(createAionUiProductExperience(), [{ featureId: 'team', start: startTeam }]);

    expect(startTeam).toHaveBeenCalledOnce();
  });
});

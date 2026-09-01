/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SupportedLanguage } from '@/common/config/i18n';
import {
  KI_BUDDY_CORE_TRANSPORT_CHANNEL,
  KI_BUDDY_PRODUCT_CONFIG_RESULT,
  createAionUiProductExperience,
  createKiBuddyProductCapability,
  createKiBuddyProductExperience,
  deepFreeze,
  isProductFeatureEnabled,
  resolveLanguagePreference,
  type KiBuddyProductConfigLoadResult,
  type KiBuddyProductIntegration,
  type ProductExperience,
  type ProductFeatureId,
} from '@/common/platform/ki-buddy';
import type { KiBuddyProductBootstrap, KiBuddyProductCapability } from '@/common/types/platform/kiBuddyProduct';
import { createKiBuddyBackendMigrationScheduler, registerKiBuddyAuthBridge } from './authBridge';
import type { AgentsAuthService } from './AgentsAuthService';
import { createKiBuddyCoreAuthOptions, type KiBuddyCoreAuthOptions } from './bootstrap';
import { resolveKiBuddyCoreDataPath } from './coreDataPath';
import { KiBuddyMainCoreTransport } from './KiBuddyMainCoreTransport';
import { KI_BUDDY_PRODUCT_RUNTIME, readKiBuddyRuntimeIdentity, shouldEnableKiBuddyRuntime } from './runtimeIdentity';
import { createKiBuddyUpdateBridgeConfiguration, createKiBuddyUpdateFeedConfiguration } from './update/updateFeed';
import type { UpdateBridgeConfiguration } from '@process/bridge/updateBridge';
import type { UpdateFeedConfiguration } from '@process/services/updateFeed';
import { BrowserWindow } from 'electron';
import type { runBackendMigrations } from '@process/utils/runBackendMigrations';

export type KiBuddyRuntime = {
  brand: {
    iconPath: string;
    productName: string;
  };
  coreAuthOptions: KiBuddyCoreAuthOptions | null;
  coreTransportChannel: typeof KI_BUDDY_CORE_TRANSPORT_CHANNEL;
  createBackendMigrationScheduler: typeof createKiBuddyBackendMigrationScheduler;
  identityMode: 'agents' | 'local';
  integrations: readonly KiBuddyProductIntegration[];
  productIdentity: typeof KI_BUDDY_PRODUCT_RUNTIME;
  productCapability: KiBuddyProductCapability;
  productExperience: ProductExperience;
  registerAuthBridge:
    | ((getCoreBaseUrl: () => string, onSessionAuthenticated?: (coreUserId: string) => void) => AgentsAuthService)
    | null;
  resolveDataPath: (dataPath: string) => string;
  resolveLanguage: (savedLanguage: string | null | undefined, systemLanguage: string | null) => SupportedLanguage;
  updateBridge: UpdateBridgeConfiguration | null;
  updateFeed: UpdateFeedConfiguration | null;
};

export type KiBuddyRuntimeSelection =
  | Readonly<{ error: null; productIdentity: null; runtime: null; status: 'absent' }>
  | Readonly<{ error: string; productIdentity: typeof KI_BUDDY_PRODUCT_RUNTIME; runtime: null; status: 'invalid' }>
  | Readonly<{
      error: null;
      productIdentity: typeof KI_BUDDY_PRODUCT_RUNTIME;
      runtime: KiBuddyRuntime;
      status: 'ready';
    }>;

export type ProductFeatureLifecycle = {
  featureId: ProductFeatureId;
  start: () => void;
};

type MainProductLifecycleDefinition = Readonly<{
  featureId: ProductFeatureId;
}>;

type StartAgentsMcpRuntimeBridge = (
  authService: AgentsAuthService
) => Promise<Readonly<{ close: () => Promise<void> }>>;

/** Stable identities for every product-controlled lifecycle owned by the Electron main process. */
export const MAIN_PRODUCT_LIFECYCLE_REGISTRY = {
  accountCoreTransport: { featureId: 'account' },
  agentsMcp: { featureId: 'tools' },
  channelsMigration: { featureId: 'channels' },
  desktopPet: { featureId: 'desktopPet' },
  scheduledTasks: { featureId: 'scheduledTasks' },
  webUi: { featureId: 'webUi' },
} as const satisfies Readonly<Record<string, MainProductLifecycleDefinition>>;

export type MainProductLifecycleId = keyof typeof MAIN_PRODUCT_LIFECYCLE_REGISTRY;

/** Reads a main lifecycle decision through the stable registry instead of feature literals at call sites. */
export function isMainProductLifecycleEnabled(
  productExperience: ProductExperience,
  lifecycleId: MainProductLifecycleId
): boolean {
  return productExperience.featureState(MAIN_PRODUCT_LIFECYCLE_REGISTRY[lifecycleId].featureId) === 'enabled';
}

/** Evaluates one trusted project integration through the runtime integration policy. */
export function isKiBuddyProductIntegrationEnabled(
  integrations: readonly KiBuddyProductIntegration[],
  integration: KiBuddyProductIntegration
): boolean {
  return integrations.includes(integration);
}

export type KiBuddyProductIntegrityWindowOptions = {
  isPackaged: boolean;
  preloadPath: string;
  rendererFile: string;
  rendererUrl?: string;
};

/** Builds the single serializable product bootstrap snapshot forwarded through preload. */
export function createKiBuddyProductBootstrap(selection: KiBuddyRuntimeSelection): KiBuddyProductBootstrap {
  if (selection.status === 'ready') {
    return deepFreeze({
      status: 'ready',
      productIdentity: selection.productIdentity,
      identityMode: selection.runtime.identityMode,
      capability: selection.runtime.productCapability,
      error: null,
    });
  }
  if (selection.status === 'invalid') {
    return deepFreeze({
      status: 'invalid',
      productIdentity: selection.productIdentity,
      capability: null,
      error: selection.error,
    });
  }
  return deepFreeze({ status: 'absent', productIdentity: null, capability: null, error: null });
}

/** Keeps product-integrity startup isolated from every business lifecycle. */
export function shouldStartProductBusinessLifecycle(selection: KiBuddyRuntimeSelection): boolean {
  return selection.status !== 'invalid';
}

/** Creates the isolated Ki-Buddy window used only for packaged product integrity failures. */
export function createKiBuddyProductIntegrityWindow(options: KiBuddyProductIntegrityWindowOptions): BrowserWindow {
  const window = new BrowserWindow({
    width: 900,
    height: 640,
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: 'Ki-Buddy',
    webPreferences: {
      preload: options.preloadPath,
    },
  });

  window.once('ready-to-show', () => {
    if (!window.isDestroyed()) window.show();
  });

  if (!options.isPackaged && options.rendererUrl) {
    window.loadURL(options.rendererUrl).catch((error) => {
      console.error('[Ki-Buddy] Failed to load product integrity UI:', error);
    });
  } else {
    window.loadFile(options.rendererFile).catch((error) => {
      console.error('[Ki-Buddy] Failed to load product integrity UI:', error);
    });
  }

  return window;
}

/** Starts only lifecycle entries enabled by the selected product adapter. */
export function startProductFeatureLifecycles(
  productExperience: ProductExperience,
  lifecycles: readonly ProductFeatureLifecycle[]
): void {
  for (const lifecycle of lifecycles) {
    if (productExperience.featureState(lifecycle.featureId) === 'enabled') lifecycle.start();
  }
}

type BackendReadyLifecycleStarters = Readonly<{
  scheduledTasks: () => void;
}>;

type DesktopReadyLifecycleStarters = Readonly<{
  desktopPet: () => void;
  webUi: () => void;
}>;

export function startMainProductLifecyclePhase(
  productExperience: ProductExperience,
  phase: 'backendReady',
  starters: BackendReadyLifecycleStarters
): void;
export function startMainProductLifecyclePhase(
  productExperience: ProductExperience,
  phase: 'desktopReady',
  starters: DesktopReadyLifecycleStarters
): void;
/** Runs the production main-process lifecycle plan for one startup phase. */
export function startMainProductLifecyclePhase(
  productExperience: ProductExperience,
  phase: 'backendReady' | 'desktopReady',
  starters: BackendReadyLifecycleStarters | DesktopReadyLifecycleStarters
): void {
  if (phase === 'backendReady') {
    const { scheduledTasks } = starters as BackendReadyLifecycleStarters;
    startProductFeatureLifecycles(productExperience, [
      { featureId: MAIN_PRODUCT_LIFECYCLE_REGISTRY.scheduledTasks.featureId, start: scheduledTasks },
    ]);
    return;
  }
  const { desktopPet, webUi } = starters as DesktopReadyLifecycleStarters;
  startProductFeatureLifecycles(productExperience, [
    { featureId: MAIN_PRODUCT_LIFECYCLE_REGISTRY.desktopPet.featureId, start: desktopPet },
    { featureId: MAIN_PRODUCT_LIFECYCLE_REGISTRY.webUi.featureId, start: webUi },
  ]);
}

/** Resolves the main-process adapter without activating product runtime side effects. */
export function resolveMainProductExperience(
  selection: KiBuddyRuntimeSelection,
  productIdentity: boolean,
  productConfigResult: KiBuddyProductConfigLoadResult = KI_BUDDY_PRODUCT_CONFIG_RESULT
): ProductExperience | null {
  if (selection.runtime) return selection.runtime.productExperience;
  if (selection.status === 'invalid') return null;
  if (productIdentity && productConfigResult.config) {
    return createKiBuddyProductExperience(productConfigResult.config.experience);
  }
  return createAionUiProductExperience();
}

/** Runs generic migrations, then product-owned migrations whose lifecycle is enabled. */
export async function runProductBackendMigrations(
  configFile: Parameters<typeof runBackendMigrations>[0],
  productExperience: ProductExperience,
  productIdentity: typeof KI_BUDDY_PRODUCT_RUNTIME | null = null,
  integrations: readonly KiBuddyProductIntegration[] = ['agentsGateway']
): Promise<void> {
  const { runBackendMigrations } = await import('@process/utils/runBackendMigrations');
  await runBackendMigrations(configFile);
  if (
    productIdentity === KI_BUDDY_PRODUCT_RUNTIME &&
    isKiBuddyProductIntegrationEnabled(integrations, 'agentsGateway') &&
    isMainProductLifecycleEnabled(productExperience, 'agentsMcp')
  ) {
    const { ensureAgentsMcpRegistration } = await import('./agents/registration');
    await ensureAgentsMcpRegistration();
  }
  if (isMainProductLifecycleEnabled(productExperience, 'channelsMigration')) {
    const { migrateLegacyChannelSettings } = await import('@/common/config/configMigration');
    await migrateLegacyChannelSettings(configFile);
  }
}

/** Starts the product-owned Agents MCP bridge only when its capability is enabled. */
export async function startAgentsMcpProductLifecycle(
  productExperience: ProductExperience,
  authService: AgentsAuthService,
  onWillQuit: (listener: () => Promise<void>) => void,
  startRuntimeBridge: StartAgentsMcpRuntimeBridge = async (service) => {
    const { startAgentsMcpRuntimeBridge } = await import('./agents');
    return startAgentsMcpRuntimeBridge(service);
  },
  integrations: readonly KiBuddyProductIntegration[] = ['agentsGateway']
): Promise<boolean> {
  if (
    !isKiBuddyProductIntegrationEnabled(integrations, 'agentsGateway') ||
    !isMainProductLifecycleEnabled(productExperience, 'agentsMcp')
  ) {
    return false;
  }
  const bridge = await startRuntimeBridge(authService);
  onWillQuit(() => bridge.close());
  return true;
}

/** Creates and installs the main-process Ki-Buddy runtime when explicit product metadata selects it. */
export function createKiBuddyRuntime(
  options: {
    appPath: string;
    resetPassword: boolean;
    webUi: boolean;
  },
  productConfigResult: KiBuddyProductConfigLoadResult = KI_BUDDY_PRODUCT_CONFIG_RESULT
): KiBuddyRuntimeSelection {
  const productIdentity = readKiBuddyRuntimeIdentity(options.appPath);
  if (!productIdentity) return { status: 'absent', productIdentity: null, runtime: null, error: null };
  if (!productConfigResult.config) {
    return {
      status: 'invalid',
      productIdentity: KI_BUDDY_PRODUCT_RUNTIME,
      runtime: null,
      error: `Ki-Buddy product configuration is invalid: ${productConfigResult.error}`,
    };
  }

  const enabled = shouldEnableKiBuddyRuntime({
    productIdentity,
    resetPassword: options.resetPassword,
    webUi: options.webUi,
  });
  if (!enabled) return { status: 'absent', productIdentity: null, runtime: null, error: null };

  const config = productConfigResult.config;
  const identityMode = config.distribution?.identityMode ?? 'agents';
  const integrations = config.distribution?.integrations ?? ['agentsGateway'];
  const productExperience = createKiBuddyProductExperience(config.experience);
  const updatesEnabled = isProductFeatureEnabled(productExperience, 'githubResources');
  const coreAuthOptions = identityMode === 'agents' ? createKiBuddyCoreAuthOptions() : null;
  const coreTransport = coreAuthOptions ? new KiBuddyMainCoreTransport(coreAuthOptions.coreCsrfToken) : null;
  startProductFeatureLifecycles(productExperience, [
    {
      featureId: MAIN_PRODUCT_LIFECYCLE_REGISTRY.accountCoreTransport.featureId,
      start: () => {
        if (!coreTransport) throw new Error('Agents account transport requires Agents identity mode');
        coreTransport.install();
      },
    },
  ]);

  const runtime: KiBuddyRuntime = {
    brand: {
      iconPath: config.assets.packaged.icon,
      productName: config.brand.productName,
    },
    coreAuthOptions,
    coreTransportChannel: KI_BUDDY_CORE_TRANSPORT_CHANNEL,
    createBackendMigrationScheduler: createKiBuddyBackendMigrationScheduler,
    identityMode,
    integrations,
    productIdentity: KI_BUDDY_PRODUCT_RUNTIME,
    productCapability: createKiBuddyProductCapability(config),
    productExperience,
    registerAuthBridge:
      coreAuthOptions && coreTransport
        ? (getCoreBaseUrl, onSessionAuthenticated) =>
            registerKiBuddyAuthBridge({
              bootstrapSecret: coreAuthOptions.bootstrapSecret,
              coreTransport,
              credentialStorageNamespace: config.distribution?.credentialNamespace,
              getCoreBaseUrl,
              onSessionAuthenticated,
            })
        : null,
    resolveDataPath: resolveKiBuddyCoreDataPath,
    resolveLanguage: (savedLanguage, systemLanguage) =>
      resolveLanguagePreference({
        savedLanguage,
        productLanguage: config.defaults.language,
        systemLanguage,
      }),
    updateBridge: updatesEnabled ? createKiBuddyUpdateBridgeConfiguration(config) : null,
    updateFeed: updatesEnabled ? createKiBuddyUpdateFeedConfiguration(config) : null,
  };
  return { status: 'ready', productIdentity: KI_BUDDY_PRODUCT_RUNTIME, runtime, error: null };
}

export {
  readKiBuddyRuntimeIdentity,
  resolveKiBuddyProtocolScheme,
  shouldEnsureDefaultCoreUser,
} from './runtimeIdentity';
export { resolveKiBuddyCoreDataPath } from './coreDataPath';

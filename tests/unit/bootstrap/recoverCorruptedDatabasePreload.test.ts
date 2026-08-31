import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KI_BUDDY_PRODUCT_BOOTSTRAP_CHANNEL, KI_BUDDY_PRODUCT_CAPABILITY } from '@/common/platform/ki-buddy';
import type { KiBuddyProductBootstrap } from '@/common/types/platform/kiBuddyProduct';

vi.mock('@sentry/electron/preload', () => ({}));

const invoke = vi.fn();
const send = vi.fn();
const on = vi.fn();
const off = vi.fn();
let productCsrfToken: string | null = null;
let productBootstrap: KiBuddyProductBootstrap = {
  status: 'absent',
  productIdentity: null,
  capability: null,
  error: null,
};
const sendSync = vi.fn((channel: string) => {
  if (channel === KI_BUDDY_PRODUCT_BOOTSTRAP_CHANNEL) return productBootstrap;
  if (channel === 'ki-buddy:core-transport:get-csrf-token') return productCsrfToken;
  if (channel === 'get-backend-port') return 25808;
  if (channel === 'get-initial-language') return null;
  if (channel === 'get-backend-startup-failed') return false;
  if (channel === 'get-backend-startup-failure') return null;
  return null;
});
const exposeInMainWorld = vi.fn();

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld,
  },
  ipcRenderer: {
    invoke,
    off,
    on,
    send,
    sendSync,
  },
  webUtils: {
    getPathForFile: vi.fn(),
  },
}));

describe('recover corrupted database preload bridge', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    invoke.mockResolvedValue(undefined);
    productCsrfToken = null;
    productBootstrap = { status: 'absent', productIdentity: null, capability: null, error: null };
  });

  it('exposes a recovery method that invokes the main-process IPC channel', async () => {
    await import('@/preload/main');

    const electronApiCall = exposeInMainWorld.mock.calls.find(([key]) => key === 'electronAPI');
    const electronApi = electronApiCall?.[1] as { recoverCorruptedDatabase?: () => Promise<void> } | undefined;

    await electronApi?.recoverCorruptedDatabase?.();

    expect(invoke).toHaveBeenCalledWith('backend:recover-corrupted-database');
  });

  it('exposes Ki-Buddy authentication only through the dedicated IPC channels', async () => {
    productCsrfToken = 'core-csrf-token';
    productBootstrap = {
      status: 'ready',
      productIdentity: 'ki-buddy',
      identityMode: 'agents',
      capability: KI_BUDDY_PRODUCT_CAPABILITY!,
      error: null,
    };
    await import('@/preload/main');

    const electronApiCall = exposeInMainWorld.mock.calls.find(([key]) => key === 'electronAPI');
    const electronApi = electronApiCall?.[1] as
      | {
          kiBuddyAuth?: {
            getSession: () => Promise<unknown>;
            login: (request: { baseUrl: string; loginName: string; password: string }) => Promise<unknown>;
            logout: () => Promise<unknown>;
            onSessionInvalidated: (listener: () => void) => () => void;
          };
          kiBuddyCoreTransport?: { csrfToken: string };
        }
      | undefined;
    const request = {
      baseUrl: 'https://agents.example.com',
      loginName: 'agents-user@example.com',
      password: 'password',
    };

    await electronApi?.kiBuddyAuth?.getSession();
    await electronApi?.kiBuddyAuth?.login(request);
    await electronApi?.kiBuddyAuth?.logout();
    const invalidated = vi.fn();
    const unsubscribe = electronApi?.kiBuddyAuth?.onSessionInvalidated(invalidated);
    const subscription = on.mock.calls.find(([channel]) => channel === 'ki-buddy-auth:session-invalidated');
    subscription?.[1]();
    unsubscribe?.();

    expect(invoke).toHaveBeenCalledWith('ki-buddy-auth:get-session');
    expect(invoke).toHaveBeenCalledWith('ki-buddy-auth:login', request);
    expect(invoke).toHaveBeenCalledWith('ki-buddy-auth:logout');
    expect(invalidated).toHaveBeenCalledOnce();
    expect(off).toHaveBeenCalledWith('ki-buddy-auth:session-invalidated', subscription?.[1]);
    expect(electronApi?.kiBuddyCoreTransport).toEqual({ csrfToken: 'core-csrf-token' });
    const productBootstrapCall = exposeInMainWorld.mock.calls.find(([key]) => key === '__getKiBuddyProductBootstrap');
    expect(productBootstrapCall?.[1]()).toMatchObject({
      status: 'ready',
      productIdentity: 'ki-buddy',
      capability: {
        id: 'ki-buddy',
        schemaVersion: 4,
        experience: { features: { team: 'disabled', scheduledTasks: 'enabled' } },
      },
    });
  });

  it('does not request Agents authentication transport for a local Ki-Buddy identity', async () => {
    productBootstrap = {
      status: 'ready',
      productIdentity: 'ki-buddy',
      identityMode: 'local',
      capability: KI_BUDDY_PRODUCT_CAPABILITY!,
      error: null,
    };

    await import('@/preload/main');

    const electronApiCall = exposeInMainWorld.mock.calls.find(([key]) => key === 'electronAPI');
    const electronApi = electronApiCall?.[1] as { kiBuddyAuth?: unknown; kiBuddyCoreTransport?: unknown } | undefined;

    expect(sendSync).not.toHaveBeenCalledWith('ki-buddy:core-transport:get-csrf-token');
    expect(electronApi?.kiBuddyAuth).toBeUndefined();
    expect(electronApi?.kiBuddyCoreTransport).toBeUndefined();
  });

  it('exposes a recognized Ki-Buddy configuration failure without auth or AionUi capability fallback', async () => {
    productBootstrap = {
      status: 'invalid',
      productIdentity: 'ki-buddy',
      capability: null,
      error: 'Ki-Buddy product configuration is invalid: missing team',
    };
    await import('@/preload/main');

    const electronApiCall = exposeInMainWorld.mock.calls.find(([key]) => key === 'electronAPI');
    const electronApi = electronApiCall?.[1] as { kiBuddyAuth?: unknown } | undefined;
    const productBootstrapCall = exposeInMainWorld.mock.calls.find(([key]) => key === '__getKiBuddyProductBootstrap');

    expect(electronApi?.kiBuddyAuth).toBeUndefined();
    expect(productBootstrapCall?.[1]()).toMatchObject({
      status: 'invalid',
      error: expect.stringContaining('missing team'),
    });
    expect(sendSync).not.toHaveBeenCalledWith('ki-buddy:core-transport:get-csrf-token');
    expect(sendSync).not.toHaveBeenCalledWith('get-backend-port');
    expect(sendSync).not.toHaveBeenCalledWith('get-initial-language');
    expect(sendSync).not.toHaveBeenCalledWith('get-backend-startup-failed');
    expect(sendSync).not.toHaveBeenCalledWith('get-backend-startup-failure');
  });

  it('does not expose Ki-Buddy authentication in the ordinary AionUi desktop runtime', async () => {
    await import('@/preload/main');

    const electronApiCall = exposeInMainWorld.mock.calls.find(([key]) => key === 'electronAPI');
    const electronApi = electronApiCall?.[1] as { kiBuddyAuth?: unknown; kiBuddyCoreTransport?: unknown } | undefined;

    expect(electronApi?.kiBuddyAuth).toBeUndefined();
    expect(electronApi?.kiBuddyCoreTransport).toBeUndefined();
    const productBootstrapCall = exposeInMainWorld.mock.calls.find(([key]) => key === '__getKiBuddyProductBootstrap');
    expect(productBootstrapCall?.[1]()).toEqual({
      status: 'absent',
      productIdentity: null,
      capability: null,
      error: null,
    });
    expect(sendSync).not.toHaveBeenCalledWith('ki-buddy:core-transport:get-csrf-token');
  });
});

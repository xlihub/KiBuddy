/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const electronMock = vi.hoisted(() => ({
  agentsFetch: vi.fn(),
  fromPartition: vi.fn(),
  handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
  sendToRenderer: vi.fn(),
  removeCookie: vi.fn(),
  setCertificateVerifyProc: vi.fn(),
  setCookie: vi.fn(),
}));

const credentialStoreMock = vi.hoisted(() => ({
  clear: vi.fn(),
  load: vi.fn(),
  save: vi.fn(),
  constructorArgs: vi.fn(),
}));

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/ki-buddy-auth-test') },
  BrowserWindow: {
    getAllWindows: vi.fn(() => [{ isDestroyed: () => false, webContents: { send: electronMock.sendToRenderer } }]),
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
      electronMock.handlers.set(channel, handler);
    }),
  },
  session: {
    fromPartition: electronMock.fromPartition,
    defaultSession: {
      cookies: {
        remove: electronMock.removeCookie,
        set: electronMock.setCookie,
      },
    },
  },
}));

vi.mock('@/process/ki-buddy/CredentialStore', () => ({
  KeytarCredentialStore: class {
    constructor(userDataPath: string, options: unknown) {
      credentialStoreMock.constructorArgs(userDataPath, options);
    }
    clear = credentialStoreMock.clear;
    load = credentialStoreMock.load;
    save = credentialStoreMock.save;
  },
}));

import { createKiBuddyBackendMigrationScheduler, registerKiBuddyAuthBridge } from '@/process/ki-buddy/authBridge';
import { KiBuddyMainCoreTransport } from '@/process/ki-buddy/KiBuddyMainCoreTransport';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function registerBridgeWithSuccessfulLogin(onSessionAuthenticated?: () => void) {
  const coreTransport = new KiBuddyMainCoreTransport('core-csrf-token');
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          errorCode: 0,
          responseBody: {
            uuid: 'agents-user-42',
            userName: 'agents-user@example.com',
            token: 'agents-token',
          },
        }),
        { status: 200 }
      )
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            user_id: 'core-user-42',
            user_type: 'aionpro',
            external_user_id: 'projected-user',
            session_generation: 0,
          },
        }),
        { status: 200 }
      )
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            user: { id: 'core-user-42', username: 'agents-user@example.com' },
            session_generation: 0,
          },
        }),
        { status: 200, headers: { 'set-cookie': 'aionui-session=core-token; HttpOnly; Max-Age=3600' } }
      )
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, data: { user_id: 'core-user-42', session_generation: 1 } }), {
        status: 200,
      })
    );
  electronMock.agentsFetch.mockImplementation(fetchMock);
  vi.stubGlobal('fetch', fetchMock);
  const authService = registerKiBuddyAuthBridge({
    bootstrapSecret: 'bootstrap-secret',
    coreTransport,
    getCoreBaseUrl: () => 'http://127.0.0.1:39123',
    onSessionAuthenticated,
  });
  return { authService, coreTransport, fetchMock };
}

describe('Ki-Buddy authentication IPC bridge', () => {
  beforeEach(() => {
    electronMock.handlers.clear();
    electronMock.agentsFetch.mockReset();
    electronMock.fromPartition.mockReset();
    electronMock.setCertificateVerifyProc.mockReset();
    electronMock.fromPartition.mockReturnValue({
      fetch: electronMock.agentsFetch,
      setCertificateVerifyProc: electronMock.setCertificateVerifyProc,
    });
    electronMock.removeCookie.mockReset();
    electronMock.setCookie.mockReset();
    electronMock.removeCookie.mockResolvedValue(undefined);
    electronMock.setCookie.mockResolvedValue(undefined);
    electronMock.sendToRenderer.mockReset();
    credentialStoreMock.clear.mockReset();
    credentialStoreMock.load.mockReset();
    credentialStoreMock.save.mockReset();
    credentialStoreMock.constructorArgs.mockReset();
  });

  it('passes the registered project credential namespace to the credential store', () => {
    const coreTransport = new KiBuddyMainCoreTransport('core-csrf-token');

    registerKiBuddyAuthBridge({
      bootstrapSecret: 'bootstrap-secret',
      coreTransport,
      credentialStorageNamespace: 'ki-buddy-zxjt',
      getCoreBaseUrl: () => 'http://127.0.0.1:39123',
    });

    expect(credentialStoreMock.constructorArgs).toHaveBeenCalledWith('/tmp/ki-buddy-auth-test', {
      storageNamespace: 'ki-buddy-zxjt',
    });
  });

  it('installs projected Core cookies while keeping tokens in main', async () => {
    const { coreTransport } = registerBridgeWithSuccessfulLogin();
    const loginHandler = electronMock.handlers.get('ki-buddy-auth:login');

    await loginHandler?.(null, {
      baseUrl: 'https://agents.example.com',
      loginName: 'agents-user@example.com',
      password: 'password',
    });

    expect(electronMock.setCookie).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'aionui-session',
        value: 'core-token',
        httpOnly: true,
        sameSite: 'no_restriction',
        secure: true,
      })
    );
    expect(coreTransport.getHeaders({ method: 'POST' })).toMatchObject({
      Authorization: 'Bearer core-token',
      'x-csrf-token': 'core-csrf-token',
    });
  });

  it('routes Agents login through the isolated network session without automatic redirects', async () => {
    registerBridgeWithSuccessfulLogin();
    const loginHandler = electronMock.handlers.get('ki-buddy-auth:login');

    await loginHandler?.(null, {
      baseUrl: 'https://agents.example.com',
      loginName: 'agents-user@example.com',
      password: 'password',
    });

    expect(electronMock.fromPartition).toHaveBeenCalledWith('ki-buddy-agents-network-catalog', { cache: false });
    expect(electronMock.agentsFetch).toHaveBeenCalledWith(
      'https://agents.example.com/kagent/login',
      expect.objectContaining({ method: 'POST', redirect: 'manual' })
    );
  });

  it('notifies the product lifecycle after the projected Core session becomes active', async () => {
    const onSessionAuthenticated = vi.fn();
    registerBridgeWithSuccessfulLogin(onSessionAuthenticated);
    const loginHandler = electronMock.handlers.get('ki-buddy-auth:login');

    await loginHandler?.(null, {
      baseUrl: 'https://agents.example.com',
      loginName: 'agents-user@example.com',
      password: 'password',
    });

    expect(onSessionAuthenticated).toHaveBeenCalledWith('core-user-42');
  });

  it('clears projected Core state on logout', async () => {
    const { coreTransport } = registerBridgeWithSuccessfulLogin();
    const loginHandler = electronMock.handlers.get('ki-buddy-auth:login');
    const logoutHandler = electronMock.handlers.get('ki-buddy-auth:logout');
    await loginHandler?.(null, {
      baseUrl: 'https://agents.example.com',
      loginName: 'agents-user@example.com',
      password: 'password',
    });

    await logoutHandler?.(null);

    expect(credentialStoreMock.clear).toHaveBeenCalledOnce();
    expect(coreTransport.getHeaders({ method: 'GET' })).not.toHaveProperty('Authorization');
  });

  it('notifies the renderer after a trusted Agents authentication failure ends the active session', async () => {
    const service = registerBridgeWithSuccessfulLogin();
    const loginHandler = electronMock.handlers.get('ki-buddy-auth:login');
    await loginHandler?.(null, {
      baseUrl: 'https://agents.example.com',
      loginName: 'agents-user@example.com',
      password: 'password',
    });
    service.fetchMock.mockReset();
    service.fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 })).mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, data: { user_id: 'core-user-42', session_generation: 1 } }), {
        status: 200,
      })
    );

    await service.authService.fetchAuthenticated('/kagent/bridge/catalog');

    expect(electronMock.sendToRenderer).toHaveBeenCalledWith('ki-buddy-auth:session-invalidated');
  });

  it('rejects malformed login IPC requests before making a network request', async () => {
    registerBridgeWithSuccessfulLogin();
    const loginHandler = electronMock.handlers.get('ki-buddy-auth:login');

    await expect(loginHandler?.(null, { baseUrl: 'https://agents.example.com' })).resolves.toEqual({
      success: false,
      code: 'contractError',
    });
    expect(electronMock.agentsFetch).not.toHaveBeenCalled();
  });
});

describe('Ki-Buddy account-aware backend migrations', () => {
  it('reports a failed migration and retries the same account', async () => {
    const error = new Error('migration failed');
    const onError = vi.fn();
    const run = vi.fn().mockRejectedValueOnce(error).mockResolvedValue(undefined);
    const scheduler = createKiBuddyBackendMigrationScheduler({ isReady: () => true, onError, run });

    scheduler.trigger('core-user-a');
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(error));

    scheduler.trigger('core-user-a');
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    scheduler.trigger('core-user-a');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('runs migrations once for each authenticated Core user', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const scheduler = createKiBuddyBackendMigrationScheduler({ isReady: () => true, onError: vi.fn(), run });

    scheduler.trigger('core-user-a');
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    scheduler.trigger('core-user-a');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(run).toHaveBeenCalledOnce();

    scheduler.trigger('core-user-b');
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
  });

  it('keeps a superseded account retryable after a different account finishes', async () => {
    const firstRun = deferred();
    const run = vi.fn().mockReturnValueOnce(firstRun.promise).mockResolvedValue(undefined);
    const scheduler = createKiBuddyBackendMigrationScheduler({ isReady: () => true, onError: vi.fn(), run });

    scheduler.trigger('core-user-a');
    scheduler.trigger('core-user-b');
    firstRun.resolve();

    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    scheduler.trigger('core-user-a');
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(3));
  });

  it('runs only the latest authenticated account after a migration is superseded', async () => {
    const firstRun = deferred();
    const run = vi.fn().mockReturnValueOnce(firstRun.promise).mockResolvedValue(undefined);
    const scheduler = createKiBuddyBackendMigrationScheduler({ isReady: () => true, onError: vi.fn(), run });

    scheduler.trigger('core-user-a');
    scheduler.trigger('core-user-b');
    scheduler.trigger('core-user-c');
    firstRun.resolve();

    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    scheduler.trigger('core-user-c');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(run).toHaveBeenCalledTimes(2);
  });
});

import React from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SWRConfig } from 'swr';
import AddPlatformModal from '@/renderer/pages/settings/components/AddPlatformModal';
import EditModeModal from '@/renderer/pages/settings/components/EditModeModal';
import { persistKiBuddyProvider } from '@/renderer/pages/ki-buddy/ModelSettings';
import {
  kiBuddyProviderAdapter,
  type KiBuddyProvider,
} from '@/renderer/pages/ki-buddy/ModelSettings/kiBuddyProviderAdapter';
import {
  initializeKiBuddyModelPreset,
  presetProviderId,
  restoreKiBuddyModelPreset,
} from '@/renderer/pages/ki-buddy/ModelSettings/kiBuddyModelPreset';
import { createCoreHarness, until } from './coreHarness';
const boundary = vi.hoisted(() => ({ fetch: vi.fn(), detect: vi.fn() }));
vi.mock('@/renderer/services/runtime/kiBuddyRuntime', () => ({ getKiBuddyProductRuntime: () => ({ id: 'ki-buddy' }) }));
vi.mock('@/common', async () => {
  const { httpPost, httpPut } = await import('@/common/adapter/httpBridge');
  return {
    ipcBridge: {
      mode: {
        createProvider: httpPost('/api/providers'),
        updateProvider: httpPut(
          (p: { id: string }) => `/api/providers/${p.id}`,
          (p: { id: string }) => {
            const { id: _id, ...rest } = p;
            return rest;
          }
        ),
        fetchModelList: { invoke: boundary.fetch },
        detectProtocol: { invoke: boundary.detect },
      },
    },
  };
});
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/renderer/components/agent/ThemedLogo', () => ({ ProviderLogo: () => null }));
vi.mock('@/renderer/components/base/AionModal', () => ({
  default: ({ children, onOk, okText }: { children: React.ReactNode; onOk(): void; okText: string }) => (
    <div role='dialog'>
      {children}
      <button onClick={onOk}>{okText}</button>
    </div>
  ),
}));
const binary = process.env.KI_BUDDY_CORE_BINARY;
let harness: Awaited<ReturnType<typeof createCoreHarness>>;
const wrap = (children: React.ReactNode) => (
  <SWRConfig value={{ provider: () => new Map(), errorRetryCount: 0 }}>{children}</SWRConfig>
);
const health = (id: string, model: string) =>
  harness.call<{ status: string; error_kind?: string; timeout_stage?: string }>(
    'POST',
    '/api/agents/provider-health-check',
    { provider_id: id, model }
  );

describe.skipIf(!binary)('real Core branch desktop integration (opt-in offline)', () => {
  beforeAll(async () => {
    harness = await createCoreHarness(binary!);
    window.__backendPort = harness.port;
    window.matchMedia = vi.fn().mockReturnValue({ matches: false, addListener: vi.fn(), removeListener: vi.fn() });
    console.info('Core integration artifacts:', harness.root);
  }, 90000);
  afterAll(async () => {
    await harness?.stopAll();
    delete window.__backendPort;
  }, 30000);
  afterEach(cleanup);
  let stored: KiBuddyProvider;
  let id: string;
  let user: ReturnType<typeof userEvent.setup>;
  let initialRequestCount: number;
  beforeEach(async () => {
    user = userEvent.setup();
    initialRequestCount = (await harness.records()).length;
    const saved: KiBuddyProvider[] = [];
    const submit = vi.fn(async (provider: KiBuddyProvider) => {
      await persistKiBuddyProvider(provider, false);
      saved.push(provider);
    });
    render(wrap(<AddPlatformModal modalProps={{ visible: true }} modalCtrl={{ close: vi.fn() }} onSubmit={submit} />));
    await user.click(screen.getByTestId('model-provider-platform'));
    fireEvent.click(await screen.findByText('settings.platformCustom'));
    await user.click(screen.getByLabelText('settings.kiBuddyModel.manual'));
    fireEvent.change(screen.getByLabelText('settings.kiBuddyModel.chatEndpoint'), {
      target: { value: harness.mock.url },
    });
    fireEvent.change(screen.getByLabelText('settings.kiBuddyModel.requestModelId'), {
      target: { value: harness.mock.model },
    });
    await user.click(screen.getByText('settings.kiBuddyModel.defaultBearer'));
    const noBearer = await screen.findByText('settings.kiBuddyModel.noBearer');
    await waitFor(() => expect(getComputedStyle(noBearer).pointerEvents).not.toBe('none'));
    await user.click(noBearer);
    await user.click(screen.getByText('settings.kiBuddyModel.advanced'));
    for (const [name, value] of [
      ['appId', 'mock-app-id'],
      ['secretKey', 'mock-secret-key'],
      ['apikey', 'mock-api-key'],
    ]) {
      await user.click(screen.getByText('settings.kiBuddyModel.addHeader'));
      const names = screen.getAllByLabelText('settings.kiBuddyModel.headerName');
      const values = screen.getAllByLabelText('settings.kiBuddyModel.headerValue');
      fireEvent.change(names.at(-1)!, { target: { value: name } });
      fireEvent.change(values.at(-1)!, { target: { value } });
    }
    await user.click(screen.getByLabelText('settings.kiBuddyModel.proxy'));
    fireEvent.click(screen.getByText('settings.kiBuddyModel.direct'));
    await user.click(screen.getByLabelText('settings.kiBuddyModel.streamOptions'));
    fireEvent.click(screen.getByText('settings.kiBuddyModel.disabled'));
    await user.click(screen.getByText('common.confirm'));
    await waitFor(() => expect(saved).toHaveLength(1));
    id = saved[0].id;
    stored = (await harness.call<KiBuddyProvider[]>('GET', '/api/providers')).find((provider) => provider.id === id)!;
  }, 30000);
  it('saves the exact manual URL and model with opaque credentials without discovery', async () => {
    expect(stored).toMatchObject({
      base_url: harness.mock.url,
      models: [harness.mock.model],
      model_mode: 'manual',
      gateway: { auth: 'none', proxy: 'direct', include_stream_options: false },
    });
    expect(JSON.stringify(stored)).not.toContain('mock-secret-key');
    expect(await harness.records()).toHaveLength(initialRequestCount);
    expect(boundary.fetch).not.toHaveBeenCalled();
    expect(boundary.detect).not.toHaveBeenCalled();
  });
  it('uses header-only authentication and omits stream_options during real health checks', async () => {
    expect((await health(id, harness.mock.model)).status).toBe('healthy');
    expect((await harness.records()).at(-1)).toMatchObject({
      bearerPresent: false,
      optionPresence: { stream_options: false },
    });
  });
  it('completes a real chat and Read tool roundtrip through the desktop-saved provider', async () => {
    const conversation = await harness.call<{ id: string }>('POST', '/api/conversations', {
      type: 'aionrs',
      name: 'Desktop offline verification',
      model: { provider_id: id, model: harness.mock.model },
      extra: { workspace: harness.workspace, session_mode: 'yolo', max_turns: 4 },
    });
    await harness.call('POST', `/api/conversations/${conversation.id}/messages`, {
      content: 'Hello from the desktop form.',
    });
    await until(async () =>
      JSON.stringify(await harness.call('GET', `/api/conversations/${conversation.id}/messages?limit=100`)).includes(
        '[ZXJT MOCK]'
      ) && (await harness.records()).at(-1)?.completed
        ? true
        : undefined
    );
    await until(async () => {
      await harness.call('POST', `/api/conversations/${conversation.id}/messages`, {
        content: `ZXJT_MOCK_TOOL ${JSON.stringify({ name: 'Read', arguments: { file_path: `${harness.workspace}/proof.txt` } })}`,
      });
      return true;
    });
    await until(async () =>
      JSON.stringify(await harness.call('GET', `/api/conversations/${conversation.id}/messages?limit=100`)).includes(
        harness.marker
      ) &&
      (await harness.records()).at(-1)?.responseKind === 'tool-reply' &&
      (await harness.records()).at(-1)?.completed
        ? true
        : undefined
    );
    expect((await harness.records()).slice(initialRequestCount).map((record) => record.responseKind)).toContain(
      'tool-reply'
    );
  }, 30000);
  it('preserves opaque credentials through Core restart and a desktop rename', async () => {
    await harness.restart();
    stored = (await harness.call<KiBuddyProvider[]>('GET', '/api/providers')).find((provider) => provider.id === id)!;
    cleanup();
    const close = vi.fn();
    render(
      wrap(
        <EditModeModal
          data={stored}
          modalProps={{ visible: true }}
          modalCtrl={{ close }}
          onChange={async (provider) => {
            await persistKiBuddyProvider(provider, true);
          }}
        />
      )
    );
    fireEvent.change(screen.getByLabelText('settings.kiBuddyModel.connectionName'), {
      target: { value: 'Renamed after restart' },
    });
    await user.click(screen.getByText('common.save'));
    await waitFor(() => expect(close).toHaveBeenCalled());
    expect((await health(id, harness.mock.model)).status).toBe('healthy');
  }, 30000);
  it('sends Bearer and stream_options when enabled on the saved connection', async () => {
    const settings = kiBuddyProviderAdapter.read(stored)!;
    settings.gateway!.bearer = true;
    settings.gateway!.streamOptions = true;
    await persistKiBuddyProvider(kiBuddyProviderAdapter.write({ ...stored, api_key: 'mock-api-key' }, settings), true);
    expect((await health(id, harness.mock.model)).status).toBe('healthy');
    expect((await harness.records()).at(-1)).toMatchObject({
      bearerPresent: true,
      optionPresence: { stream_options: true },
    });
  });
  it('clears a header credential before networking and replaces it without affecting other headers', async () => {
    const settings = kiBuddyProviderAdapter.read(stored)!;
    settings.gateway!.headers![1].credentialAction = 'clear';
    await persistKiBuddyProvider(kiBuddyProviderAdapter.write(stored, settings), true);
    await expect(health(id, harness.mock.model)).rejects.toThrow(': 400');
    expect(await harness.records()).toHaveLength(initialRequestCount);
    settings.gateway!.headers![1] = {
      ...settings.gateway!.headers![1],
      credentialAction: 'replace',
      value: 'mock-secret-key',
    };
    await persistKiBuddyProvider(kiBuddyProviderAdapter.write(stored, settings), true);
    expect((await health(id, harness.mock.model)).status).toBe('healthy');
  });
  it.each(['readTimeoutSeconds', 'totalTimeoutSeconds'] as const)(
    'enforces %s on the actual SDK request',
    async (key) => {
      const settings = kiBuddyProviderAdapter.read(stored)!;
      settings.gateway![key] = 0.001;
      await persistKiBuddyProvider(kiBuddyProviderAdapter.write(stored, settings), true);
      expect(await health(id, harness.mock.model)).toMatchObject({ status: 'unhealthy', error_kind: 'timeout' });
    },
    30000
  );
  it('uses the configured proxy and bypasses it only for the direct connection', async () => {
    harness.enableProxy();
    await harness.restart();
    const settings = kiBuddyProviderAdapter.read(stored)!;
    settings.gateway!.proxy = 'default';
    await persistKiBuddyProvider(kiBuddyProviderAdapter.write(stored, settings), true);
    const beforeProxy = harness.proxyCount();
    expect((await health(id, harness.mock.model)).status).toBe('unhealthy');
    expect(harness.proxyCount()).toBeGreaterThan(beforeProxy);
    settings.gateway!.proxy = 'direct';
    await persistKiBuddyProvider(kiBuddyProviderAdapter.write(stored, settings), true);
    const beforeDirect = harness.proxyCount();
    expect((await health(id, harness.mock.model)).status).toBe('healthy');
    expect(harness.proxyCount()).toBe(beforeDirect);
  }, 30000);
  it('initializes project defaults and preserves real stored credentials across upgrade and restore', async () => {
    const preset = {
      id: 'offline-project',
      name: 'Offline preset',
      endpoint: harness.mock.url,
      modelIds: [harness.mock.model],
      headerNames: ['appId', 'secretKey', 'apikey'],
      manual: true,
      protocol: 'chat_completions',
      bearer: false,
      proxy: 'direct',
      streamOptions: false,
    } as const;
    await initializeKiBuddyModelPreset(preset, []);
    const id = presetProviderId(preset);
    let stored = (await harness.call<KiBuddyProvider[]>('GET', '/api/providers')).find(
      (provider) => provider.id === id
    )!;
    expect(stored.gateway!.headers.every((header) => header.configured === false)).toBe(true);
    const settings = kiBuddyProviderAdapter.read(stored)!;
    settings.gateway!.headers!.forEach((header, index) => {
      header.credentialAction = 'replace';
      header.value = ['mock-app-id', 'mock-secret-key', 'mock-api-key'][index];
    });
    await persistKiBuddyProvider(kiBuddyProviderAdapter.write({ ...stored, name: 'User edited' }, settings), true);
    await harness.restart();
    await initializeKiBuddyModelPreset(
      { ...preset, endpoint: 'https://example.invalid/new-package' },
      await harness.call('GET', '/api/providers')
    );
    stored = (await harness.call<KiBuddyProvider[]>('GET', '/api/providers')).find((provider) => provider.id === id)!;
    expect(stored).toMatchObject({ name: 'User edited', base_url: harness.mock.url });
    const restored = restoreKiBuddyModelPreset(
      preset,
      { name: '', endpoint: '', modelIds: '', apiKey: '' },
      kiBuddyProviderAdapter.read(stored)!
    );
    await persistKiBuddyProvider(kiBuddyProviderAdapter.write(stored, restored.value), true);
    expect((await health(id, harness.mock.model)).status).toBe('healthy');
  }, 60000);
});

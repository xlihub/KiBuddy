import React from 'react';
import { cleanup, render, waitFor } from '@testing-library/react';
import { KiBuddyModelPresetInitialization } from '@/renderer/pages/ki-buddy/ModelSettings';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseKiBuddyModelPreset } from '@/common/platform/ki-buddy/productConfig';
import {
  initializeKiBuddyModelPreset,
  restoreKiBuddyModelPreset,
  presetProviderId,
} from '@/renderer/pages/ki-buddy/ModelSettings/kiBuddyModelPreset';
import type { IProvider } from '@/common/config/storage';
const mocks = vi.hoisted(() => ({ create: vi.fn(), enabled: true, preset: undefined as unknown }));
vi.mock('@/renderer/services/runtime/kiBuddyRuntime', () => ({
  getKiBuddyProductRuntime: () => (mocks.enabled ? { id: 'ki-buddy', modelPreset: mocks.preset } : null),
}));
vi.mock('@/common', () => ({ ipcBridge: { mode: { createProvider: { invoke: mocks.create } } } }));
const preset = {
  id: 'synthetic-preset',
  name: 'Synthetic preset',
  endpoint: 'https://example.invalid/exact',
  modelIds: ['exact-model'],
  headerNames: ['X-Private'],
  manual: true,
  protocol: 'chat_completions',
  bearer: false,
  proxy: 'direct',
  streamOptions: false,
} as const;
const mutablePreset = { ...preset, modelIds: [...preset.modelIds], headerNames: [...preset.headerNames] };
beforeEach(() => {
  localStorage.clear();
  mocks.enabled = true;
  mocks.preset = preset;
  vi.clearAllMocks();
  mocks.create.mockResolvedValue({});
});
afterEach(cleanup);
describe('project preset lifecycle', () => {
  it('initializes once across concurrent mounts, restarts and bundle upgrades', async () => {
    await Promise.all([initializeKiBuddyModelPreset(preset, []), initializeKiBuddyModelPreset(preset, [])]);
    await initializeKiBuddyModelPreset({ ...preset, endpoint: 'https://example.invalid/upgraded' }, []);
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.create.mock.calls[0][0]).toMatchObject({
      model_mode: 'manual',
      header_credentials: { 'X-Private': { action: 'clear' } },
    });
  });
  it('preserves a previously saved connection even if bundle defaults have changed', async () => {
    const old: IProvider = {
      id: presetProviderId(preset),
      platform: 'custom',
      name: 'User choice',
      base_url: 'https://example.invalid/user-edit',
      models: ['user-id'],
      api_key: '',
    };
    await initializeKiBuddyModelPreset(preset, [old]);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(old.base_url).toBe('https://example.invalid/user-edit');
  });
  it('allows retry after a failed initialization without marking it initialized', async () => {
    mocks.create.mockRejectedValueOnce(new Error('offline'));
    await expect(initializeKiBuddyModelPreset(preset, [])).rejects.toThrow('offline');
    await initializeKiBuddyModelPreset(preset, []);
    expect(mocks.create).toHaveBeenCalledTimes(2);
  });
  it('restores public defaults while retaining API key, configured credentials and extra secret headers', () => {
    const header = {
      name: 'X-Private',
      value: '',
      sensitive: true,
      configured: true,
      credentialAction: 'keep' as const,
    };
    const extra = { ...header, name: 'X-Extra' };
    const restored = restoreKiBuddyModelPreset(
      preset,
      { name: 'User', endpoint: 'https://example.invalid/edit', modelIds: 'edited', apiKey: 'synthetic-bearer' },
      { manual: false, gateway: { headers: [header, extra], readTimeoutSeconds: 50 } }
    );
    expect(restored.draft).toMatchObject({
      endpoint: preset.endpoint,
      modelIds: 'exact-model',
      apiKey: 'synthetic-bearer',
    });
    expect(restored.value.gateway).toMatchObject({ headers: [header, extra], bearer: false, proxy: 'direct' });
    expect(restored.value.gateway).not.toHaveProperty('readTimeoutSeconds');
  });
  it.each([
    { apiKey: 'secret' },
    { endpoint: 'file:///private/config' },
    { modelIds: [] },
    { headerNames: ['X-One', 'x-one'] },
    { headerNames: ['Host'] },
    { bearer: true, headerNames: ['Authorization'] },
  ])('rejects malformed or sensitive project defaults', (patch) => {
    expect(() => parseKiBuddyModelPreset({ ...mutablePreset, ...patch })).toThrow();
  });
});

describe('preset initialization mounting boundary', () => {
  it('does nothing when the product capability is absent', async () => {
    mocks.enabled = false;
    const refresh = vi.fn();
    render(React.createElement(KiBuddyModelPresetInitialization, { providers: [], refresh }));
    expect(mocks.create).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });
  it('waits for the provider list before initializing a product preset', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    const view = render(React.createElement(KiBuddyModelPresetInitialization, { providers: undefined, refresh }));
    expect(mocks.create).not.toHaveBeenCalled();
    view.rerender(React.createElement(KiBuddyModelPresetInitialization, { providers: [], refresh }));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(mocks.create).toHaveBeenCalledOnce();
  });
});

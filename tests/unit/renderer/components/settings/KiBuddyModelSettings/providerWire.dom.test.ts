import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  kiBuddyProviderAdapter,
  persistKiBuddyProvider,
  type KiBuddyProvider,
} from '@/renderer/pages/ki-buddy/ModelSettings/kiBuddyProviderAdapter';
import { validateKiBuddyGateway } from '@/renderer/pages/ki-buddy/ModelSettings/kiBuddyGatewayValidation';
const mocks = vi.hoisted(() => ({ enabled: true, create: vi.fn(), update: vi.fn() }));
vi.mock('@/renderer/services/runtime/kiBuddyRuntime', () => ({
  getKiBuddyProductRuntime: () => (mocks.enabled ? { id: 'ki-buddy' } : null),
}));
vi.mock('@/common', () => ({
  ipcBridge: { mode: { createProvider: { invoke: mocks.create }, updateProvider: { invoke: mocks.update } } },
}));
const record: KiBuddyProvider = {
  id: 'wire',
  name: 'Synthetic',
  platform: 'custom',
  base_url: 'https://example.invalid/exact?x=1',
  models: ['exact-id'],
  api_key: 'synthetic-bearer',
  is_full_url: true,
  model_mode: 'manual',
  gateway: {
    auth: 'none',
    proxy: 'direct',
    headers: [
      { name: 'X-Private', sensitive: true, configured: true },
      { name: 'X-Public', value: 'public', sensitive: false },
    ],
    read_timeout_ms: 45000,
  },
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.enabled = true;
  mocks.create.mockResolvedValue(record);
  mocks.update.mockResolvedValue(record);
});
describe('Ki-Core provider persistence', () => {
  it('keeps opaque credentials on an unrelated edit and converts seconds to milliseconds', async () => {
    const settings = kiBuddyProviderAdapter.read(record)!;
    settings.gateway!.connectTimeoutSeconds = 0.125;
    const next = kiBuddyProviderAdapter.write({ ...record, name: 'Renamed' }, settings);
    await persistKiBuddyProvider(next, true);
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        gateway: expect.objectContaining({ connect_timeout_ms: 125, read_timeout_ms: 45000 }),
        header_credentials: { 'X-Private': { action: 'keep' } },
      })
    );
    expect(JSON.stringify(next)).not.toContain('header_credentials');
  });
  it('sends new secret values only at the request boundary, outside provider caches', async () => {
    const settings = kiBuddyProviderAdapter.read(record)!;
    settings.gateway!.headers![0] = {
      name: 'X-Private',
      sensitive: true,
      value: 'synthetic-private-value',
      credentialAction: 'replace',
    };
    const next = kiBuddyProviderAdapter.write(record, settings);
    expect(JSON.stringify(next)).not.toContain('synthetic-private-value');
    await persistKiBuddyProvider(next, true);
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        header_credentials: { 'X-Private': { action: 'replace', value: 'synthetic-private-value' } },
      })
    );
  });
  it('retains replacement input for a failed save retry', async () => {
    mocks.update.mockRejectedValueOnce(new Error('synthetic failure'));
    const settings = kiBuddyProviderAdapter.read(record)!;
    settings.gateway!.headers![0].credentialAction = 'clear';
    const next = kiBuddyProviderAdapter.write(record, settings);
    await expect(persistKiBuddyProvider(next, true)).rejects.toThrow('synthetic failure');
    await persistKiBuddyProvider(next, true);
    expect(mocks.update.mock.calls[1][0].header_credentials).toEqual({ 'X-Private': { action: 'clear' } });
  });
  it('explicitly clears the gateway when returning to automatic configuration', async () => {
    await persistKiBuddyProvider(kiBuddyProviderAdapter.write(record, { manual: false }), true);
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ model_mode: 'automatic', clear_gateway: true })
    );
    expect(mocks.update.mock.calls[0][0]).not.toHaveProperty('gateway');
  });
  it('does not invoke product persistence without a product capability', async () => {
    mocks.enabled = false;
    expect(await persistKiBuddyProvider(record, true)).toBe(false);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it.each([0, -1, 300.001, Infinity, 0.0001, 1.0001])('rejects an invalid Core connection timeout: %s', (timeout) => {
    expect(validateKiBuddyGateway('synthetic', { connectTimeoutSeconds: timeout })).toBe(
      'settings.kiBuddyModel.timeoutInvalid'
    );
  });
  it.each(['Connection', 'TE', 'Proxy-Authorization', 'Upgrade'])('rejects transport-owned header %s', (name) => {
    expect(validateKiBuddyGateway('synthetic', { headers: [{ name, value: 'synthetic' }] })).toBe(
      'settings.kiBuddyModel.reservedHeader'
    );
  });
  it.each(['', '***', '[REDACTED]', 'synthetic\tvalue'])('rejects missing, masked or invalid credentials', (value) => {
    expect(
      validateKiBuddyGateway('', { bearer: false, headers: [{ name: 'X-Private', value, sensitive: true }] })
    ).toBeDefined();
  });
});

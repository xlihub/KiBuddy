import type { IProvider } from '@/common/config/storage';
import { ipcBridge } from '@/common';
import { getKiBuddyProductRuntime } from '@/renderer/services/runtime/kiBuddyRuntime';
import type { KiBuddyModelSettingsAdapter } from './types';

/** Ki-Core 99387e44 provider_gateway.rs public response contract. */
export type KiBuddyProvider = IProvider & {
  model_mode?: 'automatic' | 'manual';
  gateway?: {
    auth: 'bearer' | 'none';
    headers: { name: string; value?: string; sensitive: boolean; configured?: boolean }[];
    proxy: 'default' | 'direct';
    include_stream_options?: boolean | null;
    connect_timeout_ms?: number | null;
    read_timeout_ms?: number | null;
    request_timeout_ms?: number | null;
  };
};
type CredentialWrite = { action: 'keep' | 'clear' } | { action: 'replace'; value: string };
type Writes = { header_credentials?: Record<string, CredentialWrite>; clear_gateway?: boolean };
// Request-only secrets never become enumerable provider properties or enter the optimistic cache.
const pendingWrites = new WeakMap<IProvider, Writes>();
const seconds = (value: number | null | undefined) => (value == null ? undefined : value / 1000);
const milliseconds = (value: number | undefined) => (value === undefined ? undefined : Math.round(value * 1000));

export const kiBuddyProviderAdapter: KiBuddyModelSettingsAdapter = {
  read(provider) {
    const record = provider as KiBuddyProvider;
    const gateway = record.gateway;
    return {
      manual: record.model_mode === 'manual',
      gateway: gateway
        ? {
            bearer: gateway.auth !== 'none',
            proxy: gateway.proxy,
            streamOptions: gateway.include_stream_options ?? undefined,
            connectTimeoutSeconds: seconds(gateway.connect_timeout_ms),
            readTimeoutSeconds: seconds(gateway.read_timeout_ms),
            totalTimeoutSeconds: seconds(gateway.request_timeout_ms),
            headers: gateway.headers.map((header) => ({
              name: header.name,
              value: header.sensitive ? '' : (header.value ?? ''),
              sensitive: header.sensitive,
              configured: header.configured,
              credentialAction: header.sensitive ? (header.configured ? 'keep' : 'clear') : undefined,
            })),
          }
        : undefined,
    };
  },
  write(provider, settings) {
    const original = provider as KiBuddyProvider;
    if (!settings.manual) {
      if (original.model_mode !== 'manual' && !original.gateway) return provider;
      const { gateway: _gateway, ...rest } = original;
      const next: KiBuddyProvider = { ...rest, model_mode: 'automatic' };
      pendingWrites.set(next, original.gateway ? { clear_gateway: true } : {});
      return next;
    }
    const gateway = settings.gateway;
    const header_credentials: Record<string, CredentialWrite> = Object.create(null);
    const headers = (gateway?.headers ?? []).map((header) => {
      if (!header.sensitive) return { name: header.name, value: header.value, sensitive: false };
      const action = header.credentialAction ?? 'replace';
      header_credentials[header.name] = action === 'replace' ? { action, value: header.value } : { action };
      return { name: header.name, sensitive: true, configured: action !== 'clear' };
    });
    const next: KiBuddyProvider = {
      ...provider,
      model_mode: 'manual',
      model_protocols: Object.fromEntries(provider.models.map((model) => [model, 'openai'])),
      gateway: {
        auth: gateway?.bearer === false ? 'none' : 'bearer',
        headers,
        proxy: gateway?.proxy ?? 'default',
        include_stream_options: gateway?.streamOptions,
        connect_timeout_ms: milliseconds(gateway?.connectTimeoutSeconds),
        read_timeout_ms: milliseconds(gateway?.readTimeoutSeconds),
        request_timeout_ms: milliseconds(gateway?.totalTimeoutSeconds),
      },
    };
    pendingWrites.set(next, { header_credentials });
    return next;
  },
};

/** Uses the existing authenticated bridge; false delegates unchanged to AionUi persistence. */
export async function persistKiBuddyProvider(provider: IProvider, existing: boolean): Promise<boolean> {
  if (!getKiBuddyProductRuntime() || provider.platform !== 'custom') return false;
  const writes = pendingWrites.get(provider);
  const request = { ...provider, ...writes };
  if (existing) await ipcBridge.mode.updateProvider.invoke(request);
  else await ipcBridge.mode.createProvider.invoke(request);
  pendingWrites.delete(provider);
  return true;
}

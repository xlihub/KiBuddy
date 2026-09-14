import type { IProvider } from '@/common/config/storage';
import type { KiBuddyProductCapability } from '@/common/types/platform/kiBuddyProduct';
import { kiBuddyProviderAdapter, persistKiBuddyProvider } from './kiBuddyProviderAdapter';
import type { KiBuddyManualModelDraft, KiBuddyModelSettings } from './types';

type Preset = NonNullable<KiBuddyProductCapability['modelPreset']>;
export const presetProviderId = (preset: Preset) => `ki-buddy-preset-${preset.id}`;

/** Restore only public settings; retained secret rows are never deleted by restoring defaults. */
export function restoreKiBuddyModelPreset(
  preset: Preset,
  draft: KiBuddyManualModelDraft,
  settings: KiBuddyModelSettings
) {
  const existing = settings.gateway?.headers ?? [];
  const names = new Set(preset.headerNames.map((name) => name.toLowerCase()));
  return {
    draft: { ...draft, name: preset.name, endpoint: preset.endpoint, modelIds: preset.modelIds.join('\n') },
    value: {
      manual: true,
      gateway: {
        bearer: preset.bearer,
        proxy: preset.proxy,
        streamOptions: preset.streamOptions,
        headers: [
          ...preset.headerNames.map(
            (name) =>
              existing.find((header) => header.sensitive && header.name.toLowerCase() === name.toLowerCase()) ?? {
                name,
                value: '',
                sensitive: true,
                configured: false,
                credentialAction: 'clear' as const,
              }
          ),
          ...existing.filter((header) => header.sensitive && !names.has(header.name.toLowerCase())),
        ],
      },
    } satisfies KiBuddyModelSettings,
  };
}

const initializing = new Map<string, Promise<void>>();
/** A stable provider id and installation-local marker preserve edits, upgrades and deliberate deletion. */
export async function initializeKiBuddyModelPreset(preset: Preset, providers: IProvider[]): Promise<void> {
  const id = presetProviderId(preset);
  const key = `ki-buddy:model-preset:${preset.id}`;
  if (localStorage.getItem(key) === 'initialized') return;
  if (
    providers.some(
      (provider) =>
        provider.id === id ||
        (provider.platform === 'custom' &&
          provider.base_url === preset.endpoint &&
          preset.modelIds.every((model) => provider.models.includes(model)))
    )
  ) {
    localStorage.setItem(key, 'initialized');
    return;
  }
  if (initializing.has(key)) return initializing.get(key);
  const operation = (async () => {
    const initial = restoreKiBuddyModelPreset(
      preset,
      { name: '', endpoint: '', apiKey: '', modelIds: '' },
      { manual: true }
    );
    const provider = kiBuddyProviderAdapter.write(
      {
        id,
        platform: 'custom',
        name: preset.name,
        base_url: preset.endpoint,
        api_key: '',
        models: [...preset.modelIds],
        is_full_url: true,
        model_settings: Object.fromEntries(
          preset.modelIds.map((model) => [model, { openai_api_mode: 'chat_completions' as const }])
        ),
      },
      initial.value
    );
    if (!(await persistKiBuddyProvider(provider, false))) throw new Error('Model preset capability is unavailable');
    localStorage.setItem(key, 'initialized');
  })();
  initializing.set(key, operation);
  try {
    await operation;
  } finally {
    initializing.delete(key);
  }
}

import type { IProvider } from '@/common/config/storage';
import { getKiBuddyProductRuntime } from '@/renderer/services/runtime/kiBuddyRuntime';
import React, { createContext, useContext, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KiBuddyModelSettingsFields } from './KiBuddyModelSettingsFields';
import type { KiBuddyModelSettings, KiBuddyModelSettingsAdapter } from './types';

export type { KiBuddyModelSettings, KiBuddyModelSettingsAdapter } from './types';

// No production adapter until Core #22 publishes its wire and default semantics.
export const KiBuddyModelSettingsAdapterContext = createContext<KiBuddyModelSettingsAdapter | null>(null);

type Options = {
  platform?: string;
  provider?: IProvider;
  visible?: boolean;
  editable?: boolean;
};

/** Selects product behavior at one capability boundary for all three model dialogs. */
export function useKiBuddyModelSettings({ platform, provider, visible, editable = true }: Options) {
  const { t } = useTranslation();
  const adapter = useContext(KiBuddyModelSettingsAdapterContext);
  const enabled = Boolean(getKiBuddyProductRuntime()) && platform === 'custom';
  const [ready, setReady] = useState(false);
  // Allow the parent form's open/reset effect to clear stale credentials before discovery resumes.
  useEffect(() => setReady(visible !== false), [visible]);
  const initial = (): KiBuddyModelSettings =>
    (enabled && provider ? adapter?.read(provider) : undefined) ?? { manual: false };
  const [state, setState] = useState(() => ({ provider, platform, visible, adapter, enabled, value: initial() }));
  const [error, setError] = useState<string>();
  const changed =
    state.provider !== provider ||
    state.platform !== platform ||
    state.visible !== visible ||
    state.adapter !== adapter ||
    state.enabled !== enabled;
  // Resolve the record synchronously: a saved manual connection must never probe on its first render.
  const value = changed ? initial() : state.value;
  if (changed) {
    setState({ provider, platform, visible, adapter, enabled, value });
    setError(undefined);
  }
  const manual = enabled && value.manual;
  const configured = enabled && (manual || Boolean(value.gateway));

  const prepare = (next: IProvider): IProvider | null => {
    if (!enabled) return next;
    const fail = (message: string): null => {
      setError(message);
      return null;
    };
    if (manual) {
      try {
        const url = new URL(next.base_url);
        if (!['http:', 'https:'].includes(url.protocol) || !next.base_url.trim()) throw new Error('Invalid URL');
      } catch {
        return fail(t('settings.kiBuddyModel.urlRequired'));
      }
      if (!next.models.length || next.models.some((model) => !model?.trim()))
        return fail(t('settings.kiBuddyModel.modelRequired'));
    }
    const timeout = value.gateway?.timeoutSeconds;
    if (timeout !== undefined && (!Number.isSafeInteger(timeout) || timeout <= 0))
      return fail(t('settings.kiBuddyModel.timeoutInvalid'));
    if (!adapter) return configured ? fail(t('settings.kiBuddyModel.unavailable')) : next;
    const prepared = configured
      ? {
          ...next,
          ...(manual ? { is_full_url: true } : {}),
          model_settings: Object.fromEntries(
            next.models.map((model) => [
              model,
              {
                ...next.model_settings?.[model],
                openai_api_mode: 'chat_completions' as const,
              },
            ])
          ),
        }
      : next;
    try {
      return adapter.write(prepared, value);
    } catch {
      return fail(t('settings.kiBuddyModel.mappingFailed'));
    }
  };

  return {
    discoveryEnabled: !manual && (!enabled || (visible !== false && ready)),
    forceFullUrl: manual,
    forceChatCompletions: configured,
    prepare,
    fields: enabled ? (
      <KiBuddyModelSettingsFields
        value={value}
        editable={editable}
        error={error}
        onChange={(next) => {
          setState({ provider, platform, visible, adapter, enabled, value: next });
          setError(undefined);
        }}
      />
    ) : null,
  };
}

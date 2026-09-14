import { restoreKiBuddyModelPreset, presetProviderId } from './kiBuddyModelPreset';
export { KiBuddyModelPresetInitialization } from './KiBuddyModelPresetInitialization';
import { kiBuddyProviderAdapter } from './kiBuddyProviderAdapter';
export { persistKiBuddyProvider } from './kiBuddyProviderAdapter';
import { uuid } from '@/common/utils';
import type { IProvider } from '@/common/config/storage';
import { getKiBuddyProductRuntime } from '@/renderer/services/runtime/kiBuddyRuntime';
import React, { createContext, useContext, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { validateKiBuddyGateway } from './kiBuddyGatewayValidation';
import { KiBuddyModelSettingsFields } from './KiBuddyModelSettingsFields';
import type { KiBuddyManualModelDraft, KiBuddyModelSettings, KiBuddyModelSettingsAdapter } from './types';

export type { KiBuddyModelSettings, KiBuddyModelSettingsAdapter } from './types';

export const KiBuddyModelSettingsAdapterContext = createContext<KiBuddyModelSettingsAdapter | null>(
  kiBuddyProviderAdapter
);

type Options = {
  platform?: string;
  provider?: IProvider;
  visible?: boolean;
  editable?: boolean;
  editingModel?: string;
};

/** Selects product behavior at one capability boundary for all three model dialogs. */
export function useKiBuddyModelSettings({ platform, provider, visible, editable = true, editingModel }: Options) {
  const { t } = useTranslation();
  const adapter = useContext(KiBuddyModelSettingsAdapterContext);
  const enabled = Boolean(getKiBuddyProductRuntime()) && platform === 'custom';
  const [ready, setReady] = useState(false);
  // Allow the parent form's open/reset effect to clear stale credentials before discovery resumes.
  useEffect(() => setReady(visible !== false), [visible]);
  const initial = () => {
    const value: KiBuddyModelSettings = (enabled && provider ? adapter?.read(provider) : undefined) ?? {
      manual: false,
    };
    const draft: KiBuddyManualModelDraft = {
      name: provider?.name ?? '',
      endpoint: provider?.base_url ?? '',
      apiKey: provider?.api_key ?? '',
      modelIds: editable ? (provider?.models.join('\n') ?? '') : (editingModel ?? ''),
    };
    return {
      provider,
      platform,
      visible,
      adapter,
      enabled,
      editingModel,
      value,
      draft,
      originalHasCredentials: Boolean(value.gateway?.headers?.some((header) => header.sensitive && header.configured)),
      clearGatewayConfirmed: false,
      originalManual: value.manual,
    };
  };
  const [state, setState] = useState(initial);
  const [error, setError] = useState<string>();
  const changed =
    state.provider !== provider ||
    state.platform !== platform ||
    state.visible !== visible ||
    state.adapter !== adapter ||
    state.enabled !== enabled ||
    state.editingModel !== editingModel;
  // Resolve the record synchronously: a saved manual connection must never probe on its first render.
  const current = changed ? initial() : state;
  const { value } = current;
  if (changed) {
    setState(current);
    setError(undefined);
  }
  const manual = enabled && value.manual;
  const preset = enabled ? getKiBuddyProductRuntime()?.modelPreset : undefined;
  const canRestorePreset =
    editable && preset && (provider?.id === presetProviderId(preset) || provider?.base_url === preset.endpoint);
  const configured = manual;
  const needsGatewayClear = enabled && !manual && current.originalHasCredentials && !current.clearGatewayConfirmed;
  const fullUrlOverride = enabled && (manual || current.originalManual) ? manual : undefined;

  const prepare = (next: IProvider): IProvider | null => {
    if (!enabled) return next;
    const fail = (message: string): null => {
      setError(message);
      return null;
    };
    if (needsGatewayClear) return fail(t('settings.kiBuddyModel.confirmClearGateway'));
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
    const gatewayError = manual ? validateKiBuddyGateway(next.api_key, value.gateway) : undefined;
    if (gatewayError) return fail(t(gatewayError));
    if (!adapter) return configured ? fail(t('settings.kiBuddyModel.unavailable')) : next;
    const endpoint = fullUrlOverride === undefined ? next : { ...next, is_full_url: fullUrlOverride };
    const prepared = configured
      ? {
          ...endpoint,
          api_key: endpoint.api_key,
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
      : endpoint;
    try {
      return adapter.write(prepared, manual ? value : { manual: false });
    } catch {
      return fail(t('settings.kiBuddyModel.mappingFailed'));
    }
  };

  // Returns true when the product consumes submission, including validation failure.
  const submitManual = async (onSave: (next: IProvider) => void | Promise<void>): Promise<boolean> => {
    if (!manual) return false;
    const ids = current.draft.modelIds
      .split('\n')
      .map((id) => id.trim())
      .filter(Boolean);
    if (!ids.length) {
      setError(t('settings.kiBuddyModel.modelRequired'));
      return true;
    }
    const next: IProvider = {
      ...provider,
      id: provider?.id ?? uuid(),
      name: current.draft.name.trim() || ids[0],
      platform: 'custom',
      base_url: current.draft.endpoint,
      api_key: current.draft.apiKey,
      models: editable ? [...new Set(ids)] : [...new Set([...(provider?.models ?? []), ...ids])],
    };
    const prepared = prepare(next);
    if (prepared) {
      try {
        await onSave(prepared);
      } catch {
        setError(t('settings.saveModelConfigFailed'));
      }
    }
    return true;
  };

  return {
    manual,
    submitManual,
    discoveryEnabled: !manual && (!enabled || (visible !== false && ready)),
    fullUrlOverride,
    forceChatCompletions: configured,
    prepare,
    fields: enabled ? (
      <KiBuddyModelSettingsFields
        value={value}
        onConfirmGatewayClear={
          needsGatewayClear
            ? () => {
                setState({ ...current, clearGatewayConfirmed: true });
                setError(undefined);
              }
            : undefined
        }
        presetHint={Boolean(canRestorePreset)}
        onRestorePreset={
          canRestorePreset
            ? () => {
                const restored = restoreKiBuddyModelPreset(preset, current.draft, value);
                setState({ ...current, ...restored });
                setError(undefined);
              }
            : undefined
        }
        draft={current.draft}
        modelOnly={!editable}
        editingModel={editingModel}
        onDraftChange={(draft) => {
          setState({ ...current, draft });
          setError(undefined);
        }}
        editable={editable}
        error={error}
        onChange={(next) => {
          setState({ ...current, value: next });
          setError(undefined);
        }}
      />
    ) : null,
  };
}

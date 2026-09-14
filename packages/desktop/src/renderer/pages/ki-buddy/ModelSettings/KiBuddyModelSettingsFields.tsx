import { Alert, Button, Input, Select, Switch } from '@arco-design/web-react';
import React from 'react';
import { KiBuddyGatewayFields } from './KiBuddyGatewayFields';
import { useTranslation } from 'react-i18next';
import type { KiBuddyManualModelDraft, KiBuddyModelSettings } from './types';

type Props = {
  value: KiBuddyModelSettings;
  onChange(value: KiBuddyModelSettings): void;
  editable: boolean;
  draft: KiBuddyManualModelDraft;
  onDraftChange(value: KiBuddyManualModelDraft): void;
  modelOnly: boolean;
  editingModel?: string;
  error?: string;
  presetHint?: boolean;
  onRestorePreset?: () => void;
  onConfirmGatewayClear?: () => void;
};

/** Product-owned controls composed into the existing provider dialogs. */
export function KiBuddyModelSettingsFields({
  value,
  onChange,
  editable,
  error,
  draft,
  onDraftChange,
  modelOnly,
  editingModel,
  presetHint,
  onRestorePreset,
  onConfirmGatewayClear,
}: Props) {
  const { t } = useTranslation();
  const setGateway = (patch: NonNullable<KiBuddyModelSettings['gateway']>) => {
    const entries = Object.entries({ ...value.gateway, ...patch }).filter(([, entry]) => entry !== undefined);
    onChange({ ...value, gateway: entries.length ? Object.fromEntries(entries) : undefined });
  };

  return (
    <div className='flex flex-col gap-12px mb-12px'>
      {presetHint && <Alert type='info' content={t('settings.kiBuddyModel.presetHint')} />}
      {onRestorePreset && (
        <div>
          <Button onClick={onRestorePreset}>{t('settings.kiBuddyModel.restorePreset')}</Button>
          <div className='text-12px text-t-secondary'>{t('settings.kiBuddyModel.restorePresetHint')}</div>
        </div>
      )}
      {editable && (
        <div className='flex items-center gap-8px'>
          <Switch
            aria-label={t('settings.kiBuddyModel.manual')}
            checked={value.manual}
            onChange={(manual) => onChange({ ...value, manual })}
          />
          <span className='text-13px text-t-primary'>{t('settings.kiBuddyModel.manual')}</span>
        </div>
      )}
      {onConfirmGatewayClear && (
        <Alert
          type='warning'
          content={t('settings.kiBuddyModel.confirmClearGateway')}
          action={
            <Button onClick={onConfirmGatewayClear}>{t('settings.kiBuddyModel.confirmClearGatewayAction')}</Button>
          }
        />
      )}
      {value.manual && <Alert type='info' content={t('settings.kiBuddyModel.manualHint')} />}
      {value.manual && (
        <div className='flex flex-col gap-12px'>
          {!modelOnly && (
            <>
              <label className='flex flex-col gap-4px'>
                <span>{t('settings.kiBuddyModel.connectionName')}</span>
                <Input
                  aria-label={t('settings.kiBuddyModel.connectionName')}
                  value={draft.name}
                  onChange={(name) => onDraftChange({ ...draft, name })}
                />
              </label>
              <label className='flex flex-col gap-4px'>
                <span>{t('settings.kiBuddyModel.chatEndpoint')}</span>
                <Input
                  aria-label={t('settings.kiBuddyModel.chatEndpoint')}
                  value={draft.endpoint}
                  onChange={(endpoint) => onDraftChange({ ...draft, endpoint })}
                />
              </label>
              <div className='flex flex-col gap-4px'>
                <span>{t('settings.kiBuddyModel.bearer')}</span>
                <Select
                  aria-label={t('settings.kiBuddyModel.bearer')}
                  value={
                    value.gateway?.bearer === undefined ? 'default' : value.gateway.bearer ? 'enabled' : 'disabled'
                  }
                  options={[
                    { label: t('settings.kiBuddyModel.defaultBearer'), value: 'default' },
                    { label: t('settings.kiBuddyModel.bearerAuth'), value: 'enabled' },
                    { label: t('settings.kiBuddyModel.noBearer'), value: 'disabled' },
                  ]}
                  onChange={(next) => setGateway({ bearer: next === 'default' ? undefined : next === 'enabled' })}
                />
              </div>
              {value.gateway?.bearer === false && draft.apiKey && (
                <Button onClick={() => onDraftChange({ ...draft, apiKey: '' })}>
                  {t('settings.kiBuddyModel.clearApiKey')}
                </Button>
              )}
              {value.gateway?.bearer !== false && (
                <label className='flex flex-col gap-4px'>
                  <span>{t('settings.kiBuddyModel.apiKey')}</span>
                  <Input.Password
                    aria-label={t('settings.kiBuddyModel.apiKey')}
                    value={draft.apiKey}
                    onChange={(apiKey) => onDraftChange({ ...draft, apiKey })}
                  />
                </label>
              )}
            </>
          )}
          <label className='flex flex-col gap-4px'>
            <span>{t('settings.kiBuddyModel.requestModelId')}</span>
            <Input.TextArea
              aria-label={t('settings.kiBuddyModel.requestModelId')}
              value={draft.modelIds}
              readOnly={Boolean(editingModel)}
              autoSize={{ minRows: 1, maxRows: 4 }}
              onChange={(modelIds) => onDraftChange({ ...draft, modelIds })}
            />
            <span className='text-12px text-t-secondary'>{t('settings.kiBuddyModel.requestModelIdHint')}</span>
          </label>
        </div>
      )}
      {editable && value.manual && <KiBuddyGatewayFields value={value.gateway} onChange={setGateway} />}
      {error && (
        <div role='alert'>
          <Alert type='error' content={error} />
        </div>
      )}
    </div>
  );
}

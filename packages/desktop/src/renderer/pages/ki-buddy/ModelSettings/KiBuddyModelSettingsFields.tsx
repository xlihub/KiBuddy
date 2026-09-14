import { Alert, Collapse, InputNumber, Select, Switch } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { KiBuddyModelSettings } from './types';

type Props = {
  value: KiBuddyModelSettings;
  onChange(value: KiBuddyModelSettings): void;
  editable: boolean;
  error?: string;
};

/** Product-owned controls composed into the existing provider dialogs. */
export function KiBuddyModelSettingsFields({ value, onChange, editable, error }: Props) {
  const { t } = useTranslation();
  const setGateway = (patch: NonNullable<KiBuddyModelSettings['gateway']>) => {
    const entries = Object.entries({ ...value.gateway, ...patch }).filter(([, entry]) => entry !== undefined);
    onChange({ ...value, gateway: entries.length ? Object.fromEntries(entries) : undefined });
  };
  const booleanOptions = [
    { label: t('settings.kiBuddyModel.inherit'), value: 'default' },
    { label: t('settings.kiBuddyModel.enabled'), value: 'enabled' },
    { label: t('settings.kiBuddyModel.disabled'), value: 'disabled' },
  ];

  return (
    <div className='flex flex-col gap-12px mb-12px'>
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
      {value.manual && <Alert type='info' content={t('settings.kiBuddyModel.manualHint')} />}
      {editable && (
        <Collapse>
          <Collapse.Item name='gateway' header={t('settings.kiBuddyModel.advanced')}>
            <div className='flex flex-col gap-12px'>
              <div className='text-12px text-t-secondary'>{t('settings.kiBuddyModel.advancedHint')}</div>
              <label className='flex flex-col gap-4px'>
                <span>{t('settings.kiBuddyModel.bearer')}</span>
                <Select
                  aria-label={t('settings.kiBuddyModel.bearer')}
                  value={
                    value.gateway?.bearer === undefined ? 'default' : value.gateway.bearer ? 'enabled' : 'disabled'
                  }
                  options={booleanOptions}
                  onChange={(next) => setGateway({ bearer: next === 'default' ? undefined : next === 'enabled' })}
                />
              </label>
              <label className='flex flex-col gap-4px'>
                <span>{t('settings.kiBuddyModel.proxy')}</span>
                <Select
                  aria-label={t('settings.kiBuddyModel.proxy')}
                  value={value.gateway?.proxy ?? 'default'}
                  options={[
                    { label: t('settings.kiBuddyModel.inherit'), value: 'default' },
                    { label: t('settings.kiBuddyModel.systemProxy'), value: 'system' },
                    { label: t('settings.kiBuddyModel.direct'), value: 'direct' },
                  ]}
                  onChange={(next: 'default' | 'system' | 'direct') =>
                    setGateway({ proxy: next === 'default' ? undefined : next })
                  }
                />
              </label>
              <label className='flex flex-col gap-4px'>
                <span>{t('settings.kiBuddyModel.timeout')}</span>
                <InputNumber
                  aria-label={t('settings.kiBuddyModel.timeout')}
                  value={value.gateway?.timeoutSeconds}
                  placeholder={t('settings.kiBuddyModel.inherit')}
                  onChange={(timeoutSeconds) => setGateway({ timeoutSeconds })}
                />
              </label>
              <label className='flex flex-col gap-4px'>
                <span>{t('settings.kiBuddyModel.streamOptions')}</span>
                <Select
                  aria-label={t('settings.kiBuddyModel.streamOptions')}
                  value={
                    value.gateway?.streamOptions === undefined
                      ? 'default'
                      : value.gateway.streamOptions
                        ? 'enabled'
                        : 'disabled'
                  }
                  options={booleanOptions}
                  onChange={(next) =>
                    setGateway({ streamOptions: next === 'default' ? undefined : next === 'enabled' })
                  }
                />
              </label>
            </div>
          </Collapse.Item>
        </Collapse>
      )}
      {error && (
        <div role='alert'>
          <Alert type='error' content={error} />
        </div>
      )}
    </div>
  );
}

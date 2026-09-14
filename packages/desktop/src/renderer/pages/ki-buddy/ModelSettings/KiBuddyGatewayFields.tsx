import { Button, Collapse, Input, InputNumber, Select } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { KiBuddyModelSettings } from './types';

type Gateway = NonNullable<KiBuddyModelSettings['gateway']>;
type Props = { value: Gateway | undefined; onChange(patch: Gateway): void };

/** Ki-Model 0.1.1 request headers and caller-owned HTTP client options. */
export function KiBuddyGatewayFields({ value, onChange }: Props) {
  const { t } = useTranslation();
  const headers = value?.headers ?? [];
  return (
    <Collapse>
      <Collapse.Item name='gateway' header={t('settings.kiBuddyModel.advanced')}>
        <div className='flex flex-col gap-12px'>
          <div className='text-12px text-t-secondary'>{t('settings.kiBuddyModel.sdkDefaults')}</div>
          <div className='flex flex-col gap-8px'>
            <span>{t('settings.kiBuddyModel.headers')}</span>
            {headers.map((header, index) => (
              <div key={index} className='flex flex-col gap-4px'>
                <Input
                  aria-label={t('settings.kiBuddyModel.headerName')}
                  placeholder={t('settings.kiBuddyModel.headerName')}
                  value={header.name}
                  onChange={(name) =>
                    onChange({ headers: headers.map((item, i) => (i === index ? { ...item, name } : item)) })
                  }
                />
                <Input.Password
                  aria-label={t('settings.kiBuddyModel.headerValue')}
                  placeholder={t('settings.kiBuddyModel.headerValue')}
                  value={header.value}
                  onChange={(next) =>
                    onChange({ headers: headers.map((item, i) => (i === index ? { ...item, value: next } : item)) })
                  }
                />
                <Button
                  type='text'
                  size='small'
                  onClick={() => onChange({ headers: headers.filter((_, i) => i !== index) })}
                >
                  {t('settings.kiBuddyModel.removeHeader')}
                </Button>
              </div>
            ))}
            <Button type='secondary' onClick={() => onChange({ headers: [...headers, { name: '', value: '' }] })}>
              {t('settings.kiBuddyModel.addHeader')}
            </Button>
          </div>
          <label className='flex flex-col gap-4px'>
            <span>{t('settings.kiBuddyModel.proxy')}</span>
            <Select
              aria-label={t('settings.kiBuddyModel.proxy')}
              value={value?.proxy ?? 'default'}
              options={[
                { label: t('settings.kiBuddyModel.inherit'), value: 'default' },
                { label: t('settings.kiBuddyModel.systemProxy'), value: 'system' },
                { label: t('settings.kiBuddyModel.direct'), value: 'direct' },
              ]}
              onChange={(next: 'default' | 'system' | 'direct') =>
                onChange({ proxy: next === 'default' ? undefined : next })
              }
            />
          </label>
          {(
            [
              [
                'connectTimeoutSeconds',
                'settings.kiBuddyModel.connectTimeout',
                'settings.kiBuddyModel.connectTimeoutHint',
              ],
              ['readTimeoutSeconds', 'settings.kiBuddyModel.readTimeout', 'settings.kiBuddyModel.readTimeoutHint'],
              ['totalTimeoutSeconds', 'settings.kiBuddyModel.totalTimeout', 'settings.kiBuddyModel.totalTimeoutHint'],
            ] as const
          ).map(([key, label, hint]) => (
            <label key={key} className='flex flex-col gap-4px'>
              <span>{t(label)}</span>
              <InputNumber
                aria-label={t(label)}
                value={value?.[key]}
                min={0}
                placeholder={t('settings.kiBuddyModel.noTimeout')}
                onChange={(next) => onChange({ [key]: next })}
              />
              <span className='text-12px text-t-secondary'>{t(hint)}</span>
            </label>
          ))}
          <label className='flex flex-col gap-4px'>
            <span>{t('settings.kiBuddyModel.streamOptions')}</span>
            <Select
              aria-label={t('settings.kiBuddyModel.streamOptions')}
              value={value?.streamOptions === undefined ? 'default' : value.streamOptions ? 'enabled' : 'disabled'}
              options={[
                { label: t('settings.kiBuddyModel.defaultEnabled'), value: 'default' },
                { label: t('settings.kiBuddyModel.enabled'), value: 'enabled' },
                { label: t('settings.kiBuddyModel.disabled'), value: 'disabled' },
              ]}
              onChange={(next) => onChange({ streamOptions: next === 'default' ? undefined : next === 'enabled' })}
            />
          </label>
        </div>
      </Collapse.Item>
    </Collapse>
  );
}

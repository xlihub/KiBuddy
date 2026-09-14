import { Button, Input, Select, Switch } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { KiBuddyModelSettings } from './types';

type Headers = NonNullable<NonNullable<KiBuddyModelSettings['gateway']>['headers']>;
/** Public values and write-only credentials have distinct edit lifecycles. */
export function KiBuddyGatewayHeaderFields({
  headers,
  onChange,
}: {
  headers: Headers;
  onChange(headers: Headers): void;
}) {
  const { t } = useTranslation();
  const update = (index: number, patch: Partial<Headers[number]>) =>
    onChange(headers.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  return (
    <div className='flex flex-col gap-8px'>
      <span>{t('settings.kiBuddyModel.headers')}</span>
      {headers.map((header, index) => (
        <div key={index} className='flex flex-col gap-4px'>
          <Input
            aria-label={t('settings.kiBuddyModel.headerName')}
            placeholder={t('settings.kiBuddyModel.headerName')}
            value={header.name}
            onChange={(name) =>
              update(
                index,
                header.sensitive && name.toLowerCase() !== header.name.toLowerCase()
                  ? { name, configured: false, credentialAction: 'replace', value: '' }
                  : { name }
              )
            }
          />
          <div className='flex items-center gap-8px'>
            <Switch
              aria-label={t('settings.kiBuddyModel.sensitiveHeader')}
              checked={header.sensitive ?? false}
              onChange={(sensitive) =>
                update(index, {
                  sensitive,
                  configured: false,
                  credentialAction: sensitive ? 'replace' : undefined,
                  value: '',
                })
              }
            />
            <span>{t('settings.kiBuddyModel.sensitiveHeader')}</span>
          </div>
          {header.sensitive && (
            <>
              <span className='text-12px text-t-secondary'>
                {t(
                  header.configured
                    ? 'settings.kiBuddyModel.credentialConfigured'
                    : 'settings.kiBuddyModel.credentialMissing'
                )}
              </span>
              <Select
                aria-label={t('settings.kiBuddyModel.credentialAction')}
                value={header.credentialAction ?? 'replace'}
                options={[
                  ...(header.configured ? [{ label: t('settings.kiBuddyModel.keepCredential'), value: 'keep' }] : []),
                  { label: t('settings.kiBuddyModel.replaceCredential'), value: 'replace' },
                  { label: t('settings.kiBuddyModel.clearCredential'), value: 'clear' },
                ]}
                onChange={(credentialAction: 'keep' | 'replace' | 'clear') =>
                  update(index, { credentialAction, value: '' })
                }
              />
              {header.credentialAction === 'clear' && (
                <span className='text-12px text-t-secondary'>{t('settings.kiBuddyModel.clearCredentialHint')}</span>
              )}
            </>
          )}
          {(!header.sensitive || (header.credentialAction ?? 'replace') === 'replace') && (
            <Input.Password
              aria-label={t('settings.kiBuddyModel.headerValue')}
              placeholder={t('settings.kiBuddyModel.headerValue')}
              value={header.value}
              onChange={(value) => update(index, { value })}
            />
          )}
          <Button type='text' size='small' onClick={() => onChange(headers.filter((_, i) => i !== index))}>
            {t('settings.kiBuddyModel.removeHeader')}
          </Button>
        </div>
      ))}
      <Button
        type='secondary'
        disabled={headers.length >= 64}
        onClick={() => onChange([...headers, { name: '', value: '', sensitive: true, credentialAction: 'replace' }])}
      >
        {t('settings.kiBuddyModel.addHeader')}
      </Button>
    </div>
  );
}

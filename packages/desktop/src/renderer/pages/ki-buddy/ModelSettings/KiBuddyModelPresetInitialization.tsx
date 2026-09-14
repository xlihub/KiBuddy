import React, { useEffect, useState } from 'react';
import { Alert, Button } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { IProvider } from '@/common/config/storage';
import { getKiBuddyProductRuntime } from '@/renderer/services/runtime/kiBuddyRuntime';
import { initializeKiBuddyModelPreset } from './kiBuddyModelPreset';

/** Initialize only after the authenticated provider list has arrived. */
export function KiBuddyModelPresetInitialization({
  providers,
  refresh,
}: {
  providers: IProvider[] | undefined;
  refresh(): Promise<unknown>;
}) {
  const preset = getKiBuddyProductRuntime()?.modelPreset;
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const { t } = useTranslation();
  useEffect(() => {
    if (!preset || !providers) return;
    let active = true;
    setError(false);
    void initializeKiBuddyModelPreset(preset, providers)
      .then(() => {
        if (active) void refresh();
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
    // One attempt per installation preset and explicit retry; provider refreshes must not retry failures.
  }, [preset, Boolean(providers), attempt]);
  return error ? (
    <Alert
      type='error'
      content={t('settings.kiBuddyModel.presetFailed')}
      action={
        <Button onClick={() => setAttempt((value) => value + 1)}>{t('settings.kiBuddyModel.retryPreset')}</Button>
      }
    />
  ) : null;
}

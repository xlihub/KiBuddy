import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IProvider } from '@/common/config/storage';
import {
  KiBuddyModelSettingsAdapterContext,
  useKiBuddyModelSettings,
  type KiBuddyModelSettings,
  type KiBuddyModelSettingsAdapter,
} from '@/renderer/pages/ki-buddy/ModelSettings';

const capability = vi.hoisted(() => ({ enabled: true }));
vi.mock('@/renderer/services/runtime/kiBuddyRuntime', () => ({
  getKiBuddyProductRuntime: () => (capability.enabled ? { id: 'ki-buddy' } : null),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const record: IProvider = {
  id: 'connection',
  platform: 'custom',
  name: 'Connection',
  api_key: 'synthetic-key',
  base_url: 'https://example.invalid/chat?version=1',
  models: ['request-id'],
  model_settings: { 'request-id': { image_input: 'supported' } },
};
const submitted = vi.fn();
const write = vi.fn((provider: IProvider, _settings: KiBuddyModelSettings) => provider);
const read = vi.fn<() => KiBuddyModelSettings | undefined>();
const adapter: KiBuddyModelSettingsAdapter = { read, write };
function Harness({
  data = record,
  visible = true,
  mapping = adapter,
}: {
  data?: IProvider;
  visible?: boolean;
  mapping?: KiBuddyModelSettingsAdapter | null;
}) {
  return (
    <KiBuddyModelSettingsAdapterContext.Provider value={mapping}>
      <Form data={data} visible={visible} />
    </KiBuddyModelSettingsAdapterContext.Provider>
  );
}
function Form({ data, visible }: { data: IProvider; visible: boolean }) {
  const settings = useKiBuddyModelSettings({ provider: data, platform: data.platform, visible });
  return (
    <>
      {settings.fields}
      <output>{settings.discoveryEnabled ? 'discovery allowed' : 'discovery paused'}</output>
      <button onClick={() => submitted(settings.prepare(data))}>save</button>
    </>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  capability.enabled = true;
  read.mockReturnValue(undefined);
  write.mockImplementation((provider) => provider);
});
afterEach(cleanup);

describe('KiBuddy model settings adapter boundary', () => {
  it('preserves the exact existing provider when optional settings and the adapter are absent', () => {
    render(<Harness mapping={null} />);
    fireEvent.click(screen.getByText('save'));
    expect(submitted).toHaveBeenCalledWith(record);
    expect(screen.getByText('discovery allowed')).toBeInTheDocument();
  });

  it('keeps gateway controls independent of manual discovery and emits explicit false values', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByText('settings.kiBuddyModel.advanced'));
    await user.click(screen.getByLabelText('settings.kiBuddyModel.bearer'));
    fireEvent.click(screen.getByText('settings.kiBuddyModel.disabled'));
    await user.type(screen.getByLabelText('settings.kiBuddyModel.timeout'), '120');
    await user.click(screen.getByText('save'));
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({
        base_url: record.base_url,
        model_settings: { 'request-id': { image_input: 'supported', openai_api_mode: 'chat_completions' } },
      }),
      { manual: false, gateway: { bearer: false, timeoutSeconds: 120 } }
    );
    expect(screen.getByText('discovery allowed')).toBeInTheDocument();
  });

  it.each([
    ['missing URL', { base_url: '' }, 'settings.kiBuddyModel.urlRequired'],
    ['invalid URL', { base_url: 'file:///private/model' }, 'settings.kiBuddyModel.urlRequired'],
    ['missing models', { models: [] }, 'settings.kiBuddyModel.modelRequired'],
    ['blank model ID', { models: ['  '] }, 'settings.kiBuddyModel.modelRequired'],
  ])('rejects %s without creating a provider', (_name, patch, error) => {
    read.mockReturnValue({ manual: true });
    render(<Harness data={{ ...record, ...patch }} />);
    fireEvent.click(screen.getByText('save'));
    expect(screen.getByText(error)).toBeInTheDocument();
    expect(write).not.toHaveBeenCalled();
    expect(submitted).toHaveBeenCalledWith(null);
  });

  it.each([0, -1, 1.5])('rejects an invalid timeout of %s seconds', (timeoutSeconds) => {
    read.mockReturnValue({ manual: false, gateway: { timeoutSeconds } });
    render(<Harness />);
    fireEvent.click(screen.getByText('save'));
    expect(screen.getByText('settings.kiBuddyModel.timeoutInvalid')).toBeInTheDocument();
    expect(write).not.toHaveBeenCalled();
  });

  it('reports adapter failure without echoing its potentially sensitive error', () => {
    read.mockReturnValue({ manual: true });
    write.mockImplementation(() => {
      throw new Error('synthetic-secret');
    });
    render(<Harness />);
    fireEvent.click(screen.getByText('save'));
    expect(screen.getByText('settings.kiBuddyModel.mappingFailed')).toBeInTheDocument();
    expect(screen.queryByText('synthetic-secret')).not.toBeInTheDocument();
    expect(submitted).toHaveBeenCalledWith(null);
  });

  it('does not read product configuration when the capability is absent', () => {
    capability.enabled = false;
    render(<Harness />);
    fireEvent.click(screen.getByText('save'));
    expect([read.mock.calls, write.mock.calls]).toEqual([[], []]);
    expect(submitted).toHaveBeenCalledWith(record);
  });

  it('discards an unsaved manual draft when the dialog is closed and reopened', () => {
    const view = render(<Harness />);
    fireEvent.click(screen.getByRole('switch'));
    expect(screen.getByText('discovery paused')).toBeInTheDocument();
    view.rerender(<Harness visible={false} />);
    view.rerender(<Harness />);
    expect(screen.getByText('discovery allowed')).toBeInTheDocument();
  });

  it('preserves existing model settings when the optional gateway configuration is empty', () => {
    read.mockReturnValue({ manual: false, gateway: {} });
    render(<Harness />);
    fireEvent.click(screen.getByText('save'));
    expect(write).toHaveBeenCalledWith(record, { manual: false, gateway: {} });
    expect(screen.getByText('discovery allowed')).toBeInTheDocument();
  });
});

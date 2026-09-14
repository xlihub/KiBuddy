import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IProvider } from '@/common/config/storage';
import AddPlatformModal from '@/renderer/pages/settings/components/AddPlatformModal';
import EditModeModal from '@/renderer/pages/settings/components/EditModeModal';
import AddModelModal from '@/renderer/pages/settings/components/AddModelModal';
import {
  KiBuddyModelSettingsAdapterContext,
  type KiBuddyModelSettings,
  type KiBuddyModelSettingsAdapter,
} from '@/renderer/pages/ki-buddy/ModelSettings';

const mocks = vi.hoisted(() => ({ capability: true, fetch: vi.fn(), detect: vi.fn() }));
vi.mock('@/renderer/services/runtime/kiBuddyRuntime', () => ({
  getKiBuddyProductRuntime: () => (mocks.capability ? { id: 'ki-buddy' } : null),
}));
vi.mock('@/common', () => ({
  ipcBridge: { mode: { fetchModelList: { invoke: mocks.fetch }, detectProtocol: { invoke: mocks.detect } } },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/renderer/components/agent/ThemedLogo', () => ({ ProviderLogo: () => null }));
vi.mock('@/renderer/components/base/AionModal', () => ({
  default: ({
    children,
    onOk,
    visible,
    okText,
  }: {
    children: React.ReactNode;
    onOk(): void;
    visible: boolean;
    okText: string;
  }) =>
    visible ? (
      <div role='dialog'>
        {children}
        <button onClick={onOk}>{okText}</button>
      </div>
    ) : null,
}));

// Synthetic serialized metadata: deliberately not a proposed Core wire field.
type MockRecord = IProvider & { testOnlySettings?: KiBuddyModelSettings };
const adapter: KiBuddyModelSettingsAdapter = {
  read: (provider: MockRecord) => provider.testOnlySettings,
  write: (provider, settings): MockRecord => ({ ...provider, testOnlySettings: settings }),
};
const provider = (settings?: KiBuddyModelSettings): MockRecord => ({
  id: 'manual-connection',
  platform: 'custom',
  name: 'Private model',
  base_url: 'https://example.invalid/inner/chat?route=test',
  api_key: 'synthetic-key',
  models: ['requested-model-id'],
  is_full_url: true,
  testOnlySettings: settings,
});
const wrap = (children: React.ReactNode, mapping: KiBuddyModelSettingsAdapter | null = adapter) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, errorRetryCount: 0 }}>
    <KiBuddyModelSettingsAdapterContext.Provider value={mapping}>
      {children}
    </KiBuddyModelSettingsAdapterContext.Provider>
  </SWRConfig>
);
const close = vi.fn();
const submit = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addListener: vi.fn(), removeListener: vi.fn() });
  mocks.capability = true;
  mocks.fetch.mockResolvedValue({ models: ['discovered-model'] });
  mocks.detect.mockResolvedValue({ success: false, protocol: 'unknown' });
});
afterEach(cleanup);

async function createForm(manual = true, mapping: KiBuddyModelSettingsAdapter | null = adapter) {
  const user = userEvent.setup();
  render(wrap(<AddPlatformModal modalProps={{ visible: true }} modalCtrl={{ close }} onSubmit={submit} />, mapping));
  await user.click(screen.getByTestId('model-provider-platform'));
  fireEvent.click(await screen.findByText('settings.platformCustom'));
  if (manual) await user.click(screen.getByRole('switch', { name: 'settings.kiBuddyModel.manual' }));
  return user;
}
async function fillCreate(user: ReturnType<typeof userEvent.setup>) {
  if (screen.queryByLabelText('settings.kiBuddyModel.chatEndpoint')) {
    await user.type(
      screen.getByLabelText('settings.kiBuddyModel.chatEndpoint'),
      'https://example.invalid/inner/chat?route=test'
    );
    await user.type(screen.getByLabelText('settings.kiBuddyModel.apiKey'), 'synthetic-key');
    await user.type(screen.getByLabelText('settings.kiBuddyModel.requestModelId'), 'requested-model-id');
    return;
  }
  await user.type(screen.getByTestId('model-provider-base-url'), 'https://example.invalid/inner/chat?route=test');
  await user.type(screen.getByTestId('model-provider-api-key'), 'synthetic-key');
  const model = screen.getByTestId('model-provider-models').querySelector('input')!;
  await user.type(model, 'requested-model-id');
  fireEvent.keyDown(model, { key: 'Enter', keyCode: 13 });
}

// Wait past the real protocol debounce, exercising the public IPC request boundary.
const settleDetection = () => new Promise((resolve) => setTimeout(resolve, 1150));

describe('KiBuddy model dialogs', () => {
  it('replaces the automatic form with product inputs when manual mode is enabled', async () => {
    await createForm();
    expect(screen.queryByTestId('model-provider-models')).not.toBeInTheDocument();
    expect(screen.queryByText('settings.multiApiKeyTip')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'settings.kiBuddyModel.requestModelId' })).toBeInTheDocument();
  });

  it('saves an explicit no-Bearer draft without API key or dropdown suggestions', async () => {
    const user = await createForm();
    await user.click(screen.getByLabelText('settings.kiBuddyModel.bearer'));
    fireEvent.click(screen.getByText('settings.kiBuddyModel.noBearer'));
    await user.type(screen.getByLabelText('settings.kiBuddyModel.chatEndpoint'), 'https://example.invalid/chat');
    await user.type(screen.getByLabelText('settings.kiBuddyModel.requestModelId'), 'private-id');
    await user.click(screen.getByText('common.confirm'));
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(submit.mock.calls[0][0]).toMatchObject({ api_key: '', models: ['private-id'] });
    expect([mocks.fetch.mock.calls, mocks.detect.mock.calls]).toEqual([[], []]);
  });

  it('restores the automatic draft and keeps gateway options out of its submission', async () => {
    const user = await createForm(false);
    await fillCreate(user);
    await user.click(screen.getByRole('switch', { name: 'settings.kiBuddyModel.manual' }));
    await user.type(
      screen.getByLabelText('settings.kiBuddyModel.chatEndpoint'),
      'https://example.invalid/private/chat'
    );
    await user.click(screen.getByText('settings.kiBuddyModel.advanced'));
    await user.type(screen.getByLabelText('settings.kiBuddyModel.totalTimeout'), '120');
    await user.click(screen.getByRole('switch', { name: 'settings.kiBuddyModel.manual' }));
    expect(screen.queryByText('settings.kiBuddyModel.advanced')).not.toBeInTheDocument();
    await user.click(screen.getByText('common.confirm'));
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(submit.mock.calls[0][0]).toMatchObject({
      base_url: 'https://example.invalid/inner/chat?route=test',
      testOnlySettings: { manual: false },
    });
  });

  it('edits SDK header credentials and independent transport timeouts through the product form', async () => {
    const user = await createForm();
    await fillCreate(user);
    await user.click(screen.getByText('settings.kiBuddyModel.advanced'));
    await user.click(screen.getByText('settings.kiBuddyModel.addHeader'));
    await user.type(screen.getByLabelText('settings.kiBuddyModel.headerName'), 'X-Synthetic-Key');
    await user.type(screen.getByLabelText('settings.kiBuddyModel.headerValue'), 'synthetic-header-secret');
    expect(screen.getByLabelText('settings.kiBuddyModel.headerValue')).toHaveAttribute('type', 'password');
    await user.type(screen.getByLabelText('settings.kiBuddyModel.connectTimeout'), '10');
    await user.type(screen.getByLabelText('settings.kiBuddyModel.readTimeout'), '60');
    await user.type(screen.getByLabelText('settings.kiBuddyModel.totalTimeout'), '120');
    await user.click(screen.getByText('common.confirm'));
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(submit.mock.calls[0][0].testOnlySettings).toMatchObject({
      manual: true,
      gateway: {
        headers: [{ name: 'X-Synthetic-Key', value: 'synthetic-header-secret' }],
        connectTimeoutSeconds: 10,
        readTimeoutSeconds: 60,
        totalTimeoutSeconds: 120,
      },
    });
  });

  it('keeps an invalid Bearer draft open before reaching the adapter', async () => {
    const user = await createForm();
    await user.type(screen.getByLabelText('settings.kiBuddyModel.chatEndpoint'), 'https://example.invalid/chat');
    await user.type(screen.getByLabelText('settings.kiBuddyModel.requestModelId'), 'private-id');
    await user.click(screen.getByText('common.confirm'));
    expect(await screen.findByText('settings.kiBuddyModel.keyRequired')).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it('creates a manual connection without discovering models or correcting its complete URL', async () => {
    const user = await createForm();
    await fillCreate(user);
    fireEvent.blur(screen.getByLabelText('settings.kiBuddyModel.chatEndpoint'));
    await settleDetection();
    await user.click(screen.getByText('common.confirm'));
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(submit.mock.calls[0][0]).toMatchObject({
      base_url: 'https://example.invalid/inner/chat?route=test',
      models: ['requested-model-id'],
      is_full_url: true,
      testOnlySettings: { manual: true },
      model_settings: { 'requested-model-id': { openai_api_mode: 'chat_completions' } },
    });
    expect([mocks.fetch.mock.calls, mocks.detect.mock.calls]).toEqual([[], []]);
  });

  it('keeps a manual draft open and unsaved without a Core adapter', async () => {
    const user = await createForm(true, null);
    await fillCreate(user);
    await user.click(screen.getByText('common.confirm'));
    expect(await screen.findByText('settings.kiBuddyModel.unavailable')).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it('edits a reloaded manual connection without discovery on mount, blur or focus', async () => {
    const user = userEvent.setup();
    const reloaded: MockRecord = JSON.parse(
      JSON.stringify(
        provider({
          manual: true,
          gateway: { proxy: 'direct', bearer: false, totalTimeoutSeconds: 120, streamOptions: false },
        })
      )
    );
    render(
      wrap(<EditModeModal data={reloaded} modalProps={{ visible: true }} modalCtrl={{ close }} onChange={submit} />)
    );
    const url = screen.getByDisplayValue(reloaded.base_url);
    await user.clear(url);
    await user.type(url, 'https://example.invalid/updated/chat');
    fireEvent.blur(url);
    await user.click(screen.getByLabelText('settings.kiBuddyModel.requestModelId'));
    await settleDetection();
    await user.click(screen.getByText('common.save'));
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(submit.mock.calls[0][0]).toMatchObject({
      base_url: 'https://example.invalid/updated/chat',
      models: ['requested-model-id'],
      testOnlySettings: reloaded.testOnlySettings,
    });
    expect([mocks.fetch.mock.calls, mocks.detect.mock.calls]).toEqual([[], []]);
  });

  it('adds a request model ID to a saved manual connection without fetching a list', async () => {
    const user = userEvent.setup();
    render(
      wrap(
        <AddModelModal
          data={provider({ manual: true })}
          modalProps={{ visible: true }}
          modalCtrl={{ close }}
          onSubmit={submit}
        />
      )
    );
    const input = screen.getByLabelText('settings.kiBuddyModel.requestModelId');
    await user.type(input, 'second-request-id');
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 13 });
    await user.click(screen.getByText('common.confirm'));
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(submit.mock.calls[0][0]).toMatchObject({
      models: ['requested-model-id', 'second-request-id'],
      testOnlySettings: { manual: true },
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('retains automatic discovery and protocol detection for an ordinary custom connection', async () => {
    const user = await createForm(false);
    await fillCreate(user);
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalled());
    await waitFor(() => expect(mocks.detect).toHaveBeenCalled(), { timeout: 2500 });
  });

  it('keeps the upstream create and save path when the product capability is missing', async () => {
    mocks.capability = false;
    const user = await createForm(false, null);
    expect(screen.queryByRole('switch', { name: 'settings.kiBuddyModel.manual' })).not.toBeInTheDocument();
    await fillCreate(user);
    await user.click(screen.getByText('common.confirm'));
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(submit.mock.calls[0][0]).not.toHaveProperty('testOnlySettings');
  });

  it('ignores an automatic response arriving after the user switches to manual mode', async () => {
    let finish: (value: { models: string[]; fixed_base_url: string }) => void = () => {};
    const response = new Promise<{ models: string[]; fixed_base_url: string }>((resolve) => {
      finish = resolve;
    });
    mocks.fetch.mockReturnValue(response);
    const user = await createForm(false);
    fireEvent.change(screen.getByTestId('model-provider-base-url'), {
      target: { value: 'https://example.invalid/exact/chat' },
    });
    fireEvent.change(screen.getByTestId('model-provider-api-key'), { target: { value: 'synthetic-key' } });
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalled());
    await user.click(screen.getByRole('switch', { name: 'settings.kiBuddyModel.manual' }));
    const requests = mocks.fetch.mock.calls.length;
    await act(async () => {
      finish({ models: ['response-alias'], fixed_base_url: 'https://example.invalid/rewritten' });
      await response;
    });
    fireEvent.change(screen.getByLabelText('settings.kiBuddyModel.chatEndpoint'), {
      target: { value: 'https://example.invalid/manual/chat' },
    });
    fireEvent.blur(screen.getByLabelText('settings.kiBuddyModel.chatEndpoint'));
    fireEvent.focus(window);
    await settleDetection();
    expect(screen.getByLabelText('settings.kiBuddyModel.chatEndpoint')).toHaveValue(
      'https://example.invalid/manual/chat'
    );
    expect(mocks.fetch).toHaveBeenCalledTimes(requests);
    expect(mocks.detect).not.toHaveBeenCalled();
  });

  it.each(['edit', 'add'] as const)('keeps the upstream %s discovery path without capability', async (entry) => {
    mocks.capability = false;
    const data = { ...provider({ manual: true }), is_full_url: false };
    render(
      wrap(
        entry === 'edit' ? (
          <EditModeModal data={data} modalProps={{ visible: true }} modalCtrl={{ close }} onChange={submit} />
        ) : (
          <AddModelModal data={data} modalProps={{ visible: true }} modalCtrl={{ close }} onSubmit={submit} />
        )
      )
    );
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalled());
    expect(screen.queryByText('settings.kiBuddyModel.manualHint')).not.toBeInTheDocument();
  });

  it('keeps manual credentials out of discovery when returning to an empty automatic draft', async () => {
    const user = await createForm();
    await fillCreate(user);
    await user.click(screen.getByRole('switch', { name: 'settings.kiBuddyModel.manual' }));
    await settleDetection();
    expect(screen.getByTestId('model-provider-base-url')).toHaveValue('');
    expect([mocks.fetch.mock.calls, mocks.detect.mock.calls]).toEqual([[], []]);
  });

  it('does not probe a cancelled manual draft while the dialog is hidden or reopening', async () => {
    const user = userEvent.setup();
    function Host() {
      const [modal, context] = AddPlatformModal.useModal({ onSubmit: submit });
      return (
        <>
          <button onClick={() => modal.open()}>open</button>
          <button onClick={() => modal.close()}>hide</button>
          {context}
        </>
      );
    }
    render(wrap(<Host />));
    await user.click(screen.getByText('open'));
    await user.click(screen.getByTestId('model-provider-platform'));
    fireEvent.click(await screen.findByText('settings.platformCustom'));
    await user.click(screen.getByRole('switch', { name: 'settings.kiBuddyModel.manual' }));
    await fillCreate(user);
    await user.click(screen.getByText('hide'));
    await settleDetection();
    await user.click(screen.getByText('open'));
    await settleDetection();
    expect([mocks.fetch.mock.calls, mocks.detect.mock.calls]).toEqual([[], []]);
  });

  it('restores discovery when a saved manual connection is changed to automatic mode', async () => {
    const user = userEvent.setup();
    const data = provider({ manual: true });
    render(wrap(<EditModeModal data={data} modalProps={{ visible: true }} modalCtrl={{ close }} onChange={submit} />));
    await user.click(screen.getByRole('switch', { name: 'settings.kiBuddyModel.manual' }));
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalled());
    await user.click(screen.getByText('common.save'));
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith(
        expect.objectContaining({ is_full_url: false, testOnlySettings: { manual: false } })
      )
    );
  });

  it('discards the private URL from a cancelled manual edit before restoring discovery', async () => {
    const user = userEvent.setup();
    const data = { ...provider(), is_full_url: false };
    function Host() {
      const [modal, context] = EditModeModal.useModal({ data, onChange: submit });
      return (
        <>
          <button onClick={() => modal.open()}>open</button>
          <button onClick={() => modal.close()}>hide</button>
          {context}
        </>
      );
    }
    render(wrap(<Host />));
    await user.click(screen.getByText('open'));
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalled());
    await user.click(screen.getByRole('switch', { name: 'settings.kiBuddyModel.manual' }));
    const url = screen.getByDisplayValue(data.base_url);
    await user.clear(url);
    await user.type(url, 'https://example.invalid/cancelled-private-chat');
    await user.click(screen.getByText('hide'));
    await user.click(screen.getByText('open'));
    await settleDetection();
    expect(screen.getByDisplayValue(data.base_url)).toBeInTheDocument();
    expect(
      mocks.fetch.mock.calls.every(([request]) => request.base_url !== 'https://example.invalid/cancelled-private-chat')
    ).toBe(true);
  });
});

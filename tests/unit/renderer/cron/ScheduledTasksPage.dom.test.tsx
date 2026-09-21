import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Message } from '@arco-design/web-react';
import type { ICronJob } from '@/common/adapter/ipcBridge';

const mocks = vi.hoisted(() => ({
  jobs: [] as ICronJob[],
  navigate: vi.fn(),
  pause: vi.fn().mockResolvedValue(undefined),
  resume: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { error?: string }) => (options?.error ? `${key}: ${options.error}` : key),
    i18n: { language: 'en-US' },
  }),
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('@renderer/hooks/context/LayoutContext', () => ({ useLayoutContext: () => ({ isMobile: false }) }));
vi.mock('@renderer/pages/cron/useCronJobs', () => ({
  useAllCronJobs: () => ({ jobs: mocks.jobs, loading: false, pauseJob: mocks.pause, resumeJob: mocks.resume }),
}));
vi.mock('@/common/config/configService', () => ({ configService: { get: () => false, setLocal: vi.fn() } }));
vi.mock('@/common/adapter/ipcBridge', () => ({ systemSettings: { setKeepAwake: { invoke: vi.fn() } } }));
vi.mock('@renderer/pages/conversation/hooks/useConversationAssistants', () => ({
  useConversationAssistants: () => ({ presetAssistants: [] }),
}));
vi.mock('@renderer/utils/model/agentLogo', () => ({ useAgentLogos: () => ({}), resolveAgentLogo: () => null }));
vi.mock('@/renderer/pages/cron/ScheduledTasksPage/CreateTaskDialog', () => ({ default: () => null }));
vi.mock('@/renderer/components/base/TalkToButlerButton', () => ({ default: () => null }));
vi.mock('@/renderer/components/base', () => ({ AionSearchInput: () => null }));
vi.mock('@/renderer/pages/settings/components/SettingsPageHeader', () => ({ default: () => null }));

import ScheduledTasksPage from '@/renderer/pages/cron/ScheduledTasksPage';

function job(overrides: Partial<ICronJob> = {}): ICronJob {
  return {
    id: 'job-1',
    name: 'Daily report',
    enabled: true,
    schedule: { kind: 'cron', expr: '0 9 * * *', description: 'Daily' },
    target: { payload: { kind: 'message', text: 'Report' } },
    metadata: { conversation_id: 'conv-1', agent_type: 'acp', created_by: 'user', created_at: 1, updated_at: 1 },
    state: {
      last_status: 'error',
      last_error: 'Permission denied',
      run_count: 1,
      retry_count: 0,
      max_retries: 0,
      queue_enabled: false,
    },
    ...overrides,
  };
}
function renderJob(value: ICronJob) {
  mocks.jobs = [value];
  return render(<ScheduledTasksPage />);
}

describe('scheduled task failure details', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Message, 'success').mockImplementation(() => undefined);
    vi.spyOn(Message, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it.each(['scheduled', 'manual', 'paused'] as const)(
    'exposes the %s task error through a native title without a failure overlay',
    async (mode) => {
      const value = job();
      if (mode === 'manual') value.schedule = { kind: 'cron', expr: '', description: 'Manual' };
      if (mode === 'paused' || mode === 'manual') value.enabled = false;
      renderJob(value);
      const details = screen.getByTitle('cron.lastErrorWithDetail: Permission denied');
      expect(screen.getByText(mode === 'paused' ? 'cron.status.paused' : 'cron.status.error')).toBeInTheDocument();
      fireEvent.mouseEnter(details);
      fireEvent.mouseOver(details);
      fireEvent.click(details);
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(document.querySelector('.arco-tooltip')).not.toBeInTheDocument();
      expect(mocks.navigate).not.toHaveBeenCalled();
      fireEvent.mouseLeave(details);
    }
  );

  it.each(['error', 'missed'] as const)('provides a generic failure hint when %s has no error detail', (status) => {
    const value = job();
    value.state.last_status = status;
    delete value.state.last_error;
    renderJob(value);
    expect(screen.getByTitle('cron.status.error')).toBeInTheDocument();
  });

  it('keeps switching and row navigation independent from error details', async () => {
    renderJob(job());
    fireEvent.click(screen.getByTitle('cron.lastErrorWithDetail: Permission denied'));
    fireEvent.click(screen.getAllByRole('switch')[1]);
    await waitFor(() => expect(mocks.pause).toHaveBeenCalledWith('job-1'));
    expect(mocks.navigate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Daily report'));
    expect(mocks.navigate).toHaveBeenCalledWith('/scheduled/job-1');
  });

  it('allows hovering the failure hint without throwing or opening an overlay', async () => {
    renderJob(job());
    const details = screen.getByLabelText('cron.lastErrorWithDetail: Permission denied');
    fireEvent.mouseEnter(details);
    fireEvent.mouseOver(details);
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(document.querySelector('.arco-tooltip')).not.toBeInTheDocument();
    expect(screen.getByText('Daily report')).toBeInTheDocument();
  });

  it('does not expose stale errors for a successful manual task', () => {
    const value = job({ schedule: { kind: 'cron', expr: '', description: 'Manual' } });
    value.state.last_status = 'ok';
    renderJob(value);
    expect(screen.queryByText('cron.status.error')).not.toBeInTheDocument();
    expect(screen.queryByTitle('cron.lastErrorWithDetail: Permission denied')).not.toBeInTheDocument();
    expect(screen.getAllByRole('switch')).toHaveLength(1);
  });
});

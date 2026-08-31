/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// Hook Sentry IPC so the renderer SDK uses ipcRenderer.send instead of falling
// back to fetch('sentry-ipc://...'), which floods the DevTools Network panel.
// Bundled into this preload via `externalizeDepsPlugin({ exclude: [...] })` so
// Electron's sandbox-mode preload doesn't try to resolve it from node_modules.
import '@sentry/electron/preload';
import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { ADAPTER_BRIDGE_EVENT_KEY } from '../common/adapter/constant';
import { KI_BUDDY_CORE_TRANSPORT_CHANNEL, KI_BUDDY_PRODUCT_BOOTSTRAP_CHANNEL } from '@/common/platform/ki-buddy';
import type { KiBuddyProductBootstrap } from '@/common/types/platform/kiBuddyProduct';
import { KI_BUDDY_AUTH_CHANNELS } from '@/common/platform/kiBuddyAuth';
import type { KiBuddyAuthApi } from '@/common/types/platform/kiBuddyAuth';

const productBootstrap = ipcRenderer.sendSync(KI_BUDDY_PRODUCT_BOOTSTRAP_CHANNEL) as KiBuddyProductBootstrap;
const productIntegrityOnly = productBootstrap.status === 'invalid';
const kiBuddyRuntimeReady = productBootstrap.status === 'ready';
const kiBuddyAgentsIdentityReady = kiBuddyRuntimeReady && productBootstrap.identityMode === 'agents';
const coreCsrfToken = kiBuddyAgentsIdentityReady
  ? (ipcRenderer.sendSync(KI_BUDDY_CORE_TRANSPORT_CHANNEL) as string | null)
  : null;
const kiBuddyAuthCapability = kiBuddyAgentsIdentityReady
  ? {
      kiBuddyAuth: {
        getSession: () => ipcRenderer.invoke(KI_BUDDY_AUTH_CHANNELS.getSession),
        login: (request: Parameters<KiBuddyAuthApi['login']>[0]) =>
          ipcRenderer.invoke(KI_BUDDY_AUTH_CHANNELS.login, request),
        logout: () => ipcRenderer.invoke(KI_BUDDY_AUTH_CHANNELS.logout),
        onSessionInvalidated: (listener: () => void) => {
          const handler = () => listener();
          ipcRenderer.on(KI_BUDDY_AUTH_CHANNELS.sessionInvalidated, handler);
          return () => ipcRenderer.off(KI_BUDDY_AUTH_CHANNELS.sessionInvalidated, handler);
        },
      } satisfies KiBuddyAuthApi,
      ...(coreCsrfToken ? { kiBuddyCoreTransport: { csrfToken: coreCsrfToken } } : {}),
    }
  : {};
contextBridge.exposeInMainWorld('__getKiBuddyProductBootstrap', () => productBootstrap);

/**
 * @description 注入到renderer进程中, 用于与main进程通信
 * */
contextBridge.exposeInMainWorld('electronAPI', {
  emit: (name: string, data: unknown) => {
    return ipcRenderer
      .invoke(
        ADAPTER_BRIDGE_EVENT_KEY,
        JSON.stringify({
          name: name,
          data: data,
        })
      )
      .catch((error) => {
        console.error('IPC invoke error:', error);
        throw error;
      });
  },
  on: (callback: (payload: { event: unknown; value: unknown }) => void) => {
    const handler = (event: unknown, value: unknown) => {
      callback({ event, value });
    };
    ipcRenderer.on(ADAPTER_BRIDGE_EVENT_KEY, handler);
    return () => {
      ipcRenderer.off(ADAPTER_BRIDGE_EVENT_KEY, handler);
    };
  },
  // 获取拖拽文件/目录的绝对路径 / Get absolute path for dragged file/directory
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  // Feedback: collect and compress recent log files
  collectFeedbackLogs: () => ipcRenderer.invoke('feedback:collect-logs'),
  // Feedback: capture a screenshot of the current window
  captureFeedbackScreenshot: () => ipcRenderer.invoke('feedback:capture-screenshot'),
  // Feedback: forward diagnostics logs to the main process console
  logFeedbackEvent: (payload: { details?: unknown; level: 'info' | 'warn' | 'error'; message: string }) =>
    ipcRenderer.send('feedback:renderer-log', payload),
  recoverCorruptedDatabase: () => ipcRenderer.invoke('backend:recover-corrupted-database'),
  ...kiBuddyAuthCapability,
});

// Synchronously fetch the aioncore port and expose it to the renderer
// via contextBridge (direct window assignment is invisible under contextIsolation).
const backendPort = productIntegrityOnly ? 0 : (ipcRenderer.sendSync('get-backend-port') as number);
const initialLanguage = productIntegrityOnly ? null : (ipcRenderer.sendSync('get-initial-language') as string | null);
const backendStartupFailed = productIntegrityOnly
  ? false
  : (ipcRenderer.sendSync('get-backend-startup-failed') as boolean);
const backendStartupFailure = productIntegrityOnly
  ? null
  : (ipcRenderer.sendSync('get-backend-startup-failure') as unknown);
contextBridge.exposeInMainWorld('__backendPort', backendPort > 0 ? backendPort : 0);
contextBridge.exposeInMainWorld('__initialLanguage', initialLanguage ?? null);
contextBridge.exposeInMainWorld('__aionuiE2ETest', process.env.AIONUI_E2E_TEST === '1');
contextBridge.exposeInMainWorld('__backendStartupFailed', backendStartupFailed === true);
contextBridge.exposeInMainWorld('__backendStartupFailure', backendStartupFailure ?? null);

// Backend startup state bridge: `getState` re-reads the current failure info on
// mount (resolves the "READY arrived before the renderer subscribed" race), and
// `subscribe` receives subsequent ready/exit pushes on the backend-startup-state
// channel. All communication stays behind the preload contextBridge.
contextBridge.exposeInMainWorld('__backendStartupBridge', {
  getState: () => (productIntegrityOnly ? null : ipcRenderer.sendSync('get-backend-startup-failure')),
  subscribe: (callback: (state: unknown) => void) => {
    if (productIntegrityOnly) return () => {};
    const handler = (_event: unknown, value: unknown) => callback(value);
    ipcRenderer.on('backend-startup-state', handler);
    return () => {
      ipcRenderer.off('backend-startup-state', handler);
    };
  },
});

// 托盘事件监听 - 将 IPC 事件转换为 DOM 事件
// Tray event listeners - convert IPC events to DOM events
const trayEvents = [
  'tray:navigate-to-guid',
  'tray:navigate-to-conversation',
  'tray:open-about',
  'tray:pause-all-tasks',
  'tray:check-update',
];

if (!productIntegrityOnly) {
  for (const channel of trayEvents) {
    ipcRenderer.on(channel, (_event, ...args) => {
      window.dispatchEvent(new CustomEvent(channel, { detail: args[0] }));
    });
  }
}

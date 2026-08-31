import { app, BrowserWindow, ipcMain, session } from 'electron';
import { KI_BUDDY_AUTH_CHANNELS } from '@/common/platform/kiBuddyAuth';
import type { KiBuddyLoginRequest, KiBuddyLoginResult } from '@/common/types/platform/kiBuddyAuth';
import { AgentsAuthService } from './AgentsAuthService';
import { createAgentsNetworkFetch } from './agents/networkClient';
import { KeytarCredentialStore } from './CredentialStore';
import type { KiBuddyMainCoreTransport } from './KiBuddyMainCoreTransport';

type RegisterKiBuddyAuthOptions = {
  bootstrapSecret: string;
  coreTransport: KiBuddyMainCoreTransport;
  credentialStorageNamespace?: string;
  getCoreBaseUrl: () => string;
  onSessionAuthenticated?: (coreUserId: string) => void;
};

type KiBuddyBackendMigrationSchedulerOptions = Readonly<{
  isReady: () => boolean;
  onError: (error: unknown) => void;
  run: () => Promise<void>;
}>;

export type KiBuddyBackendMigrationScheduler = Readonly<{
  trigger: (coreUserId?: string) => void;
}>;

const CORE_SESSION_COOKIE = 'aionui-session';
const CORE_CSRF_COOKIE = 'aionui-csrf-token';
const SESSION_VALIDATION_INTERVAL_MS = 60_000;
const DEFAULT_MIGRATION_KEY = Symbol('default-ki-buddy-backend-migration');

/** Coordinates backend migrations across Ki-Buddy account activation and replacement. */
export function createKiBuddyBackendMigrationScheduler(
  options: KiBuddyBackendMigrationSchedulerOptions
): KiBuddyBackendMigrationScheduler {
  type MigrationKey = string | typeof DEFAULT_MIGRATION_KEY;
  const completedKeys = new Set<MigrationKey>();
  let queuedKey: MigrationKey | null = null;
  let runningKey: MigrationKey | null = null;
  let runningSuperseded = false;

  const schedule = (key: MigrationKey): void => {
    if (!options.isReady() || completedKeys.has(key)) return;
    if (runningKey !== null) {
      if (key !== runningKey) runningSuperseded = true;
      queuedKey = key;
      return;
    }
    runningKey = key;
    runningSuperseded = false;
    void options
      .run()
      .then(() => {
        if (!runningSuperseded) completedKeys.add(key);
      })
      .catch((error: unknown) => {
        options.onError(error);
      })
      .finally(() => {
        runningKey = null;
        runningSuperseded = false;
        const nextKey = queuedKey;
        queuedKey = null;
        if (nextKey !== null && !completedKeys.has(nextKey)) schedule(nextKey);
      });
  };

  return { trigger: (coreUserId?: string) => schedule(coreUserId ?? DEFAULT_MIGRATION_KEY) };
}

function isLoginRequest(value: unknown): value is KiBuddyLoginRequest {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.baseUrl === 'string' && typeof record.loginName === 'string' && typeof record.password === 'string'
  );
}

function notifySessionInvalidated(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(KI_BUDDY_AUTH_CHANNELS.sessionInvalidated);
  }
}

function scheduleSessionValidation(validate: () => Promise<void>): () => void {
  const timer = setInterval(() => {
    void validate().catch(() => console.warn('[Ki-Buddy Auth] Periodic token validation failed'));
  }, SESSION_VALIDATION_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}

async function setCoreSessionCookie(
  coreBaseUrl: string,
  coreTransport: KiBuddyMainCoreTransport,
  header: string
): Promise<void> {
  const [nameValue, ...attributes] = header.split(';').map((part) => part.trim());
  const separator = nameValue.indexOf('=');
  if (separator <= 0) throw new Error('Core returned an invalid session cookie');
  const name = nameValue.slice(0, separator);
  if (name !== CORE_SESSION_COOKIE) throw new Error('Core returned an unexpected session cookie');
  const value = decodeURIComponent(nameValue.slice(separator + 1));
  const maxAge = attributes
    .map((attribute) => /^Max-Age=(\d+)$/i.exec(attribute))
    .find((match): match is RegExpExecArray => match !== null);

  const cookieWrites = [
    session.defaultSession.cookies.set({
      url: coreBaseUrl,
      name,
      value,
      path: '/',
      httpOnly: true,
      sameSite: 'no_restriction',
      secure: true,
      ...(maxAge ? { expirationDate: Date.now() / 1000 + Number(maxAge[1]) } : {}),
    }),
    session.defaultSession.cookies.set({
      url: coreBaseUrl,
      name: CORE_CSRF_COOKIE,
      value: coreTransport.csrfToken,
      path: '/',
      httpOnly: false,
      sameSite: 'no_restriction',
      secure: true,
    }),
  ];
  try {
    await Promise.all(cookieWrites);
  } catch (error) {
    await Promise.allSettled(cookieWrites);
    await clearCoreSession(coreBaseUrl, coreTransport);
    throw error;
  }
  coreTransport.setAccessToken(value);
}

async function clearCoreSession(coreBaseUrl: string, coreTransport: KiBuddyMainCoreTransport): Promise<void> {
  coreTransport.clearAccessToken();
  await Promise.allSettled([
    session.defaultSession.cookies.remove(coreBaseUrl, CORE_SESSION_COOKIE),
    session.defaultSession.cookies.remove(coreBaseUrl, CORE_CSRF_COOKIE),
  ]);
}

/** Registers the dedicated Ki-Buddy authentication IPC handlers in the main process. */
export function registerKiBuddyAuthBridge(options: RegisterKiBuddyAuthOptions): AgentsAuthService {
  const service = new AgentsAuthService({
    agentsFetch: createAgentsNetworkFetch(),
    bootstrapSecret: options.bootstrapSecret,
    clearCoreSession: () => clearCoreSession(options.getCoreBaseUrl(), options.coreTransport),
    credentialStore: new KeytarCredentialStore(app.getPath('userData'), {
      storageNamespace: options.credentialStorageNamespace,
    }),
    fetch,
    getCoreBaseUrl: options.getCoreBaseUrl,
    onSessionActivated: options.onSessionAuthenticated,
    onSessionInvalidated: notifySessionInvalidated,
    scheduleSessionValidation,
    setCoreSessionCookie: (header) => setCoreSessionCookie(options.getCoreBaseUrl(), options.coreTransport, header),
  });

  ipcMain.handle(KI_BUDDY_AUTH_CHANNELS.getSession, () => service.getSession());
  ipcMain.handle(KI_BUDDY_AUTH_CHANNELS.login, (_event, request: unknown): Promise<KiBuddyLoginResult> => {
    if (!isLoginRequest(request)) {
      return Promise.resolve({ success: false, code: 'contractError' });
    }
    return service.login(request);
  });
  ipcMain.handle(KI_BUDDY_AUTH_CHANNELS.logout, () => service.logout());
  return service;
}

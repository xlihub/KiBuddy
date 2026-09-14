import { createServer as createHttpServer } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, mkdir, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';

export async function until<T>(check: () => Promise<T | undefined>, timeout = 60000): Promise<T> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      const value = await check();
      if (value !== undefined) return value;
    } catch {
      /* Startup and in-flight reads may not be ready yet. */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Local Core verification timed out');
}

/** Isolated real Core and external model mock; no accounts, user data or customer network. */
export async function createCoreHarness(binary: string) {
  const root = await mkdtemp(join(tmpdir(), 'ki-buddy-core-integration-'));
  const workspace = join(root, 'workspace');
  await mkdir(workspace);
  const marker = `REAL_READ_${Date.now()}`;
  await writeFile(join(workspace, 'proof.txt'), marker);
  let proxyRequests = 0;
  const proxy = createHttpServer((_request, response) => {
    proxyRequests++;
    response.writeHead(403);
    response.end('Synthetic proxy rejection');
  });
  const proxyPort = await new Promise<number>((resolve) =>
    proxy.listen(0, '127.0.0.1', () => {
      const address = proxy.address();
      if (!address || typeof address === 'string') throw new Error('No proxy port');
      resolve(address.port);
    })
  );
  let proxyEnabled = false;
  const logs: ReturnType<typeof createWriteStream>[] = [];
  const processes: ChildProcess[] = [];
  const start = (command: string, args: string[], name: string) => {
    const log = createWriteStream(join(root, name), { flags: 'a' });
    logs.push(log);
    const child = spawn(command, args, {
      env: {
        ...process.env,
        ...(proxyEnabled
          ? {
              HTTP_PROXY: `http://127.0.0.1:${proxyPort}`,
              http_proxy: `http://127.0.0.1:${proxyPort}`,
              HTTPS_PROXY: `http://127.0.0.1:${proxyPort}`,
              https_proxy: `http://127.0.0.1:${proxyPort}`,
              ALL_PROXY: '',
              all_proxy: '',
              NO_PROXY: '',
              no_proxy: '',
            }
          : {}),
        AIONUI_BUNDLED_MANAGED_RESOURCES: resolvePath('resources/bundled-aioncore/darwin-arm64/managed-resources'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout!.pipe(log);
    child.stderr!.pipe(log);
    processes.push(child);
    return child;
  };
  const stop = async (child: ChildProcess) => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      child.once('exit', () => resolve());
      child.kill('SIGINT');
    });
  };
  const stopAll = async () => {
    for (const child of [...processes].toReversed()) await stop(child);
    for (const log of logs) log.end();
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
  };
  try {
    const ready = join(root, 'mock-ready.json');
    start(
      'python3',
      [
        'distributions/mock/kiBuddyZxjtServer.py',
        '--port',
        '0',
        '--ready-file',
        ready,
        '--record',
        join(root, 'requests.jsonl'),
      ],
      'mock.log'
    );
    const mock = await until(
      async () => JSON.parse(await readFile(ready, 'utf8')) as { port: number; url: string; model: string }
    );
    const port = await new Promise<number>((resolve) => {
      const server = createServer();
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('No test port');
        server.close(() => resolve(address.port));
      });
    });
    const base = `http://127.0.0.1:${port}`;
    const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
      const response = await fetch(base + path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!response.ok) throw new Error(`Core ${method} ${path}: ${response.status}`);
      const json = await response.json();
      return (json.data ?? json) as T;
    };
    const args = [
      '--local',
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--data-dir',
      join(root, 'data'),
      '--work-dir',
      workspace,
      '--managed-resources-mode',
      'bundled',
    ];
    const startCore = async () => {
      const child = start(binary, args, 'core.log');
      await until(() => call('GET', '/api/providers'));
      return child;
    };
    let core = await startCore();
    type Record = {
      method: string;
      routeMatched: boolean;
      bearerPresent: boolean;
      authMatches: { appId: boolean; secretKey: boolean; apikey: boolean };
      optionPresence: { stream_options: boolean };
      completed: boolean;
      responseKind: string;
    };
    const records = async (): Promise<Record[]> =>
      (await (await fetch(`http://127.0.0.1:${mock.port}/__mock/requests`)).json()).requests;
    return {
      root,
      port,
      mock,
      call,
      records,
      workspace,
      marker,
      stopAll,
      proxyCount: () => proxyRequests,
      enableProxy: () => {
        proxyEnabled = true;
      },
      restart: async () => {
        await stop(core);
        core = await startCore();
      },
    };
  } catch (error) {
    await stopAll();
    throw error;
  }
}

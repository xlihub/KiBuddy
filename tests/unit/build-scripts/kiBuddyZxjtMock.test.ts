import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

it('reproduces zxjt gateway responses and rejects invalid tool roundtrips over HTTP', async () => {
  const { stderr } = await promisify(execFile)(
    process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3'),
    [resolve('tests/unit/build-scripts/kiBuddyZxjtMockTest.py')],
    { timeout: 30000 }
  );
  expect(stderr).toContain('OK');
}, 35000);

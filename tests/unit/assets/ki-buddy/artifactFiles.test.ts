import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const { listFilesRecursively, requireSinglePath } = require('../../../../packages/shared-scripts/src/artifactFiles');

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function createFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'artifact-files-'));
  temporaryDirectories.push(root);
  mkdirSync(join(root, 'nested'));
  writeFileSync(join(root, 'root.exe'), 'root');
  writeFileSync(join(root, 'nested', 'evidence.json'), 'nested');
  return root;
}

describe('artifact file discovery', () => {
  it('lists every nested artifact file', () => {
    const root = createFixture();

    expect(
      listFilesRecursively(root)
        .map((filePath: string) => filePath.slice(root.length + 1))
        .toSorted()
    ).toEqual([join('nested', 'evidence.json'), 'root.exe']);
  });

  it('requires exactly one matching artifact path', () => {
    expect(requireSinglePath(['/tmp/package.exe'], 'Windows installer')).toBe('/tmp/package.exe');
    expect(() => requireSinglePath([], 'Windows installer')).toThrowError(
      /Windows installer must resolve to exactly one path/
    );
    expect(() => requireSinglePath(['/tmp/a.exe', '/tmp/b.exe'], 'Windows installer')).toThrowError(
      /Windows installer must resolve to exactly one path/
    );
  });
});

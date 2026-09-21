import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UpdateInfo } from 'builder-util-runtime';
import type { AppUpdater } from 'electron-updater/out/AppUpdater';
import { GitHubProvider } from 'electron-updater/out/providers/GitHubProvider';
import type { ProviderRuntimeOptions } from 'electron-updater/out/providers/Provider';
import { KiBuddyGitHubProvider } from '@/process/ki-buddy/update/githubUpdateProvider';

const makeUpdateInfo = (tag: string): UpdateInfo & { tag: string } => ({
  files: [],
  path: '',
  releaseDate: '2026-08-16T00:00:00.000Z',
  sha512: '',
  tag,
  version: '9.9.9',
});

const makeProvider = (): KiBuddyGitHubProvider =>
  new KiBuddyGitHubProvider(
    {
      owner: 'xlihub',
      provider: 'custom',
      repo: 'KiBuddy',
      tagPrefix: 'ki-buddy-v',
    },
    {} as AppUpdater,
    {
      executor: {},
      isUseMultipleRangeRequest: false,
      platform: 'darwin',
    } as ProviderRuntimeOptions
  );

describe('KiBuddyGitHubProvider', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts a release that uses the product tag prefix', async () => {
    vi.spyOn(GitHubProvider.prototype, 'getLatestVersion').mockResolvedValue(makeUpdateInfo('ki-buddy-v9.9.9'));

    await expect(makeProvider().getLatestVersion()).resolves.toMatchObject({ tag: 'ki-buddy-v9.9.9' });
  });

  it.each(['v99.0.0', '99.0.0'])('rejects a release outside the product tag namespace: %s', async (tag) => {
    vi.spyOn(GitHubProvider.prototype, 'getLatestVersion').mockResolvedValue(makeUpdateInfo(tag));

    await expect(makeProvider().getLatestVersion()).rejects.toThrow(
      'GitHub release tag does not match the configured product prefix: ki-buddy-v'
    );
  });
});

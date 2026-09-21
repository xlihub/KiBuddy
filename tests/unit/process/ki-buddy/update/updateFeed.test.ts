import { describe, expect, it } from 'vitest';
import { KiBuddyGitHubProvider } from '@/process/ki-buddy/update/githubUpdateProvider';
import {
  createKiBuddyUpdateBridgeConfiguration,
  createKiBuddyUpdateFeedConfiguration,
} from '@/process/ki-buddy/update/updateFeed';
import { KI_BUDDY_PRODUCT_CONFIG_RESULT } from '@/common/platform/ki-buddy';

const productConfig = KI_BUDDY_PRODUCT_CONFIG_RESULT.config!;

describe('Ki-Buddy update feed', () => {
  it('uses the product-owned custom provider and tag namespace', () => {
    expect(createKiBuddyUpdateFeedConfiguration(productConfig)).toEqual({
      feedOptions: {
        owner: 'xlihub',
        provider: 'custom',
        repo: 'KiBuddy',
        tagPrefix: 'ki-buddy-v',
        updateProvider: KiBuddyGitHubProvider,
      },
      label: 'Ki-Buddy GitHub provider',
      updaterCacheDirName: 'com.xlihub.ki-buddy',
    });
  });

  it('uses the same product tag namespace for manual checks', () => {
    expect(createKiBuddyUpdateBridgeConfiguration(productConfig)).toMatchObject({
      allowRepositoryOverride: false,
      repository: 'xlihub/KiBuddy',
      tagPrefix: 'ki-buddy-v',
    });
  });
});

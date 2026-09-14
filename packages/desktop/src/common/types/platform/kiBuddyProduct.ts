import type {
  KiBuddyDistributionIdentityMode,
  KiBuddyProductConfig,
  KiBuddyModelPreset,
  KiBuddyProductIntegration,
} from '@/common/platform/ki-buddy/productConfig';
import type { DeepReadonly } from '@/common/platform/ki-buddy/experience';

export type KiBuddyProductCapability = DeepReadonly<{
  assets: KiBuddyProductConfig['assets']['renderer'];
  brand: KiBuddyProductConfig['brand'];
  id: 'ki-buddy';
  modelPreset?: KiBuddyModelPreset;
  integrations: readonly KiBuddyProductIntegration[];
  experience: KiBuddyProductConfig['experience'];
  locale: KiBuddyProductConfig['locale'];
  schemaVersion: 4;
  themes: KiBuddyProductConfig['themes'];
}>;

export type KiBuddyProductBootstrap =
  | Readonly<{ capability: null; error: null; productIdentity: null; status: 'absent' }>
  | Readonly<{ capability: null; error: string; productIdentity: 'ki-buddy'; status: 'invalid' }>
  | Readonly<{
      capability: KiBuddyProductCapability;
      error: null;
      identityMode: KiBuddyDistributionIdentityMode;
      productIdentity: 'ki-buddy';
      status: 'ready';
    }>;

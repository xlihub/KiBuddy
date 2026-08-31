import type { KiBuddyProductCapability } from '@/common/types/platform/kiBuddyProduct';
import { KI_BUDDY_PRODUCT_CONFIG_RESULT, type KiBuddyProductConfig } from './productConfig';
import { deepFreeze } from './experience';

/** Serializable renderer capability for the configured Ki-Buddy product runtime. */
export function createKiBuddyProductCapability(config: KiBuddyProductConfig): KiBuddyProductCapability {
  return deepFreeze({
    id: 'ki-buddy',
    schemaVersion: 4,
    integrations: config.distribution?.integrations ?? ['agentsGateway'],
    brand: config.brand,
    assets: config.assets.renderer,
    locale: config.locale,
    themes: config.themes,
    experience: config.experience,
  });
}

export const KI_BUDDY_PRODUCT_CAPABILITY = KI_BUDDY_PRODUCT_CONFIG_RESULT.config
  ? createKiBuddyProductCapability(KI_BUDDY_PRODUCT_CONFIG_RESULT.config)
  : null;

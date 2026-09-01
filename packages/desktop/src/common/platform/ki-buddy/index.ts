export {
  KI_BUDDY_DEFAULT_AGENTS_BASE_URL,
  KI_BUDDY_DEFAULT_LANGUAGE,
  resolveLanguagePreference,
} from './productDefaults';
export { normalizeAgentsBaseUrl } from './deploymentUrl';
export { resolveKiBuddyRuntimeIdentity } from './runtimeIdentity';
export { applyKiBuddyLocaleOverlay } from './localeOverlay';
export { KI_BUDDY_PRODUCT_CAPABILITY, createKiBuddyProductCapability } from './productCapability';
export {
  KI_BUDDY_PRODUCT_CONFIG_RESULT,
  KI_BUDDY_PRODUCT_RUNTIME,
  loadKiBuddyProductConfig,
  parseKiBuddyProductConfig,
} from './productConfig';
export {
  PRODUCT_FEATURE_IDS,
  PRODUCT_FEATURE_DEPENDENCIES,
  PRODUCT_RESOURCE_KINDS,
  PRODUCT_RESOURCE_ORIGINS,
  createAionUiProductExperience,
  createKiBuddyProductExperience,
  deepFreeze,
  evaluateProductBuiltinResourceState,
  isProductFeatureEnabled,
  parseProductExperiencePolicy,
  projectProductResources,
} from './experience';
export type {
  DeepReadonly,
  ProductBehaviorDefaults,
  ProductExperience,
  ProductExperienceSnapshot,
  ProductFeatureId,
  ProductFeatureState,
  ProductResourceAccess,
  ProductResourceKind,
  ProductResourceOrigin,
  ProductResourceDescriptor,
  ProductResourceHiddenRecord,
  ProductResourceProjection,
  ProductBuiltinResourceRequirement,
  ProductBuiltinResourceState,
  MissingProductBuiltinResourceRecord,
} from './experience';
export {
  KI_BUDDY_CORE_TRANSPORT_CHANNEL,
  KI_BUDDY_PRODUCT_BOOTSTRAP_CHANNEL,
  isKiBuddyCoreSafeMethod,
} from './channels';
export type { KiBuddyProductConfig, KiBuddyProductConfigLoadResult, KiBuddyProductIntegration } from './productConfig';

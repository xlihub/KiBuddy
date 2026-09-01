import productExperienceRegistry from './registry.json';

export type ProductFeatureId = keyof typeof productExperienceRegistry.features;
export type ProductFeatureState = 'enabled' | 'disabled';
export type ProductResourceKind = keyof typeof productExperienceRegistry.resourceKinds;
export type ProductResourceOrigin = keyof typeof productExperienceRegistry.resourceOrigins;
export type ProductResourceAccess = 'hidden' | 'use' | 'manage';
export type ScheduledTaskExecutorDefault = 'assistant' | 'assistant-or-team';

export const PRODUCT_FEATURE_IDS = Object.freeze(Object.keys(productExperienceRegistry.features) as ProductFeatureId[]);
export const PRODUCT_RESOURCE_KINDS = Object.freeze(
  Object.keys(productExperienceRegistry.resourceKinds) as ProductResourceKind[]
);
export const PRODUCT_RESOURCE_ORIGINS = Object.freeze(
  Object.keys(productExperienceRegistry.resourceOrigins) as ProductResourceOrigin[]
);
export const PRODUCT_FEATURE_DEPENDENCIES = Object.freeze(
  Object.entries(productExperienceRegistry.features).flatMap(([featureId, definition]) =>
    definition.dependsOn.map((parentId) => [featureId as ProductFeatureId, parentId as ProductFeatureId] as const)
  )
);

export type DeepReadonly<T> = T extends readonly (infer Item)[]
  ? readonly DeepReadonly<Item>[]
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T;

export type ProductBehaviorDefaults = Readonly<{
  autoInjectedSkillExclusions: readonly string[];
  scheduledTaskExecutor: ScheduledTaskExecutorDefault;
}>;

export type ProductExperienceSnapshot = Readonly<{
  behaviorDefaults: ProductBehaviorDefaults;
  features: Readonly<Record<ProductFeatureId, ProductFeatureState>>;
  resources: Readonly<Record<ProductResourceKind, Readonly<Record<ProductResourceOrigin, ProductResourceAccess>>>>;
  schemaVersion: 1;
}>;

export type ProductExperience = Readonly<{
  behaviorDefaults: () => ProductBehaviorDefaults;
  featureState: (featureId: ProductFeatureId) => ProductFeatureState;
  resourceAccess: (kind: ProductResourceKind, origin: ProductResourceOrigin) => ProductResourceAccess;
}>;

/** Preserves upstream behavior when no product policy exists. */
export function isProductFeatureEnabled(
  experience: ProductExperience | null | undefined,
  featureId: ProductFeatureId
): boolean {
  return !experience || experience.featureState(featureId) === 'enabled';
}

export type ProductResourceDescriptor = Readonly<{
  id: string;
  name?: string;
  origin: ProductResourceOrigin;
}>;

export type ProductResourceHiddenRecord = Readonly<{
  access: 'hidden';
  code: 'product_resource_hidden';
  kind: ProductResourceKind;
  origin: ProductResourceOrigin;
  resourceId: string;
  resourceName?: string;
}>;

export type ProductResourceProjection<Resource extends ProductResourceDescriptor> = Readonly<{
  hidden: readonly ProductResourceHiddenRecord[];
  visible: ReadonlyArray<Readonly<{ access: Exclude<ProductResourceAccess, 'hidden'>; resource: Resource }>>;
}>;

export type ProductBuiltinResourceRequirement = Readonly<{
  featureId: ProductFeatureId;
  resourceId: string;
  resourceName?: string;
}>;

export type MissingProductBuiltinResourceRecord = Readonly<{
  code: 'required_product_resource_missing';
  featureId: ProductFeatureId;
  kind: ProductResourceKind;
  origin: 'productBuiltin';
  resourceId: string;
  resourceName?: string;
}>;

export type ProductBuiltinResourceState =
  | Readonly<{ missing: readonly []; status: 'pending' | 'ready' }>
  | Readonly<{ missing: readonly MissingProductBuiltinResourceRecord[]; status: 'invalid' }>;

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireExactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const missing = keys.filter((key) => !(key in value));
  const unexpected = Object.keys(value).filter((key) => !keys.includes(key));
  if (missing.length === 0 && unexpected.length === 0) return;
  const details = [
    missing.length > 0 ? `missing ${missing.join(', ')}` : '',
    unexpected.length > 0 ? `unexpected ${unexpected.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('; ');
  throw new Error(`${label} has invalid fields: ${details}`);
}

function requireEnum<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new Error(`${label} must be one of ${allowed.join(', ')}`);
  }
  return value as T;
}

export function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value as DeepReadonly<T>;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value) as DeepReadonly<T>;
}

/** Strictly validates the serialized product experience snapshot shipped with Ki-Buddy. */
export function parseProductExperiencePolicy(value: unknown): ProductExperienceSnapshot {
  const policy = requireRecord(value, 'Product experience policy');
  requireExactKeys(policy, ['schemaVersion', 'features', 'resources', 'behaviorDefaults'], 'Product experience policy');
  if (policy.schemaVersion !== 1) throw new Error('Unsupported product experience policy schema');

  const rawFeatures = requireRecord(policy.features, 'Product experience features');
  requireExactKeys(rawFeatures, PRODUCT_FEATURE_IDS, 'Product experience features');
  const features = Object.fromEntries(
    PRODUCT_FEATURE_IDS.map((featureId) => [
      featureId,
      requireEnum(rawFeatures[featureId], ['enabled', 'disabled'] as const, `Product feature ${featureId}`),
    ])
  ) as Record<ProductFeatureId, ProductFeatureState>;

  for (const [child, parent] of PRODUCT_FEATURE_DEPENDENCIES) {
    if (features[child] === 'enabled' && features[parent] !== 'enabled') {
      throw new Error(`Product feature ${child} requires enabled parent ${parent}`);
    }
  }
  for (const [featureId, definition] of Object.entries(productExperienceRegistry.features)) {
    if (definition.requiredState && features[featureId as ProductFeatureId] !== definition.requiredState) {
      throw new Error(`Product feature ${featureId} must be ${definition.requiredState}`);
    }
  }

  const rawResources = requireRecord(policy.resources, 'Product experience resources');
  requireExactKeys(rawResources, PRODUCT_RESOURCE_KINDS, 'Product experience resources');
  const resources = Object.fromEntries(
    PRODUCT_RESOURCE_KINDS.map((kind) => {
      const rawAccess = requireRecord(rawResources[kind], `Product resource ${kind}`);
      requireExactKeys(rawAccess, PRODUCT_RESOURCE_ORIGINS, `Product resource ${kind}`);
      return [
        kind,
        Object.fromEntries(
          PRODUCT_RESOURCE_ORIGINS.map((origin) => [
            origin,
            requireEnum(rawAccess[origin], ['hidden', 'use', 'manage'] as const, `Product resource ${kind}.${origin}`),
          ])
        ) as Record<ProductResourceOrigin, ProductResourceAccess>,
      ];
    })
  ) as Record<ProductResourceKind, Record<ProductResourceOrigin, ProductResourceAccess>>;

  const rawDefaults = requireRecord(policy.behaviorDefaults, 'Product experience behavior defaults');
  requireExactKeys(
    rawDefaults,
    ['scheduledTaskExecutor', 'autoInjectedSkillExclusions'],
    'Product experience behavior defaults'
  );
  const rawExclusions = rawDefaults.autoInjectedSkillExclusions;
  if (
    !Array.isArray(rawExclusions) ||
    rawExclusions.some((item) => typeof item !== 'string' || item.trim() === '') ||
    new Set(rawExclusions).size !== rawExclusions.length
  ) {
    throw new Error('Product auto-injected skill exclusions must contain unique non-empty strings');
  }

  return deepFreeze({
    schemaVersion: 1,
    features,
    resources,
    behaviorDefaults: {
      scheduledTaskExecutor: requireEnum(
        rawDefaults.scheduledTaskExecutor,
        ['assistant', 'assistant-or-team'] as const,
        'Product scheduled task executor'
      ),
      autoInjectedSkillExclusions: [...rawExclusions] as string[],
    },
  });
}

function createProductExperience(snapshot: ProductExperienceSnapshot): ProductExperience {
  return Object.freeze({
    featureState: (featureId: ProductFeatureId) => snapshot.features[featureId],
    resourceAccess: (kind: ProductResourceKind, origin: ProductResourceOrigin) => snapshot.resources[kind][origin],
    behaviorDefaults: () => snapshot.behaviorDefaults,
  });
}

/** Projects a resource catalog through the active product policy without retaining resource configuration in diagnostics. */
export function projectProductResources<Resource extends ProductResourceDescriptor>(
  experience: ProductExperience,
  kind: ProductResourceKind,
  resources: readonly Resource[]
): ProductResourceProjection<Resource> {
  const visible: Array<{ access: Exclude<ProductResourceAccess, 'hidden'>; resource: Resource }> = [];
  const hidden: ProductResourceHiddenRecord[] = [];

  for (const resource of resources) {
    const access = experience.resourceAccess(kind, resource.origin);
    if (access === 'hidden') {
      hidden.push({
        code: 'product_resource_hidden',
        kind,
        resourceId: resource.id,
        resourceName: resource.name,
        origin: resource.origin,
        access,
      });
      continue;
    }
    visible.push({ resource, access });
  }

  return { visible, hidden };
}

/** Evaluates stable product resource requirements once the owning backend catalog becomes available. */
export function evaluateProductBuiltinResourceState(
  experience: ProductExperience,
  kind: ProductResourceKind,
  options: Readonly<{
    availableResourceIds: readonly string[];
    catalogReady: boolean;
    requirements: readonly ProductBuiltinResourceRequirement[];
  }>
): ProductBuiltinResourceState {
  const activeRequirements = options.requirements.filter(
    ({ featureId }) => experience.featureState(featureId) === 'enabled'
  );
  if (activeRequirements.length === 0) return { status: 'ready', missing: [] };
  if (!options.catalogReady) return { status: 'pending', missing: [] };

  const availableResourceIds = new Set(options.availableResourceIds);
  const missing = activeRequirements
    .filter(({ resourceId }) => !availableResourceIds.has(resourceId))
    .map(({ featureId, resourceId, resourceName }) => ({
      code: 'required_product_resource_missing' as const,
      featureId,
      kind,
      origin: 'productBuiltin' as const,
      resourceId,
      resourceName,
    }));

  return missing.length > 0 ? { status: 'invalid', missing } : { status: 'ready', missing: [] };
}

/** Creates the adapter for the strict, packaged Ki-Buddy policy. */
export function createKiBuddyProductExperience(value: unknown): ProductExperience {
  return createProductExperience(parseProductExperiencePolicy(value));
}

const AION_UI_BEHAVIOR_DEFAULTS = deepFreeze({
  scheduledTaskExecutor: 'assistant-or-team' as const,
  autoInjectedSkillExclusions: [] as string[],
});

/** Creates the compatibility adapter used when the Ki-Buddy product capability is absent. */
export function createAionUiProductExperience(): ProductExperience {
  return Object.freeze({
    featureState: () => 'enabled',
    resourceAccess: () => 'manage',
    behaviorDefaults: () => AION_UI_BEHAVIOR_DEFAULTS,
  });
}

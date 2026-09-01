import { ipcBridge } from '@/common';
import {
  projectProductResources,
  type KiBuddyProductIntegration,
  type ProductExperience,
  type ProductResourceAccess,
  type ProductResourceHiddenRecord,
  type ProductResourceOrigin,
} from '@/common/platform/ki-buddy';
import { reportHiddenProductResources } from './catalogs/kiBuddyProductResourceDiagnostics';
import { getKiBuddyProductRuntime, getProductExperience } from './kiBuddyRuntime';
import {
  areKiBuddyProductResourceIntegrationsEnabled,
  KI_BUDDY_PRODUCT_RESOURCE_REGISTRY,
  KI_BUDDY_PRODUCT_SKILL_NAMES,
} from './catalogs/kiBuddyResourceRegistry';

export type AvailableSkill = Awaited<ReturnType<typeof ipcBridge.fs.listAvailableSkills.invoke>>[number];

export type ProductSkillCatalogEntry = Readonly<{
  access: Exclude<ProductResourceAccess, 'hidden'>;
  origin: ProductResourceOrigin;
  resourceId: string;
  skill: AvailableSkill;
}>;

export type ProductSkillCatalog = Readonly<{
  entries: readonly ProductSkillCatalogEntry[];
  hiddenResources: readonly ProductResourceHiddenRecord[];
  visibleSkills: readonly AvailableSkill[];
}>;

const resolveSkillIdentity = (
  skill: AvailableSkill
): Readonly<{ id: string; name: string; origin: ProductResourceOrigin; skill: AvailableSkill }> => {
  if (skill.source === 'custom') {
    return { id: `custom:${skill.name}`, name: skill.name, origin: 'custom', skill };
  }
  if (skill.source === 'extension') {
    return { id: `extension:${skill.name}`, name: skill.name, origin: 'extension', skill };
  }
  if (skill.source === 'builtin') {
    const origin = KI_BUDDY_PRODUCT_SKILL_NAMES.has(skill.name) ? 'productBuiltin' : 'upstreamBuiltin';
    return { id: `builtin:${skill.name}`, name: skill.name, origin, skill };
  }
  return { id: `unclassified:${skill.name}`, name: skill.name, origin: 'unclassified', skill };
};

/** Applies product resource access to stable Skill identities supplied by AionCore. */
export const projectProductSkillCatalog = (
  skills: readonly AvailableSkill[],
  experience: ProductExperience,
  integrations: readonly KiBuddyProductIntegration[] = ['agentsGateway']
): ProductSkillCatalog => {
  const resources = skills.map(resolveSkillIdentity);
  const unavailableProductResources = resources.flatMap((resource) => {
    const definition = Object.values(KI_BUDDY_PRODUCT_RESOURCE_REGISTRY.skill).find(
      ({ backendName }) => backendName === resource.skill.name
    );
    return resource.origin === 'productBuiltin' &&
      definition &&
      !areKiBuddyProductResourceIntegrationsEnabled(definition, integrations)
      ? [
          {
            code: 'product_resource_hidden' as const,
            kind: 'skill' as const,
            resourceId: resource.id,
            resourceName: resource.name,
            origin: resource.origin,
            access: 'hidden' as const,
          },
        ]
      : [];
  });
  const unavailableResourceIds = new Set(unavailableProductResources.map(({ resourceId }) => resourceId));
  const availableResources = resources.filter(({ id }) => !unavailableResourceIds.has(id));
  const projection = projectProductResources(experience, 'skill', availableResources);
  const projectedVisible = new Map(projection.visible.map(({ resource, access }) => [resource.id, access]));
  const autoInjectExclusions = new Set(experience.behaviorDefaults().autoInjectedSkillExclusions);
  const visibleAutoInjectIds = new Set(
    availableResources
      .filter(
        ({ skill }) =>
          experience.resourceAccess('skill', 'upstreamBuiltin') === 'hidden' &&
          skill.source === 'builtin' &&
          skill.is_auto_inject &&
          !autoInjectExclusions.has(skill.name)
      )
      .map(({ id }) => id)
  );
  const entries = resources.flatMap((resource): ProductSkillCatalogEntry[] => {
    const projectedAccess = projectedVisible.get(resource.id);
    if (projectedAccess) {
      return [
        {
          skill: resource.skill,
          resourceId: resource.id,
          origin: resource.origin,
          access: projectedAccess,
        },
      ];
    }
    // Auto-injected Skills remain visible and read-only unless the product
    // behavior policy excludes them from injection.
    if (visibleAutoInjectIds.has(resource.id)) {
      return [
        {
          skill: resource.skill,
          resourceId: resource.id,
          origin: resource.origin,
          access: 'use',
        },
      ];
    }
    return [];
  });
  return {
    entries,
    hiddenResources: [
      ...unavailableProductResources,
      ...projection.hidden.filter(({ resourceId }) => !visibleAutoInjectIds.has(resourceId)),
    ],
    visibleSkills: entries.map(({ skill }) => skill),
  };
};

/** Keeps runtime-loaded Skill names that remain visible in the active product catalog. */
export const filterProductVisibleSkillNames = (
  names: readonly string[] | undefined,
  visibleSkills: readonly AvailableSkill[] | undefined,
  experience: ProductExperience = getProductExperience()
): string[] => {
  if (!names) return [];
  if (!visibleSkills) {
    const productFiltersSkillOrigins = (
      ['productBuiltin', 'custom', 'upstreamBuiltin', 'extension', 'unclassified'] as const
    ).some((origin) => experience.resourceAccess('skill', origin) === 'hidden');
    return productFiltersSkillOrigins ? [] : [...names];
  }
  const visibleNames = new Set(visibleSkills.map(({ name }) => name));
  return names.filter((name) => visibleNames.has(name));
};

/** Loads the AionCore Skill catalog and applies the active product policy once for renderer consumers. */
export const loadProductSkillCatalog = async (
  experience: ProductExperience = getProductExperience(),
  integrations: readonly KiBuddyProductIntegration[] = getKiBuddyProductRuntime()?.integrations ?? ['agentsGateway']
): Promise<ProductSkillCatalog> => {
  const skills = await ipcBridge.fs.listAvailableSkills.invoke();
  const catalog = projectProductSkillCatalog(skills, experience, integrations);
  reportHiddenProductResources('skill', catalog.hiddenResources);
  return catalog;
};

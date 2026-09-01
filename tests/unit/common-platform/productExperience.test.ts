import { describe, expect, it } from 'vitest';
import {
  PRODUCT_FEATURE_DEPENDENCIES,
  PRODUCT_FEATURE_IDS,
  PRODUCT_RESOURCE_KINDS,
  PRODUCT_RESOURCE_ORIGINS,
  createAionUiProductExperience,
  createKiBuddyProductExperience,
  evaluateProductBuiltinResourceState,
  isProductFeatureEnabled,
  parseProductExperiencePolicy,
  projectProductResources,
} from '@/common/platform/ki-buddy/experience';
import productExperienceRegistry from '../../../packages/desktop/src/common/platform/ki-buddy/experience/registry.json';

const validPolicy = {
  schemaVersion: 1,
  features: {
    account: 'enabled',
    agents: 'enabled',
    about: 'enabled',
    appearance: 'enabled',
    assistants: 'enabled',
    channels: 'disabled',
    componentShowcase: 'disabled',
    conversation: 'enabled',
    desktopPet: 'disabled',
    extensionMarketplace: 'disabled',
    extensionRuntime: 'disabled',
    extensionSettings: 'disabled',
    feedback: 'enabled',
    guid: 'enabled',
    guidFeedback: 'disabled',
    guidGithubStar: 'disabled',
    guidWebUi: 'disabled',
    githubResources: 'enabled',
    models: 'enabled',
    scheduledTasks: 'enabled',
    skills: 'enabled',
    system: 'enabled',
    team: 'disabled',
    themeCustomEditor: 'disabled',
    themeMarketplace: 'disabled',
    themePresets: 'disabled',
    tools: 'enabled',
    webUi: 'disabled',
  },
  resources: {
    agent: {
      productBuiltin: 'use',
      upstreamBuiltin: 'hidden',
      custom: 'manage',
      extension: 'hidden',
      unclassified: 'hidden',
    },
    assistant: {
      productBuiltin: 'manage',
      upstreamBuiltin: 'hidden',
      custom: 'manage',
      extension: 'hidden',
      unclassified: 'hidden',
    },
    model: {
      productBuiltin: 'manage',
      upstreamBuiltin: 'manage',
      custom: 'manage',
      extension: 'hidden',
      unclassified: 'hidden',
    },
    skill: {
      productBuiltin: 'use',
      upstreamBuiltin: 'hidden',
      custom: 'manage',
      extension: 'hidden',
      unclassified: 'hidden',
    },
    mcp: {
      productBuiltin: 'use',
      upstreamBuiltin: 'hidden',
      custom: 'manage',
      extension: 'hidden',
      unclassified: 'hidden',
    },
  },
  behaviorDefaults: {
    scheduledTaskExecutor: 'assistant',
    autoInjectedSkillExclusions: ['aionui-config'],
  },
} as const;

describe('ProductExperience interface', () => {
  it('uses the shared registry as the single feature and resource contract', () => {
    expect(PRODUCT_FEATURE_IDS).toEqual(Object.keys(productExperienceRegistry.features));
    expect(PRODUCT_FEATURE_DEPENDENCIES).toEqual(
      Object.entries(productExperienceRegistry.features).flatMap(([featureId, definition]) =>
        definition.dependsOn.map((parentId) => [featureId, parentId])
      )
    );
    expect(PRODUCT_RESOURCE_KINDS).toEqual(Object.keys(productExperienceRegistry.resourceKinds));
    expect(PRODUCT_RESOURCE_ORIGINS).toEqual(Object.keys(productExperienceRegistry.resourceOrigins));
  });

  it('projects visible MCP resources and records hidden resources without exposing their configuration', () => {
    const experience = createKiBuddyProductExperience(validPolicy);
    const projection = projectProductResources(experience, 'mcp', [
      { id: 'agents-adapter', name: 'Agents Adapter', origin: 'productBuiltin' },
      { id: 'custom-server', name: 'Custom server', origin: 'custom' },
      { id: 'upstream-server', name: 'Upstream server', origin: 'upstreamBuiltin' },
      { id: 'unknown-server', name: 'Unknown server', origin: 'unclassified' },
    ]);

    expect(projection.visible).toEqual([
      {
        resource: { id: 'agents-adapter', name: 'Agents Adapter', origin: 'productBuiltin' },
        access: 'use',
      },
      {
        resource: { id: 'custom-server', name: 'Custom server', origin: 'custom' },
        access: 'manage',
      },
    ]);
    expect(projection.hidden).toEqual([
      {
        code: 'product_resource_hidden',
        kind: 'mcp',
        resourceId: 'upstream-server',
        resourceName: 'Upstream server',
        origin: 'upstreamBuiltin',
        access: 'hidden',
      },
      {
        code: 'product_resource_hidden',
        kind: 'mcp',
        resourceId: 'unknown-server',
        resourceName: 'Unknown server',
        origin: 'unclassified',
        access: 'hidden',
      },
    ]);
  });

  it('reports installation integrity when an enabled feature requires a missing product built-in MCP', () => {
    const experience = createKiBuddyProductExperience(validPolicy);

    expect(
      evaluateProductBuiltinResourceState(experience, 'mcp', {
        availableResourceIds: [],
        catalogReady: true,
        requirements: [{ featureId: 'agents', resourceId: 'agents-adapter', resourceName: 'Agents Adapter' }],
      })
    ).toEqual({
      status: 'invalid',
      missing: [
        {
          code: 'required_product_resource_missing',
          featureId: 'agents',
          kind: 'mcp',
          origin: 'productBuiltin',
          resourceId: 'agents-adapter',
          resourceName: 'Agents Adapter',
        },
      ],
    });
  });

  it('does not require an Agents Adapter MCP before a product resource requirement is declared', () => {
    const experience = createKiBuddyProductExperience(validPolicy);

    expect(
      evaluateProductBuiltinResourceState(experience, 'mcp', {
        availableResourceIds: [],
        catalogReady: false,
        requirements: [],
      })
    ).toEqual({ status: 'ready', missing: [] });
  });

  it('waits for the backend catalog before judging a declared product built-in MCP requirement', () => {
    const experience = createKiBuddyProductExperience(validPolicy);

    expect(
      evaluateProductBuiltinResourceState(experience, 'mcp', {
        availableResourceIds: [],
        catalogReady: false,
        requirements: [{ featureId: 'agents', resourceId: 'agents-adapter' }],
      })
    ).toEqual({ status: 'pending', missing: [] });
  });

  it('accepts a declared product built-in MCP when the backend catalog contains its stable ID', () => {
    const experience = createKiBuddyProductExperience(validPolicy);

    expect(
      evaluateProductBuiltinResourceState(experience, 'mcp', {
        availableResourceIds: ['agents-adapter'],
        catalogReady: true,
        requirements: [{ featureId: 'agents', resourceId: 'agents-adapter' }],
      })
    ).toEqual({ status: 'ready', missing: [] });
  });

  it('keeps the complete AionUi feature and resource behavior when no product capability exists', () => {
    const experience = createAionUiProductExperience();

    expect(experience.featureState('team')).toBe('enabled');
    expect(experience.resourceAccess('assistant', 'upstreamBuiltin')).toBe('manage');
    expect(experience.behaviorDefaults()).toEqual({
      scheduledTaskExecutor: 'assistant-or-team',
      autoInjectedSkillExclusions: [],
    });
  });

  it('keeps upstream surfaces enabled without a product policy and follows explicit feature policy', () => {
    const experience = createKiBuddyProductExperience({
      ...validPolicy,
      features: { ...validPolicy.features, about: 'disabled' },
    });

    expect(isProductFeatureEnabled(undefined, 'about')).toBe(true);
    expect(isProductFeatureEnabled(experience, 'about')).toBe(false);
  });

  it('keeps every MCP origin visible and manageable in the AionUi adapter', () => {
    const experience = createAionUiProductExperience();
    const projection = projectProductResources(
      experience,
      'mcp',
      PRODUCT_RESOURCE_ORIGINS.map((origin) => ({
        id: origin,
        origin,
      }))
    );

    expect(projection.visible.map(({ resource, access }) => ({ id: resource.id, access }))).toEqual([
      { id: 'productBuiltin', access: 'manage' },
      { id: 'upstreamBuiltin', access: 'manage' },
      { id: 'custom', access: 'manage' },
      { id: 'extension', access: 'manage' },
      { id: 'unclassified', access: 'manage' },
    ]);
    expect(projection.hidden).toEqual([]);
  });

  it('provides feature, resource, and behavior decisions without exposing the product JSON', () => {
    const experience = createKiBuddyProductExperience(validPolicy);

    expect(experience.featureState('team')).toBe('disabled');
    expect(experience.featureState('scheduledTasks')).toBe('enabled');
    expect(experience.resourceAccess('assistant', 'productBuiltin')).toBe('manage');
    expect(experience.resourceAccess('assistant', 'custom')).toBe('manage');
    expect(experience.behaviorDefaults()).toEqual({
      scheduledTaskExecutor: 'assistant',
      autoInjectedSkillExclusions: ['aionui-config'],
    });
    expect(experience).not.toHaveProperty('features');
    expect(experience).not.toHaveProperty('resources');
  });

  it('returns a deeply immutable serializable snapshot', () => {
    const snapshot = parseProductExperiencePolicy(validPolicy);

    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.features)).toBe(true);
    expect(Object.isFrozen(snapshot.resources.assistant)).toBe(true);
    expect(Object.isFrozen(snapshot.behaviorDefaults.autoInjectedSkillExclusions)).toBe(true);
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(validPolicy);
  });

  it.each([
    {
      name: 'missing feature',
      policy: {
        ...validPolicy,
        features: Object.fromEntries(Object.entries(validPolicy.features).filter(([id]) => id !== 'team')),
      },
    },
    {
      name: 'unknown feature',
      policy: { ...validPolicy, features: { ...validPolicy.features, secretFeature: 'enabled' } },
    },
    {
      name: 'unknown feature state',
      policy: { ...validPolicy, features: { ...validPolicy.features, team: 'preview' } },
    },
    {
      name: 'unknown resource field',
      policy: {
        ...validPolicy,
        resources: {
          ...validPolicy.resources,
          assistant: { ...validPolicy.resources.assistant, remote: 'use' },
        },
      },
    },
    {
      name: 'unknown resource state',
      policy: {
        ...validPolicy,
        resources: {
          ...validPolicy.resources,
          assistant: { ...validPolicy.resources.assistant, custom: 'read' },
        },
      },
    },
    {
      name: 'unknown policy field',
      policy: { ...validPolicy, rollout: 'remote' },
    },
  ])('rejects an incomplete or unknown $name', ({ policy }) => {
    expect(() => parseProductExperiencePolicy(policy)).toThrow();
  });

  it('rejects enabled child features when their parent feature is disabled', () => {
    expect(() =>
      parseProductExperiencePolicy({
        ...validPolicy,
        features: {
          ...validPolicy.features,
          extensionRuntime: 'disabled',
          extensionMarketplace: 'enabled',
        },
      })
    ).toThrow('extensionMarketplace');
  });

  it('rejects a product policy without the required Guid landing capability', () => {
    expect(() =>
      parseProductExperiencePolicy({
        ...validPolicy,
        features: {
          ...validPolicy.features,
          guid: 'disabled',
        },
      })
    ).toThrow('Product feature guid must be enabled');
  });
});

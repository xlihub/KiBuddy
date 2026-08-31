import { describe, expect, it } from 'vitest';
import {
  KI_BUDDY_PRODUCT_RESOURCE_REGISTRY,
  resolveKiBuddyAssistantEffectiveMcpServerIds,
  resolveKiBuddyAssistantRequiredMcpServerIds,
} from '@/renderer/services/runtime/catalogs/kiBuddyResourceRegistry';

const agentsAdapterServerFixture = {
  id: 'mcp-current-account',
  name: KI_BUDDY_PRODUCT_RESOURCE_REGISTRY.mcp.agentsAdapter.backendName,
  builtin: true,
  transport: {
    type: 'stdio' as const,
    command: 'node',
    args: [`/app/${KI_BUDDY_PRODUCT_RESOURCE_REGISTRY.mcp.agentsAdapter.scriptName}`],
  },
};

const kiBuddyRuntimeCapability = { id: 'ki-buddy' as const, integrations: ['agentsGateway'] as const };
const localKiBuddyRuntimeCapability = { id: 'ki-buddy' as const, integrations: [] as const };
const otherBuiltinAssistant = Object.values(KI_BUDDY_PRODUCT_RESOURCE_REGISTRY.assistant).find(
  ({ id, source }) => source === 'builtin' && id !== KI_BUDDY_PRODUCT_RESOURCE_REGISTRY.assistant.agentsExecution.id
);

if (!otherBuiltinAssistant) throw new Error('Expected another built-in Assistant in the product registry');

describe('Ki-Buddy product resource registry', () => {
  it('registers the Agents execution Assistant with its required product Adapter', () => {
    expect(KI_BUDDY_PRODUCT_RESOURCE_REGISTRY.assistant.agentsExecution).toMatchObject({
      featureId: 'assistants',
      source: 'builtin',
      requiredMcpResourceIds: [KI_BUDDY_PRODUCT_RESOURCE_REGISTRY.mcp.agentsAdapter.id],
    });
  });

  it('resolves the required product Adapter to the current backend server id', () => {
    expect(
      resolveKiBuddyAssistantRequiredMcpServerIds(
        {
          id: KI_BUDDY_PRODUCT_RESOURCE_REGISTRY.assistant.agentsExecution.id,
          source: KI_BUDDY_PRODUCT_RESOURCE_REGISTRY.assistant.agentsExecution.source,
        },
        [agentsAdapterServerFixture]
      )
    ).toEqual([agentsAdapterServerFixture.id]);
  });

  it('does not require the Adapter for a user Assistant with the same id', () => {
    expect(
      resolveKiBuddyAssistantRequiredMcpServerIds(
        {
          id: KI_BUDDY_PRODUCT_RESOURCE_REGISTRY.assistant.agentsExecution.id,
          source: 'user',
        },
        [agentsAdapterServerFixture]
      )
    ).toEqual([]);
  });

  it('does not require the Adapter for another built-in Assistant', () => {
    expect(resolveKiBuddyAssistantRequiredMcpServerIds(otherBuiltinAssistant, [agentsAdapterServerFixture])).toEqual(
      []
    );
  });

  it('returns no required server id when the Adapter is unavailable', () => {
    expect(
      resolveKiBuddyAssistantRequiredMcpServerIds(
        {
          id: KI_BUDDY_PRODUCT_RESOURCE_REGISTRY.assistant.agentsExecution.id,
          source: KI_BUDDY_PRODUCT_RESOURCE_REGISTRY.assistant.agentsExecution.source,
        },
        []
      )
    ).toEqual([]);
  });

  it('enforces the product Adapter for the official Assistant after the user clears the selection', () => {
    expect(
      resolveKiBuddyAssistantEffectiveMcpServerIds(
        kiBuddyRuntimeCapability,
        {
          id: KI_BUDDY_PRODUCT_RESOURCE_REGISTRY.assistant.agentsExecution.id,
          source: KI_BUDDY_PRODUCT_RESOURCE_REGISTRY.assistant.agentsExecution.source,
        },
        [agentsAdapterServerFixture],
        []
      )
    ).toEqual([agentsAdapterServerFixture.id]);
  });

  it('preserves other selections and removes duplicate ids while enforcing the product Adapter', () => {
    expect(
      resolveKiBuddyAssistantEffectiveMcpServerIds(
        kiBuddyRuntimeCapability,
        {
          id: KI_BUDDY_PRODUCT_RESOURCE_REGISTRY.assistant.agentsExecution.id,
          source: KI_BUDDY_PRODUCT_RESOURCE_REGISTRY.assistant.agentsExecution.source,
        },
        [agentsAdapterServerFixture],
        ['other-mcp', agentsAdapterServerFixture.id, 'other-mcp']
      )
    ).toEqual(['other-mcp', agentsAdapterServerFixture.id]);
  });

  it('does not require or inject the Agents Adapter when Agents Gateway is unavailable', () => {
    expect(
      resolveKiBuddyAssistantEffectiveMcpServerIds(
        localKiBuddyRuntimeCapability,
        {
          id: KI_BUDDY_PRODUCT_RESOURCE_REGISTRY.assistant.agentsExecution.id,
          source: KI_BUDDY_PRODUCT_RESOURCE_REGISTRY.assistant.agentsExecution.source,
        },
        [agentsAdapterServerFixture],
        ['other-mcp']
      )
    ).toEqual(['other-mcp']);
  });

  it('removes a selected legacy Agents Adapter when Agents Gateway is unavailable', () => {
    expect(
      resolveKiBuddyAssistantEffectiveMcpServerIds(
        localKiBuddyRuntimeCapability,
        {
          id: KI_BUDDY_PRODUCT_RESOURCE_REGISTRY.assistant.agentsExecution.id,
          source: KI_BUDDY_PRODUCT_RESOURCE_REGISTRY.assistant.agentsExecution.source,
        },
        [agentsAdapterServerFixture],
        ['other-mcp', agentsAdapterServerFixture.id]
      )
    ).toEqual(['other-mcp']);
  });

  it('does not enforce the product Adapter for a user Assistant with the same id', () => {
    expect(
      resolveKiBuddyAssistantEffectiveMcpServerIds(
        kiBuddyRuntimeCapability,
        {
          id: KI_BUDDY_PRODUCT_RESOURCE_REGISTRY.assistant.agentsExecution.id,
          source: 'user',
        },
        [agentsAdapterServerFixture],
        []
      )
    ).toEqual([]);
  });

  it('preserves the AionUi selection when the Ki-Buddy capability is absent', () => {
    expect(
      resolveKiBuddyAssistantEffectiveMcpServerIds(
        null,
        {
          id: KI_BUDDY_PRODUCT_RESOURCE_REGISTRY.assistant.agentsExecution.id,
          source: KI_BUDDY_PRODUCT_RESOURCE_REGISTRY.assistant.agentsExecution.source,
        },
        [agentsAdapterServerFixture],
        ['other-mcp', 'other-mcp']
      )
    ).toEqual(['other-mcp', 'other-mcp']);
  });
});

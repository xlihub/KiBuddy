import {
  evaluateProductBuiltinResourceState,
  projectProductResources,
  type ProductBuiltinResourceRequirement,
  type ProductBuiltinResourceState,
  type ProductExperience,
  type KiBuddyProductIntegration,
  type ProductResourceAccess,
  type ProductResourceHiddenRecord,
  type ProductResourceOrigin,
} from '@/common/platform/ki-buddy';
import { ipcBridge } from '@/common';
import type { Assistant } from '@/common/types/agent/assistantTypes';
import { getKiBuddyProductRuntime, getProductExperience } from '../kiBuddyRuntime';
import { KI_BUDDY_ASSISTANT_IDENTITIES, resolveKiBuddyAssistantOrigin } from './kiBuddyAssistantIdentity';
import { areKiBuddyProductResourceIntegrationsEnabled } from './kiBuddyResourceRegistry';

export { KI_BUDDY_PRODUCT_ASSISTANT_IDS } from './kiBuddyAssistantIdentity';

const KI_CLI_ASSISTANT_IDENTITY = KI_BUDDY_ASSISTANT_IDENTITIES.kiCli;

const productBuiltinAssistantRequirements = (
  integrations: readonly KiBuddyProductIntegration[]
): readonly ProductBuiltinResourceRequirement[] =>
  Object.values(KI_BUDDY_ASSISTANT_IDENTITIES)
    .filter((definition) => areKiBuddyProductResourceIntegrationsEnabled(definition, integrations))
    .map((definition) => ({
      featureId: definition.featureId,
      resourceId: definition.id,
      resourceName: 'resourceName' in definition ? definition.resourceName : undefined,
    }));

export type ProductAssistant = Assistant &
  Readonly<{
    productAccess: Exclude<ProductResourceAccess, 'hidden'>;
  }>;

export type ProductAssistantCatalogEntry = Readonly<{
  access: Exclude<ProductResourceAccess, 'hidden'>;
  assistant: ProductAssistant;
  origin: ProductResourceOrigin;
  resourceId: string;
}>;

export type ProductAssistantCatalog = Readonly<{
  entries: readonly ProductAssistantCatalogEntry[];
  hiddenResources: readonly ProductResourceHiddenRecord[];
  visibleAssistants: readonly ProductAssistant[];
}>;

const isKiCliAssistant = (assistant: Assistant): boolean =>
  assistant.id === KI_CLI_ASSISTANT_IDENTITY.id &&
  assistant.source === KI_CLI_ASSISTANT_IDENTITY.source &&
  assistant.agent_id === KI_CLI_ASSISTANT_IDENTITY.agentId &&
  assistant.agent?.type === KI_CLI_ASSISTANT_IDENTITY.agentType &&
  assistant.agent.source === KI_CLI_ASSISTANT_IDENTITY.agentSource;

const resolveProductAssistantOrigin = (assistant: Assistant): ProductResourceOrigin => {
  if (assistant.agent?.source === 'extension') return 'extension';
  if (assistant.source === 'generated') return isKiCliAssistant(assistant) ? 'productBuiltin' : 'unclassified';
  return resolveKiBuddyAssistantOrigin(assistant);
};

/** Applies product access from stable Assistant identity and structured source fields. */
export const projectProductAssistantCatalog = (
  assistants: readonly Assistant[],
  experience: ProductExperience,
  integrations: readonly KiBuddyProductIntegration[] = ['agentsGateway']
): ProductAssistantCatalog => {
  const unavailableProductResources = assistants.flatMap((assistant) => {
    const definition = Object.values(KI_BUDDY_ASSISTANT_IDENTITIES).find(
      (candidate) => candidate.id === assistant.id && candidate.source === assistant.source
    );
    return definition && !areKiBuddyProductResourceIntegrationsEnabled(definition, integrations)
      ? [
          {
            code: 'product_resource_hidden' as const,
            kind: 'assistant' as const,
            resourceId: assistant.id,
            resourceName: assistant.name,
            origin: 'productBuiltin' as const,
            access: 'hidden' as const,
          },
        ]
      : [];
  });
  const unavailableResourceIds = new Set(unavailableProductResources.map(({ resourceId }) => resourceId));
  const projection = projectProductResources(
    experience,
    'assistant',
    assistants
      .filter((assistant) => !unavailableResourceIds.has(assistant.id))
      .map((assistant) => ({
        id: assistant.id,
        name: assistant.name,
        origin: resolveProductAssistantOrigin(assistant),
        assistant,
      }))
  );
  const entries = projection.visible.map(({ resource, access }) => ({
    access,
    assistant: { ...resource.assistant, productAccess: access },
    origin: resource.origin,
    resourceId: resource.id,
  }));

  return {
    entries,
    hiddenResources: [...unavailableProductResources, ...projection.hidden],
    visibleAssistants: entries.map(({ assistant }) => assistant),
  };
};

/** Evaluates every required Assistant only after the backend catalog becomes authoritative. */
export const loadProductBuiltinAssistantResourceState = async (
  experience: ProductExperience = getProductExperience(),
  integrations: readonly KiBuddyProductIntegration[] = getKiBuddyProductRuntime()?.integrations ?? ['agentsGateway'],
  requirements: readonly ProductBuiltinResourceRequirement[] = productBuiltinAssistantRequirements(integrations)
): Promise<ProductBuiltinResourceState> => {
  const pendingState = evaluateProductBuiltinResourceState(experience, 'assistant', {
    availableResourceIds: [],
    catalogReady: false,
    requirements,
  });
  if (pendingState.status !== 'pending') return pendingState;

  try {
    const catalog = projectProductAssistantCatalog(await ipcBridge.assistants.list.invoke(), experience, integrations);
    const availableResourceIds = catalog.entries
      .filter(({ origin }) => origin === 'productBuiltin')
      .map(({ resourceId }) => resourceId);
    return evaluateProductBuiltinResourceState(experience, 'assistant', {
      availableResourceIds,
      catalogReady: true,
      requirements,
    });
  } catch (error) {
    console.error('[ProductExperience] Failed to load the Assistant catalog for product integrity validation', error);
    return pendingState;
  }
};

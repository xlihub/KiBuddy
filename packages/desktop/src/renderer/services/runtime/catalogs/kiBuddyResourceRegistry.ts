import type { KiBuddyProductIntegration, ProductFeatureId, ProductResourceOrigin } from '@/common/platform/ki-buddy';
import type { IMcpServer } from '@/common/config/storage';
import type { Assistant } from '@/common/types/agent/assistantTypes';
import type { KiBuddyProductRuntime } from '../kiBuddyRuntime';

type ProductResourceDefinition = Readonly<{
  featureId: ProductFeatureId;
  id: string;
  requiredIntegrations?: readonly KiBuddyProductIntegration[];
  resourceName?: string;
}>;

type ProductMcpResourceDefinition = ProductResourceDefinition &
  Readonly<{
    backendName: string;
    scriptName: string;
    tools: Readonly<Record<string, Readonly<{ descriptionKey: string; name: string }>>>;
  }>;

const KI_CLI_AGENT = {
  id: '632f31d2',
  featureId: 'agents',
  resourceName: 'Ki CLI',
  agentSource: 'internal',
  agentType: 'aionrs',
} as const satisfies ProductResourceDefinition & { agentSource: string; agentType: string };

const AGENTS_MCP_ADAPTER = {
  id: 'builtin:agents-mcp-adapter',
  featureId: 'tools',
  requiredIntegrations: ['agentsGateway'],
  resourceName: 'agents-mcp-adapter',
  backendName: 'agents-mcp-adapter',
  scriptName: 'builtin-mcp-agents.js',
  tools: {
    describe: {
      name: 'agents_describe',
      descriptionKey: 'settings.kiBuddy.agentsDescribeDescription',
    },
    invoke: {
      name: 'agents_invoke',
      descriptionKey: 'settings.kiBuddy.agentsInvokeDescription',
    },
    list: {
      name: 'agents_list',
      descriptionKey: 'settings.kiBuddy.agentsListDescription',
    },
    upload: {
      name: 'agents_upload_file',
      descriptionKey: 'settings.kiBuddy.agentsUploadDescription',
    },
  },
} as const satisfies ProductMcpResourceDefinition;

/** Stable product-owned identities used by every Agent, Assistant, Skill, and MCP catalog projection. */
export const KI_BUDDY_PRODUCT_RESOURCE_REGISTRY = {
  agent: {
    kiCli: KI_CLI_AGENT,
  },
  assistant: {
    word: {
      id: 'word-creator',
      featureId: 'assistants',
      resourceName: 'Word Creator',
      source: 'builtin',
    },
    presentation: {
      id: 'ppt-creator',
      featureId: 'assistants',
      resourceName: 'PPT Creator',
      source: 'builtin',
    },
    spreadsheet: {
      id: 'excel-creator',
      featureId: 'assistants',
      resourceName: 'Excel Creator',
      source: 'builtin',
    },
    agentsExecution: {
      id: 'agents-executor',
      featureId: 'assistants',
      source: 'builtin',
      requiredIntegrations: ['agentsGateway'],
      requiredMcpResourceIds: [AGENTS_MCP_ADAPTER.id],
    },
    kiCli: {
      id: `bare:${KI_CLI_AGENT.id}`,
      featureId: 'assistants',
      resourceName: KI_CLI_AGENT.resourceName,
      source: 'generated',
      agentId: KI_CLI_AGENT.id,
      agentSource: KI_CLI_AGENT.agentSource,
      agentType: KI_CLI_AGENT.agentType,
    },
  },
  skill: {
    word: {
      id: 'builtin:officecli-docx',
      featureId: 'skills',
      backendName: 'officecli-docx',
    },
    presentation: {
      id: 'builtin:officecli-pptx',
      featureId: 'skills',
      backendName: 'officecli-pptx',
    },
    spreadsheet: {
      id: 'builtin:officecli-xlsx',
      featureId: 'skills',
      backendName: 'officecli-xlsx',
    },
    agentsExecution: {
      id: 'builtin:ki-buddy-agents-execution',
      featureId: 'skills',
      backendName: 'ki-buddy-agents-execution',
      requiredIntegrations: ['agentsGateway'],
    },
  },
  mcp: {
    agentsAdapter: AGENTS_MCP_ADAPTER,
  },
} as const;

/** Reports whether every integration required by a product resource is available. */
export function areKiBuddyProductResourceIntegrationsEnabled(
  definition: Readonly<{ id: string; requiredIntegrations?: readonly KiBuddyProductIntegration[] }>,
  integrations: readonly KiBuddyProductIntegration[]
): boolean {
  return definition.requiredIntegrations?.every((integration) => integrations.includes(integration)) ?? true;
}

/** Identifies the product-owned Adapter using the complete registration shape available without Ki-Core changes. */
export function resolveKiBuddyProductMcpResourceId(
  server: Pick<IMcpServer, 'builtin' | 'name' | 'transport'>
): string | null {
  const definition = KI_BUDDY_PRODUCT_RESOURCE_REGISTRY.mcp.agentsAdapter;
  if (
    server.builtin !== true ||
    server.name !== definition.backendName ||
    server.transport.type !== 'stdio' ||
    server.transport.command !== 'node' ||
    server.transport.args?.length !== 1
  ) {
    return null;
  }
  const normalizedScriptPath = server.transport.args[0].replace(/\\/gu, '/');
  return normalizedScriptPath.endsWith(`/${definition.scriptName}`) ? definition.id : null;
}

/** Resolves required product MCP resources for one official Assistant to current backend server ids. */
export function resolveKiBuddyAssistantRequiredMcpServerIds(
  assistantIdentity: Pick<Assistant, 'id' | 'source'> | null | undefined,
  servers: readonly Pick<IMcpServer, 'builtin' | 'id' | 'name' | 'transport'>[]
): string[] {
  const assistant = KI_BUDDY_PRODUCT_RESOURCE_REGISTRY.assistant.agentsExecution;
  if (assistantIdentity?.id !== assistant.id || assistantIdentity.source !== assistant.source) return [];
  const requiredResourceIds = new Set<string>(assistant.requiredMcpResourceIds);
  return servers
    .filter((server) => {
      const resourceId = resolveKiBuddyProductMcpResourceId(server);
      return resourceId !== null && requiredResourceIds.has(resourceId);
    })
    .map(({ id }) => id);
}

export type KiBuddyAssistantEffectiveMcpSelection = Readonly<{
  missingRequiredResourceIds: string[];
  serverIds: string[];
}>;

/** Applies product MCP requirements and reports any required resources missing from the backend catalog. */
export function resolveKiBuddyAssistantEffectiveMcpSelection(
  productRuntime: Pick<KiBuddyProductRuntime, 'id' | 'integrations'> | null,
  assistantIdentity: Pick<Assistant, 'id' | 'source'> | null | undefined,
  servers: readonly Pick<IMcpServer, 'builtin' | 'id' | 'name' | 'transport'>[],
  selectedServerIds: readonly string[]
): KiBuddyAssistantEffectiveMcpSelection {
  if (!productRuntime) return { missingRequiredResourceIds: [], serverIds: [...selectedServerIds] };
  if (!productRuntime.integrations.includes('agentsGateway')) {
    const unavailableAdapterServerIds = new Set(
      servers.filter((server) => resolveKiBuddyProductMcpResourceId(server) !== null).map(({ id }) => id)
    );
    return {
      missingRequiredResourceIds: [],
      serverIds: selectedServerIds.filter((serverId) => !unavailableAdapterServerIds.has(serverId)),
    };
  }

  const assistant = KI_BUDDY_PRODUCT_RESOURCE_REGISTRY.assistant.agentsExecution;
  if (assistantIdentity?.id !== assistant.id || assistantIdentity.source !== assistant.source) {
    return { missingRequiredResourceIds: [], serverIds: [...selectedServerIds] };
  }

  const requiredServerIds = resolveKiBuddyAssistantRequiredMcpServerIds(assistantIdentity, servers);
  const availableResourceIds = new Set(
    servers.flatMap((server) => {
      const resourceId = resolveKiBuddyProductMcpResourceId(server);
      return resourceId ? [resourceId] : [];
    })
  );
  const missingRequiredResourceIds = assistant.requiredMcpResourceIds.filter(
    (resourceId) => !availableResourceIds.has(resourceId)
  );
  return {
    missingRequiredResourceIds,
    serverIds: [...new Set([...selectedServerIds, ...requiredServerIds])],
  };
}

/** Applies required MCP resources only when the explicit Ki-Buddy runtime capability is present. */
export function resolveKiBuddyAssistantEffectiveMcpServerIds(
  productRuntime: Pick<KiBuddyProductRuntime, 'id' | 'integrations'> | null,
  assistantIdentity: Pick<Assistant, 'id' | 'source'> | null | undefined,
  servers: readonly Pick<IMcpServer, 'builtin' | 'id' | 'name' | 'transport'>[],
  selectedServerIds: readonly string[]
): string[] {
  return resolveKiBuddyAssistantEffectiveMcpSelection(productRuntime, assistantIdentity, servers, selectedServerIds)
    .serverIds;
}

/** Resolves product-owned UI copy without changing the Adapter's stable MCP protocol metadata. */
export function resolveKiBuddyMcpToolDescriptionKey(
  server: Pick<IMcpServer, 'builtin' | 'name' | 'transport'>,
  origin: ProductResourceOrigin | undefined,
  toolName: string
):
  | 'settings.kiBuddy.agentsDescribeDescription'
  | 'settings.kiBuddy.agentsInvokeDescription'
  | 'settings.kiBuddy.agentsListDescription'
  | 'settings.kiBuddy.agentsUploadDescription'
  | null {
  const definition = KI_BUDDY_PRODUCT_RESOURCE_REGISTRY.mcp.agentsAdapter;
  if (origin !== 'productBuiltin' || resolveKiBuddyProductMcpResourceId(server) !== definition.id) return null;
  const tool = Object.values(definition.tools).find(({ name }) => name === toolName);
  return tool?.descriptionKey ?? null;
}

export const KI_CLI_PRODUCT_RESOURCE_ID = KI_BUDDY_PRODUCT_RESOURCE_REGISTRY.agent.kiCli.id;
export const KI_BUDDY_ASSISTANT_IDENTITIES = KI_BUDDY_PRODUCT_RESOURCE_REGISTRY.assistant;
export const KI_BUDDY_PRODUCT_ASSISTANT_IDS = Object.values(KI_BUDDY_ASSISTANT_IDENTITIES).map(({ id }) => id);
export const KI_BUDDY_PRODUCT_SKILL_NAMES = new Set<string>(
  Object.values(KI_BUDDY_PRODUCT_RESOURCE_REGISTRY.skill).map(({ backendName }) => backendName)
);

import type { TChatConversation, TConversationAssistantIdentity } from '@/common/config/storage';
import type { KiBuddyProductIntegration, ProductExperience, ProductResourceOrigin } from '@/common/platform/ki-buddy';
import type { Assistant } from '@/common/types/agent/assistantTypes';
import {
  KI_BUDDY_ASSISTANT_IDENTITIES,
  KI_BUDDY_PRODUCT_ASSISTANT_IDS,
  KI_CLI_PRODUCT_RESOURCE_ID,
} from './kiBuddyResourceRegistry';

export { KI_BUDDY_ASSISTANT_IDENTITIES, KI_BUDDY_PRODUCT_ASSISTANT_IDS, KI_CLI_PRODUCT_RESOURCE_ID };

type AssistantOriginIdentity = Readonly<{
  id: string;
  source: string;
}>;

export type ConversationRuntimeAccess = 'allowed' | 'blocked' | 'pending';

export type KiBuddyConversationRuntimeAccessInput = Readonly<{
  assistantCatalog: Readonly<{
    matchedAssistant: Assistant | undefined;
    requiresClassification: boolean;
    status: 'loading' | 'ready';
  }>;
  conversation: TChatConversation | undefined;
}>;

/** Identifies the product-owned internal CLI across current and historical snapshot IDs. */
export function isKiCliConversationAssistant(assistant: TConversationAssistantIdentity): boolean {
  return (
    assistant.backend === 'aionrs' &&
    assistant.source === 'generated' &&
    (assistant.id === KI_BUDDY_ASSISTANT_IDENTITIES.kiCli.id ||
      assistant.id === 'bare-aionrs' ||
      assistant.id === 'aionrs')
  );
}

/** Resolves an Assistant's stable identity to the shared product resource origin. */
export function resolveKiBuddyAssistantOrigin(assistant: AssistantOriginIdentity): ProductResourceOrigin {
  if (assistant.source === 'extension') return 'extension';
  if (assistant.source === 'user') return 'custom';
  if (
    Object.values(KI_BUDDY_ASSISTANT_IDENTITIES).some(
      (identity) => assistant.id === identity.id && assistant.source === identity.source
    )
  ) {
    return 'productBuiltin';
  }
  if (assistant.source === 'builtin') return 'upstreamBuiltin';
  return 'unclassified';
}

/** Resolves a persisted conversation Assistant snapshot, including historical Ki CLI identities. */
export function resolveKiBuddyConversationAssistantOrigin(
  assistant: TConversationAssistantIdentity
): ProductResourceOrigin {
  return isKiCliConversationAssistant(assistant) ? 'productBuiltin' : resolveKiBuddyAssistantOrigin(assistant);
}

function readConversationString(extra: TChatConversation['extra'], key: string): string {
  const value = (extra as Record<string, unknown> | undefined)?.[key];
  return typeof value === 'string' ? value.trim() : '';
}

function hasExtensionRuntimeIdentity(conversation: TChatConversation): boolean {
  const identities = [
    conversation.assistant?.id,
    conversation.assistant?.backend,
    readConversationString(conversation.extra, 'assistant_id'),
    readConversationString(conversation.extra, 'preset_assistant_id'),
    readConversationString(conversation.extra, 'custom_agent_id'),
    readConversationString(conversation.extra, 'backend'),
  ];
  return conversation.assistant?.source === 'extension' || identities.some((identity) => identity?.startsWith('ext:'));
}

function hasAgentsExecutionAssistantIdentity(
  conversation: TChatConversation,
  matchedAssistant: Assistant | undefined
): boolean {
  const identity = KI_BUDDY_ASSISTANT_IDENTITIES.agentsExecution;
  if (matchedAssistant?.id === identity.id && matchedAssistant.source === identity.source) return true;
  const ids = [
    conversation.assistant?.id,
    readConversationString(conversation.extra, 'assistant_id'),
    readConversationString(conversation.extra, 'preset_assistant_id'),
    readConversationString(conversation.extra, 'custom_agent_id'),
  ];
  return ids.includes(identity.id);
}

/** Resolves whether a persisted conversation may mount its runtime under the Ki-Buddy product policy. */
export function resolveKiBuddyConversationRuntimeAccess(
  input: KiBuddyConversationRuntimeAccessInput,
  experience: ProductExperience,
  integrations: readonly KiBuddyProductIntegration[] = ['agentsGateway']
): ConversationRuntimeAccess {
  const { conversation, assistantCatalog } = input;
  if (!conversation) return 'allowed';
  if (
    !integrations.includes('agentsGateway') &&
    hasAgentsExecutionAssistantIdentity(conversation, assistantCatalog.matchedAssistant)
  ) {
    return 'blocked';
  }
  if (experience.featureState('extensionRuntime') === 'enabled') return 'allowed';
  if (hasExtensionRuntimeIdentity(conversation)) return 'blocked';

  if (
    assistantCatalog.matchedAssistant?.agent?.source === 'extension' ||
    (assistantCatalog.matchedAssistant &&
      resolveKiBuddyAssistantOrigin(assistantCatalog.matchedAssistant) === 'extension')
  ) {
    return 'blocked';
  }

  if (!assistantCatalog.requiresClassification) return 'allowed';
  return assistantCatalog.status === 'loading' ? 'pending' : 'allowed';
}

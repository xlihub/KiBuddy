import type { TConversationAssistantIdentity } from '@/common/config/storage';
import type { Assistant, AssistantAgent, AssistantDetail } from '@/common/types/agent/assistantTypes';

export type RendererBrand = {
  cliName: string;
  description: string;
  links: {
    feedback: string;
    homepage: string;
    releases: string;
    repository: string;
    support: string;
  };
  logoUrl: string;
  mascotUrl: string;
  productName: string;
  shortName: string;
};

export type AgentIdentity = {
  agent_source?: string;
  agent_type?: string;
  avatar?: string;
  icon?: string;
  name: string;
};

export type AssistantIdentity = Pick<Assistant, 'agent' | 'avatar' | 'id' | 'name' | 'name_i18n' | 'source'>;

export type ProductPresentationAdapter = {
  adaptAgentIdentity: <T extends AgentIdentity>(agent: T) => T;
  adaptAgentLogo: (agent: AssistantAgent | undefined, upstreamLogo: string | null) => string | null;
  adaptAssistantDetailIdentity: <T extends AssistantDetail>(detail: T) => T;
  adaptAssistantIdentity: <T extends AssistantIdentity>(assistant: T) => T;
  adaptConversationAssistantIdentity: <T extends TConversationAssistantIdentity>(assistant: T) => T;
  brand: RendererBrand;
  resolveDocumentTitle: (upstreamTitle: string) => string;
  initializeDocument: (root: Document) => void;
};

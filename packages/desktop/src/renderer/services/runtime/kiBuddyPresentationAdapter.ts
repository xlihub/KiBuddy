import type { TConversationAssistantIdentity } from '@/common/config/storage';
import type { AssistantDetail } from '@/common/types/agent/assistantTypes';
import type { KiBuddyProductRuntime } from './kiBuddyRuntime';
import type { AgentIdentity, AssistantIdentity, ProductPresentationAdapter } from './productPresentationContract';
import { isKiCliConversationAssistant } from './catalogs/kiBuddyAssistantIdentity';

const documentThemeObservers = new WeakMap<Document, MutationObserver>();

function updateProductTheme(root: Document, runtime: KiBuddyProductRuntime): void {
  const appearance = root.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  root.documentElement.setAttribute('data-product-theme', runtime.themes[appearance]);
}

function initializeKiBuddyDocument(root: Document, runtime: KiBuddyProductRuntime): void {
  const { brand } = runtime;
  const themeColor = root.defaultView?.getComputedStyle(root.documentElement).getPropertyValue('--primary').trim();
  if (themeColor) root.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColor);
  root.querySelector('link[rel="icon"]')?.setAttribute('href', brand.logoUrl);
  root.querySelector('link[rel="apple-touch-icon"]')?.setAttribute('href', brand.logoUrl);

  if (!documentThemeObservers.has(root) && root.defaultView?.MutationObserver) {
    const observer = new root.defaultView.MutationObserver(() => updateProductTheme(root, runtime));
    observer.observe(root.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    documentThemeObservers.set(root, observer);
  }
}

/** Creates the Ki-Buddy implementation of the renderer product presentation contract. */
export function createKiBuddyPresentationAdapter(runtime: KiBuddyProductRuntime): ProductPresentationAdapter {
  const { brand } = runtime;
  return {
    brand,
    adaptAgentIdentity<T extends AgentIdentity>(agent: T): T {
      if (agent.agent_type !== 'aionrs' || agent.agent_source !== 'internal') return agent;
      return {
        ...agent,
        name: brand.cliName,
        icon: brand.logoUrl,
        avatar: brand.logoUrl,
      };
    },
    adaptAgentLogo(agent, upstreamLogo) {
      return agent?.type === 'aionrs' && agent.source === 'internal' ? brand.logoUrl : upstreamLogo;
    },
    adaptAssistantIdentity<T extends AssistantIdentity>(assistant: T): T {
      const isBuiltinCli =
        assistant.source === 'generated' && assistant.agent?.type === 'aionrs' && assistant.agent.source === 'internal';
      if (!isBuiltinCli) return assistant;
      return {
        ...assistant,
        name: brand.cliName,
        name_i18n: Object.fromEntries(Object.keys(assistant.name_i18n ?? {}).map((locale) => [locale, brand.cliName])),
        avatar: brand.logoUrl,
      };
    },
    adaptAssistantDetailIdentity<T extends AssistantDetail>(detail: T): T {
      const isBuiltinCli =
        detail.source === 'generated' &&
        detail.engine.agent?.type === 'aionrs' &&
        detail.engine.agent.source === 'internal';
      if (!isBuiltinCli) return detail;
      return {
        ...detail,
        profile: {
          ...detail.profile,
          name: brand.cliName,
          name_i18n: Object.fromEntries(
            Object.keys(detail.profile.name_i18n ?? {}).map((locale) => [locale, brand.cliName])
          ),
          avatar: brand.logoUrl,
        },
      };
    },
    adaptConversationAssistantIdentity<T extends TConversationAssistantIdentity>(assistant: T): T {
      if (!isKiCliConversationAssistant(assistant)) return assistant;
      return {
        ...assistant,
        name: brand.cliName,
        avatar: brand.logoUrl,
      };
    },
    resolveDocumentTitle: () => brand.productName,
    initializeDocument(root) {
      initializeKiBuddyDocument(root, runtime);
    },
  };
}

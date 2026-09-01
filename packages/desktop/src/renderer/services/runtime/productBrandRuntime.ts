import aionUiLogoUrl from '@/renderer/assets/logos/brand/app.png';
import { configureAssistantPresentationMapper } from '@/common/adapter/ipcBridge';
import type { TConversationAssistantIdentity } from '@/common/config/storage';
import type { Assistant, AssistantAgent, AssistantDetail } from '@/common/types/agent/assistantTypes';
import { loadProductAgentCatalog, type ProductManagedAgent } from './kiBuddyAgentCatalog';
import { projectProductAssistantCatalog } from './catalogs/kiBuddyAssistantCatalog';
import {
  resolveKiBuddyConversationRuntimeAccess,
  type ConversationRuntimeAccess,
  type KiBuddyConversationRuntimeAccessInput,
} from './catalogs/kiBuddyAssistantIdentity';
import { reportHiddenProductResources } from './catalogs/kiBuddyProductResourceDiagnostics';
import { getKiBuddyProductRuntime } from './kiBuddyRuntime';
import { createKiBuddyPresentationAdapter } from './kiBuddyPresentationAdapter';
import type {
  AgentIdentity,
  AssistantIdentity,
  ProductPresentationAdapter,
  RendererBrand,
} from './productPresentationContract';

export type { ConversationRuntimeAccess } from './catalogs/kiBuddyAssistantIdentity';

declare const __APP_VERSION__: string;
declare const __KI_BUDDY_VERSION__: string;

export type { RendererBrand } from './productPresentationContract';

const AION_UI_DOWNLOAD_URL = 'https://www.aionui.com/';
const AION_UI_CONTACT_URL = 'https://x.com/WailiVery';
const AION_UI_SKILLS_MARKET_DETAILS = {
  en: 'https://github.com/iOfficeAI/AionUi/discussions/1325',
  zh: 'https://github.com/iOfficeAI/AionUi/discussions/1326',
};

const AION_UI_BRAND: RendererBrand = {
  cliName: 'Aion CLI',
  productName: 'AionUi',
  shortName: 'AionUi',
  description: 'A modern interface for command-line AI agents.',
  logoUrl: aionUiLogoUrl,
  mascotUrl: aionUiLogoUrl,
  links: {
    homepage: 'https://www.aionui.com',
    repository: 'https://github.com/iOfficeAI/AionUi',
    releases: 'https://github.com/iOfficeAI/AionUi/releases',
    support: 'https://github.com/iOfficeAI/AionUi/wiki',
    feedback: 'https://github.com/iOfficeAI/AionUi/issues/new',
  },
};

const AION_UI_PRESENTATION_ADAPTER: ProductPresentationAdapter = {
  brand: AION_UI_BRAND,
  adaptAgentIdentity: (agent) => agent,
  adaptAgentLogo: (_agent, upstreamLogo) => upstreamLogo,
  adaptAssistantIdentity: (assistant) => assistant,
  adaptAssistantDetailIdentity: (detail) => detail,
  adaptConversationAssistantIdentity: (assistant) => assistant,
  initializeDocument: () => {},
};

function getProductPresentationAdapter(): ProductPresentationAdapter {
  const runtime = getKiBuddyProductRuntime();
  return runtime ? createKiBuddyPresentationAdapter(runtime) : AION_UI_PRESENTATION_ADAPTER;
}

/** Returns the renderer brand selected by the explicit product capability. */
export function getRendererBrand(): RendererBrand {
  return getProductPresentationAdapter().brand;
}

/** Returns the active product release version while preserving the AionUi version without capability. */
export function getRendererAppVersion(): string {
  return getKiBuddyProductRuntime() ? __KI_BUDDY_VERSION__ : __APP_VERSION__;
}

/** Applies product-owned identity only to the internal CLI supplied with the desktop app. */
export function adaptProductAgentIdentity<T extends AgentIdentity>(agent: T): T {
  return getProductPresentationAdapter().adaptAgentIdentity(agent);
}

/** Fetches the managed-agent catalog with product identity applied at one shared boundary. */
export async function fetchProductManagedAgents(): Promise<ProductManagedAgent[]> {
  const catalog = await loadProductAgentCatalog();
  return catalog.visibleAgents.map(adaptProductAgentIdentity);
}

/** Resolves the product logo for views that display the internal CLI as an assistant runtime. */
export function adaptProductAgentLogo(agent: AssistantAgent | undefined, upstreamLogo: string | null): string | null {
  return getProductPresentationAdapter().adaptAgentLogo(agent, upstreamLogo);
}

/** Applies product-owned identity to assistants backed by the internal desktop CLI. */
export function adaptProductAssistantIdentity<T extends AssistantIdentity>(assistant: T): T {
  return getProductPresentationAdapter().adaptAssistantIdentity(assistant);
}

/** Applies product-owned identity to the generated internal CLI assistant detail. */
export function adaptProductAssistantDetailIdentity<T extends AssistantDetail>(detail: T): T {
  return getProductPresentationAdapter().adaptAssistantDetailIdentity(detail);
}

/** Applies product identity to the built-in CLI snapshot stored on existing conversations. */
export function adaptProductConversationAssistantIdentity<T extends TConversationAssistantIdentity>(assistant: T): T {
  return getProductPresentationAdapter().adaptConversationAssistantIdentity(assistant);
}

/** Resolves persisted-conversation runtime access without exposing product policy to upstream callers. */
export function resolveProductConversationRuntimeAccess(
  input: KiBuddyConversationRuntimeAccessInput
): ConversationRuntimeAccess {
  const runtime = getKiBuddyProductRuntime();
  return runtime
    ? resolveKiBuddyConversationRuntimeAccess(input, runtime.productExperience, runtime.integrations)
    : 'allowed';
}

/** Installs product identity once at the shared assistant catalog boundary. */
export function installProductAssistantCatalogAdapter(): void {
  const runtime = getKiBuddyProductRuntime();
  if (!runtime) return;
  configureAssistantPresentationMapper({
    detail: adaptProductAssistantDetailIdentity,
    list: (assistants: Assistant[]) => {
      const catalog = projectProductAssistantCatalog(assistants, runtime.productExperience, runtime.integrations);
      reportHiddenProductResources('assistant', catalog.hiddenResources);
      return catalog.visibleAssistants.map(adaptProductAssistantIdentity);
    },
  });
}

/** Resolves an upstream GitHub resource through the active product capability. */
export function getProductGitHubResourceUrl(upstreamUrl: string): string | null {
  const runtime = getKiBuddyProductRuntime();
  if (runtime?.productExperience.featureState('githubResources') === 'disabled') return null;
  return upstreamUrl;
}

/** Keeps the upstream download target unless product policy hides GitHub resources. */
export function getProductDownloadUrl(): string | null {
  const runtime = getKiBuddyProductRuntime();
  return getProductGitHubResourceUrl(runtime?.brand.links.releases ?? AION_UI_DOWNLOAD_URL);
}

/** Preserves the upstream author link while products use their configured support channel. */
export function getProductContactUrl(): string {
  return getKiBuddyProductRuntime()?.brand.links.support ?? AION_UI_CONTACT_URL;
}

/** Keeps a specific upstream guide unless product policy hides GitHub resources. */
export function getProductDocumentationUrl(upstreamUrl: string): string | null {
  const runtime = getKiBuddyProductRuntime();
  return getProductGitHubResourceUrl(runtime?.brand.links.support ?? upstreamUrl);
}

/** Selects skill details unless product policy hides GitHub resources. */
export function getProductSkillsMarketDetailsUrl(language: string): string | null {
  const runtime = getKiBuddyProductRuntime();
  return getProductGitHubResourceUrl(
    runtime?.brand.links.support ?? AION_UI_SKILLS_MARKET_DETAILS[language.startsWith('zh') ? 'zh' : 'en']
  );
}

/** Applies product metadata synchronously before React mounts its first business frame. */
export function initializeRendererBrand(root: Document = document): void {
  getProductPresentationAdapter().initializeDocument(root);
}

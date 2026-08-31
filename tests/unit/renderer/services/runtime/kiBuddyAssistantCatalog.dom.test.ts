import type { ProductExperience } from '@/common/platform/ki-buddy';
import type { Assistant } from '@/common/types/agent/assistantTypes';
import { createAionUiProductExperience, createKiBuddyProductExperience } from '@/common/platform/ki-buddy';
import { projectProductAssistantCatalog } from '@/renderer/services/runtime/catalogs/kiBuddyAssistantCatalog';
import { KI_BUDDY_PRODUCT_RESOURCE_REGISTRY } from '@/renderer/services/runtime/catalogs/kiBuddyResourceRegistry';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import productConfig from '../../../../../ki-buddy-product.json';

const { listAssistantsMock } = vi.hoisted(() => ({ listAssistantsMock: vi.fn() }));

vi.mock('@/common', () => ({
  ipcBridge: {
    assistants: {
      list: { invoke: listAssistantsMock },
    },
  },
}));

const assistant = (overrides: Partial<Assistant> & Pick<Assistant, 'id' | 'source'>): Assistant => ({
  id: overrides.id,
  source: overrides.source,
  name: overrides.id,
  name_i18n: {},
  description_i18n: {},
  enabled: true,
  sort_order: 0,
  agent_id: '632f31d2',
  agent: { type: 'aionrs', source: 'internal' },
  enabled_skills: [],
  custom_skill_names: [],
  disabled_builtin_skills: [],
  context_i18n: {},
  prompts: [],
  prompts_i18n: {},
  models: [],
  agent_status: 'online',
  team_selectable: true,
  deletable: false,
  ...overrides,
});

const kiBuddyExperience = (): ProductExperience => createKiBuddyProductExperience(productConfig.experience);

describe('projectProductAssistantCatalog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows product built-in and Custom Assistants with their expected origins', () => {
    const productAssistants = Object.values(KI_BUDDY_PRODUCT_RESOURCE_REGISTRY.assistant).map(({ id, source }) =>
      assistant({ id, source })
    );
    const catalog = projectProductAssistantCatalog(
      [
        ...productAssistants,
        assistant({ id: 'my-assistant', source: 'user', deletable: true }),
        assistant({ id: 'cowork', source: 'builtin' }),
      ],
      kiBuddyExperience()
    );

    const productEntries = catalog.entries.filter(({ assistant: entry }) =>
      productAssistants.some(({ id }) => id === entry.id)
    );
    expect(productEntries).toHaveLength(productAssistants.length);
    expect(productEntries.every(({ access, origin }) => access === 'manage' && origin === 'productBuiltin')).toBe(true);
    expect(catalog.entries.find(({ assistant: entry }) => entry.id === 'my-assistant')).toMatchObject({
      access: 'manage',
      origin: 'custom',
    });
  });

  it('hides upstream, Extension, and unknown Assistants with structured diagnostics', () => {
    const catalog = projectProductAssistantCatalog(
      [
        assistant({ id: 'cowork', source: 'builtin' }),
        assistant({
          id: 'extension-assistant',
          source: 'generated',
          agent: { type: 'acp', source: 'extension' },
        }),
        assistant({ id: 'future-assistant', source: 'future' as Assistant['source'] }),
      ],
      kiBuddyExperience()
    );

    expect(catalog.visibleAssistants).toEqual([]);
    expect(catalog.hiddenResources.map(({ resourceId, origin }) => ({ resourceId, origin }))).toEqual([
      { resourceId: 'cowork', origin: 'upstreamBuiltin' },
      { resourceId: 'extension-assistant', origin: 'extension' },
      { resourceId: 'future-assistant', origin: 'unclassified' },
    ]);
    expect(catalog.hiddenResources.every(({ code }) => code === 'product_resource_hidden')).toBe(true);
  });

  it('hides the Agents execution Assistant when the Agents Gateway integration is unavailable', () => {
    const agentsExecution = KI_BUDDY_PRODUCT_RESOURCE_REGISTRY.assistant.agentsExecution;
    const word = KI_BUDDY_PRODUCT_RESOURCE_REGISTRY.assistant.word;
    const catalog = projectProductAssistantCatalog(
      [
        assistant({ id: agentsExecution.id, source: agentsExecution.source }),
        assistant({ id: word.id, source: word.source }),
      ],
      kiBuddyExperience(),
      []
    );

    expect(catalog.visibleAssistants.map(({ id }) => id)).toEqual([word.id]);
    expect(catalog.hiddenResources).toContainEqual(
      expect.objectContaining({ resourceId: agentsExecution.id, origin: 'productBuiltin' })
    );
  });

  it('keeps every Assistant visible and manageable in AionUi', () => {
    const candidates = [
      assistant({ id: 'word-creator', source: 'builtin' }),
      assistant({ id: 'cowork', source: 'builtin' }),
      assistant({ id: 'my-assistant', source: 'user' }),
      assistant({
        id: 'extension-assistant',
        source: 'generated',
        agent: { type: 'acp', source: 'extension' },
      }),
    ];

    const catalog = projectProductAssistantCatalog(candidates, createAionUiProductExperience());

    expect(catalog.visibleAssistants.map(({ id, productAccess }) => ({ id, productAccess }))).toEqual(
      candidates.map(({ id }) => ({ id, productAccess: 'manage' }))
    );
    expect(catalog.hiddenResources).toEqual([]);
  });
});

describe('loadProductBuiltinAssistantResourceState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports a missing product Assistant instead of accepting a similarly named builtin', async () => {
    const assistantDefinitions = Object.values(KI_BUDDY_PRODUCT_RESOURCE_REGISTRY.assistant);
    const missingAssistant = assistantDefinitions.find((definition) => 'resourceName' in definition);
    if (!missingAssistant) throw new Error('The product Assistant registry requires one named test fixture.');
    const availableAssistants = assistantDefinitions.filter(({ id }) => id !== missingAssistant.id);
    listAssistantsMock.mockResolvedValue([
      assistant({
        id: 'renamed-product-assistant',
        source: missingAssistant.source,
        name: missingAssistant.resourceName,
      }),
      ...availableAssistants.map(({ id, source }) => assistant({ id, source })),
    ]);

    const { loadProductBuiltinAssistantResourceState } =
      await import('@/renderer/services/runtime/catalogs/kiBuddyAssistantCatalog');

    await expect(loadProductBuiltinAssistantResourceState(kiBuddyExperience())).resolves.toEqual({
      status: 'invalid',
      missing: [
        expect.objectContaining({
          code: 'required_product_resource_missing',
          kind: 'assistant',
          resourceId: missingAssistant.id,
        }),
      ],
    });
  });

  it('keeps integrity pending when the Assistant directory is unavailable', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    listAssistantsMock.mockRejectedValue(new Error('catalog unavailable'));
    const { loadProductBuiltinAssistantResourceState } =
      await import('@/renderer/services/runtime/catalogs/kiBuddyAssistantCatalog');

    await expect(loadProductBuiltinAssistantResourceState(kiBuddyExperience())).resolves.toEqual({
      status: 'pending',
      missing: [],
    });
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

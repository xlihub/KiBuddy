/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAionUiProductExperience, createKiBuddyProductExperience } from '@/common/platform/ki-buddy';
import {
  filterProductVisibleSkillNames,
  loadProductSkillCatalog,
  projectProductSkillCatalog,
} from '@/renderer/services/runtime/kiBuddySkillCatalog';
import productConfig from '../../../../../ki-buddy-product.json';

const { listAvailableSkillsMock } = vi.hoisted(() => ({ listAvailableSkillsMock: vi.fn() }));

vi.mock('@/common', () => ({
  ipcBridge: {
    fs: {
      listAvailableSkills: { invoke: listAvailableSkillsMock },
    },
  },
}));

describe('projectProductSkillCatalog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('filters runtime-loaded names to the product-visible catalog', () => {
    expect(
      filterProductVisibleSkillNames(
        ['officecli-docx', 'cron', 'aionui-config'],
        [
          {
            name: 'officecli-docx',
            description: 'Word documents',
            location: '/builtin/officecli-docx/SKILL.md',
            relative_location: 'officecli-docx/SKILL.md',
            is_auto_inject: false,
            is_custom: false,
            source: 'builtin',
          },
          {
            name: 'cron',
            description: 'Scheduled task management',
            location: '/builtin/auto-inject/cron/SKILL.md',
            relative_location: 'auto-inject/cron/SKILL.md',
            is_auto_inject: true,
            is_custom: false,
            source: 'builtin',
          },
        ]
      )
    ).toEqual(['officecli-docx', 'cron']);
  });

  it('preserves AionUi loaded Skill names while the catalog is unavailable', () => {
    expect(
      filterProductVisibleSkillNames(['officecli-docx', 'aionui-config'], undefined, createAionUiProductExperience())
    ).toEqual(['officecli-docx', 'aionui-config']);
  });

  it('does not expose Ki-Buddy loaded Skill names before the projected catalog is available', () => {
    expect(
      filterProductVisibleSkillNames(
        ['officecli-docx', 'aionui-config'],
        undefined,
        createKiBuddyProductExperience(productConfig.experience)
      )
    ).toEqual([]);
  });

  it('hides the Agents execution Skill when the Agents Gateway integration is unavailable', () => {
    const result = projectProductSkillCatalog(
      [
        {
          name: 'ki-buddy-agents-execution',
          description: 'Agents execution',
          location: '/builtin/ki-buddy-agents-execution/SKILL.md',
          relative_location: 'ki-buddy-agents-execution/SKILL.md',
          is_auto_inject: false,
          is_custom: false,
          source: 'builtin',
        },
      ],
      createKiBuddyProductExperience(productConfig.experience),
      []
    );

    expect(result.visibleSkills).toEqual([]);
    expect(result.hiddenResources).toContainEqual(
      expect.objectContaining({ resourceId: 'builtin:ki-buddy-agents-execution', origin: 'productBuiltin' })
    );
  });

  it('keeps a Custom Skill with the Agents execution name when the Agents Gateway integration is unavailable', () => {
    const customSkill = {
      name: 'ki-buddy-agents-execution',
      description: 'User-defined workflow',
      location: '/custom/ki-buddy-agents-execution/SKILL.md',
      relative_location: 'ki-buddy-agents-execution/SKILL.md',
      is_auto_inject: false,
      is_custom: true,
      source: 'custom' as const,
    };

    const result = projectProductSkillCatalog(
      [customSkill],
      createKiBuddyProductExperience(productConfig.experience),
      []
    );

    expect(result.entries).toEqual([
      expect.objectContaining({ resourceId: 'custom:ki-buddy-agents-execution', origin: 'custom', access: 'manage' }),
    ]);
    expect(result.visibleSkills).toEqual([customSkill]);
  });

  it('shows Office, Custom, and non-excluded auto-injected skills while recording hidden resources', () => {
    const result = projectProductSkillCatalog(
      [
        {
          name: 'officecli-docx',
          description: 'Word documents',
          location: '/builtin/officecli-docx/SKILL.md',
          relative_location: 'officecli-docx/SKILL.md',
          is_auto_inject: false,
          is_custom: false,
          source: 'builtin',
        },
        {
          name: 'officecli-pptx',
          description: 'PowerPoint presentations',
          location: '/builtin/officecli-pptx/SKILL.md',
          relative_location: 'officecli-pptx/SKILL.md',
          is_auto_inject: false,
          is_custom: false,
          source: 'builtin',
        },
        {
          name: 'officecli-xlsx',
          description: 'Excel workbooks',
          location: '/builtin/officecli-xlsx/SKILL.md',
          relative_location: 'officecli-xlsx/SKILL.md',
          is_auto_inject: false,
          is_custom: false,
          source: 'builtin',
        },
        {
          name: 'team-workflow',
          description: 'User skill',
          location: '/user/team-workflow/SKILL.md',
          is_auto_inject: false,
          is_custom: true,
          source: 'custom',
        },
        {
          name: 'mermaid',
          description: 'Upstream built-in',
          location: '/builtin/mermaid/SKILL.md',
          relative_location: 'mermaid/SKILL.md',
          is_auto_inject: false,
          is_custom: false,
          source: 'builtin',
        },
        {
          name: 'cron',
          description: 'Auto-injected runtime skill',
          location: '/builtin/cron/SKILL.md',
          relative_location: 'auto-inject/cron/SKILL.md',
          is_auto_inject: true,
          is_custom: false,
          source: 'builtin',
        },
        {
          name: 'officecli',
          description: 'Auto-injected Office CLI skill',
          location: '/builtin/officecli/SKILL.md',
          relative_location: 'auto-inject/officecli/SKILL.md',
          is_auto_inject: true,
          is_custom: false,
          source: 'builtin',
        },
        {
          name: 'skill-creator',
          description: 'Auto-injected skill creator',
          location: '/builtin/skill-creator/SKILL.md',
          relative_location: 'auto-inject/skill-creator/SKILL.md',
          is_auto_inject: true,
          is_custom: false,
          source: 'builtin',
        },
        {
          name: 'aionui-config',
          description: 'Excluded product configuration skill',
          location: '/builtin/aionui-config/SKILL.md',
          relative_location: 'auto-inject/aionui-config/SKILL.md',
          is_auto_inject: true,
          is_custom: false,
          source: 'builtin',
        },
        {
          name: 'extension-skill',
          description: 'Extension skill',
          location: '/extension/skill/SKILL.md',
          is_auto_inject: false,
          is_custom: false,
          source: 'extension',
        },
        {
          name: 'future-skill',
          description: 'Future source',
          location: '/future/skill/SKILL.md',
          is_auto_inject: false,
          is_custom: false,
          source: 'future',
        },
      ],
      createKiBuddyProductExperience(productConfig.experience)
    );

    expect(result.entries.map(({ skill, origin, access }) => ({ name: skill.name, origin, access }))).toEqual([
      { name: 'officecli-docx', origin: 'productBuiltin', access: 'use' },
      { name: 'officecli-pptx', origin: 'productBuiltin', access: 'use' },
      { name: 'officecli-xlsx', origin: 'productBuiltin', access: 'use' },
      { name: 'team-workflow', origin: 'custom', access: 'manage' },
      { name: 'cron', origin: 'upstreamBuiltin', access: 'use' },
      { name: 'officecli', origin: 'upstreamBuiltin', access: 'use' },
      { name: 'skill-creator', origin: 'upstreamBuiltin', access: 'use' },
    ]);
    expect(result.hiddenResources).toEqual([
      expect.objectContaining({ resourceId: 'builtin:mermaid', origin: 'upstreamBuiltin' }),
      expect.objectContaining({
        resourceId: 'builtin:aionui-config',
        origin: 'upstreamBuiltin',
      }),
      expect.objectContaining({ resourceId: 'extension:extension-skill', origin: 'extension' }),
      expect.objectContaining({ resourceId: 'unclassified:future-skill', origin: 'unclassified' }),
    ]);
    expect(result.hiddenResources[0]).not.toHaveProperty('location');
    expect(result.hiddenResources[0]).not.toHaveProperty('description');
  });

  it('identifies an Office product Skill by stable backend name instead of installation path', () => {
    const result = projectProductSkillCatalog(
      [
        {
          name: 'officecli-docx',
          description: 'Name collision',
          location: '/builtin/other/SKILL.md',
          relative_location: 'other/SKILL.md',
          is_auto_inject: false,
          is_custom: false,
          source: 'builtin',
        },
      ],
      createKiBuddyProductExperience(productConfig.experience)
    );

    expect(result.entries).toEqual([
      expect.objectContaining({ resourceId: 'builtin:officecli-docx', origin: 'productBuiltin' }),
    ]);
    expect(result.hiddenResources).toEqual([]);
  });

  it('keeps the complete Skill catalog manageable when the Ki-Buddy capability is absent', () => {
    const skills = [
      {
        name: 'mermaid',
        description: 'Upstream built-in',
        location: '/builtin/mermaid/SKILL.md',
        relative_location: 'mermaid/SKILL.md',
        is_auto_inject: false,
        is_custom: false,
        source: 'builtin',
      },
      {
        name: 'cron',
        description: 'Auto-injected runtime skill',
        location: '/builtin/cron/SKILL.md',
        relative_location: 'auto-inject/cron/SKILL.md',
        is_auto_inject: true,
        is_custom: false,
        source: 'builtin',
      },
      {
        name: 'extension-skill',
        description: 'Extension skill',
        location: '/extension/skill/SKILL.md',
        is_auto_inject: false,
        is_custom: false,
        source: 'extension',
      },
    ];

    const result = projectProductSkillCatalog(skills, createAionUiProductExperience());

    expect(result.visibleSkills).toEqual(skills);
    expect(result.entries.every(({ access }) => access === 'manage')).toBe(true);
    expect(result.hiddenResources).toEqual([]);
  });
});

describe('loadProductSkillCatalog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits structured diagnostics for Skills hidden by the active product policy', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    listAvailableSkillsMock.mockResolvedValue([
      {
        name: 'mermaid',
        description: 'Upstream built-in',
        location: '/builtin/mermaid/SKILL.md',
        relative_location: 'mermaid/SKILL.md',
        is_auto_inject: false,
        is_custom: false,
        source: 'builtin',
      },
    ]);

    const catalog = await loadProductSkillCatalog(createKiBuddyProductExperience(productConfig.experience));

    expect(info).toHaveBeenCalledWith(
      '[ProductExperience] Skill resources hidden by product policy',
      expect.objectContaining({ code: 'product_resource_projection', resources: catalog.hiddenResources })
    );
    info.mockRestore();
  });

  it('preserves the bridge rejection when the Skill catalog cannot be loaded', async () => {
    const error = new Error('catalog unavailable');
    listAvailableSkillsMock.mockRejectedValue(error);

    await expect(loadProductSkillCatalog(createKiBuddyProductExperience(productConfig.experience))).rejects.toBe(error);
  });
});

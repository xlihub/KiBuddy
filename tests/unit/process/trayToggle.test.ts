/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('electron', () => ({
  app: { name: 'AionUi' },
  Menu: { buildFromTemplate: vi.fn((items) => ({ items })), setApplicationMenu: vi.fn() },
}));

vi.mock('@/common/electronSafe', () => ({
  electronApp: {
    dock: null,
    exit: vi.fn(),
    isPackaged: false,
    quit: vi.fn(),
    relaunch: vi.fn(),
  },
  electronMenu: { buildFromTemplate: vi.fn((items) => ({ items })) },
  electronNativeImage: { createFromPath: vi.fn() },
  electronTray: vi.fn(),
}));

import {
  collectTrayMenuLabels,
  configureTrayProductExperience,
  createTrayContextMenuTemplate,
  formatTrayBrandText,
  shouldShowFromTray,
} from '@/process/utils/tray';
import { createApplicationMenuTemplate } from '@/process/utils/appMenu';
import {
  KI_BUDDY_PRODUCT_CONFIG_RESULT,
  createAionUiProductExperience,
  createKiBuddyProductExperience,
} from '@/common/platform/ki-buddy';
import i18n from '@process/services/i18n';

function createZxjtExperience() {
  const policy = KI_BUDDY_PRODUCT_CONFIG_RESULT.config!.experience;
  return createKiBuddyProductExperience({
    ...policy,
    features: {
      ...policy.features,
      about: 'disabled',
      feedback: 'disabled',
      githubResources: 'disabled',
    },
  });
}

function readZxjtPreviewApplicationName(): string {
  const registry = JSON.parse(readFileSync(resolve(process.cwd(), 'distributions/registry.json'), 'utf8'));
  return registry.registrations.find(({ distributionId }: { distributionId: string }) => distributionId === 'zxjt')
    .identities.preview.applicationName;
}

afterEach(() => {
  configureTrayProductExperience(createAionUiProductExperience());
});

describe('shouldShowFromTray', () => {
  it('shows when window is not visible', () => {
    expect(shouldShowFromTray(false, false)).toBe(true);
  });

  it('shows when window is minimized', () => {
    expect(shouldShowFromTray(true, true)).toBe(true);
  });

  it('hides when window is visible and not minimized', () => {
    expect(shouldShowFromTray(true, false)).toBe(false);
  });
});

describe('tray brand text', () => {
  it('uses the configured product name without changing unrelated translated text', () => {
    expect(formatTrayBrandText('Show AionUi', 'Ki-Buddy')).toBe('Show Ki-Buddy');
    expect(formatTrayBrandText('Recent conversations', 'Ki-Buddy')).toBe('Recent conversations');
  });
});

describe('collectTrayMenuLabels', () => {
  it('records nested tray contributions as stable label paths', () => {
    expect(
      collectTrayMenuLabels([
        { label: 'Show Ki-Buddy' },
        { label: 'Desktop Pet', submenu: { items: [{ label: 'Show / Hide' }, { label: 'Small' }] } },
      ])
    ).toEqual(['Show Ki-Buddy', 'Desktop Pet', 'Desktop Pet > Show / Hide', 'Desktop Pet > Small']);
  });

  it('ignores separators and empty submenus without producing empty paths', () => {
    expect(collectTrayMenuLabels([{ submenu: { items: [] } }, {}, { label: '  ' }])).toEqual([]);
  });
});

describe('GitHub product resource menus', () => {
  it('removes About and update items from the zxjt application menu while preserving defaults', () => {
    const applicationName = readZxjtPreviewApplicationName();
    const zxjtTemplate = createApplicationMenuTemplate(createZxjtExperience(), true, applicationName);
    const defaultTemplate = createApplicationMenuTemplate(createAionUiProductExperience(), true, 'AionUi');
    const zxjtRoles = JSON.stringify(zxjtTemplate.map(({ role, submenu }) => ({ role, submenu })));
    const defaultRoles = JSON.stringify(defaultTemplate.map(({ role, submenu }) => ({ role, submenu })));

    expect(applicationName).toBe('Ki-Buddy');
    expect(JSON.stringify(zxjtTemplate)).not.toMatch(/zxjt|中信建投/iu);
    expect(zxjtTemplate.some(({ label }) => label === 'Help')).toBe(false);
    expect(zxjtRoles).not.toContain('about');
    expect(defaultTemplate.some(({ label }) => label === 'Help')).toBe(true);
    expect(defaultRoles).toContain('about');
  });

  it('controls native About and GitHub updates through separate product features', () => {
    const policy = KI_BUDDY_PRODUCT_CONFIG_RESULT.config!.experience;
    const withoutAbout = createKiBuddyProductExperience({
      ...policy,
      features: { ...policy.features, about: 'disabled' },
    });
    const withoutGitHubResources = createKiBuddyProductExperience({
      ...policy,
      features: { ...policy.features, githubResources: 'disabled' },
    });

    const withoutAboutTemplate = createApplicationMenuTemplate(withoutAbout, true, 'Ki-Buddy');
    const withoutGitHubResourcesTemplate = createApplicationMenuTemplate(withoutGitHubResources, true, 'Ki-Buddy');

    expect(JSON.stringify(withoutAboutTemplate)).not.toContain('about');
    expect(withoutAboutTemplate.some(({ label }) => label === 'Help')).toBe(true);
    expect(JSON.stringify(withoutGitHubResourcesTemplate)).toContain('about');
    expect(withoutGitHubResourcesTemplate.some(({ label }) => label === 'Help')).toBe(false);
  });

  it('removes About and update items from the zxjt tray while preserving defaults', () => {
    configureTrayProductExperience(createZxjtExperience());
    const zxjtLabels = createTrayContextMenuTemplate([], 0).flatMap(({ label }) => (label ? [label] : []));

    expect(zxjtLabels).not.toContain(i18n.t('common.tray.checkUpdate'));
    expect(zxjtLabels).not.toContain(formatTrayBrandText(i18n.t('common.tray.about'), 'AionUi'));

    configureTrayProductExperience(createAionUiProductExperience());
    const defaultLabels = createTrayContextMenuTemplate([], 0).flatMap(({ label }) => (label ? [label] : []));
    expect(defaultLabels).toContain(i18n.t('common.tray.checkUpdate'));
    expect(defaultLabels).toContain(formatTrayBrandText(i18n.t('common.tray.about'), 'AionUi'));
  });
});

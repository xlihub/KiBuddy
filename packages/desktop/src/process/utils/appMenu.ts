/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { MenuItemConstructorOptions } from 'electron';
import { Menu, app } from 'electron';
import { isProductFeatureEnabled, type ProductExperience } from '@/common/platform/ki-buddy';

/** Returns whether GitHub-backed update resources are available for the selected product. */
export function shouldShowGitHubProductResources(productExperience?: ProductExperience): boolean {
  return isProductFeatureEnabled(productExperience, 'githubResources');
}

/** Returns whether the native About command is available for the selected product. */
export function shouldShowAboutProductResource(productExperience?: ProductExperience): boolean {
  return isProductFeatureEnabled(productExperience, 'about');
}

/** Builds the application menu so product resource visibility can be verified without installing it. */
export function createApplicationMenuTemplate(
  productExperience?: ProductExperience,
  isMac = process.platform === 'darwin',
  applicationName = app.name
): MenuItemConstructorOptions[] {
  const githubResourcesEnabled = shouldShowGitHubProductResources(productExperience);
  const aboutEnabled = shouldShowAboutProductResource(productExperience);

  const template: MenuItemConstructorOptions[] = [];

  if (isMac) {
    template.push({
      label: applicationName,
      submenu: [
        ...(aboutEnabled ? ([{ role: 'about' }, { type: 'separator' }] as MenuItemConstructorOptions[]) : []),
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    });
  }

  template.push({
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      ...(isMac
        ? ([{ role: 'pasteAndMatchStyle' }, { role: 'delete' }, { role: 'selectAll' }] as MenuItemConstructorOptions[])
        : ([{ role: 'delete' }, { type: 'separator' }, { role: 'selectAll' }] as MenuItemConstructorOptions[])),
    ],
  });

  template.push({
    label: 'View',
    submenu: [
      { role: 'reload' },
      { role: 'forceReload' },
      { role: 'toggleDevTools' },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
    ],
  });

  if (githubResourcesEnabled) {
    template.push({
      label: 'Help',
      submenu: [
        {
          label: 'Check for Updates...',
          click: () => {
            ipcBridge.update.open.emit({ source: 'menu' });
          },
        },
      ],
    });
  }

  return template;
}

/** Installs the native application menu for the selected product. */
export function setupApplicationMenu(productExperience?: ProductExperience): void {
  const menu = Menu.buildFromTemplate(createApplicationMenuTemplate(productExperience));
  Menu.setApplicationMenu(menu);
}

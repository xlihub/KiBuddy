import { render } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KI_BUDDY_PRODUCT_CAPABILITY } from '@/common/platform/ki-buddy';
import { createKiBuddyAccountSettingsItem } from '@/renderer/pages/ki-buddy/settingsNavigation';
import SettingsSider, { getSettingsNavigationProjection } from '@/renderer/pages/settings/components/SettingsSider';

const translateKey = (key: string) => key;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: translateKey }),
}));

vi.mock('@/renderer/hooks/system/useExtensionSettingsTabs', () => ({
  useExtensionSettingsTabs: () => [],
}));

vi.mock('@/renderer/hooks/system/useExtI18n', () => ({
  useExtI18n: () => ({ resolveExtTabName: (tab: { label: string }) => tab.label }),
}));

describe('Ki-Buddy settings navigation', () => {
  beforeEach(() => {
    window.electronAPI = { ...window.electronAPI, kiBuddyAuth: undefined };
    window.__kiBuddyProductPresentation = null;
  });

  it('builds the account entry for the product runtime', () => {
    expect(createKiBuddyAccountSettingsItem(translateKey)).toMatchObject({ id: 'account', path: 'account' });
  });

  it('adds the product entry only when the Ki-Buddy capability is present', () => {
    expect(getSettingsNavigationProjection(true, translateKey).items.some(({ id }) => id === 'account')).toBe(false);
    window.electronAPI = {
      ...window.electronAPI,
      kiBuddyAuth: {
        getSession: vi.fn(),
        login: vi.fn(),
        logout: vi.fn(),
      },
    };
    window.__kiBuddyProductPresentation = KI_BUDDY_PRODUCT_CAPABILITY;

    expect(getSettingsNavigationProjection(true, translateKey).items[0]?.id).toBe('account');
  });

  it.each(['account', 'agent'])('uses the shared selected navigation contract for %s', (settingsId) => {
    window.electronAPI = {
      ...window.electronAPI,
      kiBuddyAuth: {
        getSession: vi.fn(),
        login: vi.fn(),
        logout: vi.fn(),
      },
    };
    window.__kiBuddyProductPresentation = KI_BUDDY_PRODUCT_CAPABILITY;

    const { container } = render(
      <MemoryRouter initialEntries={[`/settings/${settingsId}`]}>
        <SettingsSider />
      </MemoryRouter>
    );

    const selectedItem = container.querySelector(`[data-settings-id="${settingsId}"]`);
    const selectedIcon = selectedItem?.querySelector('.settings-sider__item-icon .i-icon');

    expect(selectedItem).toHaveAttribute('data-selected', 'true');
    expect(selectedItem).toHaveClass('!bg-fill-3');
    expect(selectedIcon).not.toHaveAttribute('style');
  });

  it('uses the same icon markup without the product capability', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/settings/agent']}>
        <SettingsSider />
      </MemoryRouter>
    );

    const agentIcon = container.querySelector('[data-settings-id="agent"] .settings-sider__item-icon .i-icon');

    expect(agentIcon).not.toHaveAttribute('style');
  });

  it('removes About from navigation when the project product disables GitHub-facing content', () => {
    window.__kiBuddyProductPresentation = {
      ...KI_BUDDY_PRODUCT_CAPABILITY,
      experience: {
        ...KI_BUDDY_PRODUCT_CAPABILITY.experience,
        features: {
          ...KI_BUDDY_PRODUCT_CAPABILITY.experience.features,
          about: 'disabled',
        },
      },
    };

    expect(getSettingsNavigationProjection(true, translateKey).items.some(({ id }) => id === 'about')).toBe(false);
  });
});

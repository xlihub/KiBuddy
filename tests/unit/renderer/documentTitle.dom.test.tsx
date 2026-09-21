/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, render } from '@testing-library/react';
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { KI_BUDDY_PRODUCT_CAPABILITY } from '@/common/platform/ki-buddy';

let mockLanguage = 'en-US';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => (mockLanguage === 'zh-CN' ? `zh:${key}` : key),
    i18n: { language: mockLanguage },
  }),
}));

import DocumentTitle, { titleForPath } from '@/renderer/components/layout/DocumentTitle';

describe('titleForPath', () => {
  const t = (key: string) => `t(${key})`;

  it('uses the login title on the login route only', () => {
    expect(titleForPath('/login', t)).toBe('t(login.pageTitle)');
    expect(titleForPath('/guid', t)).toBe('AionUi');
    expect(titleForPath('/conversation/abc', t)).toBe('AionUi');
    expect(titleForPath('/settings/agent', t)).toBe('AionUi');
  });
});

describe('DocumentTitle', () => {
  it('resets the title to AionUi after leaving the login page', () => {
    // The old behaviour set document.title once on the login page and never
    // updated it again, so post-login pages kept the login title.
    document.title = 'AionUi - stale login title';
    render(
      <MemoryRouter initialEntries={['/guid']}>
        <DocumentTitle />
      </MemoryRouter>
    );
    expect(document.title).toBe('AionUi');
  });

  it('sets the localised login title on the login route', () => {
    mockLanguage = 'zh-CN';
    render(
      <MemoryRouter initialEntries={['/login']}>
        <DocumentTitle />
      </MemoryRouter>
    );
    expect(document.title).toBe('zh:login.pageTitle');
    mockLanguage = 'en-US';
  });
});

describe('product document title across navigation', () => {
  beforeEach(() => {
    mockLanguage = 'en-US';
    window.__kiBuddyProductBootstrapError = null;
    window.__kiBuddyProductPresentation = null;
  });
  afterEach(() => {
    window.__kiBuddyProductPresentation = null;
    mockLanguage = 'en-US';
  });
  it.each([true, false])('keeps the final route title correct with capability=%s', async (withProduct) => {
    window.__kiBuddyProductPresentation = withProduct ? KI_BUDDY_PRODUCT_CAPABILITY : null;
    document.title = 'stale title';
    const router = createMemoryRouter([{ path: '*', element: <DocumentTitle /> }], { initialEntries: ['/login'] });
    render(<RouterProvider router={router} />);
    expect(document.title).toBe(withProduct ? 'Ki-Buddy' : 'login.pageTitle');
    for (const pathname of ['/guid', '/scheduled', '/conversation/abc', '/login']) {
      await act(() => router.navigate(pathname));
      expect(document.title).toBe(withProduct ? 'Ki-Buddy' : pathname === '/login' ? 'login.pageTitle' : 'AionUi');
    }
    router.dispose();
  });
  it('uses the configured product name after mounting and changing language', () => {
    if (!KI_BUDDY_PRODUCT_CAPABILITY) throw new Error('Missing product fixture');
    window.__kiBuddyProductPresentation = {
      ...KI_BUDDY_PRODUCT_CAPABILITY,
      brand: { ...KI_BUDDY_PRODUCT_CAPABILITY.brand, productName: 'Configured Buddy' },
    };
    const view = render(
      <MemoryRouter initialEntries={['/login']}>
        <DocumentTitle />
      </MemoryRouter>
    );
    expect(document.title).toBe('Configured Buddy');
    mockLanguage = 'zh-CN';
    view.rerender(
      <MemoryRouter initialEntries={['/login']}>
        <DocumentTitle />
      </MemoryRouter>
    );
    expect(document.title).toBe('Configured Buddy');
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { KI_BUDDY_PRODUCT_CAPABILITY } from '@/common/platform/ki-buddy';

const rendererHtml = readFileSync(
  resolve(__dirname, '../../../../../packages/desktop/src/renderer/index.html'),
  'utf8'
);

function renderBootstrap(options?: {
  appearance?: 'light' | 'dark';
  bootstrapError?: string;
  capability?: typeof KI_BUDDY_PRODUCT_CAPABILITY;
}) {
  return new JSDOM(rendererHtml, {
    runScripts: 'dangerously',
    url: 'https://desktop.local',
    beforeParse(window) {
      if (options?.appearance) window.localStorage.setItem('__aionui_theme', options.appearance);
      Object.defineProperty(window, '__getKiBuddyProductBootstrap', {
        configurable: true,
        value: () =>
          options?.bootstrapError
            ? {
                status: 'invalid',
                productIdentity: 'ki-buddy',
                capability: null,
                error: options.bootstrapError,
              }
            : options?.capability
              ? {
                  status: 'ready',
                  productIdentity: 'ki-buddy',
                  identityMode: 'agents',
                  capability: options.capability,
                  error: null,
                }
              : { status: 'absent', productIdentity: null, capability: null, error: null },
      });
    },
  });
}

describe('renderer product bootstrap', () => {
  it('applies the Ki-Buddy light theme before application modules execute', () => {
    const dom = renderBootstrap({ capability: KI_BUDDY_PRODUCT_CAPABILITY });

    expect(dom.window.document.documentElement).toHaveAttribute('data-product', 'ki-buddy');
    expect(dom.window.document.documentElement).toHaveAttribute('data-product-theme', 'ki-buddy-light');
    expect(dom.window.document.title).toBe('Ki-Buddy');
  });

  it('selects the configured dark product theme from the persisted appearance', () => {
    const dom = renderBootstrap({ capability: KI_BUDDY_PRODUCT_CAPABILITY, appearance: 'dark' });

    expect(dom.window.document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(dom.window.document.documentElement).toHaveAttribute('data-product-theme', 'ki-buddy-dark');
  });

  it('does not duplicate presentation resource identifiers in the document bootstrap', () => {
    const dom = renderBootstrap({
      capability: {
        ...KI_BUDDY_PRODUCT_CAPABILITY,
        assets: { logo: 'configured-logo', mascot: 'configured-mascot' },
        themes: { light: 'configured-light', dark: 'configured-dark' },
      },
    });

    expect(dom.window.document.documentElement).toHaveAttribute('data-product-theme', 'configured-light');
    expect(dom.window.__kiBuddyProductPresentation?.assets).toEqual({
      logo: 'configured-logo',
      mascot: 'configured-mascot',
    });
    expect(dom.window.__kiBuddyProductPresentation?.experience.features.team).toBe('disabled');
  });

  it('keeps the AionUi document unchanged when the product capability is absent', () => {
    const dom = renderBootstrap();

    expect(dom.window.document.documentElement).not.toHaveAttribute('data-product');
    expect(dom.window.document.title).toBe('AionUi');
  });

  it('rejects an unsupported capability before any product presentation is applied', () => {
    const dom = renderBootstrap({
      capability: {
        ...KI_BUDDY_PRODUCT_CAPABILITY,
        schemaVersion: 99,
      } as unknown as typeof KI_BUDDY_PRODUCT_CAPABILITY,
    });

    expect(dom.window.__kiBuddyProductPresentation).toBeNull();
    expect(dom.window.__kiBuddyProductBootstrapError).toContain('Invalid Ki-Buddy product presentation capability');
    expect(dom.window.document.documentElement).not.toHaveAttribute('data-product');
    expect(dom.window.document.title).toBe('AionUi');
  });

  it('preserves a preload configuration failure before reading a product capability', () => {
    const dom = renderBootstrap({ bootstrapError: 'Ki-Buddy product configuration is invalid: missing team' });

    expect(dom.window.__kiBuddyProductPresentation).toBeNull();
    expect(dom.window.__kiBuddyProductBootstrapError).toContain('missing team');
    expect(dom.window.document.documentElement).not.toHaveAttribute('data-product');
  });
});

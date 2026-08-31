import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KI_BUDDY_PRODUCT_CAPABILITY } from '@/common/platform/ki-buddy';
import {
  getProductExperience,
  getKiBuddyAccountSettingsItem,
  getKiBuddyProductBootstrapError,
  getKiBuddyProductRuntime,
  getKiBuddyRendererRuntime,
  getKiBuddyRouteComponents,
  shouldValidateKiBuddyProductResources,
} from '@/renderer/services/runtime/kiBuddyRuntime';

const translateKey = (key: string) => key;

describe('Ki-Buddy renderer runtime selection', () => {
  beforeEach(() => {
    window.electronAPI = { ...window.electronAPI, kiBuddyAuth: undefined };
    window.__kiBuddyProductPresentation = null;
    window.__kiBuddyProductBootstrapError = null;
    window.__getKiBuddyProductBootstrap = undefined;
  });

  it('keeps product routes and settings absent without the product capability', () => {
    expect(getKiBuddyRendererRuntime()).toBeNull();
    expect(getKiBuddyRouteComponents()).toBeNull();
    expect(getKiBuddyAccountSettingsItem(translateKey)).toBeNull();
  });

  it('exposes product branding independently of authentication', () => {
    window.__kiBuddyProductPresentation = KI_BUDDY_PRODUCT_CAPABILITY;

    expect(getKiBuddyProductRuntime()).toMatchObject({
      id: 'ki-buddy',
      localeNamespace: 'kiBuddy',
      themes: { light: 'ki-buddy-light', dark: 'ki-buddy-dark' },
    });
    expect(getProductExperience().featureState('team')).toBe('disabled');
    expect(getKiBuddyRendererRuntime()).toBeNull();
  });

  it('validates product resources for local identity without an auth API', () => {
    window.__kiBuddyProductPresentation = { ...KI_BUDDY_PRODUCT_CAPABILITY, integrations: [] };

    expect(getKiBuddyRendererRuntime()).toBeNull();
    expect(shouldValidateKiBuddyProductResources('authenticated')).toBe(true);
  });

  it('activates product routes when product and auth capabilities are both present', () => {
    const kiBuddyAuth = { getSession: vi.fn(), login: vi.fn(), logout: vi.fn() };
    window.electronAPI = { ...window.electronAPI, kiBuddyAuth };
    window.__kiBuddyProductPresentation = KI_BUDDY_PRODUCT_CAPABILITY;

    expect(getKiBuddyRendererRuntime()).toMatchObject({ id: 'ki-buddy', authApi: kiBuddyAuth });
    expect(getKiBuddyRouteComponents()).toMatchObject({
      AccountSettings: expect.any(Object),
      LoginPage: expect.any(Object),
      StartupGate: expect.any(Object),
    });
    expect(getKiBuddyAccountSettingsItem(translateKey)).toMatchObject({ id: 'account', path: 'account' });
  });

  it('does not access the preload capability after bootstrap', () => {
    window.__kiBuddyProductPresentation = KI_BUDDY_PRODUCT_CAPABILITY;
    window.__getKiBuddyProductBootstrap = vi.fn(() => {
      throw new Error('bootstrap bridge must not be read after the first frame');
    });

    expect(getKiBuddyProductRuntime()).toMatchObject({ id: 'ki-buddy' });
    expect(window.__getKiBuddyProductBootstrap).not.toHaveBeenCalled();
  });

  it('fails renderer startup when the first-frame product capability is invalid', () => {
    window.__kiBuddyProductBootstrapError = 'Invalid Ki-Buddy product presentation capability';

    expect(getKiBuddyProductRuntime()).toBeNull();
    expect(getKiBuddyProductBootstrapError()).toContain('Invalid Ki-Buddy product presentation capability');
    expect(() => getProductExperience()).toThrow('Ki-Buddy product bootstrap failed');
  });

  it('does not fall back to AionUi when a recognized Ki-Buddy policy is incomplete', () => {
    window.__kiBuddyProductPresentation = {
      ...KI_BUDDY_PRODUCT_CAPABILITY,
      experience: {
        ...KI_BUDDY_PRODUCT_CAPABILITY.experience,
        features: { team: 'disabled' },
      },
    } as unknown as typeof KI_BUDDY_PRODUCT_CAPABILITY;

    expect(getKiBuddyProductRuntime()).toBeNull();
    expect(getKiBuddyProductBootstrapError()).toContain('invalid');
    expect(() => getProductExperience()).toThrow('Ki-Buddy product bootstrap failed');
  });
});

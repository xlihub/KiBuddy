import {
  KI_BUDDY_DEFAULT_LANGUAGE,
  createAionUiProductExperience,
  createKiBuddyProductExperience,
  type ProductExperience,
  type ProductFeatureId,
} from '@/common/platform/ki-buddy';
import type { KiBuddyAuthApi } from '@/common/types/platform/kiBuddyAuth';
import React from 'react';
import { loadKiBuddyAccountSettings, loadKiBuddyLoginPage, loadKiBuddyStartupGate } from '@/renderer/pages/ki-buddy';
import { createKiBuddyAccountSettingsItem } from '@/renderer/pages/ki-buddy/settingsNavigation';
import kiBuddyLogoUrl from '@/renderer/assets/ki-buddy/app.png?inline';
import kiBuddyMascotUrl from '@/renderer/assets/ki-buddy/mascot.png';
import type { KiBuddyProductCapability } from '@/common/types/platform/kiBuddyProduct';
import type { KiBuddyProductIntegration } from '@/common/platform/ki-buddy';

type TranslateFn = (key: string, options?: { defaultValue?: string }) => string;

export type KiBuddySettingsItem = ReturnType<typeof createKiBuddyAccountSettingsItem>;

const KI_BUDDY_ROUTE_COMPONENTS = {
  AccountSettings: React.lazy(loadKiBuddyAccountSettings),
  LoginPage: React.lazy(loadKiBuddyLoginPage),
  StartupGate: React.lazy(loadKiBuddyStartupGate),
};

type SettingsItem = {
  id: string;
  label: string;
  icon: React.ReactElement;
  isImageIcon?: boolean;
  path: string;
};

export type KiBuddyRendererRuntime = {
  authApi: KiBuddyAuthApi;
} & KiBuddyProductRuntime;

export type KiBuddyProductRuntime = {
  brand: KiBuddyProductCapability['brand'] & {
    logoUrl: string;
    mascotUrl: string;
  };
  defaultLanguage: string | null;
  id: 'ki-buddy';
  integrations: readonly KiBuddyProductIntegration[];
  localeNamespace: string;
  productExperience: ProductExperience;
  themes: KiBuddyProductCapability['themes'];
};

const AION_UI_PRODUCT_EXPERIENCE = createAionUiProductExperience();

const KI_BUDDY_ASSET_URLS = {
  'ki-buddy-app': kiBuddyLogoUrl,
  'ki-buddy-mascot': kiBuddyMascotUrl,
} as const;

/** Resolves product-owned renderer semantics from the validated first-frame bootstrap state. */
export function getKiBuddyProductRuntime(): KiBuddyProductRuntime | null {
  const bootstrapError = typeof window === 'undefined' ? null : window.__kiBuddyProductBootstrapError;
  if (bootstrapError) return null;
  const product = typeof window === 'undefined' ? null : (window.__kiBuddyProductPresentation ?? null);
  if (!product) return null;
  try {
    const productExperience = createKiBuddyProductExperience(product.experience);
    const logoUrl = KI_BUDDY_ASSET_URLS[product.assets.logo as keyof typeof KI_BUDDY_ASSET_URLS];
    const mascotUrl = KI_BUDDY_ASSET_URLS[product.assets.mascot as keyof typeof KI_BUDDY_ASSET_URLS];
    return {
      id: 'ki-buddy',
      brand: { ...product.brand, logoUrl, mascotUrl },
      defaultLanguage: KI_BUDDY_DEFAULT_LANGUAGE ?? null,
      integrations: product.integrations,
      localeNamespace: product.locale.namespace,
      productExperience,
      themes: product.themes,
    };
  } catch (error) {
    if (typeof window !== 'undefined') {
      const detail = error instanceof Error ? error.message : String(error);
      window.__kiBuddyProductBootstrapError = `Ki-Buddy product experience policy is invalid: ${detail}`;
    }
    return null;
  }
}

/** Returns the installation-integrity failure captured before business UI mounts. */
export function getKiBuddyProductBootstrapError(): string | null {
  if (typeof window === 'undefined') return null;
  if (!window.__kiBuddyProductBootstrapError && window.__kiBuddyProductPresentation) {
    getKiBuddyProductRuntime();
  }
  return window.__kiBuddyProductBootstrapError ?? null;
}

/** Resolves the active adapter without exposing its serialized policy. */
export function getProductExperience(): ProductExperience {
  const productRuntime = getKiBuddyProductRuntime();
  const bootstrapError = getKiBuddyProductBootstrapError();
  if (bootstrapError) throw new Error(`Ki-Buddy product bootstrap failed: ${bootstrapError}`);
  return productRuntime?.productExperience ?? AION_UI_PRODUCT_EXPERIENCE;
}

/** Thin renderer seam for product-controlled feature registration and mounting. */
export function isProductFeatureEnabled(featureId: ProductFeatureId): boolean {
  return getProductExperience().featureState(featureId) === 'enabled';
}

/** Enables product resource validation for authenticated Ki-Buddy hosts, including local identity. */
export function shouldValidateKiBuddyProductResources(authStatus: string): boolean {
  return Boolean(getKiBuddyProductRuntime()) && authStatus === 'authenticated';
}

/** Keeps Extension settings data and subscriptions on the same product capability decision. */
export function isExtensionSettingsContributionEnabled(): boolean {
  return isProductFeatureEnabled('extensionRuntime') && isProductFeatureEnabled('extensionSettings');
}

/** Resolves the authenticated Ki-Buddy runtime only when both capabilities are present. */
export function getKiBuddyRendererRuntime(): KiBuddyRendererRuntime | null {
  const productRuntime = getKiBuddyProductRuntime();
  const authApi = typeof window === 'undefined' ? undefined : window.electronAPI?.kiBuddyAuth;
  return productRuntime && authApi ? { ...productRuntime, authApi } : null;
}

/** Returns the product route bundle when the Ki-Buddy runtime is active. */
export function getKiBuddyRouteComponents(): typeof KI_BUDDY_ROUTE_COMPONENTS | null {
  return getKiBuddyRendererRuntime() ? KI_BUDDY_ROUTE_COMPONENTS : null;
}

/** Returns the product-owned account registration when the Ki-Buddy runtime is active. */
export function getKiBuddyAccountSettingsItem(t: TranslateFn): SettingsItem | null {
  return getKiBuddyRendererRuntime() ? createKiBuddyAccountSettingsItem(t) : null;
}

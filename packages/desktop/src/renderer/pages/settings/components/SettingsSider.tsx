import FlexFullContainer from '@/renderer/components/layout/FlexFullContainer';
import { isElectronDesktop, resolveExtensionAssetUrl } from '@/renderer/utils/platform';
import { type IExtensionSettingsTab } from '@/common/adapter/ipcBridge';
import type { ProductFeatureId } from '@/common/platform/ki-buddy';
import { useExtI18n } from '@/renderer/hooks/system/useExtI18n';
import { useExtensionSettingsTabs } from '@/renderer/hooks/system/useExtensionSettingsTabs';
import {
  Cat,
  Communication,
  Computer,
  Earth,
  Inbox,
  Info,
  Lightning,
  LinkCloud,
  Puzzle,
  Speed,
  System,
  Toolkit,
} from '@icon-park/react';
import classNames from 'classnames';
import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { Tooltip } from '@arco-design/web-react';
import { getSiderTooltipProps } from '@/renderer/utils/ui/siderTooltip';
import { getKiBuddyAccountSettingsItem, isProductFeatureEnabled } from '@/renderer/services/runtime/kiBuddyRuntime';

type TranslateFn = (key: string, options?: { defaultValue?: string }) => string;

export type SettingsRegistryEntry = Readonly<{
  desktopOnly?: boolean;
  featureId: ProductFeatureId;
  id: string;
  path: string;
  productOnly?: boolean;
  routePaths: readonly string[];
}>;

/** Stable settings order shared by navigation and route registration. */
export const SETTINGS_REGISTRY = [
  {
    id: 'account',
    path: 'account',
    featureId: 'account',
    productOnly: true,
    desktopOnly: false,
    routePaths: ['/settings/account'],
  },
  {
    id: 'agent',
    path: 'agent',
    featureId: 'agents',
    productOnly: false,
    desktopOnly: false,
    routePaths: ['/settings/agent', '/settings/agent/:id/repair'],
  },
  {
    id: 'model',
    path: 'model',
    featureId: 'models',
    productOnly: false,
    desktopOnly: false,
    routePaths: ['/settings/model'],
  },
  {
    id: 'skills',
    path: 'skills',
    featureId: 'skills',
    productOnly: false,
    desktopOnly: false,
    routePaths: [
      '/settings/skills',
      '/settings/skills/import-history',
      '/settings/skills/detail/:skillName',
      '/settings/capabilities',
      '/settings/capabilities/skills/import-history',
      '/settings/skills-hub',
    ],
  },
  {
    id: 'tools',
    path: 'tools',
    featureId: 'tools',
    productOnly: false,
    desktopOnly: false,
    routePaths: ['/settings/tools'],
  },
  {
    id: 'appearance',
    path: 'appearance',
    featureId: 'appearance',
    productOnly: false,
    desktopOnly: false,
    routePaths: ['/settings/appearance', '/settings/display'],
  },
  {
    id: 'webui',
    path: 'webui',
    featureId: 'webUi',
    productOnly: false,
    desktopOnly: false,
    routePaths: ['/settings/webui'],
  },
  {
    id: 'pet',
    path: 'pet',
    featureId: 'desktopPet',
    productOnly: false,
    desktopOnly: true,
    routePaths: ['/settings/pet'],
  },
  {
    id: 'system',
    path: 'system',
    featureId: 'system',
    productOnly: false,
    desktopOnly: false,
    routePaths: ['/settings/system'],
  },
  {
    id: 'archived',
    path: 'archived',
    featureId: 'conversation',
    productOnly: false,
    desktopOnly: false,
    routePaths: ['/settings/archived'],
  },
  {
    id: 'about',
    path: 'about',
    featureId: 'about',
    productOnly: false,
    desktopOnly: false,
    routePaths: ['/settings/about'],
  },
] as const satisfies readonly SettingsRegistryEntry[];

export const EXTENSION_SETTINGS_ROUTE_REGISTRY = {
  featureId: 'extensionSettings',
  path: '/settings/ext/:tabId',
} as const satisfies Readonly<{ featureId: ProductFeatureId; path: string }>;

export type BuiltinSettingsId = (typeof SETTINGS_REGISTRY)[number]['id'];

/** Builtin settings tab IDs in display order (must match router paths). */
export const BUILTIN_TAB_IDS = SETTINGS_REGISTRY.map(({ id }) => id);

/**
 * Legacy anchor IDs that have been merged into other tabs.
 * When an extension anchors to one of these, it is redirected to the new host.
 * This keeps older extensions working without requiring them to update.
 */
export const LEGACY_ANCHOR_REMAP: Record<string, string> = {
  'skills-hub': 'skills',
  capabilities: 'skills',
  display: 'appearance',
};

/**
 * Group headers displayed above specific builtin tabs.
 * The header is rendered once, immediately before the first item whose id matches.
 * Extension tabs anchored between these builtins inherit the enclosing group visually.
 */
const GROUP_HEADER_BEFORE: Record<string, string> = {
  agent: 'settings.groupAiCore',
  appearance: 'settings.groupApp',
  archived: 'settings.archived.title',
  about: 'settings.groupAbout',
};

export type SettingsNavItem = {
  id: string;
  label: string;
  icon: React.ReactElement;
  isImageIcon?: boolean;
  /** Route path segment — for builtins: `/settings/{path}`, for extensions: `/settings/ext/{id}` */
  path: string;
};

type EnabledSettingsOptions = Readonly<{
  includeProductEntries: boolean;
  isDesktop: boolean;
}>;

export type SettingsExperienceProjection = Readonly<{
  defaultPath: string;
  entries: ReadonlyArray<(typeof SETTINGS_REGISTRY)[number]>;
  extensionSettingsEnabled: boolean;
}>;

/** Projects settings registration and Extension settings through the active ProductExperience. */
export function getSettingsExperienceProjection({
  includeProductEntries,
  isDesktop,
}: EnabledSettingsOptions): SettingsExperienceProjection {
  const entries = SETTINGS_REGISTRY.filter((entry) => {
    if (entry.productOnly && !includeProductEntries) return false;
    if (entry.desktopOnly && !isDesktop) return false;
    return isProductFeatureEnabled(entry.featureId);
  });
  const first = entries[0];
  return {
    defaultPath: first ? `/settings/${first.path}` : '/guid',
    entries,
    extensionSettingsEnabled: isProductFeatureEnabled('extensionSettings'),
  };
}

export type SettingsNavigationProjection = Readonly<{
  extensionSettingsEnabled: boolean;
  items: readonly SettingsNavItem[];
}>;

/** Builds translated navigation items from the shared settings projection. */
export function getSettingsNavigationProjection(isDesktop: boolean, t: TranslateFn): SettingsNavigationProjection {
  const accountItem = getKiBuddyAccountSettingsItem(t);
  const builtinMap: Record<Exclude<BuiltinSettingsId, 'account'>, SettingsNavItem> = {
    agent: {
      id: 'agent',
      label: t('settings.agents', { defaultValue: 'Agents' }),
      icon: <Speed />,
      path: 'agent',
    },
    model: { id: 'model', label: t('settings.model'), icon: <LinkCloud />, path: 'model' },
    skills: {
      id: 'skills',
      label: t('settings.skills', { defaultValue: 'Skills' }),
      icon: <Lightning />,
      path: 'skills',
    },
    tools: {
      id: 'tools',
      label: t('settings.tools', { defaultValue: 'Tools' }),
      icon: <Toolkit />,
      path: 'tools',
    },
    appearance: {
      id: 'appearance',
      label: t('settings.appearancePanel'),
      icon: <Computer />,
      path: 'appearance',
    },
    webui: {
      id: 'webui',
      label: t('settings.webui'),
      icon: isDesktop ? <Earth /> : <Communication />,
      path: 'webui',
    },
    pet: { id: 'pet', label: t('pet.desktopPet'), icon: <Cat />, path: 'pet' },
    system: { id: 'system', label: t('settings.system'), icon: <System />, path: 'system' },
    archived: {
      id: 'archived',
      label: t('settings.archived.navLabel'),
      icon: <Inbox />,
      path: 'archived',
    },
    about: { id: 'about', label: t('settings.about'), icon: <Info />, path: 'about' },
  };
  const { entries, extensionSettingsEnabled } = getSettingsExperienceProjection({
    includeProductEntries: Boolean(accountItem),
    isDesktop,
  });

  const items = entries.flatMap((entry) => {
    if (entry.id === 'account') return accountItem ? [accountItem] : [];
    return [builtinMap[entry.id]];
  });
  return { extensionSettingsEnabled, items };
}

/** Inserts Extension settings contributions around the projected builtin registry. */
export function mergeExtensionSettingsItems(
  builtins: readonly SettingsNavItem[],
  extensionTabs: readonly IExtensionSettingsTab[],
  toItem: (tab: IExtensionSettingsTab) => SettingsNavItem
): SettingsNavItem[] {
  const result = [...builtins];
  const beforeMap = new Map<string, IExtensionSettingsTab[]>();
  const afterMap = new Map<string, IExtensionSettingsTab[]>();
  const unanchored: IExtensionSettingsTab[] = [];

  for (const tab of extensionTabs) {
    if (!tab.position) {
      unanchored.push(tab);
      continue;
    }
    const { relativeTo: rawAnchor, placement } = tab.position;
    const anchor = LEGACY_ANCHOR_REMAP[rawAnchor] ?? rawAnchor;
    if (!result.some((item) => item.id === anchor)) {
      unanchored.push(tab);
      continue;
    }
    const map = placement === 'before' ? beforeMap : afterMap;
    const list = map.get(anchor) ?? [];
    list.push(tab);
    map.set(anchor, list);
  }

  for (let index = result.length - 1; index >= 0; index--) {
    const builtinId = result[index].id;
    const afters = afterMap.get(builtinId);
    if (afters) result.splice(index + 1, 0, ...afters.map(toItem));
    const befores = beforeMap.get(builtinId);
    if (befores) result.splice(index, 0, ...befores.map(toItem));
  }

  if (unanchored.length > 0) {
    const systemIndex = result.findIndex((item) => item.id === 'system');
    result.splice(systemIndex >= 0 ? systemIndex : result.length, 0, ...unanchored.map(toItem));
  }

  return result;
}

function getGroupHeaderPositions(
  menus: readonly SettingsNavItem[],
  extensionTabs: readonly IExtensionSettingsTab[]
): Map<number, string> {
  const headerAt = new Map<number, string>();
  for (const [builtinId, headerKey] of Object.entries(GROUP_HEADER_BEFORE)) {
    const builtinIndex = menus.findIndex((item) => item.id === builtinId);
    if (builtinIndex < 0) continue;
    const beforeCount = extensionTabs.filter((tab) => {
      if (!tab.position || tab.position.placement !== 'before') return false;
      return (LEGACY_ANCHOR_REMAP[tab.position.relativeTo] ?? tab.position.relativeTo) === builtinId;
    }).length;
    headerAt.set(builtinIndex - beforeCount, headerKey);
  }
  return headerAt;
}

type SettingsSiderViewProps = Readonly<{
  collapsed: boolean;
  extensionTabs: readonly IExtensionSettingsTab[];
  menus: readonly SettingsNavItem[];
  tooltipEnabled: boolean;
}>;

const SettingsSiderView: React.FC<SettingsSiderViewProps> = ({ collapsed, extensionTabs, menus, tooltipEnabled }) => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const groupHeaderAt = useMemo(() => getGroupHeaderPositions(menus, extensionTabs), [extensionTabs, menus]);
  const siderTooltipProps = getSiderTooltipProps(tooltipEnabled);

  return (
    <div
      className={classNames('h-full settings-sider flex flex-col gap-2px overflow-y-auto overflow-x-hidden', {
        'settings-sider--collapsed': collapsed,
      })}
    >
      {menus.map((item, index) => {
        const isSelected = pathname.includes(item.path);
        const groupHeaderKey = groupHeaderAt.get(index);
        const groupHeader =
          groupHeaderKey && !collapsed ? (
            <div className='settings-sider__group-header px-12px mt-8px h-28px flex items-center text-14px font-[500] text-t-tertiary select-none'>
              {t(groupHeaderKey)}
            </div>
          ) : null;
        return (
          <React.Fragment key={item.id}>
            {groupHeader}
            <Tooltip {...siderTooltipProps} content={item.label} position='right'>
              <div
                data-settings-id={item.id}
                data-settings-path={item.path}
                data-selected={isSelected ? 'true' : 'false'}
                className={classNames(
                  'settings-sider__item h-34px rd-8px flex items-center gap-8px group cursor-pointer relative overflow-hidden shrink-0 conversation-item [&.conversation-item+&.conversation-item]:mt-2px transition-colors',
                  collapsed ? 'w-full justify-center px-0' : 'justify-start px-10px',
                  {
                    'hover:bg-fill-3': !isSelected,
                    '!bg-fill-3': isSelected,
                  }
                )}
                onClick={() => {
                  Promise.resolve(navigate(`/settings/${item.path}`, { replace: true })).catch((error) => {
                    console.error('Navigation failed:', error);
                  });
                }}
              >
                <span className='settings-sider__item-icon size-22px flex items-center justify-center shrink-0 line-height-0'>
                  {item.isImageIcon ? (
                    <span className='w-16px h-16px flex items-center justify-center'>{item.icon}</span>
                  ) : (
                    React.cloneElement(
                      item.icon as React.ReactElement<{
                        theme?: string;
                        size?: string | number;
                        className?: string;
                        strokeWidth?: number;
                      }>,
                      {
                        theme: 'outline',
                        size: '16',
                        strokeWidth: 3,
                        className: 'block leading-none text-t-secondary',
                      }
                    )
                  )}
                </span>
                <FlexFullContainer className='h-24px collapsed-hidden'>
                  <div className='settings-sider__item-label text-nowrap overflow-hidden inline-block w-full text-14px font-[500] lh-24px whitespace-nowrap text-t-primary'>
                    {item.label}
                  </div>
                </FlexFullContainer>
              </div>
            </Tooltip>
          </React.Fragment>
        );
      })}
    </div>
  );
};

type ExtensionAwareSettingsSiderProps = Readonly<{
  builtins: readonly SettingsNavItem[];
  collapsed: boolean;
  tooltipEnabled: boolean;
}>;

const ExtensionAwareSettingsSider: React.FC<ExtensionAwareSettingsSiderProps> = ({
  builtins,
  collapsed,
  tooltipEnabled,
}) => {
  const extensionTabs = useExtensionSettingsTabs();
  const { resolveExtTabName } = useExtI18n();
  const menus = useMemo(
    () =>
      mergeExtensionSettingsItems(builtins, extensionTabs, (tab) => {
        const resolvedIcon = resolveExtensionAssetUrl(tab.icon) || tab.icon;
        return {
          id: tab.id,
          label: resolveExtTabName(tab),
          icon: resolvedIcon ? <img src={resolvedIcon} alt='' className='w-full h-full object-contain' /> : <Puzzle />,
          isImageIcon: Boolean(resolvedIcon),
          path: `ext/${tab.id}`,
        };
      }),
    [builtins, extensionTabs, resolveExtTabName]
  );

  return (
    <SettingsSiderView
      collapsed={collapsed}
      extensionTabs={extensionTabs}
      menus={menus}
      tooltipEnabled={tooltipEnabled}
    />
  );
};

const SettingsSider: React.FC<{ collapsed?: boolean; tooltipEnabled?: boolean }> = ({
  collapsed = false,
  tooltipEnabled = false,
}) => {
  const { t } = useTranslation();
  const isDesktop = isElectronDesktop();
  const { extensionSettingsEnabled, items: builtins } = useMemo(
    () => getSettingsNavigationProjection(isDesktop, t),
    [isDesktop, t]
  );

  if (!extensionSettingsEnabled) {
    return (
      <SettingsSiderView collapsed={collapsed} extensionTabs={[]} menus={builtins} tooltipEnabled={tooltipEnabled} />
    );
  }

  return <ExtensionAwareSettingsSider builtins={builtins} collapsed={collapsed} tooltipEnabled={tooltipEnabled} />;
};

export default SettingsSider;

import { getTranslations } from "next-intl/server";

export interface SettingsNavItem {
  href: string;
  label: string;
  labelKey?: string; // Add key for client-side translation fallback
  external?: boolean; // Mark if this is an external link (bypasses i18n routing)
}

// Static navigation items for navigation structure
export const SETTINGS_NAV_ITEMS: SettingsNavItem[] = [
  { href: "/settings/config", labelKey: "nav.config", label: "配置" },
  { href: "/settings/prices", labelKey: "nav.prices", label: "价格表" },
  { href: "/settings/providers", labelKey: "nav.providers", label: "供应商" },
  { href: "/settings/sensitive-words", labelKey: "nav.sensitiveWords", label: "敏感词" },
  { href: "/settings/client-versions", labelKey: "nav.clientVersions", label: "客户端升级提醒" },
  { href: "/settings/data", labelKey: "nav.data", label: "数据管理" },
  { href: "/settings/logs", labelKey: "nav.logs", label: "日志" },
  { href: "/settings/notifications", labelKey: "nav.notifications", label: "消息推送" },
  { href: "/api/actions/scalar", labelKey: "nav.api", label: "API 文档", external: true },
];

// Helper function to get translated nav items
export async function getTranslatedNavItems(): Promise<SettingsNavItem[]> {
  const t = await getTranslations("settings");
  return SETTINGS_NAV_ITEMS.map((item) => ({
    ...item,
    label: item.labelKey ? t(item.labelKey) : item.label,
  }));
}

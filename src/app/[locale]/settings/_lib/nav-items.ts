import { getTranslations } from "next-intl/server";

export type SettingsNavIconName =
  | "settings"
  | "dollar-sign"
  | "server"
  | "shield-alert"
  | "alert-triangle"
  | "filter"
  | "smartphone"
  | "database"
  | "file-text"
  | "bell"
  | "book-open"
  | "help-circle"
  | "message-circle"
  | "external-link";

export interface SettingsNavItem {
  href: string;
  label: string;
  labelKey?: string;
  iconName?: SettingsNavIconName;
  external?: boolean;
}

// Static navigation items for navigation structure
export const SETTINGS_NAV_ITEMS: SettingsNavItem[] = [
  {
    href: "/settings/config",
    labelKey: "nav.config",
    label: "Configuration",
    iconName: "settings",
  },
  { href: "/settings/prices", labelKey: "nav.prices", label: "Prices", iconName: "dollar-sign" },
  {
    href: "/settings/providers",
    labelKey: "nav.providers",
    label: "Providers",
    iconName: "server",
  },
  {
    href: "/settings/sensitive-words",
    labelKey: "nav.sensitiveWords",
    label: "Sensitive Words",
    iconName: "shield-alert",
  },
  {
    href: "/settings/error-rules",
    labelKey: "nav.errorRules",
    label: "Error Rules",
    iconName: "alert-triangle",
  },
  {
    href: "/settings/request-filters",
    labelKey: "nav.requestFilters",
    label: "Request Filters",
    iconName: "filter",
  },
  {
    href: "/settings/client-versions",
    labelKey: "nav.clientVersions",
    label: "Client Versions",
    iconName: "smartphone",
  },
  { href: "/settings/data", labelKey: "nav.data", label: "Data", iconName: "database" },
  { href: "/settings/logs", labelKey: "nav.logs", label: "Logs", iconName: "file-text" },
  {
    href: "/settings/notifications",
    labelKey: "nav.notifications",
    label: "Notifications",
    iconName: "bell",
  },
  {
    href: "/api/actions/scalar",
    labelKey: "nav.apiDocs",
    label: "API Docs",
    external: true,
    iconName: "book-open",
  },
  {
    href: "https://claude-code-hub.app/",
    labelKey: "nav.docs",
    label: "Documentation",
    external: true,
    iconName: "help-circle",
  },
  {
    href: "https://github.com/ding113/claude-code-hub/issues",
    labelKey: "nav.feedback",
    label: "Feedback",
    external: true,
    iconName: "message-circle",
  },
];

// Helper function to get translated nav items
export async function getTranslatedNavItems(): Promise<SettingsNavItem[]> {
  const t = await getTranslations("settings");
  return SETTINGS_NAV_ITEMS.map((item) => ({
    ...item,
    label: item.labelKey ? t(item.labelKey) : item.label,
  }));
}

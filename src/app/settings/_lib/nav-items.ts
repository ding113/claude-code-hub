export interface SettingsNavItem {
  href: string;
  label: string;
}

export const SETTINGS_NAV_ITEMS: SettingsNavItem[] = [
  { href: "/settings/config", label: "配置" },
  { href: "/settings/prices", label: "价格表" },
  { href: "/settings/providers", label: "供应商" },
  { href: "/settings/sensitive-words", label: "敏感词" },
  { href: "/settings/data", label: "数据管理" },
  { href: "/settings/logs", label: "日志" },
  { href: "/settings/notifications", label: "消息推送" },
];

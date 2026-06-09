"use client";

import { useTranslations } from "next-intl";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Link, usePathname } from "@/i18n/routing";

const SUB_TABS = [
  { value: "config", href: "/dashboard/quotas/model-limits", labelKey: "config" },
  {
    value: "model-groups",
    href: "/dashboard/quotas/model-limits/model-groups",
    labelKey: "modelGroups",
  },
  {
    value: "user-groups",
    href: "/dashboard/quotas/model-limits/user-groups",
    labelKey: "userGroups",
  },
] as const;

function resolveActiveValue(pathname: string): string {
  const child = SUB_TABS.find(
    (tab) =>
      tab.value !== "config" && (pathname === tab.href || pathname.startsWith(`${tab.href}/`))
  );
  return child?.value ?? "config";
}

export function ModelLimitsSubNav() {
  const pathname = usePathname();
  const t = useTranslations("quota.layout.subTabs");
  const active = resolveActiveValue(pathname);

  return (
    <Tabs value={active} className="space-y-4">
      <TabsList>
        {SUB_TABS.map((tab) => (
          <Link key={tab.value} href={tab.href}>
            <TabsTrigger value={tab.value}>{t(tab.labelKey)}</TabsTrigger>
          </Link>
        ))}
      </TabsList>
    </Tabs>
  );
}

"use client";

import { useTranslations } from "next-intl";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Link, usePathname } from "@/i18n/routing";

const TABS = [
  { value: "users", href: "/dashboard/quotas/users", labelKey: "users" },
  { value: "model-limits", href: "/dashboard/quotas/model-limits", labelKey: "modelLimits" },
  { value: "providers", href: "/dashboard/quotas/providers", labelKey: "providers" },
] as const;

function resolveActiveValue(pathname: string): string {
  const match = TABS.find((tab) => pathname === tab.href || pathname.startsWith(`${tab.href}/`));
  return match?.value ?? TABS[0].value;
}

export function QuotaTabsNav() {
  const pathname = usePathname();
  const t = useTranslations("quota.layout.tabs");
  const active = resolveActiveValue(pathname);

  return (
    <Tabs value={active} className="space-y-4">
      <TabsList>
        {TABS.map((tab) => (
          <Link key={tab.value} href={tab.href}>
            <TabsTrigger value={tab.value}>{t(tab.labelKey)}</TabsTrigger>
          </Link>
        ))}
      </TabsList>
    </Tabs>
  );
}

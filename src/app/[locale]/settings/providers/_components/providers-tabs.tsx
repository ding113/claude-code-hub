"use client";

import { useSelectedLayoutSegment } from "next/navigation";
import { useTranslations } from "next-intl";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Link } from "@/i18n/routing";

export function ProvidersTabs({ children }: { children: React.ReactNode }) {
  const segment = useSelectedLayoutSegment();
  const t = useTranslations("settings.providers.tabs");

  const activeTab = segment === "vendors" ? "vendors" : "providers";

  return (
    <Tabs value={activeTab} className="space-y-4">
      <TabsList>
        <Link href="/settings/providers">
          <TabsTrigger value="providers">{t("providers")}</TabsTrigger>
        </Link>
        <Link href="/settings/providers/vendors">
          <TabsTrigger value="vendors">{t("vendors")}</TabsTrigger>
        </Link>
      </TabsList>
      {children}
    </Tabs>
  );
}

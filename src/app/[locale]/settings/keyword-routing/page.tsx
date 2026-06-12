import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { getKeywordRoutingCacheStats, listKeywordRoutingRules } from "@/actions/keyword-routing";
import { fetchSystemSettings } from "@/actions/system-config";
import { Section } from "@/components/section";
import { Skeleton } from "@/components/ui/skeleton";
import { SettingsPageHeader } from "../_components/settings-page-header";
import { AddRuleDialog } from "./_components/add-rule-dialog";
import { KeywordRoutingTableSkeleton } from "./_components/keyword-routing-skeleton";
import { MasterToggle } from "./_components/master-toggle";
import { RefreshCacheButton } from "./_components/refresh-cache-button";
import { RuleListTable } from "./_components/rule-list-table";

export const dynamic = "force-dynamic";

export default async function KeywordRoutingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "settings" });

  return (
    <div className="space-y-6">
      <SettingsPageHeader
        title={t("keywordRouting.title")}
        description={t("keywordRouting.description")}
        icon="filter"
      />
      <Section
        title={t("keywordRouting.masterToggle.section.title")}
        description={t("keywordRouting.masterToggle.section.description")}
        icon="filter"
        iconColor="text-primary"
        variant="default"
      >
        <Suspense fallback={<Skeleton className="h-20 w-full" />}>
          <KeywordRoutingToggleContent />
        </Suspense>
      </Section>
      <Section
        title={t("keywordRouting.section.title")}
        description={t("keywordRouting.section.description")}
        icon="filter"
        iconColor="text-primary"
        variant="default"
        actions={
          <div className="flex gap-2">
            <Suspense fallback={<Skeleton className="h-9 w-24" />}>
              <KeywordRoutingRefreshAction />
            </Suspense>
            <AddRuleDialog />
          </div>
        }
      >
        <Suspense fallback={<KeywordRoutingTableSkeleton />}>
          <KeywordRoutingTableContent />
        </Suspense>
      </Section>
    </div>
  );
}

async function KeywordRoutingToggleContent() {
  const settingsResult = await fetchSystemSettings();
  const enableKeywordModelRouting = settingsResult.ok
    ? settingsResult.data.enableKeywordModelRouting
    : false;

  return <MasterToggle enabled={enableKeywordModelRouting} />;
}

async function KeywordRoutingRefreshAction() {
  const cacheStats = await getKeywordRoutingCacheStats();
  return <RefreshCacheButton stats={cacheStats} />;
}

async function KeywordRoutingTableContent() {
  const rules = await listKeywordRoutingRules();
  return <RuleListTable rules={rules} />;
}

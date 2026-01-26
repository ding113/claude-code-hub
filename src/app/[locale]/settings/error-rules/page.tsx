import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { getCacheStats, listErrorRules } from "@/actions/error-rules";
import { Section } from "@/components/section";
import { Skeleton } from "@/components/ui/skeleton";
import { SettingsPageHeader } from "../_components/settings-page-header";
import { AddRuleDialog } from "./_components/add-rule-dialog";
import { ErrorRuleTester } from "./_components/error-rule-tester";
import { ErrorRulesTableSkeleton } from "./_components/error-rules-skeleton";
import { RefreshCacheButton } from "./_components/refresh-cache-button";
import { RuleListTable } from "./_components/rule-list-table";

export const dynamic = "force-dynamic";

export default async function ErrorRulesPage() {
  const t = await getTranslations("settings");

  return (
    <>
      <SettingsPageHeader
        title={t("errorRules.title")}
        description={t("errorRules.description")}
        icon="alert-triangle"
      />
      <div className="space-y-6">
        <Section
          title={t("errorRules.tester.title")}
          description={t("errorRules.tester.description")}
          icon="flask-conical"
          iconColor="text-blue-400"
        >
          <ErrorRuleTester />
        </Section>

        <Section
          title={t("errorRules.section.title")}
          icon="alert-triangle"
          iconColor="text-orange-400"
          variant="warning"
          actions={
            <div className="flex gap-2">
              <Suspense fallback={<Skeleton className="h-9 w-24" />}>
                <ErrorRulesRefreshAction />
              </Suspense>
              <AddRuleDialog />
            </div>
          }
        >
          <Suspense fallback={<ErrorRulesTableSkeleton />}>
            <ErrorRulesTableContent />
          </Suspense>
        </Section>
      </div>
    </>
  );
}

async function ErrorRulesRefreshAction() {
  const cacheStats = await getCacheStats();
  return <RefreshCacheButton stats={cacheStats} />;
}

async function ErrorRulesTableContent() {
  const rules = await listErrorRules();
  return <RuleListTable rules={rules} />;
}

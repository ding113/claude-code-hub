import { getTranslations } from "next-intl/server";
import { listErrorRules, getCacheStats } from "@/actions/error-rules";
import { Section } from "@/components/section";
import { SettingsPageHeader } from "../_components/settings-page-header";
import { RuleListTable } from "./_components/rule-list-table";
import { AddRuleDialog } from "./_components/add-rule-dialog";
import { RefreshCacheButton } from "./_components/refresh-cache-button";

export const dynamic = "force-dynamic";

export default async function ErrorRulesPage() {
  const t = await getTranslations("settings");
  const [rules, cacheStats] = await Promise.all([listErrorRules(), getCacheStats()]);

  return (
    <>
      <SettingsPageHeader title={t("errorRules.title")} description={t("errorRules.description")} />

      <Section
        title={t("errorRules.section.title")}
        description={t("errorRules.section.description")}
        actions={
          <div className="flex gap-2">
            <RefreshCacheButton stats={cacheStats} />
            <AddRuleDialog />
          </div>
        }
      >
        <RuleListTable rules={rules} />
      </Section>
    </>
  );
}

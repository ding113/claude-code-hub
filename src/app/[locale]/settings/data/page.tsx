"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Section } from "@/components/section";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { SettingsPageHeader } from "../_components/settings-page-header";
import { DatabaseExport } from "./_components/database-export";
import { DatabaseImport } from "./_components/database-import";
import { DatabaseStatusDisplay } from "./_components/database-status";
import { LogCleanupPanel } from "./_components/log-cleanup-panel";

export default function SettingsDataPage() {
  const t = useTranslations("settings");
  const [isUsageGuideOpen, setIsUsageGuideOpen] = useState(false);

  return (
    <>
      <SettingsPageHeader title={t("data.title")} description={t("data.description")} />

      <Section
        title={t("data.section.status.title")}
        description={t("data.section.status.description")}
      >
        <DatabaseStatusDisplay />
      </Section>

      <Section
        title={t("data.section.cleanup.title")}
        description={t("data.section.cleanup.description")}
      >
        <LogCleanupPanel />
      </Section>

      <Section
        title={t("data.section.export.title")}
        description={t("data.section.export.description")}
      >
        <DatabaseExport />
      </Section>

      <Section
        title={t("data.section.import.title")}
        description={t("data.section.import.description")}
      >
        <DatabaseImport />
      </Section>

      {/* 折叠式使用说明 */}
      <div className="bg-card text-card-foreground border border-border rounded-xl shadow-sm p-5">
        <Collapsible open={isUsageGuideOpen} onOpenChange={setIsUsageGuideOpen}>
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              className="flex w-full items-center justify-between p-0 hover:bg-transparent"
            >
              <div className="flex items-center gap-2">
                {isUsageGuideOpen ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                )}
                <h3 className="text-base font-semibold">{t("data.guide.title")}</h3>
              </div>
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-4">
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <ul className="text-sm text-muted-foreground space-y-2">
                <li>
                  <strong>{t("data.guide.items.cleanup.title")}</strong>:{" "}
                  {t("data.guide.items.cleanup.description")}
                </li>
                <li>
                  <strong>{t("data.guide.items.format.title")}</strong>:{" "}
                  {t("data.guide.items.format.description")}
                </li>
                <li>
                  <strong>{t("data.guide.items.overwrite.title")}</strong>:{" "}
                  {t("data.guide.items.overwrite.description")}
                </li>
                <li>
                  <strong>{t("data.guide.items.merge.title")}</strong>:{" "}
                  {t("data.guide.items.merge.description")}
                </li>
                <li>
                  <strong>{t("data.guide.items.safety.title")}</strong>:{" "}
                  {t("data.guide.items.safety.description")}
                </li>
                <li>
                  <strong>{t("data.guide.items.environment.title")}</strong>:{" "}
                  {t("data.guide.items.environment.description")}
                </li>
              </ul>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>
    </>
  );
}

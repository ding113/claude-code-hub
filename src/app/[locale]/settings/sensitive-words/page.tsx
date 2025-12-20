import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { getCacheStats, listSensitiveWords } from "@/actions/sensitive-words";
import { Section } from "@/components/section";
import { Skeleton } from "@/components/ui/skeleton";
import { SettingsPageHeader } from "../_components/settings-page-header";
import { AddWordDialog } from "./_components/add-word-dialog";
import { RefreshCacheButton } from "./_components/refresh-cache-button";
import { SensitiveWordsTableSkeleton } from "./_components/sensitive-words-skeleton";
import { WordListTable } from "./_components/word-list-table";

export const dynamic = "force-dynamic";

export default async function SensitiveWordsPage() {
  const t = await getTranslations("settings");

  return (
    <>
      <SettingsPageHeader
        title={t("sensitiveWords.title")}
        description={t("sensitiveWords.description")}
      />
      <Section
        title={t("sensitiveWords.section.title")}
        description={t("sensitiveWords.section.description")}
        actions={
          <div className="flex gap-2">
            <Suspense fallback={<Skeleton className="h-9 w-24" />}>
              <SensitiveWordsRefreshAction />
            </Suspense>
            <AddWordDialog />
          </div>
        }
      >
        <Suspense fallback={<SensitiveWordsTableSkeleton />}>
          <SensitiveWordsTableContent />
        </Suspense>
      </Section>
    </>
  );
}

async function SensitiveWordsRefreshAction() {
  const cacheStats = await getCacheStats();
  return <RefreshCacheButton stats={cacheStats} />;
}

async function SensitiveWordsTableContent() {
  const words = await listSensitiveWords();
  return <WordListTable words={words} />;
}

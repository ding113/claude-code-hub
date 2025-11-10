import { getTranslations } from "next-intl/server";
import { listSensitiveWords, getCacheStats } from "@/actions/sensitive-words";
import { Section } from "@/components/section";
import { SettingsPageHeader } from "../_components/settings-page-header";
import { WordListTable } from "./_components/word-list-table";
import { AddWordDialog } from "./_components/add-word-dialog";
import { RefreshCacheButton } from "./_components/refresh-cache-button";

export const dynamic = "force-dynamic";

export default async function SensitiveWordsPage() {
  const t = await getTranslations("settings");
  const [words, cacheStats] = await Promise.all([listSensitiveWords(), getCacheStats()]);

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
            <RefreshCacheButton stats={cacheStats} />
            <AddWordDialog />
          </div>
        }
      >
        <WordListTable words={words} />
      </Section>
    </>
  );
}

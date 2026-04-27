import { getTranslations } from "next-intl/server";
import { Section } from "@/components/section";
import { SettingsPageHeader } from "../_components/settings-page-header";
import { LogLevelForm } from "./_components/log-level-form";

export const dynamic = "force-dynamic";

export default async function SettingsLogsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "settings" });

  return (
    <>
      <SettingsPageHeader
        title={t("logs.title")}
        description={t("logs.description")}
        icon="file-text"
      />

      <Section
        title={t("logs.section.title")}
        description={t("logs.section.description")}
        icon="file-text"
        variant="default"
      >
        <LogLevelForm />
      </Section>
    </>
  );
}

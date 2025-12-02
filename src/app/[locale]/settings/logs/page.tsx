import { getTranslations } from "next-intl/server";
import { Section } from "@/components/section";
import { SettingsPageHeader } from "../_components/settings-page-header";
import { LogLevelForm } from "./_components/log-level-form";

export const dynamic = "force-dynamic";

export default async function SettingsLogsPage() {
  const t = await getTranslations("settings");

  return (
    <>
      <SettingsPageHeader title={t("logs.title")} description={t("logs.description")} />

      <Section title={t("logs.section.title")} description={t("logs.section.description")}>
        <LogLevelForm />
      </Section>
    </>
  );
}

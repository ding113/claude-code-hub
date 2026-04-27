import { getTranslations } from "next-intl/server";
import { SettingsPageHeader } from "../_components/settings-page-header";
import { SecuritySettingsClient } from "./_components/security-settings-client";

export const dynamic = "force-dynamic";

export default async function SettingsSecurityPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "settings" });

  return (
    <>
      <SettingsPageHeader
        title={t("security.title")}
        description={t("security.description")}
        icon="shield-alert"
      />
      <SecuritySettingsClient />
    </>
  );
}

import { getTranslations } from "next-intl/server";
import { ViewSwitcher } from "@/components/view-switcher";
import { SettingsPageHeader } from "../_components/settings-page-header";
import { PriceManager } from "./_components/price-manager";

export const dynamic = "force-dynamic";

export default async function SettingsPricesV2Page() {
  const t = await getTranslations("prices-v2");

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <SettingsPageHeader title={t("page.title")} description={t("page.description")} />
        <ViewSwitcher legacyPath="/settings/prices" modernPath="/settings/prices-v2" />
      </div>
      <PriceManager />
    </>
  );
}

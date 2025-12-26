import { getTranslations } from "next-intl/server";
import { ViewSwitcher } from "@/components/view-switcher";
import { SettingsPageHeader } from "../_components/settings-page-header";
import { VendorManager } from "./_components/vendor-manager";

export const dynamic = "force-dynamic";

export default async function SettingsVendorsPage() {
  const t = await getTranslations("vendors");

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <SettingsPageHeader title={t("page.title")} description={t("page.description")} />
        <ViewSwitcher legacyPath="/settings/providers" modernPath="/settings/vendors" />
      </div>
      <VendorManager />
    </>
  );
}

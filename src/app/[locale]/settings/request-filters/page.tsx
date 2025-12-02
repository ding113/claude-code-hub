import { getTranslations } from "next-intl/server";
import { listRequestFilters } from "@/actions/request-filters";
import { Section } from "@/components/section";
import { SettingsPageHeader } from "../_components/settings-page-header";
import { FilterTable } from "./_components/filter-table";

export const dynamic = "force-dynamic";

export default async function RequestFiltersPage() {
  const t = await getTranslations("settings.requestFilters");
  const filters = await listRequestFilters();

  return (
    <div className="space-y-6">
      <SettingsPageHeader title={t("title")} description={t("description")} />

      <Section title={t("title")} description={t("description")}>
        <FilterTable filters={filters} />
      </Section>
    </div>
  );
}

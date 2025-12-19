import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { listRequestFilters } from "@/actions/request-filters";
import { Section } from "@/components/section";
import { SettingsPageHeader } from "../_components/settings-page-header";
import { FilterTable } from "./_components/filter-table";
import { RequestFiltersSkeleton } from "./_components/request-filters-skeleton";

export const dynamic = "force-dynamic";

export default async function RequestFiltersPage() {
  const t = await getTranslations("settings.requestFilters");

  return (
    <div className="space-y-6">
      <SettingsPageHeader title={t("title")} description={t("description")} />
      <Suspense fallback={<RequestFiltersSkeleton />}>
        <RequestFiltersContent />
      </Suspense>
    </div>
  );
}

async function RequestFiltersContent() {
  const t = await getTranslations("settings.requestFilters");
  const filters = await listRequestFilters();

  return (
    <Section title={t("title")} description={t("description")}>
      <FilterTable filters={filters} />
    </Section>
  );
}

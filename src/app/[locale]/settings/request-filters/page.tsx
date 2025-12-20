import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { listRequestFilters } from "@/actions/request-filters";
import { Section } from "@/components/section";
import { SettingsPageHeader } from "../_components/settings-page-header";
import { FilterTable } from "./_components/filter-table";
import { RequestFiltersTableSkeleton } from "./_components/request-filters-skeleton";

export const dynamic = "force-dynamic";

export default async function RequestFiltersPage() {
  const t = await getTranslations("settings.requestFilters");

  return (
    <div className="space-y-6">
      <SettingsPageHeader title={t("title")} description={t("description")} />
      <Section title={t("title")} description={t("description")}>
        <Suspense fallback={<RequestFiltersTableSkeleton />}>
          <RequestFiltersContent />
        </Suspense>
      </Section>
    </div>
  );
}

async function RequestFiltersContent() {
  const filters = await listRequestFilters();

  return <FilterTable filters={filters} />;
}

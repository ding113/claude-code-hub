import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { listRequestFilters } from "@/actions/request-filters";
import { Section } from "@/components/section";
import { findAllProviders } from "@/repository/provider";
import { SettingsPageHeader } from "../_components/settings-page-header";
import { FilterTable } from "./_components/filter-table";
import { RequestFiltersTableSkeleton } from "./_components/request-filters-skeleton";

export const dynamic = "force-dynamic";

export default async function RequestFiltersPage() {
  const t = await getTranslations("settings.requestFilters");

  return (
    <>
      <SettingsPageHeader title={t("title")} description={t("description")} icon="filter" />
      <Section
        title={t("title")}
        description={t("description")}
        icon="filter"
        iconColor="text-[#E25706]"
        variant="default"
      >
        <Suspense fallback={<RequestFiltersTableSkeleton />}>
          <RequestFiltersContent />
        </Suspense>
      </Section>
    </>
  );
}

async function RequestFiltersContent() {
  const [filters, providers] = await Promise.all([listRequestFilters(), findAllProviders()]);

  // Only pass id and name to avoid leaking provider keys to client
  const providerOptions = providers.map((p) => ({ id: p.id, name: p.name }));

  return <FilterTable filters={filters} providers={providerOptions} />;
}

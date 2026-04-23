import { getTranslations } from "next-intl/server";
import { loadPublicStatusPageData } from "@/lib/public-status/public-api-loader";
import { PublicStatusView } from "./_components/public-status-view";

export const dynamic = "force-dynamic";

export default async function PublicStatusPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "settings.statusPage.public" });
  const {
    followServerDefaults,
    initialPayload,
    intervalMinutes,
    rangeHours,
    siteTitle,
    status,
    timeZone,
  } = await loadPublicStatusPageData();

  return (
    <PublicStatusView
      initialPayload={initialPayload}
      intervalMinutes={intervalMinutes}
      rangeHours={rangeHours}
      followServerDefaults={followServerDefaults}
      initialStatus={status}
      locale={locale}
      siteTitle={siteTitle}
      timeZone={timeZone}
      labels={{
        systemStatus: t("systemStatus"),
        heroPrimary: t("heroPrimary"),
        heroSecondary: t("heroSecondary"),
        generatedAt: t("generatedAt"),
        history: t("history"),
        availability: t("availability"),
        ttfb: t("ttfb"),
        freshnessWindow: t("freshnessWindow"),
        fresh: t("fresh"),
        stale: t("stale"),
        staleDetail: t("staleDetail"),
        rebuilding: t("rebuilding"),
        noSnapshot: t("noSnapshot"),
        noData: t("noData"),
        emptyDescription: t("emptyDescription"),
        requestTypes: {
          openaiCompatible: t("requestTypes.openaiCompatible"),
          codex: t("requestTypes.codex"),
          anthropic: t("requestTypes.anthropic"),
          gemini: t("requestTypes.gemini"),
        },
        statusBadge: {
          operational: t("statusBadge.operational"),
          degraded: t("statusBadge.degraded"),
          failed: t("statusBadge.failed"),
          noData: t("statusBadge.noData"),
        },
        tooltip: {
          availability: t("tooltip.availability"),
          ttfb: t("tooltip.ttfb"),
          tps: t("tooltip.tps"),
          historyAriaLabel: t("tooltip.historyAriaLabel"),
        },
        searchPlaceholder: t("searchPlaceholder"),
        customSort: t("customSort"),
        resetSort: t("resetSort"),
        emptyByFilter: t("emptyByFilter"),
        modelsLabel: t("modelsLabel"),
        issuesLabel: t("issuesLabel"),
        clearSearch: t("clearSearch"),
        dragHandle: t("dragHandle"),
        toggleGroup: t("toggleGroup"),
        openGroupPage: t("openGroupPage"),
      }}
    />
  );
}

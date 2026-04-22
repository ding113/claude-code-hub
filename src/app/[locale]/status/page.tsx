import { getTranslations } from "next-intl/server";
import {
  readCurrentPublicStatusConfigSnapshot,
  readPublicStatusSiteMetadata,
} from "@/lib/public-status/config-snapshot";
import { readPublicStatusPayload } from "@/lib/public-status/read-store";
import { schedulePublicStatusRebuild } from "@/lib/public-status/rebuild-hints";
import { PublicStatusView } from "./_components/public-status-view";

export const dynamic = "force-dynamic";

const FALLBACK_SITE_TITLE = "Claude Code Hub";

export default async function PublicStatusPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "settings.statusPage.public" });
  const configSnapshot = await readCurrentPublicStatusConfigSnapshot();
  const siteMetadata = await readPublicStatusSiteMetadata();
  const intervalMinutes = configSnapshot?.defaultIntervalMinutes ?? 5;
  const rangeHours = configSnapshot?.defaultRangeHours ?? 24;
  const followServerDefaults = !configSnapshot;
  const payload = await readPublicStatusPayload({
    intervalMinutes,
    rangeHours,
    configVersion: configSnapshot?.configVersion,
    hasConfiguredGroups: configSnapshot ? configSnapshot.groups.length > 0 : undefined,
    nowIso: new Date().toISOString(),
    triggerRebuildHint: async (reason) => {
      await schedulePublicStatusRebuild({
        intervalMinutes,
        rangeHours,
        reason,
      });
    },
  });

  return (
    <PublicStatusView
      initialPayload={payload}
      intervalMinutes={intervalMinutes}
      rangeHours={rangeHours}
      followServerDefaults={followServerDefaults}
      locale={locale}
      siteTitle={
        siteMetadata?.siteTitle?.trim() ||
        configSnapshot?.siteTitle?.trim() ||
        FALLBACK_SITE_TITLE
      }
      timeZone={configSnapshot?.timeZone ?? "UTC"}
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

import { getTranslations } from "next-intl/server";
import { readPublicSiteMeta } from "@/lib/public-site-meta";
import { readCurrentPublicStatusConfigSnapshot } from "@/lib/public-status/config-snapshot";
import { readPublicStatusPayload } from "@/lib/public-status/read-store";
import { schedulePublicStatusRebuild } from "@/lib/public-status/rebuild-hints";
import { PublicStatusView } from "./_components/public-status-view";

export const dynamic = "force-dynamic";

export default async function PublicStatusPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations("settings");
  const configSnapshot = await readCurrentPublicStatusConfigSnapshot();
  const siteMeta = await readPublicSiteMeta();
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
      if (followServerDefaults) {
        await schedulePublicStatusRebuild({
          intervalMinutes,
          rangeHours,
          reason,
        });
      }
    },
  });

  return (
    <PublicStatusView
      initialPayload={payload}
      intervalMinutes={intervalMinutes}
      rangeHours={rangeHours}
      followServerDefaults={followServerDefaults}
      locale={locale}
      siteTitle={configSnapshot?.siteTitle ?? siteMeta.siteTitle}
      timeZone={configSnapshot?.timeZone ?? "UTC"}
      labels={{
        systemStatus: t("statusPage.public.systemStatus"),
        heroPrimary: t("statusPage.public.heroPrimary"),
        heroSecondary: t("statusPage.public.heroSecondary"),
        generatedAt: t("statusPage.public.generatedAt"),
        history: t("statusPage.public.history"),
        availability: t("statusPage.public.availability"),
        ttfb: t("statusPage.public.ttfb"),
        freshnessWindow: t("statusPage.public.freshnessWindow"),
        fresh: t("statusPage.public.fresh"),
        stale: t("statusPage.public.stale"),
        staleDetail: t("statusPage.public.staleDetail"),
        rebuilding: t("statusPage.public.rebuilding"),
        noData: t("statusPage.public.noData"),
        emptyDescription: t("statusPage.public.emptyDescription"),
        requestTypes: {
          openaiCompatible: t("statusPage.public.requestTypes.openaiCompatible"),
          codex: t("statusPage.public.requestTypes.codex"),
          anthropic: t("statusPage.public.requestTypes.anthropic"),
          gemini: t("statusPage.public.requestTypes.gemini"),
        },
      }}
    />
  );
}

import { getTranslations } from "next-intl/server";
import { readCurrentPublicStatusConfigSnapshot } from "@/lib/public-status/config-snapshot";
import { readPublicStatusPayload } from "@/lib/public-status/read-store";
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
  const payload = await readPublicStatusPayload({
    intervalMinutes: configSnapshot?.defaultIntervalMinutes ?? 5,
    rangeHours: configSnapshot?.defaultRangeHours ?? 24,
    configVersion: configSnapshot?.configVersion,
    hasConfiguredGroups: configSnapshot ? configSnapshot.groups.length > 0 : undefined,
    nowIso: new Date().toISOString(),
    triggerRebuildHint: async () => {},
  });

  return (
    <PublicStatusView
      initialPayload={payload}
      intervalMinutes={configSnapshot?.defaultIntervalMinutes ?? 5}
      rangeHours={configSnapshot?.defaultRangeHours ?? 24}
      locale={locale}
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

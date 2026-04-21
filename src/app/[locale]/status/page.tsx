import { getTranslations } from "next-intl/server";
import { ThemeSwitcher } from "@/components/ui/theme-switcher";
import { readCurrentPublicStatusConfigSnapshot } from "@/lib/public-status/config-snapshot";
import type { PublicStatusTimelineBucket } from "@/lib/public-status/payload";
import { readPublicStatusPayload } from "@/lib/public-status/read-store";
import { PublicStatusTimeline } from "./_components/public-status-timeline";

export const dynamic = "force-dynamic";

function buildEmptyTimeline(): PublicStatusTimelineBucket[] {
  return Array.from({ length: 60 }, (_, index) => ({
    bucketStart: `empty-${index}`,
    bucketEnd: `empty-${index}`,
    state: "no_data",
    availabilityPct: null,
    ttfbMs: null,
    tps: null,
    sampleCount: 0,
  }));
}

function resolveStateLabel(
  rebuildState: "fresh" | "stale" | "rebuilding" | "no-data",
  t: Awaited<ReturnType<typeof getTranslations>>
): string {
  if (rebuildState === "fresh") {
    return t("statusPage.public.fresh");
  }
  if (rebuildState === "stale") {
    return t("statusPage.public.stale");
  }
  if (rebuildState === "rebuilding") {
    return t("statusPage.public.rebuilding");
  }
  return t("statusPage.public.noData");
}

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
    nowIso: new Date().toISOString(),
    triggerRebuildHint: async () => {},
  });

  const groups =
    payload.groups.length > 0
      ? payload.groups
      : [
          {
            publicGroupSlug: "bootstrap",
            displayName: t("statusPage.public.systemStatus"),
            explanatoryCopy: t("statusPage.public.emptyDescription"),
            models: [
              {
                publicModelKey: "bootstrap",
                label: t("statusPage.public.systemStatus"),
                vendorIconKey: "generic",
                requestTypeBadge: "openaiCompatible",
                latestState: "no_data" as const,
                availabilityPct: null,
                latestTtfbMs: null,
                latestTps: null,
                timeline: buildEmptyTimeline(),
              },
            ],
          },
        ];

  return (
    <div className="relative min-h-[calc(100vh-4rem)] overflow-hidden bg-background text-foreground">
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(148,163,184,0.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,0.08) 1px, transparent 1px)",
          backgroundSize: "32px 32px",
        }}
      />

      <div className="relative mx-auto flex w-full max-w-7xl flex-col gap-10 px-4 py-8 sm:px-6 lg:px-8">
        <header className="rounded-[28px] border border-white/10 bg-card/70 p-6 shadow-2xl backdrop-blur-xl">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-4">
              <p className="text-xs font-semibold uppercase tracking-[0.32em] text-muted-foreground">
                {t("statusPage.public.heroPrimary")}
              </p>
              <div className="space-y-2">
                <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
                  {t("statusPage.public.systemStatus")}
                </h1>
                <p className="max-w-2xl text-sm text-muted-foreground sm:text-base">
                  {t("statusPage.public.heroSecondary")}
                </p>
              </div>
            </div>

            <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
              <div className="rounded-full border border-white/10 bg-background/70 px-4 py-2 text-sm">
                {resolveStateLabel(payload.rebuildState, t)}
              </div>
              <ThemeSwitcher />
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-6 text-sm text-muted-foreground">
            <span>
              {t("statusPage.public.generatedAt")}:{" "}
              {payload.generatedAt
                ? new Date(payload.generatedAt).toLocaleString(locale)
                : t("statusPage.public.rebuilding")}
            </span>
            <span>{t("statusPage.public.history")}: 60</span>
          </div>
        </header>

        <div className="grid gap-6">
          {groups.map((group) => (
            <section
              key={group.publicGroupSlug}
              className="rounded-[28px] border border-white/10 bg-card/60 p-6 shadow-xl backdrop-blur-xl"
            >
              <div className="mb-4 space-y-2">
                <h2 className="text-2xl font-semibold tracking-tight">{group.displayName}</h2>
                {group.explanatoryCopy && (
                  <p className="text-sm text-muted-foreground">{group.explanatoryCopy}</p>
                )}
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                {group.models.map((model) => (
                  <article
                    key={model.publicModelKey}
                    className="rounded-[24px] border border-white/10 bg-background/60 p-5"
                  >
                    <div className="mb-4 flex items-start justify-between gap-4">
                      <div className="space-y-1">
                        <h3 className="text-lg font-semibold">{model.label}</h3>
                        <p className="font-mono text-xs text-muted-foreground">
                          {model.publicModelKey}
                        </p>
                      </div>
                      <div className="rounded-full border border-white/10 bg-muted/50 px-3 py-1 text-xs uppercase tracking-wide text-muted-foreground">
                        {model.requestTypeBadge}
                      </div>
                    </div>

                    <div className="mb-4 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-2xl border border-white/10 bg-muted/30 p-3">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                          {t("statusPage.public.ttfb")}
                        </div>
                        <div className="mt-2 font-mono text-xl">
                          {model.latestTtfbMs === null ? "—" : `${model.latestTtfbMs} ms`}
                        </div>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-muted/30 p-3">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                          {t("statusPage.public.availability")}
                        </div>
                        <div className="mt-2 font-mono text-xl">
                          {model.availabilityPct === null
                            ? "—"
                            : `${model.availabilityPct.toFixed(2)}%`}
                        </div>
                      </div>
                    </div>

                    <PublicStatusTimeline items={model.timeline} />
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

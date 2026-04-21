import { Activity } from "lucide-react";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ModelVendorIcon } from "@/components/customs/model-vendor-icon";
import { Badge } from "@/components/ui/badge";
import { ThemeSwitcher } from "@/components/ui/theme-switcher";
import { getPublicStatusSnapshot } from "@/repository/public-status-snapshot";
import { PublicStatusTimeline } from "./_components/public-status-timeline";

export const dynamic = "force-dynamic";

function resolveRequestTypeKey(modelId: string) {
  const lower = modelId.toLowerCase();
  if (lower.startsWith("claude")) return "anthropic";
  if (lower.startsWith("gemini")) return "gemini";
  if (lower.startsWith("codex")) return "codex";
  return "openaiCompatible";
}

function cornerMarker(className: string) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      className={className}
    >
      <line x1="12" y1="0" x2="12" y2="24" />
      <line x1="0" y1="12" x2="24" y2="12" />
    </svg>
  );
}

export default async function PublicStatusPage() {
  const t = await getTranslations("settings");
  const snapshot = await getPublicStatusSnapshot();

  if (!snapshot || snapshot.groups.length === 0) {
    notFound();
  }

  const hasFailedModel = snapshot.groups.some((group) =>
    group.models.some((model) => model.latestState === "failed")
  );
  const nextRefreshInMs = Math.max(
    0,
    new Date(snapshot.generatedAt).getTime() + snapshot.bucketMinutes * 60 * 1000 - Date.now()
  );

  return (
    <div className="relative min-h-[var(--cch-viewport-height,100vh)] overflow-hidden px-4 py-6 sm:px-6 sm:py-8 md:px-8 md:py-10">
      <div className="pointer-events-none fixed inset-0 -z-10 bg-background" />
      <div
        className="pointer-events-none fixed inset-0 -z-10 opacity-60"
        style={{
          backgroundImage:
            "linear-gradient(to right, var(--border) 1px, transparent 1px), linear-gradient(to bottom, var(--border) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
          backgroundPosition: "-1px -1px",
          maskImage: "linear-gradient(to bottom, black 80%, transparent 100%)",
        }}
      />

      {cornerMarker("fixed left-4 top-4 h-6 w-6 text-border md:left-8 md:top-8")}
      {cornerMarker("fixed right-4 top-4 h-6 w-6 text-border md:right-8 md:top-8")}
      {cornerMarker("fixed bottom-4 left-4 h-6 w-6 text-border md:bottom-8 md:left-8")}
      {cornerMarker("fixed bottom-4 right-4 h-6 w-6 text-border md:bottom-8 md:right-8")}

      <div className="mx-auto w-full max-w-7xl">
        <header className="relative z-10 mb-8 flex flex-col justify-between gap-6 sm:mb-12 sm:gap-8 lg:flex-row lg:items-end">
          <div className="space-y-4">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-foreground text-background sm:h-8 sm:w-8">
                <Activity className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              </div>
              <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground sm:text-sm">
                {t("statusPage.public.systemStatus")}
              </span>
              <div className="h-3 w-[1px] bg-border/60 sm:h-4" />
              <ThemeSwitcher />
            </div>

            <h1 className="max-w-2xl text-3xl font-extrabold leading-tight tracking-tight sm:text-5xl md:text-6xl">
              {t("statusPage.public.heroPrimary")} <br />
              <span className="text-muted-foreground">{t("statusPage.public.heroSecondary")}</span>
            </h1>

            <div className="flex max-w-lg flex-col gap-2 text-sm text-muted-foreground sm:text-base">
              <p className="leading-relaxed">{t("statusPage.description")}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-full border border-border/60 bg-background/50 px-4 py-1.5 backdrop-blur-sm">
            <span className="relative flex h-2.5 w-2.5">
              <span
                className={`absolute inline-flex h-full w-full animate-ping rounded-full ${
                  hasFailedModel ? "bg-red-500" : "bg-green-500"
                } opacity-75`}
              />
              <span
                className={`relative inline-flex h-2.5 w-2.5 rounded-full ${
                  hasFailedModel ? "bg-red-500" : "bg-green-500"
                }`}
              />
            </span>
            <span className="text-xs font-semibold uppercase tracking-wider">
              {hasFailedModel ? t("statusPage.public.failed") : t("statusPage.public.operational")}{" "}
              · {t("statusPage.public.generatedAt")}{" "}
              {new Date(snapshot.generatedAt).toLocaleString()}
            </span>
          </div>
        </header>

        <div className="space-y-4">
          {snapshot.groups.map((group) => (
            <section
              key={group.groupName}
              className="rounded-3xl border bg-white/30 p-4 backdrop-blur-sm dark:bg-black/10 sm:p-6"
            >
              <div className="mb-4">
                <h2 className="text-lg font-bold tracking-tight text-foreground sm:text-2xl">
                  {group.displayName}
                </h2>
              </div>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {group.models.map((model) => {
                  return (
                    <div
                      key={`${group.groupName}-${model.modelId}`}
                      className="group relative flex flex-col overflow-hidden rounded-2xl border bg-background/40 backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-primary/5"
                    >
                      {cornerMarker(
                        "absolute left-2 top-2 h-4 w-4 text-muted-foreground/40 opacity-0 transition-opacity group-hover:opacity-100"
                      )}
                      {cornerMarker(
                        "absolute right-2 top-2 h-4 w-4 text-muted-foreground/40 opacity-0 transition-opacity group-hover:opacity-100"
                      )}

                      <div className="flex-1 p-4 sm:p-5">
                        <div className="mb-4">
                          <h3 className="line-clamp-2 text-base font-bold leading-tight tracking-tight text-foreground sm:text-lg md:text-xl">
                            {model.displayName}
                          </h3>

                          <div className="mt-2.5 flex items-center gap-3">
                            <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-white/80 to-white/20 shadow-sm ring-1 ring-black/5 transition-transform group-hover:scale-105 dark:from-white/10 dark:to-white/5 dark:ring-white/10 sm:h-12 sm:w-12 sm:rounded-2xl">
                              <ModelVendorIcon modelId={model.modelId} className="h-6 w-6" />
                            </div>
                            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-sm text-muted-foreground">
                              <Badge variant="outline">
                                {t(
                                  `statusPage.public.requestTypes.${resolveRequestTypeKey(model.modelId)}`
                                )}
                              </Badge>
                              <span className="truncate font-mono font-medium text-foreground/50">
                                {model.modelId}
                              </span>
                            </div>
                            <Badge
                              variant={
                                model.latestState === "operational"
                                  ? "default"
                                  : model.latestState === "failed"
                                    ? "destructive"
                                    : "outline"
                              }
                            >
                              {model.latestState === "operational"
                                ? t("statusPage.public.operational")
                                : model.latestState === "failed"
                                  ? t("statusPage.public.failed")
                                  : t("statusPage.public.noData")}
                            </Badge>
                          </div>
                        </div>

                        <div className="mb-4 grid grid-cols-2 gap-3">
                          <div className="rounded-xl bg-muted/30 p-3 transition-colors group-hover:bg-muted/50">
                            <div className="flex items-center gap-2 text-muted-foreground">
                              <span className="text-[10px] font-semibold uppercase tracking-wider">
                                {t("statusPage.public.ttfb")}
                              </span>
                            </div>
                            <div className="mt-1 font-mono text-lg font-medium leading-none text-foreground">
                              {model.latestTtfbMs === null ? "—" : `${model.latestTtfbMs} ms`}
                            </div>
                          </div>

                          <div className="rounded-xl bg-muted/30 p-3 transition-colors group-hover:bg-muted/50">
                            <div className="flex items-center gap-2 text-muted-foreground">
                              <span className="text-[10px] font-semibold uppercase tracking-wider">
                                {t("statusPage.public.tps")}
                              </span>
                            </div>
                            <div className="mt-1 font-mono text-lg font-medium leading-none text-foreground">
                              {model.latestTps === null ? "—" : model.latestTps.toFixed(2)}
                            </div>
                          </div>
                        </div>

                        <div className="rounded-lg bg-muted/30 px-3 py-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                              {t("statusPage.public.availability")}
                            </span>
                            <span className="font-mono text-sm font-bold">
                              {model.availabilityPct === null
                                ? "—"
                                : `${model.availabilityPct.toFixed(2)}%`}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="border-t border-border/40 bg-muted/10 px-5 py-4">
                        <PublicStatusTimeline
                          items={model.timeline}
                          nextRefreshInMs={nextRefreshInMs}
                          labels={{
                            history: t("statusPage.public.history"),
                            noData: t("statusPage.public.noData"),
                            generatedAt: t("statusPage.public.generatedAt"),
                            ttfb: t("statusPage.public.ttfb"),
                            tps: t("statusPage.public.tps"),
                            operational: t("statusPage.public.operational"),
                            failed: t("statusPage.public.failed"),
                            past: t("statusPage.public.past"),
                            now: t("statusPage.public.now"),
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

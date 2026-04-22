"use client";

import { Azure, Bedrock, Claude, Gemini, OpenAI } from "@lobehub/icons";
import { Bot } from "lucide-react";
import { startTransition, useEffect, useState } from "react";
import { ThemeSwitcher } from "@/components/ui/theme-switcher";
import type { PublicStatusPayload, PublicStatusTimelineBucket } from "@/lib/public-status/payload";
import { PublicStatusTimeline } from "./public-status-timeline";

interface PublicStatusViewProps {
  initialPayload: PublicStatusPayload;
  intervalMinutes: number;
  rangeHours: number;
  followServerDefaults?: boolean;
  locale: string;
  siteTitle: string;
  timeZone: string;
  labels: {
    systemStatus: string;
    heroPrimary: string;
    heroSecondary: string;
    generatedAt: string;
    history: string;
    availability: string;
    ttfb: string;
    freshnessWindow: string;
    fresh: string;
    stale: string;
    staleDetail: string;
    rebuilding: string;
    noData: string;
    emptyDescription: string;
    requestTypes: Record<string, string>;
  };
}

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
  rebuildState: PublicStatusPayload["rebuildState"],
  labels: PublicStatusViewProps["labels"]
): string {
  if (rebuildState === "rebuilding") {
    return labels.rebuilding;
  }
  if (rebuildState === "no-data") {
    return labels.noData;
  }
  return labels.fresh;
}

function resolveVendorIcon(vendorIconKey: string) {
  switch (vendorIconKey) {
    case "openai":
      return OpenAI;
    case "anthropic":
      return Claude.Color;
    case "gemini":
      return Gemini.Color;
    case "azure":
      return Azure;
    case "bedrock":
      return Bedrock;
    default:
      return Bot;
  }
}

export function PublicStatusView({
  initialPayload,
  intervalMinutes,
  rangeHours,
  followServerDefaults = false,
  locale,
  siteTitle,
  timeZone,
  labels,
}: PublicStatusViewProps) {
  const [payload, setPayload] = useState(initialPayload);

  useEffect(() => {
    const refresh = async () => {
      try {
        const response = await fetch(
          followServerDefaults
            ? "/api/public-status"
            : `/api/public-status?interval=${intervalMinutes}&rangeHours=${rangeHours}`,
          {
            cache: "no-store",
          }
        );
        const nextPayload = (await response.json()) as PublicStatusPayload;
        startTransition(() => {
          setPayload(nextPayload);
        });
      } catch {
        // 保持最后一版 payload，等待下一个轮询周期。
      }
    };

    if (followServerDefaults || initialPayload.rebuildState === "rebuilding") {
      void refresh();
    }

    const pollId = window.setInterval(() => {
      void refresh();
    }, 30_000);

    return () => {
      window.clearInterval(pollId);
    };
  }, [followServerDefaults, initialPayload.rebuildState, intervalMinutes, rangeHours]);

  const groups =
    payload.groups.length > 0
      ? payload.groups
      : [
          {
            publicGroupSlug: "bootstrap",
            displayName: labels.systemStatus,
            explanatoryCopy: labels.emptyDescription,
            models: [
              {
                publicModelKey: "bootstrap",
                label: labels.systemStatus,
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
    <div className="relative min-h-[calc(100vh-4rem)] overflow-hidden bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.15),transparent_30%),linear-gradient(180deg,rgba(15,23,42,0.02),rgba(15,23,42,0.08))] text-foreground">
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(148,163,184,0.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,0.08) 1px, transparent 1px)",
          backgroundSize: "32px 32px",
        }}
      />

      <div className="relative mx-auto flex w-full max-w-7xl flex-col gap-10 px-4 py-8 sm:px-6 lg:px-8">
        <header className="rounded-[32px] border border-white/10 bg-card/72 p-6 shadow-2xl backdrop-blur-xl">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-4">
              <p className="text-xs font-semibold uppercase tracking-[0.32em] text-muted-foreground">
                {labels.heroPrimary}
              </p>
              <div className="space-y-3">
                <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">{siteTitle}</h1>
                <p className="max-w-2xl text-sm text-muted-foreground sm:text-base">
                  {labels.heroSecondary}
                </p>
              </div>
            </div>

            <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
              {payload.rebuildState !== "stale" ? (
                <div className="rounded-full border border-white/10 bg-background/70 px-4 py-2 text-sm">
                  {resolveStateLabel(payload.rebuildState, labels)}
                </div>
              ) : null}
              <ThemeSwitcher />
            </div>
          </div>

          <div className="mt-6 space-y-2 text-sm text-muted-foreground">
            <span>
              {labels.generatedAt}:{" "}
              {payload.generatedAt
                ? new Intl.DateTimeFormat(locale, {
                    dateStyle: "medium",
                    timeStyle: "medium",
                    timeZone,
                  }).format(new Date(payload.generatedAt))
                : labels.rebuilding}
            </span>
            {payload.rebuildState === "stale" ? (
              <p className="text-xs">{labels.staleDetail}</p>
            ) : null}
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
                {group.explanatoryCopy ? (
                  <p className="text-sm text-muted-foreground">{group.explanatoryCopy}</p>
                ) : null}
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                {group.models.map((model) => {
                  const VendorIcon = resolveVendorIcon(model.vendorIconKey);

                  return (
                    <article
                      key={model.publicModelKey}
                      className="rounded-[24px] border border-white/10 bg-background/60 p-5"
                    >
                      <div className="mb-4 flex items-start justify-between gap-4">
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-muted/40">
                              <VendorIcon className="h-4 w-4" />
                            </span>
                            <h3 className="text-lg font-semibold">{model.label}</h3>
                          </div>
                          <p className="font-mono text-xs text-muted-foreground">
                            {model.publicModelKey}
                          </p>
                        </div>
                        <div className="rounded-full border border-white/10 bg-muted/50 px-3 py-1 text-xs uppercase tracking-wide text-muted-foreground">
                          {labels.requestTypes[model.requestTypeBadge] ?? model.requestTypeBadge}
                        </div>
                      </div>

                      <div className="mb-4 grid gap-3 sm:grid-cols-2">
                        <div className="rounded-2xl border border-white/10 bg-muted/30 p-3">
                          <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                            {labels.ttfb}
                          </div>
                          <div className="mt-2 font-mono text-xl">
                            {model.latestTtfbMs === null ? "—" : `${model.latestTtfbMs} ms`}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-muted/30 p-3">
                          <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                            {labels.availability}
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

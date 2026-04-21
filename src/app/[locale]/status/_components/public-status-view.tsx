"use client";

import { startTransition, useEffect, useState } from "react";
import type { PublicStatusPayload, PublicStatusTimelineBucket } from "@/lib/public-status/payload";
import { ThemeSwitcher } from "@/components/ui/theme-switcher";
import { PublicStatusTimeline } from "./public-status-timeline";

interface PublicStatusViewProps {
  initialPayload: PublicStatusPayload;
  intervalMinutes: number;
  rangeHours: number;
  locale: string;
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
    rebuilding: string;
    noData: string;
    emptyDescription: string;
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
  if (rebuildState === "fresh") {
    return labels.fresh;
  }
  if (rebuildState === "stale") {
    return labels.stale;
  }
  if (rebuildState === "rebuilding") {
    return labels.rebuilding;
  }
  return labels.noData;
}

function formatCountdown(freshUntil: string | null): string | null {
  if (!freshUntil) {
    return null;
  }

  const remainingMs = Date.parse(freshUntil) - Date.now();
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
    return "00:00";
  }

  const totalSeconds = Math.floor(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function PublicStatusView({
  initialPayload,
  intervalMinutes,
  rangeHours,
  locale,
  timeZone,
  labels,
}: PublicStatusViewProps) {
  const [payload, setPayload] = useState(initialPayload);
  const [countdown, setCountdown] = useState(() => formatCountdown(initialPayload.freshUntil));

  useEffect(() => {
    const refresh = async () => {
      try {
        const response = await fetch(
          `/api/public-status?interval=${intervalMinutes}&rangeHours=${rangeHours}`,
          {
            cache: "no-store",
          }
        );
        const nextPayload = (await response.json()) as PublicStatusPayload;
        startTransition(() => {
          setPayload(nextPayload);
          setCountdown(formatCountdown(nextPayload.freshUntil));
        });
      } catch {
        // 保持最后一版 payload，等待下一个轮询周期。
      }
    };

    const pollId = window.setInterval(() => {
      void refresh();
    }, 30_000);

    const countdownId = window.setInterval(() => {
      startTransition(() => {
        setCountdown(formatCountdown(payload.freshUntil));
      });
    }, 1000);

    return () => {
      window.clearInterval(pollId);
      window.clearInterval(countdownId);
    };
  }, [intervalMinutes, payload.freshUntil, rangeHours]);

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
                {labels.heroPrimary}
              </p>
              <div className="space-y-2">
                <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
                  {labels.systemStatus}
                </h1>
                <p className="max-w-2xl text-sm text-muted-foreground sm:text-base">
                  {labels.heroSecondary}
                </p>
              </div>
            </div>

            <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
              <div className="rounded-full border border-white/10 bg-background/70 px-4 py-2 text-sm">
                {resolveStateLabel(payload.rebuildState, labels)}
              </div>
              <ThemeSwitcher />
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-6 text-sm text-muted-foreground">
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
            <span>
              {labels.history}: 60
            </span>
            {countdown ? (
              <span>
                {labels.freshnessWindow}: {countdown}
              </span>
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
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

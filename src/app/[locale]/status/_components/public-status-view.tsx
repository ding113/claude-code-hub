"use client";

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { startTransition, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import type { PublicStatusPayload } from "@/lib/public-status/payload";
import { getPublicStatusVendorIconComponent } from "@/lib/public-status/vendor-icon";
import { cn } from "@/lib/utils";
import { type DisplayState, deriveLatestModelState } from "../_lib/derive-display-state";
import { fillDisplayTimeline } from "../_lib/fill-display-timeline";
import {
  clearGroupOrder,
  loadCollapsedSet,
  loadGroupOrder,
  reconcileOrder,
  saveCollapsedSet,
  saveGroupOrder,
} from "../_lib/group-order-store";
import {
  CHART_BUCKETS,
  computeAvgTtfb,
  computeUptimePct,
  sliceTimelineForChart,
} from "../_lib/timeline-windows";
import "../status-page.css";
import { PublicStatusTimeline, type PublicStatusTimelineLabels } from "./public-status-timeline";
import { SortableGroupPanel } from "./sortable-group-panel";
import { StatusHero } from "./status-hero";
import { StatusToolbar } from "./status-toolbar";

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
    statusBadge: {
      operational: string;
      degraded: string;
      failed: string;
      noData: string;
    };
    tooltip: {
      timeRange: string;
      availability: string;
      ttfb: string;
      tps: string;
      samples: string;
      inferredFromNeighbors: string;
    };
    searchPlaceholder: string;
    customSort: string;
    resetSort: string;
    emptyByFilter: string;
    modelsLabel: string;
    issuesLabel: string;
    clearSearch: string;
  };
}

function badgeVariant(state: DisplayState): {
  className: string;
  label: (labels: PublicStatusViewProps["labels"]) => string;
} {
  switch (state) {
    case "operational":
      return {
        className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
        label: (l) => l.statusBadge.operational,
      };
    case "degraded":
      return {
        className: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
        label: (l) => l.statusBadge.degraded,
      };
    case "failed":
      return {
        className: "border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400",
        label: (l) => l.statusBadge.failed,
      };
    default:
      return {
        className: "border-border/60 bg-muted/40 text-muted-foreground",
        label: (l) => l.statusBadge.noData,
      };
  }
}

function aggregateOverallState(states: DisplayState[]): DisplayState {
  if (states.some((s) => s === "failed")) return "failed";
  if (states.some((s) => s === "degraded")) return "degraded";
  if (states.some((s) => s === "operational")) return "operational";
  return "no_data";
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
  const [searchQuery, setSearchQuery] = useState("");
  const [customSort, setCustomSort] = useState(false);
  const [orderHydrated, setOrderHydrated] = useState(false);
  const [groupOrder, setGroupOrder] = useState<string[]>([]);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  useEffect(() => {
    const refresh = async () => {
      try {
        const response = await fetch(
          followServerDefaults
            ? "/api/public-status"
            : `/api/public-status?interval=${intervalMinutes}&rangeHours=${rangeHours}`,
          { cache: "no-store" }
        );
        const next = (await response.json()) as PublicStatusPayload;
        startTransition(() => setPayload(next));
      } catch {
        // keep last payload until next tick
      }
    };
    if (followServerDefaults || initialPayload.rebuildState === "rebuilding") {
      void refresh();
    }
    const pollId = window.setInterval(() => void refresh(), 30_000);
    return () => window.clearInterval(pollId);
  }, [followServerDefaults, initialPayload.rebuildState, intervalMinutes, rangeHours]);

  useEffect(() => {
    setGroupOrder(loadGroupOrder());
    setCollapsedGroups(loadCollapsedSet());
    setOrderHydrated(true);
  }, []);

  const baseGroups = useMemo(
    () =>
      payload.groups.length > 0
        ? payload.groups
        : [
            {
              publicGroupSlug: "bootstrap",
              displayName: labels.systemStatus,
              explanatoryCopy: labels.emptyDescription,
              models: [],
            },
          ],
    [payload.groups, labels.systemStatus, labels.emptyDescription]
  );

  const derivedGroups = useMemo(() => {
    return baseGroups.map((group) => {
      const derivedModels = group.models.map((model) => {
        const filled = fillDisplayTimeline(model.timeline);
        const chartCells = sliceTimelineForChart(filled, CHART_BUCKETS);
        const uptime24h = computeUptimePct(model.timeline);
        const ttfb24h = computeAvgTtfb(model.timeline);
        const latest = deriveLatestModelState(model);
        return { model, chartCells, uptime24h, ttfb24h, latest };
      });
      const issueCount = derivedModels.filter(
        (d) => d.latest === "failed" || d.latest === "degraded"
      ).length;
      return { group, derivedModels, issueCount };
    });
  }, [baseGroups]);

  const orderedGroups = useMemo(() => {
    const slugs = derivedGroups.map((g) => g.group.publicGroupSlug);
    if (!orderHydrated || groupOrder.length === 0) {
      return derivedGroups;
    }
    const ordered = reconcileOrder(groupOrder, slugs);
    const map = new Map(derivedGroups.map((g) => [g.group.publicGroupSlug, g]));
    return ordered.map((slug) => map.get(slug)).filter((g) => g !== undefined);
  }, [derivedGroups, groupOrder, orderHydrated]);

  const isFiltering = searchQuery.trim().length > 0;

  const filteredGroups = useMemo(() => {
    if (!isFiltering) return orderedGroups;
    const q = searchQuery.trim().toLowerCase();
    return orderedGroups
      .map((entry) => {
        const groupMatches = entry.group.displayName.toLowerCase().includes(q);
        const matchedModels = entry.derivedModels.filter((d) =>
          d.model.label.toLowerCase().includes(q)
        );
        if (groupMatches) return entry;
        if (matchedModels.length === 0) return null;
        return { ...entry, derivedModels: matchedModels };
      })
      .filter((g): g is (typeof orderedGroups)[number] => g !== null);
  }, [orderedGroups, searchQuery, isFiltering]);

  const overallState: DisplayState = useMemo(() => {
    const states = derivedGroups.flatMap((g) => g.derivedModels.map((d) => d.latest));
    return aggregateOverallState(states);
  }, [derivedGroups]);

  const overallLabel = badgeVariant(overallState).label(labels);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const slugs = orderedGroups.map((g) => g.group.publicGroupSlug);
    const oldIndex = slugs.indexOf(String(active.id));
    const newIndex = slugs.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(slugs, oldIndex, newIndex);
    const baseSlugs = derivedGroups.map((g) => g.group.publicGroupSlug);
    const reconciled = reconcileOrder(next, baseSlugs);
    setGroupOrder(reconciled);
    saveGroupOrder(reconciled);
  };

  const handleToggleCustomSort = () => {
    if (customSort) {
      setCustomSort(false);
      setGroupOrder([]);
      clearGroupOrder();
    } else {
      setCustomSort(true);
    }
  };

  const handleGroupOpenChange = (slug: string, open: boolean) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (open) {
        next.delete(slug);
      } else {
        next.add(slug);
      }
      saveCollapsedSet(next);
      return next;
    });
  };

  const timelineLabels: PublicStatusTimelineLabels = {
    availability: labels.tooltip.availability,
    ttfb: labels.tooltip.ttfb,
    tps: labels.tooltip.tps,
    samples: labels.tooltip.samples,
    inferredFromNeighbors: labels.tooltip.inferredFromNeighbors,
    noData: labels.noData,
  };

  return (
    <div className="cch-status-bg relative min-h-screen text-foreground">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-10">
        <StatusHero
          siteTitle={siteTitle}
          heroPrimary={labels.heroPrimary}
          heroSecondary={labels.heroSecondary}
          generatedAtLabel={labels.generatedAt}
          generatedAt={payload.generatedAt}
          locale={locale}
          timeZone={timeZone}
          overallState={overallState}
          statusLabel={overallLabel}
        />

        <StatusToolbar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          customSort={customSort}
          onToggleCustomSort={handleToggleCustomSort}
          searchPlaceholder={labels.searchPlaceholder}
          customSortLabel={labels.customSort}
          resetSortLabel={labels.resetSort}
          clearSearchLabel={labels.clearSearch}
        />

        {filteredGroups.length === 0 ? (
          <div className="rounded-2xl border border-border/60 bg-card/40 p-8 text-center text-sm text-muted-foreground backdrop-blur-sm">
            {labels.emptyByFilter}
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={filteredGroups.map((g) => g.group.publicGroupSlug)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-4">
                {filteredGroups.map((entry) => {
                  const group = entry.group;
                  const open = !collapsedGroups.has(group.publicGroupSlug);
                  return (
                    <SortableGroupPanel
                      key={group.publicGroupSlug}
                      slug={group.publicGroupSlug}
                      displayName={group.displayName}
                      modelCount={entry.derivedModels.length}
                      issueCount={entry.issueCount}
                      open={open}
                      onOpenChange={(next) => handleGroupOpenChange(group.publicGroupSlug, next)}
                      draggable={customSort && !isFiltering}
                      modelBadgeLabel={labels.modelsLabel}
                      issueBadgeLabel={labels.issuesLabel}
                    >
                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        {entry.derivedModels.map(
                          ({ model, chartCells, uptime24h, ttfb24h, latest }) => {
                            const variant = badgeVariant(latest);
                            const { Icon } = getPublicStatusVendorIconComponent({
                              modelName: model.publicModelKey,
                              vendorIconKey: model.vendorIconKey,
                            });

                            return (
                              <article
                                key={model.publicModelKey}
                                className="flex flex-col gap-3 rounded-xl border border-border/60 bg-background/50 p-4 backdrop-blur-sm"
                              >
                                <header className="flex items-start justify-between gap-2">
                                  <div className="flex min-w-0 items-center gap-2">
                                    <span className="inline-flex size-8 items-center justify-center rounded-lg border border-border/60 bg-muted/30">
                                      <Icon className="size-4" />
                                    </span>
                                    <div className="min-w-0">
                                      <h3 className="truncate text-sm font-semibold">
                                        {model.label}
                                      </h3>
                                      <p className="truncate font-mono text-[10px] text-muted-foreground">
                                        {labels.requestTypes[model.requestTypeBadge] ??
                                          model.requestTypeBadge}
                                      </p>
                                    </div>
                                  </div>
                                  <Badge
                                    className={cn(
                                      "border bg-transparent px-2 py-0.5 text-[10px] uppercase tracking-wide",
                                      variant.className
                                    )}
                                    variant="outline"
                                  >
                                    {variant.label(labels)}
                                  </Badge>
                                </header>

                                <div className="grid grid-cols-2 gap-2 text-xs">
                                  <div className="rounded-md border border-border/40 bg-muted/20 p-2">
                                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                      {labels.availability}
                                    </div>
                                    <div className="mt-1 font-mono text-base">
                                      {uptime24h === null ? "—" : `${uptime24h.toFixed(2)}%`}
                                    </div>
                                  </div>
                                  <div className="rounded-md border border-border/40 bg-muted/20 p-2">
                                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                      {labels.ttfb}
                                    </div>
                                    <div className="mt-1 font-mono text-base">
                                      {ttfb24h === null ? "—" : `${ttfb24h} ms`}
                                    </div>
                                  </div>
                                </div>

                                <PublicStatusTimeline
                                  cells={chartCells}
                                  timeZone={timeZone}
                                  locale={locale}
                                  labels={timelineLabels}
                                />
                              </article>
                            );
                          }
                        )}
                      </div>
                    </SortableGroupPanel>
                  );
                })}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>
    </div>
  );
}

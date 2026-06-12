"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Play, Square } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  applyProviderBatchPatch,
  editProvider,
  getModelSuggestionsByProviderGroup,
  previewProviderBatchPatch,
  undoProviderPatch,
} from "@/lib/api-client/v1/actions/providers";
import { cn } from "@/lib/utils";
import type { ProviderDisplay } from "@/types/provider";
import {
  BATCH_TEST_MAX_PROVIDERS,
  type BatchTestRowResult,
  type BatchTestRowStatus,
  useBatchProviderTest,
} from "./use-batch-provider-test";

export interface BatchTestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providers: ProviderDisplay[];
}

type ResultFilter = "all" | "green" | "yellow" | "failed";

const STATUS_BADGE_CLASSES: Record<BatchTestRowStatus, string> = {
  pending: "bg-muted text-muted-foreground",
  testing: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  green: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  yellow: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  red: "bg-red-500/15 text-red-600 dark:text-red-400",
  error: "bg-red-500/15 text-red-600 dark:text-red-400",
  canceled: "bg-muted text-muted-foreground",
};

const FAILED_STATUSES: BatchTestRowStatus[] = ["red", "error"];

export function BatchTestDialog({ open, onOpenChange, providers }: BatchTestDialogProps) {
  const t = useTranslations("settings.providers.batchTest");
  const queryClient = useQueryClient();
  const { results, isRunning, run, cancel, reset } = useBatchProviderTest();

  const [model, setModel] = useState("");
  const [resultFilter, setResultFilter] = useState<ResultFilter>("all");
  const [togglingIds, setTogglingIds] = useState<Set<number>>(new Set());
  const [enabledOverrides, setEnabledOverrides] = useState<Map<number, boolean>>(new Map());
  const [isBulkUpdating, setIsBulkUpdating] = useState(false);

  const targets = useMemo(() => providers.slice(0, BATCH_TEST_MAX_PROVIDERS), [providers]);
  const overLimit = providers.length > BATCH_TEST_MAX_PROVIDERS;

  // Reset transient state whenever the dialog is reopened; stop launching
  // new tests once it is closed so quota is not consumed in the background
  useEffect(() => {
    if (open) {
      reset();
      setResultFilter("all");
      setTogglingIds(new Set());
      setEnabledOverrides(new Map());
    } else {
      cancel();
    }
  }, [open, reset, cancel]);

  const suggestionsQuery = useQuery({
    queryKey: ["provider-model-suggestions", "batch-test"],
    queryFn: () => getModelSuggestionsByProviderGroup(null),
    enabled: open,
    staleTime: 60_000,
  });
  const modelSuggestions = useMemo(() => {
    const result = suggestionsQuery.data;
    if (result?.ok && Array.isArray(result.data)) return result.data;
    return [];
  }, [suggestionsQuery.data]);

  const summary = useMemo(() => {
    const counts = { done: 0, green: 0, yellow: 0, failed: 0 };
    for (const target of targets) {
      const row = results[target.id];
      if (!row) continue;
      if (row.status === "green") {
        counts.done += 1;
        counts.green += 1;
      } else if (row.status === "yellow") {
        counts.done += 1;
        counts.yellow += 1;
      } else if (FAILED_STATUSES.includes(row.status)) {
        counts.done += 1;
        counts.failed += 1;
      } else if (row.status === "canceled") {
        counts.done += 1;
      }
    }
    return counts;
  }, [results, targets]);

  const hasResults = Object.keys(results).length > 0;
  const hasFinishedRun = hasResults && !isRunning;

  const visibleRows = useMemo(() => {
    if (resultFilter === "all") return targets;
    return targets.filter((provider) => {
      const status = results[provider.id]?.status;
      if (!status) return false;
      if (resultFilter === "failed") return FAILED_STATUSES.includes(status);
      return status === resultFilter;
    });
  }, [targets, results, resultFilter]);

  const isProviderEnabled = useCallback(
    (provider: ProviderDisplay) => enabledOverrides.get(provider.id) ?? provider.isEnabled,
    [enabledOverrides]
  );

  const handleStart = useCallback(() => {
    // Back to "all" so the fresh pending rows stay visible under an old filter
    setResultFilter("all");
    void run(
      targets.map((provider) => provider.id),
      model
    );
  }, [run, targets, model]);

  const handleToggleEnabled = useCallback(
    async (provider: ProviderDisplay, checked: boolean) => {
      setTogglingIds((prev) => new Set(prev).add(provider.id));
      try {
        const result = await editProvider(provider.id, { is_enabled: checked });
        if (result.ok) {
          setEnabledOverrides((prev) => new Map(prev).set(provider.id, checked));
          await queryClient.invalidateQueries({ queryKey: ["providers"] });
        } else {
          toast.error(t("toast.toggleFailed", { error: result.error }));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : t("toast.unknownError");
        toast.error(t("toast.toggleFailed", { error: message }));
      } finally {
        setTogglingIds((prev) => {
          const next = new Set(prev);
          next.delete(provider.id);
          return next;
        });
      }
    },
    [queryClient, t]
  );

  const applyBulkEnabledPatch = useCallback(
    async (providerIds: number[], enabled: boolean) => {
      if (providerIds.length === 0 || isBulkUpdating) return;
      setIsBulkUpdating(true);
      try {
        const patch = { is_enabled: { set: enabled } };
        const preview = await previewProviderBatchPatch({ providerIds, patch });
        if (!preview.ok) {
          toast.error(t("toast.bulkFailed", { error: preview.error }));
          return;
        }
        const result = await applyProviderBatchPatch({
          previewToken: preview.data.previewToken,
          previewRevision: preview.data.previewRevision,
          providerIds,
          patch,
          excludeProviderIds: [],
        });
        if (!result.ok) {
          toast.error(t("toast.bulkFailed", { error: result.error }));
          return;
        }

        setEnabledOverrides((prev) => {
          const next = new Map(prev);
          for (const id of providerIds) next.set(id, enabled);
          return next;
        });
        await queryClient.invalidateQueries({ queryKey: ["providers"] });

        const undoToken = result.data.undoToken;
        const operationId = result.data.operationId;
        toast.success(t("toast.bulkApplied", { count: result.data.updatedCount }), {
          duration: 10000,
          action: {
            label: t("toast.undo"),
            onClick: async () => {
              try {
                const undoResult = await undoProviderPatch({ undoToken, operationId });
                if (undoResult.ok) {
                  setEnabledOverrides((prev) => {
                    const next = new Map(prev);
                    for (const id of providerIds) next.delete(id);
                    return next;
                  });
                  toast.success(t("toast.undoSuccess", { count: undoResult.data.revertedCount }));
                  queryClient.invalidateQueries({ queryKey: ["providers"] });
                } else {
                  toast.error(t("toast.undoFailed", { error: undoResult.error }));
                }
              } catch (err) {
                const msg = err instanceof Error ? err.message : t("toast.unknownError");
                toast.error(t("toast.undoFailed", { error: msg }));
              }
            },
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : t("toast.unknownError");
        toast.error(t("toast.bulkFailed", { error: message }));
      } finally {
        setIsBulkUpdating(false);
      }
    },
    [isBulkUpdating, queryClient, t]
  );

  const failedProviderIds = useMemo(
    () =>
      targets
        .filter((provider) => FAILED_STATUSES.includes(results[provider.id]?.status ?? "pending"))
        .map((provider) => provider.id),
    [targets, results]
  );

  const greenProviderIds = useMemo(
    () =>
      targets
        .filter((provider) => results[provider.id]?.status === "green")
        .map((provider) => provider.id),
    [targets, results]
  );

  const progressValue = targets.length > 0 ? (summary.done / targets.length) * 100 : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[var(--cch-viewport-height-90)] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>
            {t("description", { count: targets.length })}
            {overLimit ? ` ${t("overLimit", { max: BATCH_TEST_MAX_PROVIDERS })}` : null}
          </DialogDescription>
        </DialogHeader>

        {/* Model selection + run controls */}
        <div className="flex flex-col sm:flex-row sm:items-end gap-3">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="batch-test-model">{t("model.label")}</Label>
            <Input
              id="batch-test-model"
              list="batch-test-model-suggestions"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={t("model.placeholder")}
              disabled={isRunning}
            />
            <datalist id="batch-test-model-suggestions">
              {modelSuggestions.map((suggestion) => (
                <option key={suggestion} value={suggestion} />
              ))}
            </datalist>
            <p className="text-xs text-muted-foreground">{t("model.hint")}</p>
          </div>
          {isRunning ? (
            <Button type="button" variant="outline" onClick={cancel}>
              <Square className="mr-2 h-4 w-4" />
              {t("cancelRemaining")}
            </Button>
          ) : (
            <Button type="button" onClick={handleStart} disabled={targets.length === 0}>
              <Play className="mr-2 h-4 w-4" />
              {hasResults ? t("retest") : t("start")}
            </Button>
          )}
        </div>

        {/* Progress summary */}
        {hasResults && (
          <div className="space-y-2">
            <div className="flex items-center gap-3 text-sm">
              <span className="tabular-nums text-muted-foreground">
                {t("summary.progress", { done: summary.done, total: targets.length })}
              </span>
              <span className="text-emerald-600 dark:text-emerald-400 tabular-nums">
                {t("summary.green", { count: summary.green })}
              </span>
              <span className="text-amber-600 dark:text-amber-400 tabular-nums">
                {t("summary.yellow", { count: summary.yellow })}
              </span>
              <span className="text-red-600 dark:text-red-400 tabular-nums">
                {t("summary.failed", { count: summary.failed })}
              </span>
              {isRunning && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            </div>
            <Progress value={progressValue} className="h-1.5" />
            <div className="flex items-center gap-1.5">
              {(["all", "green", "yellow", "failed"] as const).map((filterKey) => (
                <Button
                  key={filterKey}
                  type="button"
                  size="sm"
                  variant={resultFilter === filterKey ? "secondary" : "ghost"}
                  className="h-7 px-2 text-xs"
                  onClick={() => setResultFilter(filterKey)}
                >
                  {t(`filter.${filterKey}`)}
                </Button>
              ))}
            </div>
          </div>
        )}

        {/* Result table */}
        <div className="flex-1 overflow-y-auto border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("table.provider")}</TableHead>
                <TableHead className="hidden sm:table-cell">{t("table.group")}</TableHead>
                <TableHead>{t("table.status")}</TableHead>
                <TableHead className="text-right">{t("table.latency")}</TableHead>
                <TableHead className="hidden md:table-cell">{t("table.message")}</TableHead>
                <TableHead className="text-right">{t("table.enabled")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleRows.map((provider) => {
                const row: BatchTestRowResult = results[provider.id] ?? { status: "pending" };
                return (
                  <TableRow key={provider.id}>
                    <TableCell>
                      <div className="font-medium truncate max-w-[180px]">{provider.name}</div>
                      <div className="text-xs text-muted-foreground">{provider.providerType}</div>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <span className="text-xs text-muted-foreground truncate max-w-[120px] inline-block">
                        {provider.groupTag || "default"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn("border-transparent", STATUS_BADGE_CLASSES[row.status])}
                      >
                        {row.status === "testing" && (
                          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                        )}
                        {t(`status.${row.status}`)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {row.latencyMs != null ? `${row.latencyMs}ms` : "-"}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <span
                        className="text-xs text-muted-foreground line-clamp-2 max-w-[260px]"
                        title={row.message}
                      >
                        {row.message ?? "-"}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <Switch
                        checked={isProviderEnabled(provider)}
                        disabled={togglingIds.has(provider.id) || isBulkUpdating}
                        onCheckedChange={(checked) => handleToggleEnabled(provider, checked)}
                        aria-label={t("table.enabled")}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
              {visibleRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                    {t("table.empty")}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          {hasFinishedRun && (
            <div className="flex flex-1 items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={failedProviderIds.length === 0 || isBulkUpdating}
                onClick={() => applyBulkEnabledPatch(failedProviderIds, false)}
              >
                {isBulkUpdating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t("bulk.disableFailed", { count: failedProviderIds.length })}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={greenProviderIds.length === 0 || isBulkUpdating}
                onClick={() => applyBulkEnabledPatch(greenProviderIds, true)}
              >
                {isBulkUpdating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t("bulk.enableGreen", { count: greenProviderIds.length })}
              </Button>
            </div>
          )}
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

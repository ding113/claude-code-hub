"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Loader2, RotateCcw, SquarePen } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { restoreModelPriceToRemote } from "@/actions/model-prices-v2";
import { Button } from "@/components/ui/button";
import { RelativeTime } from "@/components/ui/relative-time";
import type { ModelPriceData } from "@/types/model-price";
import type { ModelPriceV2 } from "@/types/model-price-v2";
import { OverrideBadge } from "./override-badge";

const ROW_HEIGHT = 52;

function getNumberField(data: ModelPriceData, key: string): number | null {
  const raw = (data as Record<string, unknown>)[key];
  if (typeof raw === "number" && !Number.isNaN(raw)) return raw;
  if (typeof raw === "string" && raw.trim()) {
    const num = Number(raw);
    return Number.isNaN(num) ? null : num;
  }
  return null;
}

function formatUsdPerMillion(costPerToken: number | null): string {
  if (costPerToken == null) return "-";
  const perM = costPerToken * 1_000_000;
  if (perM < 0.01) return `$${perM.toFixed(4)}`;
  if (perM < 1) return `$${perM.toFixed(3)}`;
  if (perM < 100) return `$${perM.toFixed(2)}`;
  return `$${perM.toFixed(0)}`;
}

interface PriceTableProps {
  prices: ModelPriceV2[];
  loading: boolean;
  hasFilters: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
  onEdit: (price: ModelPriceV2) => void;
}

export function PriceTable({
  prices,
  loading,
  hasFilters,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  onEdit,
}: PriceTableProps) {
  const t = useTranslations("prices-v2");
  const queryClient = useQueryClient();
  const parentRef = useRef<HTMLDivElement>(null);

  const rowCount = hasNextPage ? prices.length + 1 : prices.length;

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  const lastItemIndex = virtualItems[virtualItems.length - 1]?.index ?? -1;

  useEffect(() => {
    if (lastItemIndex >= prices.length - 5 && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [lastItemIndex, prices.length, hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
        <span className="ml-2">{t("table.loading")}</span>
      </div>
    );
  }

  if (prices.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <div className="text-sm">{hasFilters ? t("table.noMatch") : t("table.noDataTitle")}</div>
        {!hasFilters ? <div className="text-xs mt-1">{t("table.noDataHint")}</div> : null}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{t("table.loadedCount", { count: prices.length })}</span>
        {isFetchingNextPage ? (
          <span className="flex items-center gap-2">
            <Loader2 className="h-3 w-3 animate-spin" />
            {t("table.loading")}
          </span>
        ) : null}
      </div>

      <div className="rounded-md border overflow-hidden">
        <div className="bg-muted/50 border-b">
          <div className="flex items-center h-10 text-sm font-medium text-muted-foreground">
            <div className="flex-[2] min-w-[220px] pl-2 truncate" title={t("table.modelName")}>
              {t("table.modelName")}
            </div>
            <div className="flex-[0.7] min-w-[90px] px-1 truncate" title={t("table.source")}>
              {t("table.source")}
            </div>
            <div
              className="flex-[0.9] min-w-[110px] text-right px-1 truncate"
              title={t("table.inputPrice")}
            >
              {t("table.inputPrice")}
            </div>
            <div
              className="flex-[0.9] min-w-[110px] text-right px-1 truncate"
              title={t("table.outputPrice")}
            >
              {t("table.outputPrice")}
            </div>
            <div
              className="flex-[0.9] min-w-[120px] px-1 truncate"
              title={t("table.remoteVersion")}
            >
              {t("table.remoteVersion")}
            </div>
            <div className="flex-[0.8] min-w-[110px] px-1 truncate" title={t("table.updatedAt")}>
              {t("table.updatedAt")}
            </div>
            <div
              className="flex-[0.7] min-w-[90px] px-1 truncate"
              title={t("table.isUserOverride")}
            >
              {t("table.isUserOverride")}
            </div>
            <div
              className="flex-[0.8] min-w-[110px] pr-2 truncate text-right"
              title={t("table.actions")}
            >
              {t("table.actions")}
            </div>
          </div>
        </div>

        <div ref={parentRef} className="h-[600px] overflow-auto">
          <div
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            {virtualItems.map((virtualRow) => {
              const isLoaderRow = virtualRow.index >= prices.length;
              const price = prices[virtualRow.index];

              if (isLoaderRow) {
                return (
                  <div
                    key="loader"
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      height: `${virtualRow.size}px`,
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                    className="flex items-center justify-center text-muted-foreground"
                  >
                    {hasNextPage ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  </div>
                );
              }

              const inputPerToken = getNumberField(price.priceData, "input_cost_per_token");
              const outputPerToken = getNumberField(price.priceData, "output_cost_per_token");

              return (
                <div
                  key={price.id}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                  className="flex items-center border-b hover:bg-muted/50 transition-colors text-sm"
                >
                  <div
                    className="flex-[2] min-w-[220px] pl-2 pr-2 font-mono text-xs truncate"
                    title={price.modelName}
                  >
                    {price.modelName}
                  </div>
                  <div className="flex-[0.7] min-w-[90px] px-1 truncate">
                    {t(`source.${price.source}`)}
                  </div>
                  <div className="flex-[0.9] min-w-[110px] text-right px-1 font-mono text-xs">
                    {formatUsdPerMillion(inputPerToken)}
                  </div>
                  <div className="flex-[0.9] min-w-[110px] text-right px-1 font-mono text-xs">
                    {formatUsdPerMillion(outputPerToken)}
                  </div>
                  <div className="flex-[0.9] min-w-[120px] px-1 truncate font-mono text-xs">
                    {price.remoteVersion ?? "-"}
                  </div>
                  <div className="flex-[0.8] min-w-[110px] px-1 text-xs text-muted-foreground">
                    <RelativeTime date={price.updatedAt} />
                  </div>
                  <div className="flex-[0.7] min-w-[90px] px-1">
                    <OverrideBadge isUserOverride={price.isUserOverride} />
                  </div>
                  <div className="flex-[0.8] min-w-[110px] pr-2 flex items-center justify-end gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onEdit(price)}
                      title={price.isUserOverride ? t("actions.edit") : t("actions.createOverride")}
                    >
                      <SquarePen className="h-4 w-4" />
                    </Button>
                    {price.isUserOverride ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={async () => {
                          const res = await restoreModelPriceToRemote(price.id);
                          if (!res.ok) {
                            toast.error(t("errors.saveFailed", { error: res.error }));
                            return;
                          }
                          toast.success(t("messages.resetOverrideSuccess"));
                          await queryClient.invalidateQueries({ queryKey: ["prices-v2"] });
                        }}
                        title={t("actions.resetOverride")}
                      >
                        <RotateCcw className="h-4 w-4" />
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

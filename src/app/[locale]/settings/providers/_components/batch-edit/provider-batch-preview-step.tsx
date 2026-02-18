"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import type { ProviderBatchPreviewRow } from "@/actions/providers";
import { Checkbox } from "@/components/ui/checkbox";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ProviderBatchPreviewStepProps {
  rows: ProviderBatchPreviewRow[];
  summary: { providerCount: number; fieldCount: number; skipCount: number };
  excludedProviderIds: Set<number>;
  onExcludeToggle: (providerId: number) => void;
  isLoading?: boolean;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProviderGroup {
  providerId: number;
  providerName: string;
  rows: ProviderBatchPreviewRow[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ProviderBatchPreviewStep({
  rows,
  summary,
  excludedProviderIds,
  onExcludeToggle,
  isLoading,
}: ProviderBatchPreviewStepProps) {
  const t = useTranslations("settings.providers.batchEdit");

  const grouped = useMemo(() => {
    const map = new Map<number, ProviderGroup>();
    for (const row of rows) {
      let group = map.get(row.providerId);
      if (!group) {
        group = { providerId: row.providerId, providerName: row.providerName, rows: [] };
        map.set(row.providerId, group);
      }
      group.rows.push(row);
    }
    return Array.from(map.values());
  }, [rows]);

  if (isLoading) {
    return (
      <div
        className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground"
        data-testid="preview-loading"
      >
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>{t("preview.loading")}</span>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground" data-testid="preview-empty">
        {t("preview.noChanges")}
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="preview-step">
      {/* Summary */}
      <p className="text-sm text-muted-foreground" data-testid="preview-summary">
        {t("preview.summary", {
          providerCount: summary.providerCount,
          fieldCount: summary.fieldCount,
          skipCount: summary.skipCount,
        })}
      </p>

      {/* Provider groups */}
      <div className="max-h-[50vh] space-y-3 overflow-y-auto">
        {grouped.map((group) => {
          const excluded = excludedProviderIds.has(group.providerId);
          return (
            <div
              key={group.providerId}
              className="rounded-md border p-3 text-sm"
              data-testid={`preview-provider-${group.providerId}`}
            >
              {/* Provider header with exclusion checkbox */}
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={!excluded}
                  onCheckedChange={() => onExcludeToggle(group.providerId)}
                  aria-label={t("preview.excludeProvider")}
                  data-testid={`exclude-checkbox-${group.providerId}`}
                />
                <span className="font-medium">
                  {t("preview.providerHeader", { name: group.providerName })}
                </span>
              </div>

              {/* Field rows */}
              <div className="mt-2 space-y-1 pl-6">
                {group.rows.map((row) => (
                  <div
                    key={`${row.providerId}-${row.field}`}
                    className={
                      row.status === "skipped" ? "text-muted-foreground" : "text-foreground"
                    }
                    data-testid={`preview-row-${row.providerId}-${row.field}`}
                    data-status={row.status}
                  >
                    {row.status === "changed"
                      ? t("preview.fieldChanged", {
                          field: row.field,
                          before: formatValue(row.before),
                          after: formatValue(row.after),
                        })
                      : t("preview.fieldSkipped", {
                          field: row.field,
                          reason: row.skipReason ?? "",
                        })}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return String(value);
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

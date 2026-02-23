"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useMemo } from "react";

// ---------------------------------------------------------------------------
// Field label lookup (uses existing translations with readable fallback)
// ---------------------------------------------------------------------------

const FIELD_LABEL_KEYS: Record<string, string> = {
  is_enabled: "fields.isEnabled.label",
  priority: "fields.priority",
  weight: "fields.weight",
  cost_multiplier: "fields.costMultiplier",
  group_tag: "fields.groupTag.label",
  model_redirects: "fields.modelRedirects",
  allowed_models: "fields.allowedModels",
  anthropic_thinking_budget_preference: "fields.thinkingBudget",
  anthropic_adaptive_thinking: "fields.adaptiveThinking",
};

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

  const getFieldLabel = useCallback(
    (field: string): string => {
      const key = FIELD_LABEL_KEYS[field];
      if (key) return t(key);
      return field.replace(/_/g, " ");
    },
    [t]
  );

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
      <div className="max-h-[50vh] max-h-[50dvh] space-y-3 overflow-y-auto">
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
                          field: getFieldLabel(row.field),
                          before: formatValue(row.before),
                          after: formatValue(row.after),
                        })
                      : t("preview.fieldSkipped", {
                          field: getFieldLabel(row.field),
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

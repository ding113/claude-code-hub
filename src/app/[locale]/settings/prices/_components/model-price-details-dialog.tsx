"use client";

import { Info } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  collectModelPriceFieldEntries,
  type ModelPriceFieldEntry,
} from "@/lib/utils/model-price-fields";
import type { ModelPrice } from "@/types/model-price";

interface ModelPriceDetailsDialogProps {
  price: ModelPrice;
  trigger?: React.ReactNode;
}

function formatValue(
  value: unknown,
  t: ReturnType<typeof useTranslations<"settings.prices">>
): string {
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "-";
  }
  if (typeof value === "boolean") {
    return value ? t("details.booleanTrue") : t("details.booleanFalse");
  }
  if (typeof value === "string") {
    return value;
  }
  if (value === null) {
    return "null";
  }
  if (value === undefined) {
    return "-";
  }
  return JSON.stringify(value);
}

function kindLabel(
  kind: ModelPriceFieldEntry["kind"],
  t: ReturnType<typeof useTranslations<"settings.prices">>
): string {
  switch (kind) {
    case "supported":
      return t("details.kindSupported");
    case "unsupported":
      return t("details.kindUnsupported");
    default:
      return t("details.kindDisplay");
  }
}

function FieldRow({
  entry,
  t,
}: {
  entry: ModelPriceFieldEntry;
  t: ReturnType<typeof useTranslations<"settings.prices">>;
}) {
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.02] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-foreground">{entry.label}</div>
          <div className="mt-1 font-mono text-[11px] text-muted-foreground">{entry.path}</div>
        </div>
        <Badge variant="outline" className="shrink-0">
          {kindLabel(entry.kind, t)}
        </Badge>
      </div>
      <div className="mt-2 break-all font-mono text-xs text-foreground">
        {formatValue(entry.value, t)}
      </div>
    </div>
  );
}

export function ModelPriceDetailsDialog({ price, trigger }: ModelPriceDetailsDialogProps) {
  const t = useTranslations("settings.prices");

  const entries = useMemo(() => collectModelPriceFieldEntries(price.priceData), [price.priceData]);
  const coreEntries = entries.filter((entry) => entry.isCore && entry.source === "top_level");
  const additionalBillableEntries = entries.filter(
    (entry) => !entry.isCore && entry.kind !== "display" && entry.source === "top_level"
  );
  const additionalMetadataEntries = entries.filter(
    (entry) => !entry.isCore && entry.kind === "display" && entry.source === "top_level"
  );
  const providerEntries = entries.filter((entry) => entry.source === "provider_pricing");
  const providerGroups = useMemo(() => {
    const groups = new Map<string, ModelPriceFieldEntry[]>();
    for (const entry of providerEntries) {
      const key = entry.providerKey ?? "unknown";
      const bucket = groups.get(key) ?? [];
      bucket.push(entry);
      groups.set(key, bucket);
    }
    return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [providerEntries]);

  const defaultTrigger = (
    <Button variant="ghost" size="sm">
      <Info className="mr-2 h-4 w-4" />
      {t("actions.viewDetails")}
    </Button>
  );

  return (
    <Dialog>
      <DialogTrigger asChild>{trigger || defaultTrigger}</DialogTrigger>
      <DialogContent className="max-w-4xl overflow-y-auto max-h-[85vh]">
        <DialogHeader>
          <DialogTitle>{price.priceData.display_name?.trim() || price.modelName}</DialogTitle>
          <DialogDescription>
            <span className="font-mono">{price.modelName}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <section className="space-y-3">
            <div className="text-sm font-medium">{t("details.coreFieldsTitle")}</div>
            <div className="grid gap-3 md:grid-cols-2">
              {coreEntries.map((entry) => (
                <FieldRow key={entry.path} entry={entry} t={t} />
              ))}
            </div>
          </section>

          {additionalBillableEntries.length > 0 ? (
            <details className="rounded-md border border-white/10 bg-white/[0.02] p-3">
              <summary className="cursor-pointer text-sm font-medium">
                {t("details.additionalBillableTitle")}
              </summary>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {additionalBillableEntries.map((entry) => (
                  <FieldRow key={entry.path} entry={entry} t={t} />
                ))}
              </div>
            </details>
          ) : null}

          {additionalMetadataEntries.length > 0 ? (
            <details className="rounded-md border border-white/10 bg-white/[0.02] p-3">
              <summary className="cursor-pointer text-sm font-medium">
                {t("details.additionalMetadataTitle")}
              </summary>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {additionalMetadataEntries.map((entry) => (
                  <FieldRow key={entry.path} entry={entry} t={t} />
                ))}
              </div>
            </details>
          ) : null}

          {providerGroups.length > 0 ? (
            <section className="space-y-3">
              <div className="text-sm font-medium">{t("details.providerPricingTitle")}</div>
              {providerGroups.map(([providerKey, groupEntries]) => (
                <details
                  key={providerKey}
                  className="rounded-md border border-white/10 bg-white/[0.02] p-3"
                >
                  <summary className="cursor-pointer text-sm font-medium">{providerKey}</summary>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    {groupEntries.map((entry) => (
                      <FieldRow key={entry.path} entry={entry} t={t} />
                    ))}
                  </div>
                </details>
              ))}
            </section>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

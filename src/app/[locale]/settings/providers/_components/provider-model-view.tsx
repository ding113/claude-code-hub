"use client";

import { Cpu, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { normalizeAllowedModelRules } from "@/lib/allowed-model-rules";
import { cn } from "@/lib/utils";
import type { ProviderDisplay } from "@/types/provider";

interface ProviderModelViewProps {
  providers: ProviderDisplay[];
  onEditProvider?: (provider: ProviderDisplay) => void;
}

interface ModelEntry {
  model: string;
  providers: ProviderDisplay[];
}

function buildModelMap(providers: ProviderDisplay[]): {
  entries: ModelEntry[];
  unrestrictedProviders: ProviderDisplay[];
} {
  const map = new Map<string, ProviderDisplay[]>();
  const unrestricted: ProviderDisplay[] = [];

  for (const provider of providers) {
    const rules = normalizeAllowedModelRules(provider.allowedModels);
    const exactModels = rules
      ? rules
          .filter((r) => r.matchType === "exact" && r.pattern.trim())
          .map((r) => r.pattern.trim())
      : [];

    if (exactModels.length === 0) {
      unrestricted.push(provider);
      continue;
    }

    for (const model of exactModels) {
      const list = map.get(model) ?? [];
      list.push(provider);
      map.set(model, list);
    }
  }

  const entries = Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([model, provs]) => ({ model, providers: provs }));

  return { entries, unrestrictedProviders: unrestricted };
}

function ProviderRow({
  provider,
  onEdit,
}: {
  provider: ProviderDisplay;
  onEdit?: (provider: ProviderDisplay) => void;
}) {
  const t = useTranslations("settings.providers");

  return (
    <div className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50">
      <div className="flex min-w-0 items-center gap-2">
        <span
          className={cn(
            "h-2 w-2 shrink-0 rounded-full",
            provider.isEnabled ? "bg-green-500" : "bg-muted-foreground/40"
          )}
        />
        <span className="truncate text-sm">{provider.name}</span>
        {!provider.isEnabled && (
          <Badge variant="outline" className="shrink-0 text-[10px]">
            {t("disabledStatus")}
          </Badge>
        )}
      </div>
      {onEdit && (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 shrink-0 px-2 text-xs text-muted-foreground"
          onClick={() => onEdit(provider)}
        >
          {t("edit")}
        </Button>
      )}
    </div>
  );
}

function ModelCard({
  entry,
  onEditProvider,
}: {
  entry: ModelEntry;
  onEditProvider?: (provider: ProviderDisplay) => void;
}) {
  const t = useTranslations("settings.providers.modelView");

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="break-all font-mono text-sm font-medium leading-snug">
            {entry.model}
          </CardTitle>
          <Badge variant="secondary" className="shrink-0 text-xs">
            {t("providerCount", { count: entry.providers.length })}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex-1 pt-0">
        <div className="space-y-0.5">
          {entry.providers.map((p) => (
            <ProviderRow key={p.id} provider={p} onEdit={onEditProvider} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function ProviderModelView({ providers, onEditProvider }: ProviderModelViewProps) {
  const t = useTranslations("settings.providers.modelView");
  const [search, setSearch] = useState("");

  const { entries, unrestrictedProviders } = useMemo(() => buildModelMap(providers), [providers]);

  const filtered = useMemo(() => {
    const kw = search.trim().toLowerCase();
    if (!kw) return entries;
    return entries.filter((e) => e.model.toLowerCase().includes(kw));
  }, [entries, search]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-8 pl-8 text-sm"
            placeholder={t("search")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">
          {t("modelCount", { count: filtered.length })}
        </span>
      </div>

      {unrestrictedProviders.length > 0 && !search && (
        <Card className="border-dashed">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Cpu className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-sm font-medium">{t("unrestricted")}</CardTitle>
              <Badge variant="outline" className="text-xs">
                {t("providerCount", { count: unrestrictedProviders.length })}
              </Badge>
            </div>
            <CardDescription className="text-xs">{t("unrestrictedDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-0.5">
              {unrestrictedProviders.map((p) => (
                <ProviderRow key={p.id} provider={p} onEdit={onEditProvider} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {filtered.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          {search ? t("noResults") : t("noModels")}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((entry) => (
            <ModelCard key={entry.model} entry={entry} onEditProvider={onEditProvider} />
          ))}
        </div>
      )}
    </div>
  );
}

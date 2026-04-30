"use client";

import {
  Check,
  ChevronsUpDown,
  Cloud,
  Database,
  Loader2,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { modelPricesClient } from "@/lib/api-client/v1/model-prices/index";
import {
  callFetchUpstreamModels,
  callGetUnmaskedProviderKey,
} from "@/lib/api-client/v1/providers/hooks";

/**
 * Local mirror of `@/actions/model-prices` catalog types — kept inline so
 * this client component avoids a server-only import. Matches the shape of
 * `ModelPriceCatalogItem` returned by `/api/v1/model-prices/catalog`.
 */
interface AvailableModelCatalogItem {
  modelName: string;
  litellmProvider: string | null;
  updatedAt: string;
}

type AvailableModelCatalogScope = "chat" | "all";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PRICE_FILTER_VENDORS } from "@/lib/model-vendor-icons";
import { cn } from "@/lib/utils";
import type { ProviderType } from "@/types/provider";

type ModelSource = "upstream" | "fallback" | "loading";

type ModelOption = AvailableModelCatalogItem & {
  key: string;
};

interface ModelMultiSelectProps {
  providerType: ProviderType;
  selectedModels: string[];
  onChange: (models: string[]) => void;
  disabled?: boolean;
  emptyLabel?: string;
  providerUrl?: string;
  apiKey?: string;
  proxyUrl?: string | null;
  proxyFallbackToDirect?: boolean;
  providerId?: number;
  catalogScope?: AvailableModelCatalogScope;
}

function normalizeModelName(model: string): string {
  return model.trim();
}

function getModelKey(model: string): string {
  return normalizeModelName(model);
}

function getProviderTypeLabel(providerType: ProviderType, t: ReturnType<typeof useTranslations>) {
  switch (providerType) {
    case "claude":
    case "claude-auth":
      return t("claude");
    case "gemini":
    case "gemini-cli":
      return t("gemini");
    default:
      return t("openai");
  }
}

function buildLocalOption(item: AvailableModelCatalogItem): ModelOption {
  return {
    ...item,
    key: getModelKey(item.modelName),
  };
}

function buildVirtualOption(modelName: string): ModelOption {
  return {
    modelName,
    litellmProvider: null,
    updatedAt: "",
    key: getModelKey(modelName),
  };
}

export function ModelMultiSelect({
  providerType,
  selectedModels,
  onChange,
  disabled = false,
  emptyLabel,
  providerUrl,
  apiKey,
  proxyUrl,
  proxyFallbackToDirect,
  providerId,
  catalogScope = "chat",
}: ModelMultiSelectProps) {
  const t = useTranslations("settings.providers.form.modelSelect");
  const tPrices = useTranslations("settings.prices");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [modelSource, setModelSource] = useState<ModelSource>("loading");
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([]);
  const [searchValue, setSearchValue] = useState("");
  const [providerFilter, setProviderFilter] = useState("__all__");
  const [fallbackNotice, setFallbackNotice] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const providerOptions = useMemo(() => {
    const knownProviders = new Map(
      PRICE_FILTER_VENDORS.map((entry) => [entry.litellmProvider, entry.i18nKey])
    );
    const seen = new Set<string>();
    const options: Array<{ value: string; label: string }> = [];

    for (const entry of PRICE_FILTER_VENDORS) {
      if (availableModels.some((model) => model.litellmProvider === entry.litellmProvider)) {
        seen.add(entry.litellmProvider);
        options.push({
          value: entry.litellmProvider,
          label: tPrices(`filters.${entry.i18nKey}`),
        });
      }
    }

    const unknownProviders = Array.from(
      new Set(
        availableModels
          .map((model) => model.litellmProvider)
          .filter((provider): provider is string => !!provider && !seen.has(provider))
      )
    ).sort((left, right) => left.localeCompare(right));

    for (const provider of unknownProviders) {
      seen.add(provider);
      options.push({
        value: provider,
        label: knownProviders.has(provider)
          ? tPrices(`filters.${knownProviders.get(provider)}`)
          : provider,
      });
    }

    return options;
  }, [availableModels, tPrices]);

  const selectedKeySet = useMemo(
    () => new Set(selectedModels.map((model) => getModelKey(model))),
    [selectedModels]
  );

  const displayedModels = useMemo(() => {
    const merged: ModelOption[] = [];
    const seen = new Set<string>();

    for (const model of availableModels) {
      if (seen.has(model.key)) {
        continue;
      }
      seen.add(model.key);
      merged.push(model);
    }

    // 关键：保留已选但不在当前列表里的 exact 规则，这样用户仍然可以取消它们。
    for (const model of selectedModels) {
      const option = buildVirtualOption(model);
      if (seen.has(option.key)) {
        continue;
      }
      seen.add(option.key);
      merged.push(option);
    }

    return merged;
  }, [availableModels, selectedModels]);

  const filteredModels = useMemo(() => {
    const keyword = searchValue.trim().toLowerCase();
    const useProviderFilter = modelSource === "fallback" && providerFilter !== "__all__";

    return displayedModels.filter((model) => {
      if (keyword && !model.modelName.toLowerCase().includes(keyword)) {
        return false;
      }
      if (useProviderFilter && model.litellmProvider !== providerFilter) {
        return false;
      }
      return true;
    });
  }, [displayedModels, modelSource, providerFilter, searchValue]);

  const filteredSelectedModels = useMemo(
    () => filteredModels.filter((model) => selectedKeySet.has(model.key)),
    [filteredModels, selectedKeySet]
  );
  const filteredAvailableModels = useMemo(
    () => filteredModels.filter((model) => !selectedKeySet.has(model.key)),
    [filteredModels, selectedKeySet]
  );

  const loadModels = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    setLoading(true);
    setModelSource("loading");
    setFallbackNotice(null);

    try {
      let resolvedKey = apiKey?.trim() || "";
      if ((!resolvedKey || resolvedKey.includes("***")) && providerId) {
        const keyResult = await callGetUnmaskedProviderKey<number, { key: string }>(providerId);
        if (keyResult.ok && keyResult.data?.key) {
          resolvedKey = keyResult.data.key;
        }
      }

      if (providerUrl && resolvedKey) {
        const upstreamResult = await callFetchUpstreamModels<
          {
            providerUrl: string;
            apiKey: string;
            providerType: ProviderType;
            proxyUrl?: string | null;
            proxyFallbackToDirect?: boolean;
          },
          { models?: string[] }
        >({
          providerUrl,
          apiKey: resolvedKey,
          providerType,
          proxyUrl,
          proxyFallbackToDirect,
        });

        if (upstreamResult.ok && upstreamResult.data?.models?.length) {
          if (requestId !== requestIdRef.current) {
            return;
          }

          const upstreamModels = upstreamResult.data.models.map((modelName) =>
            buildLocalOption({
              modelName,
              litellmProvider: null,
              updatedAt: "",
            })
          );
          setAvailableModels(upstreamModels);
          setModelSource("upstream");
          setProviderFilter("__all__");
          return;
        }

        if (!upstreamResult.ok && requestId === requestIdRef.current) {
          setFallbackNotice(t("fallbackNotice"));
        }
      }

      const catalogResponse = await modelPricesClient.catalog(catalogScope);
      if (requestId !== requestIdRef.current) {
        return;
      }
      const catalogItems: AvailableModelCatalogItem[] = catalogResponse.items ?? [];
      setAvailableModels(catalogItems.map(buildLocalOption));
      setModelSource("fallback");
      setProviderFilter("__all__");
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [
    apiKey,
    catalogScope,
    providerId,
    providerType,
    providerUrl,
    proxyFallbackToDirect,
    proxyUrl,
    t,
  ]);

  const handleOpenLoad = useEffectEvent(() => {
    void loadModels();
  });

  useEffect(() => {
    if (!open) {
      return;
    }

    handleOpenLoad();
  }, [open]);

  const sourceLabel = modelSource === "upstream" ? t("sourceUpstream") : t("sourceFallback");
  const sourceDescription =
    modelSource === "upstream" ? t("sourceUpstreamDesc") : t("sourceFallbackDesc");
  const SourceIcon = modelSource === "upstream" ? Cloud : Database;

  const handleToggleModel = (modelName: string) => {
    const normalized = normalizeModelName(modelName);
    const modelKey = getModelKey(normalized);
    if (selectedKeySet.has(modelKey)) {
      onChange(selectedModels.filter((model) => getModelKey(model) !== modelKey));
      return;
    }
    onChange([...selectedModels, normalized]);
  };

  const handleSelectAll = () => {
    const next = [...selectedModels];
    const nextKeys = new Set(selectedModels.map((model) => getModelKey(model)));

    for (const model of filteredModels) {
      if (nextKeys.has(model.key)) {
        continue;
      }
      nextKeys.add(model.key);
      next.push(model.modelName);
    }

    onChange(next);
  };

  const handleInvertSelection = () => {
    const filteredKeys = new Set(filteredModels.map((model) => model.key));
    const preserved = selectedModels.filter((model) => !filteredKeys.has(getModelKey(model)));
    const additions = filteredModels
      .filter((model) => !selectedKeySet.has(model.key))
      .map((model) => model.modelName);

    onChange([...preserved, ...additions]);
  };

  const handleClearExactRules = () => {
    onChange([]);
  };

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            data-allowed-model-picker-trigger
            className="w-full justify-between border-dashed bg-background/70"
          >
            <span className="truncate text-left">
              {selectedModels.length === 0
                ? (emptyLabel ?? t("emptyLabel", { type: getProviderTypeLabel(providerType, t) }))
                : t("selectedCount", { count: selectedModels.length })}
            </span>
            <div className="ml-3 flex items-center gap-2">
              {selectedModels.length > 0 ? (
                <Badge variant="secondary" className="shrink-0">
                  {selectedModels.length}
                </Badge>
              ) : null}
              {loading ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin opacity-60" />
              ) : (
                <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-60" />
              )}
            </div>
          </Button>
        </PopoverTrigger>

        <PopoverContent
          className="w-[720px] max-w-[calc(100vw-2rem)] p-0"
          align="start"
          onWheel={(event) => event.stopPropagation()}
          onTouchMove={(event) => event.stopPropagation()}
        >
          <Command shouldFilter={false}>
            <div className="border-b border-border/60 p-3">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs",
                          "bg-muted/40 text-muted-foreground"
                        )}
                      >
                        <SourceIcon className="h-3.5 w-3.5" />
                        <span>{sourceLabel}</span>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      <p>{sourceDescription}</p>
                    </TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => void loadModels()}
                        disabled={disabled || loading}
                        data-allowed-model-refresh
                      >
                        <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      <p>{t("refresh")}</p>
                    </TooltipContent>
                  </Tooltip>

                  {modelSource === "fallback" && providerOptions.length > 0 ? (
                    <Select value={providerFilter} onValueChange={setProviderFilter}>
                      <SelectTrigger className="h-8 w-[180px]" data-allowed-model-provider-filter>
                        <SelectValue placeholder={t("providerFilterPlaceholder")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__all__">{t("providerFilterAll")}</SelectItem>
                        {providerOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : null}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleSelectAll}
                    disabled={disabled || loading || filteredModels.length === 0}
                    data-allowed-model-select-all
                  >
                    {t("selectAll", { count: filteredModels.length })}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleInvertSelection}
                    disabled={disabled || loading || filteredModels.length === 0}
                    data-allowed-model-invert
                  >
                    <RotateCcw className="mr-2 h-3.5 w-3.5" />
                    {t("invertSelection")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={handleClearExactRules}
                    disabled={disabled || selectedModels.length === 0}
                    data-allowed-model-clear
                  >
                    {t("clear")}
                  </Button>
                </div>
              </div>

              <div className="mt-3">
                {fallbackNotice ? (
                  <div className="mb-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
                    {fallbackNotice}
                  </div>
                ) : null}
                <CommandInput
                  value={searchValue}
                  onValueChange={setSearchValue}
                  placeholder={t("searchPlaceholder")}
                  data-allowed-model-picker-search
                />
              </div>
            </div>

            <CommandList className="max-h-[360px] overflow-y-auto p-2">
              <CommandEmpty>{loading ? t("loading") : t("notFound")}</CommandEmpty>

              {!loading && filteredSelectedModels.length > 0 ? (
                <div data-model-group="selected">
                  <CommandGroup heading={t("selectedGroupLabel")}>
                    {filteredSelectedModels.map((model) => (
                      <CommandItem
                        key={`selected:${model.key}`}
                        value={model.modelName}
                        onSelect={() => handleToggleModel(model.modelName)}
                        className="cursor-pointer"
                      >
                        <Checkbox checked className="mr-2 shrink-0" />
                        <span className="min-w-0 flex-1 truncate font-mono text-sm">
                          {model.modelName}
                        </span>
                        <Check className="h-4 w-4 text-primary" />
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </div>
              ) : null}

              {!loading ? (
                <div data-model-group="available">
                  <CommandGroup heading={t("availableGroupLabel")}>
                    {filteredAvailableModels.map((model) => (
                      <CommandItem
                        key={`available:${model.key}`}
                        value={model.modelName}
                        onSelect={() => handleToggleModel(model.modelName)}
                        className="cursor-pointer"
                      >
                        <Checkbox checked={false} className="mr-2 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-mono text-sm">{model.modelName}</div>
                          {modelSource === "fallback" && model.litellmProvider ? (
                            <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                              <span>
                                {providerOptions.find(
                                  (option) => option.value === model.litellmProvider
                                )?.label ?? model.litellmProvider}
                              </span>
                            </div>
                          ) : null}
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </div>
              ) : null}
            </CommandList>
          </Command>

          <div className="border-t border-border/60 px-3 py-2">
            <Label className="text-xs text-muted-foreground">{t("exactMatchHint")}</Label>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

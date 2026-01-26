"use client";

import { Loader2, Pencil, Plus, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { upsertSingleModelPrice } from "@/actions/model-prices";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { useDebounce } from "@/lib/hooks/use-debounce";
import type { ModelPrice } from "@/types/model-price";

interface ModelPriceDrawerProps {
  mode: "create" | "edit";
  initialData?: ModelPrice;
  trigger?: React.ReactNode;
  onSuccess?: () => void;
  defaultOpen?: boolean;
}

type ModelMode = "chat" | "image_generation" | "completion";

type PrefillStatus = "idle" | "loading" | "loaded" | "error";

function parsePricePerMillionToPerToken(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number.parseFloat(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return parsed / 1000000;
}

function parsePrice(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number.parseFloat(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return parsed;
}

function formatPerTokenPriceToPerMillion(value?: number): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return "";
  }
  return (value * 1000000).toString();
}

/**
 * 模型价格添加/编辑抽屉（右侧）
 */
export function ModelPriceDrawer({
  mode,
  initialData,
  trigger,
  onSuccess,
  defaultOpen = false,
}: ModelPriceDrawerProps) {
  const t = useTranslations("settings.prices");
  const tCommon = useTranslations("settings.common");

  const [open, setOpen] = useState(defaultOpen);
  const [loading, setLoading] = useState(false);

  // 表单状态
  const [modelName, setModelName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [modelMode, setModelMode] = useState<ModelMode>("chat");
  const [provider, setProvider] = useState("");
  const [supportsPromptCaching, setSupportsPromptCaching] = useState(false);
  const [inputPrice, setInputPrice] = useState("");
  const [outputPrice, setOutputPrice] = useState("");
  const [inputPricePerRequest, setInputPricePerRequest] = useState("");
  const [cacheReadPrice, setCacheReadPrice] = useState("");
  const [cacheCreation5mPrice, setCacheCreation5mPrice] = useState("");
  const [cacheCreation1hPrice, setCacheCreation1hPrice] = useState("");

  // 预填充搜索（仅 create 模式显示）
  const [prefillQuery, setPrefillQuery] = useState("");
  const [prefillStatus, setPrefillStatus] = useState<PrefillStatus>("idle");
  const [prefillResults, setPrefillResults] = useState<ModelPrice[]>([]);
  const debouncedPrefillQuery = useDebounce(prefillQuery, 300);

  const resetForm = useCallback(() => {
    setModelName("");
    setDisplayName("");
    setModelMode("chat");
    setProvider("");
    setSupportsPromptCaching(false);
    setInputPrice("");
    setOutputPrice("");
    setInputPricePerRequest("");
    setCacheReadPrice("");
    setCacheCreation5mPrice("");
    setCacheCreation1hPrice("");
    setPrefillQuery("");
    setPrefillStatus("idle");
    setPrefillResults([]);
  }, []);

  const applyPrefill = useCallback((selected: ModelPrice) => {
    setModelName(selected.modelName);
    setDisplayName(selected.priceData.display_name?.trim() || "");
    setModelMode((selected.priceData.mode as ModelMode) || "chat");
    setProvider(selected.priceData.litellm_provider?.trim() || "");
    setSupportsPromptCaching(selected.priceData.supports_prompt_caching === true);

    if (selected.priceData.mode === "image_generation") {
      setInputPrice("");
      setOutputPrice(
        typeof selected.priceData.output_cost_per_image === "number"
          ? selected.priceData.output_cost_per_image.toString()
          : ""
      );
    } else {
      setInputPrice(formatPerTokenPriceToPerMillion(selected.priceData.input_cost_per_token));
      setOutputPrice(formatPerTokenPriceToPerMillion(selected.priceData.output_cost_per_token));
    }

    setInputPricePerRequest(
      typeof selected.priceData.input_cost_per_request === "number"
        ? selected.priceData.input_cost_per_request.toString()
        : ""
    );
    setCacheReadPrice(
      formatPerTokenPriceToPerMillion(selected.priceData.cache_read_input_token_cost)
    );
    setCacheCreation5mPrice(
      formatPerTokenPriceToPerMillion(selected.priceData.cache_creation_input_token_cost)
    );
    setCacheCreation1hPrice(
      formatPerTokenPriceToPerMillion(selected.priceData.cache_creation_input_token_cost_above_1hr)
    );
  }, []);

  // 当抽屉打开或初始数据变化时，重置表单
  useEffect(() => {
    if (!open) {
      return;
    }

    if (mode === "edit" && initialData) {
      applyPrefill(initialData);
      return;
    }

    resetForm();
  }, [open, mode, initialData, applyPrefill, resetForm]);

  useEffect(() => {
    if (!open || mode !== "create") {
      return;
    }

    if (!prefillQuery.trim()) {
      setPrefillResults([]);
      setPrefillStatus("idle");
    }
  }, [mode, open, prefillQuery]);

  useEffect(() => {
    if (!open || mode !== "create") {
      return;
    }

    const query = debouncedPrefillQuery.trim();
    if (!query) {
      return;
    }

    let cancelled = false;
    const fetchPrefillResults = async () => {
      setPrefillStatus("loading");
      setPrefillResults([]);
      try {
        const params = new URLSearchParams();
        params.set("page", "1");
        params.set("pageSize", "10");
        params.set("search", query);
        const response = await fetch(`/api/prices?${params.toString()}`, { cache: "no-store" });
        const payload = await response.json();
        if (!payload?.ok) {
          throw new Error(payload?.error || "unknown error");
        }

        const data: ModelPrice[] = payload.data?.data ?? [];
        if (!cancelled) {
          setPrefillResults(data);
          setPrefillStatus("loaded");
        }
      } catch (error) {
        console.error("搜索模型失败:", error);
        if (!cancelled) {
          setPrefillResults([]);
          setPrefillStatus("error");
        }
      }
    };

    fetchPrefillResults();

    return () => {
      cancelled = true;
    };
  }, [mode, open, debouncedPrefillQuery]);

  const handleSubmit = async () => {
    if (!modelName.trim()) {
      toast.error(t("form.modelNameRequired"));
      return;
    }

    setLoading(true);

    try {
      const inputCostPerToken =
        modelMode !== "image_generation" ? parsePricePerMillionToPerToken(inputPrice) : undefined;
      const outputCostPerToken =
        modelMode !== "image_generation" ? parsePricePerMillionToPerToken(outputPrice) : undefined;
      const outputCostPerImage =
        modelMode === "image_generation" ? parsePrice(outputPrice) : undefined;

      const inputCostPerRequest = parsePrice(inputPricePerRequest);

      const cacheReadCostPerToken = supportsPromptCaching
        ? parsePricePerMillionToPerToken(cacheReadPrice)
        : undefined;
      const cacheCreation5mCostPerToken = supportsPromptCaching
        ? parsePricePerMillionToPerToken(cacheCreation5mPrice)
        : undefined;
      const cacheCreation1hCostPerToken = supportsPromptCaching
        ? parsePricePerMillionToPerToken(cacheCreation1hPrice)
        : undefined;

      const result = await upsertSingleModelPrice({
        modelName: modelName.trim(),
        displayName: displayName.trim() || undefined,
        mode: modelMode,
        litellmProvider: provider.trim() || undefined,
        supportsPromptCaching,
        inputCostPerToken,
        outputCostPerToken,
        outputCostPerImage,
        inputCostPerRequest,
        cacheReadInputTokenCost: cacheReadCostPerToken,
        cacheCreationInputTokenCost: cacheCreation5mCostPerToken,
        cacheCreationInputTokenCostAbove1hr: cacheCreation1hCostPerToken,
      });

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      toast.success(mode === "create" ? t("toast.createSuccess") : t("toast.updateSuccess"));
      setOpen(false);
      onSuccess?.();
      window.dispatchEvent(new Event("price-data-updated"));
    } catch (error) {
      console.error("保存失败:", error);
      toast.error(t("toast.saveFailed"));
    } finally {
      setLoading(false);
    }
  };

  const defaultTrigger =
    mode === "create" ? (
      <Button variant="outline" size="sm">
        <Plus className="h-4 w-4 mr-2" />
        {t("addModel")}
      </Button>
    ) : (
      <Button variant="ghost" size="sm">
        <Pencil className="h-4 w-4 mr-2" />
        {t("actions.edit")}
      </Button>
    );

  const isPrefillVisible = mode === "create";

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{trigger || defaultTrigger}</SheetTrigger>
      <SheetContent
        side="right"
        className="w-[90vw] sm:w-[440px] overflow-y-auto bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60"
      >
        <SheetHeader>
          <SheetTitle>{mode === "create" ? t("addModel") : t("editModel")}</SheetTitle>
          <SheetDescription>
            {mode === "create" ? t("addModelDescription") : t("editModelDescription")}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-6 p-4 pt-0">
          {isPrefillVisible && (
            <div className="space-y-2">
              <Label htmlFor="prefill-search">{t("drawer.prefillLabel")}</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="prefill-search"
                  value={prefillQuery}
                  onChange={(event) => setPrefillQuery(event.target.value)}
                  placeholder={t("searchPlaceholder")}
                  className="pl-9 bg-white/[0.02] border-white/10 focus:border-[#E25706]/50"
                  disabled={loading}
                />
              </div>

              {prefillStatus !== "idle" && (
                <Command
                  shouldFilter={false}
                  className="rounded-md border border-white/10 bg-white/[0.02]"
                >
                  <CommandList className="max-h-56">
                    <CommandEmpty>
                      {prefillStatus === "loading" ? (
                        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          <span>{tCommon("loading")}</span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {prefillStatus === "error"
                            ? t("drawer.prefillFailed")
                            : t("drawer.prefillEmpty")}
                        </span>
                      )}
                    </CommandEmpty>
                    <CommandGroup>
                      {prefillResults.map((item) => {
                        const name = item.priceData.display_name?.trim() || item.modelName;
                        const providerName = item.priceData.litellm_provider?.trim() || "";
                        return (
                          <CommandItem
                            key={item.id}
                            value={`${name} ${item.modelName} ${providerName}`.trim()}
                            onSelect={() => applyPrefill(item)}
                            disabled={loading}
                            className="cursor-pointer"
                          >
                            <div className="flex w-full items-center justify-between gap-2">
                              <div className="min-w-0">
                                <div className="truncate text-sm font-medium">{name}</div>
                                <div className="truncate font-mono text-xs text-muted-foreground">
                                  {item.modelName}
                                </div>
                              </div>
                              <div className="shrink-0 flex items-center gap-2">
                                {providerName ? (
                                  <Badge variant="secondary" className="font-mono text-xs">
                                    {providerName}
                                  </Badge>
                                ) : null}
                                {item.source === "manual" ? (
                                  <Badge variant="outline">{t("badges.local")}</Badge>
                                ) : null}
                              </div>
                            </div>
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  </CommandList>
                </Command>
              )}
            </div>
          )}

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="modelName">{t("form.modelName")}</Label>
              <Input
                id="modelName"
                value={modelName}
                onChange={(e) => setModelName(e.target.value)}
                placeholder={t("form.modelNamePlaceholder")}
                className="bg-white/[0.02] border-white/10 focus:border-[#E25706]/50"
                disabled={mode === "edit" || loading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="displayName">{t("form.displayName")}</Label>
              <Input
                id="displayName"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={t("form.displayNamePlaceholder")}
                className="bg-white/[0.02] border-white/10 focus:border-[#E25706]/50"
                disabled={loading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="modelMode">{t("form.type")}</Label>
              <Select
                value={modelMode}
                onValueChange={(value: ModelMode) => setModelMode(value)}
                disabled={loading}
              >
                <SelectTrigger id="modelMode" className="bg-white/[0.02] border-white/10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="chat">{t("table.typeChat")}</SelectItem>
                  <SelectItem value="image_generation">{t("table.typeImage")}</SelectItem>
                  <SelectItem value="completion">{t("table.typeCompletion")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="provider">{t("form.provider")}</Label>
              <Input
                id="provider"
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                placeholder={t("form.providerPlaceholder")}
                className="bg-white/[0.02] border-white/10 focus:border-[#E25706]/50"
                disabled={loading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="inputPricePerRequest">{t("form.requestPrice")}</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                  $
                </span>
                <Input
                  id="inputPricePerRequest"
                  type="number"
                  min="0"
                  step="any"
                  value={inputPricePerRequest}
                  onChange={(e) => setInputPricePerRequest(e.target.value)}
                  placeholder="0.00"
                  className="pl-7 pr-12 bg-white/[0.02] border-white/10 focus:border-[#E25706]/50"
                  disabled={loading}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                  /req
                </span>
              </div>
            </div>

            {modelMode !== "image_generation" && (
              <div className="space-y-2">
                <Label htmlFor="inputPrice">{t("form.inputPrice")}</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                    $
                  </span>
                  <Input
                    id="inputPrice"
                    type="number"
                    min="0"
                    step="any"
                    value={inputPrice}
                    onChange={(e) => setInputPrice(e.target.value)}
                    placeholder="0.00"
                    className="pl-7 pr-12 bg-white/[0.02] border-white/10 focus:border-[#E25706]/50"
                    disabled={loading}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                    /M
                  </span>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="outputPrice">
                {modelMode === "image_generation"
                  ? t("form.outputPriceImage")
                  : t("form.outputPrice")}
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                  $
                </span>
                <Input
                  id="outputPrice"
                  type="number"
                  min="0"
                  step="any"
                  value={outputPrice}
                  onChange={(e) => setOutputPrice(e.target.value)}
                  placeholder="0.00"
                  className="pl-7 pr-16 bg-white/[0.02] border-white/10 focus:border-[#E25706]/50"
                  disabled={loading}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                  {modelMode === "image_generation" ? "/img" : "/M"}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-white/[0.02] p-3">
              <div className="space-y-1">
                <div className="text-sm font-medium">{t("capabilities.promptCaching")}</div>
                <div className="text-xs text-muted-foreground">{t("drawer.promptCachingHint")}</div>
              </div>
              <Switch
                checked={supportsPromptCaching}
                onCheckedChange={setSupportsPromptCaching}
                disabled={loading}
                aria-label={t("capabilities.promptCaching")}
              />
            </div>

            <div className="space-y-4 rounded-md border border-white/10 bg-white/[0.02] p-3">
              <div className="text-sm font-medium">{t("drawer.cachePricingTitle")}</div>

              <div className="space-y-2">
                <Label htmlFor="cacheReadPrice">{t("form.cacheReadPrice")}</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                    $
                  </span>
                  <Input
                    id="cacheReadPrice"
                    type="number"
                    min="0"
                    step="any"
                    value={cacheReadPrice}
                    onChange={(e) => setCacheReadPrice(e.target.value)}
                    placeholder="0.00"
                    className="pl-7 pr-12 bg-white/[0.02] border-white/10 focus:border-[#E25706]/50"
                    disabled={loading || !supportsPromptCaching}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                    /M
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="cacheCreation5mPrice">{t("form.cacheCreationPrice5m")}</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                    $
                  </span>
                  <Input
                    id="cacheCreation5mPrice"
                    type="number"
                    min="0"
                    step="any"
                    value={cacheCreation5mPrice}
                    onChange={(e) => setCacheCreation5mPrice(e.target.value)}
                    placeholder="0.00"
                    className="pl-7 pr-12 bg-white/[0.02] border-white/10 focus:border-[#E25706]/50"
                    disabled={loading || !supportsPromptCaching}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                    /M
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="cacheCreation1hPrice">{t("form.cacheCreationPrice1h")}</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                    $
                  </span>
                  <Input
                    id="cacheCreation1hPrice"
                    type="number"
                    min="0"
                    step="any"
                    value={cacheCreation1hPrice}
                    onChange={(e) => setCacheCreation1hPrice(e.target.value)}
                    placeholder="0.00"
                    className="pl-7 pr-12 bg-white/[0.02] border-white/10 focus:border-[#E25706]/50"
                    disabled={loading || !supportsPromptCaching}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                    /M
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <SheetFooter className="border-t border-white/10">
          <div className="flex w-full items-center justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>
              {tCommon("cancel")}
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={loading}
              className="bg-[#E25706] hover:bg-[#E25706]/90"
            >
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {tCommon("confirm")}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

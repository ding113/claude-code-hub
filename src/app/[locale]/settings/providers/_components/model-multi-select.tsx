"use client";
import { Check, ChevronsUpDown, Cloud, Database, Loader2, Plus, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { getAvailableModelsByProviderType } from "@/actions/model-prices";
import { fetchUpstreamModels, getUnmaskedProviderKey } from "@/actions/providers";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { ProviderType } from "@/types/provider";

type ModelSource = "upstream" | "fallback" | "loading";

interface ModelMultiSelectProps {
  providerType: ProviderType;
  selectedModels: string[];
  onChange: (models: string[]) => void;
  disabled?: boolean;
  /** 供应商 URL（用于获取上游模型列表） */
  providerUrl?: string;
  /** API Key（用于获取上游模型列表） */
  apiKey?: string;
  /** 代理 URL */
  proxyUrl?: string | null;
  /** 代理失败时是否回退到直连 */
  proxyFallbackToDirect?: boolean;
  /** 供应商 ID（编辑模式下用于获取未脱敏的 API Key） */
  providerId?: number;
}

export function ModelMultiSelect({
  providerType,
  selectedModels,
  onChange,
  disabled = false,
  providerUrl,
  apiKey,
  proxyUrl,
  proxyFallbackToDirect,
  providerId,
}: ModelMultiSelectProps) {
  const t = useTranslations("settings.providers.form.modelSelect");
  const [open, setOpen] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [modelSource, setModelSource] = useState<ModelSource>("loading");
  const [customModel, setCustomModel] = useState("");

  // 供应商类型到显示名称的映射
  const getProviderTypeLabel = (type: string): string => {
    const typeMap: Record<string, string> = {
      claude: t("claude"),
      "claude-auth": t("claude"),
      codex: t("openai"),
      gemini: t("gemini"),
      "gemini-cli": t("gemini"),
      "openai-compatible": t("openai"),
    };
    return typeMap[type] || t("openai");
  };

  // 加载模型列表（优先上游，失败则回退）
  const loadModels = useCallback(async () => {
    setLoading(true);
    setModelSource("loading");

    // 尝试从上游获取模型列表
    if (providerUrl) {
      // 解析 API Key：优先使用表单中的 key，否则从数据库获取
      let resolvedKey = apiKey?.trim() || "";

      if (!resolvedKey && providerId) {
        const keyResult = await getUnmaskedProviderKey(providerId);
        if (keyResult.ok && keyResult.data?.key) {
          resolvedKey = keyResult.data.key;
        }
      }

      if (resolvedKey) {
        const upstreamResult = await fetchUpstreamModels({
          providerUrl,
          apiKey: resolvedKey,
          providerType,
          proxyUrl,
          proxyFallbackToDirect,
        });

        if (upstreamResult.ok && upstreamResult.data) {
          setAvailableModels(upstreamResult.data.models);
          setModelSource("upstream");
          setLoading(false);
          return;
        }
      }
    }

    // 回退到全量模型列表
    const fallbackModels = await getAvailableModelsByProviderType();
    setAvailableModels(fallbackModels);
    setModelSource("fallback");
    setLoading(false);
  }, [providerUrl, apiKey, providerId, providerType, proxyUrl, proxyFallbackToDirect]);

  // 组件挂载时加载模型
  useEffect(() => {
    loadModels();
  }, [loadModels]);

  const toggleModel = (model: string) => {
    if (selectedModels.includes(model)) {
      onChange(selectedModels.filter((m) => m !== model));
    } else {
      onChange([...selectedModels, model]);
    }
  };

  const selectAll = () => onChange(availableModels);
  const clearAll = () => onChange([]);

  const handleAddCustomModel = () => {
    const trimmed = customModel.trim();
    if (!trimmed) return;

    if (selectedModels.includes(trimmed)) {
      setCustomModel("");
      return;
    }

    onChange([...selectedModels, trimmed]);
    setCustomModel("");
  };

  // 数据来源指示器
  const SourceIndicator = () => {
    if (loading) return null;

    const isUpstream = modelSource === "upstream";
    const Icon = isUpstream ? Cloud : Database;
    const label = isUpstream ? t("sourceUpstream") : t("sourceFallback");
    const description = isUpstream ? t("sourceUpstreamDesc") : t("sourceFallbackDesc");

    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted/50 text-xs text-muted-foreground">
              <Icon className="h-3 w-3" />
              <span>{label}</span>
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-[200px]">
            <p className="text-xs">{description}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between"
        >
          {selectedModels.length === 0 ? (
            <span className="text-muted-foreground">
              {t("allowAllModels", {
                type: getProviderTypeLabel(providerType),
              })}
            </span>
          ) : (
            <div className="flex gap-2 items-center">
              <span className="truncate">
                {t("selectedCount", { count: selectedModels.length })}
              </span>
              <Badge variant="secondary" className="ml-auto">
                {selectedModels.length}
              </Badge>
            </div>
          )}
          {loading ? (
            <Loader2 className="ml-2 h-4 w-4 shrink-0 animate-spin opacity-50" />
          ) : (
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[400px] p-0 flex flex-col"
        align="start"
        onWheel={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
      >
        <Command shouldFilter={true}>
          <CommandInput placeholder={t("searchPlaceholder")} />
          <CommandList className="max-h-[250px] overflow-y-auto">
            <CommandEmpty>{loading ? t("loading") : t("notFound")}</CommandEmpty>

            {!loading && (
              <>
                {/* 数据来源指示 + 快捷操作 */}
                <CommandGroup>
                  <div className="flex items-center justify-between gap-2 p-2">
                    <div className="flex items-center gap-2">
                      <SourceIndicator />
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-6 w-6"
                              onClick={(e) => {
                                e.stopPropagation();
                                loadModels();
                              }}
                              type="button"
                            >
                              <RefreshCw className="h-3 w-3" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="top">
                            <p className="text-xs">{t("refresh")}</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={selectAll}
                        className="h-7 text-xs"
                        type="button"
                      >
                        {t("selectAll", { count: availableModels.length })}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={clearAll}
                        disabled={selectedModels.length === 0}
                        className="h-7 text-xs"
                        type="button"
                      >
                        {t("clear")}
                      </Button>
                    </div>
                  </div>
                </CommandGroup>

                {/* 模型列表 */}
                <CommandGroup>
                  {availableModels.map((model) => (
                    <CommandItem
                      key={model}
                      value={model}
                      onSelect={() => toggleModel(model)}
                      className="cursor-pointer"
                    >
                      <Checkbox
                        checked={selectedModels.includes(model)}
                        className="mr-2"
                        onCheckedChange={() => toggleModel(model)}
                      />
                      <span className="font-mono text-sm flex-1">{model}</span>
                      {selectedModels.includes(model) && <Check className="h-4 w-4 text-primary" />}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>

        {/* 手动输入区域 */}
        <div className="border-t p-3 space-y-2">
          <Label className="text-xs font-medium">{t("manualAdd")}</Label>
          <div className="flex gap-2">
            <Input
              placeholder={t("manualPlaceholder")}
              value={customModel}
              onChange={(e) => setCustomModel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddCustomModel();
                }
              }}
              disabled={disabled}
              className="font-mono text-sm flex-1"
            />
            <Button
              size="sm"
              onClick={handleAddCustomModel}
              disabled={disabled || !customModel.trim()}
              type="button"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t("manualDesc")}</p>
        </div>
      </PopoverContent>
    </Popover>
  );
}

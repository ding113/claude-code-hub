"use client";
import { useState, useEffect } from "react";
import { Check, ChevronsUpDown, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getAvailableModelsByProviderType } from "@/actions/model-prices";
import { useTranslations } from "next-intl";

interface ModelMultiSelectProps {
  providerType: "claude" | "claude-auth" | "codex" | "gemini" | "gemini-cli" | "openai-compatible";
  selectedModels: string[];
  onChange: (models: string[]) => void;
  disabled?: boolean;
}

export function ModelMultiSelect({
  providerType,
  selectedModels,
  onChange,
  disabled = false,
}: ModelMultiSelectProps) {
  const t = useTranslations("settings.providers.form.modelSelect");
  const [open, setOpen] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  // 新增：手动输入自定义模型的状态
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

  // 当供应商类型变化时，重新加载模型列表
  useEffect(() => {
    async function loadModels() {
      setLoading(true);
      const models = await getAvailableModelsByProviderType();
      setAvailableModels(models);
      setLoading(false);
    }
    loadModels();
  }, [providerType]);

  const toggleModel = (model: string) => {
    if (selectedModels.includes(model)) {
      onChange(selectedModels.filter((m) => m !== model));
    } else {
      onChange([...selectedModels, model]);
    }
  };

  const selectAll = () => onChange(availableModels);
  const clearAll = () => onChange([]);

  // 新增：手动添加自定义模型
  const handleAddCustomModel = () => {
    const trimmed = customModel.trim();
    if (!trimmed) return;

    if (selectedModels.includes(trimmed)) {
      // 已存在，清空输入框
      setCustomModel("");
      return;
    }

    // 添加到选中列表
    onChange([...selectedModels, trimmed]);
    setCustomModel("");
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
                {/* 快捷操作 */}
                <CommandGroup>
                  <div className="flex gap-2 p-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={selectAll}
                      className="flex-1"
                      type="button"
                    >
                      {t("selectAll", { count: availableModels.length })}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={clearAll}
                      disabled={selectedModels.length === 0}
                      className="flex-1"
                      type="button"
                    >
                      {t("clear")}
                    </Button>
                  </div>
                </CommandGroup>

                {/* 模型列表（不分组，字母排序） */}
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

        {/* 新增：手动输入区域 */}
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

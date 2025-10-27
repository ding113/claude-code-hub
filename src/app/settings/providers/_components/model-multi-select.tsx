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

interface ModelMultiSelectProps {
  providerType: "claude" | "codex" | "gemini-cli" | "openai-compatible";
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
  const [open, setOpen] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  // 新增：手动输入自定义模型的状态
  const [customModel, setCustomModel] = useState("");

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
              允许所有 {providerType === "claude" ? "Claude" : "OpenAI"} 模型
            </span>
          ) : (
            <div className="flex gap-2 items-center">
              <span className="truncate">已选择 {selectedModels.length} 个模型</span>
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
        className="w-[400px] h-[500px] p-0 flex flex-col"
        align="start"
        onWheel={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
      >
        <Command shouldFilter={true} className="flex-1">
          <CommandInput placeholder="搜索模型名称..." />
          <CommandList className="flex-1 max-h-[250px] overflow-y-auto">
            <CommandEmpty>{loading ? "加载中..." : "未找到模型"}</CommandEmpty>

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
                      全选 ({availableModels.length})
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={clearAll}
                      disabled={selectedModels.length === 0}
                      className="flex-1"
                      type="button"
                    >
                      清空
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
          <Label className="text-xs font-medium">手动添加模型</Label>
          <div className="flex gap-2">
            <Input
              placeholder="输入模型名称（如 gpt-5-turbo）"
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
          <p className="text-xs text-muted-foreground">
            支持添加任意模型名称（不限于价格表中的模型）
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}

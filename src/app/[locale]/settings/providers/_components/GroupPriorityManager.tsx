"use client";

import { AlertTriangle, ArrowRight, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface PriorityOverride {
  group: string;
  priority: number;
}

interface GroupPriorityManagerProps {
  value: Record<string, number>;
  onChange: (value: Record<string, number>) => void;
  currentGroupTags: string[];
  groupSuggestions: string[];
  disabled?: boolean;
}

export function GroupPriorityManager({
  value,
  onChange,
  currentGroupTags,
  groupSuggestions,
  disabled,
}: GroupPriorityManagerProps) {
  const overridesArray: PriorityOverride[] = Object.entries(value || {}).map(
    ([group, priority]) => ({
      group,
      priority,
    })
  );

  const availableGroups = Array.from(new Set([...currentGroupTags, ...groupSuggestions])).filter(
    Boolean
  );

  const addRule = () => {
    const newOverrides = { ...value, "": 0 };
    onChange(newOverrides);
  };

  const removeRule = (group: string) => {
    const newOverrides = { ...value };
    delete newOverrides[group];
    onChange(newOverrides);
  };

  const updateRule = (oldGroup: string, newGroup: string, priority: number) => {
    const newOverrides = { ...value };
    if (oldGroup !== newGroup) {
      delete newOverrides[oldGroup];
    }
    newOverrides[newGroup] = priority;
    onChange(newOverrides);
  };

  return (
    <div className="space-y-2">
      {overridesArray.length > 0 && (
        <div className="space-y-2 rounded-lg bg-muted/30 p-3">
          {overridesArray.map((rule, index) => {
            const isOrphan = rule.group && !currentGroupTags.includes(rule.group);

            return (
              <div
                key={`${rule.group}-${index}`}
                className="group flex flex-col sm:flex-row gap-2 items-start sm:items-center animate-in slide-in-from-top-1"
              >
                <div className="relative flex-1 w-full sm:w-auto min-w-[140px]">
                  <Select
                    value={rule.group}
                    onValueChange={(val) => updateRule(rule.group, val, rule.priority)}
                    disabled={disabled}
                  >
                    <SelectTrigger className="w-full h-9 bg-background/50 focus:bg-background transition-colors">
                      <SelectValue placeholder="选择分组" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableGroups
                        .filter((g) => value?.[g] === undefined || g === rule.group)
                        .map((g) => (
                          <SelectItem key={g} value={g}>
                            {g}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>

                  {isOrphan && (
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 z-10">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <AlertTriangle className="h-4 w-4 text-amber-500/80 hover:text-amber-500 cursor-help transition-colors" />
                        </TooltipTrigger>
                        <TooltipContent side="top">
                          <p>此分组不在供应商的分组标签中，规则不会生效</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  )}
                </div>

                <ArrowRight className="hidden sm:block w-3 h-3 text-muted-foreground/40 shrink-0" />

                <div className="flex items-center gap-2 w-full sm:w-auto shrink-0">
                  <Input
                    type="number"
                    value={rule.priority}
                    onChange={(e) =>
                      updateRule(rule.group, rule.group, parseInt(e.target.value) || 0)
                    }
                    className="w-full sm:w-[100px] h-9 bg-background/50 focus:bg-background transition-colors text-right font-mono"
                    placeholder="优先级"
                    min={0}
                    disabled={disabled}
                    aria-label={rule.group ? `${rule.group} 分组的优先级` : "优先级值"}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeRule(rule.group)}
                    disabled={disabled}
                    className="h-9 w-9 text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-colors"
                    type="button"
                    aria-label={`删除分组 ${rule.group} 的优先级覆盖`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={addRule}
        disabled={disabled}
        className="h-8 border-dashed hover:border-solid hover:bg-primary/5 hover:text-primary transition-all"
      >
        <Plus className="h-3.5 w-3.5 mr-1.5" />
        添加分组优先级覆盖
      </Button>
    </div>
  );
}

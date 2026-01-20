"use client";

import { Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface PriorityCellProps {
  priority: number;
  overrides?: Record<string, number> | null;
  onUpdatePriority?: (newPriority: number) => Promise<boolean>;
  validatePriority?: (raw: string) => string | null;
  onUpdateOverride?: (group: string, newPriority: number) => Promise<boolean>;
  onAddOverride?: (group: string, priority: number) => Promise<boolean>;
  onDeleteOverride?: (group: string) => Promise<boolean>;
  availableGroups?: string[];
  activeGroup?: string | null;
}

interface PriorityRule {
  label: string;
  value: number;
  isDefault: boolean;
}

export function PriorityCell({
  priority,
  overrides,
  onUpdatePriority,
  validatePriority,
  onUpdateOverride,
  onAddOverride,
  onDeleteOverride,
  availableGroups = [],
  activeGroup,
}: PriorityCellProps) {
  const t = useTranslations("settings.providers.priority");
  const [editingGroup, setEditingGroup] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<number>(0);
  const [saving, setSaving] = useState(false);
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [newGroup, setNewGroup] = useState("");
  const [newPriority, setNewPriority] = useState(0);
  const [editingGlobal, setEditingGlobal] = useState(false);
  const [globalDraft, setGlobalDraft] = useState(() => priority.toString());

  const trimmedGlobal = globalDraft.trim();
  const globalValidationError = validatePriority ? validatePriority(trimmedGlobal) : null;
  const parsedGlobal = trimmedGlobal.length > 0 ? Number(trimmedGlobal) : null;
  const canSaveGlobal =
    !!onUpdatePriority &&
    !saving &&
    globalValidationError == null &&
    parsedGlobal != null &&
    Number.isFinite(parsedGlobal);

  const handleSaveGlobal = async () => {
    if (!onUpdatePriority || !canSaveGlobal || parsedGlobal == null) return;
    setSaving(true);
    try {
      const success = await onUpdatePriority(parsedGlobal);
      if (success) setEditingGlobal(false);
    } finally {
      setSaving(false);
    }
  };

  const hasOverrides = overrides && Object.keys(overrides).length > 0;

  // 只包含覆盖规则，不包含全局（全局在外面已经可编辑）
  const overrideRules: PriorityRule[] = Object.entries(overrides || {}).map(([group, val]) => ({
    label: group,
    value: val,
    isDefault: false,
  }));

  const allRulesForMinCalc: PriorityRule[] = [
    { label: t("global"), value: priority, isDefault: true },
    ...overrideRules,
  ];

  const minPriority = Math.min(...allRulesForMinCalc.map((r) => r.value));
  const isGlobalHighest = priority === minPriority;

  // 计算当前上下文的实际优先级
  const displayedPriority =
    activeGroup && overrides?.[activeGroup] !== undefined ? overrides[activeGroup] : priority;

  const isDisplayingOverride = activeGroup && overrides?.[activeGroup] !== undefined;

  return (
    <div className="flex items-center justify-center gap-2 h-8">
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              "font-mono font-medium cursor-pointer hover:underline underline-offset-4 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors",
              isDisplayingOverride && "text-blue-600 dark:text-blue-400"
            )}
            title={
              isDisplayingOverride
                ? t("groupPriorityWithGlobalTooltip", { group: activeGroup, global: priority })
                : t("globalPriorityTooltip")
            }
          >
            {displayedPriority}
          </button>
        </PopoverTrigger>

        <PopoverContent className="w-64 p-0" align="start">
          <div className="p-2 space-y-1 group">
            <div className="text-xs font-semibold text-muted-foreground px-2 mb-2">
              {t("priorityBreakdown")}
            </div>

            {/* 全局优先级编辑行 */}
            <div
              className={cn(
                "flex justify-between items-center text-xs p-1.5 rounded transition-colors",
                isGlobalHighest &&
                  "bg-green-50 text-green-700 font-medium dark:bg-green-950/30 dark:text-green-400",
                !isGlobalHighest && "hover:bg-muted/50"
              )}
            >
              <span className="text-muted-foreground">{t("global")}</span>
              <div className="flex items-center gap-1">
                {editingGlobal && onUpdatePriority ? (
                  <>
                    <Input
                      type="number"
                      value={globalDraft}
                      onChange={(e) => setGlobalDraft(e.target.value)}
                      className="h-6 w-16 text-xs text-right font-mono"
                      autoFocus
                      min={0}
                      disabled={saving}
                      aria-invalid={globalValidationError != null}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void handleSaveGlobal();
                        }
                        if (e.key === "Escape") {
                          setEditingGlobal(false);
                          setGlobalDraft(priority.toString());
                        }
                      }}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 p-0"
                      onClick={handleSaveGlobal}
                      disabled={!canSaveGlobal}
                    >
                      ✓
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 p-0"
                      onClick={() => {
                        setEditingGlobal(false);
                        setGlobalDraft(priority.toString());
                      }}
                      disabled={saving}
                    >
                      ✕
                    </Button>
                  </>
                ) : (
                  <>
                    {onUpdatePriority ? (
                      <button
                        type="button"
                        className="font-mono font-medium tabular-nums cursor-pointer hover:underline underline-offset-2 rounded-sm px-2 py-0.5 min-w-[2rem] text-right transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        onClick={() => {
                          setEditingGlobal(true);
                          setGlobalDraft(priority.toString());
                        }}
                      >
                        {priority}
                      </button>
                    ) : (
                      <span className="font-mono font-medium tabular-nums px-2">{priority}</span>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* 覆盖规则列表 */}
            {overrideRules.map((rule) => {
              const isHighest = rule.value === minPriority;
              const isOverrideHigher = !rule.isDefault && rule.value < priority;
              const isEditing = editingGroup === rule.label;

              const handleEdit = () => {
                if (!rule.isDefault && onUpdateOverride) {
                  setEditingGroup(rule.label);
                  setEditValue(rule.value);
                }
              };

              const handleSave = async () => {
                if (onUpdateOverride && editingGroup) {
                  setSaving(true);
                  const success = await onUpdateOverride(editingGroup, editValue);
                  setSaving(false);
                  if (success) {
                    setEditingGroup(null);
                  }
                }
              };

              const handleCancel = () => {
                setEditingGroup(null);
              };

              const handleDelete = async () => {
                if (onDeleteOverride && !rule.isDefault) {
                  setSaving(true);
                  await onDeleteOverride(rule.label);
                  setSaving(false);
                }
              };

              return (
                <div
                  key={rule.label}
                  className={cn(
                    "flex justify-between items-center text-xs p-1.5 rounded transition-colors",
                    isHighest &&
                      "bg-green-50 text-green-700 font-medium dark:bg-green-950/30 dark:text-green-400",
                    isOverrideHigher &&
                      !isHighest &&
                      "bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400",
                    !isHighest && !isOverrideHigher && "hover:bg-muted/50"
                  )}
                  title={
                    rule.isDefault
                      ? t("globalDefaultTooltip")
                      : t("groupPriorityTooltip", { group: rule.label })
                  }
                >
                  <span className="truncate max-w-[120px]">{rule.label}</span>
                  <div className="flex items-center gap-2">
                    {isEditing ? (
                      <>
                        <Input
                          type="number"
                          value={editValue}
                          onChange={(e) => setEditValue(parseInt(e.target.value, 10) || 0)}
                          className="h-6 w-16 text-xs"
                          min={0}
                          disabled={saving}
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleSave();
                            if (e.key === "Escape") handleCancel();
                          }}
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 p-0"
                          onClick={handleSave}
                          disabled={saving}
                        >
                          ✓
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 p-0"
                          onClick={handleCancel}
                          disabled={saving}
                        >
                          ✕
                        </Button>
                      </>
                    ) : (
                      <>
                        {onUpdateOverride ? (
                          <button
                            type="button"
                            className="font-mono font-medium tabular-nums cursor-pointer hover:underline underline-offset-2 rounded-sm px-2 py-0.5 min-w-[2rem] text-right transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                            onClick={handleEdit}
                          >
                            {rule.value}
                          </button>
                        ) : (
                          <span className="font-mono font-medium tabular-nums px-2">
                            {rule.value}
                          </span>
                        )}
                        {!rule.isDefault && onDeleteOverride && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-4 w-4 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={handleDelete}
                          >
                            <Trash2 className="w-3 h-3 text-destructive" />
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}

            {/* 新建覆盖规则 */}
            {onAddOverride && availableGroups.length > 0 && (
              <div className="border-t pt-2 mt-2">
                {isAddingNew ? (
                  <div className="space-y-2 p-1">
                    <div className="flex items-center gap-2">
                      <Select value={newGroup} onValueChange={setNewGroup}>
                        <SelectTrigger className="h-7 text-xs flex-1">
                          <SelectValue placeholder="选择分组" />
                        </SelectTrigger>
                        <SelectContent>
                          {availableGroups
                            .filter((g) => overrides?.[g] === undefined)
                            .map((g) => (
                              <SelectItem key={g} value={g}>
                                {g}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                      <Input
                        type="number"
                        value={newPriority}
                        onChange={(e) => setNewPriority(parseInt(e.target.value, 10) || 0)}
                        className="h-7 text-xs w-16"
                        placeholder="0"
                        min={0}
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0"
                        onClick={async () => {
                          if (newGroup && onAddOverride) {
                            setSaving(true);
                            const success = await onAddOverride(newGroup, newPriority);
                            setSaving(false);
                            if (success) {
                              setIsAddingNew(false);
                              setNewGroup("");
                              setNewPriority(0);
                            }
                          }
                        }}
                        disabled={!newGroup || saving}
                      >
                        ✓
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0"
                        onClick={() => {
                          setIsAddingNew(false);
                          setNewGroup("");
                          setNewPriority(0);
                        }}
                      >
                        ✕
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="w-full h-7 text-xs justify-start text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      setIsAddingNew(true);
                      setNewPriority(0);
                    }}
                  >
                    <Plus className="w-3 h-3 mr-1.5" />
                    添加覆盖规则
                  </Button>
                )}
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

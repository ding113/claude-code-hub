"use client";

import { Layers, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import type * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

export interface GroupPriorityPopoverProps {
  priority: number;
  groupPriorities: Record<string, number> | null;
  groupTag: string | null;
  onSave: (priority: number, groupPriorities: Record<string, number> | null) => Promise<boolean>;
  disabled?: boolean;
  displayPriority?: number;
}

interface GroupPriorityDraft {
  default: string;
  groups: Record<string, string>;
}

function parseGroupTag(groupTag: string | null): string[] {
  if (!groupTag) return [];
  return groupTag
    .split(",")
    .map((g) => g.trim())
    .filter(Boolean);
}

function validatePriority(value: string): boolean {
  if (value.length === 0) return true; // Empty is valid (means use default)
  const num = Number(value);
  return Number.isFinite(num) && Number.isInteger(num) && num >= 0 && num <= 2147483647;
}

export function GroupPriorityPopover({
  priority,
  groupPriorities,
  groupTag,
  onSave,
  disabled = false,
  displayPriority,
}: GroupPriorityPopoverProps) {
  const t = useTranslations("settings.providers.inlineEdit");
  const tGroupPriority = useTranslations("settings.providers.groupPriority");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const groups = useMemo(() => parseGroupTag(groupTag), [groupTag]);
  const hasMultipleGroups = groups.length > 1;

  const initialDraft = useMemo((): GroupPriorityDraft => {
    const groupsDraft: Record<string, string> = {};
    for (const group of groups) {
      const value = groupPriorities?.[group];
      groupsDraft[group] = value !== undefined ? value.toString() : "";
    }
    return {
      default: priority.toString(),
      groups: groupsDraft,
    };
  }, [priority, groupPriorities, groups]);

  const [draft, setDraft] = useState<GroupPriorityDraft>(initialDraft);
  const firstInputRef = useRef<HTMLInputElement>(null);

  // Validation
  const validationErrors = useMemo(() => {
    const errors: Record<string, boolean> = {};
    errors.default = !validatePriority(draft.default) || draft.default.length === 0;
    for (const group of groups) {
      errors[group] = !validatePriority(draft.groups[group] || "");
    }
    return errors;
  }, [draft, groups]);

  const hasErrors = Object.values(validationErrors).some(Boolean);

  // Focus first input when opened
  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => {
      firstInputRef.current?.focus();
      firstInputRef.current?.select();
    });
    return () => cancelAnimationFrame(raf);
  }, [open]);

  const stopPropagation = (e: React.SyntheticEvent) => {
    e.stopPropagation();
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (disabled && nextOpen) return;

    if (nextOpen) {
      setDraft(initialDraft);
    } else {
      setSaving(false);
    }

    setOpen(nextOpen);
  };

  const handleCancel = () => {
    setDraft(initialDraft);
    setOpen(false);
  };

  const handleSave = async () => {
    if (hasErrors || saving) return;

    setSaving(true);
    try {
      const newPriority = Number(draft.default);

      // Build new groupPriorities
      let newGroupPriorities: Record<string, number> | null = null;
      for (const group of groups) {
        const value = draft.groups[group]?.trim();
        if (value && value.length > 0) {
          if (!newGroupPriorities) newGroupPriorities = {};
          newGroupPriorities[group] = Number(value);
        }
      }

      const ok = await onSave(newPriority, newGroupPriorities);
      if (ok) {
        setOpen(false);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDefaultChange = (value: string) => {
    setDraft((prev) => ({ ...prev, default: value }));
  };

  const handleGroupChange = (group: string, value: string) => {
    setDraft((prev) => ({
      ...prev,
      groups: { ...prev.groups, [group]: value },
    }));
  };

  // Calculate display value (show priority with indicator if has overrides)
  const hasOverrides = groupPriorities && Object.keys(groupPriorities).length > 0;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "tabular-nums font-medium underline-offset-4 rounded-sm inline-flex items-center gap-1",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
            disabled ? "cursor-default text-muted-foreground" : "cursor-pointer hover:underline"
          )}
          onPointerDown={stopPropagation}
          onClick={stopPropagation}
        >
          {displayPriority ?? priority}
          {hasMultipleGroups && hasOverrides && (
            <Layers
              className="h-3 w-3 text-muted-foreground"
              aria-label={tGroupPriority("hasOverrides")}
            />
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="center"
        side="bottom"
        sideOffset={6}
        className="w-auto p-3 min-w-[200px]"
        onPointerDown={stopPropagation}
        onClick={stopPropagation}
      >
        <div className="grid gap-2">
          <div className="text-sm font-medium">{tGroupPriority("title")}</div>

          {/* Default priority row */}
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">{tGroupPriority("default")}</span>
            <Input
              ref={firstInputRef}
              value={draft.default}
              onChange={(e) => handleDefaultChange(e.target.value)}
              disabled={disabled || saving}
              className={cn(
                "w-20 tabular-nums text-right",
                validationErrors.default && "border-destructive"
              )}
              type="number"
              inputMode="numeric"
              step="1"
              min="0"
              onPointerDown={stopPropagation}
              onClick={stopPropagation}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Escape") {
                  e.preventDefault();
                  handleCancel();
                }
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleSave();
                }
              }}
            />
          </div>

          {/* Group priority rows */}
          {hasMultipleGroups && groups.length > 0 && (
            <>
              <Separator />
              {groups.map((group) => (
                <div key={group} className="flex items-center justify-between gap-3">
                  <span className="text-sm font-mono truncate max-w-[100px]" title={group}>
                    {group}
                  </span>
                  <Input
                    value={draft.groups[group] || ""}
                    onChange={(e) => handleGroupChange(group, e.target.value)}
                    disabled={disabled || saving}
                    placeholder={draft.default}
                    className={cn(
                      "w-20 tabular-nums text-right",
                      validationErrors[group] && "border-destructive"
                    )}
                    type="number"
                    inputMode="numeric"
                    step="1"
                    min="0"
                    onPointerDown={stopPropagation}
                    onClick={stopPropagation}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Escape") {
                        e.preventDefault();
                        handleCancel();
                      }
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void handleSave();
                      }
                    }}
                  />
                </div>
              ))}
              <p className="text-xs text-muted-foreground">{tGroupPriority("emptyHint")}</p>
            </>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleCancel}
              disabled={saving}
            >
              {t("cancel")}
            </Button>
            <Button type="button" size="sm" onClick={handleSave} disabled={hasErrors || saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("save")}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

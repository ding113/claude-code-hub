"use client";

import { Loader2, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import type * as React from "react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PROVIDER_GROUP } from "@/lib/constants/provider.constants";
import { getContrastTextColor, getGroupColor } from "@/lib/utils/color";

export interface GroupTagEditPopoverProps {
  groupTag: string | null;
  availableGroups: string[];
  onSave: (groupTag: string | null) => Promise<boolean>;
  disabled?: boolean;
}

export function GroupTagEditPopover({
  groupTag,
  availableGroups,
  onSave,
  disabled = false,
}: GroupTagEditPopoverProps) {
  const t = useTranslations("settings.providers.groupEdit");
  const tInline = useTranslations("settings.providers.inlineEdit");
  const [open, setOpen] = useState(false);
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const [newGroup, setNewGroup] = useState("");
  const [saving, setSaving] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const initialGroupsRef = useRef<Set<string>>(new Set());

  const currentGroups = groupTag
    ? groupTag
        .split(",")
        .map((g) => g.trim())
        .filter(Boolean)
    : [];

  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [open]);

  const stopPropagation = (e: React.SyntheticEvent) => {
    e.stopPropagation();
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (disabled && nextOpen) return;

    if (nextOpen) {
      const groups = new Set(currentGroups);
      initialGroupsRef.current = new Set(groups);
      setSelectedGroups(groups);
      setNewGroup("");
    } else {
      setSaving(false);
    }

    setOpen(nextOpen);
  };

  const handleCancel = () => {
    setSelectedGroups(new Set(initialGroupsRef.current));
    setNewGroup("");
    setOpen(false);
  };

  const handleToggleGroup = (group: string) => {
    setSelectedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) {
        next.delete(group);
      } else {
        next.add(group);
      }
      return next;
    });
  };

  const handleAddGroup = () => {
    const trimmed = newGroup.trim();
    if (!trimmed) return;

    // Validate: no comma allowed
    if (trimmed.includes(",")) {
      toast.error(t("commaNotAllowed"));
      return;
    }

    // Validate: reserved names (case-insensitive)
    const lowerTrimmed = trimmed.toLowerCase();
    if (lowerTrimmed === PROVIDER_GROUP.DEFAULT || lowerTrimmed === PROVIDER_GROUP.ALL) {
      toast.error(t("reservedGroupName"));
      return;
    }

    // Validate: no duplicates
    if (selectedGroups.has(trimmed)) {
      return;
    }

    setSelectedGroups((prev) => new Set(prev).add(trimmed));
    setNewGroup("");
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const result = selectedGroups.size > 0 ? Array.from(selectedGroups).join(",") : null;
      const ok = await onSave(result);
      if (ok) {
        setOpen(false);
      }
    } finally {
      setSaving(false);
    }
  };

  const allDisplayGroups = Array.from(new Set([...availableGroups, ...selectedGroups])).filter(
    (g) => g !== "default"
  );

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="inline-flex flex-wrap items-center gap-1 cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          onPointerDown={stopPropagation}
          onClick={stopPropagation}
        >
          {currentGroups.length > 0 ? (
            currentGroups.map((tag, index) => {
              const bgColor = getGroupColor(tag);
              return (
                <Badge
                  key={`${tag}-${index}`}
                  className="flex-shrink-0 text-xs hover:opacity-80 transition-opacity"
                  style={{
                    backgroundColor: bgColor,
                    color: getContrastTextColor(bgColor),
                  }}
                >
                  {tag}
                </Badge>
              );
            })
          ) : (
            <Badge variant="outline" className="flex-shrink-0 hover:bg-muted transition-colors">
              {t("defaultGroup")}
            </Badge>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={6}
        className="w-64 p-3"
        onPointerDown={stopPropagation}
        onClick={stopPropagation}
      >
        <div className="grid gap-3">
          <div className="text-sm font-medium">{t("title")}</div>

          <div className="max-h-48 overflow-y-auto flex flex-wrap gap-2">
            {allDisplayGroups.length > 0 ? (
              allDisplayGroups.map((group) => (
                <label
                  key={group}
                  className={`inline-flex items-center gap-1.5 cursor-pointer px-2.5 py-1 rounded-md border text-xs transition-colors ${
                    selectedGroups.has(group)
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background hover:bg-accent border-input"
                  }`}
                >
                  <Checkbox
                    checked={selectedGroups.has(group)}
                    onCheckedChange={() => handleToggleGroup(group)}
                    disabled={saving}
                    className="h-3.5 w-3.5"
                  />
                  <span>{group}</span>
                </label>
              ))
            ) : (
              <div className="text-sm text-muted-foreground py-2">{t("noGroups")}</div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Input
              ref={inputRef}
              value={newGroup}
              onChange={(e) => setNewGroup(e.target.value)}
              placeholder={t("addPlaceholder")}
              disabled={saving}
              className="flex-1 h-8 text-sm"
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
                  handleAddGroup();
                }
              }}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleAddGroup}
              disabled={saving || !newGroup.trim()}
              className="h-8 px-2"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex items-center justify-end gap-2 pt-1 border-t">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleCancel}
              disabled={saving}
            >
              {tInline("cancel")}
            </Button>
            <Button type="button" size="sm" onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {tInline("save")}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

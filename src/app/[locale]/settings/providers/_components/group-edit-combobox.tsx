"use client";

import { Loader2, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import type * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useMediaQuery } from "@/lib/hooks/use-media-query";
import { cn } from "@/lib/utils";
import { getContrastTextColor, getGroupColor } from "@/lib/utils/color";

const MAX_GROUP_NAME_LENGTH = 50;

export interface GroupEditComboboxProps {
  currentGroups: string[];
  allGroups: string[];
  userGroups: string[];
  isAdmin: boolean;
  onSave: (groups: string[]) => Promise<boolean>;
  disabled?: boolean;
}

export function GroupEditCombobox({
  currentGroups,
  allGroups,
  userGroups,
  isAdmin,
  onSave,
  disabled = false,
}: GroupEditComboboxProps) {
  const t = useTranslations("settings.providers.inlineEdit");
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const [open, setOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  // Sync selectedGroups with currentGroups when opening
  useEffect(() => {
    if (open) {
      setSelectedGroups([...currentGroups]);
      setSearchValue("");
    }
  }, [open, currentGroups]);

  // Auto-focus search input when opening
  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [open]);

  // Available groups: admin sees all groups, non-admin sees only their assigned groups
  const availableGroups = useMemo(() => {
    if (isAdmin) {
      return allGroups.filter((g) => g !== "default");
    }
    return userGroups.filter((g) => g !== "default");
  }, [isAdmin, allGroups, userGroups]);

  // Validation for new group name
  const validateGroupName = useCallback(
    (name: string): string | null => {
      const trimmed = name.trim();
      if (trimmed.length === 0) {
        return t("groupValidation.empty");
      }
      if (trimmed.includes(",")) {
        return t("groupValidation.noComma");
      }
      if (trimmed.length > MAX_GROUP_NAME_LENGTH) {
        return t("groupValidation.tooLong");
      }
      return null;
    },
    [t]
  );

  // Check if the search value matches an existing group (case-insensitive)
  const searchMatchesExisting = useMemo(() => {
    const trimmed = searchValue.trim().toLowerCase();
    return availableGroups.some((g) => g.toLowerCase() === trimmed);
  }, [searchValue, availableGroups]);

  // Can create a new group?
  const canCreateGroup = useMemo(() => {
    const trimmed = searchValue.trim();
    if (!isAdmin) return false;
    if (trimmed.length === 0) return false;
    if (searchMatchesExisting) return false;
    return validateGroupName(trimmed) === null;
  }, [isAdmin, searchValue, searchMatchesExisting, validateGroupName]);

  const stopPropagation = (e: React.SyntheticEvent) => {
    e.stopPropagation();
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (disabled && nextOpen) return;
    setOpen(nextOpen);
  };

  const toggleGroup = async (group: string) => {
    const previousSelection = [...selectedGroups];
    const newSelection = previousSelection.includes(group)
      ? previousSelection.filter((g) => g !== group)
      : [...previousSelection, group];

    setSelectedGroups(newSelection);

    // Optimistic update: save immediately
    setSaving(true);
    try {
      const ok = await onSave(newSelection);
      if (!ok) {
        // Rollback on failure
        setSelectedGroups(previousSelection);
      }
    } catch {
      // Rollback on exception
      setSelectedGroups(previousSelection);
    } finally {
      setSaving(false);
    }
  };

  const handleCreateGroup = async () => {
    const trimmed = searchValue.trim();
    if (!canCreateGroup) return;

    const previousSelection = [...selectedGroups];
    const newSelection = [...previousSelection, trimmed];
    setSelectedGroups(newSelection);
    setSearchValue("");

    // Save immediately
    setSaving(true);
    try {
      const ok = await onSave(newSelection);
      if (!ok) {
        // Rollback on failure
        setSelectedGroups(previousSelection);
      }
    } catch {
      // Rollback on exception
      setSelectedGroups(previousSelection);
    } finally {
      setSaving(false);
    }
  };

  // Trigger button: show badges if groups exist, otherwise show + button
  const triggerButton = (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        "inline-flex flex-wrap items-center gap-1 rounded-sm",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
        disabled ? "cursor-default" : "cursor-pointer"
      )}
      onPointerDown={stopPropagation}
      onClick={(e) => {
        e.stopPropagation();
        if (!isDesktop) handleOpenChange(true);
      }}
    >
      {currentGroups.length > 0 ? (
        currentGroups.map((tag, index) => {
          const bgColor = getGroupColor(tag);
          return (
            <Badge
              key={`${tag}-${index}`}
              className="text-xs"
              style={{ backgroundColor: bgColor, color: getContrastTextColor(bgColor) }}
            >
              {tag}
            </Badge>
          );
        })
      ) : (
        <Badge variant="outline" className="text-xs gap-1">
          <Plus className="h-3 w-3" />
          {t("addGroup")}
        </Badge>
      )}
    </button>
  );

  // Filter groups based on search
  const filteredGroups = useMemo(() => {
    const trimmed = searchValue.trim().toLowerCase();
    if (!trimmed) return availableGroups;
    return availableGroups.filter((g) => g.toLowerCase().includes(trimmed));
  }, [availableGroups, searchValue]);

  const commandContent = (
    <Command shouldFilter={false}>
      <CommandInput
        ref={inputRef}
        placeholder={t("searchGroups")}
        value={searchValue}
        onValueChange={setSearchValue}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            setOpen(false);
          }
          if (e.key === "Enter" && canCreateGroup) {
            e.preventDefault();
            void handleCreateGroup();
          }
        }}
      />
      <CommandList>
        <CommandEmpty>{canCreateGroup ? null : t("noGroupsAvailable")}</CommandEmpty>

        {/* Existing groups */}
        {filteredGroups.length > 0 && (
          <CommandGroup>
            <div className="grid grid-cols-3 gap-1 p-1">
              {filteredGroups.map((group) => {
                const isSelected = selectedGroups.includes(group);
                const bgColor = getGroupColor(group);
                return (
                  <CommandItem
                    key={group}
                    value={group}
                    onSelect={() => toggleGroup(group)}
                    className="cursor-pointer data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"
                    disabled={saving}
                  >
                    <Checkbox checked={isSelected} className="mr-1.5" disabled={saving} />
                    <span className="text-xs font-medium truncate" style={{ color: bgColor }}>
                      {group}
                    </span>
                  </CommandItem>
                );
              })}
            </div>
          </CommandGroup>
        )}

        {/* Create new group option (admin only) */}
        {canCreateGroup && (
          <CommandGroup>
            <CommandItem
              value={`create-${searchValue.trim()}`}
              onSelect={handleCreateGroup}
              className="cursor-pointer"
              disabled={saving}
            >
              <Plus className="h-4 w-4 mr-2" />
              <span>{t("createGroup", { name: searchValue.trim() })}</span>
            </CommandItem>
          </CommandGroup>
        )}
      </CommandList>

      {saving && (
        <div className="flex items-center justify-center py-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin mr-1" />
          {t("saving")}
        </div>
      )}
    </Command>
  );

  if (!isDesktop) {
    return (
      <>
        {triggerButton}
        <Drawer open={open} onOpenChange={handleOpenChange}>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>{t("editGroups")}</DrawerTitle>
            </DrawerHeader>
            <div className="px-4 pb-6">{commandContent}</div>
          </DrawerContent>
        </Drawer>
      </>
    );
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>{triggerButton}</PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={6}
        className="w-80 p-0"
        onPointerDown={stopPropagation}
        onClick={stopPropagation}
      >
        {commandContent}
      </PopoverContent>
    </Popover>
  );
}

"use client";

import { ChevronDown } from "lucide-react";
import { useMemo } from "react";
import { ArrayTagInputField } from "@/components/form/form-field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  CLIENT_RESTRICTION_PRESET_OPTIONS,
  getSelectedChildren,
  isAllChildrenSelected,
  isPresetSelected,
  mergePresetAndCustomClients,
  removePresetValues,
  setChildSelection,
  splitPresetAndCustomClients,
  togglePresetSelection,
} from "@/lib/client-restrictions/client-presets";
import { cn } from "@/lib/utils";

export interface ClientRestrictionsEditorProps {
  allowed: string[];
  blocked: string[];
  onAllowedChange: (next: string[]) => void;
  onBlockedChange: (next: string[]) => void;
  disabled?: boolean;
  onInvalidTag?: (tag: string, reason: string) => void;
  className?: string;
  translations: {
    allowAction: string;
    blockAction: string;
    customAllowedLabel: string;
    customAllowedPlaceholder: string;
    customBlockedLabel: string;
    customBlockedPlaceholder: string;
    customHelp: string;
    presetClients: Record<string, string>;
    subClients?: Record<string, string>;
    nSelected?: string;
  };
}

export function ClientRestrictionsEditor({
  allowed,
  blocked,
  onAllowedChange,
  onBlockedChange,
  disabled,
  onInvalidTag,
  className,
  translations,
}: ClientRestrictionsEditorProps) {
  const { customValues: customAllowed } = useMemo(
    () => splitPresetAndCustomClients(allowed),
    [allowed]
  );

  const { customValues: customBlocked } = useMemo(
    () => splitPresetAndCustomClients(blocked),
    [blocked]
  );

  const handleAllowToggle = (presetValue: string, checked: boolean) => {
    onAllowedChange(togglePresetSelection(allowed, presetValue, checked));
    if (checked) {
      onBlockedChange(removePresetValues(blocked, presetValue));
    }
  };

  const handleBlockToggle = (presetValue: string, checked: boolean) => {
    onBlockedChange(togglePresetSelection(blocked, presetValue, checked));
    if (checked) {
      onAllowedChange(removePresetValues(allowed, presetValue));
    }
  };

  const handleChildSelectionChange = (presetValue: string, selectedChildren: string[]) => {
    const preset = CLIENT_RESTRICTION_PRESET_OPTIONS.find((p) => p.value === presetValue);
    if (!preset) return;
    const isInAllowed = isPresetSelected(allowed, presetValue);
    const isInBlocked = isPresetSelected(blocked, presetValue);
    if (isInAllowed) {
      onAllowedChange(setChildSelection(allowed, preset, selectedChildren));
    } else if (isInBlocked) {
      onBlockedChange(setChildSelection(blocked, preset, selectedChildren));
    }
  };

  const getChildDisplayText = (preset: (typeof CLIENT_RESTRICTION_PRESET_OPTIONS)[number]) => {
    if (!preset.children) return null;
    const activeList = isPresetSelected(allowed, preset.value)
      ? allowed
      : isPresetSelected(blocked, preset.value)
        ? blocked
        : null;
    if (!activeList) return translations.subClients?.all ?? "All";
    const selected = getSelectedChildren(activeList, preset);
    if (selected.length === 0 || selected.length === preset.children.length) {
      return translations.subClients?.all ?? "All";
    }
    if (selected.length <= 2) {
      return selected
        .map((v) => {
          const child = preset.children!.find((c) => c.value === v);
          return child ? (translations.subClients?.[child.labelKey] ?? child.labelKey) : v;
        })
        .join(", ");
    }
    return (
      translations.nSelected?.replace("{count}", String(selected.length)) ?? String(selected.length)
    );
  };

  const handleCustomAllowedChange = (newCustom: string[]) => {
    onAllowedChange(mergePresetAndCustomClients(allowed, newCustom));
  };

  const handleCustomBlockedChange = (newCustom: string[]) => {
    onBlockedChange(mergePresetAndCustomClients(blocked, newCustom));
  };

  const renderPresetRow = (preset: (typeof CLIENT_RESTRICTION_PRESET_OPTIONS)[number]) => {
    const { value } = preset;
    const isAllowed = isPresetSelected(allowed, value);
    const isBlocked = isPresetSelected(blocked, value);
    const displayLabel = translations.presetClients[value] ?? value;

    return (
      <div key={value} className="flex items-center gap-4 py-1">
        <span className="text-sm flex-1 text-foreground">{displayLabel}</span>
        {preset.children && (
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1 px-2"
                disabled={disabled}
              >
                {getChildDisplayText(preset)}
                <ChevronDown className="h-3 w-3 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-52 p-2" align="start">
              <div className="space-y-1">
                <div className="flex items-center gap-2 py-1">
                  <Checkbox
                    id={`sub-all-${value}`}
                    checked={
                      !isAllowed && !isBlocked
                        ? true
                        : isAllChildrenSelected(isAllowed ? allowed : blocked, preset)
                    }
                    onCheckedChange={(checked) => {
                      const allChildren = preset.children!.map((c) => c.value);
                      handleChildSelectionChange(value, checked ? allChildren : []);
                    }}
                    disabled={disabled || (!isAllowed && !isBlocked)}
                  />
                  <Label
                    htmlFor={`sub-all-${value}`}
                    className="text-sm font-normal cursor-pointer"
                  >
                    {translations.subClients?.all ?? "All"}
                  </Label>
                </div>
                <div className="border-t my-1" />
                {preset.children.map((child) => {
                  const activeList = isAllowed ? allowed : isBlocked ? blocked : [];
                  const isChildChecked =
                    activeList.includes(preset.value) || activeList.includes(child.value);
                  return (
                    <div key={child.value} className="flex items-center gap-2 py-1 pl-2">
                      <Checkbox
                        id={`sub-${child.value}`}
                        checked={isChildChecked}
                        onCheckedChange={(checked) => {
                          const currentSelected = getSelectedChildren(activeList, preset);
                          const next = checked
                            ? [...currentSelected, child.value]
                            : currentSelected.filter((v) => v !== child.value);
                          handleChildSelectionChange(value, next);
                        }}
                        disabled={disabled || (!isAllowed && !isBlocked)}
                      />
                      <Label
                        htmlFor={`sub-${child.value}`}
                        className="text-sm font-normal cursor-pointer"
                      >
                        {translations.subClients?.[child.labelKey] ?? child.labelKey}
                      </Label>
                    </div>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>
        )}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Checkbox
              id={`allow-${value}`}
              checked={isAllowed}
              onCheckedChange={(checked) => handleAllowToggle(value, checked === true)}
              disabled={disabled}
            />
            <Label
              htmlFor={`allow-${value}`}
              className="text-xs font-normal cursor-pointer text-muted-foreground"
            >
              {translations.allowAction}
            </Label>
          </div>
          <div className="flex items-center gap-1.5">
            <Checkbox
              id={`block-${value}`}
              checked={isBlocked}
              onCheckedChange={(checked) => handleBlockToggle(value, checked === true)}
              disabled={disabled}
            />
            <Label
              htmlFor={`block-${value}`}
              className="text-xs font-normal cursor-pointer text-muted-foreground"
            >
              {translations.blockAction}
            </Label>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className={cn("space-y-3", className)}>
      {/* Preset client checkbox rows */}
      <div className="space-y-0.5 border rounded-md p-2">
        {CLIENT_RESTRICTION_PRESET_OPTIONS.map((client) => renderPresetRow(client))}
      </div>

      {/* Custom allowed patterns */}
      <ArrayTagInputField
        label={translations.customAllowedLabel}
        description={translations.customHelp}
        maxTagLength={64}
        maxTags={50}
        placeholder={translations.customAllowedPlaceholder}
        validateTag={(tag: string) => /^[a-zA-Z0-9_*-]+$/.test(tag)}
        value={customAllowed}
        onChange={handleCustomAllowedChange}
        disabled={disabled}
        onInvalidTag={onInvalidTag}
      />

      {/* Custom blocked patterns */}
      <ArrayTagInputField
        label={translations.customBlockedLabel}
        description={translations.customHelp}
        maxTagLength={64}
        maxTags={50}
        placeholder={translations.customBlockedPlaceholder}
        validateTag={(tag: string) => /^[a-zA-Z0-9_*-]+$/.test(tag)}
        value={customBlocked}
        onChange={handleCustomBlockedChange}
        disabled={disabled}
        onInvalidTag={onInvalidTag}
      />
    </div>
  );
}

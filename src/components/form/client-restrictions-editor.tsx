"use client";

import { useMemo } from "react";
import { ArrayTagInputField } from "@/components/form/form-field";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  CLIENT_RESTRICTION_PRESET_OPTIONS,
  isPresetSelected,
  mergePresetAndCustomClients,
  removePresetValues,
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

  const handleCustomAllowedChange = (newCustom: string[]) => {
    onAllowedChange(mergePresetAndCustomClients(allowed, newCustom));
  };

  const handleCustomBlockedChange = (newCustom: string[]) => {
    onBlockedChange(mergePresetAndCustomClients(blocked, newCustom));
  };

  const renderPresetRow = (value: string) => {
    const isAllowed = isPresetSelected(allowed, value);
    const isBlocked = isPresetSelected(blocked, value);
    const displayLabel = translations.presetClients[value] ?? value;

    return (
      <div key={value} className="flex items-center gap-4 py-1">
        <span className="text-sm flex-1 text-foreground">{displayLabel}</span>
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
        {CLIENT_RESTRICTION_PRESET_OPTIONS.map((client) => renderPresetRow(client.value))}
      </div>

      {/* Custom allowed patterns */}
      <ArrayTagInputField
        label={translations.customAllowedLabel}
        description={translations.customHelp}
        maxTagLength={64}
        maxTags={50}
        placeholder={translations.customAllowedPlaceholder}
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
        value={customBlocked}
        onChange={handleCustomBlockedChange}
        disabled={disabled}
        onInvalidTag={onInvalidTag}
      />
    </div>
  );
}

"use client";

import { useId } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { TagInput } from "@/components/ui/tag-input";
import {
  CLIENT_RESTRICTION_PRESET_OPTIONS,
  isPresetSelected,
  mergePresetAndCustomClients,
  removePresetValues,
  splitPresetAndCustomClients,
  togglePresetSelection,
} from "@/lib/client-restrictions/client-presets";
import { cn } from "@/lib/utils";

interface ClientRestrictionListEditorProps {
  label: string;
  values: string[];
  placeholder?: string;
  disabled?: boolean;
  getPresetLabel: (presetValue: string) => string;
  onTogglePreset: (presetValue: string, checked: boolean) => void;
  onCustomChange: (customValues: string[]) => void;
  className?: string;
}

function ClientRestrictionListEditor({
  label,
  values,
  placeholder,
  disabled,
  getPresetLabel,
  onTogglePreset,
  onCustomChange,
  className,
}: ClientRestrictionListEditorProps) {
  const idPrefix = useId();
  const { customValues } = splitPresetAndCustomClients(values);

  return (
    <div className={cn("space-y-3", className)}>
      <div className="text-sm font-medium text-foreground">{label}</div>
      <div className="space-y-2 rounded-md border p-3">
        {CLIENT_RESTRICTION_PRESET_OPTIONS.map((option) => {
          const checked = isPresetSelected(values, option.value);
          const checkboxId = `${idPrefix}-${option.value}`;
          return (
            <div key={option.value} className="flex items-center gap-2">
              <Checkbox
                id={checkboxId}
                checked={checked}
                disabled={disabled}
                onCheckedChange={(next) => onTogglePreset(option.value, next === true)}
              />
              <Label htmlFor={checkboxId} className="cursor-pointer text-sm font-normal">
                {getPresetLabel(option.value)}
              </Label>
            </div>
          );
        })}
      </div>

      <div className="space-y-1">
        <TagInput
          value={customValues}
          onChange={onCustomChange}
          placeholder={placeholder}
          maxTagLength={64}
          maxTags={50}
          disabled={disabled}
          validateTag={() => true}
        />
      </div>
    </div>
  );
}

export interface ClientRestrictionsEditorProps {
  allowed: string[];
  blocked: string[];
  onAllowedChange: (next: string[]) => void;
  onBlockedChange: (next: string[]) => void;
  allowedLabel: string;
  blockedLabel: string;
  allowedPlaceholder?: string;
  blockedPlaceholder?: string;
  disabled?: boolean;
  getPresetLabel: (presetValue: string) => string;
  className?: string;
}

export function ClientRestrictionsEditor({
  allowed,
  blocked,
  onAllowedChange,
  onBlockedChange,
  allowedLabel,
  blockedLabel,
  allowedPlaceholder,
  blockedPlaceholder,
  disabled,
  getPresetLabel,
  className,
}: ClientRestrictionsEditorProps) {
  const handleAllowToggle = (presetValue: string, checked: boolean) => {
    const nextAllowed = togglePresetSelection(allowed, presetValue, checked);
    onAllowedChange(nextAllowed);

    if (checked) {
      const nextBlocked = removePresetValues(blocked, presetValue);
      onBlockedChange(nextBlocked);
    }
  };

  const handleBlockToggle = (presetValue: string, checked: boolean) => {
    const nextBlocked = togglePresetSelection(blocked, presetValue, checked);
    onBlockedChange(nextBlocked);

    if (checked) {
      const nextAllowed = removePresetValues(allowed, presetValue);
      onAllowedChange(nextAllowed);
    }
  };

  const handleAllowedCustomChange = (customValues: string[]) => {
    onAllowedChange(mergePresetAndCustomClients(allowed, customValues));
  };

  const handleBlockedCustomChange = (customValues: string[]) => {
    onBlockedChange(mergePresetAndCustomClients(blocked, customValues));
  };

  return (
    <div className={cn("grid grid-cols-1 gap-4 sm:grid-cols-2", className)}>
      <ClientRestrictionListEditor
        label={allowedLabel}
        values={allowed}
        placeholder={allowedPlaceholder}
        disabled={disabled}
        getPresetLabel={getPresetLabel}
        onTogglePreset={handleAllowToggle}
        onCustomChange={handleAllowedCustomChange}
      />
      <ClientRestrictionListEditor
        label={blockedLabel}
        values={blocked}
        placeholder={blockedPlaceholder}
        disabled={disabled}
        getPresetLabel={getPresetLabel}
        onTogglePreset={handleBlockToggle}
        onCustomChange={handleBlockedCustomChange}
      />
    </div>
  );
}

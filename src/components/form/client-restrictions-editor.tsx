"use client";

import { TagInput, type TagInputSuggestion } from "@/components/ui/tag-input";
import { CLIENT_RESTRICTION_PRESET_OPTIONS } from "@/lib/client-restrictions/client-presets";
import { cn } from "@/lib/utils";

function uniqueOrdered(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }

  return result;
}

interface ClientRestrictionListEditorProps {
  label: string;
  values: string[];
  placeholder?: string;
  disabled?: boolean;
  suggestions: TagInputSuggestion[];
  onChange: (next: string[]) => void;
  onInvalidTag?: (tag: string, reason: string) => void;
  className?: string;
}

function ClientRestrictionListEditor({
  label,
  values,
  placeholder,
  disabled,
  suggestions,
  onChange,
  onInvalidTag,
  className,
}: ClientRestrictionListEditorProps) {
  return (
    <div className={cn("space-y-3", className)}>
      <div className="text-sm font-medium text-foreground">{label}</div>
      <TagInput
        value={values}
        onChange={onChange}
        placeholder={placeholder}
        maxTagLength={64}
        maxTags={50}
        disabled={disabled}
        validateTag={() => true}
        onInvalidTag={onInvalidTag}
        suggestions={suggestions}
      />
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
  onInvalidTag?: (tag: string, reason: string) => void;
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
  onInvalidTag,
  className,
}: ClientRestrictionsEditorProps) {
  const suggestions: TagInputSuggestion[] = CLIENT_RESTRICTION_PRESET_OPTIONS.map((option) => ({
    value: option.value,
    label: getPresetLabel(option.value),
    keywords: [...option.aliases],
  }));

  const handleAllowedChange = (next: string[]) => {
    const nextAllowed = uniqueOrdered(next);
    onAllowedChange(nextAllowed);

    const allowedSet = new Set(nextAllowed);
    const nextBlocked = blocked.filter((value) => !allowedSet.has(value));
    if (nextBlocked.length !== blocked.length) {
      onBlockedChange(nextBlocked);
    }
  };

  const handleBlockedChange = (next: string[]) => {
    const nextBlocked = uniqueOrdered(next);
    onBlockedChange(nextBlocked);

    const blockedSet = new Set(nextBlocked);
    const nextAllowed = allowed.filter((value) => !blockedSet.has(value));
    if (nextAllowed.length !== allowed.length) {
      onAllowedChange(nextAllowed);
    }
  };

  return (
    <div className={cn("grid grid-cols-1 gap-4 sm:grid-cols-2", className)}>
      <ClientRestrictionListEditor
        label={allowedLabel}
        values={allowed}
        placeholder={allowedPlaceholder}
        disabled={disabled}
        suggestions={suggestions}
        onChange={handleAllowedChange}
        onInvalidTag={onInvalidTag}
      />
      <ClientRestrictionListEditor
        label={blockedLabel}
        values={blocked}
        placeholder={blockedPlaceholder}
        disabled={disabled}
        suggestions={suggestions}
        onChange={handleBlockedChange}
        onInvalidTag={onInvalidTag}
      />
    </div>
  );
}

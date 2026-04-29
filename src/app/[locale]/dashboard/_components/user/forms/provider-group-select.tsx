"use client";

import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import { TagInputField } from "@/components/form/form-field";
import type { TagInputSuggestion } from "@/components/ui/tag-input";
import { useProviderGroupsList } from "@/lib/api-client/v1/providers/hooks";
import { PROVIDER_GROUP } from "@/lib/constants/provider.constants";
import { parseProviderGroups } from "@/lib/utils/provider-group";

export interface ProviderGroupSelectProps {
  /** Comma-separated group tags. */
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Whether to show provider counts in suggestions. Defaults to `true`. */
  showProviderCount?: boolean;
  /**
   * i18n strings passed from parent.
   * Expected keys (optional):
   * - label, placeholder, description
   * - providersSuffix (e.g. "providers")
   * - tagInputErrors.{empty|duplicate|too_long|invalid_format|max_tags}
   * - errors.loadFailed
   */
  translations: Record<string, unknown>;
}

function getTranslation(translations: Record<string, unknown>, path: string, fallback: string) {
  const value = path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, translations);
  return typeof value === "string" && value.trim() ? value : fallback;
}

interface GroupCountItem {
  group: string;
  providerCount: number;
}

export function ProviderGroupSelect({
  value,
  onChange,
  disabled = false,
  showProviderCount = true,
  translations,
}: ProviderGroupSelectProps) {
  const { data, isLoading, isError } = useProviderGroupsList(
    disabled ? undefined : { include: "count" }
  );
  const groups = useMemo(() => (data?.items ?? []) as unknown as GroupCountItem[], [data]);

  const loadFailedText = useMemo(
    () => getTranslation(translations, "errors.loadFailed", "Load failed"),
    [translations]
  );

  // Surface load errors via toast (matches legacy UX).
  if (isError) {
    toast.error(loadFailedText);
  }

  const suggestions: TagInputSuggestion[] = useMemo(() => {
    if (!showProviderCount) return groups.map((g) => g.group);
    const suffix = getTranslation(translations, "providersSuffix", "providers");
    return groups.map((g) => ({
      value: g.group,
      label: `${g.group} (${g.providerCount} ${suffix})`,
      keywords: [String(g.providerCount)],
    }));
  }, [groups, showProviderCount, translations]);

  const description = useMemo(() => {
    const base = getTranslation(translations, "description", "");
    if (isLoading && !base) {
      return getTranslation(translations, "loadingText", "Loading...");
    }
    return base;
  }, [translations, isLoading]);

  // 选择新分组后自动移除 "default"
  const handleChange = useCallback(
    (newValue: string) => {
      const groupList = parseProviderGroups(newValue);
      // 如果有多个分组且包含 default，移除 default
      if (groupList.length > 1 && groupList.includes(PROVIDER_GROUP.DEFAULT)) {
        const withoutDefault = groupList.filter((g) => g !== PROVIDER_GROUP.DEFAULT);
        onChange(withoutDefault.join(","));
      } else {
        onChange(newValue);
      }
    },
    [onChange]
  );

  return (
    <TagInputField
      label={getTranslation(translations, "label", "Provider group")}
      placeholder={getTranslation(translations, "placeholder", "Enter group and press Enter")}
      description={description}
      maxTagLength={200}
      maxTags={20}
      suggestions={suggestions}
      disabled={disabled}
      validateTag={() => true}
      onInvalidTag={(_tag, reason) => {
        toast.error(getTranslation(translations, `tagInputErrors.${reason}`, reason));
      }}
      value={value}
      onChange={handleChange}
    />
  );
}

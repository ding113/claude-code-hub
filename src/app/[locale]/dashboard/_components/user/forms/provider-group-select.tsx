"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { getProviderGroupsWithCount } from "@/actions/providers";
import { TagInputField } from "@/components/form/form-field";
import type { TagInputSuggestion } from "@/components/ui/tag-input";

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

export function ProviderGroupSelect({
  value,
  onChange,
  disabled = false,
  showProviderCount = true,
  translations,
}: ProviderGroupSelectProps) {
  const [groups, setGroups] = useState<Array<{ group: string; providerCount: number }>>([]);
  const [isLoading, setIsLoading] = useState(false);
  const loadFailedText = useMemo(
    () => getTranslation(translations, "errors.loadFailed", "加载失败"),
    [translations]
  );

  useEffect(() => {
    let alive = true;
    if (disabled) {
      setGroups([]);
      setIsLoading(false);
      return () => {
        alive = false;
      };
    }
    setIsLoading(true);
    getProviderGroupsWithCount()
      .then((res) => {
        if (!alive) return;
        if (res.ok) {
          setGroups(res.data || []);
          return;
        }
        console.error("获取供应商分组统计失败:", res.error);
        toast.error(res.error || loadFailedText);
        setGroups([]);
      })
      .catch((err) => {
        if (!alive) return;
        console.error("获取供应商分组统计失败:", err);
        toast.error(loadFailedText);
        setGroups([]);
      })
      .finally(() => {
        if (!alive) return;
        setIsLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [loadFailedText, disabled]);

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
      return getTranslation(translations, "loadingText", "加载中...");
    }
    return base;
  }, [translations, isLoading]);

  return (
    <TagInputField
      label={getTranslation(translations, "label", "供应商分组")}
      placeholder={getTranslation(translations, "placeholder", "输入分组并回车")}
      description={description}
      maxTagLength={50}
      maxTags={20}
      suggestions={suggestions}
      disabled={disabled}
      onInvalidTag={(_tag, reason) => {
        toast.error(getTranslation(translations, `tagInputErrors.${reason}`, reason));
      }}
      value={value}
      onChange={onChange}
    />
  );
}

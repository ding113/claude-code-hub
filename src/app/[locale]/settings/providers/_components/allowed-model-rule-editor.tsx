"use client";

import { AlertCircle, Check, ChevronDown, ChevronUp, Pencil, Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import safeRegex from "safe-regex";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PROVIDER_RULE_LIMITS } from "@/lib/constants/provider.constants";
import type {
  AllowedModelRule,
  ProviderModelRedirectMatchType,
  ProviderType,
} from "@/types/provider";
import { ModelMultiSelect } from "./model-multi-select";

interface AllowedModelRuleEditorProps {
  value: AllowedModelRule[];
  onChange: (value: AllowedModelRule[]) => void;
  disabled?: boolean;
  providerType: ProviderType;
  providerUrl?: string;
  apiKey?: string;
  proxyUrl?: string | null;
  proxyFallbackToDirect?: boolean;
  providerId?: number;
}

const DEFAULT_RULE: AllowedModelRule = {
  matchType: "exact",
  pattern: "",
};
const MAX_ALLOWED_MODEL_RULES = PROVIDER_RULE_LIMITS.MAX_ITEMS;

function normalizeRule(rule: AllowedModelRule): AllowedModelRule {
  return {
    matchType: rule.matchType,
    pattern: rule.pattern.trim(),
  };
}

function getRuleIdentity(rule: Pick<AllowedModelRule, "matchType" | "pattern">): string {
  // exact/prefix/suffix/contains/regex 的运行时匹配都区分大小写，这里去重也必须保持一致。
  return `${rule.matchType}:${rule.pattern.trim()}`;
}

export function AllowedModelRuleEditor({
  value,
  onChange,
  disabled = false,
  providerType,
  providerUrl,
  apiKey,
  proxyUrl,
  proxyFallbackToDirect,
  providerId,
}: AllowedModelRuleEditorProps) {
  const t = useTranslations("settings.providers.form.allowedModelRules");
  const [newRule, setNewRule] = useState<AllowedModelRule>(DEFAULT_RULE);
  const [editRule, setEditRule] = useState<AllowedModelRule>(DEFAULT_RULE);
  const [editingRuleKey, setEditingRuleKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const matchTypeOptions: Array<{ value: ProviderModelRedirectMatchType; label: string }> = [
    { value: "exact", label: t("matchTypeExact") },
    { value: "prefix", label: t("matchTypePrefix") },
    { value: "suffix", label: t("matchTypeSuffix") },
    { value: "contains", label: t("matchTypeContains") },
    { value: "regex", label: t("matchTypeRegex") },
  ];

  const hasDuplicateRule = (rule: AllowedModelRule, ignoreRuleKey?: string): boolean => {
    const normalized = normalizeRule(rule);
    const nextRuleKey = getRuleIdentity(normalized);

    return value.some((item) => {
      const currentKey = getRuleIdentity(item);
      if (ignoreRuleKey && currentKey === ignoreRuleKey) {
        return false;
      }
      return currentKey === nextRuleKey;
    });
  };

  const validateRule = (rule: AllowedModelRule, ignoreRuleKey?: string): string | null => {
    const normalized = normalizeRule(rule);

    if (!normalized.pattern) {
      return t("patternEmpty");
    }
    if (normalized.pattern.length > PROVIDER_RULE_LIMITS.MAX_TEXT_LENGTH) {
      return t("patternTooLong", { max: PROVIDER_RULE_LIMITS.MAX_TEXT_LENGTH });
    }
    if (normalized.matchType === "regex") {
      try {
        new RegExp(normalized.pattern);
      } catch {
        return t("regexInvalid");
      }

      try {
        if (!safeRegex(normalized.pattern)) {
          return t("regexUnsafe");
        }
      } catch {
        return t("regexUnsafe");
      }
    }
    if (hasDuplicateRule(normalized, ignoreRuleKey)) {
      return t("alreadyExists", { pattern: normalized.pattern });
    }

    return null;
  };

  const handleAdd = () => {
    if (value.length >= MAX_ALLOWED_MODEL_RULES) {
      setError(t("maxRules", { max: MAX_ALLOWED_MODEL_RULES }));
      return;
    }

    const nextRule = normalizeRule(newRule);
    const validationError = validateRule(nextRule);
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    onChange([...value, nextRule]);
    setNewRule(DEFAULT_RULE);
  };

  const handleRemove = (ruleKey: string) => {
    onChange(value.filter((rule) => getRuleIdentity(rule) !== ruleKey));
    if (editingRuleKey === ruleKey) {
      setEditingRuleKey(null);
      setEditRule(DEFAULT_RULE);
      setError(null);
    }
  };

  const handleMove = (ruleKey: string, direction: -1 | 1) => {
    const index = value.findIndex((rule) => getRuleIdentity(rule) === ruleKey);
    if (index < 0) return;

    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= value.length) {
      return;
    }

    const nextRules = [...value];
    const [item] = nextRules.splice(index, 1);
    nextRules.splice(nextIndex, 0, item);
    onChange(nextRules);
  };

  const handleStartEdit = (rule: AllowedModelRule) => {
    setEditingRuleKey(getRuleIdentity(rule));
    setEditRule(normalizeRule(rule));
    setError(null);
  };

  const handleCancelEdit = () => {
    setEditingRuleKey(null);
    setEditRule(DEFAULT_RULE);
    setError(null);
  };

  const handleSaveEdit = (originalRuleKey: string) => {
    const nextRule = normalizeRule(editRule);
    const validationError = validateRule(nextRule, originalRuleKey);
    if (validationError) {
      setError(validationError);
      return;
    }

    const currentIndex = value.findIndex((rule) => getRuleIdentity(rule) === originalRuleKey);
    if (currentIndex < 0) {
      setError(t("ruleMoved"));
      return;
    }

    setError(null);
    onChange(value.map((rule, index) => (index === currentIndex ? nextRule : rule)));
    setEditingRuleKey(null);
    setEditRule(DEFAULT_RULE);
  };

  const handleCreateKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAdd();
    }
  };

  const handleEditKeyDown = (e: React.KeyboardEvent, originalRuleKey: string) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSaveEdit(originalRuleKey);
    }
  };

  const exactModels = value
    .filter((rule) => rule.matchType === "exact")
    .map((rule) => normalizeRule(rule).pattern)
    .filter(Boolean);

  const handleExactModelsChange = (selectedModels: string[]) => {
    const normalizedSelections = selectedModels.map((model) => model.trim()).filter(Boolean);
    const selectedKeys = new Set(
      normalizedSelections.map((model) =>
        getRuleIdentity({
          matchType: "exact",
          pattern: model,
        })
      )
    );

    const nextRules = value.filter((rule) => {
      if (rule.matchType !== "exact") {
        return true;
      }
      return selectedKeys.has(getRuleIdentity(rule));
    });

    const existingExactKeys = new Set(
      nextRules.filter((rule) => rule.matchType === "exact").map((rule) => getRuleIdentity(rule))
    );
    let hitLimit = false;

    for (const model of normalizedSelections) {
      const nextRule = normalizeRule({ matchType: "exact", pattern: model });
      const ruleKey = getRuleIdentity(nextRule);
      if (existingExactKeys.has(ruleKey)) {
        continue;
      }
      if (nextRules.length >= MAX_ALLOWED_MODEL_RULES) {
        hitLimit = true;
        break;
      }
      nextRules.push(nextRule);
      existingExactKeys.add(ruleKey);
    }

    setError(hitLimit ? t("quickAddReachedLimit", { max: MAX_ALLOWED_MODEL_RULES }) : null);
    onChange(nextRules);
  };

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
        <p className="text-sm font-medium">{t("description")}</p>
        <p className="text-xs text-muted-foreground">{t("orderHint")}</p>
      </div>

      <div className="rounded-lg border border-border/60 bg-background/70 p-3">
        <div className="mb-3 space-y-1">
          <p className="text-sm font-medium">{t("exactPickerTitle")}</p>
          <p className="text-xs text-muted-foreground">{t("exactPickerDescription")}</p>
        </div>
        <ModelMultiSelect
          providerType={providerType}
          selectedModels={exactModels}
          onChange={handleExactModelsChange}
          disabled={disabled}
          providerUrl={providerUrl}
          apiKey={apiKey}
          proxyUrl={proxyUrl}
          proxyFallbackToDirect={proxyFallbackToDirect}
          providerId={providerId}
        />
      </div>

      <div className="grid gap-2 rounded-lg border border-dashed border-border/70 bg-muted/10 p-3 md:grid-cols-[140px_1fr_auto]">
        <div className="space-y-1">
          <Label htmlFor="new-allowed-model-match-type">{t("matchTypeLabel")}</Label>
          <Select
            value={newRule.matchType}
            onValueChange={(value) =>
              setNewRule((current) => ({
                ...current,
                matchType: value as ProviderModelRedirectMatchType,
              }))
            }
            disabled={disabled}
          >
            <SelectTrigger id="new-allowed-model-match-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {matchTypeOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label htmlFor="new-allowed-model-pattern">{t("patternLabel")}</Label>
          <Input
            id="new-allowed-model-pattern"
            value={newRule.pattern}
            onChange={(e) => setNewRule((current) => ({ ...current, pattern: e.target.value }))}
            onInput={(e) =>
              setNewRule((current) => ({
                ...current,
                pattern: (e.target as HTMLInputElement).value,
              }))
            }
            onKeyDown={handleCreateKeyDown}
            disabled={disabled}
            placeholder={t("patternPlaceholder")}
          />
        </div>

        <div className="flex items-end">
          <Button type="button" onClick={handleAdd} disabled={disabled} data-allowed-model-add>
            <Plus className="mr-2 h-4 w-4" />
            {t("add")}
          </Button>
        </div>
      </div>

      {error ? (
        <div
          className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          data-allowed-model-error
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {value.length === 0 ? (
        <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-4 text-sm text-muted-foreground">
          {t("emptyState")}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium text-muted-foreground">
              {t("currentRules", { count: value.length })}
            </div>
            <div className="text-xs text-muted-foreground">{t("orderHint")}</div>
          </div>

          <div className="space-y-1">
            {value.map((rule, index) => {
              const ruleKey = getRuleIdentity(rule);
              const isEditing = editingRuleKey === ruleKey;

              return (
                <div key={ruleKey} className="group rounded-md border border-border/60 px-3 py-2">
                  {isEditing ? (
                    <div className="grid gap-2 md:grid-cols-[140px_1fr_96px]">
                      <Select
                        value={editRule.matchType}
                        onValueChange={(value) =>
                          setEditRule((current) => ({
                            ...current,
                            matchType: value as ProviderModelRedirectMatchType,
                          }))
                        }
                        disabled={disabled}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {matchTypeOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      <Input
                        value={editRule.pattern}
                        onChange={(e) =>
                          setEditRule((current) => ({ ...current, pattern: e.target.value }))
                        }
                        onInput={(e) =>
                          setEditRule((current) => ({
                            ...current,
                            pattern: (e.target as HTMLInputElement).value,
                          }))
                        }
                        onKeyDown={(e) => handleEditKeyDown(e, ruleKey)}
                        disabled={disabled}
                        placeholder={t("patternPlaceholder")}
                        data-allowed-model-edit-pattern={ruleKey}
                      />

                      <div className="flex items-center gap-1 md:justify-end">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          data-allowed-model-save={ruleKey}
                          onClick={() => handleSaveEdit(ruleKey)}
                          disabled={disabled}
                          className="h-8 w-8 p-0"
                          aria-label={t("saveRule")}
                          title={t("saveRule")}
                        >
                          <Check className="h-3.5 w-3.5 text-green-600" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={handleCancelEdit}
                          disabled={disabled}
                          className="h-8 w-8 p-0"
                          aria-label={t("cancelEdit")}
                          title={t("cancelEdit")}
                        >
                          <X className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary" className="text-xs">
                        {matchTypeOptions.find((option) => option.value === rule.matchType)?.label}
                      </Badge>
                      <Badge variant="outline" className="font-mono text-xs">
                        {rule.pattern}
                      </Badge>

                      <div className="ml-auto flex items-center gap-1 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          data-allowed-model-move-up={ruleKey}
                          onClick={() => handleMove(ruleKey, -1)}
                          disabled={disabled || index === 0}
                          className="h-7 w-7 p-0"
                          aria-label={t("moveRuleUp")}
                          title={t("moveRuleUp")}
                        >
                          <ChevronUp className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          data-allowed-model-move-down={ruleKey}
                          onClick={() => handleMove(ruleKey, 1)}
                          disabled={disabled || index === value.length - 1}
                          className="h-7 w-7 p-0"
                          aria-label={t("moveRuleDown")}
                          title={t("moveRuleDown")}
                        >
                          <ChevronDown className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          data-allowed-model-edit={ruleKey}
                          onClick={() => handleStartEdit(rule)}
                          disabled={disabled}
                          className="h-7 w-7 p-0"
                          aria-label={t("editRule")}
                          title={t("editRule")}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          data-allowed-model-delete={ruleKey}
                          onClick={() => handleRemove(ruleKey)}
                          disabled={disabled}
                          className="h-7 w-7 p-0"
                          aria-label={t("deleteRule")}
                          title={t("deleteRule")}
                        >
                          <X className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

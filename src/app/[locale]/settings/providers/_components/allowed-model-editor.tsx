"use client";

import { AlertCircle, Check, ChevronDown, ChevronUp, Pencil, Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import safeRegex from "safe-regex";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ProviderAllowedModelRule, ProviderModelRedirectMatchType } from "@/types/provider";
import { getMatchTypeOptions, MatchTypeBadge, MatchTypeSelect } from "./match-rule-shared";
import { ModelMatchTester } from "./model-match-tester";

interface AllowedModelEditorProps {
  value: ProviderAllowedModelRule[];
  onChange: (value: ProviderAllowedModelRule[]) => void;
  disabled?: boolean;
}

const DEFAULT_RULE: ProviderAllowedModelRule = {
  matchType: "exact",
  pattern: "",
};

function normalizeRule(rule: ProviderAllowedModelRule): ProviderAllowedModelRule {
  return {
    matchType: rule.matchType,
    pattern: rule.pattern.trim(),
  };
}

function getRuleIdentity(rule: Pick<ProviderAllowedModelRule, "matchType" | "pattern">): string {
  return `${rule.matchType}:${rule.pattern.trim().toLowerCase()}`;
}

export function AllowedModelEditor({ value, onChange, disabled = false }: AllowedModelEditorProps) {
  const t = useTranslations("settings.providers.form.allowedModelRule");
  const [newRule, setNewRule] = useState<ProviderAllowedModelRule>(DEFAULT_RULE);
  const [error, setError] = useState<string | null>(null);
  const [editingRuleKey, setEditingRuleKey] = useState<string | null>(null);
  const [editRule, setEditRule] = useState<ProviderAllowedModelRule>(DEFAULT_RULE);

  const rules = value;
  const matchTypeOptions = getMatchTypeOptions(t);

  const hasDuplicateRule = (rule: ProviderAllowedModelRule, ignoreRuleKey?: string): boolean => {
    const normalized = normalizeRule(rule);
    const nextRuleKey = getRuleIdentity(normalized);

    return rules.some((item) => {
      const currentKey = getRuleIdentity(item);
      if (ignoreRuleKey && currentKey === ignoreRuleKey) {
        return false;
      }
      return currentKey === nextRuleKey;
    });
  };

  const validateRule = (rule: ProviderAllowedModelRule, ignoreRuleKey?: string): string | null => {
    const normalized = normalizeRule(rule);

    if (!normalized.pattern) {
      return t("patternEmpty");
    }
    if (normalized.pattern.length > 255) {
      return t("patternTooLong");
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
      return t("alreadyExists", {
        pattern: `${normalized.matchType}:${normalized.pattern}`,
      });
    }
    return null;
  };

  const handleAdd = () => {
    if (rules.length >= 100) {
      setError(t("maxRules"));
      return;
    }

    const nextRule = normalizeRule(newRule);
    const validationError = validateRule(nextRule);
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    onChange([...rules, nextRule]);
    setNewRule(DEFAULT_RULE);
  };

  const handleRemove = (ruleKey: string) => {
    onChange(rules.filter((rule) => getRuleIdentity(rule) !== ruleKey));
    if (editingRuleKey === ruleKey) {
      setEditingRuleKey(null);
      setEditRule(DEFAULT_RULE);
      setError(null);
    }
  };

  const handleMove = (ruleKey: string, direction: -1 | 1) => {
    const index = rules.findIndex((rule) => getRuleIdentity(rule) === ruleKey);
    if (index < 0) return;

    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= rules.length) {
      return;
    }

    const nextRules = [...rules];
    const [item] = nextRules.splice(index, 1);
    nextRules.splice(nextIndex, 0, item);
    onChange(nextRules);
  };

  const handleStartEdit = (rule: ProviderAllowedModelRule) => {
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

    const currentIndex = rules.findIndex((rule) => getRuleIdentity(rule) === originalRuleKey);
    if (currentIndex < 0) {
      setError(t("ruleMoved"));
      return;
    }

    setError(null);
    onChange(rules.map((rule, index) => (index === currentIndex ? nextRule : rule)));
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
    } else if (e.key === "Escape") {
      e.preventDefault();
      handleCancelEdit();
    }
  };

  return (
    <div className="space-y-3">
      {rules.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-medium text-muted-foreground">
              {t("currentRules", { count: rules.length })}
            </div>
            <div className="text-xs text-muted-foreground">{t("orderHint")}</div>
          </div>

          <div className="space-y-1">
            {rules.map((rule, index) => {
              const ruleKey = getRuleIdentity(rule);
              const isEditing = editingRuleKey === ruleKey;

              return (
                <div key={ruleKey} className="group rounded-md border border-border/60 px-3 py-2">
                  {isEditing ? (
                    <div className="grid gap-2 md:grid-cols-[140px_1fr_auto] md:items-end">
                      <div className="space-y-1">
                        <Label className="text-xs">{t("matchTypeLabel")}</Label>
                        <MatchTypeSelect
                          value={editRule.matchType}
                          onChange={(matchType) =>
                            setEditRule((current) => ({ ...current, matchType }))
                          }
                          disabled={disabled}
                          options={matchTypeOptions}
                        />
                      </div>

                      <div className="space-y-1">
                        <Label className="text-xs">{t("patternLabel")}</Label>
                        <Input
                          value={editRule.pattern}
                          data-allowed-edit-pattern={ruleKey}
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
                          className="font-mono text-sm h-8 flex-1"
                          autoFocus
                        />
                      </div>

                      <div className="flex items-center gap-1 md:pb-0 md:justify-end">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          data-allowed-save={ruleKey}
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
                      <MatchTypeBadge matchType={rule.matchType} options={matchTypeOptions} />
                      <Badge variant="outline" className="font-mono text-xs">
                        {rule.pattern}
                      </Badge>

                      <div className="ml-auto flex items-center gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          data-allowed-move-up={ruleKey}
                          onClick={() => handleMove(ruleKey, -1)}
                          disabled={disabled || index === 0}
                          className="h-7 w-7 p-0"
                          aria-label={t("moveRuleUp")}
                          title={t("moveRuleUp")}
                        >
                          <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          data-allowed-move-down={ruleKey}
                          onClick={() => handleMove(ruleKey, 1)}
                          disabled={disabled || index === rules.length - 1}
                          className="h-7 w-7 p-0"
                          aria-label={t("moveRuleDown")}
                          title={t("moveRuleDown")}
                        >
                          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          data-allowed-edit={ruleKey}
                          onClick={() => handleStartEdit(rule)}
                          disabled={disabled}
                          className="h-7 w-7 p-0"
                          aria-label={t("editRule")}
                          title={t("editRule")}
                        >
                          <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          data-allowed-remove={ruleKey}
                          onClick={() => handleRemove(ruleKey)}
                          disabled={disabled}
                          className="h-7 w-7 p-0"
                          aria-label={t("deleteRule")}
                          title={t("deleteRule")}
                        >
                          <X className="h-3.5 w-3.5 text-muted-foreground" />
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

      <div className="space-y-2">
        <div className="text-xs font-medium text-muted-foreground">{t("addNewRule")}</div>

        <div className="grid gap-2 md:grid-cols-[140px_1fr_auto] md:items-end">
          <div className="space-y-1">
            <Label htmlFor="new-allowed-match-type" className="text-xs">
              {t("matchTypeLabel")}
            </Label>
            <MatchTypeSelect
              value={newRule.matchType}
              onChange={(matchType: ProviderModelRedirectMatchType) =>
                setNewRule((current) => ({ ...current, matchType }))
              }
              disabled={disabled}
              options={matchTypeOptions}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="new-allowed-pattern" className="text-xs">
              {t("patternLabel")}
            </Label>
            <Input
              id="new-allowed-pattern"
              value={newRule.pattern}
              onChange={(e) => setNewRule((current) => ({ ...current, pattern: e.target.value }))}
              onInput={(e) =>
                setNewRule((current) => ({
                  ...current,
                  pattern: (e.target as HTMLInputElement).value,
                }))
              }
              onKeyDown={handleCreateKeyDown}
              placeholder={t("patternPlaceholder")}
              disabled={disabled}
              className="font-mono text-sm"
            />
          </div>

          <Button
            type="button"
            data-allowed-add
            onClick={handleAdd}
            disabled={disabled || !newRule.pattern.trim()}
            size="default"
            className="mb-0"
          >
            <Plus className="h-4 w-4 mr-1" />
            {t("add")}
          </Button>
        </div>

        {error && (
          <div className="flex items-center gap-2 text-xs text-destructive" data-allowed-error>
            <AlertCircle className="h-3 w-3" />
            <span>{error}</span>
          </div>
        )}

        <p className="text-xs text-muted-foreground">{t("description")}</p>
      </div>

      {rules.length === 0 && (
        <div className="text-center py-6 text-sm text-muted-foreground border border-dashed rounded-md">
          {t("emptyState")}
        </div>
      )}

      <ModelMatchTester mode="whitelist" allowedModelRules={rules} />
    </div>
  );
}

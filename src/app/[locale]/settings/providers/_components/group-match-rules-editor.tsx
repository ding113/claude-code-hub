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
import type {
  ProviderGroupMatchRule,
  ProviderGroupMatchType,
} from "@/lib/provider-groups/match-rules";
import { resolveProviderPatternRegex } from "@/lib/provider-pattern-regex";
import { cn } from "@/lib/utils";

interface GroupMatchRulesEditorProps {
  value: ProviderGroupMatchRule[];
  onChange: (value: ProviderGroupMatchRule[]) => void;
  disabled?: boolean;
  className?: string;
  title?: string;
  help?: string;
  emptyLabel?: string;
  patternLabel?: string;
  patternPlaceholder?: string;
  idPrefix?: string;
}

const DEFAULT_RULE: ProviderGroupMatchRule = {
  matchType: "contains",
  pattern: "",
};

const MAX_RULES = 40;

function normalizeRule(rule: ProviderGroupMatchRule): ProviderGroupMatchRule {
  return {
    matchType: rule.matchType,
    pattern: rule.pattern.trim(),
  };
}

function getRuleIdentity(rule: Pick<ProviderGroupMatchRule, "matchType" | "pattern">): string {
  return `${rule.matchType}:${rule.pattern.trim()}`;
}

export function GroupMatchRulesEditor({
  value,
  onChange,
  disabled = false,
  className,
  title,
  help,
  emptyLabel,
  patternLabel,
  patternPlaceholder,
  idPrefix = "group-match",
}: GroupMatchRulesEditorProps) {
  const t = useTranslations("settings.providers.providerGroups");
  const [newRule, setNewRule] = useState<ProviderGroupMatchRule>(DEFAULT_RULE);
  const [editRule, setEditRule] = useState<ProviderGroupMatchRule>(DEFAULT_RULE);
  const [editingRuleKey, setEditingRuleKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const matchTypeOptions: Array<{ value: ProviderGroupMatchType; label: string }> = [
    { value: "exact", label: t("matchTypeExact") },
    { value: "prefix", label: t("matchTypePrefix") },
    { value: "suffix", label: t("matchTypeSuffix") },
    { value: "contains", label: t("matchTypeContains") },
    { value: "regex", label: t("matchTypeRegex") },
  ];
  const matchTypeId = `${idPrefix}-type`;
  const patternId = `${idPrefix}-pattern`;

  const hasDuplicateRule = (rule: ProviderGroupMatchRule, ignoreRuleKey?: string): boolean => {
    const normalized = normalizeRule(rule);
    const nextRuleKey = getRuleIdentity(normalized);
    return value.some((item) => {
      const currentKey = getRuleIdentity(item);
      if (ignoreRuleKey && currentKey === ignoreRuleKey) return false;
      return currentKey === nextRuleKey;
    });
  };

  const validateRule = (rule: ProviderGroupMatchRule, ignoreRuleKey?: string): string | null => {
    const normalized = normalizeRule(rule);
    if (!normalized.pattern) return t("patternEmpty");
    if (normalized.pattern.length > 200) return t("patternTooLong");
    if (normalized.matchType === "regex") {
      const compiled = resolveProviderPatternRegex(normalized.pattern);
      if (!compiled) return t("regexInvalid");
      try {
        if (!safeRegex(compiled.source)) return t("regexUnsafe");
      } catch {
        return t("regexUnsafe");
      }
    }
    if (hasDuplicateRule(normalized, ignoreRuleKey)) {
      return t("ruleAlreadyExists", { pattern: normalized.pattern });
    }
    return null;
  };

  const handleAdd = () => {
    if (value.length >= MAX_RULES) {
      setError(t("maxRules", { max: MAX_RULES }));
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
    if (nextIndex < 0 || nextIndex >= value.length) return;
    const nextRules = [...value];
    const [item] = nextRules.splice(index, 1);
    nextRules.splice(nextIndex, 0, item);
    onChange(nextRules);
  };

  const handleStartEdit = (rule: ProviderGroupMatchRule) => {
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

  return (
    <div className={cn("space-y-3", className)}>
      <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
        <p className="text-sm font-medium">{title ?? t("matchRulesTitle")}</p>
        <p className="text-xs text-muted-foreground">{help ?? t("matchRulesHelp")}</p>
      </div>

      <div className="grid gap-2 rounded-lg border border-dashed border-border/70 bg-muted/10 p-3 md:grid-cols-[140px_1fr_auto]">
        <div className="space-y-1">
          <Label htmlFor={matchTypeId}>{t("matchTypeLabel")}</Label>
          <Select
            value={newRule.matchType}
            onValueChange={(value) =>
              setNewRule((current) => ({
                ...current,
                matchType: value as ProviderGroupMatchType,
              }))
            }
            disabled={disabled}
          >
            <SelectTrigger id={matchTypeId}>
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
          <Label htmlFor={patternId}>{patternLabel ?? t("patternLabel")}</Label>
          <Input
            id={patternId}
            value={newRule.pattern}
            onChange={(e) => setNewRule((current) => ({ ...current, pattern: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAdd();
              }
            }}
            disabled={disabled}
            placeholder={patternPlaceholder ?? t("patternPlaceholder")}
          />
        </div>
        <div className="flex items-end">
          <Button type="button" onClick={handleAdd} disabled={disabled}>
            <Plus className="mr-2 h-4 w-4" />
            {t("addRule")}
          </Button>
        </div>
      </div>

      {error ? (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {value.length === 0 ? (
        <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-4 text-sm text-muted-foreground">
          {emptyLabel ?? t("matchRulesEmpty")}
        </div>
      ) : (
        <div className="space-y-1">
          {value.map((rule, index) => {
            const ruleKey = getRuleIdentity(rule);
            const isEditing = editingRuleKey === ruleKey;
            return (
              <div key={ruleKey} className="rounded-md border border-border/60 px-3 py-2">
                {isEditing ? (
                  <div className="grid gap-2 md:grid-cols-[140px_1fr_96px]">
                    <Select
                      value={editRule.matchType}
                      onValueChange={(value) =>
                        setEditRule((current) => ({
                          ...current,
                          matchType: value as ProviderGroupMatchType,
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
                      disabled={disabled}
                    />
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        onClick={() => handleSaveEdit(ruleKey)}
                        disabled={disabled}
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        onClick={handleCancelEdit}
                        disabled={disabled}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="shrink-0 font-normal">
                      {matchTypeOptions.find((option) => option.value === rule.matchType)?.label}
                    </Badge>
                    <code className="min-w-0 flex-1 truncate text-xs">{rule.pattern}</code>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        disabled={disabled || index === 0}
                        onClick={() => handleMove(ruleKey, -1)}
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        disabled={disabled || index === value.length - 1}
                        onClick={() => handleMove(ruleKey, 1)}
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        disabled={disabled}
                        onClick={() => handleStartEdit(rule)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        disabled={disabled}
                        onClick={() => handleRemove(ruleKey)}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

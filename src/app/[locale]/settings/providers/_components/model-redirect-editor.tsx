"use client";
import {
  AlertCircle,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  Pencil,
  Plus,
  X,
} from "lucide-react";
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
import type { ProviderModelRedirectMatchType, ProviderModelRedirectRule } from "@/types/provider";

interface ModelRedirectEditorProps {
  value: ProviderModelRedirectRule[];
  onChange: (value: ProviderModelRedirectRule[]) => void;
  disabled?: boolean;
}

const DEFAULT_RULE: ProviderModelRedirectRule = {
  matchType: "exact",
  source: "",
  target: "",
};

function normalizeRule(rule: ProviderModelRedirectRule): ProviderModelRedirectRule {
  return {
    matchType: rule.matchType,
    source: rule.source.trim(),
    target: rule.target.trim(),
  };
}

function getRuleIdentity(rule: Pick<ProviderModelRedirectRule, "matchType" | "source">): string {
  return `${rule.matchType}:${rule.source.trim()}`;
}

export function ModelRedirectEditor({
  value,
  onChange,
  disabled = false,
}: ModelRedirectEditorProps) {
  const t = useTranslations("settings.providers.form.modelRedirect");
  const [newRule, setNewRule] = useState<ProviderModelRedirectRule>(DEFAULT_RULE);
  const [error, setError] = useState<string | null>(null);
  const [editingRuleKey, setEditingRuleKey] = useState<string | null>(null);
  const [editRule, setEditRule] = useState<ProviderModelRedirectRule>(DEFAULT_RULE);

  const redirects = value;

  const matchTypeOptions: Array<{
    value: ProviderModelRedirectMatchType;
    label: string;
  }> = [
    { value: "exact", label: t("matchTypeExact") },
    { value: "prefix", label: t("matchTypePrefix") },
    { value: "suffix", label: t("matchTypeSuffix") },
    { value: "contains", label: t("matchTypeContains") },
    { value: "regex", label: t("matchTypeRegex") },
  ];

  const hasDuplicateRule = (rule: ProviderModelRedirectRule, ignoreRuleKey?: string): boolean => {
    const normalized = normalizeRule(rule);
    const nextRuleKey = getRuleIdentity(normalized);

    return redirects.some((item) => {
      const currentKey = getRuleIdentity(item);
      if (ignoreRuleKey && currentKey === ignoreRuleKey) {
        return false;
      }
      return currentKey === nextRuleKey;
    });
  };

  const validateRule = (rule: ProviderModelRedirectRule, ignoreRuleKey?: string): string | null => {
    const normalized = normalizeRule(rule);

    if (!normalized.source) {
      return t("sourceEmpty");
    }
    if (!normalized.target) {
      return t("targetEmpty");
    }
    if (normalized.source.length > 255) {
      return t("sourceTooLong");
    }
    if (normalized.target.length > 255) {
      return t("targetTooLong");
    }
    if (normalized.matchType === "regex") {
      if (!safeRegex(normalized.source)) {
        return t("regexUnsafe");
      }

      try {
        new RegExp(normalized.source);
      } catch {
        return t("regexInvalid");
      }
    }
    if (hasDuplicateRule(normalized, ignoreRuleKey)) {
      return t("alreadyExists", {
        model: `${normalized.matchType}:${normalized.source}`,
      });
    }
    return null;
  };

  const handleAdd = () => {
    if (redirects.length >= 100) {
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
    onChange([...redirects, nextRule]);
    setNewRule(DEFAULT_RULE);
  };

  const handleRemove = (ruleKey: string) => {
    onChange(redirects.filter((rule) => getRuleIdentity(rule) !== ruleKey));
    if (editingRuleKey === ruleKey) {
      setEditingRuleKey(null);
      setEditRule(DEFAULT_RULE);
      setError(null);
    }
  };

  const handleMove = (ruleKey: string, direction: -1 | 1) => {
    const index = redirects.findIndex((rule) => getRuleIdentity(rule) === ruleKey);
    if (index < 0) return;

    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= redirects.length) {
      return;
    }

    const nextRules = [...redirects];
    const [item] = nextRules.splice(index, 1);
    nextRules.splice(nextIndex, 0, item);
    onChange(nextRules);
  };

  const handleStartEdit = (rule: ProviderModelRedirectRule) => {
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

    const currentIndex = redirects.findIndex((rule) => getRuleIdentity(rule) === originalRuleKey);
    if (currentIndex < 0) {
      setError(t("ruleMoved"));
      return;
    }

    setError(null);
    onChange(redirects.map((rule, index) => (index === currentIndex ? nextRule : rule)));
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
      {redirects.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-medium text-muted-foreground">
              {t("currentRules", { count: redirects.length })}
            </div>
            <div className="text-xs text-muted-foreground">{t("orderHint")}</div>
          </div>

          <div className="space-y-1">
            {redirects.map((rule, index) => {
              const ruleKey = getRuleIdentity(rule);
              const isEditing = editingRuleKey === ruleKey;

              return (
                <div key={ruleKey} className="group rounded-md border border-border/60 px-3 py-2">
                  {isEditing ? (
                    <div className="grid gap-2 md:grid-cols-[140px_1fr_24px_1fr_auto] md:items-end">
                      <div className="space-y-1">
                        <Label className="text-xs">{t("matchTypeLabel")}</Label>
                        <Select
                          value={editRule.matchType}
                          onValueChange={(matchType) =>
                            setEditRule((current) => ({
                              ...current,
                              matchType: matchType as ProviderModelRedirectMatchType,
                            }))
                          }
                          disabled={disabled}
                        >
                          <SelectTrigger className="h-8">
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
                        <Label className="text-xs">{t("sourceModel")}</Label>
                        <Input
                          value={editRule.source}
                          data-redirect-edit-source={ruleKey}
                          onChange={(e) =>
                            setEditRule((current) => ({ ...current, source: e.target.value }))
                          }
                          onInput={(e) =>
                            setEditRule((current) => ({
                              ...current,
                              source: (e.target as HTMLInputElement).value,
                            }))
                          }
                          onKeyDown={(e) => handleEditKeyDown(e, ruleKey)}
                          disabled={disabled}
                          className="font-mono text-sm h-8 flex-1"
                          autoFocus
                        />
                      </div>

                      <div className="hidden md:flex items-center justify-center pb-2">
                        <ArrowRight className="h-3 w-3 text-muted-foreground" />
                      </div>

                      <div className="space-y-1">
                        <Label className="text-xs">{t("targetModel")}</Label>
                        <Input
                          value={editRule.target}
                          data-redirect-edit-target={ruleKey}
                          onChange={(e) =>
                            setEditRule((current) => ({ ...current, target: e.target.value }))
                          }
                          onInput={(e) =>
                            setEditRule((current) => ({
                              ...current,
                              target: (e.target as HTMLInputElement).value,
                            }))
                          }
                          onKeyDown={(e) => handleEditKeyDown(e, ruleKey)}
                          disabled={disabled}
                          className="font-mono text-sm h-8 flex-1"
                        />
                      </div>

                      <div className="flex items-center gap-1 md:pb-0 md:justify-end">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          data-redirect-save={ruleKey}
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
                        {rule.source}
                      </Badge>
                      <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                      <Badge variant="secondary" className="font-mono text-xs">
                        {rule.target}
                      </Badge>

                      <div className="ml-auto flex items-center gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          data-redirect-move-up={ruleKey}
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
                          data-redirect-move-down={ruleKey}
                          onClick={() => handleMove(ruleKey, 1)}
                          disabled={disabled || index === redirects.length - 1}
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
                          data-redirect-edit={ruleKey}
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
                          data-redirect-remove={ruleKey}
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

        <div className="grid gap-2 md:grid-cols-[140px_1fr_24px_1fr_auto] md:items-end">
          <div className="space-y-1">
            <Label htmlFor="new-match-type" className="text-xs">
              {t("matchTypeLabel")}
            </Label>
            <Select
              value={newRule.matchType}
              onValueChange={(matchType) =>
                setNewRule((current) => ({
                  ...current,
                  matchType: matchType as ProviderModelRedirectMatchType,
                }))
              }
              disabled={disabled}
            >
              <SelectTrigger id="new-match-type" className="h-9">
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
            <Label htmlFor="new-source" className="text-xs">
              {t("sourceModel")}
            </Label>
            <Input
              id="new-source"
              value={newRule.source}
              onChange={(e) => setNewRule((current) => ({ ...current, source: e.target.value }))}
              onInput={(e) =>
                setNewRule((current) => ({
                  ...current,
                  source: (e.target as HTMLInputElement).value,
                }))
              }
              onKeyDown={handleCreateKeyDown}
              placeholder={t("sourcePlaceholder")}
              disabled={disabled}
              className="font-mono text-sm"
            />
          </div>

          <div className="hidden md:flex items-center justify-center pb-2">
            <ArrowRight className="h-3 w-3 text-muted-foreground" />
          </div>

          <div className="space-y-1">
            <Label htmlFor="new-target" className="text-xs">
              {t("targetModel")}
            </Label>
            <Input
              id="new-target"
              value={newRule.target}
              onChange={(e) => setNewRule((current) => ({ ...current, target: e.target.value }))}
              onInput={(e) =>
                setNewRule((current) => ({
                  ...current,
                  target: (e.target as HTMLInputElement).value,
                }))
              }
              onKeyDown={handleCreateKeyDown}
              placeholder={t("targetPlaceholder")}
              disabled={disabled}
              className="font-mono text-sm"
            />
          </div>

          <Button
            type="button"
            data-redirect-add
            onClick={handleAdd}
            disabled={disabled || !newRule.source.trim() || !newRule.target.trim()}
            size="default"
            className="mb-0"
          >
            <Plus className="h-4 w-4 mr-1" />
            {t("add")}
          </Button>
        </div>

        {error && (
          <div className="flex items-center gap-2 text-xs text-destructive" data-redirect-error>
            <AlertCircle className="h-3 w-3" />
            <span>{error}</span>
          </div>
        )}

        <p className="text-xs text-muted-foreground">{t("description")}</p>
      </div>

      {redirects.length === 0 && (
        <div className="text-center py-6 text-sm text-muted-foreground border border-dashed rounded-md">
          {t("emptyState")}
        </div>
      )}
    </div>
  );
}

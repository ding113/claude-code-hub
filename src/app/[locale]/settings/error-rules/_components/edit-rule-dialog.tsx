"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { updateErrorRuleAction } from "@/actions/error-rules";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { ErrorOverrideResponse, ErrorRule } from "@/repository/error-rules";
import { OverrideSection } from "./override-section";
import { RegexTester } from "./regex-tester";

interface EditRuleDialogProps {
  rule: ErrorRule;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditRuleDialog({ rule, open, onOpenChange }: EditRuleDialogProps) {
  const t = useTranslations("settings");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pattern, setPattern] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [enableOverride, setEnableOverride] = useState(false);
  const [overrideResponse, setOverrideResponse] = useState("");
  const [overrideStatusCode, setOverrideStatusCode] = useState<string>("");

  // Update form when rule changes
  useEffect(() => {
    if (rule) {
      setPattern(rule.pattern);
      setCategory(rule.category || "");
      setDescription(rule.description || "");
      // Enable override if rule has override response or status code
      const hasOverride = !!rule.overrideResponse || !!rule.overrideStatusCode;
      setEnableOverride(hasOverride);
      setOverrideResponse(
        rule.overrideResponse ? JSON.stringify(rule.overrideResponse, null, 2) : ""
      );
      setOverrideStatusCode(rule.overrideStatusCode?.toString() || "");
    }
  }, [rule]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!pattern.trim()) {
      toast.error(t("errorRules.dialog.patternRequired"));
      return;
    }

    if (!category.trim()) {
      toast.error(t("errorRules.dialog.categoryRequired"));
      return;
    }

    // Validate regex pattern (only for regex match type)
    if (rule.matchType === "regex") {
      try {
        new RegExp(pattern.trim());
      } catch {
        toast.error(t("errorRules.dialog.invalidRegex"));
        return;
      }
    }

    // Parse and validate override response JSON (only when override is enabled)
    let parsedOverrideResponse: ErrorOverrideResponse | null = null;
    let parsedStatusCode: number | null = null;

    if (enableOverride) {
      if (overrideResponse.trim()) {
        try {
          parsedOverrideResponse = JSON.parse(overrideResponse.trim());
        } catch {
          toast.error(t("errorRules.dialog.invalidJson"));
          return;
        }
      }

      // Parse override status code
      if (overrideStatusCode.trim()) {
        const code = parseInt(overrideStatusCode.trim(), 10);
        if (Number.isNaN(code) || code < 400 || code > 599) {
          toast.error(t("errorRules.dialog.invalidStatusCode"));
          return;
        }
        parsedStatusCode = code;
      }
    }

    setIsSubmitting(true);

    try {
      const result = await updateErrorRuleAction(rule.id, {
        pattern: pattern.trim(),
        category: category as
          | "prompt_limit"
          | "content_filter"
          | "pdf_limit"
          | "thinking_error"
          | "parameter_error"
          | "invalid_request"
          | "cache_limit",
        description: description.trim() || undefined,
        overrideResponse: parsedOverrideResponse,
        overrideStatusCode: parsedStatusCode,
      });

      if (result.ok) {
        toast.success(t("errorRules.editSuccess"));
        onOpenChange(false);
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error(t("errorRules.editFailed"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col bg-card/95 backdrop-blur-xl border-border">
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle>{t("errorRules.dialog.editTitle")}</DialogTitle>
            <DialogDescription>{t("errorRules.dialog.editDescription")}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4 overflow-y-auto pr-2 flex-1">
            <div className="space-y-2">
              <Label
                htmlFor="edit-pattern"
                className="text-xs font-medium text-muted-foreground uppercase tracking-wide"
              >
                {t("errorRules.dialog.patternLabel")}
              </Label>
              <input
                id="edit-pattern"
                value={pattern}
                onChange={(e) => setPattern(e.target.value)}
                placeholder={t("errorRules.dialog.patternPlaceholder")}
                required
                disabled={rule.isDefault}
                className={cn(
                  "w-full bg-muted/50 border border-border rounded-lg py-2 px-3 text-sm text-foreground font-mono",
                  "placeholder:text-muted-foreground/50",
                  "focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all",
                  "disabled:opacity-50 disabled:cursor-not-allowed"
                )}
              />
              {rule.isDefault && (
                <p className="text-xs text-muted-foreground">
                  {t("errorRules.dialog.defaultRuleHint")}
                </p>
              )}
              {!rule.isDefault && (
                <p className="text-xs text-muted-foreground">
                  {t("errorRules.dialog.patternHint")}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label
                htmlFor="edit-category"
                className="text-xs font-medium text-muted-foreground uppercase tracking-wide"
              >
                {t("errorRules.dialog.categoryLabel")}
              </Label>
              <Select value={category} onValueChange={setCategory} disabled={rule.isDefault}>
                <SelectTrigger id="edit-category" className="bg-muted/50 border-border">
                  <SelectValue placeholder={t("errorRules.dialog.categoryPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="prompt_limit">
                    {t("errorRules.categories.prompt_limit")}
                  </SelectItem>
                  <SelectItem value="content_filter">
                    {t("errorRules.categories.content_filter")}
                  </SelectItem>
                  <SelectItem value="pdf_limit">{t("errorRules.categories.pdf_limit")}</SelectItem>
                  <SelectItem value="thinking_error">
                    {t("errorRules.categories.thinking_error")}
                  </SelectItem>
                  <SelectItem value="parameter_error">
                    {t("errorRules.categories.parameter_error")}
                  </SelectItem>
                  <SelectItem value="invalid_request">
                    {t("errorRules.categories.invalid_request")}
                  </SelectItem>
                  <SelectItem value="cache_limit">
                    {t("errorRules.categories.cache_limit")}
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{t("errorRules.dialog.categoryHint")}</p>
            </div>

            <div className="space-y-2">
              <Label
                htmlFor="edit-description"
                className="text-xs font-medium text-muted-foreground uppercase tracking-wide"
              >
                {t("errorRules.dialog.descriptionLabel")}
              </Label>
              <textarea
                id="edit-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t("errorRules.dialog.descriptionPlaceholder")}
                rows={3}
                className={cn(
                  "w-full bg-muted/50 border border-border rounded-lg py-2.5 px-3 text-sm text-foreground",
                  "placeholder:text-muted-foreground/50 resize-none",
                  "focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                )}
              />
            </div>

            <OverrideSection
              idPrefix="edit"
              enableOverride={enableOverride}
              onEnableOverrideChange={setEnableOverride}
              overrideResponse={overrideResponse}
              onOverrideResponseChange={setOverrideResponse}
              overrideStatusCode={overrideStatusCode}
              onOverrideStatusCodeChange={setOverrideStatusCode}
            />

            {pattern && (
              <div className="space-y-2">
                <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {t("errorRules.dialog.regexTester")}
                </Label>
                <RegexTester pattern={pattern} />
              </div>
            )}
          </div>

          <DialogFooter className="flex-shrink-0 pt-4 border-t border-border/50">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
              className="hover:bg-white/10"
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting}
              className="bg-primary hover:bg-primary/90"
            >
              {isSubmitting ? t("errorRules.dialog.saving") : t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

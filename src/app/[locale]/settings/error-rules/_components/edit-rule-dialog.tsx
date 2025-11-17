"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { updateErrorRuleAction } from "@/actions/error-rules";
import { toast } from "sonner";
import type { ErrorRule } from "@/repository/error-rules";
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

  // Update form when rule changes
  useEffect(() => {
    if (rule) {
      setPattern(rule.pattern);
      setCategory(rule.category || "");
      setDescription(rule.description || "");
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

    // Validate regex pattern
    try {
      new RegExp(pattern.trim());
    } catch {
      toast.error(t("errorRules.dialog.invalidRegex"));
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await updateErrorRuleAction(rule.id, {
        pattern: pattern.trim(),
        category: category.trim() as
          | "client_error"
          | "server_error"
          | "network_error"
          | "rate_limit"
          | "authentication"
          | "other",
        description: description.trim() || undefined,
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
      <DialogContent className="max-w-2xl">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{t("errorRules.dialog.editTitle")}</DialogTitle>
            <DialogDescription>{t("errorRules.dialog.editDescription")}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-pattern">{t("errorRules.dialog.patternLabel")}</Label>
              <Input
                id="edit-pattern"
                value={pattern}
                onChange={(e) => setPattern(e.target.value)}
                placeholder={t("errorRules.dialog.patternPlaceholder")}
                required
                disabled={rule.isDefault}
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

            <div className="grid gap-2">
              <Label htmlFor="edit-category">{t("errorRules.dialog.categoryLabel")}</Label>
              <Input
                id="edit-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder={t("errorRules.dialog.categoryPlaceholder")}
                disabled={rule.isDefault}
              />
              <p className="text-xs text-muted-foreground">{t("errorRules.dialog.categoryHint")}</p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="edit-description">{t("errorRules.dialog.descriptionLabel")}</Label>
              <Textarea
                id="edit-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t("errorRules.dialog.descriptionPlaceholder")}
                rows={3}
              />
            </div>

            {pattern && (
              <div className="grid gap-2">
                <Label>{t("errorRules.dialog.regexTester")}</Label>
                <RegexTester pattern={pattern} />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? t("errorRules.dialog.saving") : t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

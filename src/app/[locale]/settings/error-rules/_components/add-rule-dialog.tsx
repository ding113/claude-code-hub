"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Plus } from "lucide-react";
import { createErrorRuleAction } from "@/actions/error-rules";
import { toast } from "sonner";
import { RegexTester } from "./regex-tester";

export function AddRuleDialog() {
  const t = useTranslations("settings");
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pattern, setPattern] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");

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
      const result = await createErrorRuleAction({
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
        toast.success(t("errorRules.addSuccess"));
        setOpen(false);
        // Reset form
        setPattern("");
        setCategory("");
        setDescription("");
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error(t("errorRules.addFailed"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          {t("errorRules.add")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{t("errorRules.dialog.addTitle")}</DialogTitle>
            <DialogDescription>{t("errorRules.dialog.addDescription")}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="pattern">{t("errorRules.dialog.patternLabel")}</Label>
              <Input
                id="pattern"
                value={pattern}
                onChange={(e) => setPattern(e.target.value)}
                placeholder={t("errorRules.dialog.patternPlaceholder")}
                required
              />
              <p className="text-xs text-muted-foreground">{t("errorRules.dialog.patternHint")}</p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="category">{t("errorRules.dialog.categoryLabel")}</Label>
              <Input
                id="category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder={t("errorRules.dialog.categoryPlaceholder")}
              />
              <p className="text-xs text-muted-foreground">{t("errorRules.dialog.categoryHint")}</p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="description">{t("errorRules.dialog.descriptionLabel")}</Label>
              <Textarea
                id="description"
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
              onClick={() => setOpen(false)}
              disabled={isSubmitting}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? t("errorRules.dialog.creating") : t("common.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

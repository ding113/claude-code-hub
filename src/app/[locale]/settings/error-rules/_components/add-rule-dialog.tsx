"use client";

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { createErrorRuleAction } from "@/actions/error-rules";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ErrorOverrideResponse } from "@/repository/error-rules";
import { OverrideSection } from "./override-section";
import { RegexTester } from "./regex-tester";

export function AddRuleDialog() {
  const t = useTranslations("settings");
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pattern, setPattern] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [enableOverride, setEnableOverride] = useState(false);
  const [overrideResponse, setOverrideResponse] = useState("");
  const [overrideStatusCode, setOverrideStatusCode] = useState<string>("");

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

    // Parse and validate override response JSON (only when override is enabled)
    let parsedOverrideResponse: ErrorOverrideResponse | undefined;
    let parsedStatusCode: number | undefined;

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
      const result = await createErrorRuleAction({
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
        overrideResponse: parsedOverrideResponse ?? null,
        overrideStatusCode: parsedStatusCode ?? null,
      });

      if (result.ok) {
        toast.success(t("errorRules.addSuccess"));
        setOpen(false);
        // Reset form
        setPattern("");
        setCategory("");
        setDescription("");
        setEnableOverride(false);
        setOverrideResponse("");
        setOverrideStatusCode("");
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
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger id="category">
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

            <OverrideSection
              idPrefix="add"
              enableOverride={enableOverride}
              onEnableOverrideChange={setEnableOverride}
              overrideResponse={overrideResponse}
              onOverrideResponseChange={setOverrideResponse}
              overrideStatusCode={overrideStatusCode}
              onOverrideStatusCodeChange={setOverrideStatusCode}
            />

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

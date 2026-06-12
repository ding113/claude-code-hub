"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { updateKeywordRoutingRuleAction } from "@/lib/api-client/v1/actions/keyword-routing";
import type { KeywordRoutingRule } from "@/repository/keyword-routing-rules";

interface EditRuleDialogProps {
  rule: KeywordRoutingRule;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditRuleDialog({ rule, open, onOpenChange }: EditRuleDialogProps) {
  const t = useTranslations("settings");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [sourceModel, setSourceModel] = useState("");
  const [targetModel, setTargetModel] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(true);
  const [priority, setPriority] = useState("0");
  const [description, setDescription] = useState("");

  // Sync form fields when the selected rule changes
  useEffect(() => {
    if (rule) {
      setKeyword(rule.keyword);
      setSourceModel(rule.sourceModel || "");
      setTargetModel(rule.targetModel);
      setCaseSensitive(rule.caseSensitive);
      setPriority(String(rule.priority));
      setDescription(rule.description || "");
    }
  }, [rule]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!keyword.trim()) {
      toast.error(t("keywordRouting.dialog.keywordRequired"));
      return;
    }

    if (!targetModel.trim()) {
      toast.error(t("keywordRouting.dialog.targetModelRequired"));
      return;
    }

    setIsSubmitting(true);

    try {
      const parsedPriority = Number.parseInt(priority, 10);
      const result = await updateKeywordRoutingRuleAction(rule.id, {
        keyword: keyword.trim(),
        sourceModel: sourceModel.trim() || null,
        targetModel: targetModel.trim(),
        caseSensitive,
        priority: Number.isNaN(parsedPriority) ? 0 : parsedPriority,
        description: description.trim() || null,
      });

      if (result.ok) {
        toast.success(t("keywordRouting.editSuccess"));
        onOpenChange(false);
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error(t("keywordRouting.editFailed"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[var(--cch-viewport-height-80)] flex flex-col">
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle>{t("keywordRouting.dialog.editTitle")}</DialogTitle>
            <DialogDescription>{t("keywordRouting.dialog.editDescription")}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4 overflow-y-auto pr-2 flex-1">
            <div className="grid gap-2">
              <Label htmlFor="edit-keyword">{t("keywordRouting.dialog.keywordLabel")}</Label>
              <Input
                id="edit-keyword"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder={t("keywordRouting.dialog.keywordPlaceholder")}
                className="bg-muted/50 border border-border rounded-lg focus:border-[#E25706]/50 focus:ring-[#E25706]/20"
                required
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="edit-sourceModel">
                {t("keywordRouting.dialog.sourceModelLabel")}
              </Label>
              <Input
                id="edit-sourceModel"
                value={sourceModel}
                onChange={(e) => setSourceModel(e.target.value)}
                placeholder={t("keywordRouting.dialog.sourceModelPlaceholder")}
                className="bg-muted/50 border border-border rounded-lg focus:border-[#E25706]/50 focus:ring-[#E25706]/20"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="edit-targetModel">
                {t("keywordRouting.dialog.targetModelLabel")}
              </Label>
              <Input
                id="edit-targetModel"
                value={targetModel}
                onChange={(e) => setTargetModel(e.target.value)}
                placeholder={t("keywordRouting.dialog.targetModelPlaceholder")}
                className="bg-muted/50 border border-border rounded-lg focus:border-[#E25706]/50 focus:ring-[#E25706]/20"
                required
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border bg-muted/50 px-3 py-2.5">
              <Label htmlFor="edit-caseSensitive">
                {t("keywordRouting.dialog.caseSensitiveLabel")}
              </Label>
              <Switch
                id="edit-caseSensitive"
                checked={caseSensitive}
                onCheckedChange={setCaseSensitive}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="edit-priority">{t("keywordRouting.dialog.priorityLabel")}</Label>
              <Input
                id="edit-priority"
                type="number"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                placeholder={t("keywordRouting.dialog.priorityPlaceholder")}
                className="bg-muted/50 border border-border rounded-lg focus:border-[#E25706]/50 focus:ring-[#E25706]/20"
              />
              <p className="text-xs text-muted-foreground">
                {t("keywordRouting.dialog.priorityHint")}
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="edit-description">
                {t("keywordRouting.dialog.descriptionLabel")}
              </Label>
              <Textarea
                id="edit-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t("keywordRouting.dialog.descriptionPlaceholder")}
                className="bg-muted/50 border border-border rounded-lg focus:border-[#E25706]/50 focus:ring-[#E25706]/20"
                rows={3}
              />
            </div>
          </div>

          <DialogFooter className="flex-shrink-0 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? t("keywordRouting.dialog.saving") : t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

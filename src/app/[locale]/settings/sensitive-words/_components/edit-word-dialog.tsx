"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { updateSensitiveWordAction } from "@/actions/sensitive-words";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { SensitiveWord } from "@/repository/sensitive-words";

interface EditWordDialogProps {
  word: SensitiveWord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditWordDialog({ word, open, onOpenChange }: EditWordDialogProps) {
  const t = useTranslations("settings");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [wordText, setWordText] = useState("");
  const [matchType, setMatchType] = useState<string>("");
  const [description, setDescription] = useState("");

  // 当 word 改变时更新表单
  useEffect(() => {
    if (word) {
      setWordText(word.word);
      setMatchType(word.matchType);
      setDescription(word.description || "");
    }
  }, [word]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!wordText.trim()) {
      toast.error(t("sensitiveWords.dialog.wordRequired"));
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await updateSensitiveWordAction(word.id, {
        word: wordText.trim(),
        matchType,
        description: description.trim() || undefined,
      });

      if (result.ok) {
        toast.success(t("sensitiveWords.editSuccess"));
        onOpenChange(false);
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error(t("sensitiveWords.editFailed"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle>{t("sensitiveWords.dialog.editTitle")}</DialogTitle>
            <DialogDescription>{t("sensitiveWords.dialog.editDescription")}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4 overflow-y-auto pr-2 flex-1">
            <div className="grid gap-2">
              <Label htmlFor="edit-word">{t("sensitiveWords.dialog.wordLabel")}</Label>
              <Input
                id="edit-word"
                value={wordText}
                onChange={(e) => setWordText(e.target.value)}
                placeholder={t("sensitiveWords.dialog.wordPlaceholder")}
                className="bg-muted/50 border border-border rounded-lg focus:border-[#E25706]/50 focus:ring-[#E25706]/20"
                required
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="edit-matchType">{t("sensitiveWords.dialog.matchTypeLabel")}</Label>
              <Select value={matchType} onValueChange={(value) => setMatchType(value)}>
                <SelectTrigger className="bg-muted/50 border border-border rounded-lg focus:border-[#E25706]/50 focus:ring-[#E25706]/20">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="contains">
                    {t("sensitiveWords.dialog.matchTypeContains")}
                  </SelectItem>
                  <SelectItem value="exact">{t("sensitiveWords.dialog.matchTypeExact")}</SelectItem>
                  <SelectItem value="regex">{t("sensitiveWords.dialog.matchTypeRegex")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="edit-description">
                {t("sensitiveWords.dialog.descriptionLabel")}
              </Label>
              <Textarea
                id="edit-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t("sensitiveWords.dialog.descriptionPlaceholder")}
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
              {isSubmitting ? t("sensitiveWords.dialog.saving") : t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

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
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{t("sensitiveWords.dialog.editTitle")}</DialogTitle>
            <DialogDescription>{t("sensitiveWords.dialog.editDescription")}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-word">{t("sensitiveWords.dialog.wordLabel")}</Label>
              <Input
                id="edit-word"
                value={wordText}
                onChange={(e) => setWordText(e.target.value)}
                placeholder={t("sensitiveWords.dialog.wordPlaceholder")}
                required
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="edit-matchType">{t("sensitiveWords.dialog.matchTypeLabel")}</Label>
              <Select value={matchType} onValueChange={(value) => setMatchType(value)}>
                <SelectTrigger>
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
                rows={3}
              />
            </div>
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
              {isSubmitting ? t("sensitiveWords.dialog.saving") : t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

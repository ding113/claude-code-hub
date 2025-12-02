"use client";

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { createSensitiveWordAction } from "@/actions/sensitive-words";
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

export function AddWordDialog() {
  const t = useTranslations("settings");
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [word, setWord] = useState("");
  const [matchType, setMatchType] = useState<"contains" | "exact" | "regex">("contains");
  const [description, setDescription] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!word.trim()) {
      toast.error(t("sensitiveWords.dialog.wordRequired"));
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await createSensitiveWordAction({
        word: word.trim(),
        matchType,
        description: description.trim() || undefined,
      });

      if (result.ok) {
        toast.success(t("sensitiveWords.addSuccess"));
        setOpen(false);
        // 重置表单
        setWord("");
        setMatchType("contains");
        setDescription("");
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error(t("sensitiveWords.addFailed"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          {t("sensitiveWords.add")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{t("sensitiveWords.dialog.addTitle")}</DialogTitle>
            <DialogDescription>{t("sensitiveWords.dialog.addDescription")}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="word">{t("sensitiveWords.dialog.wordLabel")}</Label>
              <Input
                id="word"
                value={word}
                onChange={(e) => setWord(e.target.value)}
                placeholder={t("sensitiveWords.dialog.wordPlaceholder")}
                required
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="matchType">{t("sensitiveWords.dialog.matchTypeLabel")}</Label>
              <Select
                value={matchType}
                onValueChange={(value) => setMatchType(value as "contains" | "exact" | "regex")}
              >
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
              <Label htmlFor="description">{t("sensitiveWords.dialog.descriptionLabel")}</Label>
              <Textarea
                id="description"
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
              onClick={() => setOpen(false)}
              disabled={isSubmitting}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? t("sensitiveWords.dialog.creating") : t("common.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

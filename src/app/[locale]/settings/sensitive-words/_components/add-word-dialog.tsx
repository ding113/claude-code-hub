"use client";

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
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
import { useCreateSensitiveWord } from "@/lib/api-client/v1/sensitive-words/hooks";

export function AddWordDialog() {
  const t = useTranslations("settings");
  const [open, setOpen] = useState(false);
  const [word, setWord] = useState("");
  const [matchType, setMatchType] = useState<"contains" | "exact" | "regex">("contains");
  const [description, setDescription] = useState("");
  const { mutateAsync, isPending } = useCreateSensitiveWord();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!word.trim()) {
      toast.error(t("sensitiveWords.dialog.wordRequired"));
      return;
    }

    try {
      await mutateAsync({
        word: word.trim(),
        matchType,
        description: description.trim() || undefined,
      });
      toast.success(t("sensitiveWords.addSuccess"));
      setOpen(false);
      setWord("");
      setMatchType("contains");
      setDescription("");
    } catch {
      // useApiMutation already surfaces toast errors via localizeError
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
      <DialogContent className="max-w-2xl max-h-[var(--cch-viewport-height-80)] flex flex-col">
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle>{t("sensitiveWords.dialog.addTitle")}</DialogTitle>
            <DialogDescription>{t("sensitiveWords.dialog.addDescription")}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4 overflow-y-auto pr-2 flex-1">
            <div className="grid gap-2">
              <Label htmlFor="word">{t("sensitiveWords.dialog.wordLabel")}</Label>
              <Input
                id="word"
                value={word}
                onChange={(e) => setWord(e.target.value)}
                placeholder={t("sensitiveWords.dialog.wordPlaceholder")}
                className="bg-muted/50 border border-border rounded-lg focus:border-[#E25706]/50 focus:ring-[#E25706]/20"
                required
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="matchType">{t("sensitiveWords.dialog.matchTypeLabel")}</Label>
              <Select
                value={matchType}
                onValueChange={(value) => setMatchType(value as "contains" | "exact" | "regex")}
              >
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
              <Label htmlFor="description">{t("sensitiveWords.dialog.descriptionLabel")}</Label>
              <Textarea
                id="description"
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
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? t("sensitiveWords.dialog.creating") : t("common.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

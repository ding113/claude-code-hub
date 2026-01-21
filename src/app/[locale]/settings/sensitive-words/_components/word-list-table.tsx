"use client";

import { Pencil, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { deleteSensitiveWordAction, updateSensitiveWordAction } from "@/actions/sensitive-words";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { SensitiveWord } from "@/repository/sensitive-words";
import { EditWordDialog } from "./edit-word-dialog";

interface WordListTableProps {
  words: SensitiveWord[];
}

const matchTypeColors = {
  contains: "default" as const,
  exact: "secondary" as const,
  regex: "outline" as const,
};

export function WordListTable({ words }: WordListTableProps) {
  const t = useTranslations("settings");
  const [selectedWord, setSelectedWord] = useState<SensitiveWord | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);

  const matchTypeLabels = {
    contains: t("sensitiveWords.table.matchTypeContains"),
    exact: t("sensitiveWords.table.matchTypeExact"),
    regex: t("sensitiveWords.table.matchTypeRegex"),
  };

  const handleToggleEnabled = async (id: number, isEnabled: boolean) => {
    const result = await updateSensitiveWordAction(id, { isEnabled });

    if (result.ok) {
      toast.success(isEnabled ? t("sensitiveWords.enable") : t("sensitiveWords.disable"));
    } else {
      toast.error(result.error);
    }
  };

  const handleDelete = async (id: number, word: string) => {
    if (!confirm(t("sensitiveWords.confirmDelete", { word }))) {
      return;
    }

    const result = await deleteSensitiveWordAction(id);

    if (result.ok) {
      toast.success(t("sensitiveWords.deleteSuccess"));
    } else {
      toast.error(result.error);
    }
  };

  const handleEdit = (word: SensitiveWord) => {
    setSelectedWord(word);
    setIsEditDialogOpen(true);
  };

  if (words.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center rounded-lg bg-black/10 border border-border/50 text-sm text-muted-foreground">
        {t("sensitiveWords.emptyState")}
      </div>
    );
  }

  return (
    <>
      <div className="overflow-x-auto rounded-lg border border-border bg-muted/50 backdrop-blur-sm">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-border bg-white/[0.03]">
              <th className="px-4 py-3 text-left text-sm font-medium text-foreground/80">
                {t("sensitiveWords.table.word")}
              </th>
              <th className="px-4 py-3 text-left text-sm font-medium text-foreground/80">
                {t("sensitiveWords.table.matchType")}
              </th>
              <th className="px-4 py-3 text-left text-sm font-medium text-foreground/80">
                {t("sensitiveWords.table.description")}
              </th>
              <th className="px-4 py-3 text-left text-sm font-medium text-foreground/80">
                {t("sensitiveWords.table.status")}
              </th>
              <th className="px-4 py-3 text-left text-sm font-medium text-foreground/80">
                {t("sensitiveWords.table.createdAt")}
              </th>
              <th className="px-4 py-3 text-right text-sm font-medium text-foreground/80">
                {t("sensitiveWords.table.actions")}
              </th>
            </tr>
          </thead>
          <tbody>
            {words.map((word) => (
              <tr
                key={word.id}
                className="border-b border-border/50 hover:bg-white/[0.02] transition-colors"
              >
                <td className="py-3 px-4 text-sm text-foreground">
                  <code className="rounded-md bg-black/30 border border-border px-2 py-1 text-sm font-mono">
                    {word.word}
                  </code>
                </td>
                <td className="py-3 px-4">
                  <Badge variant={matchTypeColors[word.matchType as keyof typeof matchTypeColors]}>
                    {matchTypeLabels[word.matchType as keyof typeof matchTypeLabels] ||
                      word.matchType}
                  </Badge>
                </td>
                <td className="py-3 px-4 text-sm text-muted-foreground">
                  {word.description || "-"}
                </td>
                <td className="py-3 px-4">
                  <Switch
                    checked={word.isEnabled}
                    onCheckedChange={(checked) => handleToggleEnabled(word.id, checked)}
                  />
                </td>
                <td className="py-3 px-4 text-sm text-muted-foreground">
                  {new Date(word.createdAt).toLocaleString("zh-CN")}
                </td>
                <td className="py-3 px-4 text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleEdit(word)}
                      className="h-8 w-8 p-0 hover:bg-white/10"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(word.id, word.word)}
                      className="h-8 w-8 p-0 hover:bg-white/10 hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedWord && (
        <EditWordDialog
          word={selectedWord}
          open={isEditDialogOpen}
          onOpenChange={setIsEditDialogOpen}
        />
      )}
    </>
  );
}

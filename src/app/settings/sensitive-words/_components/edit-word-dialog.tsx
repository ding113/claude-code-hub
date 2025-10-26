"use client";

import { useState, useEffect } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateSensitiveWordAction } from "@/actions/sensitive-words";
import { toast } from "sonner";
import type { SensitiveWord } from "@/repository/sensitive-words";

interface EditWordDialogProps {
  word: SensitiveWord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditWordDialog({ word, open, onOpenChange }: EditWordDialogProps) {
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
      toast.error("请输入敏感词");
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
        toast.success("敏感词更新成功");
        onOpenChange(false);
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error("更新敏感词失败");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>编辑敏感词</DialogTitle>
            <DialogDescription>修改敏感词配置，更改后将自动刷新缓存。</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-word">敏感词 *</Label>
              <Input
                id="edit-word"
                value={wordText}
                onChange={(e) => setWordText(e.target.value)}
                placeholder="输入敏感词..."
                required
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="edit-matchType">匹配类型 *</Label>
              <Select value={matchType} onValueChange={(value) => setMatchType(value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="contains">包含匹配 - 文本中包含该词即拦截</SelectItem>
                  <SelectItem value="exact">精确匹配 - 完全匹配该词才拦截</SelectItem>
                  <SelectItem value="regex">正则表达式 - 支持复杂模式匹配</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="edit-description">说明</Label>
              <Textarea
                id="edit-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="可选：添加说明..."
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
              取消
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "保存中..." : "保存"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

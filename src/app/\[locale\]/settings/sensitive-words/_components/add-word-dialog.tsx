"use client";

import { useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus } from "lucide-react";
import { createSensitiveWordAction } from "@/actions/sensitive-words";
import { toast } from "sonner";

export function AddWordDialog() {
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [word, setWord] = useState("");
  const [matchType, setMatchType] = useState<"contains" | "exact" | "regex">("contains");
  const [description, setDescription] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!word.trim()) {
      toast.error("请输入敏感词");
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
        toast.success("敏感词创建成功");
        setOpen(false);
        // 重置表单
        setWord("");
        setMatchType("contains");
        setDescription("");
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error("创建敏感词失败");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          添加敏感词
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>添加敏感词</DialogTitle>
            <DialogDescription>
              配置敏感词过滤规则，被命中的请求将不会转发到上游。
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="word">敏感词 *</Label>
              <Input
                id="word"
                value={word}
                onChange={(e) => setWord(e.target.value)}
                placeholder="输入敏感词..."
                required
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="matchType">匹配类型 *</Label>
              <Select
                value={matchType}
                onValueChange={(value) => setMatchType(value as "contains" | "exact" | "regex")}
              >
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
              <Label htmlFor="description">说明</Label>
              <Textarea
                id="description"
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
              onClick={() => setOpen(false)}
              disabled={isSubmitting}
            >
              取消
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "创建中..." : "创建"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

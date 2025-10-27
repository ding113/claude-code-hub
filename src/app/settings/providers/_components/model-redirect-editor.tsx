"use client";
import { useState } from "react";
import { Plus, Trash2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

interface ModelRedirectEditorProps {
  value: Record<string, string>;
  onChange: (value: Record<string, string>) => void;
  disabled?: boolean;
}

export function ModelRedirectEditor({
  value,
  onChange,
  disabled = false,
}: ModelRedirectEditorProps) {
  const [newSource, setNewSource] = useState("");
  const [newTarget, setNewTarget] = useState("");
  const [error, setError] = useState<string | null>(null);

  // 将 Record 转换为数组用于渲染
  const redirects = Object.entries(value);

  const handleAdd = () => {
    setError(null);

    // 验证输入
    if (!newSource.trim()) {
      setError("源模型名称不能为空");
      return;
    }
    if (!newTarget.trim()) {
      setError("目标模型名称不能为空");
      return;
    }

    // 检查是否已存在
    if (value[newSource.trim()]) {
      setError(`模型 "${newSource.trim()}" 已存在重定向规则`);
      return;
    }

    // 添加新的映射
    onChange({
      ...value,
      [newSource.trim()]: newTarget.trim(),
    });

    // 清空输入
    setNewSource("");
    setNewTarget("");
  };

  const handleRemove = (sourceModel: string) => {
    const newValue = { ...value };
    delete newValue[sourceModel];
    onChange(newValue);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAdd();
    }
  };

  return (
    <div className="space-y-3">
      {/* 现有的重定向规则列表 */}
      {redirects.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">
            当前规则 ({redirects.length})
          </div>
          <div className="space-y-2">
            {redirects.map(([source, target]) => (
              <Card
                key={source}
                className="p-3 flex items-center justify-between gap-3 hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-muted-foreground mb-1">源模型</div>
                    <Badge variant="outline" className="font-mono text-xs">
                      {source}
                    </Badge>
                  </div>
                  <div className="text-muted-foreground">→</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-muted-foreground mb-1">目标模型</div>
                    <Badge variant="secondary" className="font-mono text-xs">
                      {target}
                    </Badge>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => handleRemove(source)}
                  disabled={disabled}
                  className="shrink-0 h-8 w-8 p-0"
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* 添加新规则表单 */}
      <div className="space-y-2">
        <div className="text-xs font-medium text-muted-foreground">添加新规则</div>
        <div className="grid grid-cols-[1fr_auto_1fr_auto] gap-2 items-end">
          <div className="space-y-1">
            <Label htmlFor="new-source" className="text-xs">
              源模型名称
            </Label>
            <Input
              id="new-source"
              value={newSource}
              onChange={(e) => setNewSource(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="例如: gpt-5"
              disabled={disabled}
              className="font-mono text-sm"
            />
          </div>

          <div className="text-muted-foreground pb-2">→</div>

          <div className="space-y-1">
            <Label htmlFor="new-target" className="text-xs">
              目标模型名称
            </Label>
            <Input
              id="new-target"
              value={newTarget}
              onChange={(e) => setNewTarget(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="例如: claude-sonnet-4.5"
              disabled={disabled}
              className="font-mono text-sm"
            />
          </div>

          <Button
            type="button"
            onClick={handleAdd}
            disabled={disabled || !newSource.trim() || !newTarget.trim()}
            size="default"
            className="mb-0"
          >
            <Plus className="h-4 w-4 mr-1" />
            添加
          </Button>
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="flex items-center gap-2 text-xs text-destructive">
            <AlertCircle className="h-3 w-3" />
            <span>{error}</span>
          </div>
        )}

        {/* 帮助文本 */}
        <p className="text-xs text-muted-foreground">
          输入源模型和目标模型名称，然后点击&ldquo;添加&rdquo;按钮。重定向规则将在请求时自动应用。
        </p>
      </div>

      {/* 空状态提示 */}
      {redirects.length === 0 && (
        <div className="text-center py-6 text-sm text-muted-foreground border border-dashed rounded-md">
          暂无重定向规则。添加规则后，系统将自动重写请求中的模型名称。
        </div>
      )}
    </div>
  );
}

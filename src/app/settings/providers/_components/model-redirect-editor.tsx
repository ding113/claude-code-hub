"use client";
import { useState } from "react";
import { Plus, X, ArrowRight, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

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
          <div className="space-y-1">
            {redirects.map(([source, target]) => (
              <div
                key={source}
                className="group flex items-center gap-2 py-2 px-3 rounded-md hover:bg-muted/50 transition-colors"
              >
                <Badge variant="outline" className="font-mono text-xs shrink-0">
                  {source}
                </Badge>
                <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                <Badge variant="secondary" className="font-mono text-xs shrink-0">
                  {target}
                </Badge>
                <div className="flex-1" />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => handleRemove(source)}
                  disabled={disabled}
                  className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="h-3 w-3 text-muted-foreground" />
                </Button>
              </div>
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
              用户请求的模型
            </Label>
            <Input
              id="new-source"
              value={newSource}
              onChange={(e) => setNewSource(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="例如: claude-sonnet-4-5-20250929"
              disabled={disabled}
              className="font-mono text-sm"
            />
          </div>

          <div className="text-muted-foreground pb-2">→</div>

          <div className="space-y-1">
            <Label htmlFor="new-target" className="text-xs">
              实际转发的模型
            </Label>
            <Input
              id="new-target"
              value={newTarget}
              onChange={(e) => setNewTarget(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="例如: glm-4.6"
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
          将 Claude Code 客户端请求的模型（如
          claude-sonnet-4.5）重定向到上游供应商实际支持的模型（如
          glm-4.6、gemini-pro）。用于成本优化或接入第三方 AI 服务。
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

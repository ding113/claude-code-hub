"use client";
import { useState } from "react";
import { Plus, X, ArrowRight, AlertCircle, Pencil, Check } from "lucide-react";
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

  // 编辑状态管理
  const [editingSource, setEditingSource] = useState<string | null>(null);
  const [editSource, setEditSource] = useState("");
  const [editTarget, setEditTarget] = useState("");

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

  // 开始编辑
  const handleStartEdit = (source: string, target: string) => {
    setEditingSource(source);
    setEditSource(source);
    setEditTarget(target);
    setError(null);
  };

  // 保存编辑
  const handleSaveEdit = () => {
    if (!editingSource) return;

    setError(null);

    // 验证输入
    if (!editSource.trim()) {
      setError("源模型名称不能为空");
      return;
    }
    if (!editTarget.trim()) {
      setError("目标模型名称不能为空");
      return;
    }

    const newValue = { ...value };

    // 如果源模型名改变了，需要删除旧键
    if (editSource.trim() !== editingSource) {
      delete newValue[editingSource];

      // 检查新键是否已存在
      if (newValue[editSource.trim()]) {
        setError(`模型 "${editSource.trim()}" 已存在重定向规则`);
        return;
      }
    }

    // 更新映射
    newValue[editSource.trim()] = editTarget.trim();
    onChange(newValue);

    // 退出编辑模式
    setEditingSource(null);
    setEditSource("");
    setEditTarget("");
  };

  // 取消编辑
  const handleCancelEdit = () => {
    setEditingSource(null);
    setEditSource("");
    setEditTarget("");
    setError(null);
  };

  // 编辑模式下的键盘事件
  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSaveEdit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      handleCancelEdit();
    }
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
            {redirects.map(([source, target]) => {
              const isEditing = editingSource === source;

              return (
                <div
                  key={source}
                  className="group flex items-center gap-2 py-2 px-3 rounded-md hover:bg-muted/50 transition-colors"
                >
                  {isEditing ? (
                    // 编辑模式
                    <>
                      <Input
                        value={editSource}
                        onChange={(e) => setEditSource(e.target.value)}
                        onKeyDown={handleEditKeyDown}
                        disabled={disabled}
                        className="font-mono text-xs h-7 flex-1"
                        placeholder="源模型"
                        autoFocus
                      />
                      <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                      <Input
                        value={editTarget}
                        onChange={(e) => setEditTarget(e.target.value)}
                        onKeyDown={handleEditKeyDown}
                        disabled={disabled}
                        className="font-mono text-xs h-7 flex-1"
                        placeholder="目标模型"
                      />
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={handleSaveEdit}
                          disabled={disabled || !editSource.trim() || !editTarget.trim()}
                          className="h-7 w-7 p-0"
                          title="保存 (Enter)"
                        >
                          <Check className="h-3.5 w-3.5 text-green-600" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={handleCancelEdit}
                          disabled={disabled}
                          className="h-7 w-7 p-0"
                          title="取消 (Esc)"
                        >
                          <X className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                      </div>
                    </>
                  ) : (
                    // 显示模式
                    <>
                      <Badge variant="outline" className="font-mono text-xs shrink-0">
                        {source}
                      </Badge>
                      <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                      <Badge variant="secondary" className="font-mono text-xs shrink-0">
                        {target}
                      </Badge>
                      <div className="flex-1" />
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleStartEdit(source, target)}
                          disabled={disabled}
                          className="h-6 w-6 p-0"
                          title="编辑"
                        >
                          <Pencil className="h-3 w-3 text-muted-foreground" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemove(source)}
                          disabled={disabled}
                          className="h-6 w-6 p-0"
                          title="删除"
                        >
                          <X className="h-3 w-3 text-muted-foreground" />
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
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

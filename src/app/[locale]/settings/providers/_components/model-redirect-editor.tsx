"use client";
import { AlertCircle, ArrowRight, Check, Pencil, Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
  const t = useTranslations("settings.providers.form.modelRedirect");
  const [newSource, setNewSource] = useState("");
  const [newTarget, setNewTarget] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editingSource, setEditingSource] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState("");

  // 将 Record 转换为数组用于渲染
  const redirects = Object.entries(value);

  const handleAdd = () => {
    setError(null);

    // 验证输入
    if (!newSource.trim()) {
      setError(t("sourceEmpty"));
      return;
    }
    if (!newTarget.trim()) {
      setError(t("targetEmpty"));
      return;
    }

    // 检查是否已存在
    if (value[newSource.trim()]) {
      setError(t("alreadyExists", { model: newSource.trim() }));
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

  const handleStartEdit = (source: string, target: string) => {
    setEditingSource(source);
    setEditTarget(target);
    setError(null);
  };

  const handleCancelEdit = () => {
    setEditingSource(null);
    setEditTarget("");
    setError(null);
  };

  const handleSaveEdit = (originalSource: string) => {
    setError(null);

    if (!editTarget.trim()) {
      setError(t("targetEmpty"));
      return;
    }

    const newValue = { ...value };
    newValue[originalSource] = editTarget.trim();
    onChange(newValue);

    setEditingSource(null);
    setEditTarget("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAdd();
    }
  };

  const handleEditKeyDown = (e: React.KeyboardEvent, originalSource: string) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSaveEdit(originalSource);
    } else if (e.key === "Escape") {
      e.preventDefault();
      handleCancelEdit();
    }
  };

  return (
    <div className="space-y-3">
      {/* 现有的重定向规则列表 */}
      {redirects.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">
            {t("currentRules", { count: redirects.length })}
          </div>
          <div className="space-y-1">
            {redirects.map(([source, target]) => {
              const isEditing = editingSource === source;

              return (
                <div
                  key={source}
                  className="group flex items-center gap-2 py-2 px-3 rounded-md hover:bg-muted/50 transition-colors"
                >
                  <Badge variant="outline" className="font-mono text-xs shrink-0">
                    {source}
                  </Badge>
                  <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />

                  {isEditing ? (
                    <Input
                      value={editTarget}
                      onChange={(e) => setEditTarget(e.target.value)}
                      onKeyDown={(e) => handleEditKeyDown(e, source)}
                      disabled={disabled}
                      className="font-mono text-sm h-7 flex-1"
                      autoFocus
                    />
                  ) : (
                    <Badge variant="secondary" className="font-mono text-xs shrink-0">
                      {target}
                    </Badge>
                  )}

                  <div className="flex-1" />

                  {isEditing ? (
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleSaveEdit(source)}
                        disabled={disabled || !editTarget.trim()}
                        className="h-6 w-6 p-0"
                      >
                        <Check className="h-3 w-3 text-green-600" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={handleCancelEdit}
                        disabled={disabled}
                        className="h-6 w-6 p-0"
                      >
                        <X className="h-3 w-3 text-muted-foreground" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleStartEdit(source, target)}
                        disabled={disabled}
                        className="h-6 w-6 p-0"
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
                      >
                        <X className="h-3 w-3 text-muted-foreground" />
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 添加新规则表单 */}
      <div className="space-y-2">
        <div className="text-xs font-medium text-muted-foreground">{t("addNewRule")}</div>
        <div className="grid grid-cols-[1fr_auto_1fr_auto] gap-2 items-end">
          <div className="space-y-1">
            <Label htmlFor="new-source" className="text-xs">
              {t("sourceModel")}
            </Label>
            <Input
              id="new-source"
              value={newSource}
              onChange={(e) => setNewSource(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t("sourcePlaceholder")}
              disabled={disabled}
              className="font-mono text-sm"
            />
          </div>

          <div className="text-muted-foreground pb-2">→</div>

          <div className="space-y-1">
            <Label htmlFor="new-target" className="text-xs">
              {t("targetModel")}
            </Label>
            <Input
              id="new-target"
              value={newTarget}
              onChange={(e) => setNewTarget(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t("targetPlaceholder")}
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
            {t("add")}
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
        <p className="text-xs text-muted-foreground">{t("description")}</p>
      </div>

      {/* 空状态提示 */}
      {redirects.length === 0 && (
        <div className="text-center py-6 text-sm text-muted-foreground border border-dashed rounded-md">
          {t("emptyState")}
        </div>
      )}
    </div>
  );
}

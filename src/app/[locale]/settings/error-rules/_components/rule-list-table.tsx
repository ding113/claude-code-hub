"use client";

import { AlertTriangle, Pencil, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { deleteErrorRuleAction, updateErrorRuleAction } from "@/actions/error-rules";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ErrorRule } from "@/repository/error-rules";
import { EditRuleDialog } from "./edit-rule-dialog";

interface RuleListTableProps {
  rules: ErrorRule[];
}

const categoryColors: Record<string, { bg: string; text: string }> = {
  prompt_limit: { bg: "bg-yellow-500/10", text: "text-yellow-400" },
  content_filter: { bg: "bg-red-500/10", text: "text-red-400" },
  pdf_limit: { bg: "bg-blue-500/10", text: "text-blue-400" },
  thinking_error: { bg: "bg-purple-500/10", text: "text-purple-400" },
  parameter_error: { bg: "bg-orange-500/10", text: "text-orange-400" },
  invalid_request: { bg: "bg-pink-500/10", text: "text-pink-400" },
  cache_limit: { bg: "bg-cyan-500/10", text: "text-cyan-400" },
};

export function RuleListTable({ rules }: RuleListTableProps) {
  const t = useTranslations("settings");
  const [selectedRule, setSelectedRule] = useState<ErrorRule | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);

  const handleToggleEnabled = async (id: number, isEnabled: boolean) => {
    const result = await updateErrorRuleAction(id, { isEnabled });

    if (result.ok) {
      toast.success(isEnabled ? t("errorRules.enable") : t("errorRules.disable"));
    } else {
      toast.error(result.error);
    }
  };

  const handleDelete = async (id: number, pattern: string, isDefault: boolean) => {
    if (isDefault) {
      toast.error(t("errorRules.cannotDeleteDefault"));
      return;
    }

    if (!confirm(t("errorRules.confirmDelete", { pattern }))) {
      return;
    }

    const result = await deleteErrorRuleAction(id);

    if (result.ok) {
      toast.success(t("errorRules.deleteSuccess"));
    } else {
      toast.error(result.error);
    }
  };

  const handleEdit = (rule: ErrorRule) => {
    setSelectedRule(rule);
    setIsEditDialogOpen(true);
  };

  if (rules.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5 mb-4">
          <AlertTriangle className="h-8 w-8 text-muted-foreground" />
        </div>
        <p className="text-sm text-muted-foreground">{t("errorRules.emptyState")}</p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-2">
        {rules.map((rule) => {
          const colors = categoryColors[rule.category || ""] || {
            bg: "bg-gray-500/10",
            text: "text-gray-400",
          };

          return (
            <div
              key={rule.id}
              className={cn(
                "p-4 rounded-xl bg-white/[0.02] border border-white/5",
                "flex flex-col sm:flex-row sm:items-center justify-between gap-4",
                "hover:bg-white/[0.04] hover:border-white/10 transition-colors group"
              )}
            >
              <div className="flex items-start gap-3 min-w-0 flex-1">
                <div className={cn("p-2 rounded-lg shrink-0", colors.bg)}>
                  <AlertTriangle className={cn("h-4 w-4", colors.text)} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <code
                          className="text-sm font-medium text-foreground font-mono truncate max-w-[300px] cursor-help"
                          tabIndex={0}
                        >
                          {rule.pattern}
                        </code>
                      </TooltipTrigger>
                      <TooltipContent
                        side="bottom"
                        className="max-w-md break-all font-mono text-xs"
                      >
                        {rule.pattern}
                      </TooltipContent>
                    </Tooltip>
                    {rule.isDefault && (
                      <Badge
                        variant="secondary"
                        className="text-[10px] bg-white/5 text-muted-foreground border-white/10"
                      >
                        {t("errorRules.table.default")}
                      </Badge>
                    )}
                    {rule.category && (
                      <Badge
                        variant="outline"
                        className={cn("text-[10px] border-white/10", colors.text)}
                      >
                        {rule.category}
                      </Badge>
                    )}
                  </div>
                  {rule.description && (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
                      {rule.description}
                    </p>
                  )}
                  <p className="text-[10px] text-muted-foreground/60 mt-1">
                    {new Date(rule.createdAt).toLocaleString("zh-CN")}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                <Switch
                  checked={rule.isEnabled}
                  onCheckedChange={(checked) => handleToggleEnabled(rule.id, checked)}
                />
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 hover:bg-white/10"
                    onClick={() => handleEdit(rule)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 hover:bg-red-500/10 hover:text-red-400"
                    onClick={() => handleDelete(rule.id, rule.pattern, rule.isDefault)}
                    disabled={rule.isDefault}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {selectedRule && (
        <EditRuleDialog
          rule={selectedRule}
          open={isEditDialogOpen}
          onOpenChange={setIsEditDialogOpen}
        />
      )}
    </>
  );
}

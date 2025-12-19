"use client";

import { Pencil, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { deleteErrorRuleAction, updateErrorRuleAction } from "@/actions/error-rules";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ErrorRule } from "@/repository/error-rules";
import { EditRuleDialog } from "./edit-rule-dialog";

interface RuleListTableProps {
  rules: ErrorRule[];
}

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
      <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
        {t("errorRules.emptyState")}
      </div>
    );
  }

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse table-fixed">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="w-[280px] px-4 py-3 text-left text-sm font-medium">
                {t("errorRules.table.pattern")}
              </th>
              <th className="w-24 px-4 py-3 text-left text-sm font-medium">
                {t("errorRules.table.category")}
              </th>
              <th className="w-48 px-4 py-3 text-left text-sm font-medium">
                {t("errorRules.table.description")}
              </th>
              <th className="w-20 px-4 py-3 text-left text-sm font-medium">
                {t("errorRules.table.status")}
              </th>
              <th className="w-36 px-4 py-3 text-left text-sm font-medium">
                {t("errorRules.table.createdAt")}
              </th>
              <th className="w-24 px-4 py-3 text-right text-sm font-medium">
                {t("errorRules.table.actions")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rules.map((rule) => (
              <tr key={rule.id} className="border-b hover:bg-muted/30">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <code
                          className="block max-w-[200px] truncate rounded bg-muted px-2 py-1 text-sm cursor-help"
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
                      <Badge variant="secondary" className="text-xs shrink-0">
                        {t("errorRules.table.default")}
                      </Badge>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  {rule.category ? (
                    <Badge variant="outline">{rule.category}</Badge>
                  ) : (
                    <span className="text-sm text-muted-foreground">-</span>
                  )}
                </td>
                <td
                  className="px-4 py-3 text-sm text-muted-foreground truncate"
                  title={rule.description || undefined}
                >
                  {rule.description || "-"}
                </td>
                <td className="px-4 py-3">
                  <Switch
                    checked={rule.isEnabled}
                    onCheckedChange={(checked) => handleToggleEnabled(rule.id, checked)}
                  />
                </td>
                <td className="px-4 py-3 text-sm text-muted-foreground">
                  {new Date(rule.createdAt).toLocaleString("zh-CN")}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={() => handleEdit(rule)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(rule.id, rule.pattern, rule.isDefault)}
                      disabled={rule.isDefault}
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

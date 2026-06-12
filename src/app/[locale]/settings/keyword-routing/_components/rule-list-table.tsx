"use client";

import { formatInTimeZone } from "date-fns-tz";
import { ArrowRight, Pencil, Trash2 } from "lucide-react";
import { useTimeZone, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  deleteKeywordRoutingRuleAction,
  updateKeywordRoutingRuleAction,
} from "@/lib/api-client/v1/actions/keyword-routing";
import type { KeywordRoutingRule } from "@/repository/keyword-routing-rules";
import { EditRuleDialog } from "./edit-rule-dialog";

interface RuleListTableProps {
  rules: KeywordRoutingRule[];
}

export function RuleListTable({ rules }: RuleListTableProps) {
  const t = useTranslations("settings");
  const timeZone = useTimeZone() ?? "UTC";
  const [selectedRule, setSelectedRule] = useState<KeywordRoutingRule | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);

  const handleToggleEnabled = async (id: number, isEnabled: boolean) => {
    const result = await updateKeywordRoutingRuleAction(id, { isEnabled });

    if (result.ok) {
      toast.success(isEnabled ? t("keywordRouting.enable") : t("keywordRouting.disable"));
    } else {
      toast.error(result.error);
    }
  };

  const handleDelete = async (id: number, keyword: string) => {
    if (!confirm(t("keywordRouting.confirmDelete", { keyword }))) {
      return;
    }

    const result = await deleteKeywordRoutingRuleAction(id);

    if (result.ok) {
      toast.success(t("keywordRouting.deleteSuccess"));
    } else {
      toast.error(result.error);
    }
  };

  const handleEdit = (rule: KeywordRoutingRule) => {
    setSelectedRule(rule);
    setIsEditDialogOpen(true);
  };

  if (rules.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center rounded-lg bg-black/10 border border-border/50 text-sm text-muted-foreground">
        {t("keywordRouting.emptyState")}
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
                {t("keywordRouting.table.priority")}
              </th>
              <th className="px-4 py-3 text-left text-sm font-medium text-foreground/80">
                {t("keywordRouting.table.keyword")}
              </th>
              <th className="px-4 py-3 text-left text-sm font-medium text-foreground/80">
                {t("keywordRouting.table.sourceModel")}
              </th>
              <th className="px-4 py-3 text-left text-sm font-medium text-foreground/80">
                {t("keywordRouting.table.targetModel")}
              </th>
              <th className="px-4 py-3 text-left text-sm font-medium text-foreground/80">
                {t("keywordRouting.table.caseSensitive")}
              </th>
              <th className="px-4 py-3 text-left text-sm font-medium text-foreground/80">
                {t("keywordRouting.table.status")}
              </th>
              <th className="px-4 py-3 text-left text-sm font-medium text-foreground/80">
                {t("keywordRouting.table.createdAt")}
              </th>
              <th className="px-4 py-3 text-right text-sm font-medium text-foreground/80">
                {t("keywordRouting.table.actions")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rules.map((rule) => (
              <tr
                key={rule.id}
                className="border-b border-border/50 hover:bg-white/[0.02] transition-colors"
              >
                <td className="py-3 px-4 text-sm text-foreground font-mono">{rule.priority}</td>
                <td className="py-3 px-4 text-sm text-foreground">
                  <code className="rounded-md bg-black/30 border border-border px-2 py-1 text-sm font-mono">
                    {rule.keyword}
                  </code>
                </td>
                <td className="py-3 px-4 text-sm text-foreground">
                  {rule.sourceModel ? (
                    <code className="rounded-md bg-black/30 border border-border px-2 py-1 text-xs font-mono">
                      {rule.sourceModel}
                    </code>
                  ) : (
                    <Badge variant="outline">{t("keywordRouting.table.anyModel")}</Badge>
                  )}
                </td>
                <td className="py-3 px-4 text-sm text-foreground">
                  <div className="flex items-center gap-1">
                    <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                    <code className="rounded-md bg-black/30 border border-border px-2 py-1 text-xs font-mono">
                      {rule.targetModel}
                    </code>
                  </div>
                </td>
                <td className="py-3 px-4">
                  <Badge variant={rule.caseSensitive ? "default" : "secondary"}>
                    {rule.caseSensitive
                      ? t("keywordRouting.table.caseSensitiveYes")
                      : t("keywordRouting.table.caseSensitiveNo")}
                  </Badge>
                </td>
                <td className="py-3 px-4">
                  <Switch
                    checked={rule.isEnabled}
                    onCheckedChange={(checked) => handleToggleEnabled(rule.id, checked)}
                  />
                </td>
                <td className="py-3 px-4 text-sm text-muted-foreground">
                  {formatInTimeZone(new Date(rule.createdAt), timeZone, "yyyy-MM-dd HH:mm:ss")}
                </td>
                <td className="py-3 px-4 text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleEdit(rule)}
                      className="h-8 w-8 p-0 hover:bg-white/10"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(rule.id, rule.keyword)}
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

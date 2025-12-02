"use client";

import { Pencil, RefreshCw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import {
  deleteRequestFilterAction,
  refreshRequestFiltersCache,
  updateRequestFilterAction,
} from "@/actions/request-filters";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { RequestFilter } from "@/repository/request-filters";
import { FilterDialog } from "./filter-dialog";

interface Props {
  filters: RequestFilter[];
}

export function FilterTable({ filters }: Props) {
  const t = useTranslations("settings.requestFilters");
  const router = useRouter();
  const [editing, setEditing] = useState<RequestFilter | null>(null);

  const handleToggle = async (filter: RequestFilter, checked: boolean) => {
    const res = await updateRequestFilterAction(filter.id, { isEnabled: checked });
    if (res.ok) {
      toast.success(checked ? t("enable") : t("disable"));
      router.refresh();
    } else {
      toast.error(res.error);
    }
  };

  const handleDelete = async (filter: RequestFilter) => {
    if (!confirm(t("confirmDelete", { name: filter.name }))) return;
    const res = await deleteRequestFilterAction(filter.id);
    if (res.ok) {
      toast.success(t("deleteSuccess"));
      router.refresh();
    } else {
      toast.error(res.error);
    }
  };

  const handleRefresh = async () => {
    const res = await refreshRequestFiltersCache();
    if (res.ok) {
      toast.success(t("refreshSuccess", { count: res.data?.count ?? 0 }));
      router.refresh();
    } else {
      toast.error(res.error);
    }
  };

  if (filters.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-12">
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
        <FilterDialog
          mode="create"
          trigger={<Button size="sm">{t("add")}</Button>}
          onOpenChange={() => setEditing(null)}
        />
      </div>
    );
  }

  return (
    <>
      <div className="mb-3 flex justify-between gap-3">
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleRefresh}>
            <RefreshCw className="mr-2 h-4 w-4" />
            {t("refreshCache")}
          </Button>
        </div>
        <FilterDialog
          mode="create"
          trigger={<Button size="sm">{t("add")}</Button>}
          onOpenChange={() => setEditing(null)}
        />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b bg-muted/50 text-left text-sm font-medium">
              <th className="px-4 py-3">{t("table.name")}</th>
              <th className="px-4 py-3">{t("table.scope")}</th>
              <th className="px-4 py-3">{t("table.action")}</th>
              <th className="px-4 py-3">{t("table.target")}</th>
              <th className="px-4 py-3">{t("table.replacement")}</th>
              <th className="px-4 py-3">{t("table.priority")}</th>
              <th className="px-4 py-3">{t("table.status")}</th>
              <th className="px-4 py-3 text-right">{t("table.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {filters.map((filter) => (
              <tr key={filter.id} className="border-b hover:bg-muted/30">
                <td className="px-4 py-3 text-sm">
                  <div className="flex flex-col gap-1">
                    <span className="font-medium">{filter.name}</span>
                    {filter.description && (
                      <span className="text-xs text-muted-foreground">{filter.description}</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-sm">
                  <Badge variant="outline">{t(`scopeLabel.${filter.scope}`)}</Badge>
                </td>
                <td className="px-4 py-3 text-sm">
                  <Badge>{t(`actionLabel.${filter.action}`)}</Badge>
                </td>
                <td className="px-4 py-3 text-sm">
                  <code className="rounded bg-muted px-2 py-1">{filter.target}</code>
                </td>
                <td className="px-4 py-3 text-sm text-muted-foreground max-w-xs truncate">
                  {filter.replacement === null || filter.replacement === undefined
                    ? "-"
                    : typeof filter.replacement === "string"
                      ? filter.replacement
                      : JSON.stringify(filter.replacement)}
                </td>
                <td className="px-4 py-3 text-sm">{filter.priority}</td>
                <td className="px-4 py-3">
                  <Switch
                    checked={filter.isEnabled}
                    onCheckedChange={(checked) => handleToggle(filter, checked)}
                  />
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(filter)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(filter)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <FilterDialog
          mode="edit"
          filter={editing}
          open={!!editing}
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
        />
      )}
    </>
  );
}

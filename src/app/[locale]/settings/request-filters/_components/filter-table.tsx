"use client";

import { Globe, Package, Pencil, Plus, RefreshCw, Tags, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  deleteRequestFilterAction,
  refreshRequestFiltersCache,
  updateRequestFilterAction,
} from "@/actions/request-filters";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { RequestFilter } from "@/repository/request-filters";
import { FilterDialog } from "./filter-dialog";

interface Props {
  filters: RequestFilter[];
  providers: Array<{ id: number; name: string }>;
}

export function FilterTable({ filters, providers }: Props) {
  const t = useTranslations("settings.requestFilters");
  const router = useRouter();
  const [editing, setEditing] = useState<RequestFilter | null>(null);

  const providerMap = useMemo(() => {
    return new Map(providers.map((p) => [p.id, p.name]));
  }, [providers]);

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
      <div className="flex flex-col items-center justify-center gap-4 py-12 rounded-xl bg-white/[0.02] border border-border/50">
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
        <FilterDialog
          mode="create"
          trigger={
            <Button size="sm" className="bg-[#E25706] hover:bg-[#E25706]/90">
              <Plus className="mr-2 h-4 w-4" />
              {t("add")}
            </Button>
          }
          onOpenChange={() => setEditing(null)}
        />
      </div>
    );
  }

  return (
    <>
      <div className="mb-4 flex justify-between gap-3">
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            className="bg-muted/50 border-border hover:bg-white/10 hover:border-white/20"
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            {t("refreshCache")}
          </Button>
        </div>
        <FilterDialog
          mode="create"
          trigger={
            <Button size="sm" className="bg-[#E25706] hover:bg-[#E25706]/90">
              <Plus className="mr-2 h-4 w-4" />
              {t("add")}
            </Button>
          }
          onOpenChange={() => setEditing(null)}
        />
      </div>

      <div className="overflow-x-auto rounded-xl border border-border/50">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-white/[0.02] text-left text-sm font-medium text-muted-foreground">
              <th className="px-4 py-3 border-b border-border/50">{t("table.name")}</th>
              <th className="px-4 py-3 border-b border-border/50">{t("table.scope")}</th>
              <th className="px-4 py-3 border-b border-border/50">{t("table.action")}</th>
              <th className="px-4 py-3 border-b border-border/50">{t("table.target")}</th>
              <th className="px-4 py-3 border-b border-border/50">{t("table.replacement")}</th>
              <th className="px-2 py-3 w-20 border-b border-border/50">{t("table.priority")}</th>
              <th className="px-2 py-3 w-24 border-b border-border/50">{t("table.apply")}</th>
              <th className="px-2 py-3 w-20 border-b border-border/50">{t("table.status")}</th>
              <th className="px-2 py-3 text-right w-24 border-b border-border/50">
                {t("table.actions")}
              </th>
            </tr>
          </thead>
          <tbody>
            {filters.map((filter, index) => (
              <tr
                key={filter.id}
                className={cn(
                  "hover:bg-white/[0.04] transition-colors",
                  index !== filters.length - 1 && "border-b border-border/50"
                )}
              >
                <td className="px-4 py-3 text-sm max-w-[200px]">
                  <div className="flex flex-col gap-1">
                    <span className="font-medium text-foreground truncate" title={filter.name}>
                      {filter.name}
                    </span>
                    {filter.description && (
                      <span
                        className="text-xs text-muted-foreground truncate"
                        title={filter.description}
                      >
                        {filter.description}
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-sm">
                  <Badge variant="outline" className="bg-white/5 border-border">
                    {t(`scopeLabel.${filter.scope}`)}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-sm">
                  <Badge className="bg-[#E25706]/20 text-[#E25706] border-[#E25706]/30">
                    {t(`actionLabel.${filter.action}`)}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-sm max-w-[250px]">
                  <code
                    className="block rounded-lg bg-muted/50 border border-border px-2 py-1 text-xs truncate font-mono"
                    title={filter.target}
                  >
                    {filter.target}
                  </code>
                </td>
                <td className="px-4 py-3 text-sm max-w-[200px]">
                  <span
                    className="block truncate text-muted-foreground"
                    title={
                      filter.replacement === null || filter.replacement === undefined
                        ? "-"
                        : typeof filter.replacement === "string"
                          ? filter.replacement
                          : JSON.stringify(filter.replacement)
                    }
                  >
                    {filter.replacement === null || filter.replacement === undefined
                      ? "-"
                      : typeof filter.replacement === "string"
                        ? filter.replacement
                        : JSON.stringify(filter.replacement)}
                  </span>
                </td>
                <td className="px-2 py-3 text-sm text-center">
                  <span className="font-mono text-muted-foreground">{filter.priority}</span>
                </td>
                <td className="px-2 py-3 text-center">
                  {filter.bindingType === "global" && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex items-center justify-center cursor-help">
                          <Globe className="h-4 w-4 text-muted-foreground" />
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>{t("applyToAll")}</p>
                      </TooltipContent>
                    </Tooltip>
                  )}
                  {filter.bindingType === "providers" && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex items-center justify-center gap-1 text-sm cursor-help">
                          <Package className="h-4 w-4 text-[#E25706]" />
                          <span className="text-muted-foreground">
                            {filter.providerIds?.length ?? 0}
                          </span>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>
                        <div className="max-w-xs">
                          <p className="font-medium mb-1">{t("providers")}:</p>
                          <ul className="text-xs list-disc list-inside">
                            {filter.providerIds?.map((id) => (
                              <li key={id}>{providerMap.get(id) ?? `ID: ${id}`}</li>
                            )) ?? <li>-</li>}
                          </ul>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  )}
                  {filter.bindingType === "groups" && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex items-center justify-center gap-1 text-sm cursor-help">
                          <Tags className="h-4 w-4 text-[#E25706]" />
                          <span className="text-muted-foreground">
                            {filter.groupTags?.length ?? 0}
                          </span>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>
                        <div className="max-w-xs">
                          <p className="font-medium mb-1">{t("groups")}:</p>
                          <ul className="text-xs list-disc list-inside">
                            {filter.groupTags?.map((tag) => <li key={tag}>{tag}</li>) ?? <li>-</li>}
                          </ul>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  )}
                </td>
                <td className="px-2 py-3 text-center">
                  <Switch
                    checked={filter.isEnabled}
                    onCheckedChange={(checked) => handleToggle(filter, checked)}
                  />
                </td>
                <td className="px-2 py-3 text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditing(filter)}
                      className="h-8 w-8 p-0 hover:bg-white/10"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(filter)}
                      className="h-8 w-8 p-0 hover:bg-red-500/10 hover:text-red-500"
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

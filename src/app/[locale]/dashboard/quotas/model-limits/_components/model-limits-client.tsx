"use client";

import { ChevronRight, Loader2, Plus, Search, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Fragment, useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  deleteModelGroupLimit,
  listModelGroupLimits,
  type ModelGroupLimitResponse,
} from "@/lib/api-client/v1/actions/model-limits";
import { cn } from "@/lib/utils";
import { CURRENCY_CONFIG, type CurrencyCode } from "@/lib/utils/currency";
import type { ModelGroupWithMembers } from "@/repository/model-group";
import type { ModelGroupLimitRecord } from "@/repository/model-group-limit";
import type { UserGroupRow } from "@/repository/user-group";
import { EditModelLimitDialog } from "./edit-model-limit-dialog";
import { QuotaBoostDialog } from "./quota-boost-dialog";

type SubjectType = "user" | "user_group" | "key";

export interface UserItem {
  id: number;
  name: string;
}

interface ModelLimitsClientProps {
  modelGroups: ModelGroupWithMembers[];
  userGroups: UserGroupRow[];
  users: UserItem[];
  initialLimits: ModelGroupLimitRecord[];
  currencyCode?: string;
  featureEnabled: boolean;
  userGroupMembers: Record<number, UserItem[]>;
  boostCounts: Record<string, number>;
}

function toDisplayLimits(records: ModelGroupLimitRecord[]): ModelGroupLimitResponse[] {
  return records.map((r) => ({
    id: r.id,
    subjectType: r.subjectType,
    subjectId: r.subjectId,
    modelGroupId: r.modelGroupId,
    rpmLimit: r.rpmLimit,
    limit5hUsd: r.limit5hUsd,
    limit5hResetMode: r.limit5hResetMode,
    dailyLimitUsd: r.dailyLimitUsd,
    limitWeeklyUsd: r.limitWeeklyUsd,
    limitMonthlyUsd: r.limitMonthlyUsd,
    limitTotalUsd: r.limitTotalUsd,
    limit5hCostResetAt: r.limit5hCostResetAt ? r.limit5hCostResetAt.toISOString() : null,
    keyPreview: r.keyPreview ?? null,
  }));
}

export function ModelLimitsClient({
  modelGroups,
  userGroups,
  users,
  initialLimits,
  currencyCode = "USD",
  featureEnabled: _featureEnabled,
  userGroupMembers,
  boostCounts,
}: ModelLimitsClientProps) {
  const t = useTranslations("quota.modelLimits");
  const router = useRouter();
  const currencySymbol = CURRENCY_CONFIG[currencyCode as CurrencyCode]?.symbol ?? "$";

  const [search, setSearch] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set());
  const [limits, setLimits] = useState<ModelGroupLimitResponse[]>(() =>
    toDisplayLimits(initialLimits)
  );
  const [loading, setLoading] = useState(false);
  const [, startTransition] = useTransition();

  const selectableData = useMemo(
    () => ({
      users: users.map((u) => ({ id: u.id, name: u.name })),
      userGroups: userGroups.map((g) => ({ id: g.id, name: g.name ?? g.tag })),
      keys: [],
      modelGroups: modelGroups.map((g) => ({ id: g.id, name: g.name })),
    }),
    [users, userGroups, modelGroups]
  );

  const loadLimits = useCallback(async () => {
    setLoading(true);
    const result = await listModelGroupLimits({});
    if (result.ok) {
      setLimits(result.data);
    } else {
      setLimits([]);
      toast.error(result.error ?? t("loadError"));
    }
    setLoading(false);
  }, [t]);

  useEffect(() => {
    void loadLimits();
  }, [loadLimits]);

  const handleDelete = (id: number) => {
    startTransition(async () => {
      const result = await deleteModelGroupLimit(id);
      if (result.ok) {
        toast.success(t("deleteSuccess"));
        await loadLimits();
        router.refresh();
      } else {
        toast.error(result.error ?? t("deleteError"));
      }
    });
  };

  const resolveSubjectName = useCallback(
    (limit: ModelGroupLimitResponse): string => {
      if (limit.subjectType === "user") {
        return users.find((u) => u.id === limit.subjectId)?.name ?? String(limit.subjectId);
      }
      if (limit.subjectType === "user_group") {
        const g = userGroups.find((g) => g.id === limit.subjectId);
        return g?.name ?? g?.tag ?? String(limit.subjectId);
      }
      if (limit.subjectType === "key") {
        return limit.keyPreview ?? String(limit.subjectId);
      }
      return String(limit.subjectId);
    },
    [users, userGroups]
  );

  const resolveGroupName = useCallback(
    (limit: ModelGroupLimitResponse): string =>
      modelGroups.find((g) => g.id === limit.modelGroupId)?.name ?? String(limit.modelGroupId),
    [modelGroups]
  );

  const subjectTypeLabel = useCallback(
    (subjectType: string): string => {
      if (subjectType === "user") return t("subjectTypeUser");
      if (subjectType === "user_group") return t("subjectTypeUserGroup");
      return t("subjectTypeKey");
    },
    [t]
  );

  const filteredLimits = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return limits;
    return limits.filter((limit) => {
      const subject = resolveSubjectName(limit).toLowerCase();
      const group = resolveGroupName(limit).toLowerCase();
      const type = subjectTypeLabel(limit.subjectType).toLowerCase();
      return subject.includes(query) || group.includes(query) || type.includes(query);
    });
  }, [limits, search, resolveSubjectName, resolveGroupName, subjectTypeLabel]);

  const formatUsd = (value: number | null) =>
    value === null ? "—" : `${currencySymbol}${value.toFixed(2)}`;

  const boostCountFor = useCallback(
    (userId: number, modelGroupId: number) => boostCounts[`${userId}:${modelGroupId}`] ?? 0,
    [boostCounts]
  );

  const toggleGroup = (id: number) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("searchLimits")}
            className="h-9 pl-8"
          />
        </div>

        <EditModelLimitDialog
          currencyCode={currencyCode as CurrencyCode}
          selectable={selectableData}
          onSaved={loadLimits}
          trigger={
            <Button size="sm">
              <Plus className="h-4 w-4" />
              <span className="ml-2">{t("addLimit")}</span>
            </Button>
          }
        />
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : limits.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">{t("noData")}</p>
          ) : filteredLimits.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">{t("noResults")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("table.subjectType")}</TableHead>
                  <TableHead>{t("table.subject")}</TableHead>
                  <TableHead>{t("table.modelGroup")}</TableHead>
                  <TableHead className="text-right">{t("table.fiveHour")}</TableHead>
                  <TableHead className="text-right">{t("table.daily")}</TableHead>
                  <TableHead className="text-right">{t("table.weekly")}</TableHead>
                  <TableHead className="text-right">{t("table.monthly")}</TableHead>
                  <TableHead className="text-right">{t("table.total")}</TableHead>
                  <TableHead>{t("table.resetMode")}</TableHead>
                  <TableHead className="text-right">{t("table.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredLimits.map((limit) => {
                  const members =
                    limit.subjectType === "user_group"
                      ? (userGroupMembers[limit.subjectId] ?? [])
                      : [];
                  const expandable = members.length > 0;
                  const expanded = expandedGroups.has(limit.id);
                  const groupName = resolveGroupName(limit);

                  return (
                    <Fragment key={limit.id}>
                      <TableRow>
                        <TableCell className="text-sm text-muted-foreground">
                          <div className="flex items-center gap-1">
                            {expandable ? (
                              <button
                                type="button"
                                onClick={() => toggleGroup(limit.id)}
                                aria-label={t("expandMembers")}
                                aria-expanded={expanded}
                                className="flex h-5 w-5 items-center justify-center rounded hover:bg-muted"
                              >
                                <ChevronRight
                                  className={cn(
                                    "h-4 w-4 transition-transform",
                                    expanded && "rotate-90"
                                  )}
                                />
                              </button>
                            ) : (
                              <span className="inline-block w-5" />
                            )}
                            {subjectTypeLabel(limit.subjectType)}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">{resolveSubjectName(limit)}</TableCell>
                        <TableCell className="font-medium">{groupName}</TableCell>
                        <TableCell className="text-right">{formatUsd(limit.limit5hUsd)}</TableCell>
                        <TableCell className="text-right">
                          {formatUsd(limit.dailyLimitUsd)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatUsd(limit.limitWeeklyUsd)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatUsd(limit.limitMonthlyUsd)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatUsd(limit.limitTotalUsd)}
                        </TableCell>
                        <TableCell>{t(`resetMode.${limit.limit5hResetMode}`)}</TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-1">
                            {limit.subjectType === "user" && (
                              <QuotaBoostDialog
                                userId={limit.subjectId}
                                userName={resolveSubjectName(limit)}
                                modelGroupId={limit.modelGroupId}
                                modelGroupName={groupName}
                                currencyCode={currencyCode as CurrencyCode}
                                boostCount={boostCountFor(limit.subjectId, limit.modelGroupId)}
                                onChanged={() => router.refresh()}
                              />
                            )}
                            <EditModelLimitDialog
                              subjectType={limit.subjectType as SubjectType}
                              subjectId={limit.subjectId}
                              modelGroupId={limit.modelGroupId}
                              modelGroupName={groupName}
                              currencyCode={currencyCode as CurrencyCode}
                              existing={limit}
                              onSaved={loadLimits}
                            />
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>{t("deleteConfirm.title")}</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    {t("deleteConfirm.description", { group: groupName })}
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>{t("deleteConfirm.cancel")}</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => handleDelete(limit.id)}>
                                    {t("deleteConfirm.confirm")}
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </TableCell>
                      </TableRow>

                      {expanded &&
                        members.map((member) => (
                          <TableRow key={`${limit.id}-${member.id}`} className="bg-muted/30">
                            <TableCell />
                            <TableCell className="pl-8 text-sm text-muted-foreground">
                              {member.name}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {groupName}
                            </TableCell>
                            <TableCell className="text-right text-muted-foreground">—</TableCell>
                            <TableCell className="text-right text-muted-foreground">—</TableCell>
                            <TableCell className="text-right text-muted-foreground">—</TableCell>
                            <TableCell className="text-right text-muted-foreground">—</TableCell>
                            <TableCell className="text-right text-muted-foreground">—</TableCell>
                            <TableCell className="text-muted-foreground">—</TableCell>
                            <TableCell>
                              <div className="flex items-center justify-end gap-1">
                                <QuotaBoostDialog
                                  userId={member.id}
                                  userName={member.name}
                                  modelGroupId={limit.modelGroupId}
                                  modelGroupName={groupName}
                                  currencyCode={currencyCode as CurrencyCode}
                                  boostCount={boostCountFor(member.id, limit.modelGroupId)}
                                  onChanged={() => router.refresh()}
                                />
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="py-3">
          <p className="text-xs text-muted-foreground">{t("semanticsNote")}</p>
        </CardContent>
      </Card>
    </div>
  );
}

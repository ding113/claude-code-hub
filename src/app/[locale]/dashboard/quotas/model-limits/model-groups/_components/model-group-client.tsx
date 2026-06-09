"use client";

import { Loader2, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState, useTransition } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  deleteModelGroup,
  listModelGroups,
  type ModelGroupResponse,
} from "@/lib/api-client/v1/actions/model-groups";
import { CreateModelGroupDialog } from "./create-model-group-dialog";
import { ManageMembersDialog } from "./manage-members-dialog";

type GroupItem = Pick<
  ModelGroupResponse,
  "id" | "name" | "description" | "isSingleton" | "members"
>;

interface ModelGroupClientProps {
  initialGroups: GroupItem[];
  availableModels: string[];
}

export function ModelGroupClient({ initialGroups, availableModels }: ModelGroupClientProps) {
  const t = useTranslations("quota.modelGroups");
  const router = useRouter();
  const [groups, setGroups] = useState<GroupItem[]>(initialGroups);
  const [loading, setLoading] = useState(false);
  const [, startTransition] = useTransition();

  const loadGroups = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listModelGroups();
      if (result.ok) {
        setGroups(result.data);
      } else {
        toast.error(result.error || t("loadError"));
      }
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    setGroups(initialGroups);
  }, [initialGroups]);

  const handleDelete = (id: number, name: string) => {
    startTransition(async () => {
      const result = await deleteModelGroup(id);
      if (result.ok) {
        toast.success(t("deleteSuccess", { name }));
        await loadGroups();
        router.refresh();
      } else {
        toast.error(result.error || t("deleteError"));
      }
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{t("totalCount", { count: groups.length })}</p>
        <CreateModelGroupDialog
          availableModels={availableModels}
          onSaved={loadGroups}
          trigger={
            <Button size="sm">
              <Plus className="h-4 w-4" />
              <span className="ml-2">{t("addGroup")}</span>
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
          ) : groups.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">{t("noData")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("table.name")}</TableHead>
                  <TableHead>{t("table.description")}</TableHead>
                  <TableHead>{t("table.members")}</TableHead>
                  <TableHead>{t("table.type")}</TableHead>
                  <TableHead className="text-right">{t("table.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((group) => (
                  <TableRow key={group.id}>
                    <TableCell className="font-medium">{group.name}</TableCell>
                    <TableCell className="max-w-[200px] truncate text-muted-foreground">
                      {group.description ?? "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {group.members.length === 0 ? (
                          <span className="text-xs text-muted-foreground">{t("noMembers")}</span>
                        ) : (
                          group.members.slice(0, 3).map((model) => (
                            <Badge key={model} variant="secondary" className="text-xs">
                              {model}
                            </Badge>
                          ))
                        )}
                        {group.members.length > 3 && (
                          <Badge variant="outline" className="text-xs">
                            +{group.members.length - 3}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {group.members.length === 1 ? (
                        <Badge variant="outline">{t("singleton")}</Badge>
                      ) : (
                        <Badge variant="secondary">{t("group")}</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <ManageMembersDialog
                          group={group}
                          availableModels={availableModels}
                          onSaved={loadGroups}
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
                                {t("deleteConfirm.description", { name: group.name })}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>{t("deleteConfirm.cancel")}</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => handleDelete(group.id, group.name)}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                {t("deleteConfirm.confirm")}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

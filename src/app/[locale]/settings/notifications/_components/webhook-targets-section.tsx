"use client";

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  ClientActionResult,
  WebhookTargetCreateInput,
  WebhookTargetState,
  WebhookTargetUpdateInput,
} from "../_lib/hooks";
import type { NotificationType } from "../_lib/schemas";
import { WebhookTargetCard } from "./webhook-target-card";
import { WebhookTargetDialog } from "./webhook-target-dialog";

interface WebhookTargetsSectionProps {
  targets: WebhookTargetState[];
  onCreate: (input: WebhookTargetCreateInput) => Promise<ClientActionResult<WebhookTargetState>>;
  onUpdate: (
    id: number,
    input: WebhookTargetUpdateInput
  ) => Promise<ClientActionResult<WebhookTargetState>>;
  onDelete: (id: number) => Promise<ClientActionResult<void>>;
  onTest: (
    id: number,
    type: NotificationType
  ) => Promise<ClientActionResult<{ latencyMs: number }>>;
}

export function WebhookTargetsSection({
  targets,
  onCreate,
  onUpdate,
  onDelete,
  onTest,
}: WebhookTargetsSectionProps) {
  const t = useTranslations("settings");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"create" | "edit">("create");
  const [editingTarget, setEditingTarget] = useState<WebhookTargetState | undefined>(undefined);

  const openCreate = () => {
    setDialogMode("create");
    setEditingTarget(undefined);
    setDialogOpen(true);
  };

  const openEdit = (target: WebhookTargetState) => {
    setDialogMode("edit");
    setEditingTarget(target);
    setDialogOpen(true);
  };

  const handleCreate = useCallback(
    async (input: WebhookTargetCreateInput) => {
      const result = await onCreate(input);
      if (!result.ok) {
        return result;
      }
      toast.success(t("notifications.targets.created"));
      return result;
    },
    [onCreate, t]
  );

  const handleUpdate = useCallback(
    async (id: number, input: WebhookTargetUpdateInput) => {
      const result = await onUpdate(id, input);
      if (!result.ok) {
        return result;
      }
      toast.success(t("notifications.targets.updated"));
      return result;
    },
    [onUpdate, t]
  );

  const handleDelete = useCallback(
    async (id: number) => {
      const result = await onDelete(id);
      if (!result.ok) {
        toast.error(result.error || t("notifications.form.saveFailed"));
        return;
      }
      toast.success(t("notifications.targets.deleted"));
    },
    [onDelete, t]
  );

  const handleToggleEnabled = useCallback(
    async (id: number, enabled: boolean) => {
      const result = await onUpdate(id, { isEnabled: enabled });
      if (!result.ok) {
        toast.error(result.error || t("notifications.form.saveFailed"));
      }
    },
    [onUpdate, t]
  );

  const handleTest = useCallback(
    async (id: number, type: NotificationType) => {
      const result = await onTest(id, type);
      if (!result.ok) {
        toast.error(result.error || t("notifications.form.testFailed"));
      } else {
        toast.success(t("notifications.form.testSuccess"));
      }
    },
    [onTest, t]
  );

  const sortedTargets = useMemo(() => {
    return [...targets].sort((a, b) => b.id - a.id);
  }, [targets]);

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>{t("notifications.targets.title")}</CardTitle>
          <CardDescription>{t("notifications.targets.description")}</CardDescription>
        </div>
        <Button type="button" onClick={openCreate} className="w-full sm:w-auto">
          <Plus className="mr-2 h-4 w-4" />
          {t("notifications.targets.add")}
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        {sortedTargets.length === 0 ? (
          <div className="text-muted-foreground text-sm">
            {t("notifications.targets.emptyHint")}
          </div>
        ) : (
          <div className="grid gap-4">
            {sortedTargets.map((target) => (
              <WebhookTargetCard
                key={target.id}
                target={target}
                onEdit={openEdit}
                onDelete={handleDelete}
                onToggleEnabled={handleToggleEnabled}
                onTest={(id, type) => handleTest(id, type)}
              />
            ))}
          </div>
        )}
      </CardContent>

      <WebhookTargetDialog
        mode={dialogMode}
        target={editingTarget}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreate={handleCreate}
        onUpdate={handleUpdate}
        onTest={onTest}
      />
    </Card>
  );
}

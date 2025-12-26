"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Edit2, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { deleteVendorEndpoint, updateVendorEndpoint } from "@/actions/vendors";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Vendor, VendorEndpoint } from "@/types/vendor";
import { EndpointForm } from "../endpoint-form";
import { HealthBadge } from "../health-badge";

interface EndpointsSectionProps {
  vendor: Vendor;
  endpoints: VendorEndpoint[];
  onChanged?: () => void | Promise<void>;
}

function apiFormatLabel(value: string) {
  return value.toUpperCase();
}

export function EndpointsSection({ vendor, endpoints, onChanged }: EndpointsSectionProps) {
  const t = useTranslations("vendors");
  const tc = useTranslations("common");
  const router = useRouter();
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<VendorEndpoint | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const sorted = useMemo(() => {
    return [...endpoints].sort((a, b) => a.priority - b.priority || a.id - b.id);
  }, [endpoints]);

  const afterMutation = async () => {
    await queryClient.invalidateQueries({ queryKey: ["vendors"] });
    router.refresh();
    await onChanged?.();
  };

  const handleToggle = (endpoint: VendorEndpoint, next: boolean) => {
    startTransition(async () => {
      const res = await updateVendorEndpoint(endpoint.id, { isEnabled: next });
      if (!res.ok) {
        toast.error(t("errors.saveFailed"), { description: res.error });
        return;
      }
      await afterMutation();
    });
  };

  const handleDelete = (endpoint: VendorEndpoint) => {
    startTransition(async () => {
      const res = await deleteVendorEndpoint(endpoint.id);
      if (!res.ok) {
        toast.error(t("errors.deleteFailed"), { description: res.error });
        return;
      }
      toast.success(t("messages.deleteSuccess"));
      await afterMutation();
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          {t("actions.newEndpoint")}
        </Button>
      </div>

      <div className="rounded-lg border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("table.endpoints.name")}</TableHead>
              <TableHead>{t("table.endpoints.url")}</TableHead>
              <TableHead>{t("table.endpoints.apiFormat")}</TableHead>
              <TableHead className="text-right">{t("table.endpoints.priority")}</TableHead>
              <TableHead>{t("table.endpoints.health")}</TableHead>
              <TableHead className="text-right">{t("table.endpoints.latencyMs")}</TableHead>
              <TableHead>{t("table.endpoints.enabled")}</TableHead>
              <TableHead className="text-right">{t("table.endpoints.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((endpoint) => (
              <TableRow key={endpoint.id}>
                <TableCell className="font-medium">{endpoint.name}</TableCell>
                <TableCell className="font-mono text-xs break-all">{endpoint.url}</TableCell>
                <TableCell>
                  <Badge variant="outline">{apiFormatLabel(endpoint.apiFormat)}</Badge>
                </TableCell>
                <TableCell className="text-right font-mono text-xs">{endpoint.priority}</TableCell>
                <TableCell>
                  <HealthBadge
                    status={
                      endpoint.healthCheckEnabled
                        ? endpoint.healthCheckLastStatusCode === 200 &&
                          !endpoint.healthCheckErrorMessage
                          ? "healthy"
                          : endpoint.healthCheckLastCheckedAt
                            ? "unhealthy"
                            : "unknown"
                        : "unknown"
                    }
                    statusCode={endpoint.healthCheckLastStatusCode}
                    errorMessage={endpoint.healthCheckErrorMessage}
                  />
                </TableCell>
                <TableCell className="text-right font-mono text-xs">
                  {endpoint.latencyMs == null ? "-" : endpoint.latencyMs}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={endpoint.isEnabled}
                      onCheckedChange={(next) => handleToggle(endpoint, next)}
                      disabled={pending}
                    />
                    <span className="text-xs text-muted-foreground">
                      {endpoint.isEnabled ? t("status.enabled") : t("status.disabled")}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button
                      size="icon"
                      variant="outline"
                      onClick={() => {
                        setEditing(endpoint);
                        setEditOpen(true);
                      }}
                    >
                      <Edit2 className="h-4 w-4" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="icon" variant="outline">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>{t("actions.delete")}</AlertDialogTitle>
                          <AlertDialogDescription>{endpoint.name}</AlertDialogDescription>
                        </AlertDialogHeader>
                        <div className="flex justify-end gap-2">
                          <AlertDialogCancel>{t("actions.cancel")}</AlertDialogCancel>
                          <AlertDialogAction onClick={() => handleDelete(endpoint)}>
                            {t("actions.delete")}
                          </AlertDialogAction>
                        </div>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {sorted.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  {tc("noData")}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>

      <EndpointForm
        mode="create"
        vendorId={vendor.id}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSaved={afterMutation}
      />

      <EndpointForm
        mode="edit"
        vendorId={vendor.id}
        endpoint={editing ?? undefined}
        open={editOpen}
        onOpenChange={(open) => {
          setEditOpen(open);
          if (!open) setEditing(null);
        }}
        onSaved={afterMutation}
      />
    </div>
  );
}

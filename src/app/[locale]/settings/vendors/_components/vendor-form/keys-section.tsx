"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Edit2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import type { VendorKeyDisplay } from "@/actions/vendors";
import { checkVendorBalance, deleteVendorKey, updateVendorKey } from "@/actions/vendors";
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
import { BalanceIndicator } from "../balance-indicator";
import { KeyForm } from "../key-form";

interface KeysSectionProps {
  vendor: Vendor;
  endpoints: VendorEndpoint[];
  keys: VendorKeyDisplay[];
  lowThresholdUsd?: number | null;
  onChanged?: () => void | Promise<void>;
}

export function KeysSection({
  vendor,
  endpoints,
  keys,
  lowThresholdUsd,
  onChanged,
}: KeysSectionProps) {
  const t = useTranslations("vendors");
  const tc = useTranslations("common");
  const router = useRouter();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<VendorKeyDisplay | null>(null);
  const [pending, startTransition] = useTransition();
  const [balancePendingId, setBalancePendingId] = useState<number | null>(null);

  const endpointNameById = useMemo(
    () => new Map(endpoints.map((e) => [e.id, e.name])),
    [endpoints]
  );

  const sorted = useMemo(() => {
    return [...keys].sort((a, b) => a.priority - b.priority || b.weight - a.weight || a.id - b.id);
  }, [keys]);

  const afterMutation = async () => {
    await queryClient.invalidateQueries({ queryKey: ["vendors"] });
    router.refresh();
    await onChanged?.();
  };

  const handleToggle = (key: VendorKeyDisplay, next: boolean) => {
    startTransition(async () => {
      const res = await updateVendorKey(key.id, { isEnabled: next });
      if (!res.ok) {
        toast.error(t("errors.saveFailed"), { description: res.error });
        return;
      }
      await afterMutation();
    });
  };

  const handleDelete = (key: VendorKeyDisplay) => {
    startTransition(async () => {
      const res = await deleteVendorKey(key.id);
      if (!res.ok) {
        toast.error(t("errors.deleteFailed"), { description: res.error });
        return;
      }
      toast.success(t("messages.deleteSuccess"));
      await afterMutation();
    });
  };

  const handleCheckBalance = async (key: VendorKeyDisplay) => {
    if (balancePendingId) return;
    setBalancePendingId(key.id);
    try {
      const res = await checkVendorBalance(key.id);
      if (!res.ok) {
        toast.error(t("errors.balanceCheckFailed", { error: res.error }));
        return;
      }

      toast.success(t("messages.balanceCheckSuccess"), {
        description: res.data.balanceUsd == null ? "-" : `$${res.data.balanceUsd.toFixed(2)}`,
      });
      await afterMutation();
    } finally {
      setBalancePendingId(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => queryClient.invalidateQueries({ queryKey: ["vendors"] })}
        >
          <RefreshCw className="h-4 w-4" />
          {t("actions.refresh")}
        </Button>
        <Button size="sm" onClick={() => setCreateOpen(true)} disabled={endpoints.length === 0}>
          <Plus className="h-4 w-4" />
          {t("actions.newKey")}
        </Button>
      </div>

      {endpoints.length === 0 ? (
        <div className="rounded-lg border p-4 text-sm text-muted-foreground">
          {t("sections.endpoints.description")}
        </div>
      ) : null}

      <div className="rounded-lg border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("table.keys.name")}</TableHead>
              <TableHead>{t("table.keys.endpoint")}</TableHead>
              <TableHead>{t("table.keys.providerType")}</TableHead>
              <TableHead>{t("table.keys.groupTag")}</TableHead>
              <TableHead className="text-right">{t("table.keys.priority")}</TableHead>
              <TableHead className="text-right">{t("table.keys.weight")}</TableHead>
              <TableHead>{t("table.keys.balance")}</TableHead>
              <TableHead>{t("table.keys.enabled")}</TableHead>
              <TableHead className="text-right">{t("table.keys.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((key) => (
              <TableRow key={key.id}>
                <TableCell className="font-medium">
                  <div className="flex flex-col">
                    <span>{key.name}</span>
                    <span className="text-xs text-muted-foreground font-mono">{key.maskedKey}</span>
                  </div>
                </TableCell>
                <TableCell className="text-sm">
                  {endpointNameById.get(key.endpointId) ?? "-"}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="font-mono">
                    {key.providerType}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm">{key.groupTag ?? "-"}</TableCell>
                <TableCell className="text-right font-mono text-xs">{key.priority}</TableCell>
                <TableCell className="text-right font-mono text-xs">{key.weight}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <BalanceIndicator
                      balanceUsd={key.balanceUsd}
                      lowThresholdUsd={lowThresholdUsd}
                    />
                    {vendor.balanceCheckEnabled ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleCheckBalance(key)}
                        disabled={balancePendingId === key.id}
                      >
                        <RefreshCw
                          className={
                            balancePendingId === key.id ? "h-4 w-4 animate-spin" : "h-4 w-4"
                          }
                        />
                        {t("actions.checkBalance")}
                      </Button>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={key.isEnabled}
                      onCheckedChange={(v) => handleToggle(key, v)}
                      disabled={pending}
                    />
                    {key.isUserOverride ? (
                      <Badge variant="secondary">{t("status.userOverride")}</Badge>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button
                      size="icon"
                      variant="outline"
                      onClick={() => {
                        setEditing(key);
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
                          <AlertDialogDescription>{key.name}</AlertDialogDescription>
                        </AlertDialogHeader>
                        <div className="flex justify-end gap-2">
                          <AlertDialogCancel>{t("actions.cancel")}</AlertDialogCancel>
                          <AlertDialogAction onClick={() => handleDelete(key)}>
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
                <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                  {tc("noData")}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>

      <KeyForm
        mode="create"
        vendorId={vendor.id}
        endpoints={endpoints}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSaved={afterMutation}
      />

      <KeyForm
        mode="edit"
        vendorId={vendor.id}
        endpoints={endpoints}
        vendorKey={editing ?? undefined}
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

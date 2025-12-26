"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CloudDownload, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { toast } from "sonner";
import { syncPricesFromRemote } from "@/actions/model-prices-v2";
import { getRemoteConfigSyncStatus } from "@/actions/remote-config";
import { Button } from "@/components/ui/button";
import { RelativeTime } from "@/components/ui/relative-time";
import type { RemoteConfigSync } from "@/types/remote-config";

type SyncKey = "prices-override";

function formatValue(value: string | null | undefined): string {
  return value && value.trim().length > 0 ? value : "-";
}

export function PriceSyncPanel() {
  const t = useTranslations("prices-v2");
  const tc = useTranslations("common");
  const router = useRouter();
  const queryClient = useQueryClient();
  const [pending, startTransition] = useTransition();

  const { data, isLoading } = useQuery<RemoteConfigSync | null>({
    queryKey: ["remote-config-sync", "prices-override"],
    queryFn: async () => {
      const res = await getRemoteConfigSyncStatus("prices-override" satisfies SyncKey);
      if (!res.ok) {
        throw new Error(res.error);
      }
      return res.data;
    },
    retry: false,
  });

  const handleSync = () => {
    startTransition(async () => {
      const res = await syncPricesFromRemote();
      if (!res.ok) {
        toast.error(t("errors.syncFailed", { error: res.error }));
        await queryClient.invalidateQueries({
          queryKey: ["remote-config-sync", "prices-override"],
        });
        return;
      }

      const hasChanges = res.data.added.length > 0 || res.data.updated.length > 0;
      const message = hasChanges
        ? t("messages.syncSuccessWithChanges", {
            added: res.data.added.length,
            updated: res.data.updated.length,
            unchanged: res.data.unchanged.length,
          })
        : t("messages.syncSuccessNoChanges");

      toast.success(message);
      await queryClient.invalidateQueries({ queryKey: ["prices-v2"] });
      await queryClient.invalidateQueries({ queryKey: ["remote-config-sync", "prices-override"] });
      router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
        <div className="space-y-1">
          <div className="text-sm font-medium">prices-override</div>
          <div className="text-xs text-muted-foreground">
            remoteVersion: {isLoading ? tc("loading") : formatValue(data?.remoteVersion)}
          </div>
          <div className="text-xs text-muted-foreground">
            lastSynced:{" "}
            {data?.lastSyncedAt ? <RelativeTime date={data.lastSyncedAt} /> : formatValue(null)}
          </div>
          {data?.lastErrorMessage ? (
            <div className="text-xs text-destructive">error: {data.lastErrorMessage}</div>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              queryClient.invalidateQueries({ queryKey: ["remote-config-sync", "prices-override"] })
            }
            disabled={pending}
          >
            <RefreshCw className={pending ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            {t("actions.refresh")}
          </Button>
          <Button size="sm" onClick={handleSync} disabled={pending}>
            <CloudDownload className={pending ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            {pending ? t("actions.syncing") : t("actions.sync")}
          </Button>
        </div>
      </div>
    </div>
  );
}

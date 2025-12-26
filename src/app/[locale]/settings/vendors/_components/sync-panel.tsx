"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CloudDownload, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { toast } from "sonner";
import { getRemoteConfigSyncStatus } from "@/actions/remote-config";
import { syncVendorsFromRemote } from "@/actions/vendors";
import { Button } from "@/components/ui/button";
import { RelativeTime } from "@/components/ui/relative-time";
import type { RemoteConfigSync } from "@/types/remote-config";

type SyncKey = "vendors";

function formatValue(value: string | null | undefined): string {
  return value && value.trim().length > 0 ? value : "-";
}

export function SyncPanel() {
  const t = useTranslations("vendors");
  const tc = useTranslations("common");
  const router = useRouter();
  const queryClient = useQueryClient();
  const [pending, startTransition] = useTransition();

  const { data, isLoading } = useQuery<RemoteConfigSync | null>({
    queryKey: ["remote-config-sync", "vendors"],
    queryFn: async () => {
      const res = await getRemoteConfigSyncStatus("vendors" satisfies SyncKey);
      if (!res.ok) {
        throw new Error(res.error);
      }
      return res.data;
    },
    retry: false,
  });

  const handleSync = () => {
    startTransition(async () => {
      const res = await syncVendorsFromRemote();
      if (!res.ok) {
        toast.error(t("errors.syncFailed", { error: res.error }));
        await queryClient.invalidateQueries({ queryKey: ["remote-config-sync", "vendors"] });
        return;
      }
      toast.success(t("messages.syncSuccess"), {
        description: `vendors +${res.data.vendors.inserted} / ~${res.data.vendors.updated}`,
      });
      await queryClient.invalidateQueries({ queryKey: ["vendors"] });
      await queryClient.invalidateQueries({ queryKey: ["remote-config-sync", "vendors"] });
      router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
        <div className="space-y-1">
          <div className="text-sm font-medium">vendors</div>
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
              queryClient.invalidateQueries({ queryKey: ["remote-config-sync", "vendors"] })
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
      <p className="text-xs text-muted-foreground">{t("tips.managedNote")}</p>
    </div>
  );
}

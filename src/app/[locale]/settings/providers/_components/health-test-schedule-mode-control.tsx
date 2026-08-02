"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  fetchSystemSettings,
  saveSystemSettings,
} from "@/lib/api-client/v1/actions/system-config";
import { cn } from "@/lib/utils";
import type { HealthTestScheduleMode } from "@/types/system-config";

const MODES: HealthTestScheduleMode[] = ["dynamic", "always_on"];
const SCHEDULE_QUERY_KEY = ["system-settings-health-schedule"] as const;

function extractErrorMessage(res: { ok: false } & Record<string, unknown>): string {
  if (typeof res.error === "string" && res.error.trim()) return res.error;
  if (typeof res.detail === "string" && res.detail.trim()) return res.detail;
  const params = res.invalidParams;
  if (Array.isArray(params) && params.length > 0) {
    return params
      .map((p) => {
        if (p && typeof p === "object") {
          const o = p as { path?: string; message?: string };
          return `${o.path || "field"}: ${o.message || "invalid"}`;
        }
        return String(p);
      })
      .join("; ");
  }
  return "save failed";
}

function isScheduleMode(value: unknown): value is HealthTestScheduleMode {
  return value === "dynamic" || value === "always_on";
}

export function HealthTestScheduleModeControl({ className }: { className?: string }) {
  const t = useTranslations("settings.providers.list");
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<HealthTestScheduleMode>("dynamic");
  const pendingModeRef = useRef<HealthTestScheduleMode | null>(null);
  const saveGenRef = useRef(0);

  const { data, isLoading } = useQuery({
    queryKey: SCHEDULE_QUERY_KEY,
    queryFn: async () => {
      const res = await fetchSystemSettings();
      if (!res.ok) {
        throw new Error(extractErrorMessage(res as { ok: false } & Record<string, unknown>));
      }
      return res.data;
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!data) return;
    if (pendingModeRef.current) return;
    if (isScheduleMode(data.healthTestScheduleMode)) {
      setMode(data.healthTestScheduleMode);
    }
  }, [data]);

  const mutation = useMutation({
    mutationFn: async (payload: { healthTestScheduleMode: HealthTestScheduleMode; _gen: number }) => {
      const res = await saveSystemSettings({
        healthTestScheduleMode: payload.healthTestScheduleMode,
      });
      if (!res.ok) {
        throw new Error(extractErrorMessage(res as { ok: false } & Record<string, unknown>));
      }
      return { data: res.data, gen: payload._gen };
    },
    onMutate: async (payload) => {
      pendingModeRef.current = payload.healthTestScheduleMode;
      setMode(payload.healthTestScheduleMode);
      void queryClient.cancelQueries({ queryKey: SCHEDULE_QUERY_KEY });
      const previous = queryClient.getQueryData(SCHEDULE_QUERY_KEY);
      queryClient.setQueryData(SCHEDULE_QUERY_KEY, (old: Record<string, unknown> | undefined) => {
        if (!old || typeof old !== "object") return old;
        return {
          ...old,
          healthTestScheduleMode: payload.healthTestScheduleMode,
        };
      });
      return { previous, gen: payload._gen };
    },
    onSuccess: (result) => {
      if (result.gen !== saveGenRef.current) return;
      pendingModeRef.current = null;
      toast.success(t("healthScheduleModeSaved"));
      const next = result.data;
      if (next && isScheduleMode(next.healthTestScheduleMode)) {
        setMode(next.healthTestScheduleMode);
      }
      if (next) {
        queryClient.setQueryData(SCHEDULE_QUERY_KEY, (old: Record<string, unknown> | undefined) => ({
          ...(old && typeof old === "object" ? old : {}),
          ...next,
        }));
      }
      // Do NOT invalidate the full providers list — freezes the page.
    },
    onError: (err: Error, payload, context) => {
      if (payload._gen !== saveGenRef.current) return;
      pendingModeRef.current = null;
      if (context && typeof context === "object" && "previous" in context && context.previous) {
        queryClient.setQueryData(SCHEDULE_QUERY_KEY, context.previous);
      }
      const prev = data?.healthTestScheduleMode;
      if (isScheduleMode(prev)) setMode(prev);
      toast.error(t("healthScheduleModeSaveFailed"), { description: err.message });
    },
  });

  const modeLabel = (m: HealthTestScheduleMode) => {
    switch (m) {
      case "dynamic":
        return t("healthScheduleModeDynamic");
      case "always_on":
        return t("healthScheduleModeAlwaysOn");
    }
  };

  const selectMode = (m: HealthTestScheduleMode) => {
    if (m === mode && pendingModeRef.current == null) return;
    const gen = ++saveGenRef.current;
    mutation.mutate({ healthTestScheduleMode: m, _gen: gen });
  };

  return (
    <div
      className={cn(
        "flex h-full min-h-[8.5rem] flex-col gap-2.5 rounded-xl border border-border/60 bg-card/40 px-3.5 py-3 shadow-[0_1px_0_rgba(0,0,0,0.02)]",
        className
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold tracking-tight text-foreground">
          <Activity className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          {t("healthScheduleModeTitle")}
        </span>
        {mutation.isPending || isLoading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden />
        ) : null}
      </div>

      <div
        className="grid grid-cols-2 rounded-lg border border-border/50 bg-background/80 p-1"
        role="tablist"
        aria-label={t("healthScheduleModeTitle")}
      >
        {MODES.map((m) => {
          const active = mode === m;
          return (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => selectMode(m)}
              className={cn(
                "h-8 px-2 text-[12px] font-medium rounded-md transition-colors truncate",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                active
                  ? "bg-foreground text-background shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
              title={modeLabel(m)}
            >
              {modeLabel(m)}
            </button>
          );
        })}
      </div>

      <p className="min-h-[2.25rem] text-[11px] leading-relaxed text-muted-foreground">
        {mode === "dynamic" ? t("healthScheduleModeDynamicHelp") : t("healthScheduleModeAlwaysOnHelp")}
      </p>
    </div>
  );
}

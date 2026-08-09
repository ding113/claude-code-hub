"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { fetchSystemSettings, saveSystemSettings } from "@/lib/api-client/v1/actions/system-config";
import { cn } from "@/lib/utils";

type HealthRuntimeDraft = {
  windowSize: number;
  intervalSeconds: number;
  timeoutSeconds: number;
  minOnlineRatePercent: number;
  maxAvgFirstByteSeconds: number;
};

const DEFAULTS: HealthRuntimeDraft = {
  windowSize: 10,
  intervalSeconds: 60,
  timeoutSeconds: 30,
  minOnlineRatePercent: 90,
  maxAvgFirstByteSeconds: 20,
};

const RUNTIME_QUERY_KEY = ["system-settings-health-runtime"] as const;

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function extractErrorMessage(res: { ok: false } & Record<string, unknown>): string {
  if (typeof res.error === "string" && res.error.trim()) return res.error;
  if (typeof res.detail === "string" && res.detail.trim()) return res.detail;
  return "save failed";
}

function Field({
  label,
  unit,
  value,
  min,
  max,
  step,
  onChange,
  onCommit,
  accent,
}: {
  label: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  onCommit: () => void;
  accent?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-[3.25rem] min-w-0 items-center justify-between gap-3 rounded-xl border border-border/50 bg-background/90 px-3.5 py-2.5 shadow-sm",
        "transition-colors hover:border-border"
      )}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          className={cn("h-8 w-1 shrink-0 rounded-full", accent ?? "bg-primary/50")}
          aria-hidden
        />
        <div className="min-w-0">
          <div className="text-[12px] font-medium leading-tight text-foreground/90">{label}</div>
          <div className="mt-0.5 text-[10px] text-muted-foreground">{unit}</div>
        </div>
      </div>
      <Input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        className={cn(
          "h-9 w-[5.5rem] shrink-0 rounded-lg border-border/60 bg-muted/30 px-2 text-right text-base font-semibold tabular-nums shadow-none",
          "focus-visible:ring-1 focus-visible:ring-primary/30"
        )}
        onChange={(e) => onChange(clamp(Number(e.target.value), min, max))}
        onBlur={onCommit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
    </div>
  );
}

export function HealthTestRuntimeConfigControl({ className }: { className?: string }) {
  const t = useTranslations("settings.providers.list");
  const queryClient = useQueryClient();
  const saveGenRef = useRef(0);
  const [draft, setDraft] = useState<HealthRuntimeDraft>(DEFAULTS);
  const [dirty, setDirty] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: RUNTIME_QUERY_KEY,
    queryFn: async () => {
      const res = await fetchSystemSettings();
      if (!res.ok) {
        throw new Error(extractErrorMessage(res as { ok: false } & Record<string, unknown>));
      }
      return res.data;
    },
    staleTime: 15_000,
    refetchInterval: 60_000,
  });

  useEffect(() => {
    if (!data || dirty) return;
    setDraft({
      windowSize: clamp(Number(data.healthTestWindowSize ?? 10), 1, 50),
      intervalSeconds: clamp(Number(data.healthTestIntervalSeconds ?? 1800), 10, 3600),
      timeoutSeconds: clamp(Number(data.healthTestTimeoutSeconds ?? 30), 5, 300),
      minOnlineRatePercent: clamp(Number(data.healthTestMinOnlineRatePercent ?? 90), 1, 100),
      maxAvgFirstByteSeconds: clamp(Number(data.healthTestMaxAvgLatencySeconds ?? 20), 1, 300),
    });
  }, [data, dirty]);

  const mutation = useMutation({
    mutationFn: async (next: HealthRuntimeDraft) => {
      const payload = {
        healthTestWindowSize: clamp(next.windowSize, 1, 50),
        healthTestIntervalSeconds: clamp(next.intervalSeconds, 10, 3600),
        healthTestTimeoutSeconds: clamp(next.timeoutSeconds, 5, 300),
        healthTestMinOnlineRatePercent: clamp(next.minOnlineRatePercent, 1, 100),
        healthTestMaxAvgLatencySeconds: clamp(next.maxAvgFirstByteSeconds, 1, 300),
      };
      const res = await saveSystemSettings(payload);
      if (!res.ok) {
        throw new Error(extractErrorMessage(res as { ok: false } & Record<string, unknown>));
      }
      return payload;
    },
  });

  const commit = (next: HealthRuntimeDraft) => {
    const gen = ++saveGenRef.current;
    const normalized: HealthRuntimeDraft = {
      windowSize: clamp(next.windowSize, 1, 50),
      intervalSeconds: clamp(next.intervalSeconds, 10, 3600),
      timeoutSeconds: clamp(next.timeoutSeconds, 5, 300),
      minOnlineRatePercent: clamp(next.minOnlineRatePercent, 1, 100),
      maxAvgFirstByteSeconds: clamp(next.maxAvgFirstByteSeconds, 1, 300),
    };
    setDraft(normalized);
    setDirty(true);
    queryClient.setQueryData(RUNTIME_QUERY_KEY, (old: unknown) => {
      if (!old || typeof old !== "object") return old;
      return {
        ...(old as Record<string, unknown>),
        healthTestWindowSize: normalized.windowSize,
        healthTestIntervalSeconds: normalized.intervalSeconds,
        healthTestTimeoutSeconds: normalized.timeoutSeconds,
        healthTestMinOnlineRatePercent: normalized.minOnlineRatePercent,
        healthTestMaxAvgLatencySeconds: normalized.maxAvgFirstByteSeconds,
      };
    });
    mutation.mutate(normalized, {
      onSuccess: () => {
        if (gen !== saveGenRef.current) return;
        toast.success(t("healthRuntimeSaved"));
        setDirty(false);
      },
      onError: (err: Error) => {
        if (gen !== saveGenRef.current) return;
        toast.error(t("healthRuntimeSaveFailed"), { description: err.message });
      },
    });
  };

  return (
    <div
      className={cn(
        "flex h-full min-w-0 flex-col gap-3 rounded-2xl border border-border/60 bg-gradient-to-b from-card/90 to-muted/15 px-4 py-3.5 shadow-[0_1px_0_rgba(0,0,0,0.03)]",
        className
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold tracking-tight text-foreground">
            {t("healthRuntimeTitle")}
          </div>
          <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
            {t("healthRuntimeSubtitle")}
          </div>
        </div>
        {mutation.isPending || isLoading ? (
          <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
        ) : (
          <span className="shrink-0 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
            {t("healthRuntimeLive")}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
        <Field
          label={t("healthRuntimeWindow")}
          unit={t("healthRuntimeWindowUnit")}
          value={draft.windowSize}
          min={1}
          max={50}
          step={1}
          accent="bg-sky-500"
          onChange={(v) => {
            setDraft((d) => ({ ...d, windowSize: v }));
            setDirty(true);
          }}
          onCommit={() => commit(draft)}
        />
        <Field
          label={t("healthRuntimeInterval")}
          unit={t("healthRuntimeIntervalUnit")}
          value={draft.intervalSeconds}
          min={10}
          max={3600}
          step={5}
          accent="bg-violet-500"
          onChange={(v) => {
            setDraft((d) => ({ ...d, intervalSeconds: v }));
            setDirty(true);
          }}
          onCommit={() => commit(draft)}
        />
        <Field
          label={t("healthRuntimeTimeout")}
          unit={t("healthRuntimeTimeoutUnit")}
          value={draft.timeoutSeconds}
          min={5}
          max={300}
          step={1}
          accent="bg-amber-500"
          onChange={(v) => {
            setDraft((d) => ({ ...d, timeoutSeconds: v }));
            setDirty(true);
          }}
          onCommit={() => commit(draft)}
        />
        <Field
          label={t("healthRuntimeMinOnline")}
          unit={t("healthRuntimeMinOnlineUnit")}
          value={draft.minOnlineRatePercent}
          min={1}
          max={100}
          step={1}
          accent="bg-emerald-500"
          onChange={(v) => {
            setDraft((d) => ({ ...d, minOnlineRatePercent: v }));
            setDirty(true);
          }}
          onCommit={() => commit(draft)}
        />
        <Field
          label={t("healthRuntimeMaxFirstByte")}
          unit={t("healthRuntimeMaxFirstByteUnit")}
          value={draft.maxAvgFirstByteSeconds}
          min={1}
          max={300}
          step={1}
          accent="bg-rose-500"
          onChange={(v) => {
            setDraft((d) => ({ ...d, maxAvgFirstByteSeconds: v }));
            setDirty(true);
          }}
          onCommit={() => commit(draft)}
        />
      </div>

      <p className="rounded-lg bg-muted/30 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
        {t("healthRuntimeSloHint", {
          online: draft.minOnlineRatePercent,
          firstByte: draft.maxAvgFirstByteSeconds,
        })}
      </p>
    </div>
  );
}

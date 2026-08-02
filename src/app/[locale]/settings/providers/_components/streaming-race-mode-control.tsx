"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Gauge, Loader2, Zap } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import {
  fetchSystemSettings,
  saveSystemSettings,
} from "@/lib/api-client/v1/actions/system-config";
import { cn } from "@/lib/utils";
import type { StreamingRaceMode } from "@/types/system-config";

const MODES: StreamingRaceMode[] = ["single", "timeout_race", "dual_fast"];
const RACE_QUERY_KEY = ["system-settings-race"] as const;

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

function isRaceMode(value: unknown): value is StreamingRaceMode {
  return value === "single" || value === "timeout_race" || value === "dual_fast";
}

export function StreamingRaceModeControl({ className }: { className?: string }) {
  const t = useTranslations("settings.providers.list");
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<StreamingRaceMode>("single");
  const [firstByteMs, setFirstByteMs] = useState(20000);
  const [draftSec, setDraftSec] = useState("20");
  const pendingModeRef = useRef<StreamingRaceMode | null>(null);
  // Latest-write-wins: rapid segment clicks must not wait for prior saves.
  const saveGenRef = useRef(0);

  const { data, isLoading } = useQuery({
    queryKey: RACE_QUERY_KEY,
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
    if (isRaceMode(data.streamingRaceMode)) {
      setMode(data.streamingRaceMode);
    }
    const raw = data.streamingRaceFirstByteMs;
    const ms =
      typeof raw === "number" && Number.isFinite(raw) && raw >= 0
        ? Math.trunc(raw)
        : data.streamingRaceMode === "single"
          ? 0
          : 20000;
    setFirstByteMs(ms);
    setDraftSec(String(Math.max(0, Math.round(ms / 1000))));
  }, [data]);

  const mutation = useMutation({
    mutationFn: async (payload: {
      streamingRaceMode?: StreamingRaceMode;
      streamingRaceFirstByteMs?: number;
      _gen: number;
    }) => {
      const { _gen, ...body } = payload;
      const res = await saveSystemSettings(body);
      if (!res.ok) {
        throw new Error(extractErrorMessage(res as { ok: false } & Record<string, unknown>));
      }
      return { data: res.data, gen: _gen, body };
    },
    onMutate: async (payload) => {
      if (payload.streamingRaceMode) {
        pendingModeRef.current = payload.streamingRaceMode;
        setMode(payload.streamingRaceMode);
      }
      if (typeof payload.streamingRaceFirstByteMs === "number") {
        setFirstByteMs(payload.streamingRaceFirstByteMs);
        setDraftSec(String(Math.max(0, Math.round(payload.streamingRaceFirstByteMs / 1000))));
      } else if (payload.streamingRaceMode === "single") {
        setFirstByteMs(0);
        setDraftSec("0");
      }

      // Do not await cancel — keeps the segment flip instant.
      void queryClient.cancelQueries({ queryKey: RACE_QUERY_KEY });
      const previous = queryClient.getQueryData(RACE_QUERY_KEY);
      queryClient.setQueryData(RACE_QUERY_KEY, (old: Record<string, unknown> | undefined) => {
        if (!old || typeof old !== "object") return old;
        const nextFb =
          typeof payload.streamingRaceFirstByteMs === "number"
            ? payload.streamingRaceFirstByteMs
            : payload.streamingRaceMode === "single"
              ? 0
              : undefined;
        return {
          ...old,
          ...(payload.streamingRaceMode ? { streamingRaceMode: payload.streamingRaceMode } : {}),
          ...(nextFb !== undefined ? { streamingRaceFirstByteMs: nextFb } : {}),
        };
      });
      return { previous, gen: payload._gen };
    },
    onSuccess: (result) => {
      // Ignore stale responses when user already clicked another mode.
      if (result.gen !== saveGenRef.current) return;
      pendingModeRef.current = null;
      toast.success(t("raceModeSaved"));
      const next = result.data;
      if (!next) return;
      if (isRaceMode(next.streamingRaceMode)) {
        setMode(next.streamingRaceMode);
      }
      if (typeof next.streamingRaceFirstByteMs === "number") {
        setFirstByteMs(next.streamingRaceFirstByteMs);
        setDraftSec(String(Math.max(0, Math.round(next.streamingRaceFirstByteMs / 1000))));
      } else if (next.streamingRaceMode === "single") {
        setFirstByteMs(0);
        setDraftSec("0");
      }
      // Patch only race fields — avoid replacing the whole settings object unnecessarily.
      queryClient.setQueryData(RACE_QUERY_KEY, (old: Record<string, unknown> | undefined) => ({
        ...(old && typeof old === "object" ? old : {}),
        ...next,
      }));
    },
    onError: (err: Error, payload, context) => {
      if (payload._gen !== saveGenRef.current) return;
      pendingModeRef.current = null;
      if (context && typeof context === "object" && "previous" in context && context.previous) {
        queryClient.setQueryData(RACE_QUERY_KEY, context.previous);
      }
      const prevMode = data?.streamingRaceMode;
      if (isRaceMode(prevMode)) setMode(prevMode);
      if (typeof data?.streamingRaceFirstByteMs === "number") {
        setFirstByteMs(data.streamingRaceFirstByteMs);
        setDraftSec(String(Math.round(data.streamingRaceFirstByteMs / 1000)));
      }
      toast.error(t("raceModeSaveFailed"), { description: err.message });
    },
  });

  const modeLabel = (m: StreamingRaceMode) => {
    switch (m) {
      case "single":
        return t("raceModeSingle");
      case "timeout_race":
        return t("raceModeTimeout");
      case "dual_fast":
        return t("raceModeDualFast");
    }
  };

  const showThreshold = mode === "timeout_race";
  const secValue = Math.round(firstByteMs / 1000);

  const commitSeconds = () => {
    const sec = Number.parseInt(draftSec, 10);
    if (!Number.isFinite(sec) || sec < 1) {
      setDraftSec(String(secValue));
      toast.error(t("raceFirstByteInvalid"));
      return;
    }
    const clampedSec = Math.min(180, Math.max(1, sec));
    const ms = clampedSec * 1000;
    setDraftSec(String(clampedSec));
    if (ms !== firstByteMs) {
      const gen = ++saveGenRef.current;
      mutation.mutate({ streamingRaceFirstByteMs: ms, _gen: gen });
    }
  };

  const selectMode = (m: StreamingRaceMode) => {
    if (m === mode && pendingModeRef.current == null) return;
    const gen = ++saveGenRef.current;
    if (m === "single") {
      mutation.mutate({ streamingRaceMode: m, streamingRaceFirstByteMs: 0, _gen: gen });
    } else {
      mutation.mutate({ streamingRaceMode: m, _gen: gen });
    }
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
          <Zap className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          {t("raceModeTitle")}
        </span>
        {mutation.isPending || isLoading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden />
        ) : null}
      </div>

      <div
        className="grid grid-cols-3 rounded-lg border border-border/50 bg-background/80 p-1"
        role="tablist"
        aria-label={t("raceModeTitle")}
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
                "h-8 px-1.5 text-[12px] font-medium rounded-md transition-colors truncate",
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

      <div className="flex min-h-[2.5rem] items-center justify-between gap-2 rounded-lg border border-border/50 bg-background/70 px-2.5 py-2">
        {showThreshold ? (
          <>
            <span className="inline-flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
              <Gauge className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="truncate">{t("raceFirstByteLabel")}</span>
            </span>
            <div className="inline-flex shrink-0 items-center gap-1.5">
              <Input
                id="race-first-byte-ms"
                type="number"
                min={1}
                max={180}
                step={1}
                className="h-8 w-14 px-2 text-center font-mono text-xs tabular-nums"
                value={draftSec}
                onChange={(e) => setDraftSec(e.target.value)}
                onBlur={commitSeconds}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.currentTarget.blur();
                  }
                }}
                aria-label={t("raceFirstByteLabel")}
              />
              <span className="w-3 text-[11px] text-muted-foreground">s</span>
            </div>
          </>
        ) : (
          <span className="truncate text-[11px] text-muted-foreground/80">
            {mode === "dual_fast" ? t("raceThresholdNotUsedDual") : t("raceThresholdNotUsedSingle")}
          </span>
        )}
      </div>

      <p className="min-h-[2.25rem] text-[11px] leading-relaxed text-muted-foreground">
        {mode === "single"
          ? t("raceModeSingleHelp")
          : mode === "timeout_race"
            ? t("raceModeTimeoutHelp")
            : t("raceModeDualFastHelp")}
      </p>
    </div>
  );
}

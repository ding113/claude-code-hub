"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Gauge, Loader2 } from "lucide-react";
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
  const [firstByteMs, setFirstByteMs] = useState(20000);
  const [draftSec, setDraftSec] = useState("20");
  const [idleMs, setIdleMs] = useState(0);
  const [draftIdleSec, setDraftIdleSec] = useState("0");
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
    const raw = data.streamingRaceFirstByteMs;
    const ms =
      typeof raw === "number" && Number.isFinite(raw) && raw >= 0
        ? Math.trunc(raw)
        : isRaceMode(data.streamingRaceMode) && data.streamingRaceMode !== "single"
          ? 20000
          : 0;
    setFirstByteMs(ms);
    setDraftSec(String(Math.max(0, Math.round(ms / 1000))));
    const rawIdle = data.streamingIdleTimeoutMs;
    const idle =
      typeof rawIdle === "number" && Number.isFinite(rawIdle) && rawIdle >= 0
        ? Math.trunc(rawIdle)
        : 0;
    setIdleMs(idle);
    setDraftIdleSec(String(Math.max(0, Math.round(idle / 1000))));
  }, [data]);

  const mutation = useMutation({
    mutationFn: async (payload: {
      streamingRaceMode?: StreamingRaceMode;
      streamingRaceFirstByteMs?: number;
      streamingIdleTimeoutMs?: number;
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
      if (typeof payload.streamingRaceFirstByteMs === "number") {
        setFirstByteMs(payload.streamingRaceFirstByteMs);
        setDraftSec(String(Math.max(0, Math.round(payload.streamingRaceFirstByteMs / 1000))));
      }
      if (typeof payload.streamingIdleTimeoutMs === "number") {
        setIdleMs(payload.streamingIdleTimeoutMs);
        setDraftIdleSec(String(Math.max(0, Math.round(payload.streamingIdleTimeoutMs / 1000))));
      }
      void queryClient.cancelQueries({ queryKey: RACE_QUERY_KEY });
      const previous = queryClient.getQueryData(RACE_QUERY_KEY);
      queryClient.setQueryData(RACE_QUERY_KEY, (old: Record<string, unknown> | undefined) => {
        if (!old || typeof old !== "object") return old;
        return {
          ...old,
          ...(payload.streamingRaceMode ? { streamingRaceMode: payload.streamingRaceMode } : {}),
          ...(typeof payload.streamingRaceFirstByteMs === "number"
            ? { streamingRaceFirstByteMs: payload.streamingRaceFirstByteMs }
            : {}),
          ...(typeof payload.streamingIdleTimeoutMs === "number"
            ? { streamingIdleTimeoutMs: payload.streamingIdleTimeoutMs }
            : {}),
        };
      });
      return { previous, gen: payload._gen };
    },
    onSuccess: (result) => {
      if (result.gen !== saveGenRef.current) return;
      toast.success(t("raceModeSaved"));
      const next = result.data;
      if (!next) return;
      if (typeof next.streamingRaceFirstByteMs === "number") {
        setFirstByteMs(next.streamingRaceFirstByteMs);
        setDraftSec(String(Math.max(0, Math.round(next.streamingRaceFirstByteMs / 1000))));
      }
      if (typeof next.streamingIdleTimeoutMs === "number") {
        setIdleMs(next.streamingIdleTimeoutMs);
        setDraftIdleSec(String(Math.max(0, Math.round(next.streamingIdleTimeoutMs / 1000))));
      }
      queryClient.setQueryData(RACE_QUERY_KEY, (old: Record<string, unknown> | undefined) => ({
        ...(old && typeof old === "object" ? old : {}),
        ...next,
      }));
    },
    onError: (err: Error, payload, context) => {
      if (payload._gen !== saveGenRef.current) return;
      if (context && typeof context === "object" && "previous" in context && context.previous) {
        queryClient.setQueryData(RACE_QUERY_KEY, context.previous);
      }
      if (typeof data?.streamingRaceFirstByteMs === "number") {
        setFirstByteMs(data.streamingRaceFirstByteMs);
        setDraftSec(String(Math.round(data.streamingRaceFirstByteMs / 1000)));
      }
      if (typeof data?.streamingIdleTimeoutMs === "number") {
        setIdleMs(data.streamingIdleTimeoutMs);
        setDraftIdleSec(String(Math.round(data.streamingIdleTimeoutMs / 1000)));
      }
      toast.error(t("raceModeSaveFailed"), { description: err.message });
    },
  });

  const secValue = Math.round(firstByteMs / 1000);

  const commitSeconds = () => {
    const sec = Number.parseInt(draftSec, 10);
    if (!Number.isFinite(sec) || sec < 0) {
      setDraftSec(String(secValue));
      toast.error(t("raceFirstByteInvalid"));
      return;
    }
    const clampedSec = Math.min(180, Math.max(0, sec));
    const ms = clampedSec * 1000;
    setDraftSec(String(clampedSec));
    if (ms !== firstByteMs) {
      const gen = ++saveGenRef.current;
      // 0 = 禁用（单路）；>0 = 启用超时接力（含冷启动双发）。
      mutation.mutate({
        streamingRaceMode: clampedSec > 0 ? "timeout_race" : "single",
        streamingRaceFirstByteMs: ms,
        _gen: gen,
      });
    }
  };

  const idleSecValue = Math.round(idleMs / 1000);

  const commitIdleSeconds = () => {
    const sec = Number.parseInt(draftIdleSec, 10);
    if (!Number.isFinite(sec) || sec < 0) {
      setDraftIdleSec(String(idleSecValue));
      toast.error(t("raceIdleInvalid"));
      return;
    }
    const clampedSec = Math.min(600, Math.max(0, sec));
    const ms = clampedSec * 1000;
    setDraftIdleSec(String(clampedSec));
    if (ms !== idleMs) {
      const gen = ++saveGenRef.current;
      // 0 = 禁用流式静默 watchdog；>0 = 首字节后无新数据超时上限（秒）。
      mutation.mutate({
        streamingIdleTimeoutMs: ms,
        _gen: gen,
      });
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
          <Gauge className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          {t("raceModeTitle")}
        </span>
        {mutation.isPending || isLoading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden />
        ) : null}
      </div>

      <div className="flex min-h-[2.5rem] items-center justify-between gap-2 rounded-lg border border-border/50 bg-background/70 px-2.5 py-2">
        <span className="inline-flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="truncate">{t("raceFirstByteLabel")}</span>
        </span>
        <div className="inline-flex shrink-0 items-center gap-1.5">
          <Input
            id="race-first-byte-ms"
            type="number"
            min={0}
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
      </div>

      <div className="flex min-h-[2.5rem] items-center justify-between gap-2 rounded-lg border border-border/50 bg-background/70 px-2.5 py-2">
        <span className="inline-flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="truncate">{t("raceIdleLabel")}</span>
        </span>
        <div className="inline-flex shrink-0 items-center gap-1.5">
          <Input
            id="race-idle-timeout-ms"
            type="number"
            min={0}
            max={600}
            step={1}
            className="h-8 w-14 px-2 text-center font-mono text-xs tabular-nums"
            value={draftIdleSec}
            onChange={(e) => setDraftIdleSec(e.target.value)}
            onBlur={commitIdleSeconds}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.currentTarget.blur();
              }
            }}
            aria-label={t("raceIdleLabel")}
          />
          <span className="w-3 text-[11px] text-muted-foreground">s</span>
        </div>
      </div>

      <p className="min-h-[2.25rem] text-[11px] leading-relaxed text-muted-foreground">
        {t("raceModeSingleThresholdHelp")}
      </p>
      <p className="min-h-[2.25rem] text-[11px] leading-relaxed text-muted-foreground">
        {t("raceIdleHelp")}
      </p>
    </div>
  );
}

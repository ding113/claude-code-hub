"use client";

import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Loader2,
  RefreshCw,
  Search,
  Terminal,
  XCircle,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { testProviderById } from "@/lib/api-client/v1/actions/providers";
import { fetchProviderSiteGroupUpstreamModels } from "@/actions/provider-sites";
import type { ProviderDisplay } from "@/types/provider";

interface SiteGroupTestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: ProviderDisplay | null;
  rateId: number;
  siteName: string;
  groupName: string;
  /** Initial models pre-selected from the group's health-test model list. */
  initialModels?: string[];
  onTested?: () => void;
}

type LogKind = "cmd" | "muted" | "ok" | "info" | "label" | "output" | "err";

interface LogLine {
  kind: LogKind;
  text: string;
}

const LOG_STYLE: Record<LogKind, string> = {
  cmd: "text-sky-300",
  muted: "text-zinc-500",
  ok: "text-emerald-400",
  info: "text-cyan-300",
  label: "text-yellow-300",
  output: "text-emerald-200",
  err: "text-rose-400",
};

const STAGE_DELAY_MS = 220;
const TYPE_CHUNK_MS = 14;
const TYPE_CHUNK_CHARS = 2;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function providerTypeLabel(providerType: string | null | undefined): string {
  return providerType ?? "unknown";
}

export function SiteGroupTestDialog({
  open,
  onOpenChange,
  provider,
  rateId,
  siteName,
  groupName,
  initialModels = [],
  onTested,
}: SiteGroupTestDialogProps) {
  const t = useTranslations("settings.providers.providerSites");
  const [models, setModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsFailedCount, setModelsFailedCount] = useState(0);
  const [modelQuery, setModelQuery] = useState("");
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [modelPopoverOpen, setModelPopoverOpen] = useState(false);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [done, setDone] = useState<"success" | "error" | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logSeqRef = useRef(0);

  const filteredModels = useMemo(() => {
    const q = modelQuery.trim().toLowerCase();
    if (!q) return models;
    return models.filter((m) => m.toLowerCase().includes(q));
  }, [models, modelQuery]);

  const reset = useCallback(() => {
    setLogs([]);
    setDone(null);
    setIsRunning(false);
    logSeqRef.current = 0;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      reset();
      setModels([]);
      setModelsFailedCount(0);
      setSelectedModel(initialModels[0] ?? null);
    }
    wasOpenRef.current = open;
  }, [open, initialModels, reset]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const pushLog = useCallback((line: LogLine) => {
    logSeqRef.current += 1;
    setLogs((prev) => [...prev, line]);
  }, []);

  const typeText = useCallback(
    async (text: string) => {
      return new Promise<void>((resolve) => {
        let idx = 0;
        timerRef.current = setInterval(() => {
          idx += TYPE_CHUNK_CHARS;
          const slice = text.slice(0, idx);
          setLogs((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last && last.kind === "output" && last.text.startsWith(text.slice(0, 2))) {
              next[next.length - 1] = { ...last, text: slice };
            } else {
              next.push({ kind: "output", text: slice });
            }
            return next;
          });
          if (idx >= text.length) {
            if (timerRef.current) clearInterval(timerRef.current);
            timerRef.current = null;
            setLogs((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last && last.kind === "output") {
                next[next.length - 1] = { ...last, text };
              }
              return next;
            });
            resolve();
          }
        }, TYPE_CHUNK_MS);
      });
    },
    []
  );

  const fetchModels = useCallback(async () => {
    if (!provider) return;
    setModelsLoading(true);
    setModelsFailedCount(0);
    try {
      const res = await fetchProviderSiteGroupUpstreamModels(rateId);
      if (res.ok) {
        setModels(res.data.models);
        setModelsFailedCount(res.data.failed.length);
        if (res.data.models.length > 0 && !selectedModel) {
          setSelectedModel(res.data.models[0]);
        }
      } else {
        toast.error(res.error ?? t("fetchSiteGroupModelsFailed"));
      }
    } catch {
      toast.error(t("fetchSiteGroupModelsFailed"));
    } finally {
      setModelsLoading(false);
    }
  }, [provider, rateId, selectedModel, t]);

  useEffect(() => {
    if (open && models.length === 0 && !modelsLoading) {
      void fetchModels();
    }
  }, [open, models.length, modelsLoading, fetchModels]);

  const runTest = useCallback(async () => {
    if (!provider || isRunning) return;
    const model = selectedModel?.trim() || undefined;
    reset();
    setIsRunning(true);

    pushLog({ kind: "cmd", text: `${t("testLogStart")}: ${provider.name}` });
    await sleep(STAGE_DELAY_MS);
    pushLog({ kind: "muted", text: `${t("testLogType")}: ${providerTypeLabel(provider.providerType)}` });
    await sleep(STAGE_DELAY_MS);
    pushLog({ kind: "ok", text: t("testLogConnected") });
    await sleep(STAGE_DELAY_MS);
    pushLog({ kind: "info", text: `${t("testLogModel")}: ${model || t("testLogDefaultModel")}` });
    await sleep(STAGE_DELAY_MS);
    pushLog({ kind: "muted", text: `${t("testLogSend")}: "hi"` });
    await sleep(STAGE_DELAY_MS);
    pushLog({ kind: "label", text: `${t("testLogResponse")}:` });
    await sleep(STAGE_DELAY_MS);

    try {
      const result = await testProviderById(provider.id, model ? { model } : undefined);
      if (result.ok && result.data) {
        const data = result.data as {
          content?: string;
          latencyMs?: number;
          firstByteMs?: number;
          usage?: {
            inputTokens?: number;
            outputTokens?: number;
          };
          errorMessage?: string;
          httpStatusCode?: number;
        };
        const content = (data.content ?? "").trim();
        if (content) {
          await typeText(content);
        } else if (data.errorMessage) {
          pushLog({ kind: "err", text: data.errorMessage });
        } else {
          pushLog({ kind: "muted", text: t("testLogEmpty") });
        }
        await sleep(STAGE_DELAY_MS);
        const metaBits: string[] = [];
        if (data.firstByteMs != null) metaBits.push(`${t("testLogFirstByte")} ${data.firstByteMs}ms`);
        if (data.latencyMs != null) metaBits.push(`${t("testLogLatency")} ${data.latencyMs}ms`);
        if (data.usage) {
          metaBits.push(
            `${t("testLogTokens")}: ${data.usage.inputTokens ?? 0}↑ / ${data.usage.outputTokens ?? 0}↓`
          );
        }
        if (metaBits.length > 0) {
          pushLog({ kind: "muted", text: metaBits.join(" · ") });
        }
        setDone("success");
        pushLog({ kind: "ok", text: t("testLogDone") });
      } else {
        const errText = (result as { error?: string }).error ?? t("testLogFailed");
        pushLog({ kind: "err", text: errText });
        setDone("error");
        pushLog({ kind: "err", text: t("testLogFailed") });
      }
    } catch (error) {
      pushLog({
        kind: "err",
        text: error instanceof Error ? error.message : t("testLogFailed"),
      });
      setDone("error");
      pushLog({ kind: "err", text: t("testLogFailed") });
    } finally {
      setIsRunning(false);
      onTested?.();
    }
  }, [isRunning, onTested, provider, pushLog, reset, selectedModel, sleep, t, typeText]);

  const terminalRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = terminalRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onOpenChange(false)}>
      <DialogContent className="max-h-[86vh] max-w-2xl overflow-hidden p-0">
        <DialogHeader className="border-b bg-gradient-to-br from-muted/45 via-card to-card px-6 py-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/15 bg-primary/10 text-primary">
              <Terminal className="h-4.5 w-4.5" />
            </span>
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate pr-6 text-base">
                {t("testDialogTitle")} · {provider?.name ?? "—"}
              </DialogTitle>
              <DialogDescription className="mt-1 truncate">
                {siteName} · {groupName} · {providerTypeLabel(provider?.providerType)}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-3 p-5 sm:p-6">
          {/* Model picker: fetch models + point-select */}
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium">{t("testModelLabel")}</p>
            <div className="flex items-center gap-2">
              <Popover open={modelPopoverOpen} onOpenChange={setModelPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 max-w-72 justify-between gap-2 px-2.5 text-xs"
                    disabled={modelsLoading}
                  >
                    <span className="truncate font-mono">
                      {selectedModel || t("testModelPlaceholder")}
                    </span>
                    {modelsLoading ? (
                      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-80">
                  <div className="space-y-2">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={modelQuery}
                        onChange={(e) => setModelQuery(e.target.value)}
                        placeholder={t("testModelSearch")}
                        className="h-8 pl-8 text-xs"
                      />
                    </div>
                    <div className="flex max-h-56 flex-wrap gap-1.5 overflow-y-auto">
                      {filteredModels.length === 0 ? (
                        <p className="px-1 py-2 text-xs text-muted-foreground">
                          {models.length === 0
                            ? t("fetchSiteGroupModelsEmpty")
                            : t("testModelNoMatch")}
                        </p>
                      ) : (
                        filteredModels.map((model) => (
                          <button
                            key={model}
                            type="button"
                            onClick={() => {
                              setSelectedModel(model);
                              setModelPopoverOpen(false);
                            }}
                            className={cn(
                              "inline-flex h-6 items-center gap-1 rounded-full border px-2 font-mono text-[11px] transition-colors",
                              model === selectedModel
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border text-foreground hover:border-primary/40 hover:bg-muted"
                            )}
                          >
                            {model === selectedModel ? (
                              <CheckCircle2 className="h-3 w-3" />
                            ) : null}
                            {model}
                          </button>
                        ))
                      )}
                    </div>
                    {modelsFailedCount > 0 ? (
                      <p className="text-[11px] text-amber-600 dark:text-amber-400">
                        {t("fetchSiteGroupModelsFailedCount", { count: modelsFailedCount })}
                      </p>
                    ) : null}
                    <div className="border-t pt-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 w-full gap-1.5 text-xs"
                        onClick={() => void fetchModels()}
                        disabled={modelsLoading}
                      >
                        {modelsLoading ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5" />
                        )}
                        {t("fetchSiteGroupModels")}
                      </Button>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 px-2.5 text-xs"
                onClick={() => void fetchModels()}
                disabled={modelsLoading}
              >
                {modelsLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                {t("fetchSiteGroupModels")}
              </Button>
            </div>
          </div>

          {/* Terminal output */}
          <div
            ref={terminalRef}
            className="max-h-72 min-h-48 overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-950 p-3.5 font-mono text-[12px] leading-5"
          >
            {logs.length === 0 ? (
              <p className="text-zinc-600">{t("testTerminalIdle")}</p>
            ) : (
              logs.map((line, i) => (
                <div key={i} className={cn("whitespace-pre-wrap break-words", LOG_STYLE[line.kind])}>
                  {line.text}
                </div>
              ))
            )}
            {isRunning ? (
              <div className="mt-1 flex items-center gap-2 text-zinc-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>{t("testLogRunning")}</span>
              </div>
            ) : null}
          </div>

          {/* Status strip */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Badge
                variant="outline"
                className={cn(
                  "gap-1 border-0 px-2 py-0.5",
                  done === "success"
                    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    : done === "error"
                      ? "bg-rose-500/10 text-rose-600 dark:text-rose-400"
                      : "text-muted-foreground"
                )}
              >
                {done === "success" ? (
                  <CheckCircle2 className="h-3 w-3" />
                ) : done === "error" ? (
                  <XCircle className="h-3 w-3" />
                ) : (
                  <AlertTriangle className="h-3 w-3" />
                )}
                {done === "success"
                  ? t("testLogDone")
                  : done === "error"
                    ? t("testLogFailed")
                    : t("testLogReady")}
              </Badge>
              <span className="hidden items-center gap-1 sm:inline-flex">
                {t("testPrompt")}: <span className="font-mono text-foreground">"hi"</span>
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t bg-muted/20 px-6 py-3.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            {t("testDialogClose")}
          </Button>
          <Button
            type="button"
            size="sm"
            className="gap-1.5"
            onClick={() => void runTest()}
            disabled={isRunning}
          >
            {isRunning ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            {isRunning ? t("testLogRunning") : done ? t("testDialogRetry") : t("testDialogStart")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

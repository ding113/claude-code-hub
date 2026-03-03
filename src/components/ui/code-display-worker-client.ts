"use client";

export type FormatJsonPrettyErrorCode =
  | "INVALID_JSON"
  | "CANCELED"
  | "OUTPUT_TOO_LARGE"
  | "WORKER_UNAVAILABLE"
  | "UNKNOWN";

export type FormatJsonPrettyResult =
  | { ok: true; text: string; usedStreaming: boolean }
  | { ok: false; errorCode: FormatJsonPrettyErrorCode };

export type StringifyJsonPrettyErrorCode = "CANCELED" | "OUTPUT_TOO_LARGE" | "UNKNOWN";

export type StringifyJsonPrettyResult =
  | { ok: true; text: string }
  | { ok: false; errorCode: StringifyJsonPrettyErrorCode };

export type BuildLineIndexErrorCode = "CANCELED" | "TOO_MANY_LINES" | "UNKNOWN";

export type BuildLineIndexResult =
  | { ok: true; lineStarts: Int32Array; lineCount: number }
  | { ok: false; errorCode: BuildLineIndexErrorCode; lineCount?: number };

export type SearchLinesErrorCode = "CANCELED" | "UNKNOWN";

export type SearchLinesResult =
  | { ok: true; matches: Int32Array }
  | { ok: false; errorCode: SearchLinesErrorCode };

type WorkerProgress = {
  stage: "format" | "index" | "search";
  processed: number;
  total: number;
};

type WorkerResponse =
  | {
      type: "progress";
      jobId: number;
      stage: "format" | "index" | "search";
      processed: number;
      total: number;
    }
  | {
      type: "formatJsonPrettyResult";
      jobId: number;
      ok: true;
      text: string;
      usedStreaming: boolean;
    }
  | {
      type: "formatJsonPrettyResult";
      jobId: number;
      ok: false;
      errorCode: "INVALID_JSON" | "CANCELED" | "OUTPUT_TOO_LARGE" | "UNKNOWN";
    }
  | {
      type: "stringifyJsonPrettyResult";
      jobId: number;
      ok: true;
      text: string;
    }
  | {
      type: "stringifyJsonPrettyResult";
      jobId: number;
      ok: false;
      errorCode: "CANCELED" | "OUTPUT_TOO_LARGE" | "UNKNOWN";
    }
  | {
      type: "buildLineIndexResult";
      jobId: number;
      ok: true;
      lineStarts: Int32Array;
      lineCount: number;
    }
  | {
      type: "buildLineIndexResult";
      jobId: number;
      ok: false;
      errorCode: "CANCELED" | "TOO_MANY_LINES" | "UNKNOWN";
      lineCount?: number;
    }
  | {
      type: "searchLinesResult";
      jobId: number;
      ok: true;
      matches: Int32Array;
    }
  | {
      type: "searchLinesResult";
      jobId: number;
      ok: false;
      errorCode: "CANCELED" | "UNKNOWN";
    };

type PendingJob =
  | {
      kind: "formatJsonPretty";
      resolve: (v: FormatJsonPrettyResult) => void;
      onProgress?: (p: WorkerProgress) => void;
    }
  | {
      kind: "stringifyJsonPretty";
      resolve: (v: StringifyJsonPrettyResult) => void;
    }
  | {
      kind: "buildLineIndex";
      resolve: (v: BuildLineIndexResult) => void;
      onProgress?: (p: WorkerProgress) => void;
    }
  | {
      kind: "searchLines";
      resolve: (v: SearchLinesResult) => void;
      onProgress?: (p: WorkerProgress) => void;
    };

let workerSingleton: Worker | null = null;
let initialized = false;
let nextJobId = 1;
const pending = new Map<number, PendingJob>();

type FormatJsonPrettyResolve = Extract<PendingJob, { kind: "formatJsonPretty" }>["resolve"];
type StringifyJsonPrettyResolve = Extract<PendingJob, { kind: "stringifyJsonPretty" }>["resolve"];
type BuildLineIndexResolve = Extract<PendingJob, { kind: "buildLineIndex" }>["resolve"];
type SearchLinesResolve = Extract<PendingJob, { kind: "searchLines" }>["resolve"];

const YIELD_MIN_INTERVAL_MS = 16;
const PROGRESS_MIN_INTERVAL_MS = 200;

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

async function yieldToEventLoop() {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function supportsWorker(): boolean {
  return typeof Worker !== "undefined";
}

function getWorker(): Worker | null {
  if (!supportsWorker()) return null;
  if (workerSingleton) return workerSingleton;

  try {
    // Next.js 支持用 URL + module worker 方式打包
    workerSingleton = new Worker(new URL("./code-display.worker.ts", import.meta.url), {
      type: "module",
    });
    return workerSingleton;
  } catch {
    // Worker 构造可能因 CSP / 打包资源异常等原因同步抛错：回落主线程实现
    workerSingleton = null;
    return null;
  }
}

function ensureInitialized() {
  if (initialized) return;

  const w = getWorker();
  if (!w) return;

  w.onmessage = (e: MessageEvent<WorkerResponse>) => {
    const msg = e.data;
    if (msg.type === "progress") {
      const job = pending.get(msg.jobId);
      if (!job) return;
      if ("onProgress" in job) {
        job.onProgress?.({
          stage: msg.stage,
          processed: msg.processed,
          total: msg.total,
        });
      }
      return;
    }

    const job = pending.get(msg.jobId);
    if (!job) return;
    pending.delete(msg.jobId);

    switch (msg.type) {
      case "formatJsonPrettyResult":
        if (job.kind !== "formatJsonPretty") return;
        job.resolve(
          msg.ok
            ? { ok: true, text: msg.text, usedStreaming: msg.usedStreaming }
            : { ok: false, errorCode: msg.errorCode }
        );
        break;
      case "stringifyJsonPrettyResult":
        if (job.kind !== "stringifyJsonPretty") return;
        job.resolve(
          msg.ok ? { ok: true, text: msg.text } : { ok: false, errorCode: msg.errorCode }
        );
        break;
      case "buildLineIndexResult":
        if (job.kind !== "buildLineIndex") return;
        job.resolve(
          msg.ok
            ? { ok: true, lineStarts: msg.lineStarts, lineCount: msg.lineCount }
            : { ok: false, errorCode: msg.errorCode, lineCount: msg.lineCount }
        );
        break;
      case "searchLinesResult":
        if (job.kind !== "searchLines") return;
        job.resolve(
          msg.ok ? { ok: true, matches: msg.matches } : { ok: false, errorCode: msg.errorCode }
        );
        break;
    }
  };

  w.onerror = () => {
    // Worker 崩溃/加载失败：清空 pending，后续自动回落到主线程
    for (const [jobId, job] of pending.entries()) {
      job.resolve({ ok: false, errorCode: "UNKNOWN" });
      pending.delete(jobId);
    }
    workerSingleton?.terminate();
    workerSingleton = null;
    initialized = false;
  };

  initialized = true;
}

function genJobId(): number {
  // 预留 0 作为无效值
  const id = nextJobId;
  nextJobId += 1;
  return id;
}

export function cancelWorkerJob(jobId: number) {
  const job = pending.get(jobId);
  if (!job) return;
  pending.delete(jobId);

  switch (job.kind) {
    case "formatJsonPretty":
      job.resolve({ ok: false, errorCode: "CANCELED" });
      break;
    case "stringifyJsonPretty":
      job.resolve({ ok: false, errorCode: "CANCELED" });
      break;
    case "buildLineIndex":
      job.resolve({ ok: false, errorCode: "CANCELED" });
      break;
    case "searchLines":
      job.resolve({ ok: false, errorCode: "CANCELED" });
      break;
  }

  const w = getWorker();
  if (!w) return;
  try {
    w.postMessage({ type: "cancel", jobId });
  } catch {
    // best-effort：Worker 可能已被终止
  }
}

export async function formatJsonPretty({
  text,
  indentSize,
  maxOutputBytes,
  onProgress,
  signal,
}: {
  text: string;
  indentSize: number;
  maxOutputBytes: number;
  onProgress?: (p: WorkerProgress) => void;
  signal?: AbortSignal;
}): Promise<FormatJsonPrettyResult> {
  ensureInitialized();
  const w = getWorker();
  if (!w) {
    if (signal?.aborted) return { ok: false, errorCode: "CANCELED" };
    // Worker 不可用时，对超大 JSON 做同步 parse/stringify 会导致主线程卡顿：
    // 直接返回错误，让上层回退到“纯文本展示/下载”。
    const MAX_SYNC_JSON_CHARS = 200_000;
    if (text.length > MAX_SYNC_JSON_CHARS) return { ok: false, errorCode: "WORKER_UNAVAILABLE" };
    // fallback（测试环境/不支持 Worker）：小内容可直接 parse/stringify
    try {
      const parsed = JSON.parse(text) as unknown;
      const pretty = JSON.stringify(parsed, null, indentSize);
      if (pretty.length * 2 > maxOutputBytes) return { ok: false, errorCode: "OUTPUT_TOO_LARGE" };
      return { ok: true, text: pretty, usedStreaming: false };
    } catch {
      return { ok: false, errorCode: "INVALID_JSON" };
    }
  }

  const jobId = genJobId();
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({ ok: false, errorCode: "CANCELED" });
      return;
    }

    const onAbort = () => cancelWorkerJob(jobId);
    signal?.addEventListener("abort", onAbort);

    const wrappedResolve: FormatJsonPrettyResolve = (v) => {
      signal?.removeEventListener("abort", onAbort);
      resolve(v);
    };

    pending.set(jobId, { kind: "formatJsonPretty", resolve: wrappedResolve, onProgress });
    try {
      w.postMessage({ type: "formatJsonPretty", jobId, text, indentSize, maxOutputBytes });
    } catch {
      pending.delete(jobId);
      wrappedResolve({ ok: false, errorCode: "UNKNOWN" });
    }
  });
}

export async function stringifyJsonPretty({
  value,
  indentSize,
  maxOutputBytes,
  signal,
}: {
  value: unknown;
  indentSize: number;
  maxOutputBytes: number;
  signal?: AbortSignal;
}): Promise<StringifyJsonPrettyResult> {
  ensureInitialized();
  const w = getWorker();
  if (!w) {
    if (signal?.aborted) return { ok: false, errorCode: "CANCELED" };
    try {
      const pretty = JSON.stringify(value, null, indentSize);
      if (pretty.length * 2 > maxOutputBytes) return { ok: false, errorCode: "OUTPUT_TOO_LARGE" };
      return { ok: true, text: pretty };
    } catch {
      return { ok: false, errorCode: "UNKNOWN" };
    }
  }

  const jobId = genJobId();
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({ ok: false, errorCode: "CANCELED" });
      return;
    }

    const onAbort = () => cancelWorkerJob(jobId);
    signal?.addEventListener("abort", onAbort);

    const wrappedResolve: StringifyJsonPrettyResolve = (v) => {
      signal?.removeEventListener("abort", onAbort);
      resolve(v);
    };

    pending.set(jobId, { kind: "stringifyJsonPretty", resolve: wrappedResolve });
    try {
      w.postMessage({ type: "stringifyJsonPretty", jobId, value, indentSize, maxOutputBytes });
    } catch {
      pending.delete(jobId);
      wrappedResolve({ ok: false, errorCode: "UNKNOWN" });
    }
  });
}

export async function buildLineIndex({
  text,
  maxLines,
  onProgress,
  signal,
  workerEnabled = true,
}: {
  text: string;
  maxLines: number;
  onProgress?: (p: WorkerProgress) => void;
  signal?: AbortSignal;
  workerEnabled?: boolean;
}): Promise<BuildLineIndexResult> {
  const buildLineIndexNoWorker = async (): Promise<BuildLineIndexResult> => {
    if (signal?.aborted) return { ok: false, errorCode: "CANCELED" };

    const total = text.length;
    const starts: number[] = [0];
    let lastYieldAt = nowMs();
    let lastProgressAt = lastYieldAt;

    for (let i = 0; i < total; i += 1) {
      if ((i & 8191) === 0) {
        if (signal?.aborted) return { ok: false, errorCode: "CANCELED" };

        const now = nowMs();
        if (now - lastYieldAt > YIELD_MIN_INTERVAL_MS) {
          lastYieldAt = now;
          await yieldToEventLoop();
          if (signal?.aborted) return { ok: false, errorCode: "CANCELED" };
        }

        if (now - lastProgressAt > PROGRESS_MIN_INTERVAL_MS) {
          lastProgressAt = now;
          onProgress?.({ stage: "index", processed: i, total });
        }
      }

      const code = text.charCodeAt(i);
      if (code === 10) {
        const nextLineCount = starts.length + 1;
        if (nextLineCount > maxLines) {
          onProgress?.({ stage: "index", processed: i, total });
          return { ok: false, errorCode: "TOO_MANY_LINES", lineCount: nextLineCount };
        }
        starts.push(i + 1);
        continue;
      }
      if (code === 13) {
        const nextLineCount = starts.length + 1;
        if (nextLineCount > maxLines) {
          onProgress?.({ stage: "index", processed: i, total });
          return { ok: false, errorCode: "TOO_MANY_LINES", lineCount: nextLineCount };
        }

        // CRLF 视为一个换行
        if (i + 1 < total && text.charCodeAt(i + 1) === 10) {
          starts.push(i + 2);
          i += 1;
        } else {
          starts.push(i + 1);
        }
      }
    }

    onProgress?.({ stage: "index", processed: total, total });

    const lineCount = starts.length;
    const lineStarts = new Int32Array(lineCount);
    for (let i = 0; i < lineCount; i += 1) {
      lineStarts[i] = starts[i] ?? 0;
    }

    return { ok: true, lineStarts, lineCount };
  };

  if (!workerEnabled) {
    return await buildLineIndexNoWorker();
  }

  ensureInitialized();
  const w = getWorker();
  if (!w) {
    return await buildLineIndexNoWorker();
  }

  const jobId = genJobId();
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({ ok: false, errorCode: "CANCELED" });
      return;
    }

    const onAbort = () => cancelWorkerJob(jobId);
    signal?.addEventListener("abort", onAbort);

    const wrappedResolve: BuildLineIndexResolve = (v) => {
      signal?.removeEventListener("abort", onAbort);
      resolve(v);
    };

    pending.set(jobId, { kind: "buildLineIndex", resolve: wrappedResolve, onProgress });
    try {
      w.postMessage({ type: "buildLineIndex", jobId, text, maxLines });
    } catch {
      pending.delete(jobId);
      wrappedResolve({ ok: false, errorCode: "UNKNOWN" });
    }
  });
}

export async function searchLines({
  text,
  query,
  maxResults,
  onProgress,
  signal,
  workerEnabled = true,
}: {
  text: string;
  query: string;
  maxResults: number;
  onProgress?: (p: WorkerProgress) => void;
  signal?: AbortSignal;
  workerEnabled?: boolean;
}): Promise<SearchLinesResult> {
  const searchLinesNoWorker = async (): Promise<SearchLinesResult> => {
    if (signal?.aborted) return { ok: false, errorCode: "CANCELED" };
    if (!query) return { ok: true, matches: new Int32Array(0) };

    const total = text.length;
    const lines: number[] = [];
    let lastLine = -1;
    let scan = 0;
    let lineNo = 0;
    let lastYieldAt = nowMs();
    let lastProgressAt = lastYieldAt;

    let pos = text.indexOf(query, 0);
    while (pos !== -1) {
      while (scan < pos) {
        if ((scan & 8191) === 0) {
          if (signal?.aborted) return { ok: false, errorCode: "CANCELED" };

          const now = nowMs();
          if (now - lastYieldAt > YIELD_MIN_INTERVAL_MS) {
            lastYieldAt = now;
            await yieldToEventLoop();
            if (signal?.aborted) return { ok: false, errorCode: "CANCELED" };
          }

          if (now - lastProgressAt > PROGRESS_MIN_INTERVAL_MS) {
            lastProgressAt = now;
            onProgress?.({ stage: "search", processed: scan, total });
          }
        }

        const code = text.charCodeAt(scan);
        if (code === 10) {
          lineNo += 1;
          scan += 1;
          continue;
        }
        if (code === 13) {
          lineNo += 1;
          if (scan + 1 < total && text.charCodeAt(scan + 1) === 10) {
            scan += 2;
          } else {
            scan += 1;
          }
          continue;
        }
        scan += 1;
      }

      if (lineNo !== lastLine) {
        lines.push(lineNo);
        lastLine = lineNo;
        if (lines.length >= maxResults) break;
      }

      if (signal?.aborted) return { ok: false, errorCode: "CANCELED" };
      pos = text.indexOf(query, pos + 1);

      const now = nowMs();
      if (now - lastYieldAt > YIELD_MIN_INTERVAL_MS) {
        lastYieldAt = now;
        await yieldToEventLoop();
        if (signal?.aborted) return { ok: false, errorCode: "CANCELED" };
      }

      if (now - lastProgressAt > PROGRESS_MIN_INTERVAL_MS) {
        lastProgressAt = now;
        onProgress?.({
          stage: "search",
          processed: Math.min(pos === -1 ? total : pos, total),
          total,
        });
      }
    }

    onProgress?.({ stage: "search", processed: total, total });
    return { ok: true, matches: Int32Array.from(lines) };
  };

  if (!workerEnabled) {
    return await searchLinesNoWorker();
  }

  ensureInitialized();
  const w = getWorker();
  if (!w) {
    return await searchLinesNoWorker();
  }

  const jobId = genJobId();
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({ ok: false, errorCode: "CANCELED" });
      return;
    }

    const onAbort = () => cancelWorkerJob(jobId);
    signal?.addEventListener("abort", onAbort);

    const wrappedResolve: SearchLinesResolve = (v) => {
      signal?.removeEventListener("abort", onAbort);
      resolve(v);
    };

    pending.set(jobId, { kind: "searchLines", resolve: wrappedResolve, onProgress });
    try {
      w.postMessage({ type: "searchLines", jobId, text, query, maxResults });
    } catch {
      pending.delete(jobId);
      wrappedResolve({ ok: false, errorCode: "UNKNOWN" });
    }
  });
}

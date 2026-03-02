"use client";

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
      resolve: (
        v: { ok: true; text: string; usedStreaming: boolean } | { ok: false; errorCode: string }
      ) => void;
      onProgress?: (p: WorkerProgress) => void;
    }
  | {
      kind: "stringifyJsonPretty";
      resolve: (v: { ok: true; text: string } | { ok: false; errorCode: string }) => void;
    }
  | {
      kind: "buildLineIndex";
      resolve: (
        v:
          | { ok: true; lineStarts: Int32Array; lineCount: number }
          | { ok: false; errorCode: string; lineCount?: number }
      ) => void;
      onProgress?: (p: WorkerProgress) => void;
    }
  | {
      kind: "searchLines";
      resolve: (v: { ok: true; matches: Int32Array } | { ok: false; errorCode: string }) => void;
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
  initialized = true;

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
  w.postMessage({ type: "cancel", jobId });
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
}): Promise<{ ok: true; text: string; usedStreaming: boolean } | { ok: false; errorCode: string }> {
  ensureInitialized();
  const w = getWorker();
  if (!w) {
    if (signal?.aborted) return { ok: false, errorCode: "CANCELED" };
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
    w.postMessage({ type: "formatJsonPretty", jobId, text, indentSize, maxOutputBytes });
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
}): Promise<{ ok: true; text: string } | { ok: false; errorCode: string }> {
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
    w.postMessage({ type: "stringifyJsonPretty", jobId, value, indentSize, maxOutputBytes });
  });
}

export async function buildLineIndex({
  text,
  maxLines,
  onProgress,
  signal,
}: {
  text: string;
  maxLines: number;
  onProgress?: (p: WorkerProgress) => void;
  signal?: AbortSignal;
}): Promise<
  | { ok: true; lineStarts: Int32Array; lineCount: number }
  | { ok: false; errorCode: string; lineCount?: number }
> {
  ensureInitialized();
  const w = getWorker();
  if (!w) {
    if (signal?.aborted) return { ok: false, errorCode: "CANCELED" };
    // fallback：双遍扫描（避免额外依赖）
    let lineCount = 1;
    for (let i = 0; i < text.length; i += 1) {
      if (text.charCodeAt(i) === 10) {
        lineCount += 1;
        if (lineCount > maxLines) {
          return { ok: false, errorCode: "TOO_MANY_LINES", lineCount };
        }
      }
    }
    const starts = new Int32Array(lineCount);
    starts[0] = 0;
    let idx = 1;
    for (let i = 0; i < text.length; i += 1) {
      if (text.charCodeAt(i) === 10) {
        starts[idx] = i + 1;
        idx += 1;
      }
    }
    return { ok: true, lineStarts: starts, lineCount };
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
    w.postMessage({ type: "buildLineIndex", jobId, text, maxLines });
  });
}

export async function searchLines({
  text,
  query,
  maxResults,
  onProgress,
  signal,
}: {
  text: string;
  query: string;
  maxResults: number;
  onProgress?: (p: WorkerProgress) => void;
  signal?: AbortSignal;
}): Promise<{ ok: true; matches: Int32Array } | { ok: false; errorCode: string }> {
  ensureInitialized();
  const w = getWorker();
  if (!w) {
    if (signal?.aborted) return { ok: false, errorCode: "CANCELED" };
    if (!query) return { ok: true, matches: new Int32Array(0) };

    const lines: number[] = [];
    let lastLine = -1;
    let scan = 0;
    let lineNo = 0;
    let pos = text.indexOf(query, 0);
    while (pos !== -1) {
      while (scan < pos) {
        if (text.charCodeAt(scan) === 10) lineNo += 1;
        scan += 1;
      }
      if (lineNo !== lastLine) {
        lines.push(lineNo);
        lastLine = lineNo;
        if (lines.length >= maxResults) break;
      }
      pos = text.indexOf(query, pos + 1);
    }
    return { ok: true, matches: Int32Array.from(lines) };
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
    w.postMessage({ type: "searchLines", jobId, text, query, maxResults });
  });
}

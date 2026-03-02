/// <reference lib="webworker" />

export {};

type WorkerRequest =
  | {
      type: "formatJsonPretty";
      jobId: number;
      text: string;
      indentSize: number;
      maxOutputBytes: number;
    }
  | {
      type: "stringifyJsonPretty";
      jobId: number;
      value: unknown;
      indentSize: number;
      maxOutputBytes: number;
    }
  | {
      type: "buildLineIndex";
      jobId: number;
      text: string;
      maxLines: number;
    }
  | {
      type: "searchLines";
      jobId: number;
      text: string;
      query: string;
      maxResults: number;
    }
  | {
      type: "cancel";
      jobId: number;
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

const cancelledJobs = new Set<number>();
const CANCELLED_JOB_TTL_MS = 60_000;

function isCancelled(jobId: number): boolean {
  return cancelledJobs.has(jobId);
}

function estimateUtf16Bytes(textLength: number): number {
  return textLength * 2;
}

function post(msg: WorkerResponse, transfer?: Transferable[]) {
  (self as DedicatedWorkerGlobalScope).postMessage(msg, transfer ?? []);
}

function safeJsonParse(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

function stringifyPretty(value: unknown, indentSize: number): string {
  return JSON.stringify(value, null, indentSize);
}

function formatJsonPrettyStreaming({
  text,
  jobId,
  indentSize,
  maxOutputBytes,
}: {
  text: string;
  jobId: number;
  indentSize: number;
  maxOutputBytes: number;
}):
  | { ok: true; text: string }
  | { ok: false; errorCode: "INVALID_JSON" | "CANCELED" | "OUTPUT_TOO_LARGE" } {
  // 严格流式 pretty printer：不构建对象树，按字符扫描并校验 JSON 语法。
  // 目标：只要输入是合法 JSON，就能输出完整 pretty；若非法，返回 INVALID_JSON（不做“容错修复”）。

  const chunks: string[] = [];
  let outLen = 0;

  const indentCache = new Map<number, string>();
  const getIndent = (level: number) => {
    const cached = indentCache.get(level);
    if (cached) return cached;
    const str = " ".repeat(level * indentSize);
    indentCache.set(level, str);
    return str;
  };

  const push = (s: string): { ok: true } | { ok: false; errorCode: "OUTPUT_TOO_LARGE" } => {
    chunks.push(s);
    outLen += s.length;
    if (estimateUtf16Bytes(outLen) > maxOutputBytes) {
      return { ok: false, errorCode: "OUTPUT_TOO_LARGE" };
    }
    return { ok: true };
  };

  const isWhitespaceCharCode = (code: number) =>
    code === 0x20 || code === 0x0a || code === 0x0d || code === 0x09 || code === 0xfeff;

  const isDigitCharCode = (code: number) => code >= 0x30 && code <= 0x39;

  const isHexDigitCharCode = (code: number) =>
    (code >= 0x30 && code <= 0x39) ||
    (code >= 0x41 && code <= 0x46) ||
    (code >= 0x61 && code <= 0x66);

  type ArrayFrame = {
    type: "array";
    state: "valueOrEnd" | "value" | "commaOrEnd";
    itemCount: number;
  };
  type ObjectFrame = {
    type: "object";
    state: "keyOrEnd" | "key" | "colon" | "value" | "commaOrEnd";
    itemCount: number;
  };
  type Frame = ArrayFrame | ObjectFrame;

  const stack: Frame[] = [];
  let rootCompleted = false;

  let i = 0;
  const total = text.length;
  let lastProgressAt = 0;

  const maybeReportProgress = () => {
    const now = performance.now();
    if (now - lastProgressAt < 200) return;
    lastProgressAt = now;
    post({ type: "progress", jobId, stage: "format", processed: i, total });
  };

  const skipWhitespace = () => {
    while (i < total) {
      if (isCancelled(jobId)) return { ok: false as const, errorCode: "CANCELED" as const };
      const code = text.charCodeAt(i);
      if (!isWhitespaceCharCode(code)) break;
      i += 1;
      if ((i & 8191) === 0) maybeReportProgress();
    }
    return { ok: true as const };
  };

  const parseStringToken = ():
    | { ok: true; token: string }
    | { ok: false; errorCode: "INVALID_JSON" | "CANCELED" } => {
    if (text.charCodeAt(i) !== 0x22) return { ok: false, errorCode: "INVALID_JSON" };
    const start = i;
    i += 1; // skip opening quote

    while (i < total) {
      if (isCancelled(jobId)) return { ok: false, errorCode: "CANCELED" };

      if ((i & 8191) === 0) maybeReportProgress();

      const code = text.charCodeAt(i);
      if (code === 0x22) {
        i += 1;
        return { ok: true, token: text.slice(start, i) };
      }
      if (code === 0x5c) {
        i += 1;
        if (i >= total) return { ok: false, errorCode: "INVALID_JSON" };
        const esc = text.charCodeAt(i);
        switch (esc) {
          case 0x22: // "
          case 0x5c: // \
          case 0x2f: // /
          case 0x62: // b
          case 0x66: // f
          case 0x6e: // n
          case 0x72: // r
          case 0x74: // t
            i += 1;
            continue;
          case 0x75: {
            // uXXXX
            if (i + 4 >= total) return { ok: false, errorCode: "INVALID_JSON" };
            const c1 = text.charCodeAt(i + 1);
            const c2 = text.charCodeAt(i + 2);
            const c3 = text.charCodeAt(i + 3);
            const c4 = text.charCodeAt(i + 4);
            if (
              !isHexDigitCharCode(c1) ||
              !isHexDigitCharCode(c2) ||
              !isHexDigitCharCode(c3) ||
              !isHexDigitCharCode(c4)
            ) {
              return { ok: false, errorCode: "INVALID_JSON" };
            }
            i += 5;
            continue;
          }
          default:
            return { ok: false, errorCode: "INVALID_JSON" };
        }
      }
      // JSON 字符串不能包含未转义的控制字符
      if (code < 0x20) return { ok: false, errorCode: "INVALID_JSON" };
      i += 1;
    }

    return { ok: false, errorCode: "INVALID_JSON" };
  };

  const parseNumberToken = ():
    | { ok: true; token: string }
    | { ok: false; errorCode: "INVALID_JSON" | "CANCELED" } => {
    const start = i;

    if (isCancelled(jobId)) return { ok: false, errorCode: "CANCELED" };

    let code = text.charCodeAt(i);
    if (code === 0x2d) {
      i += 1;
      if (i >= total) return { ok: false, errorCode: "INVALID_JSON" };
      code = text.charCodeAt(i);
    }

    if (code === 0x30) {
      i += 1;
      if (i < total && isDigitCharCode(text.charCodeAt(i))) {
        return { ok: false, errorCode: "INVALID_JSON" };
      }
    } else if (code >= 0x31 && code <= 0x39) {
      i += 1;
      while (i < total && isDigitCharCode(text.charCodeAt(i))) {
        i += 1;
        if ((i & 8191) === 0) maybeReportProgress();
        if (isCancelled(jobId)) return { ok: false, errorCode: "CANCELED" };
      }
    } else {
      return { ok: false, errorCode: "INVALID_JSON" };
    }

    if (i < total && text.charCodeAt(i) === 0x2e) {
      i += 1;
      if (i >= total) return { ok: false, errorCode: "INVALID_JSON" };
      if (!isDigitCharCode(text.charCodeAt(i))) return { ok: false, errorCode: "INVALID_JSON" };
      while (i < total && isDigitCharCode(text.charCodeAt(i))) {
        i += 1;
        if ((i & 8191) === 0) maybeReportProgress();
        if (isCancelled(jobId)) return { ok: false, errorCode: "CANCELED" };
      }
    }

    if (i < total) {
      const e = text.charCodeAt(i);
      if (e === 0x65 || e === 0x45) {
        i += 1;
        if (i >= total) return { ok: false, errorCode: "INVALID_JSON" };
        const sign = text.charCodeAt(i);
        if (sign === 0x2b || sign === 0x2d) {
          i += 1;
          if (i >= total) return { ok: false, errorCode: "INVALID_JSON" };
        }
        if (!isDigitCharCode(text.charCodeAt(i))) return { ok: false, errorCode: "INVALID_JSON" };
        while (i < total && isDigitCharCode(text.charCodeAt(i))) {
          i += 1;
          if ((i & 8191) === 0) maybeReportProgress();
          if (isCancelled(jobId)) return { ok: false, errorCode: "CANCELED" };
        }
      }
    }

    return { ok: true, token: text.slice(start, i) };
  };

  const parseKeywordToken = ():
    | { ok: true; token: string }
    | { ok: false; errorCode: "INVALID_JSON" } => {
    const code = text.charCodeAt(i);
    if (code === 0x74) {
      if (text.slice(i, i + 4) !== "true") return { ok: false, errorCode: "INVALID_JSON" };
      i += 4;
      return { ok: true, token: "true" };
    }
    if (code === 0x66) {
      if (text.slice(i, i + 5) !== "false") return { ok: false, errorCode: "INVALID_JSON" };
      i += 5;
      return { ok: true, token: "false" };
    }
    if (code === 0x6e) {
      if (text.slice(i, i + 4) !== "null") return { ok: false, errorCode: "INVALID_JSON" };
      i += 4;
      return { ok: true, token: "null" };
    }
    return { ok: false, errorCode: "INVALID_JSON" };
  };

  const onValueCompleted = () => {
    if (stack.length === 0) {
      rootCompleted = true;
      return;
    }
    const top = stack[stack.length - 1];
    top.itemCount += 1;
    top.state = "commaOrEnd";
  };

  const parseValue = ():
    | { ok: true }
    | { ok: false; errorCode: "INVALID_JSON" | "CANCELED" | "OUTPUT_TOO_LARGE" } => {
    const ws = skipWhitespace();
    if (!ws.ok) return ws;
    if (i >= total) return { ok: false, errorCode: "INVALID_JSON" };

    if ((i & 8191) === 0) maybeReportProgress();
    if (isCancelled(jobId)) return { ok: false, errorCode: "CANCELED" };

    const code = text.charCodeAt(i);
    if (code === 0x7b) {
      // {
      const pushed = push("{");
      if (!pushed.ok) return pushed;
      i += 1;
      stack.push({ type: "object", state: "keyOrEnd", itemCount: 0 });
      return { ok: true };
    }
    if (code === 0x5b) {
      // [
      const pushed = push("[");
      if (!pushed.ok) return pushed;
      i += 1;
      stack.push({ type: "array", state: "valueOrEnd", itemCount: 0 });
      return { ok: true };
    }
    if (code === 0x22) {
      const token = parseStringToken();
      if (!token.ok) return token;
      const pushed = push(token.token);
      if (!pushed.ok) return pushed;
      onValueCompleted();
      return { ok: true };
    }
    if (code === 0x2d || (code >= 0x30 && code <= 0x39)) {
      const token = parseNumberToken();
      if (!token.ok) return token;
      const pushed = push(token.token);
      if (!pushed.ok) return pushed;
      onValueCompleted();
      return { ok: true };
    }
    if (code === 0x74 || code === 0x66 || code === 0x6e) {
      const token = parseKeywordToken();
      if (!token.ok) return token;
      const pushed = push(token.token);
      if (!pushed.ok) return pushed;
      onValueCompleted();
      return { ok: true };
    }

    return { ok: false, errorCode: "INVALID_JSON" };
  };

  while (true) {
    if (isCancelled(jobId)) return { ok: false, errorCode: "CANCELED" };
    if ((i & 8191) === 0) maybeReportProgress();

    const ws = skipWhitespace();
    if (!ws.ok) return ws;

    if (stack.length === 0) {
      if (rootCompleted) {
        if (i !== total) return { ok: false, errorCode: "INVALID_JSON" };
        post({ type: "progress", jobId, stage: "format", processed: total, total });
        return { ok: true, text: chunks.join("") };
      }

      const v = parseValue();
      if (!v.ok) return v;
      continue;
    }

    const frame = stack[stack.length - 1];
    if (frame.type === "array") {
      if (frame.state === "valueOrEnd") {
        if (i >= total) return { ok: false, errorCode: "INVALID_JSON" };
        if (text.charCodeAt(i) === 0x5d) {
          // ]
          const pushed = push("]");
          if (!pushed.ok) return pushed;
          i += 1;
          stack.pop();
          onValueCompleted();
          continue;
        }

        // first element
        const pushedNl = push("\n");
        if (!pushedNl.ok) return pushedNl;
        const pushedIndent = push(getIndent(stack.length));
        if (!pushedIndent.ok) return pushedIndent;
        frame.state = "value";
        continue;
      }

      if (frame.state === "value") {
        const v = parseValue();
        if (!v.ok) return v;
        continue;
      }

      // commaOrEnd
      if (i >= total) return { ok: false, errorCode: "INVALID_JSON" };
      const code = text.charCodeAt(i);
      if (code === 0x2c) {
        // ,
        const pushedComma = push(",");
        if (!pushedComma.ok) return pushedComma;
        const pushedNl = push("\n");
        if (!pushedNl.ok) return pushedNl;
        const pushedIndent = push(getIndent(stack.length));
        if (!pushedIndent.ok) return pushedIndent;
        i += 1;
        frame.state = "value";
        continue;
      }
      if (code === 0x5d) {
        // ]
        if (frame.itemCount > 0) {
          const pushedNl = push("\n");
          if (!pushedNl.ok) return pushedNl;
          const pushedIndent = push(getIndent(stack.length - 1));
          if (!pushedIndent.ok) return pushedIndent;
        }
        const pushedClose = push("]");
        if (!pushedClose.ok) return pushedClose;
        i += 1;
        stack.pop();
        onValueCompleted();
        continue;
      }
      return { ok: false, errorCode: "INVALID_JSON" };
    }

    // object
    if (frame.state === "keyOrEnd") {
      if (i >= total) return { ok: false, errorCode: "INVALID_JSON" };
      if (text.charCodeAt(i) === 0x7d) {
        // }
        const pushed = push("}");
        if (!pushed.ok) return pushed;
        i += 1;
        stack.pop();
        onValueCompleted();
        continue;
      }

      // first key
      const pushedNl = push("\n");
      if (!pushedNl.ok) return pushedNl;
      const pushedIndent = push(getIndent(stack.length));
      if (!pushedIndent.ok) return pushedIndent;
      frame.state = "key";
      continue;
    }

    if (frame.state === "key") {
      const ws2 = skipWhitespace();
      if (!ws2.ok) return ws2;
      const token = parseStringToken();
      if (!token.ok) return token;
      const pushed = push(token.token);
      if (!pushed.ok) return pushed;
      frame.state = "colon";
      continue;
    }

    if (frame.state === "colon") {
      const ws2 = skipWhitespace();
      if (!ws2.ok) return ws2;
      if (i >= total) return { ok: false, errorCode: "INVALID_JSON" };
      if (text.charCodeAt(i) !== 0x3a) return { ok: false, errorCode: "INVALID_JSON" };
      const pushed = push(": ");
      if (!pushed.ok) return pushed;
      i += 1;
      frame.state = "value";
      continue;
    }

    if (frame.state === "value") {
      const v = parseValue();
      if (!v.ok) return v;
      continue;
    }

    // commaOrEnd
    const ws2 = skipWhitespace();
    if (!ws2.ok) return ws2;
    if (i >= total) return { ok: false, errorCode: "INVALID_JSON" };
    const code = text.charCodeAt(i);
    if (code === 0x2c) {
      const pushedComma = push(",");
      if (!pushedComma.ok) return pushedComma;
      const pushedNl = push("\n");
      if (!pushedNl.ok) return pushedNl;
      const pushedIndent = push(getIndent(stack.length));
      if (!pushedIndent.ok) return pushedIndent;
      i += 1;
      frame.state = "key";
      continue;
    }
    if (code === 0x7d) {
      if (frame.itemCount > 0) {
        const pushedNl = push("\n");
        if (!pushedNl.ok) return pushedNl;
        const pushedIndent = push(getIndent(stack.length - 1));
        if (!pushedIndent.ok) return pushedIndent;
      }
      const pushedClose = push("}");
      if (!pushedClose.ok) return pushedClose;
      i += 1;
      stack.pop();
      onValueCompleted();
      continue;
    }
    return { ok: false, errorCode: "INVALID_JSON" };
  }
}

function buildLineIndex({
  text,
  jobId,
  maxLines,
}: {
  text: string;
  jobId: number;
  maxLines: number;
}):
  | { ok: true; lineStarts: Int32Array; lineCount: number }
  | { ok: false; errorCode: "CANCELED" | "TOO_MANY_LINES"; lineCount?: number } {
  const total = text.length;

  // 先计数（允许提前发现是否超过上限）
  let lineCount = 1;
  let lastProgressAt = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (isCancelled(jobId)) return { ok: false, errorCode: "CANCELED" };
    const code = text.charCodeAt(i);
    if (code === 10) {
      lineCount += 1;
      if (lineCount > maxLines) {
        post({ type: "progress", jobId, stage: "index", processed: i, total });
        return { ok: false, errorCode: "TOO_MANY_LINES", lineCount };
      }
    } else if (code === 13) {
      lineCount += 1;
      // CRLF 视为一个换行
      if (i + 1 < total && text.charCodeAt(i + 1) === 10) i += 1;
      if (lineCount > maxLines) {
        post({ type: "progress", jobId, stage: "index", processed: i, total });
        return { ok: false, errorCode: "TOO_MANY_LINES", lineCount };
      }
    }

    if ((i & 8191) === 0) {
      const now = performance.now();
      if (now - lastProgressAt > 200) {
        lastProgressAt = now;
        post({ type: "progress", jobId, stage: "index", processed: i, total });
      }
    }
  }

  const starts = new Int32Array(lineCount);
  starts[0] = 0;
  let idx = 1;
  for (let i = 0; i < text.length; i += 1) {
    if (isCancelled(jobId)) return { ok: false, errorCode: "CANCELED" };
    const code = text.charCodeAt(i);
    if (code === 10) {
      starts[idx] = i + 1;
      idx += 1;
      continue;
    }
    if (code === 13) {
      if (i + 1 < total && text.charCodeAt(i + 1) === 10) {
        starts[idx] = i + 2;
        idx += 1;
        i += 1;
      } else {
        starts[idx] = i + 1;
        idx += 1;
      }
    }
  }

  post({ type: "progress", jobId, stage: "index", processed: total, total });
  return { ok: true, lineStarts: starts, lineCount };
}

function searchLines({
  text,
  query,
  jobId,
  maxResults,
}: {
  text: string;
  query: string;
  jobId: number;
  maxResults: number;
}): { ok: true; matches: Int32Array } | { ok: false; errorCode: "CANCELED" } {
  if (!query) return { ok: true, matches: new Int32Array(0) };

  const total = text.length;
  let lastProgressAt = 0;

  const lines: number[] = [];
  let lastLine = -1;
  let scan = 0;
  let lineNo = 0;

  let pos = text.indexOf(query, 0);
  while (pos !== -1) {
    if (isCancelled(jobId)) return { ok: false, errorCode: "CANCELED" };

    // 更新 lineNo 到 pos 所在行（scan 指针单调前进，整体 O(n)）
    while (scan < pos) {
      if ((scan & 8191) === 0 && isCancelled(jobId)) return { ok: false, errorCode: "CANCELED" };
      const code = text.charCodeAt(scan);
      if (code === 10) {
        lineNo += 1;
        scan += 1;
        continue;
      }
      if (code === 13) {
        lineNo += 1;
        // CRLF 视为一个换行
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

    pos = text.indexOf(query, pos + 1);

    const now = performance.now();
    if (now - lastProgressAt > 200) {
      lastProgressAt = now;
      post({
        type: "progress",
        jobId,
        stage: "search",
        processed: Math.min(pos === -1 ? total : pos, total),
        total,
      });
    }
  }

  post({ type: "progress", jobId, stage: "search", processed: total, total });
  return { ok: true, matches: Int32Array.from(lines) };
}

(self as DedicatedWorkerGlobalScope).onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;

  if (msg.type === "cancel") {
    cancelledJobs.add(msg.jobId);
    setTimeout(() => cancelledJobs.delete(msg.jobId), CANCELLED_JOB_TTL_MS);
    return;
  }

  const { jobId } = msg;

  try {
    if (msg.type === "formatJsonPretty") {
      // 优先使用流式格式化；若失败可回落为 JSON.parse/stringify（更严格但可能占内存）。
      const streaming = formatJsonPrettyStreaming({
        text: msg.text,
        jobId,
        indentSize: msg.indentSize,
        maxOutputBytes: msg.maxOutputBytes,
      });

      if (streaming.ok) {
        post({
          type: "formatJsonPrettyResult",
          jobId,
          ok: true,
          text: streaming.text,
          usedStreaming: true,
        });
        return;
      }

      if (streaming.errorCode === "CANCELED") {
        post({ type: "formatJsonPrettyResult", jobId, ok: false, errorCode: "CANCELED" });
        return;
      }
      if (streaming.errorCode === "OUTPUT_TOO_LARGE") {
        post({
          type: "formatJsonPrettyResult",
          jobId,
          ok: false,
          errorCode: "OUTPUT_TOO_LARGE",
        });
        return;
      }

      // 回落：严格 JSON.parse（可能较慢/占内存，但能处理部分边界情况）
      if (isCancelled(jobId)) {
        post({ type: "formatJsonPrettyResult", jobId, ok: false, errorCode: "CANCELED" });
        return;
      }
      const parsed = safeJsonParse(msg.text);
      if (isCancelled(jobId)) {
        post({ type: "formatJsonPrettyResult", jobId, ok: false, errorCode: "CANCELED" });
        return;
      }
      if (!parsed.ok) {
        post({ type: "formatJsonPrettyResult", jobId, ok: false, errorCode: "INVALID_JSON" });
        return;
      }

      if (isCancelled(jobId)) {
        post({ type: "formatJsonPrettyResult", jobId, ok: false, errorCode: "CANCELED" });
        return;
      }
      const text = stringifyPretty(parsed.value, msg.indentSize);
      if (isCancelled(jobId)) {
        post({ type: "formatJsonPrettyResult", jobId, ok: false, errorCode: "CANCELED" });
        return;
      }
      if (estimateUtf16Bytes(text.length) > msg.maxOutputBytes) {
        post({
          type: "formatJsonPrettyResult",
          jobId,
          ok: false,
          errorCode: "OUTPUT_TOO_LARGE",
        });
        return;
      }

      if (isCancelled(jobId)) {
        post({ type: "formatJsonPrettyResult", jobId, ok: false, errorCode: "CANCELED" });
        return;
      }
      post({ type: "formatJsonPrettyResult", jobId, ok: true, text, usedStreaming: false });
      return;
    }

    if (msg.type === "stringifyJsonPretty") {
      if (isCancelled(jobId)) {
        post({ type: "stringifyJsonPrettyResult", jobId, ok: false, errorCode: "CANCELED" });
        return;
      }

      const text = stringifyPretty(msg.value, msg.indentSize);
      if (estimateUtf16Bytes(text.length) > msg.maxOutputBytes) {
        post({
          type: "stringifyJsonPrettyResult",
          jobId,
          ok: false,
          errorCode: "OUTPUT_TOO_LARGE",
        });
        return;
      }

      post({ type: "stringifyJsonPrettyResult", jobId, ok: true, text });
      return;
    }

    if (msg.type === "buildLineIndex") {
      const result = buildLineIndex({ text: msg.text, jobId, maxLines: msg.maxLines });

      if (!result.ok) {
        post({
          type: "buildLineIndexResult",
          jobId,
          ok: false,
          errorCode: result.errorCode,
          lineCount: result.lineCount,
        });
        return;
      }

      post(
        {
          type: "buildLineIndexResult",
          jobId,
          ok: true,
          lineStarts: result.lineStarts,
          lineCount: result.lineCount,
        },
        [result.lineStarts.buffer]
      );
      return;
    }

    if (msg.type === "searchLines") {
      const result = searchLines({
        text: msg.text,
        query: msg.query,
        jobId,
        maxResults: msg.maxResults,
      });

      if (!result.ok) {
        post({ type: "searchLinesResult", jobId, ok: false, errorCode: result.errorCode });
        return;
      }

      post({ type: "searchLinesResult", jobId, ok: true, matches: result.matches }, [
        result.matches.buffer,
      ]);
      return;
    }
  } catch (error) {
    // 最后兜底
    if (msg.type === "formatJsonPretty") {
      post({ type: "formatJsonPrettyResult", jobId, ok: false, errorCode: "UNKNOWN" });
      return;
    }
    if (msg.type === "stringifyJsonPretty") {
      post({ type: "stringifyJsonPrettyResult", jobId, ok: false, errorCode: "UNKNOWN" });
      return;
    }
    if (msg.type === "buildLineIndex") {
      post({ type: "buildLineIndexResult", jobId, ok: false, errorCode: "UNKNOWN" });
      return;
    }
    if (msg.type === "searchLines") {
      post({ type: "searchLinesResult", jobId, ok: false, errorCode: "UNKNOWN" });
      return;
    }
  } finally {
    cancelledJobs.delete(jobId);
  }
};

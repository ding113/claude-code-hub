import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import http from "node:http";
import { dirname, join } from "node:path";
import process from "node:process";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import WebSocket, { type RawData, WebSocketServer } from "ws";

/**
 * Opt-in Codex CLI transport probe for `/v1/responses`.
 *
 * Default Vitest/E2E runs skip this file's body. To run it locally:
 *   PowerShell:
 *     $env:CCH_CODEX_E2E="1"; $env:CCH_CODEX_E2E_EXPECT_TRANSPORT="websocket"; npx vitest run --config tests/configs/e2e.config.ts tests/e2e/responses-ws-codex-cli-transport.test.ts
 *   POSIX:
 *     CCH_CODEX_E2E=1 CCH_CODEX_E2E_EXPECT_TRANSPORT=websocket npx vitest run --config tests/configs/e2e.config.ts tests/e2e/responses-ws-codex-cli-transport.test.ts
 *
 * `CCH_CODEX_E2E_EXPECT_TRANSPORT=any|http|websocket` controls how strict the
 * assertion is. Use `websocket` when validating a Codex build that should speak
 * Responses WebSocket; use `any` to record the actual transport without making
 * the test version-sensitive.
 *
 * Fault-injection probes are also opt-in:
 *   PowerShell:
 *     $env:CCH_CODEX_E2E="1"; $env:CCH_CODEX_E2E_FAULTS="1"; npx vitest run --config tests/configs/e2e.config.ts tests/e2e/responses-ws-codex-cli-transport.test.ts
 */

type ProbeEvent =
  | { type: "server_started"; port: number }
  | { type: "http_models" }
  | { type: "http_responses"; bytes: number }
  | { type: "http_unknown"; method: string | undefined; path: string }
  | { type: "ws_upgrade"; path: string }
  | { type: "ws_connection"; path: string | undefined }
  | {
      type: "ws_message";
      bytes: number;
      frameType: string | null;
      generate: boolean | null;
      previousResponseId: string | null;
      isBinary: boolean;
    }
  | { type: "ws_close"; code: number; reason: string };

type CodexResult = {
  code: number | null;
  stdout: string;
  stderr: string;
};

type CodexRunOptions = {
  prompt?: string;
  timeoutMs?: number;
  extraConfig?: string[];
};

type RunningCodexProcess = {
  child: ReturnType<typeof spawn>;
  result: Promise<CodexResult>;
  stdout: () => string;
  stderr: () => string;
};

type ProbeServer = {
  port: number;
  events: ProbeEvent[];
  close: () => Promise<void>;
};

type CodexInvocation = {
  command: string;
  argsPrefix: string[];
  display: string;
};

const shouldRunCodexE2e = process.env.CCH_CODEX_E2E === "1";
const run = shouldRunCodexE2e ? describe : describe.skip;
const shouldRunFaultE2e = shouldRunCodexE2e && process.env.CCH_CODEX_E2E_FAULTS === "1";
const faultRun = shouldRunFaultE2e ? describe : describe.skip;
const providerName = "local-cch-ws-e2e";
const model = process.env.CCH_CODEX_E2E_MODEL || "gpt-5.4";
const responseText = "E2E_TRANSPORT_OK";
const defaultFeatures = "responses_websockets,responses_websockets_v2";
const requireFromHere = createRequire(import.meta.url);

function responseEnvelope(responseId: string, includeOutput: boolean) {
  return {
    id: responseId,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    model,
    status: "completed",
    output: includeOutput
      ? [
          {
            id: `msg_${responseId}`,
            type: "message",
            status: "completed",
            role: "assistant",
            content: [{ type: "output_text", text: responseText }],
          },
        ]
      : [],
    usage: {
      input_tokens: 8,
      output_tokens: includeOutput ? 4 : 0,
      total_tokens: includeOutput ? 12 : 8,
    },
  };
}

function responseEvents(responseId: string, includeOutput: boolean) {
  const response = responseEnvelope(responseId, includeOutput);
  if (!includeOutput) {
    return [
      { type: "response.created", response: { ...response, output: [] } },
      { type: "response.completed", response },
    ];
  }

  const item = response.output[0]!;
  const content = item.content[0]!;
  return [
    { type: "response.created", response: { ...response, output: [] } },
    { type: "response.output_item.added", output_index: 0, item },
    {
      type: "response.output_text.delta",
      output_index: 0,
      content_index: 0,
      delta: content.text,
    },
    {
      type: "response.output_text.done",
      output_index: 0,
      content_index: 0,
      text: content.text,
    },
    { type: "response.output_item.done", output_index: 0, item },
    { type: "response.completed", response },
  ];
}

function writeSse(res: http.ServerResponse) {
  res.statusCode = 200;
  res.setHeader("content-type", "text/event-stream");
  res.setHeader("cache-control", "no-cache, no-transform");
  for (const event of responseEvents("resp_cch_ws_e2e_http", true)) {
    res.write(`event: ${event.type}\n`);
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }
  res.end();
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function startProbeServer(): Promise<ProbeServer> {
  const events: ProbeEvent[] = [];
  const record = (event: ProbeEvent) => {
    events.push(event);
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/v1/models") {
      record({ type: "http_models" });
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          object: "list",
          data: [{ id: model, object: "model", owned_by: "cch-ws-e2e" }],
        })
      );
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/responses") {
      const body = await readBody(req);
      record({ type: "http_responses", bytes: Buffer.byteLength(body, "utf8") });
      writeSse(res);
      return;
    }

    record({ type: "http_unknown", method: req.method, path: url.pathname });
    res.statusCode = 404;
    res.end("not found");
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 * 1024 });
  const sockets = new Set<import("ws").WebSocket>();
  let responseSeq = 0;
  wss.on("connection", (ws, req) => {
    sockets.add(ws);
    record({ type: "ws_connection", path: req.url });
    ws.on("message", (raw, isBinary) => {
      const text = isBinary ? raw.toString("base64") : raw.toString("utf8");
      let frameType: string | null = null;
      let generate: boolean | null = null;
      let previousResponseId: string | null = null;
      try {
        const frame = JSON.parse(text);
        frameType = frame.type || null;
        generate = typeof frame.generate === "boolean" ? frame.generate : null;
        previousResponseId =
          typeof frame.previous_response_id === "string" ? frame.previous_response_id : null;
      } catch {
        frameType = "invalid_json";
      }
      record({
        type: "ws_message",
        bytes: Buffer.byteLength(text, "utf8"),
        frameType,
        generate,
        previousResponseId,
        isBinary,
      });
      responseSeq += 1;
      const includeOutput = generate !== false;
      for (const event of responseEvents(`resp_cch_ws_e2e_${responseSeq}`, includeOutput)) {
        ws.send(JSON.stringify(event));
      }
    });
    ws.on("close", (code, reason) => {
      sockets.delete(ws);
      record({ type: "ws_close", code, reason: reason.toString("utf8") });
    });
  });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    record({ type: "ws_upgrade", path: url.pathname });
    if (url.pathname !== "/v1/responses") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address !== "object") {
    throw new Error("failed to allocate local port");
  }
  record({ type: "server_started", port: address.port });

  return {
    port: address.port,
    events,
    close: async () => {
      for (const socket of sockets) {
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
          socket.close(1000, "test_done");
        }
      }
      const forceClose = setTimeout(() => {
        for (const socket of sockets) {
          socket.terminate();
        }
      }, 250);
      await new Promise<void>((resolve) =>
        wss.close(() => {
          clearTimeout(forceClose);
          resolve();
        })
      );
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function nodeInvocationForCodexScript(scriptPath: string, display = scriptPath): CodexInvocation {
  return {
    command: process.execPath,
    argsPrefix: [scriptPath],
    display,
  };
}

function nodeInvocationForWindowsCmd(cmdPath: string): CodexInvocation {
  const scriptPath = join(dirname(cmdPath), "node_modules", "@openai", "codex", "bin", "codex.js");
  if (!existsSync(scriptPath)) {
    throw new Error(`Cannot locate Codex CLI JS entrypoint next to ${cmdPath}: ${scriptPath}`);
  }
  const bundledNode = join(dirname(cmdPath), "node.exe");
  return {
    command: existsSync(bundledNode) ? bundledNode : process.execPath,
    argsPrefix: [scriptPath],
    display: cmdPath,
  };
}

function resolveCodexInvocation(): CodexInvocation {
  const configuredBin = process.env.CCH_CODEX_E2E_BIN;
  if (configuredBin) {
    if (/\.cmd$/i.test(configuredBin)) {
      return nodeInvocationForWindowsCmd(configuredBin);
    }
    if (/\.js$/i.test(configuredBin)) {
      return nodeInvocationForCodexScript(configuredBin);
    }
    return { command: configuredBin, argsPrefix: [], display: configuredBin };
  }

  if (process.platform === "win32") {
    let whereOutput = "";
    try {
      whereOutput = execFileSync("where.exe", ["codex.cmd"], { encoding: "utf8" });
    } catch {
      throw new Error("Cannot find codex.cmd on PATH. Install Codex CLI or set CCH_CODEX_E2E_BIN.");
    }
    const cmdPath = whereOutput
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    if (!cmdPath) {
      throw new Error("Cannot find codex.cmd on PATH. Install Codex CLI or set CCH_CODEX_E2E_BIN.");
    }
    return nodeInvocationForWindowsCmd(cmdPath);
  }

  return { command: "codex", argsPrefix: [], display: "codex" };
}

function featureArgs() {
  const features = (process.env.CCH_CODEX_E2E_FEATURES ?? defaultFeatures)
    .split(",")
    .map((feature) => feature.trim())
    .filter(Boolean);
  return features.flatMap((feature) => ["--enable", feature]);
}

function spawnCodex(
  port: number,
  invocation: CodexInvocation,
  options: CodexRunOptions = {}
): RunningCodexProcess {
  const baseUrl = `http://127.0.0.1:${port}/v1`;
  const args = [
    ...invocation.argsPrefix,
    "exec",
    "--ignore-user-config",
    "--ignore-rules",
    "--ephemeral",
    "--skip-git-repo-check",
    "--json",
    ...featureArgs(),
    "-m",
    model,
    "-c",
    `model_provider="${providerName}"`,
    "-c",
    'preferred_auth_method="apikey"',
    "-c",
    'approval_policy="never"',
    "-c",
    'sandbox_mode="read-only"',
    "-c",
    `model_providers.${providerName}.name="${providerName}"`,
    "-c",
    `model_providers.${providerName}.base_url="${baseUrl}"`,
    "-c",
    `model_providers.${providerName}.wire_api="responses"`,
    "-c",
    `model_providers.${providerName}.supports_websockets=true`,
    "-c",
    `model_providers.${providerName}.requires_openai_auth=true`,
    ...(options.extraConfig ?? []).flatMap((config) => ["-c", config]),
    "-C",
    process.cwd(),
    options.prompt ?? `Reply exactly ${responseText} and do not run tools.`,
  ];

  const child = spawn(invocation.command, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY || "sk-cch-ws-e2e-placeholder",
      NO_COLOR: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  let stdout = "";
  let stderr = "";
  const result = new Promise<CodexResult>((resolve) => {
    let settled = false;
    const finish = (finished: CodexResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(finished);
    };
    const timeout = setTimeout(() => {
      stderr += "codex exec timed out";
      child.kill();
      finish({ code: -2, stdout, stderr });
    }, options.timeoutMs ?? 60_000);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (err) => {
      stderr += err instanceof Error ? err.message : String(err);
      finish({ code: -1, stdout, stderr });
    });
    child.on("close", (code) => finish({ code, stdout, stderr }));
  });

  return {
    child,
    result,
    stdout: () => stdout,
    stderr: () => stderr,
  };
}

function runCodex(
  port: number,
  invocation: CodexInvocation,
  options: CodexRunOptions = {}
): Promise<CodexResult> {
  return spawnCodex(port, invocation, options).result;
}

function isResponsesPath(path: string | undefined) {
  if (!path) return false;
  try {
    return new URL(path, "http://probe.local").pathname === "/v1/responses";
  } catch {
    return path.split("?")[0] === "/v1/responses";
  }
}

function observedTransport(events: ProbeEvent[]) {
  const sawResponsesWs = events.some(
    (event) =>
      (event.type === "ws_connection" || event.type === "ws_upgrade") && isResponsesPath(event.path)
  );
  if (sawResponsesWs) return "websocket";
  if (events.some((event) => event.type === "http_responses")) return "http";
  return "none";
}

type ServerJsModule = {
  handleWebSocketConnection: (ws: WebSocket, req: http.IncomingMessage) => Promise<void>;
};

type CchEdgeEvent =
  | { type: "server_started"; port: number }
  | { type: "http_models" }
  | { type: "ws_upgrade"; path: string }
  | { type: "ws_connection"; path: string | undefined }
  | { type: "ws_close"; code: number; reason: string }
  | {
      type: "internal_http_responses";
      bytes: number;
      generate: boolean | null;
      previousResponseId: string | null;
      sessionId: string | null;
      clientTransport: string | null;
    }
  | { type: "internal_response_close"; sessionId: string | null }
  | { type: "internal_request_aborted"; sessionId: string | null }
  | { type: "handler_error"; message: string };

type CchRequestContext = {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  bodyText: string;
  body: Record<string, unknown>;
  sessionId: string | null;
  responseClosed: Promise<void>;
  requestAborted: Promise<void>;
};

type CchEdgeHarness = {
  port: number;
  events: CchEdgeEvent[];
  setResponseHandler: (handler: (context: CchRequestContext) => void | Promise<void>) => void;
  nextInternalRequest: () => Promise<CchRequestContext>;
  close: () => Promise<void>;
};

type EnvSnapshot = {
  PORT: string | undefined;
  HOSTNAME: string | undefined;
  NODE_ENV: string | undefined;
  CCH_RESPONSES_WS_INTERNAL_SECRET: string | undefined;
};

type WsClientMessage = Record<string, unknown> | string;

type RawWsClient = {
  ws: WebSocket;
  opened: Promise<void>;
  closeEvent: Promise<{ code: number; reason: string }>;
  messages: WsClientMessage[];
  nextMessage: (
    predicate: (message: WsClientMessage) => boolean,
    timeoutMs: number,
    message: string
  ) => Promise<WsClientMessage>;
};

let cchFaultHarness: CchEdgeHarness | null = null;
let cchFaultEnv: EnvSnapshot | null = null;

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = http.createServer();
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (!address || typeof address !== "object") {
        probe.close();
        reject(new Error("failed to allocate local port"));
        return;
      }
      const port = address.port;
      probe.close(() => resolve(port));
    });
  });
}

function restoreEnvVar(name: keyof EnvSnapshot, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function captureEnv(): EnvSnapshot {
  return {
    PORT: process.env.PORT,
    HOSTNAME: process.env.HOSTNAME,
    NODE_ENV: process.env.NODE_ENV,
    CCH_RESPONSES_WS_INTERNAL_SECRET: process.env.CCH_RESPONSES_WS_INTERNAL_SECRET,
  };
}

function restoreEnv(snapshot: EnvSnapshot) {
  restoreEnvVar("PORT", snapshot.PORT);
  restoreEnvVar("HOSTNAME", snapshot.HOSTNAME);
  restoreEnvVar("NODE_ENV", snapshot.NODE_ENV);
  restoreEnvVar("CCH_RESPONSES_WS_INTERNAL_SECRET", snapshot.CCH_RESPONSES_WS_INTERNAL_SECRET);
}

function parseJsonObject(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore
  }
  return {};
}

function eventChunk(event: unknown): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function crlfEventChunk(event: unknown): string {
  return `event: ${(event as { type?: string }).type || "message"}\r\ndata: ${JSON.stringify(event)}\r\n\r\n`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseWsPayload(raw: RawData): WsClientMessage {
  const text = Array.isArray(raw)
    ? Buffer.concat(raw).toString("utf8")
    : Buffer.from(raw).toString("utf8");
  try {
    const parsed = JSON.parse(text);
    return isRecord(parsed) ? parsed : text;
  } catch {
    return text;
  }
}

function wsMessageType(message: WsClientMessage): string | null {
  return isRecord(message) && typeof message.type === "string" ? message.type : null;
}

function wsResponseId(message: WsClientMessage): string | null {
  if (!isRecord(message) || !isRecord(message.response)) return null;
  return typeof message.response.id === "string" ? message.response.id : null;
}

function wsErrorCode(message: WsClientMessage): string | null {
  if (!isRecord(message) || !isRecord(message.error)) return null;
  return typeof message.error.code === "string" ? message.error.code : null;
}

function completedResponse(responseId: string) {
  return (message: WsClientMessage) =>
    wsMessageType(message) === "response.completed" && wsResponseId(message) === responseId;
}

function errorEvent(code: string) {
  return (message: WsClientMessage) =>
    wsMessageType(message) === "error" && wsErrorCode(message) === code;
}

function connectRawWsClient(
  port: number,
  options: { path?: string; headers?: Record<string, string> } = {}
): RawWsClient {
  const messages: WsClientMessage[] = [];
  const waiters: Array<{
    predicate: (message: WsClientMessage) => boolean;
    resolve: (message: WsClientMessage) => void;
  }> = [];
  const ws = new WebSocket(`ws://127.0.0.1:${port}${options.path ?? "/v1/responses"}`, {
    headers: options.headers,
  });

  const opened = new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  const closeEvent = new Promise<{ code: number; reason: string }>((resolve) => {
    ws.once("close", (code, reason) => resolve({ code, reason: reason.toString("utf8") }));
  });

  ws.on("message", (raw) => {
    const parsed = parseWsPayload(raw);
    messages.push(parsed);
    for (let i = waiters.length - 1; i >= 0; i -= 1) {
      const waiter = waiters[i]!;
      if (waiter.predicate(parsed)) {
        waiters.splice(i, 1);
        waiter.resolve(parsed);
      }
    }
  });

  return {
    ws,
    opened,
    closeEvent,
    messages,
    nextMessage: (predicate, timeoutMs, message) => {
      const existing = messages.find(predicate);
      if (existing) return Promise.resolve(existing);
      return withTimeout(
        new Promise<WsClientMessage>((resolve) => waiters.push({ predicate, resolve })),
        timeoutMs,
        message
      );
    },
  };
}

function sendResponseCreate(client: RawWsClient, body: Record<string, unknown>) {
  client.ws.send(JSON.stringify({ type: "response.create", ...body }));
}

async function writeFragmentedSse(res: http.ServerResponse, events: unknown[], delayMs: number) {
  res.statusCode = 200;
  res.setHeader("content-type", "text/event-stream");
  res.setHeader("cache-control", "no-cache, no-transform");
  for (const event of events) {
    const chunk = eventChunk(event);
    const splitAt = Math.max(1, Math.floor(chunk.length / 2));
    res.write(chunk.slice(0, splitAt));
    await sleep(delayMs);
    res.write(chunk.slice(splitAt));
    await sleep(delayMs);
  }
  res.end();
}

async function startIsolatedCchEdgeHarness(secret?: string) {
  const port = await pickFreePort();
  const env = captureEnv();
  process.env.PORT = String(port);
  process.env.HOSTNAME = "127.0.0.1";
  process.env.NODE_ENV = "test";
  process.env.CCH_RESPONSES_WS_INTERNAL_SECRET = secret ?? `cch-ws-e2e-secret-${port}`;

  const serverPath = requireFromHere.resolve("../../server.js");
  delete requireFromHere.cache[serverPath];
  try {
    const serverModule = requireFromHere("../../server.js") as ServerJsModule;
    const harness = await startCchEdgeHarness(port, serverModule);
    return {
      harness,
      close: async () => {
        try {
          await harness.close();
        } finally {
          delete requireFromHere.cache[serverPath];
          restoreEnv(env);
        }
      },
    };
  } catch (err) {
    delete requireFromHere.cache[serverPath];
    restoreEnv(env);
    throw err;
  }
}

function retryDisabledConfig() {
  return [
    `model_providers.${providerName}.request_max_retries=0`,
    `model_providers.${providerName}.stream_max_retries=0`,
  ];
}

function assertNoResetWithoutClosingHandshake(result: CodexResult) {
  const combined = `${result.stdout}\n${result.stderr}`;
  expect(combined).not.toContain("Connection reset without closing handshake");
  expect(combined).not.toContain("reset without closing handshake");
}

async function startCchEdgeHarness(port: number, serverModule: ServerJsModule) {
  const events: CchEdgeEvent[] = [];
  const sockets = new Set<WebSocket>();
  const arrivedInternalRequests: CchRequestContext[] = [];
  const internalRequestWaiters: Array<(context: CchRequestContext) => void> = [];
  let responseHandler: ((context: CchRequestContext) => void | Promise<void>) | null = null;

  const record = (event: CchEdgeEvent) => {
    events.push(event);
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/v1/models") {
      record({ type: "http_models" });
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          object: "list",
          data: [{ id: model, object: "model", owned_by: "cch-ws-fault-e2e" }],
        })
      );
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/responses") {
      const sessionHeader = req.headers["x-cch-responses-ws-session"];
      const sessionId = Array.isArray(sessionHeader) ? sessionHeader[0] : sessionHeader || null;
      const responseClosed = deferred<void>();
      const requestAborted = deferred<void>();
      res.once("close", () => {
        record({ type: "internal_response_close", sessionId });
        responseClosed.resolve();
      });
      req.once("aborted", () => {
        record({ type: "internal_request_aborted", sessionId });
        requestAborted.resolve();
      });

      const bodyText = await readBody(req);
      const body = parseJsonObject(bodyText);
      const context: CchRequestContext = {
        req,
        res,
        bodyText,
        body,
        sessionId,
        responseClosed: responseClosed.promise,
        requestAborted: requestAborted.promise,
      };
      record({
        type: "internal_http_responses",
        bytes: Buffer.byteLength(bodyText, "utf8"),
        generate: typeof body.generate === "boolean" ? body.generate : null,
        previousResponseId:
          typeof body.previous_response_id === "string" ? body.previous_response_id : null,
        sessionId,
        clientTransport:
          typeof req.headers["x-cch-client-transport"] === "string"
            ? req.headers["x-cch-client-transport"]
            : null,
      });
      const waiter = internalRequestWaiters.shift();
      if (waiter) {
        waiter(context);
      } else {
        arrivedInternalRequests.push(context);
      }

      if (!responseHandler) {
        res.statusCode = 503;
        res.end("no response handler configured");
        return;
      }

      try {
        await responseHandler(context);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        record({ type: "handler_error", message });
        if (!res.headersSent) res.statusCode = 500;
        if (!res.writableEnded) res.end(message);
      }
      return;
    }

    res.statusCode = 404;
    res.end("not found");
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 * 1024 });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    record({ type: "ws_upgrade", path: url.pathname });
    if (url.pathname !== "/v1/responses") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      sockets.add(ws);
      record({ type: "ws_connection", path: req.url });
      ws.once("close", (code, reason) => {
        sockets.delete(ws);
        record({ type: "ws_close", code, reason: reason.toString("utf8") });
      });
      serverModule.handleWebSocketConnection(ws, req).catch((err) => {
        record({
          type: "handler_error",
          message: err instanceof Error ? err.message : String(err),
        });
        try {
          ws.close(1011, "internal_error");
        } catch {
          ws.terminate();
        }
      });
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  record({ type: "server_started", port });

  return {
    port,
    events,
    setResponseHandler: (handler) => {
      arrivedInternalRequests.length = 0;
      internalRequestWaiters.length = 0;
      responseHandler = handler;
    },
    nextInternalRequest: () => {
      const arrived = arrivedInternalRequests.shift();
      if (arrived) return Promise.resolve(arrived);
      return new Promise<CchRequestContext>((resolve) => {
        internalRequestWaiters.push(resolve);
      });
    },
    close: async () => {
      for (const socket of sockets) {
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
          socket.close(1000, "test_done");
        }
      }
      const forceClose = setTimeout(() => {
        for (const socket of sockets) socket.terminate();
      }, 250);
      await new Promise<void>((resolve) =>
        wss.close(() => {
          clearTimeout(forceClose);
          resolve();
        })
      );
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  } satisfies CchEdgeHarness;
}

function cchInternalRequests(events: CchEdgeEvent[]) {
  return events.filter(
    (event): event is Extract<CchEdgeEvent, { type: "internal_http_responses" }> =>
      event.type === "internal_http_responses"
  );
}

function cchWsCloses(events: CchEdgeEvent[]) {
  return events.filter(
    (event): event is Extract<CchEdgeEvent, { type: "ws_close" }> => event.type === "ws_close"
  );
}

describe("CCH Responses WebSocket edge E2E", () => {
  test("serializes pipelined response.create frames and keeps the socket reusable", async () => {
    const { harness, close } = await startIsolatedCchEdgeHarness();
    try {
      let activeRequests = 0;
      let maxActiveRequests = 0;
      harness.setResponseHandler(async ({ res, body }) => {
        activeRequests += 1;
        maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
        const input = typeof body.input === "string" ? body.input : "unknown";
        res.statusCode = 200;
        res.setHeader("content-type", "text/event-stream");
        res.write(eventChunk({ type: "response.created", response: { id: `resp_${input}` } }));
        if (input === "first") await sleep(75);
        res.write(
          eventChunk({
            type: "response.completed",
            response: responseEnvelope(`resp_${input}`, true),
          })
        );
        res.end();
        activeRequests -= 1;
      });

      const client = connectRawWsClient(harness.port);
      await client.opened;
      sendResponseCreate(client, { model, input: "first" });
      sendResponseCreate(client, { model, input: "second", previous_response_id: "resp_first" });

      await client.nextMessage(completedResponse("resp_first"), 3000, "first turn did not finish");
      expect(client.ws.readyState).toBe(WebSocket.OPEN);
      await client.nextMessage(
        completedResponse("resp_second"),
        3000,
        "second turn did not finish"
      );

      const internalRequests = cchInternalRequests(harness.events);
      expect(internalRequests).toHaveLength(2);
      expect(new Set(internalRequests.map((event) => event.sessionId)).size).toBe(1);
      expect(internalRequests[1]?.previousResponseId).toBe("resp_first");
      expect(maxActiveRequests).toBe(1);
      client.ws.close(1000, "test_done");
      await client.closeEvent;
    } finally {
      await close();
    }
  });

  test("turns non-SSE JSON success and error responses into visible WS events", async () => {
    const { harness, close } = await startIsolatedCchEdgeHarness();
    try {
      harness.setResponseHandler(({ res, body }) => {
        res.setHeader("content-type", "application/json");
        if (body.input === "json-error") {
          res.statusCode = 429;
          res.end(
            JSON.stringify({
              error: { code: "rate_limit_exceeded", message: "synthetic rate limit" },
            })
          );
          return;
        }
        res.statusCode = 200;
        res.end(JSON.stringify(responseEnvelope("resp_json_ok", true)));
      });

      const client = connectRawWsClient(harness.port);
      await client.opened;
      sendResponseCreate(client, { model, input: "json-ok" });
      await client.nextMessage(
        completedResponse("resp_json_ok"),
        3000,
        "JSON success was not translated to response.completed"
      );

      sendResponseCreate(client, { model, input: "json-error" });
      const error = await client.nextMessage(
        errorEvent("rate_limit_exceeded"),
        3000,
        "JSON error was not translated to an error event"
      );
      expect(isRecord(error) ? error.status : null).toBe(429);
      expect(client.ws.readyState).toBe(WebSocket.OPEN);
      client.ws.close(1000, "test_done");
      await client.closeEvent;
    } finally {
      await close();
    }
  });

  test("handles CRLF fragmented SSE and [DONE] without poisoning the connection", async () => {
    const { harness, close } = await startIsolatedCchEdgeHarness();
    try {
      harness.setResponseHandler(async ({ res, body }) => {
        res.statusCode = 200;
        res.setHeader("content-type", "text/event-stream");
        res.setHeader("cache-control", "no-cache, no-transform");
        if (body.input === "done-only") {
          res.write("data: [DONE]\r\n\r\n");
          res.end();
          return;
        }
        for (const event of responseEvents("resp_crlf_fragmented", true)) {
          const chunk = crlfEventChunk(event);
          res.write(chunk.slice(0, 7));
          await sleep(2);
          res.write(chunk.slice(7));
        }
        res.end();
      });

      const client = connectRawWsClient(harness.port);
      await client.opened;
      sendResponseCreate(client, { model, input: "crlf-fragmented" });
      await client.nextMessage(
        completedResponse("resp_crlf_fragmented"),
        3000,
        "CRLF fragmented SSE did not complete"
      );

      sendResponseCreate(client, { model, input: "done-only" });
      const doneOnly = await client.nextMessage(
        (message) =>
          wsMessageType(message) === "response.completed" &&
          isRecord(message) &&
          message.response === null,
        3000,
        "[DONE] fallback did not synthesize response.completed"
      );
      expect(doneOnly).toMatchObject({ type: "response.completed", response: null });
      expect(client.ws.readyState).toBe(WebSocket.OPEN);
      client.ws.close(1000, "test_done");
      await client.closeEvent;
    } finally {
      await close();
    }
  });

  test("sends a diagnostic error and close handshake when SSE ends without a terminal event", async () => {
    const { harness, close } = await startIsolatedCchEdgeHarness();
    try {
      harness.setResponseHandler(({ res }) => {
        res.statusCode = 200;
        res.setHeader("content-type", "text/event-stream");
        res.write(eventChunk({ type: "response.created", response: { id: "resp_no_terminal" } }));
        res.end();
      });

      const client = connectRawWsClient(harness.port);
      await client.opened;
      sendResponseCreate(client, { model, input: "no-terminal" });
      await client.nextMessage(
        errorEvent("stream_ended_without_terminal"),
        3000,
        "missing terminal event did not surface as error"
      );
      const closeEvent = await client.closeEvent;
      expect(closeEvent).toEqual({ code: 1011, reason: "stream_ended_without_terminal" });
    } finally {
      await close();
    }
  });

  test("sends an error frame before closing when the internal response hard-drops", async () => {
    const { harness, close } = await startIsolatedCchEdgeHarness();
    try {
      harness.setResponseHandler(({ res }) => {
        res.statusCode = 200;
        res.setHeader("content-type", "text/event-stream");
        res.write(eventChunk({ type: "response.created", response: { id: "resp_hard_drop" } }));
        setTimeout(() => res.socket?.destroy(), 10);
      });

      const client = connectRawWsClient(harness.port);
      await client.opened;
      sendResponseCreate(client, { model, input: "hard-drop" });
      await client.nextMessage(
        (message) =>
          wsMessageType(message) === "error" &&
          ["internal_response_aborted", "internal_response_closed"].includes(
            wsErrorCode(message) ?? ""
          ),
        3000,
        "hard-dropped response did not surface as a diagnostic error"
      );
      const closeEvent = await client.closeEvent;
      expect(closeEvent.code).toBe(1011);
      expect(["internal_response_aborted", "internal_response_closed"]).toContain(
        closeEvent.reason
      );
    } finally {
      await close();
    }
  });

  test("aborts the in-flight internal request and drops queued frames when a client vanishes", async () => {
    const { harness, close } = await startIsolatedCchEdgeHarness();
    try {
      const firstResponseClosed = deferred<void>();
      harness.setResponseHandler(({ res }) => {
        res.statusCode = 200;
        res.setHeader("content-type", "text/event-stream");
        res.write(":\n\n");
        res.once("close", () => firstResponseClosed.resolve());
      });

      const client = connectRawWsClient(harness.port);
      await client.opened;
      sendResponseCreate(client, { model, input: "in-flight" });
      await withTimeout(
        harness.nextInternalRequest(),
        3000,
        "first internal request did not start"
      );
      for (let i = 0; i < 8; i += 1) {
        sendResponseCreate(client, { model, input: `queued-${i}` });
      }
      client.ws.terminate();

      await withTimeout(
        firstResponseClosed.promise,
        3000,
        "client disappearance did not close the in-flight internal response"
      );
      await client.closeEvent;
      expect(cchInternalRequests(harness.events)).toHaveLength(1);
    } finally {
      await close();
    }
  });

  test("strips forged x-cch headers and injects only trusted tunnel markers", async () => {
    const secret = "trusted-cch-ws-e2e-secret";
    const { harness, close } = await startIsolatedCchEdgeHarness(secret);
    try {
      harness.setResponseHandler(({ req, res, sessionId }) => {
        expect(req.headers["x-cch-client-transport"]).toBe("websocket");
        expect(req.headers["x-cch-responses-ws-forward"]).toBe("1");
        expect(req.headers["x-cch-internal-secret"]).toBe(secret);
        expect(sessionId).not.toBe("forged-session");
        res.statusCode = 200;
        res.setHeader("content-type", "text/event-stream");
        res.write(
          eventChunk({
            type: "response.completed",
            response: responseEnvelope("resp_header_strip", true),
          })
        );
        res.end();
      });

      const client = connectRawWsClient(harness.port, {
        headers: {
          "x-cch-client-transport": "http",
          "x-cch-internal-secret": "forged-secret",
          "x-cch-responses-ws-forward": "forged-forward",
          "x-cch-responses-ws-session": "forged-session",
        },
      });
      await client.opened;
      sendResponseCreate(client, { model, input: "headers" });
      await client.nextMessage(
        completedResponse("resp_header_strip"),
        3000,
        "trusted tunnel header test did not complete"
      );
      client.ws.close(1000, "test_done");
      await client.closeEvent;
    } finally {
      await close();
    }
  });

  test("keeps large requests under the payload cap and removes transport-only fields", async () => {
    const { harness, close } = await startIsolatedCchEdgeHarness();
    try {
      const largeInput = "x".repeat(512 * 1024);
      harness.setResponseHandler(({ body, res }) => {
        expect(body.model).toBe(model);
        expect(body.stream).toBe(true);
        expect(body.background).toBeUndefined();
        expect(typeof body.input === "string" ? body.input.length : 0).toBe(largeInput.length);
        res.statusCode = 200;
        res.setHeader("content-type", "text/event-stream");
        res.write(
          eventChunk({
            type: "response.completed",
            response: responseEnvelope("resp_large_payload", true),
          })
        );
        res.end();
      });

      const client = connectRawWsClient(harness.port, {
        path: `/v1/responses?model=${encodeURIComponent(model)}&api_key=should_not_matter`,
      });
      await client.opened;
      sendResponseCreate(client, { input: largeInput, background: true });
      await client.nextMessage(
        completedResponse("resp_large_payload"),
        5000,
        "large request did not complete"
      );
      client.ws.close(1000, "test_done");
      await client.closeEvent;
    } finally {
      await close();
    }
  });

  test("reports recoverable client protocol mistakes without poisoning later turns", async () => {
    const { harness, close } = await startIsolatedCchEdgeHarness();
    try {
      harness.setResponseHandler(({ res }) => {
        res.statusCode = 200;
        res.setHeader("content-type", "text/event-stream");
        res.write(
          eventChunk({
            type: "response.completed",
            response: responseEnvelope("resp_after_bad_frame", true),
          })
        );
        res.end();
      });

      const client = connectRawWsClient(harness.port);
      await client.opened;
      client.ws.send("{not-json");
      await client.nextMessage(errorEvent("invalid_json"), 3000, "invalid JSON was not reported");
      client.ws.send(JSON.stringify({ type: "session.update" }));
      await client.nextMessage(
        errorEvent("unsupported_event_type"),
        3000,
        "unsupported event type was not reported"
      );
      sendResponseCreate(client, { model, input: "after-bad-frame" });
      await client.nextMessage(
        completedResponse("resp_after_bad_frame"),
        3000,
        "valid turn after recoverable protocol mistakes did not complete"
      );
      client.ws.close(1000, "test_done");
      await client.closeEvent;
    } finally {
      await close();
    }
  });

  test("closes with policy diagnostics on binary frames and queue overflow", async () => {
    const { harness, close } = await startIsolatedCchEdgeHarness();
    try {
      harness.setResponseHandler(({ res }) => {
        res.statusCode = 200;
        res.setHeader("content-type", "text/event-stream");
        res.write(":\n\n");
      });

      const binaryClient = connectRawWsClient(harness.port);
      await binaryClient.opened;
      binaryClient.ws.send(Buffer.from("binary"), { binary: true });
      await binaryClient.nextMessage(
        errorEvent("invalid_frame_type"),
        3000,
        "binary frame was not reported"
      );
      expect(await binaryClient.closeEvent).toEqual({
        code: 1003,
        reason: "binary_not_supported",
      });

      const overflowClient = connectRawWsClient(harness.port);
      await overflowClient.opened;
      sendResponseCreate(overflowClient, { model, input: "first" });
      await withTimeout(
        harness.nextInternalRequest(),
        3000,
        "overflow baseline request did not start"
      );
      for (let i = 0; i < 70; i += 1) {
        sendResponseCreate(overflowClient, { model, input: `overflow-${i}` });
      }
      await overflowClient.nextMessage(
        errorEvent("too_many_requests"),
        3000,
        "queue overflow was not reported"
      );
      expect(await overflowClient.closeEvent).toEqual({
        code: 1008,
        reason: "too_many_requests",
      });
    } finally {
      await close();
    }
  });
});

run("Codex CLI Responses transport probe", () => {
  test("records whether Codex reaches /v1/responses over HTTP or WebSocket", async () => {
    const expectedTransport = (process.env.CCH_CODEX_E2E_EXPECT_TRANSPORT || "any").toLowerCase();
    expect(["any", "http", "websocket"]).toContain(expectedTransport);

    const probe = await startProbeServer();
    try {
      const invocation = resolveCodexInvocation();
      const result = await runCodex(probe.port, invocation);
      const transport = observedTransport(probe.events);
      const sawFinalText =
        result.stdout.includes(responseText) || result.stderr.includes(responseText);
      const wsMessages = probe.events.filter((event) => event.type === "ws_message");
      const wsConnections = probe.events.filter((event) => event.type === "ws_connection");
      const sawWarmup = wsMessages.some((event) => event.generate === false);

      console.info(
        JSON.stringify({
          probe: "codex_responses_transport",
          codexCommand: invocation.display,
          codexLauncher: invocation.command,
          expectedTransport,
          observedTransport: transport,
          events: probe.events,
          exitCode: result.code,
        })
      );

      if (result.code !== 0 || !sawFinalText || transport === "none") {
        throw new Error(
          JSON.stringify(
            {
              error: "codex_transport_probe_failed",
              exitCode: result.code,
              sawFinalText,
              observedTransport: transport,
              events: probe.events,
              stderrTail: result.stderr.slice(-2000),
            },
            null,
            2
          )
        );
      }

      if (expectedTransport !== "any") {
        expect(transport).toBe(expectedTransport);
      }
      if (transport === "websocket") {
        expect(wsMessages.length).toBeGreaterThan(0);
        if (sawWarmup && wsMessages.length >= 2) {
          expect(wsConnections).toHaveLength(1);
          expect(wsMessages[1]?.previousResponseId).toBeTruthy();
        }
      }
    } finally {
      await probe.close();
    }
  }, 70_000);
});

faultRun("Codex CLI through CCH WebSocket fault injection", () => {
  let invocation: CodexInvocation;
  let cchFaultServerPath: string | null = null;

  beforeAll(async () => {
    invocation = resolveCodexInvocation();
    const port = await pickFreePort();
    cchFaultEnv = captureEnv();
    process.env.PORT = String(port);
    process.env.HOSTNAME = "127.0.0.1";
    process.env.NODE_ENV = "test";
    process.env.CCH_RESPONSES_WS_INTERNAL_SECRET = `cch-ws-fault-secret-${port}`;

    cchFaultServerPath = requireFromHere.resolve("../../server.js");
    delete requireFromHere.cache[cchFaultServerPath];
    const serverModule = requireFromHere("../../server.js") as ServerJsModule;
    cchFaultHarness = await startCchEdgeHarness(port, serverModule);
  });

  afterAll(async () => {
    try {
      if (cchFaultHarness) {
        await cchFaultHarness.close();
      }
    } finally {
      cchFaultHarness = null;
      if (cchFaultServerPath) {
        delete requireFromHere.cache[cchFaultServerPath];
        cchFaultServerPath = null;
      }
      if (cchFaultEnv) {
        restoreEnv(cchFaultEnv);
        cchFaultEnv = null;
      }
    }
  });

  test("survives fragmented and delayed upstream SSE chunks through the CCH tunnel", async () => {
    if (!cchFaultHarness) throw new Error("CCH fault harness is not initialized");
    cchFaultHarness.events.length = 0;
    let responseSeq = 0;
    cchFaultHarness.setResponseHandler(async ({ res, body }) => {
      responseSeq += 1;
      const includeOutput = body.generate !== false;
      await writeFragmentedSse(
        res,
        responseEvents(`resp_cch_fault_fragmented_${responseSeq}`, includeOutput),
        8
      );
    });

    const result = await runCodex(cchFaultHarness.port, invocation, { timeoutMs: 90_000 });
    const internalRequests = cchInternalRequests(cchFaultHarness.events);
    const sawFinalText =
      result.stdout.includes(responseText) || result.stderr.includes(responseText);
    const sawWarmup = internalRequests.some((event) => event.generate === false);
    const generatedAfterWarmup = internalRequests.find((event) => event.generate !== false);

    console.info(
      JSON.stringify({
        probe: "codex_cch_ws_fragmented_delayed_sse",
        exitCode: result.code,
        internalRequests,
        wsCloses: cchWsCloses(cchFaultHarness.events),
      })
    );

    expect(result.code).toBe(0);
    expect(sawFinalText).toBe(true);
    assertNoResetWithoutClosingHandshake(result);
    expect(internalRequests.some((event) => event.clientTransport === "websocket")).toBe(true);
    if (sawWarmup) {
      expect(generatedAfterWarmup?.previousResponseId).toBeTruthy();
    }
  }, 90_000);

  test("surfaces abrupt upstream response destruction to Codex without reset noise", async () => {
    if (!cchFaultHarness) throw new Error("CCH fault harness is not initialized");
    cchFaultHarness.events.length = 0;
    cchFaultHarness.setResponseHandler(({ res }) => {
      res.statusCode = 200;
      res.setHeader("content-type", "text/event-stream");
      res.write(
        eventChunk({
          type: "response.created",
          response: { id: "resp_cch_fault_destroyed" },
        })
      );
      setTimeout(() => {
        res.socket?.destroy();
      }, 10);
    });

    const result = await runCodex(cchFaultHarness.port, invocation, {
      timeoutMs: 90_000,
      extraConfig: retryDisabledConfig(),
    });
    const closes = cchWsCloses(cchFaultHarness.events);

    console.info(
      JSON.stringify({
        probe: "codex_cch_ws_upstream_hard_disconnect",
        exitCode: result.code,
        internalRequests: cchInternalRequests(cchFaultHarness.events),
        wsCloses: closes,
        stderrTail: result.stderr.slice(-1200),
      })
    );

    expect(result.code).not.toBe(0);
    assertNoResetWithoutClosingHandshake(result);
    expect(closes.length).toBeGreaterThan(0);
    expect(cchFaultHarness.events.some((event) => event.type === "internal_response_close")).toBe(
      true
    );
  }, 90_000);

  test("aborts the internal response when the real Codex client process disappears", async () => {
    if (!cchFaultHarness) throw new Error("CCH fault harness is not initialized");
    cchFaultHarness.events.length = 0;
    cchFaultHarness.setResponseHandler(({ res }) => {
      res.statusCode = 200;
      res.setHeader("content-type", "text/event-stream");
      res.write(":\n\n");
    });

    const internalRequestPromise = cchFaultHarness.nextInternalRequest();
    const running = spawnCodex(cchFaultHarness.port, invocation, {
      timeoutMs: 60_000,
      extraConfig: retryDisabledConfig(),
      prompt: `Reply exactly ${responseText} after waiting for the stream.`,
    });
    const internalRequest = await withTimeout(
      internalRequestPromise,
      15_000,
      "Codex did not open an internal CCH tunnel request before client-drop simulation"
    );
    await sleep(50);
    running.child.kill();

    await withTimeout(
      internalRequest.responseClosed,
      15_000,
      "CCH did not abort the in-flight internal response after client process exit"
    );
    const result = await running.result;

    console.info(
      JSON.stringify({
        probe: "codex_cch_ws_client_process_disappears",
        exitCode: result.code,
        internalRequest: {
          generate:
            typeof internalRequest.body.generate === "boolean"
              ? internalRequest.body.generate
              : null,
          sessionId: internalRequest.sessionId,
        },
        wsCloses: cchWsCloses(cchFaultHarness.events),
      })
    );

    expect(result.code).not.toBe(0);
    expect(cchInternalRequests(cchFaultHarness.events).length).toBeGreaterThan(0);
    expect(cchWsCloses(cchFaultHarness.events).length).toBeGreaterThan(0);
  }, 90_000);
});

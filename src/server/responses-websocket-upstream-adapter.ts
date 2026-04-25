import { createHash, randomBytes } from "node:crypto";
import { connect as connectTcp, type Socket } from "node:net";
import { connect as connectTls, type TLSSocket } from "node:tls";
import { buildProxyUrl } from "@/app/v1/_lib/url";
import type { Provider } from "@/types/provider";
import type {
  ResponsesWebSocketExecutorInput,
  ResponsesWebSocketJsonEvent,
} from "./responses-websocket-protocol";
import { RESPONSES_WEBSOCKET_PATH } from "./responses-websocket-runtime";

const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const DEFAULT_CODEX_USER_AGENT = "codex_cli_rs/0.93.0 (Windows 10.0.26200; x86_64) vscode/1.108.1";
const DEFAULT_UNSUPPORTED_TTL_MS = 60_000;
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const MAX_UPSTREAM_HANDSHAKE_HEADER_BYTES = 32 * 1024;
const MAX_HANDSHAKE_BODY_BYTES = 32 * 1024;
const MAX_UPSTREAM_WEBSOCKET_PAYLOAD_BYTES = 1024 * 1024;
const MAX_UPSTREAM_WEBSOCKET_READ_BUFFER_BYTES = MAX_UPSTREAM_WEBSOCKET_PAYLOAD_BYTES + 14;
const TERMINAL_EVENT_TYPES = new Set([
  "response.completed",
  "response.failed",
  "response.incomplete",
  "error",
]);

type NodeWebSocketSocket = Socket | TLSSocket;

type DecodedWebSocketFrame = {
  opcode: number;
  payload: Buffer;
};

export type ResponsesWebSocketClientTransport = "websocket" | "http";

export type ResponsesWebSocketUpstreamSkipReason =
  | "global_disabled"
  | "non_codex_provider"
  | "non_websocket_client"
  | "not_client_ws_path"
  | "ws_unsupported_cached";

export type ResponsesWebSocketUnsupportedReason =
  | "handshake_status_404"
  | "handshake_status_426"
  | "handshake_unsupported"
  | "close_before_first_frame";

export type ResponsesWebSocketUnsupportedCacheKey = {
  providerId: number;
  endpointId?: number | null;
  endpointUrl: string;
};

export type ResponsesWebSocketUnsupportedCacheOptions = {
  ttlMs?: number;
  now?: () => number;
};

export type ResponsesWebSocketUpstreamAdapterOptions = {
  input: ResponsesWebSocketExecutorInput;
  provider: Provider;
  globalEnabled: boolean;
  clientTransport: ResponsesWebSocketClientTransport;
  endpointId?: number | null;
  endpointUrl?: string | null;
  unsupportedCache?: ResponsesWebSocketUnsupportedCache;
  connectTimeoutMs?: number;
};

export type ResponsesWebSocketUpstreamConnectedResult = {
  type: "connected";
  upstreamUrl: string;
  events: AsyncIterable<ResponsesWebSocketJsonEvent>;
};

export type ResponsesWebSocketUpstreamSkippedResult = {
  type: "skipped";
  reason: ResponsesWebSocketUpstreamSkipReason;
  upstreamUrl?: string;
};

export type ResponsesWebSocketUpstreamAdapterResult =
  | ResponsesWebSocketUpstreamConnectedResult
  | ResponsesWebSocketUpstreamSkippedResult;

type ResponsesWebSocketUpstreamGateAvailable = {
  ok: true;
  upstreamUrl: string;
  cacheKey: ResponsesWebSocketUnsupportedCacheKey;
};

export type ResponsesWebSocketUpstreamGateDecision =
  | ResponsesWebSocketUpstreamGateAvailable
  | { ok: false; reason: ResponsesWebSocketUpstreamSkipReason; upstreamUrl?: string };

export class ResponsesWebSocketUnsupportedError extends Error {
  readonly code = "upstream_ws_unsupported";
  readonly fallbackSafe = true;

  constructor(
    message: string,
    public readonly unsupportedReason: ResponsesWebSocketUnsupportedReason
  ) {
    super(message);
    this.name = "ResponsesWebSocketUnsupportedError";
  }
}

export class ResponsesWebSocketUpstreamError extends Error {
  readonly code = "upstream_ws_error";
  readonly fallbackSafe = false;

  constructor(message: string) {
    super(message);
    this.name = "ResponsesWebSocketUpstreamError";
  }
}

export class ResponsesWebSocketUnsupportedCache {
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly entries = new Map<
    string,
    { expiresAt: number; reason: ResponsesWebSocketUnsupportedReason }
  >();

  constructor(options: ResponsesWebSocketUnsupportedCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_UNSUPPORTED_TTL_MS;
    this.now = options.now ?? (() => Date.now());
  }

  markUnsupported(
    key: ResponsesWebSocketUnsupportedCacheKey,
    reason: ResponsesWebSocketUnsupportedReason
  ): void {
    this.entries.set(this.toKey(key), {
      expiresAt: this.now() + this.ttlMs,
      reason,
    });
  }

  isUnsupported(key: ResponsesWebSocketUnsupportedCacheKey): boolean {
    return this.getUnsupportedReason(key) !== null;
  }

  getUnsupportedReason(
    key: ResponsesWebSocketUnsupportedCacheKey
  ): ResponsesWebSocketUnsupportedReason | null {
    const cacheKey = this.toKey(key);
    const entry = this.entries.get(cacheKey);
    if (!entry) return null;

    if (entry.expiresAt <= this.now()) {
      this.entries.delete(cacheKey);
      return null;
    }

    return entry.reason;
  }

  private toKey(key: ResponsesWebSocketUnsupportedCacheKey): string {
    return `${key.providerId}:${key.endpointId ?? "provider"}:${key.endpointUrl}`;
  }
}

export const responsesWebSocketUnsupportedCache = new ResponsesWebSocketUnsupportedCache();

export type ResponsesWebSocketUpstreamUrlOptions = {
  litellmQueryModelCompatibility?: boolean;
};

export function buildResponsesWebSocketUpstreamUrl(
  providerBaseUrl: string,
  requestUrl: string | URL,
  options: ResponsesWebSocketUpstreamUrlOptions = {}
): string {
  const normalizedRequestUrl = new URL(requestUrl.toString(), "http://localhost");
  if (!options.litellmQueryModelCompatibility) {
    normalizedRequestUrl.searchParams.delete("model");
  }

  const upstreamUrl = new URL(buildProxyUrl(providerBaseUrl, normalizedRequestUrl));

  if (upstreamUrl.protocol === "https:") {
    upstreamUrl.protocol = "wss:";
  } else if (upstreamUrl.protocol === "http:") {
    upstreamUrl.protocol = "ws:";
  } else if (upstreamUrl.protocol !== "ws:" && upstreamUrl.protocol !== "wss:") {
    throw new ResponsesWebSocketUpstreamError(
      `Unsupported upstream Responses WebSocket protocol: ${upstreamUrl.protocol}`
    );
  }

  return upstreamUrl.toString();
}

export function resolveResponsesWebSocketUpstreamDecision(
  options: ResponsesWebSocketUpstreamAdapterOptions
): ResponsesWebSocketUpstreamGateDecision {
  if (!options.globalEnabled) return { ok: false, reason: "global_disabled" };
  if (options.provider.providerType !== "codex") return { ok: false, reason: "non_codex_provider" };
  if (options.clientTransport !== "websocket") {
    return { ok: false, reason: "non_websocket_client" };
  }
  if (!isResponsesWebSocketClientPath(options.input.requestUrl)) {
    return { ok: false, reason: "not_client_ws_path" };
  }

  const upstreamUrl = buildResponsesWebSocketUpstreamUrl(
    options.provider.url,
    options.input.requestUrl,
    {
      litellmQueryModelCompatibility: isLiteLlmQueryModelCompatibilityProvider(options.provider),
    }
  );
  const cacheKey = {
    providerId: options.provider.id,
    endpointId: options.endpointId ?? null,
    endpointUrl: options.endpointUrl ?? upstreamUrl,
  } satisfies ResponsesWebSocketUnsupportedCacheKey;
  const cache = options.unsupportedCache ?? responsesWebSocketUnsupportedCache;

  if (cache.isUnsupported(cacheKey)) {
    return { ok: false, reason: "ws_unsupported_cached", upstreamUrl };
  }

  return { ok: true, upstreamUrl, cacheKey };
}

export function createResponsesWebSocketUpstreamEventStream(
  options: ResponsesWebSocketUpstreamAdapterOptions
): ResponsesWebSocketUpstreamAdapterResult {
  const decision = resolveResponsesWebSocketUpstreamDecision(options);
  if (!decision.ok) {
    return {
      type: "skipped",
      reason: decision.reason,
      upstreamUrl: decision.upstreamUrl,
    };
  }

  return {
    type: "connected",
    upstreamUrl: decision.upstreamUrl,
    events: streamResponsesWebSocketUpstreamEvents(options, decision),
  };
}

async function* streamResponsesWebSocketUpstreamEvents(
  options: ResponsesWebSocketUpstreamAdapterOptions,
  decision: ResponsesWebSocketUpstreamGateAvailable
): AsyncIterable<ResponsesWebSocketJsonEvent> {
  const cache = options.unsupportedCache ?? responsesWebSocketUnsupportedCache;
  let connection: NodeWebSocketConnection | null = null;
  let hasFirstJsonEvent = false;
  let sawTerminalEvent = false;

  try {
    connection = await openNodeWebSocketConnection({
      upstreamUrl: decision.upstreamUrl,
      headers: buildResponsesWebSocketUpstreamHeaders(options),
      connectTimeoutMs: options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
      signal: options.input.executionContext.clientAbortSignal ?? null,
    });

    connection.sendText(
      JSON.stringify(createUpstreamResponseCreateFrame(options.input.upstreamBody))
    );

    while (true) {
      const frame = await connection.readFrame();
      if (!frame) {
        if (!hasFirstJsonEvent) {
          throw new ResponsesWebSocketUnsupportedError(
            "Upstream Responses WebSocket closed before the first JSON event",
            "close_before_first_frame"
          );
        }
        if (!sawTerminalEvent) {
          throw new ResponsesWebSocketUpstreamError(
            "Upstream Responses WebSocket closed before a terminal event"
          );
        }
        return;
      }

      if (frame.opcode === 0x8) {
        if (!hasFirstJsonEvent) {
          throw new ResponsesWebSocketUnsupportedError(
            "Upstream Responses WebSocket sent close before the first JSON event",
            "close_before_first_frame"
          );
        }
        if (!sawTerminalEvent) {
          throw new ResponsesWebSocketUpstreamError(
            "Upstream Responses WebSocket sent close before a terminal event"
          );
        }
        return;
      }

      if (frame.opcode === 0x9) {
        connection.sendPong(frame.payload);
        continue;
      }

      if (frame.opcode === 0xa) continue;
      if (frame.opcode !== 0x1) {
        throw new ResponsesWebSocketUpstreamError(
          "Upstream Responses WebSocket sent a non-text frame"
        );
      }

      const event = parseResponsesWebSocketJsonEvent(frame.payload.toString("utf8"));
      hasFirstJsonEvent = true;
      yield event;

      if (isTerminalResponsesWebSocketEvent(event)) {
        sawTerminalEvent = true;
        return;
      }
    }
  } catch (error) {
    if (error instanceof ResponsesWebSocketUnsupportedError) {
      cache.markUnsupported(decision.cacheKey, error.unsupportedReason);
    }
    throw error;
  } finally {
    connection?.close();
  }
}

function createUpstreamResponseCreateFrame(
  upstreamBody: ResponsesWebSocketExecutorInput["upstreamBody"]
): Record<string, unknown> {
  const { stream, background, type, ...bodyWithoutTransportFields } = upstreamBody;
  void stream;
  void background;
  void type;

  return {
    type: "response.create",
    ...bodyWithoutTransportFields,
  };
}

function buildResponsesWebSocketUpstreamHeaders(
  options: ResponsesWebSocketUpstreamAdapterOptions
): Headers {
  const clientHeaders = new Headers(options.input.executionContext.headers ?? undefined);
  const headers = new Headers();
  const userAgent = clientHeaders.get("user-agent") ?? DEFAULT_CODEX_USER_AGENT;

  headers.set("authorization", `Bearer ${options.provider.key}`);
  headers.set("user-agent", userAgent);
  headers.set("content-type", "application/json");
  headers.set("accept", "application/json");

  return headers;
}

async function openNodeWebSocketConnection(options: {
  upstreamUrl: string;
  headers: Headers;
  connectTimeoutMs: number;
  signal: AbortSignal | null;
}): Promise<NodeWebSocketConnection> {
  const upstreamUrl = new URL(options.upstreamUrl);
  const socket = await createConnectedSocket(upstreamUrl, options.connectTimeoutMs, options.signal);
  const websocketKey = randomBytes(16).toString("base64");
  const request = buildHandshakeRequest(upstreamUrl, websocketKey, options.headers);
  try {
    socket.write(request);

    const handshake = await readHandshakeResponse(socket, options.connectTimeoutMs, options.signal);
    const statusCode = parseHandshakeStatusCode(handshake.headerText);

    if (statusCode !== 101) {
      const handshakeBody = await readNonSwitchingHandshakeBody({
        socket,
        headerText: handshake.headerText,
        initialBody: handshake.remaining,
        timeoutMs: options.connectTimeoutMs,
        signal: options.signal,
      });
      socket.destroy();
      const unsupportedReason = classifyUnsupportedHandshake(
        statusCode,
        `${handshake.headerText}${handshakeBody.toString("utf8")}`
      );
      if (unsupportedReason) {
        throw new ResponsesWebSocketUnsupportedError(
          `Upstream Responses WebSocket handshake returned ${statusCode}`,
          unsupportedReason
        );
      }
      throw new ResponsesWebSocketUpstreamError(
        `Upstream Responses WebSocket handshake returned ${statusCode}`
      );
    }

    const acceptHeader = parseHandshakeHeaders(handshake.headerText).get("sec-websocket-accept");
    if (acceptHeader !== createWebSocketAccept(websocketKey)) {
      throw new ResponsesWebSocketUpstreamError(
        "Upstream Responses WebSocket handshake returned an invalid accept header"
      );
    }

    if (handshake.remaining.length > MAX_UPSTREAM_WEBSOCKET_READ_BUFFER_BYTES) {
      throw createUpstreamWebSocketReadBufferError();
    }

    return new NodeWebSocketConnection(socket, handshake.remaining);
  } catch (error) {
    socket.destroy();
    throw error;
  }
}

function readNonSwitchingHandshakeBody(options: {
  socket: NodeWebSocketSocket;
  headerText: string;
  initialBody: Buffer;
  timeoutMs: number;
  signal: AbortSignal | null;
}): Promise<Buffer> {
  const contentLength = parseHandshakeContentLength(options.headerText);
  if (contentLength === null) {
    return Promise.resolve(options.initialBody.subarray(0, MAX_HANDSHAKE_BODY_BYTES));
  }

  const targetLength = Math.min(contentLength, MAX_HANDSHAKE_BODY_BYTES);
  if (options.initialBody.length >= targetLength) {
    return Promise.resolve(options.initialBody.subarray(0, targetLength));
  }

  return new Promise((resolve, reject) => {
    let body = Buffer.from(options.initialBody);
    const timer = setTimeout(() => {
      cleanup();
      reject(new ResponsesWebSocketUpstreamError("Responses WebSocket handshake body timed out"));
    }, options.timeoutMs);
    const abort = () => {
      cleanup();
      reject(new ResponsesWebSocketUpstreamError("Responses WebSocket request was aborted"));
    };
    const error = (socketError: Error) => {
      cleanup();
      reject(socketError);
    };
    const close = () => {
      cleanup();
      resolve(body.subarray(0, targetLength));
    };
    const data = (chunk: Buffer) => {
      const bytesNeeded = targetLength - body.length;
      body = Buffer.concat([body, chunk.subarray(0, bytesNeeded)]);
      if (body.length < targetLength) return;

      cleanup();
      resolve(body.subarray(0, targetLength));
    };
    const cleanup = () => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      options.socket.off("data", data);
      options.socket.off("error", error);
      options.socket.off("close", close);
    };

    options.signal?.addEventListener("abort", abort, { once: true });
    options.socket.on("data", data);
    options.socket.once("error", error);
    options.socket.once("close", close);
  });
}

function createConnectedSocket(
  upstreamUrl: URL,
  timeoutMs: number,
  signal: AbortSignal | null
): Promise<NodeWebSocketSocket> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ResponsesWebSocketUpstreamError("Responses WebSocket request was aborted"));
      return;
    }

    const isTls = upstreamUrl.protocol === "wss:";
    const port = Number(upstreamUrl.port || (isTls ? 443 : 80));
    const socket = isTls
      ? connectTls({ host: upstreamUrl.hostname, port, servername: upstreamUrl.hostname })
      : connectTcp({ host: upstreamUrl.hostname, port });
    const timer = setTimeout(() => {
      cleanup();
      socket.destroy();
      reject(new ResponsesWebSocketUpstreamError("Responses WebSocket connection timed out"));
    }, timeoutMs);
    const abort = () => {
      cleanup();
      socket.destroy();
      reject(new ResponsesWebSocketUpstreamError("Responses WebSocket request was aborted"));
    };
    const error = (socketError: Error) => {
      cleanup();
      reject(socketError);
    };
    const connected = () => {
      cleanup();
      resolve(socket);
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      socket.off("error", error);
      socket.off(isTls ? "secureConnect" : "connect", connected);
    };

    signal?.addEventListener("abort", abort, { once: true });
    socket.once("error", error);
    socket.once(isTls ? "secureConnect" : "connect", connected);
  });
}

function buildHandshakeRequest(upstreamUrl: URL, websocketKey: string, headers: Headers): string {
  const pathname = upstreamUrl.pathname || "/";
  const requestTarget = `${pathname}${upstreamUrl.search}`;
  const lines = [
    `GET ${requestTarget} HTTP/1.1`,
    `Host: ${upstreamUrl.host}`,
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Key: ${websocketKey}`,
    "Sec-WebSocket-Version: 13",
  ];

  for (const [name, value] of headers.entries()) {
    if (isHandshakeManagedHeader(name)) continue;
    lines.push(`${name}: ${value}`);
  }

  lines.push("", "");
  return lines.join("\r\n");
}

function readHandshakeResponse(
  socket: NodeWebSocketSocket,
  timeoutMs: number,
  signal: AbortSignal | null
): Promise<{ headerText: string; remaining: Buffer }> {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    const timer = setTimeout(() => {
      cleanup();
      reject(new ResponsesWebSocketUpstreamError("Responses WebSocket handshake timed out"));
    }, timeoutMs);
    const abort = () => {
      cleanup();
      reject(new ResponsesWebSocketUpstreamError("Responses WebSocket request was aborted"));
    };
    const error = (socketError: Error) => {
      cleanup();
      reject(socketError);
    };
    const close = () => {
      cleanup();
      reject(
        new ResponsesWebSocketUnsupportedError(
          "Upstream Responses WebSocket closed during handshake",
          "close_before_first_frame"
        )
      );
    };
    const data = (chunk: Buffer) => {
      const searchBytes = Math.max(0, MAX_UPSTREAM_HANDSHAKE_HEADER_BYTES - buffer.length);
      const searchBuffer = Buffer.concat([buffer, chunk.subarray(0, searchBytes)]);
      const end = searchBuffer.indexOf("\r\n\r\n");

      if (end === -1) {
        if (buffer.length + chunk.length >= MAX_UPSTREAM_HANDSHAKE_HEADER_BYTES) {
          cleanup();
          reject(
            new ResponsesWebSocketUpstreamError(
              "Upstream Responses WebSocket handshake headers are too large"
            )
          );
          return;
        }

        buffer = searchBuffer;
        return;
      }

      cleanup();
      const headerEnd = end + 4;
      resolve({
        headerText: searchBuffer.subarray(0, headerEnd).toString("latin1"),
        remaining:
          headerEnd <= buffer.length
            ? Buffer.concat([buffer.subarray(headerEnd), chunk])
            : chunk.subarray(headerEnd - buffer.length),
      });
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      socket.off("data", data);
      socket.off("error", error);
      socket.off("close", close);
    };

    signal?.addEventListener("abort", abort, { once: true });
    socket.on("data", data);
    socket.once("error", error);
    socket.once("close", close);
  });
}

class NodeWebSocketConnection {
  private buffer: Buffer;
  private closed = false;
  private socketError: Error | null = null;
  private readonly waiters: Array<() => void> = [];

  constructor(
    private readonly socket: NodeWebSocketSocket,
    initialBuffer: Buffer
  ) {
    this.buffer = Buffer.from(initialBuffer);
    this.socket.on("data", (chunk) => {
      const chunkBuffer = Buffer.from(chunk);
      if (this.buffer.length + chunkBuffer.length > MAX_UPSTREAM_WEBSOCKET_READ_BUFFER_BYTES) {
        this.fail(createUpstreamWebSocketReadBufferError());
        return;
      }

      this.buffer = Buffer.concat([this.buffer, chunkBuffer]);
      this.flushWaiters();
    });
    this.socket.once("close", () => {
      this.closed = true;
      this.flushWaiters();
    });
    this.socket.once("error", (error) => {
      this.socketError = error;
      this.flushWaiters();
    });
  }

  sendText(text: string): void {
    this.socket.write(encodeClientWebSocketFrame(0x1, Buffer.from(text, "utf8")));
  }

  sendPong(payload: Buffer): void {
    this.socket.write(encodeClientWebSocketFrame(0xa, payload));
  }

  async readFrame(): Promise<DecodedWebSocketFrame | null> {
    while (true) {
      const decoded = decodeServerWebSocketFrame(this.buffer);
      if (decoded) {
        this.buffer = decoded.remaining;
        return decoded.frame;
      }

      if (this.socketError) throw this.socketError;
      if (this.closed) return null;
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
  }

  close(): void {
    if (this.socket.destroyed) return;
    this.socket.end(encodeClientWebSocketFrame(0x8, Buffer.alloc(0)));
  }

  private flushWaiters(): void {
    const waiters = this.waiters.splice(0);
    for (const waiter of waiters) waiter();
  }

  private fail(error: Error): void {
    if (this.socketError) return;

    this.socketError = error;
    this.socket.destroy();
    this.flushWaiters();
  }
}

function createUpstreamWebSocketReadBufferError(): ResponsesWebSocketUpstreamError {
  return new ResponsesWebSocketUpstreamError(
    "Upstream Responses WebSocket read buffer is too large"
  );
}

function parseResponsesWebSocketJsonEvent(text: string): ResponsesWebSocketJsonEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ResponsesWebSocketUpstreamError("Upstream Responses WebSocket sent invalid JSON");
  }

  if (!isRecord(parsed) || typeof parsed.type !== "string") {
    throw new ResponsesWebSocketUpstreamError(
      "Upstream Responses WebSocket sent a JSON event without a type"
    );
  }

  return parsed as ResponsesWebSocketJsonEvent;
}

function isTerminalResponsesWebSocketEvent(event: ResponsesWebSocketJsonEvent): boolean {
  return TERMINAL_EVENT_TYPES.has(event.type);
}

function isResponsesWebSocketClientPath(requestUrl: string | URL): boolean {
  return new URL(requestUrl.toString(), "http://localhost").pathname === RESPONSES_WEBSOCKET_PATH;
}

function isLiteLlmQueryModelCompatibilityProvider(provider: Provider): boolean {
  const providerFingerprint = [provider.name, provider.url, provider.websiteUrl]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();

  return /(?:^|[^a-z0-9])lite[-_ ]?llm(?:[^a-z0-9]|$)/i.test(providerFingerprint);
}

function classifyUnsupportedHandshake(
  statusCode: number,
  headerText: string
): ResponsesWebSocketUnsupportedReason | null {
  if (statusCode === 404) return "handshake_status_404";
  if (statusCode === 426) return "handshake_status_426";
  if (/unsupported|websocket not supported|upgrade required/i.test(headerText)) {
    return "handshake_unsupported";
  }
  return null;
}

function parseHandshakeStatusCode(headerText: string): number {
  const statusLine = headerText.split("\r\n", 1)[0] ?? "";
  const match = /^HTTP\/\d(?:\.\d)?\s+(\d{3})\b/.exec(statusLine);
  if (!match) {
    throw new ResponsesWebSocketUpstreamError("Invalid upstream Responses WebSocket handshake");
  }
  return Number(match[1]);
}

function parseHandshakeHeaders(headerText: string): Map<string, string> {
  const headers = new Map<string, string>();
  const lines = headerText.split("\r\n").slice(1);
  for (const line of lines) {
    if (!line) continue;
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    headers.set(line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim());
  }
  return headers;
}

function parseHandshakeContentLength(headerText: string): number | null {
  const value = parseHandshakeHeaders(headerText).get("content-length");
  if (!value || !/^\d+$/.test(value)) return null;

  const contentLength = Number(value);
  return Number.isSafeInteger(contentLength) ? contentLength : null;
}

function isHandshakeManagedHeader(name: string): boolean {
  return [
    "host",
    "upgrade",
    "connection",
    "sec-websocket-key",
    "sec-websocket-version",
    "sec-websocket-accept",
    "sec-websocket-extensions",
    "sec-websocket-protocol",
    "content-length",
    "transfer-encoding",
    "x-api-key",
  ].includes(name.toLowerCase());
}

function createWebSocketAccept(key: string): string {
  return createHash("sha1")
    .update(key + WEBSOCKET_GUID)
    .digest("base64");
}

function encodeClientWebSocketFrame(opcode: number, payload: Buffer): Buffer {
  const mask = randomBytes(4);
  const header = createClientFrameHeader(opcode, payload.length);
  const maskedPayload = Buffer.alloc(payload.length);

  for (let index = 0; index < payload.length; index += 1) {
    maskedPayload[index] = payload[index]! ^ mask[index % 4]!;
  }

  return Buffer.concat([header, mask, maskedPayload]);
}

function createClientFrameHeader(opcode: number, payloadLength: number): Buffer {
  if (payloadLength < 126) {
    return Buffer.from([0x80 | opcode, 0x80 | payloadLength]);
  }

  if (payloadLength <= 0xffff) {
    const header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(payloadLength, 2);
    return header;
  }

  const header = Buffer.alloc(10);
  header[0] = 0x80 | opcode;
  header[1] = 0x80 | 127;
  header.writeBigUInt64BE(BigInt(payloadLength), 2);
  return header;
}

function decodeServerWebSocketFrame(
  buffer: Buffer
): { frame: DecodedWebSocketFrame; remaining: Buffer } | null {
  if (buffer.length > MAX_UPSTREAM_WEBSOCKET_READ_BUFFER_BYTES) {
    throw createUpstreamWebSocketReadBufferError();
  }

  if (buffer.length < 2) return null;

  const firstByte = buffer[0]!;
  const secondByte = buffer[1]!;
  const opcode = firstByte & 0x0f;
  const masked = (secondByte & 0x80) !== 0;
  let payloadLength = secondByte & 0x7f;
  let headerLength = 2;

  if (payloadLength === 126) {
    if (buffer.length < 4) return null;
    payloadLength = buffer.readUInt16BE(2);
    headerLength = 4;
  } else if (payloadLength === 127) {
    if (buffer.length < 10) return null;
    const length64 = buffer.readBigUInt64BE(2);
    if (length64 > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new ResponsesWebSocketUpstreamError("Upstream Responses WebSocket frame is too large");
    }
    payloadLength = Number(length64);
    headerLength = 10;
  }

  if (payloadLength > MAX_UPSTREAM_WEBSOCKET_PAYLOAD_BYTES) {
    throw new ResponsesWebSocketUpstreamError(
      "Upstream Responses WebSocket frame payload is too large"
    );
  }

  const maskLength = masked ? 4 : 0;
  const payloadOffset = headerLength + maskLength;
  const frameEnd = payloadOffset + payloadLength;
  if (buffer.length < frameEnd) return null;

  const payload = Buffer.from(buffer.subarray(payloadOffset, frameEnd));
  if (masked) {
    const mask = buffer.subarray(headerLength, payloadOffset);
    for (let index = 0; index < payload.length; index += 1) {
      payload[index] = payload[index]! ^ mask[index % 4]!;
    }
  }

  return {
    frame: { opcode, payload },
    remaining: buffer.subarray(frameEnd),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

import { createHash } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { TextDecoder } from "node:util";
import {
  ResponsesWebSocketInboundHandler,
  type ResponsesWebSocketJsonEvent,
  type ResponsesWebSocketRequestExecutor,
} from "@/server/responses-websocket-protocol";

export const RESPONSES_WEBSOCKET_PATH = "/v1/responses";

const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const STRATEGY = "node-custom-server-upgrade-hook" as const;
const RESPONSES_WEBSOCKET_MAX_CLIENT_PAYLOAD_BYTES = 1024 * 1024;
const RESPONSES_WEBSOCKET_MAX_READ_BUFFER_BYTES = RESPONSES_WEBSOCKET_MAX_CLIENT_PAYLOAD_BYTES + 14;
const WEBSOCKET_CLOSE_PROTOCOL_ERROR = 1002;
const WEBSOCKET_CLOSE_INVALID_PAYLOAD_DATA = 1007;
const WEBSOCKET_CLOSE_MESSAGE_TOO_BIG = 1009;
const WEBSOCKET_CLOSE_INTERNAL_ERROR = 1011;
const RESPONSES_WEBSOCKET_UPGRADE_INTERCEPTOR_INSTALLED = Symbol(
  "responses-websocket-upgrade-interceptor-installed"
);
const FATAL_UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

type ResponsesWebSocketRuntimeSupport = {
  runtime: string;
  supportsResponsesWebSocket: boolean;
  strategy: typeof STRATEGY;
  reason: string;
};

type UpgradeSocket = Duplex & {
  write(data: string | Uint8Array): boolean;
  end(data?: string | Uint8Array): void;
  destroy(error?: Error): void;
};

type InterceptableResponsesWebSocketServer = Server & {
  [RESPONSES_WEBSOCKET_UPGRADE_INTERCEPTOR_INSTALLED]?: true;
};

export type ResponsesWebSocketRuntimeOptions = {
  executor?: ResponsesWebSocketRequestExecutor;
  createConnectionId?: () => string;
  createRequestId?: () => string;
  destroyUnhandledUpgrades?: boolean;
  interceptUpgradeEmit?: boolean;
};

type DecodedWebSocketFrame = {
  fin: boolean;
  opcode: number;
  payload: Buffer;
};

type FragmentedClientMessage = {
  opcode: 0x1 | 0x2;
  payloads: Buffer[];
  byteLength: number;
};

type ClientWebSocketFrameDecodeResult = {
  frames: DecodedWebSocketFrame[];
  remaining: Buffer;
  exceededLimit: boolean;
  protocolError: boolean;
};

let connectionSequence = 0;

export function getResponsesWebSocketRuntimeSupport(
  runtime: string
): ResponsesWebSocketRuntimeSupport {
  const normalizedRuntime = runtime.trim().toLowerCase();
  const isCustomNodeServer =
    normalizedRuntime.includes("custom") && normalizedRuntime.includes("server");

  if (isCustomNodeServer) {
    return {
      runtime,
      supportsResponsesWebSocket: true,
      strategy: STRATEGY,
      reason: "Node custom servers expose the HTTP upgrade event before Next handles HTTP routes.",
    };
  }

  return {
    runtime,
    supportsResponsesWebSocket: false,
    strategy: STRATEGY,
    reason:
      "Next Route Handlers through hono/vercel are Request/Response HTTP handlers only and do not expose Node HTTP upgrade events; use a custom Node server upgrade hook for /v1/responses WebSocket traffic.",
  };
}

export function attachResponsesWebSocketRuntime(
  server: Server,
  options: ResponsesWebSocketRuntimeOptions = {}
): void {
  if (options.interceptUpgradeEmit) {
    installResponsesWebSocketUpgradeInterceptor(server, options);
    return;
  }

  server.on("upgrade", (request, socket, head) => {
    // Route strategy: preserve the existing Hono/Next HTTP route for POST /v1/responses,
    // and intercept only GET websocket upgrades in a custom Node server upgrade hook.
    // Next App Router route handlers do not expose a stable raw socket upgrade boundary.
    const handled = handleResponsesWebSocketUpgrade(
      request,
      socket as UpgradeSocket,
      head,
      options
    );
    if (!handled && options.destroyUnhandledUpgrades) {
      socket.destroy();
    }
  });
}

function installResponsesWebSocketUpgradeInterceptor(
  server: Server,
  options: ResponsesWebSocketRuntimeOptions
): void {
  const interceptableServer = server as InterceptableResponsesWebSocketServer;
  if (interceptableServer[RESPONSES_WEBSOCKET_UPGRADE_INTERCEPTOR_INSTALLED]) return;

  interceptableServer[RESPONSES_WEBSOCKET_UPGRADE_INTERCEPTOR_INSTALLED] = true;
  const originalEmit = server.emit.bind(server);

  server.emit = ((eventName: string, ...args: unknown[]) => {
    if (eventName !== "upgrade") return originalEmit(eventName, ...args);

    const [request, socket, head] = args;
    const handled = handleResponsesWebSocketUpgrade(
      request as IncomingMessage,
      socket as UpgradeSocket,
      Buffer.isBuffer(head) ? head : Buffer.alloc(0),
      options
    );

    if (handled) return true;
    if (options.destroyUnhandledUpgrades) {
      (socket as UpgradeSocket | undefined)?.destroy();
      return true;
    }

    return originalEmit(eventName, ...args);
  }) as Server["emit"];
}

export function handleResponsesWebSocketUpgrade(
  request: IncomingMessage,
  socket: UpgradeSocket,
  head: Buffer,
  options: ResponsesWebSocketRuntimeOptions = {}
): boolean {
  if (!isResponsesWebSocketPath(request.url)) return false;

  const key = request.headers["sec-websocket-key"];
  const version = request.headers["sec-websocket-version"];

  if (
    request.method !== "GET" ||
    typeof key !== "string" ||
    version !== "13" ||
    !headerContains(request.headers.upgrade, "websocket") ||
    !headerContains(request.headers.connection, "upgrade")
  ) {
    socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    return true;
  }

  const accept = createWebSocketAccept(key);
  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "",
      "",
    ].join("\r\n")
  );

  const executor = options.executor;
  if (!executor) {
    socket.end(encodeWebSocketCloseFrame(WEBSOCKET_CLOSE_INTERNAL_ERROR, "runtime no executor"));
    return true;
  }

  startResponsesWebSocketFrameLoop(request, socket, head, { ...options, executor });
  return true;
}

function startResponsesWebSocketFrameLoop(
  request: IncomingMessage,
  socket: UpgradeSocket,
  head: Buffer,
  options: ResponsesWebSocketRuntimeOptions & { executor: ResponsesWebSocketRequestExecutor }
): void {
  const abortController = new AbortController();
  const connectionId = options.createConnectionId?.() ?? nextConnectionId();
  const handler = new ResponsesWebSocketInboundHandler({
    requestUrl: request.url ?? RESPONSES_WEBSOCKET_PATH,
    executor: options.executor,
    createRequestId: options.createRequestId,
    executionContext: {
      requestUrl: request.url ?? RESPONSES_WEBSOCKET_PATH,
      headers: headersFromIncomingMessage(request),
      clientAbortSignal: abortController.signal,
      connectionId,
    },
  });
  let readBuffer: Buffer = head.length > 0 ? Buffer.from(head) : Buffer.alloc(0);
  let fragmentedMessage: FragmentedClientMessage | null = null;
  let processing = Promise.resolve();
  let closing = false;

  const disposeConnection = () => {
    abortController.abort();
    handler.dispose();
  };

  const closeSocket = (code?: number, reason?: string) => {
    if (closing) return;
    closing = true;
    disposeConnection();
    socket.end(encodeWebSocketCloseFrame(code, reason));
  };

  const writeSocketFrame = async (frame: Buffer) => {
    if (socket.write(frame)) return;
    await waitForSocketDrain(socket);
  };

  const writeJsonEvents = async (events: readonly ResponsesWebSocketJsonEvent[]) => {
    for (const event of events) {
      if (closing) return;
      await writeSocketFrame(encodeWebSocketTextFrame(JSON.stringify(event)));
    }
  };

  const handleControlFrame = async (frame: DecodedWebSocketFrame) => {
    if (closing) return;

    if (frame.opcode === 0x8) {
      closeSocket();
      return;
    }

    if (frame.opcode === 0x9) {
      await writeSocketFrame(encodeWebSocketPongFrame(frame.payload));
    }
  };

  const dispatchFrame = async (frame: DecodedWebSocketFrame) => {
    if (closing) return;

    if (frame.opcode === 0x0) {
      if (!fragmentedMessage) {
        closeSocket(WEBSOCKET_CLOSE_PROTOCOL_ERROR);
        return;
      }

      fragmentedMessage.payloads.push(frame.payload);
      fragmentedMessage.byteLength += frame.payload.length;
      if (fragmentedMessage.byteLength > RESPONSES_WEBSOCKET_MAX_CLIENT_PAYLOAD_BYTES) {
        closeSocket(WEBSOCKET_CLOSE_MESSAGE_TOO_BIG);
        return;
      }

      if (!frame.fin) return;

      const completedMessage = fragmentedMessage;
      fragmentedMessage = null;
      const completedPayload = Buffer.concat(
        completedMessage.payloads,
        completedMessage.byteLength
      );
      const payload = decodeClientDataPayload(completedMessage.opcode, completedPayload);
      if (payload === null) {
        closeSocket(WEBSOCKET_CLOSE_INVALID_PAYLOAD_DATA);
        return;
      }

      const events = await handler.handleFrame(payload);
      await writeJsonEvents(events);
      return;
    }

    if (fragmentedMessage) {
      closeSocket(WEBSOCKET_CLOSE_PROTOCOL_ERROR);
      return;
    }

    if ((frame.opcode === 0x1 || frame.opcode === 0x2) && !frame.fin) {
      fragmentedMessage = {
        opcode: frame.opcode,
        payloads: [frame.payload],
        byteLength: frame.payload.length,
      };
      return;
    }

    const payload = decodeClientDataPayload(frame.opcode, frame.payload);
    if (payload === null) {
      closeSocket(WEBSOCKET_CLOSE_INVALID_PAYLOAD_DATA);
      return;
    }

    const events = await handler.handleFrame(payload);
    await writeJsonEvents(events);
  };

  const drainFrames = () => {
    if (readBuffer.length > RESPONSES_WEBSOCKET_MAX_READ_BUFFER_BYTES) {
      closeSocket(WEBSOCKET_CLOSE_MESSAGE_TOO_BIG);
      return;
    }

    const decoded = decodeClientWebSocketFrames(readBuffer);
    if (decoded.exceededLimit) {
      closeSocket(WEBSOCKET_CLOSE_MESSAGE_TOO_BIG);
      return;
    }
    if (decoded.protocolError) {
      closeSocket(WEBSOCKET_CLOSE_PROTOCOL_ERROR);
      return;
    }

    readBuffer = decoded.remaining;

    for (const frame of decoded.frames) {
      if (isControlOpcode(frame.opcode)) {
        void handleControlFrame(frame).catch((error) => writeRuntimeErrorEvent(error));
        continue;
      }

      processing = processing
        .then(() => dispatchFrame(frame))
        .catch((error) => writeRuntimeErrorEvent(error));
    }
  };

  socket.on("data", (chunk) => {
    const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (readBuffer.length + incoming.length > RESPONSES_WEBSOCKET_MAX_READ_BUFFER_BYTES) {
      closeSocket(WEBSOCKET_CLOSE_MESSAGE_TOO_BIG);
      return;
    }

    readBuffer = readBuffer.length === 0 ? incoming : Buffer.concat([readBuffer, incoming]);
    drainFrames();
  });
  socket.once("close", disposeConnection);
  socket.once("error", disposeConnection);

  if (readBuffer.length > 0) drainFrames();

  async function writeRuntimeErrorEvent(error: unknown): Promise<void> {
    if (closing) return;
    await writeSocketFrame(
      encodeWebSocketTextFrame(JSON.stringify(runtimeErrorToWebSocketEvent(error)))
    );
  }
}

function decodeClientDataPayload(opcode: number, payload: Buffer): string | Uint8Array | null {
  if (opcode !== 0x1) return new Uint8Array(payload);

  try {
    return FATAL_UTF8_DECODER.decode(payload);
  } catch {
    return null;
  }
}

function waitForSocketDrain(socket: UpgradeSocket): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      socket.removeListener("drain", finish);
      socket.removeListener("close", finish);
      socket.removeListener("error", finish);
      resolve();
    };

    socket.once("drain", finish);
    socket.once("close", finish);
    socket.once("error", finish);
  });
}

function runtimeErrorToWebSocketEvent(error: unknown): ResponsesWebSocketJsonEvent {
  return {
    type: "error",
    error: {
      type: "server_error",
      code: "server_error",
      message: error instanceof Error ? error.message : "Responses WebSocket request failed",
    },
  };
}

function decodeClientWebSocketFrames(buffer: Buffer): ClientWebSocketFrameDecodeResult {
  const frames: DecodedWebSocketFrame[] = [];
  let offset = 0;

  while (offset + 2 <= buffer.length) {
    const firstByte = buffer[offset]!;
    const secondByte = buffer[offset + 1]!;
    const fin = (firstByte & 0x80) !== 0;
    const hasReservedBits = (firstByte & 0x70) !== 0;
    const opcode = firstByte & 0x0f;
    const masked = (secondByte & 0x80) !== 0;
    let payloadLength = secondByte & 0x7f;
    let headerLength = 2;

    if (hasReservedBits || isReservedOpcode(opcode)) {
      return {
        frames,
        remaining: buffer.subarray(offset),
        exceededLimit: false,
        protocolError: true,
      };
    }

    if (payloadLength === 126) {
      if (offset + 4 > buffer.length) break;
      payloadLength = buffer.readUInt16BE(offset + 2);
      headerLength = 4;
    } else if (payloadLength === 127) {
      if (offset + 10 > buffer.length) break;
      const length64 = buffer.readBigUInt64BE(offset + 2);
      if (length64 > BigInt(RESPONSES_WEBSOCKET_MAX_CLIENT_PAYLOAD_BYTES)) {
        return {
          frames,
          remaining: buffer.subarray(offset),
          exceededLimit: true,
          protocolError: false,
        };
      }
      payloadLength = Number(length64);
      headerLength = 10;
    }

    if (payloadLength > RESPONSES_WEBSOCKET_MAX_CLIENT_PAYLOAD_BYTES) {
      return {
        frames,
        remaining: buffer.subarray(offset),
        exceededLimit: true,
        protocolError: false,
      };
    }

    if (!masked || (isControlOpcode(opcode) && (!fin || payloadLength > 125))) {
      return {
        frames,
        remaining: buffer.subarray(offset),
        exceededLimit: false,
        protocolError: true,
      };
    }

    const maskOffset = offset + headerLength;
    const payloadOffset = maskOffset + 4;
    const frameEnd = payloadOffset + payloadLength;
    if (frameEnd > buffer.length) break;

    const mask = buffer.subarray(maskOffset, payloadOffset);
    const payload = Buffer.alloc(payloadLength);
    for (let index = 0; index < payloadLength; index += 1) {
      payload[index] = buffer[payloadOffset + index]! ^ mask[index % 4]!;
    }

    frames.push({ fin, opcode, payload });
    offset = frameEnd;
  }

  return {
    frames,
    remaining: buffer.subarray(offset),
    exceededLimit: false,
    protocolError: false,
  };
}

function isControlOpcode(opcode: number): boolean {
  return opcode === 0x8 || opcode === 0x9 || opcode === 0xa;
}

function isReservedOpcode(opcode: number): boolean {
  return (opcode >= 0x3 && opcode <= 0x7) || (opcode >= 0xb && opcode <= 0xf);
}

function encodeWebSocketTextFrame(text: string): Buffer {
  return encodeServerWebSocketFrame(0x1, Buffer.from(text));
}

function encodeWebSocketPongFrame(payload: Buffer): Buffer {
  return encodeServerWebSocketFrame(0xa, payload);
}

function encodeWebSocketCloseFrame(code?: number, reason = ""): Buffer {
  if (code === undefined) return encodeServerWebSocketFrame(0x8, Buffer.alloc(0));

  const reasonPayload = Buffer.from(reason, "utf8");
  const payload = Buffer.alloc(2 + reasonPayload.length);
  payload.writeUInt16BE(code, 0);
  reasonPayload.copy(payload, 2);
  return encodeServerWebSocketFrame(0x8, payload);
}

function encodeServerWebSocketFrame(opcode: number, payload: Buffer): Buffer {
  if (payload.length < 126) {
    return Buffer.concat([Buffer.from([0x80 | opcode, payload.length]), payload]);
  }

  if (payload.length <= 0xffff) {
    const header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
    return Buffer.concat([header, payload]);
  }

  const header = Buffer.alloc(10);
  header[0] = 0x80 | opcode;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(payload.length), 2);
  return Buffer.concat([header, payload]);
}

function headersFromIncomingMessage(request: IncomingMessage): Headers {
  const headers = new Headers();

  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      for (const entry of value) headers.append(name, entry);
      continue;
    }

    if (typeof value === "string") headers.set(name, value);
  }

  return headers;
}

function nextConnectionId(): string {
  connectionSequence += 1;
  return `responses_ws_connection_${connectionSequence}`;
}

function createWebSocketAccept(key: string): string {
  return createHash("sha1")
    .update(key + WEBSOCKET_GUID)
    .digest("base64");
}

function isResponsesWebSocketPath(url: string | undefined): boolean {
  if (!url) return false;
  return new URL(url, "http://localhost").pathname === RESPONSES_WEBSOCKET_PATH;
}

function headerContains(value: string | string[] | undefined, expected: string): boolean {
  const values = Array.isArray(value) ? value : [value];
  return values.some((entry) =>
    entry
      ?.toLowerCase()
      .split(",")
      .map((part) => part.trim())
      .includes(expected)
  );
}

import { createHash } from "node:crypto";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { afterEach, describe, expect, test } from "vitest";
import {
  buildResponsesWebSocketUpstreamUrl,
  createResponsesWebSocketUpstreamEventStream,
  ResponsesWebSocketUnsupportedCache,
  ResponsesWebSocketUnsupportedError,
} from "@/server/responses-websocket-upstream-adapter";
import type {
  ResponsesWebSocketExecutorInput,
  ResponsesWebSocketJsonEvent,
} from "@/server/responses-websocket-protocol";
import type { Provider } from "@/types/provider";

const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MAX_HANDSHAKE_BODY_BYTES = 32 * 1024;
const OVERSIZED_HANDSHAKE_HEADER_BYTES = 33 * 1024;
const OVERSIZED_SERVER_FRAME_PAYLOAD_BYTES = 1024 * 1024 + 1;

type UpgradeSocket = Duplex & {
  write(data: string | Uint8Array): boolean;
  end(data?: string | Uint8Array): void;
  destroy(error?: Error): void;
};

type MockResponsesWsServer = {
  url: string;
  observed: {
    upgradeCount: number;
    paths: string[];
    headers: IncomingHttpHeaders[];
    frames: Array<Record<string, unknown>>;
  };
  close: () => Promise<void>;
};

type MockResponsesWsServerOptions = {
  rejectStatus?: 400 | 404 | 426;
  rejectBody?: string;
  rejectBodyWithoutContentLength?: boolean;
  rejectBodyInLaterChunk?: boolean;
  closeBeforeFirstJsonEvent?: boolean;
  oversizedHandshakeHeaderBytes?: number;
  oversizedServerFramePayloadBytes?: number;
  events?: ResponsesWebSocketJsonEvent[];
};

const openMockServers: MockResponsesWsServer[] = [];

afterEach(async () => {
  const servers = openMockServers.splice(0);
  await Promise.all(servers.map((server) => server.close()));
});

describe("Responses WebSocket upstream adapter", () => {
  test("builds ws/wss /v1/responses URLs using Codex suffix rules without query model by default", () => {
    const requestUrl = new URL("ws://client.local/v1/responses?model=query-model");

    expect(
      buildResponsesWebSocketUpstreamUrl("https://upstream.example.com/proxy/responses", requestUrl)
    ).toBe("wss://upstream.example.com/proxy/responses");
    expect(
      buildResponsesWebSocketUpstreamUrl(
        "https://upstream.example.com/proxy/v1/responses",
        requestUrl
      )
    ).toBe("wss://upstream.example.com/proxy/v1/responses");
    expect(
      buildResponsesWebSocketUpstreamUrl("http://upstream.example.com/proxy/v1", requestUrl)
    ).toBe("ws://upstream.example.com/proxy/v1/responses");
  });

  test("keeps outbound query model only for explicit LiteLLM compatibility", () => {
    const requestUrl = new URL("ws://client.local/v1/responses?model=query-model");

    expect(
      buildResponsesWebSocketUpstreamUrl("https://litellm.example.com/proxy/v1", requestUrl, {
        litellmQueryModelCompatibility: true,
      })
    ).toBe("wss://litellm.example.com/proxy/v1/responses?model=query-model");
    expect(
      buildResponsesWebSocketUpstreamUrl("https://api.openai.com/v1", requestUrl, {
        litellmQueryModelCompatibility: false,
      })
    ).toBe("wss://api.openai.com/v1/responses");
  });

  test("skips upstream WebSocket when the global setting, provider type, or client path gate fails", () => {
    const input = createExecutorInput();
    const provider = createProvider({ providerType: "codex" });

    expect(
      createResponsesWebSocketUpstreamEventStream({
        input,
        provider,
        globalEnabled: false,
        clientTransport: "websocket",
      })
    ).toMatchObject({ type: "skipped", reason: "global_disabled" });

    expect(
      createResponsesWebSocketUpstreamEventStream({
        input,
        provider: createProvider({ providerType: "openai-compatible" }),
        globalEnabled: true,
        clientTransport: "websocket",
      })
    ).toMatchObject({ type: "skipped", reason: "non_codex_provider" });

    expect(
      createResponsesWebSocketUpstreamEventStream({
        input: createExecutorInput({ requestUrl: "/v1/chat/completions" }),
        provider,
        globalEnabled: true,
        clientTransport: "websocket",
      })
    ).toMatchObject({ type: "skipped", reason: "not_client_ws_path" });

    expect(
      createResponsesWebSocketUpstreamEventStream({
        input,
        provider,
        globalEnabled: true,
        clientTransport: "http",
      })
    ).toMatchObject({ type: "skipped", reason: "non_websocket_client" });
  });

  test("keeps OpenAI-native upstream WebSocket body-model-only by default", async () => {
    const server = await startMockResponsesWsServer();
    const provider = createProvider({ name: "OpenAI native", url: `${server.url}/gateway/v1` });
    const input = createExecutorInput({
      upstreamBody: {
        model: "body-model",
        input: [{ role: "user", content: [{ type: "input_text", text: "openai native" }] }],
      },
    });

    const result = createResponsesWebSocketUpstreamEventStream({
      input,
      provider,
      globalEnabled: true,
      clientTransport: "websocket",
      unsupportedCache: new ResponsesWebSocketUnsupportedCache({ ttlMs: 1_000 }),
    });

    if (result.type !== "connected") {
      throw new Error(`Expected connected result, got ${result.reason}`);
    }

    await collectEvents(result.events);

    expect(server.observed.paths).toEqual(["/gateway/v1/responses"]);
    expect(server.observed.frames[0]).toMatchObject({
      type: "response.create",
      model: "body-model",
    });
  });

  test("preserves outbound query model for LiteLLM-compatible upstream WebSocket routing", async () => {
    const server = await startMockResponsesWsServer();
    const provider = createProvider({ name: "LiteLLM Gateway", url: `${server.url}/gateway/v1` });

    const result = createResponsesWebSocketUpstreamEventStream({
      input: createExecutorInput(),
      provider,
      globalEnabled: true,
      clientTransport: "websocket",
      unsupportedCache: new ResponsesWebSocketUnsupportedCache({ ttlMs: 1_000 }),
    });

    if (result.type !== "connected") {
      throw new Error(`Expected connected result, got ${result.reason}`);
    }

    await collectEvents(result.events);

    expect(server.observed.paths).toEqual(["/gateway/v1/responses?model=query-model"]);
  });

  test("streams upstream Responses JSON events in order and sends a sanitized response.create frame", async () => {
    const server = await startMockResponsesWsServer();
    const provider = createProvider({ url: `${server.url}/gateway/v1` });
    const input = createExecutorInput({
      upstreamBody: {
        model: "body-model",
        input: [{ role: "user", content: [{ type: "input_text", text: "hello ws" }] }],
        stream: true,
        background: true,
      },
    });

    const result = createResponsesWebSocketUpstreamEventStream({
      input,
      provider,
      globalEnabled: true,
      clientTransport: "websocket",
      unsupportedCache: new ResponsesWebSocketUnsupportedCache({ ttlMs: 1_000 }),
    });

    if (result.type !== "connected") {
      throw new Error(`Expected connected result, got ${result.reason}`);
    }

    const events = await collectEvents(result.events);

    expect(events).toEqual([
      { type: "response.created", response: { id: "resp_1", status: "in_progress" } },
      { type: "response.output_text.delta", delta: "Hello" },
      { type: "response.completed", response: { id: "resp_1", status: "completed" } },
    ]);
    expect(server.observed.paths).toEqual(["/gateway/v1/responses"]);
    expect(server.observed.headers[0]?.authorization).toBe("Bearer upstream-key");
    expect(server.observed.headers[0]?.["user-agent"]).toBe("client-codex/1.0");
    expect(server.observed.frames[0]).toMatchObject({
      type: "response.create",
      model: "body-model",
      input: [{ role: "user", content: [{ type: "input_text", text: "hello ws" }] }],
    });
    expect(server.observed.frames[0]).not.toHaveProperty("stream");
    expect(server.observed.frames[0]).not.toHaveProperty("background");
    expect(server.observed.frames[0]).not.toHaveProperty("body");
  });

  test("classifies handshake 426 as fallback-safe unsupported and caches the endpoint", async () => {
    const server = await startMockResponsesWsServer({ rejectStatus: 426 });
    const cache = new ResponsesWebSocketUnsupportedCache({ ttlMs: 1_000 });
    const provider = createProvider({ url: server.url });
    const input = createExecutorInput();

    const result = createResponsesWebSocketUpstreamEventStream({
      input,
      provider,
      globalEnabled: true,
      clientTransport: "websocket",
      unsupportedCache: cache,
    });

    if (result.type !== "connected") {
      throw new Error(`Expected connected result, got ${result.reason}`);
    }

    await expect(collectEvents(result.events)).rejects.toMatchObject({
      code: "upstream_ws_unsupported",
      fallbackSafe: true,
      unsupportedReason: "handshake_status_426",
    });
    expect(
      cache.isUnsupported({
        providerId: provider.id,
        endpointId: null,
        endpointUrl: result.upstreamUrl,
      })
    ).toBe(true);

    expect(
      createResponsesWebSocketUpstreamEventStream({
        input,
        provider,
        globalEnabled: true,
        clientTransport: "websocket",
        unsupportedCache: cache,
      })
    ).toMatchObject({ type: "skipped", reason: "ws_unsupported_cached" });
    expect(server.observed.upgradeCount).toBe(1);
  });

  test("classifies handshake 404 as fallback-safe unsupported and caches the endpoint", async () => {
    const server = await startMockResponsesWsServer({ rejectStatus: 404 });
    const cache = new ResponsesWebSocketUnsupportedCache({ ttlMs: 1_000 });
    const provider = createProvider({ url: server.url });
    const input = createExecutorInput();

    const result = createResponsesWebSocketUpstreamEventStream({
      input,
      provider,
      globalEnabled: true,
      clientTransport: "websocket",
      unsupportedCache: cache,
    });

    if (result.type !== "connected") {
      throw new Error(`Expected connected result, got ${result.reason}`);
    }

    await expect(collectEvents(result.events)).rejects.toMatchObject({
      code: "upstream_ws_unsupported",
      fallbackSafe: true,
      unsupportedReason: "handshake_status_404",
    });
    expect(
      cache.isUnsupported({
        providerId: provider.id,
        endpointId: null,
        endpointUrl: result.upstreamUrl,
      })
    ).toBe(true);

    expect(
      createResponsesWebSocketUpstreamEventStream({
        input,
        provider,
        globalEnabled: true,
        clientTransport: "websocket",
        unsupportedCache: cache,
      })
    ).toMatchObject({ type: "skipped", reason: "ws_unsupported_cached" });
    expect(server.observed.upgradeCount).toBe(1);
  });

  test("classifies textual unsupported handshake bodies as fallback-safe and caches the endpoint", async () => {
    const server = await startMockResponsesWsServer({
      rejectStatus: 400,
      rejectBody: "websocket not supported for this Responses endpoint",
    });
    const cache = new ResponsesWebSocketUnsupportedCache({ ttlMs: 1_000 });
    const provider = createProvider({ url: server.url });
    const input = createExecutorInput();

    const result = createResponsesWebSocketUpstreamEventStream({
      input,
      provider,
      globalEnabled: true,
      clientTransport: "websocket",
      unsupportedCache: cache,
    });

    if (result.type !== "connected") {
      throw new Error(`Expected connected result, got ${result.reason}`);
    }

    await expect(collectEvents(result.events)).rejects.toMatchObject({
      code: "upstream_ws_unsupported",
      fallbackSafe: true,
      unsupportedReason: "handshake_unsupported",
    });
    expect(
      cache.isUnsupported({
        providerId: provider.id,
        endpointId: null,
        endpointUrl: result.upstreamUrl,
      })
    ).toBe(true);

    expect(
      createResponsesWebSocketUpstreamEventStream({
        input,
        provider,
        globalEnabled: true,
        clientTransport: "websocket",
        unsupportedCache: cache,
      })
    ).toMatchObject({ type: "skipped", reason: "ws_unsupported_cached" });
    expect(server.observed.upgradeCount).toBe(1);
  });

  test("classifies split textual unsupported handshake bodies as fallback-safe and caches the endpoint", async () => {
    const server = await startMockResponsesWsServer({
      rejectStatus: 400,
      rejectBody: "websocket not supported for this Responses endpoint",
      rejectBodyInLaterChunk: true,
    });
    const cache = new ResponsesWebSocketUnsupportedCache({ ttlMs: 1_000 });
    const provider = createProvider({ url: server.url });
    const input = createExecutorInput();

    const result = createResponsesWebSocketUpstreamEventStream({
      input,
      provider,
      globalEnabled: true,
      clientTransport: "websocket",
      unsupportedCache: cache,
    });

    if (result.type !== "connected") {
      throw new Error(`Expected connected result, got ${result.reason}`);
    }

    await expect(collectEvents(result.events)).rejects.toMatchObject({
      code: "upstream_ws_unsupported",
      fallbackSafe: true,
      unsupportedReason: "handshake_unsupported",
    });
    expect(
      cache.isUnsupported({
        providerId: provider.id,
        endpointId: null,
        endpointUrl: result.upstreamUrl,
      })
    ).toBe(true);

    expect(
      createResponsesWebSocketUpstreamEventStream({
        input,
        provider,
        globalEnabled: true,
        clientTransport: "websocket",
        unsupportedCache: cache,
      })
    ).toMatchObject({ type: "skipped", reason: "ws_unsupported_cached" });
    expect(server.observed.upgradeCount).toBe(1);
  });

  test("caps same-chunk handshake bodies without content-length before classifying", async () => {
    const oversizedBody = `${"a".repeat(MAX_HANDSHAKE_BODY_BYTES)}websocket not supported`;
    const server = await startMockResponsesWsServer({
      rejectStatus: 400,
      rejectBody: oversizedBody,
      rejectBodyWithoutContentLength: true,
    });
    const cache = new ResponsesWebSocketUnsupportedCache({ ttlMs: 1_000 });
    const provider = createProvider({ url: server.url });
    const input = createExecutorInput();

    const result = createResponsesWebSocketUpstreamEventStream({
      input,
      provider,
      globalEnabled: true,
      clientTransport: "websocket",
      unsupportedCache: cache,
    });

    if (result.type !== "connected") {
      throw new Error(`Expected connected result, got ${result.reason}`);
    }

    await expect(collectEvents(result.events)).rejects.toMatchObject({
      code: "upstream_ws_error",
      fallbackSafe: false,
      message: "Upstream Responses WebSocket handshake returned 400",
    });
    expect(
      cache.isUnsupported({
        providerId: provider.id,
        endpointId: null,
        endpointUrl: result.upstreamUrl,
      })
    ).toBe(false);
  });

  test("rejects oversized upstream handshake headers as upstream errors", async () => {
    const server = await startMockResponsesWsServer({
      oversizedHandshakeHeaderBytes: OVERSIZED_HANDSHAKE_HEADER_BYTES,
    });
    const cache = new ResponsesWebSocketUnsupportedCache({ ttlMs: 1_000 });
    const provider = createProvider({ url: server.url });
    const input = createExecutorInput();

    const result = createResponsesWebSocketUpstreamEventStream({
      input,
      provider,
      globalEnabled: true,
      clientTransport: "websocket",
      unsupportedCache: cache,
      connectTimeoutMs: 50,
    });

    if (result.type !== "connected") {
      throw new Error(`Expected connected result, got ${result.reason}`);
    }

    await expect(collectEvents(result.events)).rejects.toMatchObject({
      code: "upstream_ws_error",
      fallbackSafe: false,
      message: "Upstream Responses WebSocket handshake headers are too large",
    });
    expect(
      cache.isUnsupported({
        providerId: provider.id,
        endpointId: null,
        endpointUrl: result.upstreamUrl,
      })
    ).toBe(false);
  });

  test("rejects oversized upstream frame payload declarations as upstream errors", async () => {
    const server = await startMockResponsesWsServer({
      oversizedServerFramePayloadBytes: OVERSIZED_SERVER_FRAME_PAYLOAD_BYTES,
    });
    const cache = new ResponsesWebSocketUnsupportedCache({ ttlMs: 1_000 });
    const provider = createProvider({ url: server.url });
    const input = createExecutorInput();

    const result = createResponsesWebSocketUpstreamEventStream({
      input,
      provider,
      globalEnabled: true,
      clientTransport: "websocket",
      unsupportedCache: cache,
    });

    if (result.type !== "connected") {
      throw new Error(`Expected connected result, got ${result.reason}`);
    }

    await expect(collectEvents(result.events)).rejects.toMatchObject({
      code: "upstream_ws_error",
      fallbackSafe: false,
      message: "Upstream Responses WebSocket frame payload is too large",
    });
    expect(server.observed.frames[0]).toMatchObject({ type: "response.create" });
    expect(
      cache.isUnsupported({
        providerId: provider.id,
        endpointId: null,
        endpointUrl: result.upstreamUrl,
      })
    ).toBe(false);
  });

  test("classifies close-before-first-frame as fallback-safe unsupported and caches the endpoint", async () => {
    const server = await startMockResponsesWsServer({ closeBeforeFirstJsonEvent: true });
    const cache = new ResponsesWebSocketUnsupportedCache({ ttlMs: 1_000 });
    const provider = createProvider({ url: server.url });
    const input = createExecutorInput();

    const result = createResponsesWebSocketUpstreamEventStream({
      input,
      provider,
      globalEnabled: true,
      clientTransport: "websocket",
      unsupportedCache: cache,
    });

    if (result.type !== "connected") {
      throw new Error(`Expected connected result, got ${result.reason}`);
    }

    await expect(collectEvents(result.events)).rejects.toBeInstanceOf(
      ResponsesWebSocketUnsupportedError
    );
    expect(
      cache.isUnsupported({
        providerId: provider.id,
        endpointId: null,
        endpointUrl: result.upstreamUrl,
      })
    ).toBe(true);
  });
});

function createProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 91,
    name: "codex-upstream-ws-provider",
    url: "http://127.0.0.1:1",
    key: "upstream-key",
    providerType: "codex",
    providerVendorId: 19,
    preserveClientIp: false,
    ...overrides,
  } as Provider;
}

function createExecutorInput(
  overrides: Partial<ResponsesWebSocketExecutorInput> & {
    upstreamBody?: Record<string, unknown>;
  } = {}
): ResponsesWebSocketExecutorInput {
  const upstreamBody = overrides.upstreamBody ?? {
    model: "body-model",
    input: [{ role: "user", content: [{ type: "input_text", text: "hello" }] }],
  };

  return {
    id: "request-1",
    parsed: {
      type: "response.create",
      upstreamBody: upstreamBody as ResponsesWebSocketExecutorInput["upstreamBody"],
      transport: { stream: true, background: true },
      modelSource: "body",
    },
    upstreamBody: upstreamBody as ResponsesWebSocketExecutorInput["upstreamBody"],
    transport: { stream: true, background: true },
    modelSource: "body",
    requestUrl: "/v1/responses?model=query-model",
    executionContext: {
      requestUrl: "/v1/responses?model=query-model",
      headers: new Headers({
        authorization: "Bearer client-key",
        "user-agent": "client-codex/1.0",
      }),
      clientAbortSignal: null,
      connectionId: "connection-1",
    },
    ...overrides,
  };
}

async function collectEvents(
  events: AsyncIterable<ResponsesWebSocketJsonEvent>
): Promise<ResponsesWebSocketJsonEvent[]> {
  const collected: ResponsesWebSocketJsonEvent[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
}

async function startMockResponsesWsServer(
  options: MockResponsesWsServerOptions = {}
): Promise<MockResponsesWsServer> {
  const observed: MockResponsesWsServer["observed"] = {
    upgradeCount: 0,
    paths: [],
    headers: [],
    frames: [],
  };
  const events = options.events ?? [
    { type: "response.created", response: { id: "resp_1", status: "in_progress" } },
    { type: "response.output_text.delta", delta: "Hello" },
    { type: "response.completed", response: { id: "resp_1", status: "completed" } },
  ];
  const server = createServer();
  const sockets = new Set<UpgradeSocket>();

  server.on("upgrade", (request, socket) => {
    const upgradeSocket = socket as UpgradeSocket;
    sockets.add(upgradeSocket);
    upgradeSocket.once("close", () => sockets.delete(upgradeSocket));
    observed.upgradeCount += 1;
    observed.paths.push(request.url ?? "");
    observed.headers.push(request.headers);

    if (options.oversizedHandshakeHeaderBytes) {
      const headerPrefix = "HTTP/1.1 101 Switching Protocols\r\nX-Oversized: ";
      const fillBytes = Math.max(
        0,
        options.oversizedHandshakeHeaderBytes - Buffer.byteLength(headerPrefix)
      );
      upgradeSocket.write(`${headerPrefix}${"a".repeat(fillBytes)}`);
      return;
    }

    if (options.rejectStatus) {
      const rejectBody = options.rejectBody ?? "";
      const rejectHeaders = [
        `HTTP/1.1 ${options.rejectStatus} ${statusText(options.rejectStatus)}`,
        "Connection: close",
      ];
      if (rejectBody.length > 0 && !options.rejectBodyWithoutContentLength) {
        rejectHeaders.push(`Content-Length: ${Buffer.byteLength(rejectBody)}`);
      }
      const rejectHeaderText = `${rejectHeaders.join("\r\n")}\r\n\r\n`;
      if (options.rejectBodyInLaterChunk) {
        upgradeSocket.write(rejectHeaderText);
        setTimeout(() => upgradeSocket.end(rejectBody), 10);
        return;
      }
      upgradeSocket.write(`${rejectHeaderText}${rejectBody}`);
      upgradeSocket.destroy();
      return;
    }

    const key = request.headers["sec-websocket-key"];
    if (typeof key !== "string") {
      upgradeSocket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
      upgradeSocket.destroy();
      return;
    }

    upgradeSocket.write(
      [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${createWebSocketAccept(key)}`,
        "",
        "",
      ].join("\r\n")
    );

    if (options.closeBeforeFirstJsonEvent) {
      upgradeSocket.end(encodeServerWebSocketFrame(0x8, Buffer.alloc(0)));
      return;
    }

    let buffer = Buffer.alloc(0);
    upgradeSocket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
      const decoded = decodeClientWebSocketFrames(buffer);
      buffer = decoded.remaining;

      for (const frame of decoded.frames) {
        if (frame.opcode !== 0x1) continue;
        observed.frames.push(JSON.parse(frame.payload.toString("utf8")) as Record<string, unknown>);
        if (options.oversizedServerFramePayloadBytes) {
          upgradeSocket.end(
            encodeServerWebSocketFrameHeader(0x1, options.oversizedServerFramePayloadBytes)
          );
          return;
        }
        for (const event of events) {
          upgradeSocket.write(encodeServerWebSocketFrame(0x1, Buffer.from(JSON.stringify(event))));
        }
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const started = {
    url: `http://127.0.0.1:${address.port}`,
    observed,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  } satisfies MockResponsesWsServer;
  openMockServers.push(started);
  return started;
}

function createWebSocketAccept(key: string): string {
  return createHash("sha1")
    .update(key + WEBSOCKET_GUID)
    .digest("base64");
}

function statusText(status: 400 | 404 | 426): string {
  if (status === 400) return "Bad Request";
  return status === 404 ? "Not Found" : "Upgrade Required";
}

function decodeClientWebSocketFrames(buffer: Buffer): {
  frames: Array<{ opcode: number; payload: Buffer }>;
  remaining: Buffer;
} {
  const frames: Array<{ opcode: number; payload: Buffer }> = [];
  let offset = 0;

  while (offset + 2 <= buffer.length) {
    const firstByte = buffer[offset]!;
    const secondByte = buffer[offset + 1]!;
    const opcode = firstByte & 0x0f;
    const masked = (secondByte & 0x80) !== 0;
    let payloadLength = secondByte & 0x7f;
    let headerLength = 2;

    if (payloadLength === 126) {
      if (offset + 4 > buffer.length) break;
      payloadLength = buffer.readUInt16BE(offset + 2);
      headerLength = 4;
    } else if (payloadLength === 127) {
      if (offset + 10 > buffer.length) break;
      payloadLength = Number(buffer.readBigUInt64BE(offset + 2));
      headerLength = 10;
    }

    if (!masked) break;
    const maskOffset = offset + headerLength;
    const payloadOffset = maskOffset + 4;
    const frameEnd = payloadOffset + payloadLength;
    if (frameEnd > buffer.length) break;

    const mask = buffer.subarray(maskOffset, payloadOffset);
    const payload = Buffer.alloc(payloadLength);
    for (let index = 0; index < payloadLength; index += 1) {
      payload[index] = buffer[payloadOffset + index]! ^ mask[index % 4]!;
    }

    frames.push({ opcode, payload });
    offset = frameEnd;
  }

  return { frames, remaining: buffer.subarray(offset) };
}

function encodeServerWebSocketFrame(opcode: number, payload: Buffer): Buffer {
  return Buffer.concat([encodeServerWebSocketFrameHeader(opcode, payload.length), payload]);
}

function encodeServerWebSocketFrameHeader(opcode: number, payloadLength: number): Buffer {
  if (payloadLength < 126) {
    return Buffer.from([0x80 | opcode, payloadLength]);
  }

  if (payloadLength <= 0xffff) {
    const header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(payloadLength, 2);
    return header;
  }

  const header = Buffer.alloc(10);
  header[0] = 0x80 | opcode;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(payloadLength), 2);
  return header;
}

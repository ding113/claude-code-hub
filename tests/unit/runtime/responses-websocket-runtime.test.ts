import { randomBytes } from "node:crypto";
import { createServer, IncomingMessage, request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import net from "node:net";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { ResponsesWebSocketExecutorInput } from "@/server/responses-websocket-protocol";
import {
  RESPONSES_WEBSOCKET_PATH,
  attachResponsesWebSocketRuntime,
  getResponsesWebSocketRuntimeSupport,
  handleResponsesWebSocketUpgrade,
} from "@/server/responses-websocket-runtime";

const servers: Array<ReturnType<typeof createServer>> = [];
const OVERSIZED_CLIENT_PAYLOAD_BYTES = 1024 * 1024 + 1;
const OVERSIZED_CLIENT_READ_BUFFER_BYTES = OVERSIZED_CLIENT_PAYLOAD_BYTES + 14;
const WEBSOCKET_CLOSE_PROTOCOL_ERROR = 1002;
const WEBSOCKET_CLOSE_MESSAGE_TOO_BIG = 1009;
const WEBSOCKET_CLOSE_INTERNAL_ERROR = 1011;

function randomWebSocketKey(): string {
  return randomBytes(16).toString("base64");
}

async function listen(server: ReturnType<typeof createServer>): Promise<number> {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}

async function waitUntil(assertion: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 1000;

  while (Date.now() < deadline) {
    if (assertion()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  throw new Error(message);
}

async function readRawUpgrade(port: number, path = RESPONSES_WEBSOCKET_PATH): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: "127.0.0.1", port }, () => {
      socket.write(
        [
          `GET ${path} HTTP/1.1`,
          `Host: 127.0.0.1:${port}`,
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Key: ${randomWebSocketKey()}`,
          "Sec-WebSocket-Version: 13",
          "",
          "",
        ].join("\r\n")
      );
    });
    let data = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      data += chunk;
      if (data.includes("\r\n\r\n")) {
        socket.destroy();
        resolve(data);
      }
    });
    socket.on("error", (error) => {
      reject(error);
    });
    socket.on("close", () => {
      if (!data) {
        reject(new Error("Upgrade socket closed before response"));
      }
    });
    socket.setTimeout(3000, () => {
      socket.destroy();
      reject(new Error("Timed out waiting for WebSocket upgrade response"));
    });
  });
}

async function postRawHttp(port: number): Promise<{
  statusCode: number;
  body: string;
}> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ model: "test" });
    const request = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path: RESPONSES_WEBSOCKET_PATH,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
      },
      (response) => {
        let responseBody = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          responseBody += chunk;
        });
        response.on("end", () => {
          resolve({ statusCode: response.statusCode ?? 0, body: responseBody });
        });
      }
    );

    request.on("error", reject);
    request.write(body);
    request.end();
  });
}

function createInput(text = "runtime ping") {
  return [{ role: "user" as const, content: [{ type: "input_text" as const, text }] }];
}

function encodeMaskedClientTextFrame(payload: string): Buffer {
  return encodeMaskedClientFrame(0x1, Buffer.from(payload));
}

function encodeMaskedClientBinaryFrame(payload: Uint8Array): Buffer {
  return encodeMaskedClientFrame(0x2, Buffer.from(payload));
}

function encodeMaskedClientFrameFragment(opcode: number, payload: string, fin: boolean): Buffer {
  return encodeMaskedClientFrame(opcode, Buffer.from(payload), { fin });
}

function encodeMaskedClientFrameWithFirstByte(firstByte: number, payload: string): Buffer {
  const frame = encodeMaskedClientFrame(firstByte & 0x0f, Buffer.from(payload), {
    fin: (firstByte & 0x80) !== 0,
  });
  frame[0] = firstByte;
  return frame;
}

function encodeUnmaskedClientTextFrame(payload: string): Buffer {
  const body = Buffer.from(payload);
  return Buffer.concat([Buffer.from([0x80 | 0x1, body.length]), body]);
}

function encodeMaskedClientPingFrame(payload: string): Buffer {
  return encodeMaskedClientFrame(0x9, Buffer.from(payload));
}

function encodeClientCloseFrame(): Buffer {
  return encodeMaskedClientFrame(0x8, Buffer.alloc(0));
}

function encodeMaskedClientFrame(
  opcode: number,
  payload: Buffer,
  options: { fin?: boolean } = {}
): Buffer {
  const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);
  const headerLength = payload.length < 126 ? 2 : payload.length <= 0xffff ? 4 : 10;
  const header = Buffer.alloc(headerLength);
  header[0] = ((options.fin ?? true) ? 0x80 : 0) | opcode;

  if (payload.length < 126) {
    header[1] = 0x80 | payload.length;
  } else if (payload.length <= 0xffff) {
    header[1] = 0x80 | 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }

  const masked = Buffer.alloc(payload.length);
  for (let index = 0; index < payload.length; index += 1) {
    masked[index] = payload[index]! ^ mask[index % mask.length]!;
  }

  return Buffer.concat([header, mask, masked]);
}

function encodeMaskedClientFrameHeader(opcode: number, payloadLength: number): Buffer {
  const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);
  const headerLength = payloadLength < 126 ? 2 : payloadLength <= 0xffff ? 4 : 10;
  const header = Buffer.alloc(headerLength);
  header[0] = 0x80 | opcode;

  if (payloadLength < 126) {
    header[1] = 0x80 | payloadLength;
  } else if (payloadLength <= 0xffff) {
    header[1] = 0x80 | 126;
    header.writeUInt16BE(payloadLength, 2);
  } else {
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(payloadLength), 2);
  }

  return Buffer.concat([header, mask]);
}

function encodeMaskedClientFrameHeaderWith64BitLength(
  opcode: number,
  payloadLength: bigint
): Buffer {
  const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);
  const header = Buffer.alloc(10);
  header[0] = 0x80 | opcode;
  header[1] = 0x80 | 127;
  header.writeBigUInt64BE(payloadLength, 2);
  return Buffer.concat([header, mask]);
}

async function readWebSocketCloseFrame(
  port: number,
  frames: readonly Buffer[],
  path = `${RESPONSES_WEBSOCKET_PATH}?model=query-model`
): Promise<Buffer> {
  return readWebSocketServerFrame(port, frames, 0x8, path);
}

async function readWebSocketPongFrame(
  port: number,
  frames: readonly Buffer[],
  path = `${RESPONSES_WEBSOCKET_PATH}?model=query-model`
): Promise<Buffer> {
  return readWebSocketServerFrame(port, frames, 0xa, path);
}

async function readWebSocketServerFrame(
  port: number,
  frames: readonly Buffer[],
  expectedOpcode: number,
  path = `${RESPONSES_WEBSOCKET_PATH}?model=query-model`
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: "127.0.0.1", port }, () => {
      socket.write(
        [
          `GET ${path} HTTP/1.1`,
          `Host: 127.0.0.1:${port}`,
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Key: ${randomWebSocketKey()}`,
          "Sec-WebSocket-Version: 13",
          "",
          "",
        ].join("\r\n")
      );
    });
    let buffer = Buffer.alloc(0);
    let handshakeComplete = false;
    let settled = false;
    let payloadBeforeClose: Buffer | undefined;
    const timeout = setTimeout(
      () => finish(undefined, new Error(`Timed out waiting for opcode ${expectedOpcode}`)),
      3000
    );

    const finish = (payload?: Buffer, error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.removeAllListeners();
      socket.destroy();
      if (error) {
        reject(error);
        return;
      }
      resolve(payload ?? Buffer.alloc(0));
    };

    socket.on("data", (chunk) => {
      try {
        buffer = Buffer.concat([buffer, chunk]);

        if (!handshakeComplete) {
          const headerEnd = buffer.indexOf("\r\n\r\n");
          if (headerEnd === -1) return;

          const headers = buffer.subarray(0, headerEnd).toString("utf8");
          expect(headers).toContain("HTTP/1.1 101 Switching Protocols");
          buffer = buffer.subarray(headerEnd + 4);
          handshakeComplete = true;
          for (const frame of frames) socket.write(frame);
        }

        const parsed = parseServerFrames(buffer);
        buffer = parsed.remaining;
        const expectedFrame = parsed.frames.find((frame) => frame.opcode === expectedOpcode);
        if (expectedFrame && expectedOpcode === 0x8) finish(expectedFrame.payload);
        if (expectedFrame && expectedOpcode !== 0x8) {
          payloadBeforeClose = expectedFrame.payload;
          socket.write(encodeClientCloseFrame());
        }
      } catch (error) {
        finish(undefined, error instanceof Error ? error : new Error(String(error)));
      }
    });
    socket.on("error", (error) => finish(undefined, error));
    socket.on("close", () => {
      if (payloadBeforeClose) {
        finish(payloadBeforeClose);
        return;
      }
      if (!settled) finish(undefined, new Error("Socket closed before WebSocket close frame"));
    });
  });
}

function parseServerFrames(buffer: Buffer): {
  frames: Array<{ opcode: number; payload: Buffer }>;
  remaining: Buffer;
} {
  const frames: Array<{ opcode: number; payload: Buffer }> = [];
  let offset = 0;

  while (offset + 2 <= buffer.length) {
    const opcode = buffer[offset]! & 0x0f;
    const masked = (buffer[offset + 1]! & 0x80) !== 0;
    let payloadLength = buffer[offset + 1]! & 0x7f;
    let headerLength = 2;

    if (payloadLength === 126) {
      if (offset + 4 > buffer.length) break;
      payloadLength = buffer.readUInt16BE(offset + 2);
      headerLength = 4;
    } else if (payloadLength === 127) {
      if (offset + 10 > buffer.length) break;
      const length64 = buffer.readBigUInt64BE(offset + 2);
      if (length64 > BigInt(Number.MAX_SAFE_INTEGER)) break;
      payloadLength = Number(length64);
      headerLength = 10;
    }

    if (masked) throw new Error("Server frames must not be masked");
    if (offset + headerLength + payloadLength > buffer.length) break;

    frames.push({
      opcode,
      payload: buffer.subarray(offset + headerLength, offset + headerLength + payloadLength),
    });
    offset += headerLength + payloadLength;
  }

  return { frames, remaining: buffer.subarray(offset) };
}

async function readWebSocketTextFrames(
  port: number,
  frames: readonly Buffer[],
  expectedTextFrameCount: number,
  path = `${RESPONSES_WEBSOCKET_PATH}?model=query-model`
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: "127.0.0.1", port }, () => {
      socket.write(
        [
          `GET ${path} HTTP/1.1`,
          `Host: 127.0.0.1:${port}`,
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Key: ${randomWebSocketKey()}`,
          "Sec-WebSocket-Version: 13",
          "",
          "",
        ].join("\r\n")
      );
    });
    let buffer = Buffer.alloc(0);
    let handshakeComplete = false;
    let settled = false;
    const textFrames: string[] = [];
    const timeout = setTimeout(
      () => finish(new Error("Timed out waiting for WebSocket text frames")),
      3000
    );

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.removeAllListeners();
      socket.destroy();
      if (error) {
        reject(error);
        return;
      }
      resolve(textFrames);
    };

    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);

      if (!handshakeComplete) {
        const headerEnd = buffer.indexOf("\r\n\r\n");
        if (headerEnd === -1) return;

        const headers = buffer.subarray(0, headerEnd).toString("utf8");
        expect(headers).toContain("HTTP/1.1 101 Switching Protocols");
        buffer = buffer.subarray(headerEnd + 4);
        handshakeComplete = true;
        for (const frame of frames) socket.write(frame);
      }

      const parsed = parseServerTextFrames(buffer);
      buffer = parsed.remaining;
      textFrames.push(...parsed.textFrames);

      if (textFrames.length >= expectedTextFrameCount) {
        socket.write(encodeClientCloseFrame());
        finish();
      }
    });
    socket.on("error", finish);
    socket.on("close", () => {
      if (!settled) finish(new Error("Socket closed before expected WebSocket frames"));
    });
  });
}

function parseServerTextFrames(buffer: Buffer): { textFrames: string[]; remaining: Buffer } {
  const textFrames: string[] = [];
  let offset = 0;

  while (offset + 2 <= buffer.length) {
    const opcode = buffer[offset]! & 0x0f;
    const masked = (buffer[offset + 1]! & 0x80) !== 0;
    let payloadLength = buffer[offset + 1]! & 0x7f;
    let headerLength = 2;

    if (payloadLength === 126) {
      if (offset + 4 > buffer.length) break;
      payloadLength = buffer.readUInt16BE(offset + 2);
      headerLength = 4;
    }

    if (masked) throw new Error("Server frames must not be masked");
    if (offset + headerLength + payloadLength > buffer.length) break;

    const payload = buffer.subarray(offset + headerLength, offset + headerLength + payloadLength);
    if (opcode === 0x1) textFrames.push(payload.toString("utf8"));
    offset += headerLength + payloadLength;
  }

  return { textFrames, remaining: buffer.subarray(offset) };
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        })
    )
  );
});

describe("responses WebSocket runtime support", () => {
  test("flushes invalid WebSocket handshakes with HTTP 400 before closing", () => {
    const request = new IncomingMessage(new net.Socket());
    request.method = "GET";
    request.url = RESPONSES_WEBSOCKET_PATH;
    request.headers = {
      connection: "Upgrade",
      upgrade: "websocket",
      "sec-websocket-version": "13",
    };
    const socket = new PassThrough();
    const end = vi.spyOn(socket, "end");
    const destroy = vi.spyOn(socket, "destroy");

    const handled = handleResponsesWebSocketUpgrade(request, socket, Buffer.alloc(0));

    expect(handled).toBe(true);
    expect(end).toHaveBeenCalledWith(
      "HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"
    );
    expect(destroy).not.toHaveBeenCalled();
  });

  test("closes accepted upgrades without an executor using an internal error reason", async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("http-ok");
    });

    attachResponsesWebSocketRuntime(server);
    const port = await listen(server);

    const closePayload = await readWebSocketCloseFrame(port, []);

    expect(closePayload.readUInt16BE(0)).toBe(WEBSOCKET_CLOSE_INTERNAL_ERROR);
    expect(closePayload.subarray(2).toString("utf8")).toBe("runtime no executor");
  });

  test("dispatches masked client text frames through the inbound handler and returns JSON text frames", async () => {
    const executorInputs: ResponsesWebSocketExecutorInput[] = [];
    const executor = vi.fn(async (input: ResponsesWebSocketExecutorInput) => {
      executorInputs.push(input);
      return { type: "response.completed", response: { id: "resp_runtime", status: "completed" } };
    });
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("http-ok");
    });

    attachResponsesWebSocketRuntime(server, {
      executor,
      createConnectionId: () => "runtime-connection-1",
      createRequestId: () => "runtime-request-1",
    });
    const port = await listen(server);

    const [textFrame] = await readWebSocketTextFrames(
      port,
      [
        encodeMaskedClientTextFrame(
          JSON.stringify({ type: "response.create", body: { input: createInput(), stream: true } })
        ),
      ],
      1
    );

    expect(JSON.parse(textFrame!)).toEqual({
      type: "response.completed",
      response: { id: "resp_runtime", status: "completed" },
    });
    expect(executor).toHaveBeenCalledTimes(1);
    expect(executorInputs[0]).toMatchObject({
      id: "runtime-request-1",
      upstreamBody: { model: "query-model", input: createInput() },
      transport: { stream: true },
      modelSource: "query",
      executionContext: { connectionId: "runtime-connection-1" },
    });
  });

  test("waits for drain before writing additional outbound event frames under backpressure", async () => {
    const executor = vi.fn(async () => [
      { type: "response.output_text.delta", delta: "first" },
      { type: "response.completed", response: { id: "resp_backpressure", status: "completed" } },
    ]);
    const request = new IncomingMessage(new net.Socket());
    request.method = "GET";
    request.url = `${RESPONSES_WEBSOCKET_PATH}?model=query-model`;
    request.headers = {
      connection: "Upgrade",
      upgrade: "websocket",
      "sec-websocket-key": randomWebSocketKey(),
      "sec-websocket-version": "13",
    };
    const socket = new PassThrough();
    let outboundTextFrames = 0;
    const write = vi.spyOn(socket, "write").mockImplementation((chunk: string | Uint8Array) => {
      if (Buffer.isBuffer(chunk) && (chunk[0]! & 0x0f) === 0x1) {
        outboundTextFrames += 1;
        return outboundTextFrames !== 1;
      }

      return true;
    });

    const handled = handleResponsesWebSocketUpgrade(request, socket, Buffer.alloc(0), { executor });

    expect(handled).toBe(true);
    socket.emit(
      "data",
      encodeMaskedClientTextFrame(
        JSON.stringify({ type: "response.create", body: { input: createInput(), stream: true } })
      )
    );

    await waitUntil(() => outboundTextFrames >= 1, "Expected first outbound event frame");
    expect(outboundTextFrames).toBe(1);

    socket.emit("drain");

    await waitUntil(
      () => outboundTextFrames === 2,
      "Expected second outbound event frame after drain"
    );
    expect(write).toHaveBeenCalled();
    expect(executor).toHaveBeenCalledTimes(1);
  });

  test("reassembles fragmented masked client text frames before dispatching", async () => {
    const executorInputs: ResponsesWebSocketExecutorInput[] = [];
    const executor = vi.fn(async (input: ResponsesWebSocketExecutorInput) => {
      executorInputs.push(input);
      return {
        type: "response.completed",
        response: { id: "resp_fragmented_runtime", status: "completed" },
      };
    });
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("http-ok");
    });

    attachResponsesWebSocketRuntime(server, { executor });
    const port = await listen(server);

    const payload = JSON.stringify({
      type: "response.create",
      body: { input: createInput("fragmented text"), stream: true },
    });
    const splitAt = 19;
    const [textFrame] = await readWebSocketTextFrames(
      port,
      [
        encodeMaskedClientFrameFragment(0x1, payload.slice(0, splitAt), false),
        encodeMaskedClientFrameFragment(0x0, payload.slice(splitAt), true),
      ],
      1
    );

    expect(JSON.parse(textFrame!)).toEqual({
      type: "response.completed",
      response: { id: "resp_fragmented_runtime", status: "completed" },
    });
    expect(executor).toHaveBeenCalledTimes(1);
    expect(executorInputs[0]?.upstreamBody.input).toEqual(createInput("fragmented text"));
  });

  test("closes with protocol error when a continuation frame has no active text message", async () => {
    const executor = vi.fn(async () => ({
      type: "response.completed",
      response: { id: "resp_unreachable", status: "completed" },
    }));
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("http-ok");
    });

    attachResponsesWebSocketRuntime(server, { executor });
    const port = await listen(server);

    const closePayload = await readWebSocketCloseFrame(port, [
      encodeMaskedClientFrameFragment(0x0, "orphan-continuation", true),
    ]);

    expect(closePayload.readUInt16BE(0)).toBe(WEBSOCKET_CLOSE_PROTOCOL_ERROR);
    expect(executor).not.toHaveBeenCalled();
  });

  test("closes unmasked client frames with protocol error without buffering them", async () => {
    const executor = vi.fn(async () => ({
      type: "response.completed",
      response: { id: "resp_unreachable", status: "completed" },
    }));
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("http-ok");
    });

    attachResponsesWebSocketRuntime(server, { executor });
    const port = await listen(server);

    const closePayload = await readWebSocketCloseFrame(port, [
      encodeUnmaskedClientTextFrame(
        JSON.stringify({ type: "response.create", body: { input: createInput() } })
      ),
    ]);

    expect(closePayload.readUInt16BE(0)).toBe(WEBSOCKET_CLOSE_PROTOCOL_ERROR);
    expect(executor).not.toHaveBeenCalled();
  });

  test.each([
    ["RSV1", 0xc1],
    ["RSV2", 0xa1],
    ["RSV3", 0x91],
  ])("closes %s client frames with protocol error without executing", async (_name, firstByte) => {
    const executor = vi.fn(async () => ({
      type: "response.completed",
      response: { id: "resp_unreachable", status: "completed" },
    }));
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("http-ok");
    });

    attachResponsesWebSocketRuntime(server, { executor });
    const port = await listen(server);

    const closePayload = await readWebSocketCloseFrame(port, [
      encodeMaskedClientFrameWithFirstByte(
        firstByte,
        JSON.stringify({ type: "response.create", body: { input: createInput() } })
      ),
    ]);

    expect(closePayload.readUInt16BE(0)).toBe(WEBSOCKET_CLOSE_PROTOCOL_ERROR);
    expect(executor).not.toHaveBeenCalled();
  });

  test.each([
    ["non-control reserved opcode", 0x83],
    ["control reserved opcode", 0x8b],
  ])("closes %s client frames with protocol error without executing", async (_name, firstByte) => {
    const executor = vi.fn(async () => ({
      type: "response.completed",
      response: { id: "resp_unreachable", status: "completed" },
    }));
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("http-ok");
    });

    attachResponsesWebSocketRuntime(server, { executor });
    const port = await listen(server);

    const closePayload = await readWebSocketCloseFrame(port, [
      encodeMaskedClientFrameWithFirstByte(firstByte, "reserved-opcode"),
    ]);

    expect(closePayload.readUInt16BE(0)).toBe(WEBSOCKET_CLOSE_PROTOCOL_ERROR);
    expect(executor).not.toHaveBeenCalled();
  });

  test("returns protocol error events over the socket and keeps the connection usable", async () => {
    const executor = vi.fn(async () => ({
      type: "response.completed",
      response: { id: "resp_after_runtime_errors", status: "completed" },
    }));
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("http-ok");
    });

    attachResponsesWebSocketRuntime(server, { executor });
    const port = await listen(server);

    const textFrames = await readWebSocketTextFrames(
      port,
      [
        encodeMaskedClientTextFrame('{"type":"response.create",'),
        encodeMaskedClientTextFrame(JSON.stringify({ type: "session.update", session: {} })),
        encodeMaskedClientBinaryFrame(new Uint8Array([0, 1, 2])),
        encodeMaskedClientTextFrame(
          JSON.stringify({ type: "response.create", body: { input: createInput("after errors") } })
        ),
      ],
      4
    );
    const events = textFrames.map((frame) => JSON.parse(frame));

    expect(events.map((event) => event.type)).toEqual([
      "error",
      "error",
      "error",
      "response.completed",
    ]);
    expect(events[0].error.code).toBe("invalid_json");
    expect(events[1].error.code).toBe("unsupported_event_type");
    expect(events[2].error.code).toBe("binary_frame_not_supported");
    expect(events[3]).toEqual({
      type: "response.completed",
      response: { id: "resp_after_runtime_errors", status: "completed" },
    });
    expect(executor).toHaveBeenCalledTimes(1);
  });

  test("reports fragmented binary messages as unsupported events and keeps the connection usable", async () => {
    const executor = vi.fn(async () => ({
      type: "response.completed",
      response: { id: "resp_after_fragmented_binary", status: "completed" },
    }));
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("http-ok");
    });

    attachResponsesWebSocketRuntime(server, { executor });
    const port = await listen(server);

    const textFrames = await readWebSocketTextFrames(
      port,
      [
        encodeMaskedClientFrameFragment(0x2, "bin", false),
        encodeMaskedClientFrameFragment(0x0, "ary", true),
        encodeMaskedClientTextFrame(
          JSON.stringify({ type: "response.create", body: { input: createInput("after binary") } })
        ),
      ],
      2
    );
    const events = textFrames.map((frame) => JSON.parse(frame));

    expect(events[0].error.code).toBe("binary_frame_not_supported");
    expect(events[1]).toEqual({
      type: "response.completed",
      response: { id: "resp_after_fragmented_binary", status: "completed" },
    });
    expect(executor).toHaveBeenCalledTimes(1);
  });

  test("returns a server error event when the request executor rejects", async () => {
    const executor = vi.fn(async () => {
      throw new Error("executor failed before event");
    });
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("http-ok");
    });

    attachResponsesWebSocketRuntime(server, { executor });
    const port = await listen(server);

    const [textFrame] = await readWebSocketTextFrames(
      port,
      [
        encodeMaskedClientTextFrame(
          JSON.stringify({ type: "response.create", body: { input: createInput() } })
        ),
      ],
      1
    );

    expect(JSON.parse(textFrame!)).toEqual({
      type: "error",
      error: {
        type: "server_error",
        code: "server_error",
        message: "executor failed before event",
      },
    });
    expect(executor).toHaveBeenCalledTimes(1);
  });

  test("responds to client ping frames with pong without invoking the executor", async () => {
    const executor = vi.fn(async () => ({
      type: "response.completed",
      response: { id: "resp_unreachable", status: "completed" },
    }));
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("http-ok");
    });

    attachResponsesWebSocketRuntime(server, { executor });
    const port = await listen(server);

    const pongPayload = await readWebSocketPongFrame(port, [
      encodeMaskedClientPingFrame("runtime-ping"),
    ]);

    expect(pongPayload.toString("utf8")).toBe("runtime-ping");
    expect(executor).not.toHaveBeenCalled();
  });

  test("closes without executing when a client frame declares an oversized payload", async () => {
    const executor = vi.fn(async () => ({
      type: "response.completed",
      response: { id: "resp_unreachable", status: "completed" },
    }));
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("http-ok");
    });

    attachResponsesWebSocketRuntime(server, { executor });
    const port = await listen(server);

    const closePayload = await readWebSocketCloseFrame(port, [
      encodeMaskedClientFrameHeader(0x1, OVERSIZED_CLIENT_PAYLOAD_BYTES),
    ]);

    expect(closePayload.readUInt16BE(0)).toBe(WEBSOCKET_CLOSE_MESSAGE_TOO_BIG);
    expect(executor).not.toHaveBeenCalled();
  });

  test("closes 64-bit payload lengths above the payload cap as message too big", async () => {
    const executor = vi.fn(async () => ({
      type: "response.completed",
      response: { id: "resp_unreachable", status: "completed" },
    }));
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("http-ok");
    });

    attachResponsesWebSocketRuntime(server, { executor });
    const port = await listen(server);

    const closePayload = await readWebSocketCloseFrame(port, [
      encodeMaskedClientFrameHeaderWith64BitLength(0x1, BigInt(Number.MAX_SAFE_INTEGER) + 1n),
    ]);

    expect(closePayload.readUInt16BE(0)).toBe(WEBSOCKET_CLOSE_MESSAGE_TOO_BIG);
    expect(executor).not.toHaveBeenCalled();
  });

  test("closes without executing when accumulated client bytes exceed the read buffer limit", async () => {
    const executor = vi.fn(async () => ({
      type: "response.completed",
      response: { id: "resp_unreachable", status: "completed" },
    }));
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("http-ok");
    });

    attachResponsesWebSocketRuntime(server, { executor });
    const port = await listen(server);

    const closePayload = await readWebSocketCloseFrame(port, [
      Buffer.concat([
        encodeMaskedClientFrameHeader(0x1, OVERSIZED_CLIENT_PAYLOAD_BYTES - 1),
        Buffer.alloc(OVERSIZED_CLIENT_PAYLOAD_BYTES),
      ]),
    ]);

    expect(closePayload.readUInt16BE(0)).toBe(WEBSOCKET_CLOSE_MESSAGE_TOO_BIG);
    expect(executor).not.toHaveBeenCalled();
  });

  test("can intercept responses upgrades before later runtime listeners close the socket", async () => {
    const executor = vi.fn(async () => ({
      type: "response.completed",
      response: { id: "resp_intercepted_runtime", status: "completed" },
    }));
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("http-ok");
    });

    attachResponsesWebSocketRuntime(server, {
      executor,
      interceptUpgradeEmit: true,
    });
    server.on("upgrade", (_req, socket) => {
      socket.destroy();
    });
    const port = await listen(server);

    const [textFrame] = await readWebSocketTextFrames(
      port,
      [
        encodeMaskedClientTextFrame(
          JSON.stringify({ type: "response.create", body: { input: createInput() } })
        ),
      ],
      1
    );

    expect(JSON.parse(textFrame!)).toEqual({
      type: "response.completed",
      response: { id: "resp_intercepted_runtime", status: "completed" },
    });
    expect(executor).toHaveBeenCalledTimes(1);
  });

  test("does not wrap server emit more than once when upgrade interception is attached repeatedly", () => {
    const executor = vi.fn(async () => ({
      type: "response.completed",
      response: { id: "resp_intercepted_runtime", status: "completed" },
    }));
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("http-ok");
    });

    attachResponsesWebSocketRuntime(server, { executor, interceptUpgradeEmit: true });
    const wrappedEmit = server.emit;
    attachResponsesWebSocketRuntime(server, { executor, interceptUpgradeEmit: true });

    expect(server.emit).toBe(wrappedEmit);
  });

  test("accepts a WebSocket upgrade at /v1/responses and leaves HTTP POST handling untouched", async () => {
    const seenHttpRequests: string[] = [];
    const server = createServer((req, res) => {
      seenHttpRequests.push(`${req.method} ${req.url}`);
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("http-ok");
    });

    attachResponsesWebSocketRuntime(server);
    const port = await listen(server);

    const upgradeResponse = await readRawUpgrade(port);
    expect(upgradeResponse).toContain("HTTP/1.1 101 Switching Protocols");
    expect(upgradeResponse).toContain("Upgrade: websocket");
    expect(seenHttpRequests).toEqual([]);

    const postResponse = await postRawHttp(port);

    expect(postResponse.statusCode).toBe(200);
    expect(postResponse.body).toBe("http-ok");
    expect(seenHttpRequests).toEqual([`POST ${RESPONSES_WEBSOCKET_PATH}`]);
  });

  test("documents built-in Next runtime as unsupported for this route-level WebSocket upgrade", () => {
    const nextRuntimeSupport = getResponsesWebSocketRuntimeSupport("next dev");

    expect(nextRuntimeSupport).toMatchObject({
      supportsResponsesWebSocket: false,
      strategy: "node-custom-server-upgrade-hook",
    });
    expect(nextRuntimeSupport.reason).toContain("Request/Response HTTP handlers only");
    expect(getResponsesWebSocketRuntimeSupport("custom node server")).toMatchObject({
      supportsResponsesWebSocket: true,
      strategy: "node-custom-server-upgrade-hook",
    });
  });
});

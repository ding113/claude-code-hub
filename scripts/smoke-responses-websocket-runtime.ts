import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import net from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  RESPONSES_WEBSOCKET_PATH,
  attachResponsesWebSocketRuntime,
  getResponsesWebSocketRuntimeSupport,
} from "../src/server/responses-websocket-runtime";

type SmokeResult = {
  name: string;
  ok: boolean;
  detail: string;
};

const NODE_CHILD_ENV = "RESPONSES_WS_SMOKE_NODE_CHILD";

if (isRunningUnderBun() && process.env[NODE_CHILD_ENV] !== "1") {
  runUnderNode();
}

function isRunningUnderBun(): boolean {
  return "bun" in process.versions;
}

function runUnderNode(): never {
  const sourcePath = fileURLToPath(import.meta.url);
  const outputPath = resolve(".sisyphus/evidence/smoke-responses-websocket-runtime.mjs");
  mkdirSync(dirname(outputPath), { recursive: true });

  const build = spawnSync(process.execPath, [
    "build",
    sourcePath,
    "--target=node",
    `--outfile=${outputPath}`,
  ], { encoding: "utf8" });

  if (build.status !== 0) {
    process.stdout.write(build.stdout ?? "");
    process.stderr.write(build.stderr ?? "");
    process.exit(build.status ?? 1);
  }

  const node = spawnSync("node", [outputPath, ...process.argv.slice(2)], {
    encoding: "utf8",
    env: { ...process.env, [NODE_CHILD_ENV]: "1" },
  });

  process.stdout.write(node.stdout ?? "");
  process.stderr.write(node.stderr ?? "");
  process.exit(node.status ?? 1);
}

const mode = process.argv.includes("--unsupported")
  ? "unsupported"
  : process.argv.includes("--standalone")
    ? "standalone"
    : "runtime";

if (mode === "unsupported") {
  const runtimes = ["next dev", "next start", "standalone", "custom node server"];
  for (const runtime of runtimes) {
    const support = getResponsesWebSocketRuntimeSupport(runtime);
    console.log(
      `${support.runtime}: supports=${support.supportsResponsesWebSocket} strategy=${support.strategy}`
    );
    console.log(`  reason=${support.reason}`);
  }
  process.exit(0);
}

if (mode === "standalone") {
  await runStandaloneSmoke();
  process.exit(process.exitCode ?? 0);
}

const server = createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/plain", connection: "close" });
  res.end(`${req.method} ${req.url}`);
});

attachResponsesWebSocketRuntime(server);

try {
  const port = await listen();
  const results: SmokeResult[] = [];
  const upgradeResponse = await readRawUpgrade(port);
  results.push({
    name: "websocket-upgrade",
    ok:
      upgradeResponse.includes("HTTP/1.1 101 Switching Protocols") &&
      upgradeResponse.toLowerCase().includes("upgrade: websocket"),
    detail: firstLine(upgradeResponse),
  });

  const postResponse = await readRawPost(port);
  results.push({
    name: "http-post-compatible",
    ok: postResponse.includes("HTTP/1.1 200 OK") && postResponse.includes("POST /v1/responses"),
    detail: firstLine(postResponse),
  });

  for (const result of results) {
    console.log(`${result.ok ? "PASS" : "FAIL"} ${result.name}: ${result.detail}`);
  }

  process.exitCode = results.every((result) => result.ok) ? 0 : 1;
} finally {
  await closeServer();
}

function listen(): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
  });
}

function closeServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function readRawUpgrade(port: number): Promise<string> {
  return readRawHttpResponse(
    port,
    [
      `GET ${RESPONSES_WEBSOCKET_PATH} HTTP/1.1`,
      `Host: 127.0.0.1:${port}`,
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Key: ${randomBytes(16).toString("base64")}`,
      "Sec-WebSocket-Version: 13",
      "",
      "",
    ].join("\r\n"),
    (data) => data.includes("\r\n\r\n"),
    "Timed out waiting for upgrade response"
  );
}

function readRawPost(port: number, completion: "echo-body" | "headers" = "echo-body"): Promise<string> {
  const body = JSON.stringify({ model: "smoke" });
  return readRawHttpResponse(
    port,
    [
      `POST ${RESPONSES_WEBSOCKET_PATH} HTTP/1.1`,
      `Host: 127.0.0.1:${port}`,
      "Content-Type: application/json",
      `Content-Length: ${Buffer.byteLength(body)}`,
      "Connection: close",
      "",
      body,
    ].join("\r\n"),
    (data) =>
      data.includes("\r\n\r\n") &&
      (completion === "headers" || data.includes("POST /v1/responses")),
    "Timed out waiting for HTTP POST response"
  );
}

function readRawHttpResponse(
  port: number,
  payload: string,
  isComplete: (data: string) => boolean,
  timeoutMessage: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: "127.0.0.1", port }, () => {
      socket.write(payload);
    });
    let data = "";
    let settled = false;
    const timeout = setTimeout(() => finish(new Error(timeoutMessage)), 3000);

    const safeFinish = (error?: Error) => {
      setTimeout(() => finish(error), 0);
    };

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
      if (!data) {
        reject(new Error("Socket closed before response"));
        return;
      }
      resolve(data);
    };

    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      data += chunk;
      if (isComplete(data)) {
        finish();
      }
    });
    socket.on("end", () => safeFinish());
    socket.on("close", () => {
      if (!settled) safeFinish();
    });
    socket.on("error", (error) => safeFinish(error));
  });
}

function firstLine(response: string): string {
  return response.split("\r\n")[0] ?? response;
}

async function runStandaloneSmoke(): Promise<void> {
  const standaloneServerPath = resolve(".next/standalone/server.js");
  if (!existsSync(standaloneServerPath)) {
    console.error(`FAIL standalone-server: missing ${standaloneServerPath}`);
    process.exitCode = 1;
    return;
  }

  const port = await reservePort();
  const child = spawn("node", [standaloneServerPath], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      HOST: "127.0.0.1",
      DSN: process.env.DSN ?? "postgres://postgres:postgres@127.0.0.1:5432/claude_code_hub",
      REDIS_URL: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
      AUTO_MIGRATE: process.env.AUTO_MIGRATE ?? "false",
      ADMIN_TOKEN: process.env.ADMIN_TOKEN ?? "standalone-smoke-token",
    },
  });
  const output: string[] = [];
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => output.push(chunk));
  child.stderr.on("data", (chunk) => output.push(chunk));

  try {
    await waitForTcp(port);
    const wsEvent = await readStandaloneWebSocketError(port);
    // Standalone uses the real Next/Hono route; the body does not need to echo the request path.
    const postResponse = await readRawPost(port, "headers");
    const results: SmokeResult[] = [
      {
        name: "standalone-websocket-guard-boundary",
        ok: wsEvent.type === "error" && getErrorCode(wsEvent) === "authentication_error",
        detail: JSON.stringify(wsEvent),
      },
      {
        name: "standalone-http-post-compatible",
        ok: postResponse.includes("HTTP/1.1") && !postResponse.includes("101 Switching Protocols"),
        detail: firstLine(postResponse),
      },
    ];

    for (const result of results) {
      console.log(`${result.ok ? "PASS" : "FAIL"} ${result.name}: ${result.detail}`);
    }

    process.exitCode = results.every((result) => result.ok) ? 0 : 1;
  } finally {
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), 1000).unref();
    if (process.exitCode && output.length > 0) {
      console.error(output.join(""));
    }
  }
}

function reservePort(): Promise<number> {
  const probe = createServer();
  return new Promise((resolve, reject) => {
    probe.listen(0, "127.0.0.1", () => {
      const port = (probe.address() as AddressInfo).port;
      probe.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function waitForTcp(port: number): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 15000) {
    try {
      await new Promise<void>((resolve, reject) => {
        const socket = net.createConnection({ host: "127.0.0.1", port }, () => {
          socket.destroy();
          resolve();
        });
        socket.on("error", reject);
        socket.setTimeout(500, () => {
          socket.destroy();
          reject(new Error("TCP wait timeout"));
        });
      });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  throw new Error("Timed out waiting for standalone server TCP listener");
}

function readStandaloneWebSocketError(port: number): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: "127.0.0.1", port }, () => {
      socket.write(
        [
          `GET ${RESPONSES_WEBSOCKET_PATH}?model=query-model HTTP/1.1`,
          `Host: 127.0.0.1:${port}`,
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Key: ${randomBytes(16).toString("base64")}`,
          "Sec-WebSocket-Version: 13",
          "",
          "",
        ].join("\r\n")
      );
    });
    let buffer = Buffer.alloc(0);
    let handshakeComplete = false;
    let settled = false;
    const timeout = setTimeout(() => finish(new Error("Timed out waiting for standalone WS event")), 5000);

    const finish = (error?: Error, event?: Record<string, unknown>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.removeAllListeners();
      socket.destroy();
      if (error) {
        reject(error);
        return;
      }
      resolve(event ?? {});
    };

    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (!handshakeComplete) {
        const headerEnd = buffer.indexOf("\r\n\r\n");
        if (headerEnd === -1) return;
        const headers = buffer.subarray(0, headerEnd).toString("utf8");
        if (!headers.includes("101 Switching Protocols")) {
          finish(new Error(`Unexpected WS handshake: ${firstLine(headers)}`));
          return;
        }
        buffer = buffer.subarray(headerEnd + 4);
        handshakeComplete = true;
        socket.write(
          encodeMaskedClientTextFrame(
            JSON.stringify({ type: "response.create", body: { model: "query-model" } })
          )
        );
      }

      const parsed = parseServerTextFrame(buffer);
      if (parsed.event) finish(undefined, parsed.event);
      buffer = parsed.remaining;
    });
    socket.on("error", (error) => finish(error));
    socket.on("close", () => finish(new Error("Standalone WS socket closed before event")));
  });
}

function encodeMaskedClientTextFrame(payload: string): Buffer {
  const payloadBuffer = Buffer.from(payload);
  const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);
  const header = Buffer.from([0x81, 0x80 | payloadBuffer.length]);
  const masked = Buffer.alloc(payloadBuffer.length);
  for (let index = 0; index < payloadBuffer.length; index += 1) {
    masked[index] = payloadBuffer[index]! ^ mask[index % mask.length]!;
  }
  return Buffer.concat([header, mask, masked]);
}

function parseServerTextFrame(buffer: Buffer): {
  event: Record<string, unknown> | null;
  remaining: Buffer;
} {
  if (buffer.length < 2) return { event: null, remaining: buffer };
  const opcode = buffer[0]! & 0x0f;
  let payloadLength = buffer[1]! & 0x7f;
  let headerLength = 2;
  if (payloadLength === 126) {
    if (buffer.length < 4) return { event: null, remaining: buffer };
    payloadLength = buffer.readUInt16BE(2);
    headerLength = 4;
  }
  if (buffer.length < headerLength + payloadLength) return { event: null, remaining: buffer };
  const payload = buffer.subarray(headerLength, headerLength + payloadLength);
  const remaining = buffer.subarray(headerLength + payloadLength);
  if (opcode !== 0x1) return { event: null, remaining };
  return { event: JSON.parse(payload.toString("utf8")), remaining };
}

function getErrorCode(event: Record<string, unknown>): unknown {
  const error = event.error;
  if (typeof error !== "object" || error === null || Array.isArray(error)) return undefined;
  return (error as Record<string, unknown>).code;
}

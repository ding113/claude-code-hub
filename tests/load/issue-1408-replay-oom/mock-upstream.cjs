"use strict";

const http = require("node:http");

const host = process.env.CCH_MOCK_HOST || "0.0.0.0";
const port = parseBoundedInteger(process.env.CCH_MOCK_PORT || "3001", "CCH_MOCK_PORT", 0, 65535);
const totalMiB = parseBoundedNumber(process.env.CCH_MOCK_MIB || "8", "CCH_MOCK_MIB", 0.0625, 64);
const maxRequestBytes = parseBoundedInteger(
  process.env.CCH_MOCK_MAX_REQUEST_BYTES || String(1024 * 1024),
  "CCH_MOCK_MAX_REQUEST_BYTES",
  1,
  16 * 1024 * 1024
);
const chunkText = "x".repeat(64 * 1024);
const framesPerMiB = 16;
const counts = new Map();

function parseBoundedNumber(raw, name, minimum, maximum) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be a number between ${minimum} and ${maximum}`);
  }
  return value;
}

function parseBoundedInteger(raw, name, minimum, maximum) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let receivedBytes = 0;
    let tooLarge = false;
    req.on("data", (chunk) => {
      if (tooLarge) return;
      receivedBytes += chunk.byteLength;
      if (receivedBytes > maxRequestBytes) {
        tooLarge = true;
        chunks.length = 0;
        reject(new Error("request body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!tooLarge) resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", (error) => {
      if (!tooLarge) reject(error);
    });
  });
}

function scenarioFrom(raw) {
  const match = raw.match(/CCH_SCENARIO_([a-z0-9_-]+)/i);
  return match ? match[1] : "unknown";
}

function writeJson(res, statusCode, value) {
  res.writeHead(statusCode, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && (req.url === "/health" || req.url === "/stats")) {
    writeJson(res, 200, {
      counts: Object.fromEntries(counts),
      totalMiB,
    });
    return;
  }

  if (req.method === "POST" && req.url === "/reset") {
    counts.clear();
    writeJson(res, 200, { reset: true });
    return;
  }

  if (req.method !== "POST" || req.url !== "/v1/responses") {
    writeJson(res, 404, { error: "not found" });
    return;
  }

  let raw;
  try {
    raw = await readBody(req);
  } catch (error) {
    if (!res.headersSent && !res.destroyed) {
      writeJson(res, 413, { error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  const scenario = scenarioFrom(raw);
  counts.set(scenario, (counts.get(scenario) || 0) + 1);

  process.stdout.write(
    `${JSON.stringify({
      event: "request",
      path: req.url,
      requestBytes: Buffer.byteLength(raw),
      scenario,
      ordinal: counts.get(scenario),
      totalMiB,
    })}\n`
  );

  res.on("error", () => {});
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });

  const totalFrames = Math.max(1, Math.ceil(totalMiB * framesPerMiB));
  let sent = 0;
  const writeNext = () => {
    if (res.destroyed || sent >= totalFrames) return;
    sent += 1;
    const event = `data: ${JSON.stringify({
      type: "response.output_text.delta",
      delta: chunkText,
    })}\n\n`;
    if (!res.write(event)) {
      res.once("drain", writeNext);
    } else {
      setImmediate(writeNext);
    }
  };
  writeNext();
});

const sockets = new Set();
server.on("connection", (socket) => {
  sockets.add(socket);
  socket.on("close", () => sockets.delete(socket));
});

function shutdown() {
  server.close(() => process.exit(0));
  for (const socket of sockets) socket.destroy();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

server.listen(port, host, () => {
  const address = server.address();
  const listeningPort = typeof address === "object" && address ? address.port : port;
  process.stdout.write(
    `${JSON.stringify({ event: "listening", host, port: listeningPort, totalMiB })}\n`
  );
});

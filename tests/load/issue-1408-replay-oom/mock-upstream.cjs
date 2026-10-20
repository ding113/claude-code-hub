"use strict";

const http = require("node:http");

const host = process.env.CCH_MOCK_HOST || "0.0.0.0";
const port = parseBoundedInteger(process.env.CCH_MOCK_PORT || "3001", "CCH_MOCK_PORT", 0, 65535);
const responseBytes = process.env.CCH_MOCK_RESPONSE_BYTES
  ? parseBoundedInteger(
      process.env.CCH_MOCK_RESPONSE_BYTES,
      "CCH_MOCK_RESPONSE_BYTES",
      64 * 1024,
      64 * 1024 * 1024
    )
  : Math.round(
      parseBoundedNumber(process.env.CCH_MOCK_MIB || "5", "CCH_MOCK_MIB", 0.0625, 64) * 1024 * 1024
    );
const totalMiB = responseBytes / (1024 * 1024);
const responseMode = parseEnum(
  process.env.CCH_MOCK_RESPONSE_MODE || "disconnect",
  "CCH_MOCK_RESPONSE_MODE",
  ["disconnect", "complete"]
);
const maxRequestBytes = parseBoundedInteger(
  process.env.CCH_MOCK_MAX_REQUEST_BYTES || String(1024 * 1024),
  "CCH_MOCK_MAX_REQUEST_BYTES",
  1,
  16 * 1024 * 1024
);
const maxDeltaBytes = 64 * 1024;
const counts = new Map();
const completedCounts = new Map();
const emittedBytesByScenario = new Map();

const sseFramePrefix = 'data: {"type":"response.output_text.delta","delta":"';
const sseFrameSuffix = '"}\n\n';
const sseFrameOverheadBytes = Buffer.byteLength(sseFramePrefix + sseFrameSuffix, "utf8");
const sseCompletedFrame =
  'event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":1,"output_tokens":1}}}\n\n';

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

function parseEnum(raw, name, values) {
  if (!values.includes(raw)) {
    throw new Error(`${name} must be one of: ${values.join(", ")}`);
  }
  return raw;
}

function buildSseFrames(targetBytes, mode = responseMode) {
  const terminalFrame = mode === "complete" ? sseCompletedFrame : "";
  const terminalBytes = Buffer.byteLength(terminalFrame, "utf8");
  const deltaBytes = targetBytes - terminalBytes;
  if (!Number.isSafeInteger(targetBytes) || deltaBytes < sseFrameOverheadBytes) {
    throw new Error(
      `targetBytes must be an integer of at least ${sseFrameOverheadBytes + terminalBytes}`
    );
  }

  const frames = [];
  const maxFrameBytes = sseFrameOverheadBytes + maxDeltaBytes;
  let remainingBytes = deltaBytes;
  while (remainingBytes > 0) {
    const frameBytes =
      remainingBytes <= maxFrameBytes
        ? remainingBytes
        : Math.min(maxFrameBytes, remainingBytes - sseFrameOverheadBytes);
    const frame = `${sseFramePrefix}${"x".repeat(frameBytes - sseFrameOverheadBytes)}${sseFrameSuffix}`;
    if (Buffer.byteLength(frame, "utf8") !== frameBytes) {
      throw new Error("failed to construct an exact-size SSE frame");
    }
    frames.push(frame);
    remainingBytes -= frameBytes;
  }
  if (terminalFrame) frames.push(terminalFrame);
  return frames;
}

const responseFrames = buildSseFrames(responseBytes, responseMode);

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
      completedCounts: Object.fromEntries(completedCounts),
      emittedBytesByScenario: Object.fromEntries(emittedBytesByScenario),
      responseBytes,
      responseMode,
      totalMiB,
    });
    return;
  }

  if (req.method === "POST" && req.url === "/reset") {
    counts.clear();
    completedCounts.clear();
    emittedBytesByScenario.clear();
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
      responseBytes,
      responseMode,
      totalMiB,
    })}\n`
  );

  res.on("error", () => {});
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });

  let sent = 0;
  let emittedBytes = 0;
  const writeNext = () => {
    if (res.destroyed || sent >= responseFrames.length) return;
    const event = responseFrames[sent];
    sent += 1;
    emittedBytes += Buffer.byteLength(event, "utf8");
    if (sent === responseFrames.length) {
      completedCounts.set(scenario, (completedCounts.get(scenario) || 0) + 1);
      emittedBytesByScenario.set(
        scenario,
        (emittedBytesByScenario.get(scenario) || 0) + emittedBytes
      );
      process.stdout.write(
        `${JSON.stringify({
          event: "response_emitted",
          scenario,
          emittedBytes,
          frames: responseFrames.length,
        })}\n`
      );
    }
    const responseFullyEmitted = sent === responseFrames.length;
    const continueResponse = () => {
      if (responseFullyEmitted && responseMode === "complete") {
        res.end();
        return;
      }
      writeNext();
    };
    if (!res.write(event)) res.once("drain", continueResponse);
    else setImmediate(continueResponse);
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

if (require.main === module) {
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  server.listen(port, host, () => {
    const address = server.address();
    const listeningPort = typeof address === "object" && address ? address.port : port;
    process.stdout.write(
      `${JSON.stringify({
        event: "listening",
        host,
        port: listeningPort,
        responseBytes,
        responseMode,
        totalMiB,
      })}\n`
    );
  });
}

module.exports = {
  buildSseFrames,
  responseBytes,
  responseMode,
  sseCompletedFrame,
  sseFrameOverheadBytes,
};

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { URL } = require("node:url");
const next = require("next");
const { WebSocketServer } = require("ws");

const RESPONSES_WS_TERMINAL_TYPES = new Set([
  "response.completed",
  "response.failed",
  "response.incomplete",
  "error",
]);
const LOOPBACK_BLOCKED_HEADERS = new Set([
  "connection",
  "content-length",
  "host",
  "sec-websocket-extensions",
  "sec-websocket-key",
  "sec-websocket-protocol",
  "sec-websocket-version",
  "upgrade",
]);
const MAX_SSE_BUFFER_CHARS = 64 * 1024;

function getFlag(name) {
  return process.argv.includes(`--${name}`);
}

function getFlagValue(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function normalizePort(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const parsed = Number.parseInt(String(value), 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function resolveOptions(overrides = {}) {
  const dev = overrides.dev ?? (getFlag("dev") || process.env.NODE_ENV !== "production");
  const fallbackPort = dev ? 13500 : 3000;
  const port = overrides.port ?? normalizePort(getFlagValue("port") ?? process.env.PORT, fallbackPort);
  const hostname = overrides.hostname ?? process.env.HOSTNAME ?? process.env.HOST ?? "0.0.0.0";
  const keepAliveTimeout = normalizePort(process.env.KEEP_ALIVE_TIMEOUT, undefined);

  return {
    dev,
    dir: overrides.dir ?? __dirname,
    port,
    hostname,
    keepAliveTimeout,
  };
}

function loadStandaloneNextConfig(dir) {
  const configPath = path.join(dir, "standalone-next-config.json");
  if (!fs.existsSync(configPath)) {
    return null;
  }

  const nextConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
  process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(nextConfig);
  return nextConfig;
}

function writeJsonFrame(socket, payload) {
  if (socket.readyState !== socket.OPEN) {
    return;
  }
  socket.send(JSON.stringify(payload));
}

function writeProtocolError(socket, code, message, extras = {}) {
  writeJsonFrame(socket, {
    type: "error",
    error: {
      code,
      message,
      ...extras,
    },
  });
}

function validateCreateFrame(frame) {
  if (!frame || typeof frame !== "object" || Array.isArray(frame)) {
    throw new Error("Frame must be a JSON object");
  }
  if (frame.type !== "response.create") {
    throw new Error("First frame must be response.create");
  }
  if (!frame.response || typeof frame.response !== "object" || Array.isArray(frame.response)) {
    throw new Error("response.create must include a response object");
  }
  if (typeof frame.response.model !== "string" || frame.response.model.trim() === "") {
    throw new Error("response.create must include a non-empty response.model");
  }
  return frame;
}

function buildLoopbackHeaders(requestHeaders) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(requestHeaders)) {
    if (LOOPBACK_BLOCKED_HEADERS.has(key.toLowerCase())) {
      continue;
    }
    if (Array.isArray(value)) {
      headers.set(key, value.join(", "));
    } else if (typeof value === "string") {
      headers.set(key, value);
    }
  }
  headers.set("accept", "text/event-stream");
  headers.set("content-type", "application/json");
  return headers;
}

async function defaultForwardResponsesRequest({ request, bodyText, targetOrigin, signal }) {
  const requestUrl = new URL(request.url || "/", targetOrigin);
  const payload = JSON.parse(bodyText);
  payload.stream = true;

  return fetch(`${targetOrigin}/v1/responses${requestUrl.search}`, {
    method: "POST",
    headers: buildLoopbackHeaders(request.headers),
    body: JSON.stringify(payload),
    signal,
  });
}

function extractSseBlocks(buffer) {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const blocks = normalized.split("\n\n");
  const rest = blocks.pop() || "";
  return { blocks, rest };
}

function parseSseBlock(block) {
  const lines = block.split("\n");
  let event = "message";
  const dataLines = [];

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith(":")) {
      continue;
    }
    if (line.startsWith("event:")) {
      event = line.slice(6).trim() || "message";
      continue;
    }
    if (line.startsWith("data:")) {
      let value = line.slice(5);
      if (value.startsWith(" ")) {
        value = value.slice(1);
      }
      dataLines.push(value);
    }
  }

  return {
    event,
    data: dataLines.join("\n"),
  };
}

function sseEventToWsFrame(parsedEvent) {
  if (parsedEvent.data === "[DONE]") {
    return null;
  }

  try {
    const payload = JSON.parse(parsedEvent.data);
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      if (parsedEvent.event && parsedEvent.event !== "message") {
        return {
          type: parsedEvent.event,
          ...payload,
        };
      }
      if (typeof payload.type === "string") {
        return payload;
      }
      return {
        type: "message",
        data: payload,
      };
    }
    return {
      type: parsedEvent.event || "message",
      data: payload,
    };
  } catch {
    return {
      type: parsedEvent.event || "message",
      data: parsedEvent.data,
    };
  }
}

function createResponsesWebSocketConnectionHandler(options) {
  const forwardResponsesRequest = options.forwardResponsesRequest || defaultForwardResponsesRequest;

  return function handleConnection(socket, request) {
    const state = {
      activeTurn: false,
      activeAbortController: null,
    };

    const pingInterval = setInterval(() => {
      if (socket.readyState === socket.OPEN) socket.ping();
    }, 30000);
    socket.on("close", () => clearInterval(pingInterval));

    socket.on("message", async (raw) => {
      let parsedFrame;
      try {
        parsedFrame = JSON.parse(raw.toString());
      } catch {
        writeProtocolError(socket, "invalid_json", "WebSocket frame must be valid JSON");
        return;
      }

      if (parsedFrame.type === "response.cancel") {
        if (!state.activeAbortController) {
          writeProtocolError(socket, "no_active_response", "No active response to cancel");
          return;
        }
        state.activeAbortController.abort();
        return;
      }

      let createFrame;
      try {
        createFrame = validateCreateFrame(parsedFrame);
      } catch (error) {
        writeProtocolError(
          socket,
          "invalid_request",
          error instanceof Error ? error.message : "Invalid response.create frame"
        );
        return;
      }

      if (state.activeTurn) {
        writeProtocolError(
          socket,
          "response_already_in_progress",
          "A response.create request is already in flight on this socket"
        );
        return;
      }

      state.activeTurn = true;
      state.activeAbortController = new AbortController();

      try {
        const response = await forwardResponsesRequest({
          request,
          bodyText: JSON.stringify(createFrame.response),
          targetOrigin: options.targetOrigin,
          signal: state.activeAbortController.signal,
        });

        if (!response.ok) {
          const text = await response.text().catch(() => "");
          writeProtocolError(
            socket,
            `http_${response.status}`,
            text || `Loopback bridge returned HTTP ${response.status}`
          );
          return;
        }

        const contentType = response.headers.get("content-type") || "";
        if (!contentType.includes("text/event-stream")) {
          const payload = await response.json().catch(async () => ({ body: await response.text() }));
          if (payload && payload.error) {
            writeProtocolError(
              socket,
              payload.error.code || "bridge_error",
              payload.error.message || "Loopback bridge returned an error payload"
            );
            return;
          }
          writeJsonFrame(socket, {
            type: "response.completed",
            response: payload,
          });
          return;
        }

        const reader = response.body?.getReader();
        if (!reader) {
          writeProtocolError(socket, "bridge_stream_missing", "Loopback bridge returned no SSE body");
          return;
        }

        const decoder = new TextDecoder();
        let buffer = "";
        let terminalSeen = false;

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          if (!value || value.byteLength === 0) {
            continue;
          }

          buffer += decoder.decode(value, { stream: true });
          if (buffer.length > MAX_SSE_BUFFER_CHARS) {
            throw new Error("Buffered SSE frame exceeded safety limit");
          }

          const { blocks, rest } = extractSseBlocks(buffer);
          buffer = rest;

          for (const block of blocks) {
            const parsedEvent = parseSseBlock(block);
            const frame = sseEventToWsFrame(parsedEvent);
            if (!frame) {
              continue;
            }
            writeJsonFrame(socket, frame);
            if (RESPONSES_WS_TERMINAL_TYPES.has(frame.type)) {
              terminalSeen = true;
            }
          }

          if (terminalSeen) {
            break;
          }
        }
      } catch (error) {
        if (!state.activeAbortController.signal.aborted) {
          writeProtocolError(
            socket,
            "bridge_failed",
            error instanceof Error ? error.message : "Responses WebSocket bridge failed"
          );
        }
      } finally {
        state.activeTurn = false;
        state.activeAbortController = null;
      }
    });

    socket.on("close", () => {
      if (state.activeAbortController) {
        state.activeAbortController.abort();
      }
      state.activeAbortController = null;
      state.activeTurn = false;
    });

    socket.on("error", () => {
      socket.close();
    });
  };
}

function createResponsesUpgradeServer(options) {
  const wss = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
    maxPayload: 1 * 1024 * 1024,
  });

  const handleConnection = createResponsesWebSocketConnectionHandler(options);
  wss.on("connection", (socket, request) => {
    handleConnection(socket, request);
  });

  return wss;
}

async function startServer(overrides = {}) {
  const options = resolveOptions(overrides);

  if (!options.dev) {
    process.env.NODE_ENV = "production";
  }

  const standaloneConfig = options.dev ? null : loadStandaloneNextConfig(options.dir);
  const app = next({
    dev: options.dev,
    dir: options.dir,
    hostname: options.hostname,
    port: options.port,
    conf: standaloneConfig ?? undefined,
  });
  await app.prepare();
  const handle = app.getRequestHandler();

  const server = http.createServer((req, res) => {
    Promise.resolve(handle(req, res)).catch((error) => {
      console.error("[CCH] HTTP request handling failed", error);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end("Internal Server Error");
      }
    });
  });

  if (options.keepAliveTimeout !== undefined) {
    server.keepAliveTimeout = options.keepAliveTimeout;
  }

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.hostname, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : options.port;
  const targetOrigin = `http://127.0.0.1:${actualPort}`;
  const wss = createResponsesUpgradeServer({ targetOrigin });

  server.on("upgrade", (req, socket, head) => {
    try {
      const requestUrl = new URL(req.url || "/", `http://${req.headers.host || options.hostname}`);
      if (requestUrl.pathname !== "/v1/responses") {
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    } catch (error) {
      console.error("[CCH] WebSocket upgrade failed", error);
      socket.destroy();
    }
  });

  return {
    app,
    server,
    wss,
    port: actualPort,
    hostname: options.hostname,
    async close() {
      await Promise.all([
        new Promise((resolve) => wss.close(() => resolve())),
        new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
      ]);
      if (typeof app.close === "function") {
        await app.close();
      }
    },
  };
}

if (require.main === module) {
  startServer()
    .then(({ hostname, port }) => {
      console.log(`[CCH] Server listening on http://${hostname}:${port}`);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = {
  createResponsesWebSocketConnectionHandler,
  createResponsesUpgradeServer,
  startServer,
};

import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import http from "node:http";
import { dirname, join } from "node:path";
import process from "node:process";
import { describe, expect, test } from "vitest";
import { WebSocketServer } from "ws";

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
 */

type ProbeEvent =
  | { type: "server_started"; port: number }
  | { type: "http_models" }
  | { type: "http_responses"; bytes: number }
  | { type: "http_unknown"; method: string | undefined; path: string }
  | { type: "ws_upgrade"; path: string }
  | { type: "ws_connection"; path: string | undefined }
  | { type: "ws_message"; bytes: number; frameType: string | null; isBinary: boolean }
  | { type: "ws_close"; code: number; reason: string };

type CodexResult = {
  code: number | null;
  stdout: string;
  stderr: string;
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
const providerName = "local-cch-ws-e2e";
const model = process.env.CCH_CODEX_E2E_MODEL || "gpt-5";
const responseText = "E2E_TRANSPORT_OK";
const defaultFeatures = "responses_websockets,responses_websockets_v2";

function responseEnvelope() {
  return {
    id: "resp_cch_ws_e2e",
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    model,
    status: "completed",
    output: [
      {
        id: "msg_cch_ws_e2e",
        type: "message",
        status: "completed",
        role: "assistant",
        content: [{ type: "output_text", text: responseText }],
      },
    ],
    usage: {
      input_tokens: 8,
      output_tokens: 4,
      total_tokens: 12,
    },
  };
}

function responseEvents() {
  const response = responseEnvelope();
  const item = response.output[0];
  const content = item.content[0];
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
  for (const event of responseEvents()) {
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
  wss.on("connection", (ws, req) => {
    record({ type: "ws_connection", path: req.url });
    ws.on("message", (raw, isBinary) => {
      const text = isBinary ? raw.toString("base64") : raw.toString("utf8");
      let frameType: string | null = null;
      try {
        frameType = JSON.parse(text).type || null;
      } catch {
        frameType = "invalid_json";
      }
      record({
        type: "ws_message",
        bytes: Buffer.byteLength(text, "utf8"),
        frameType,
        isBinary,
      });
      for (const event of responseEvents()) {
        ws.send(JSON.stringify(event));
      }
      ws.close(1000, "response_completed");
    });
    ws.on("close", (code, reason) => {
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
      await new Promise<void>((resolve) => wss.close(() => resolve()));
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
    const cmdPath = execFileSync("where.exe", ["codex.cmd"], { encoding: "utf8" })
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

function runCodex(port: number, invocation: CodexInvocation): Promise<CodexResult> {
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
    `model_providers.${providerName}.requires_openai_auth=true`,
    "-C",
    process.cwd(),
    `Reply exactly ${responseText} and do not run tools.`,
  ];

  return new Promise((resolve) => {
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
    let settled = false;
    const finish = (result: CodexResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };
    const timeout = setTimeout(() => {
      stderr += "codex exec timed out";
      child.kill();
      finish({ code: -2, stdout, stderr });
    }, 60_000);

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
}

function observedTransport(events: ProbeEvent[]) {
  const sawWsCreateFrame = events.some(
    (event) => event.type === "ws_message" && event.frameType === "response.create"
  );
  if (sawWsCreateFrame) return "websocket";
  if (events.some((event) => event.type === "http_responses")) return "http";
  return "none";
}

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
      const sawCleanWsClose = probe.events.some(
        (event) => event.type === "ws_close" && event.code === 1000
      );

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

      if (transport === "websocket") {
        expect(sawCleanWsClose).toBe(true);
      }
      if (expectedTransport !== "any") {
        expect(transport).toBe(expectedTransport);
      }
    } finally {
      await probe.close();
    }
  }, 70_000);
});

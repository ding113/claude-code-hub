// @vitest-environment node

import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type WebSocket, WebSocketServer } from "ws";
import { completeCodexSessionIdentifiers } from "@/app/v1/_lib/codex/session-completer";
import { ResponsesWsContinuationError } from "@/app/v1/_lib/proxy/errors";
import { ProxyForwarder } from "@/app/v1/_lib/proxy/forwarder";
import { ProxySession } from "@/app/v1/_lib/proxy/session";
import {
  INTERNAL_SECRET_HEADER,
  RESPONSES_WS_GENERATION_HEADER,
  RESPONSES_WS_SESSION_HEADER,
  WS_FORWARD_FLAG_HEADER,
} from "@/app/v1/_lib/responses-ws/internal-secret";
import {
  clearResponsesWsSessionsForTests,
  getResponsesWsSessionBinding,
  tryResponsesWebsocketUpstream,
} from "@/app/v1/_lib/responses-ws/upstream-adapter";
import type { Provider } from "@/types/provider";

const SESSION_ID = "01a1447b-8df8-7692-8ec2-cd8fcfa0016c";
const CONNECTION_ID = "local-header-continuation-connection";
const INTERNAL_SECRET = "local-header-continuation-secret";

type ReceivedFrame = { socket: WebSocket; body: Record<string, unknown> };
type LocalServer = {
  url: string;
  frames: ReceivedFrame[];
  handshakes: Array<{ sessionId?: string; sessionAlias?: string }>;
  close: () => Promise<void>;
};

async function startLocalServer(): Promise<LocalServer> {
  const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  const frames: ReceivedFrame[] = [];
  const handshakes: LocalServer["handshakes"] = [];
  wss.on("connection", (socket, request) => {
    handshakes.push({
      sessionId: request.headers.session_id as string | undefined,
      sessionAlias: request.headers["x-session-id"] as string | undefined,
    });
    socket.on("message", (data) => {
      frames.push({ socket, body: JSON.parse(data.toString()) as Record<string, unknown> });
      socket.send(
        JSON.stringify({
          type: "response.completed",
          response: { id: frames.length === 1 ? "resp_normal" : "resp_compact" },
        })
      );
    });
  });
  await new Promise<void>((resolve, reject) => {
    wss.once("error", reject);
    wss.once("listening", () => {
      wss.off("error", reject);
      resolve();
    });
  });
  const address = wss.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}/v1/responses`,
    frames,
    handshakes,
    close: async () => {
      for (const socket of wss.clients) socket.terminate();
      await new Promise<void>((resolve, reject) => {
        wss.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

function createSession(body: Record<string, unknown>): ProxySession {
  const headers = new Headers({
    "user-agent": "CodexLocalTest/1.0",
    "x-cch-client-transport": "websocket",
    [INTERNAL_SECRET_HEADER]: INTERNAL_SECRET,
    [WS_FORWARD_FLAG_HEADER]: "1",
    [RESPONSES_WS_SESSION_HEADER]: CONNECTION_ID,
  });
  return Object.assign(Object.create(ProxySession.prototype), {
    headers,
    originalHeaders: new Headers(headers),
    userAgent: "CodexLocalTest/1.0",
    request: { message: body, log: "" },
    sessionId: "01a15236-a883-75f3-8735-86cdb16316ac",
    upstreamSessionSeed: null,
    cacheTtlResolved: null,
  });
}

function createProvider(url: string): Provider {
  return {
    id: 1,
    providerType: "codex",
    key: "local-original-credential",
    url,
    preserveClientIp: false,
  } as Provider;
}

function buildHeaders(session: ProxySession, provider: Provider, url: string): Headers {
  const forwarder = ProxyForwarder as unknown as {
    buildHeaders: (session: ProxySession, provider: Provider, upstreamBaseUrl: string) => Headers;
  };
  return forwarder.buildHeaders(session, provider, url);
}

async function sendTurn(options: Parameters<typeof tryResponsesWebsocketUpstream>[0]) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2_000);
  try {
    const result = await tryResponsesWebsocketUpstream({
      ...options,
      abortSignal: controller.signal,
    });
    if (!("response" in result)) throw new Error(`Local WebSocket failed: ${result.reason}`);
    await result.response.text();
    return result;
  } finally {
    clearTimeout(timer);
  }
}

describe("Codex WebSocket session headers through local continuation", () => {
  let server: LocalServer | undefined;

  beforeEach(() => {
    vi.stubEnv("CCH_RESPONSES_WS_INTERNAL_SECRET", INTERNAL_SECRET);
  });

  afterEach(async () => {
    clearResponsesWsSessionsForTests();
    try {
      await server?.close();
    } finally {
      server = undefined;
      vi.unstubAllEnvs();
    }
  });

  async function establishNormalTurn() {
    server = await startLocalServer();
    const provider = createProvider(server.url);
    const normal = createSession({
      model: "local-model",
      store: false,
      prompt_cache_key: `  ${SESSION_ID}  `,
      input: [{ role: "user", content: "normal turn" }],
    });
    const originalBody = structuredClone(normal.request.message);
    const originalHeaders = Object.fromEntries(normal.originalHeaders);
    const completion = await completeCodexSessionIdentifiers({
      keyId: 1,
      headers: normal.headers,
      requestBody: normal.request.message,
      userAgent: normal.userAgent,
    });
    expect(completion.source).toBe("body_prompt_cache_key");
    expect(completion.action).toBe("completed_missing_fields");
    const headers = buildHeaders(normal, provider, server.url);
    const result = await sendTurn({
      provider,
      upstreamUrl: server.url,
      upstreamHeaders: headers,
      sessionId: CONNECTION_ID,
      endpointId: 10,
      body: normal.request.message,
    });
    expect(result.reused).toBe(false);
    expect(normal.request.message).toEqual(originalBody);
    expect(Object.fromEntries(normal.originalHeaders)).toEqual(originalHeaders);
    const binding = getResponsesWsSessionBinding(CONNECTION_ID);
    expect(binding).toMatchObject({ active: false, connectionLocal: true });
    if (!binding) throw new Error("Local WebSocket binding was not retained");
    return { provider, headers, binding };
  }

  function createCompactSession() {
    return createSession({
      model: "local-model",
      store: false,
      prompt_cache_key: `  ${SESSION_ID}  `,
      previous_response_id: "resp_normal",
      input: [{ type: "compaction_trigger" }],
      metadata: { test: "raw compact" },
    });
  }

  it("reuses the physical socket and generation for raw compact with a stable body key", async () => {
    const { provider, headers, binding } = await establishNormalTurn();
    const compact = createCompactSession();
    const originalBody = structuredClone(compact.request.message);
    const originalHeaders = Object.fromEntries(compact.originalHeaders);
    const incomingHeaders = Object.fromEntries(compact.headers);
    const compactHeaders = buildHeaders(compact, provider, server!.url);
    expect(Object.fromEntries(compactHeaders)).toEqual(Object.fromEntries(headers));
    expect(compactHeaders.get("session_id")).toBe(SESSION_ID);
    expect(compactHeaders.get("x-session-id")).toBe(SESSION_ID);

    const result = await sendTurn({
      provider,
      upstreamUrl: server!.url,
      upstreamHeaders: compactHeaders,
      sessionId: CONNECTION_ID,
      endpointId: 10,
      continuationBinding: binding,
      body: compact.request.message,
    });
    expect(result.reused).toBe(true);
    expect(result.response.headers.get(RESPONSES_WS_GENERATION_HEADER)).toBe(binding.generation);
    expect(getResponsesWsSessionBinding(CONNECTION_ID)).toEqual(binding);
    expect(server!.handshakes).toEqual([{ sessionId: SESSION_ID, sessionAlias: SESSION_ID }]);
    expect(server!.frames).toHaveLength(2);
    expect(server!.frames[1].socket).toBe(server!.frames[0].socket);
    expect(server!.frames[1].body).toEqual({ type: "response.create", ...originalBody });
    expect(compact.request.message).toEqual(originalBody);
    expect(Object.fromEntries(compact.headers)).toEqual(incomingHeaders);
    expect(Object.fromEntries(compact.originalHeaders)).toEqual(originalHeaders);
  });

  it.each(["credential", "endpoint", "url", "session key"] as const)(
    "rejects a real %s change before sending another frame",
    async (change) => {
      const { provider, binding } = await establishNormalTurn();
      const compact = createCompactSession();
      if (change === "session key") {
        compact.request.message.prompt_cache_key = "01a15236-a883-75f3-8735-86cdb16316ac";
      }
      const originalBody = structuredClone(compact.request.message);
      const originalHeaders = Object.fromEntries(compact.originalHeaders);
      const incomingHeaders = Object.fromEntries(compact.headers);
      const candidateProvider =
        change === "credential" ? { ...provider, key: "local-changed-credential" } : provider;
      const upstreamUrl = change === "url" ? `${server!.url}?route=changed` : server!.url;
      const options = {
        provider: candidateProvider,
        upstreamUrl,
        upstreamHeaders: buildHeaders(compact, candidateProvider, upstreamUrl),
        sessionId: CONNECTION_ID,
        endpointId: change === "endpoint" ? 11 : 10,
        continuationBinding: binding,
        body: compact.request.message,
      };
      const error = await sendTurn(options).then(
        () => null,
        (error: unknown) => error
      );
      expect(error).toBeInstanceOf(ResponsesWsContinuationError);
      expect(error).toMatchObject({ reason: "upstream_session_changed" });
      expect(server!.handshakes).toHaveLength(1);
      expect(server!.frames).toHaveLength(1);
      expect(getResponsesWsSessionBinding(CONNECTION_ID)).toEqual(binding);
      expect(compact.request.message).toEqual(originalBody);
      expect(Object.fromEntries(compact.headers)).toEqual(incomingHeaders);
      expect(Object.fromEntries(compact.originalHeaders)).toEqual(originalHeaders);

      const restored = createCompactSession();
      const result = await sendTurn({
        ...options,
        provider,
        upstreamUrl: server!.url,
        upstreamHeaders: buildHeaders(restored, provider, server!.url),
        endpointId: 10,
        body: restored.request.message,
      });
      expect(result.reused).toBe(true);
      expect(server!.handshakes).toHaveLength(1);
      expect(server!.frames).toHaveLength(2);
      expect(server!.frames[1].socket).toBe(server!.frames[0].socket);
      expect(getResponsesWsSessionBinding(CONNECTION_ID)?.generation).toBe(binding.generation);
    }
  );
});

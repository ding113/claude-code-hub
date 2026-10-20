import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/config", () => ({
  isHttp2Enabled: async () => false,
  getCachedSystemSettings: async () => ({
    enableClaudeMetadataUserIdInjection: false,
    enableBillingHeaderRectifier: false,
  }),
}));
vi.mock("@/lib/proxy-agent", () => ({
  getProxyAgentForProvider: async () => null,
  getGlobalAgentPool: () => ({}),
}));
vi.mock("@/lib/request-filter-engine", () => ({
  requestFilterEngine: { applyFinal: async () => undefined },
}));
vi.mock("@/lib/langfuse", () => ({ isLangfuseEnabled: () => false }));
vi.mock("@/lib/session-manager", () => ({ SessionManager: {} }));
vi.mock("@/lib/concurrency/provider-request-limiter", () => ({}));
vi.mock("@/lib/provider-endpoints/endpoint-selector", () => ({}));
vi.mock("@/lib/endpoint-circuit-breaker", () => ({}));
vi.mock("@/lib/vendor-type-circuit-breaker", () => ({}));
vi.mock("@/drizzle/db", () => ({ db: {} }));
vi.mock("@/lib/error-rule-detector", () => ({
  errorRuleDetector: { detect: async () => null },
}));
vi.mock("@/repository/message", () => ({}));
vi.mock("@/repository/provider", () => ({}));
vi.mock("@/app/v1/_lib/proxy/provider-selector", () => ({ ProxyProviderResolver: {} }));
vi.mock("@/app/v1/_lib/proxy/response-handler", () => ({
  isCodexResponsesStreamRequest: () => false,
  shouldForceCodexResponsesStreamHandling: () => false,
}));
vi.mock("@/app/v1/_lib/proxy/detail-snapshot-runtime", () => ({}));
vi.mock("@/app/v1/_lib/proxy/runtime-provider-config", () => ({}));
vi.mock("@/app/v1/_lib/proxy/client-abort-decision", () => ({}));
vi.mock("@/app/v1/_lib/proxy/provider-session-lease", () => ({}));
vi.mock("@/app/v1/_lib/proxy/stream-finalization", () => ({}));
vi.mock("@/app/v1/_lib/proxy/replay/replay-spool", () => ({}));
vi.mock("@/app/v1/_lib/responses-ws/eligibility", () => ({
  evaluateResponsesWsEligibility: async () => ({ eligible: false, isWebsocketClient: false }),
  getResponsesWsSessionId: () => null,
}));
vi.mock("@/app/v1/_lib/responses-ws/upstream-adapter", () => ({}));

import { resolveEndpointPolicy } from "@/app/v1/_lib/proxy/endpoint-policy";
import { ProxyForwarder } from "@/app/v1/_lib/proxy/forwarder";
import type { ProxySession } from "@/app/v1/_lib/proxy/session";
import type { Provider } from "@/types/provider";

afterEach(() => vi.restoreAllMocks());

describe.each(["explicit", "default"] as const)("MiniMax serialized HTTP requests (%s)", (mode) => {
  it.each([
    ["https://api.minimax.io", "claude", "MiniMax-M3.1-Flash"],
    ["https://api.minimaxi.com", "claude", "MiniMax-M3"],
    ["https://api.minimax.io", "openai-compatible", "MiniMax-M3.1-Flash"],
    ["https://api.minimaxi.com", "openai-compatible", "MiniMax-M3"],
    ["https://api.minimaxi.com", "claude", "MiniMax-M3.1-Flash"],
    ["https://api.minimax.io", "claude", "MiniMax-M3"],
    ["https://api.minimaxi.com", "openai-compatible", "MiniMax-M3.1-Flash"],
    ["https://api.minimax.io", "openai-compatible", "MiniMax-M3"],
    ["https://openrouter.ai/api", "openai-compatible", "minimax/minimax-m3.1-flash:free"],
    ["https://api.minimax.io", "claude", "MiniMax-M2.7"],
    ["https://gateway.example", "openai-compatible", "saved-custom-alias"],
  ] as const)(
    "preserves %s / %s / %s at the HTTP boundary",
    async (origin, providerType, model) => {
      const anthropic = providerType === "claude";
      const flash = model.toLowerCase().includes("m3.1-flash");
      const path = anthropic ? "/v1/messages" : "/v1/chat/completions";
      const provider = {
        id: 1,
        name: "MiniMax",
        providerType,
        url: `${origin}${anthropic ? "/anthropic" : "/v1"}`,
        key: "fixture-provider-key",
        preserveClientIp: false,
        mcpPassthroughType: "none",
        modelRedirects: null,
      } as unknown as Provider;
      const message = {
        model,
        max_tokens: 4096,
        ...(mode === "explicit" ? { thinking: { type: flash ? "adaptive" : "disabled" } } : {}),
        ...(flash && mode === "explicit"
          ? anthropic
            ? { output_config: { effort: "max" } }
            : { reasoning_effort: "max" }
          : {}),
        messages: [
          {
            role: "user",
            content: anthropic
              ? [
                  { type: "text", text: "Describe this image" },
                  { type: "image", source: { type: "url", url: "https://example.com/image.png" } },
                ]
              : [
                  { type: "text", text: "Describe this video" },
                  { type: "video_url", video_url: { url: "mm_file://fixture-video" } },
                ],
          },
        ],
      };
      const original = structuredClone(message);
      const headers = new Headers({
        "content-type": "application/json",
        "x-api-key": "fixture-hub-key",
      });
      const session = {
        requestUrl: new URL(`https://hub.example${path}`),
        method: "POST",
        headers,
        originalHeaders: new Headers(headers),
        request: { message, model, log: JSON.stringify(message) },
        provider,
        originalFormat: anthropic ? "claude" : "openai",
        userAgent: "test",
        authState: { success: true, user: null, key: null },
        sessionId: null,
        messageContext: null,
        clientAbortSignal: null,
        shouldPersistSessionDebugArtifacts: () => false,
        isHighConcurrencyModeEnabled: () => false,
        setCacheTtlResolved: vi.fn(),
        clientRequestsContext1m: () => false,
        getEndpointPolicy: () => resolveEndpointPolicy(path),
        getCurrentModel: () => model,
        getOriginalModel: () => model,
        addSpecialSetting: vi.fn(),
        getSpecialSettings: () => [],
        isHeaderModified: () => false,
        clearCurrentModelRedirect: vi.fn(),
        isModelRedirected: () => false,
        isOpenAIImageMultipartRequest: () => false,
        getOpenAIImageRequestMetadata: () => null,
      } as unknown as ProxySession;
      const forwarder = ProxyForwarder as unknown as {
        doForward: (session: ProxySession, provider: Provider, url: string) => Promise<Response>;
        fetchWithoutAutoDecode: (url: string, init: RequestInit) => Promise<Response>;
      };
      const transport = vi.spyOn(forwarder, "fetchWithoutAutoDecode").mockResolvedValue(
        new Response(JSON.stringify({ id: "fixture-response" }), {
          headers: { "content-type": "application/json" },
        })
      );
      const response = await forwarder.doForward(session, provider, provider.url);
      expect(response.status).toBe(200);
      expect(transport).toHaveBeenCalledTimes(1);
      const [url, init] = transport.mock.calls[0];
      expect(url).toBe(`${origin}${anthropic ? "/anthropic" : ""}${path}`);
      expect(init.method).toBe("POST");
      const outgoing = JSON.parse(init.body as string);
      expect(outgoing).toEqual(original);
      expect(outgoing).not.toHaveProperty("service_tier");
      expect(outgoing).not.toHaveProperty("reasoning_split");
      const sentHeaders = new Headers(init.headers);
      expect(sentHeaders.get(anthropic ? "x-api-key" : "authorization")).toBe(
        anthropic ? "fixture-provider-key" : "Bearer fixture-provider-key"
      );
    }
  );
});

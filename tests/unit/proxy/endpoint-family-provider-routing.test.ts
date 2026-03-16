import { beforeEach, describe, expect, test, vi } from "vitest";
import { listKnownEndpointFamilies } from "@/app/v1/_lib/proxy/endpoint-family-catalog";
import { detectFormatByEndpoint } from "@/app/v1/_lib/proxy/format-mapper";
import type { Provider } from "@/types/provider";

const circuitBreakerMocks = vi.hoisted(() => ({
  isCircuitOpen: vi.fn(async () => false),
  getCircuitState: vi.fn(() => "closed"),
}));

vi.mock("@/lib/circuit-breaker", () => circuitBreakerMocks);

const ENDPOINT_PROVIDER_CASES = [
  {
    id: "claude-messages",
    path: "/v1/messages",
    requestedModel: "claude-sonnet-4-20250514",
    expectedProviderType: "claude",
  },
  {
    id: "claude-count-tokens",
    path: "/v1/messages/count_tokens",
    requestedModel: "",
    expectedProviderType: "claude",
  },
  {
    id: "response-execution",
    path: "/v1/responses",
    requestedModel: "codex-mini-latest",
    expectedProviderType: "codex",
  },
  {
    id: "response-compact",
    path: "/v1/responses/compact",
    requestedModel: "",
    expectedProviderType: "codex",
  },
  {
    id: "response-resources",
    path: "/v1/responses/resp_123/input_items",
    requestedModel: "",
    expectedProviderType: "codex",
  },
  {
    id: "openai-chat-completions",
    path: "/v1/chat/completions",
    requestedModel: "gpt-4o",
    expectedProviderType: "openai-compatible",
  },
  {
    id: "openai-chat-completions-resources",
    path: "/v1/chat/completions/cmpl_123/messages",
    requestedModel: "",
    expectedProviderType: "openai-compatible",
  },
  {
    id: "openai-completions",
    path: "/v1/completions",
    requestedModel: "gpt-3.5-turbo-instruct",
    expectedProviderType: "openai-compatible",
  },
  {
    id: "openai-embeddings",
    path: "/v1/embeddings",
    requestedModel: "text-embedding-3-large",
    expectedProviderType: "openai-compatible",
  },
  {
    id: "openai-moderations",
    path: "/v1/moderations",
    requestedModel: "",
    expectedProviderType: "openai-compatible",
  },
  {
    id: "openai-audio-generation",
    path: "/v1/audio/speech",
    requestedModel: "",
    expectedProviderType: "openai-compatible",
  },
  {
    id: "openai-audio-transcription",
    path: "/v1/audio/transcriptions",
    requestedModel: "",
    expectedProviderType: "openai-compatible",
  },
  {
    id: "openai-audio-resources",
    path: "/v1/audio/voices",
    requestedModel: "",
    expectedProviderType: "openai-compatible",
  },
  {
    id: "openai-images",
    path: "/v1/images/generations",
    requestedModel: "",
    expectedProviderType: "openai-compatible",
  },
  {
    id: "openai-files",
    path: "/v1/files/file_123/content",
    requestedModel: "",
    expectedProviderType: "openai-compatible",
  },
  {
    id: "openai-uploads",
    path: "/v1/uploads/upload_123/complete",
    requestedModel: "",
    expectedProviderType: "openai-compatible",
  },
  {
    id: "openai-batches",
    path: "/v1/batches/batch_123/cancel",
    requestedModel: "",
    expectedProviderType: "openai-compatible",
  },
  {
    id: "openai-models",
    path: "/v1/models/gpt-4o",
    requestedModel: "",
    expectedProviderType: "openai-compatible",
  },
  {
    id: "openai-fine-tuning",
    path: "/v1/fine_tuning/jobs/job_123/events",
    requestedModel: "",
    expectedProviderType: "openai-compatible",
  },
  {
    id: "openai-evals",
    path: "/v1/evals/eval_123/runs",
    requestedModel: "",
    expectedProviderType: "openai-compatible",
  },
  {
    id: "openai-assistants",
    path: "/v1/assistants/asst_123",
    requestedModel: "",
    expectedProviderType: "openai-compatible",
  },
  {
    id: "openai-threads",
    path: "/v1/threads/thread_123/runs",
    requestedModel: "",
    expectedProviderType: "openai-compatible",
  },
  {
    id: "openai-conversations",
    path: "/v1/conversations/conv_123/items",
    requestedModel: "",
    expectedProviderType: "openai-compatible",
  },
  {
    id: "openai-vector-stores",
    path: "/v1/vector_stores/vs_123/search",
    requestedModel: "",
    expectedProviderType: "openai-compatible",
  },
  {
    id: "openai-containers",
    path: "/v1/containers/container_123/files",
    requestedModel: "",
    expectedProviderType: "openai-compatible",
  },
  {
    id: "openai-realtime-http",
    path: "/v1/realtime/sessions",
    requestedModel: "",
    expectedProviderType: "openai-compatible",
  },
  {
    id: "openai-videos",
    path: "/v1/videos/edits",
    requestedModel: "",
    expectedProviderType: "openai-compatible",
  },
  {
    id: "openai-skills",
    path: "/v1/skills/skill_123/content",
    requestedModel: "",
    expectedProviderType: "openai-compatible",
  },
  {
    id: "openai-chatkit",
    path: "/v1/chatkit/threads/thread_123/items",
    requestedModel: "",
    expectedProviderType: "openai-compatible",
  },
  {
    id: "gemini-generate-content",
    path: "/v1beta/models/gemini-2.5-flash:generateContent",
    requestedModel: "gemini-2.5-flash",
    expectedProviderType: "gemini",
  },
  {
    id: "gemini-stream-generate-content",
    path: "/v1beta/models/gemini-2.5-flash:streamGenerateContent",
    requestedModel: "gemini-2.5-flash",
    expectedProviderType: "gemini",
  },
  {
    id: "gemini-count-tokens",
    path: "/v1beta/models/gemini-2.5-flash:countTokens",
    requestedModel: "gemini-2.5-flash",
    expectedProviderType: "gemini",
  },
  {
    id: "gemini-embed-content",
    path: "/v1beta/models/gemini-embedding-001:embedContent",
    requestedModel: "gemini-embedding-001",
    expectedProviderType: "gemini",
  },
  {
    id: "gemini-batch-generate-content",
    path: "/v1beta/models/gemini-2.5-flash:batchGenerateContent",
    requestedModel: "gemini-2.5-flash",
    expectedProviderType: "gemini",
  },
  {
    id: "gemini-batch-embed-contents",
    path: "/v1beta/models/gemini-embedding-001:batchEmbedContents",
    requestedModel: "gemini-embedding-001",
    expectedProviderType: "gemini",
  },
  {
    id: "gemini-async-batch-embed-content",
    path: "/v1beta/models/gemini-embedding-001:asyncBatchEmbedContent",
    requestedModel: "gemini-embedding-001",
    expectedProviderType: "gemini",
  },
  {
    id: "gemini-predict",
    path: "/v1beta/models/imagen-3.0-generate-002:predict",
    requestedModel: "imagen-3.0-generate-002",
    expectedProviderType: "gemini",
  },
  {
    id: "gemini-predict-long-running",
    path: "/v1beta/models/veo-3.0-generate-preview:predictLongRunning",
    requestedModel: "veo-3.0-generate-preview",
    expectedProviderType: "gemini",
  },
  {
    id: "gemini-files",
    path: "/v1beta/files/file-123",
    requestedModel: "",
    expectedProviderType: "gemini",
  },
  {
    id: "gemini-models-resource",
    path: "/v1beta/models/gemini-2.5-flash",
    requestedModel: "",
    expectedProviderType: "gemini",
  },
  {
    id: "gemini-cli-generate-content",
    path: "/v1internal/models/gemini-2.5-flash:generateContent",
    requestedModel: "gemini-2.5-flash",
    expectedProviderType: "gemini-cli",
  },
  {
    id: "gemini-cli-stream-generate-content",
    path: "/v1internal/models/gemini-2.5-flash:streamGenerateContent",
    requestedModel: "gemini-2.5-flash",
    expectedProviderType: "gemini-cli",
  },
] as const;

describe("endpoint family -> provider routing matrix", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createSessionStub(pathname: string, originalModel: string) {
    return {
      originalFormat: detectFormatByEndpoint(pathname),
      authState: null,
      getProvidersSnapshot: async () => [],
      getOriginalModel: () => originalModel,
      getCurrentModel: () => originalModel,
      clientRequestsContext1m: () => false,
    } as any;
  }

  function createTestProvider(
    id: number,
    providerType: Provider["providerType"],
    overrides: Partial<Provider> = {}
  ): Provider {
    return {
      id,
      name: `provider-${id}`,
      url: "https://provider.example.com",
      key: "provider-key",
      providerVendorId: null,
      isEnabled: true,
      weight: 1,
      priority: 0,
      groupPriorities: null,
      costMultiplier: 1,
      groupTag: null,
      providerType,
      preserveClientIp: false,
      modelRedirects: null,
      activeTimeStart: null,
      activeTimeEnd: null,
      allowedModels: null,
      allowedClients: [],
      blockedClients: [],
      mcpPassthroughType: "none",
      mcpPassthroughUrl: null,
      limit5hUsd: null,
      limitDailyUsd: null,
      dailyResetMode: "fixed",
      dailyResetTime: "00:00",
      limitWeeklyUsd: null,
      limitMonthlyUsd: null,
      limitTotalUsd: null,
      totalCostResetAt: null,
      limitConcurrentSessions: 0,
      maxRetryAttempts: null,
      circuitBreakerFailureThreshold: 0,
      circuitBreakerOpenDuration: 0,
      circuitBreakerHalfOpenSuccessThreshold: 0,
      proxyUrl: null,
      proxyFallbackToDirect: false,
      firstByteTimeoutStreamingMs: 0,
      streamingIdleTimeoutMs: 0,
      requestTimeoutNonStreamingMs: 0,
      websiteUrl: null,
      faviconUrl: null,
      cacheTtlPreference: null,
      swapCacheTtlBilling: false,
      context1mPreference: null,
      codexReasoningEffortPreference: null,
      codexReasoningSummaryPreference: null,
      codexTextVerbosityPreference: null,
      codexParallelToolCallsPreference: null,
      codexServiceTierPreference: null,
      anthropicMaxTokensPreference: null,
      anthropicThinkingBudgetPreference: null,
      anthropicAdaptiveThinking: null,
      geminiGoogleSearchPreference: null,
      tpm: null,
      rpm: null,
      rpd: null,
      cc: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
      ...overrides,
    };
  }

  async function setupResolverMocks() {
    const { ProxyProviderResolver } = await import("@/app/v1/_lib/proxy/provider-selector");

    vi.spyOn(ProxyProviderResolver as any, "filterByLimits").mockImplementation(
      async (...args: unknown[]) => args[0] as Provider[]
    );
    vi.spyOn(ProxyProviderResolver as any, "selectTopPriority").mockImplementation(
      (...args: unknown[]) => args[0] as Provider[]
    );
    vi.spyOn(ProxyProviderResolver as any, "selectOptimal").mockImplementation(
      (...args: unknown[]) => (args[0] as Provider[])[0] ?? null
    );

    return ProxyProviderResolver;
  }

  test("matrix should cover every known endpoint family id", () => {
    expect(new Set(ENDPOINT_PROVIDER_CASES.map((entry) => entry.id))).toEqual(
      new Set(listKnownEndpointFamilies().map((entry) => entry.id))
    );
  });

  test.each(ENDPOINT_PROVIDER_CASES)("$id should route $path to $expectedProviderType", async ({
    path,
    expectedProviderType,
    requestedModel,
  }) => {
    const ProxyProviderResolver = await setupResolverMocks();

    const providers: Provider[] = [
      createTestProvider(1, "claude"),
      createTestProvider(2, "claude-auth"),
      createTestProvider(3, "codex"),
      createTestProvider(4, "openai-compatible"),
      createTestProvider(5, "gemini"),
      createTestProvider(6, "gemini-cli"),
    ];
    const session = createSessionStub(path, requestedModel);
    session.getProvidersSnapshot = async () => providers;

    const { provider, context } = await (ProxyProviderResolver as any).pickRandomProvider(
      session,
      []
    );

    expect(provider?.providerType).toBe(expectedProviderType);
    expect(context.requestedModel).toBe(requestedModel);
  });

  test("/v1/chat/completions should never select codex when openai-compatible is available", async () => {
    const ProxyProviderResolver = await setupResolverMocks();
    const session = createSessionStub("/v1/chat/completions", "gpt-4o");
    session.getProvidersSnapshot = async () => [
      createTestProvider(1, "codex"),
      createTestProvider(2, "openai-compatible"),
    ];

    const { provider } = await (ProxyProviderResolver as any).pickRandomProvider(session, []);

    expect(provider?.providerType).toBe("openai-compatible");
  });

  test("/v1/responses should never select openai-compatible when codex is available", async () => {
    const ProxyProviderResolver = await setupResolverMocks();
    const session = createSessionStub("/v1/responses", "codex-mini-latest");
    session.getProvidersSnapshot = async () => [
      createTestProvider(1, "openai-compatible"),
      createTestProvider(2, "codex"),
    ];

    const { provider } = await (ProxyProviderResolver as any).pickRandomProvider(session, []);

    expect(provider?.providerType).toBe("codex");
  });
});

import type {
  ResponsesWebSocketExecutorInput,
  ResponsesWebSocketJsonEvent,
} from "@/server/responses-websocket-protocol";
import { ResponsesWebSocketSessionState } from "@/server/responses-websocket-session-state";
import { createResponsesWebSocketUpstreamEventStream } from "@/server/responses-websocket-upstream-adapter";
import type { Provider } from "@/types/provider";
import type {
  ResponsesWebSocketProbe,
  ResponsesWebSocketProbeInput,
  ResponsesWebSocketProbeMetadata,
} from "./types";

const DEFAULT_RESPONSES_WEBSOCKET_PROBE_TIMEOUT_MS = 5_000;

export function createDefaultResponsesWebSocketProbe(): ResponsesWebSocketProbe {
  return async (input) => runDefaultResponsesWebSocketProbe(input);
}

async function runDefaultResponsesWebSocketProbe(
  input: ResponsesWebSocketProbeInput
): Promise<ResponsesWebSocketProbeMetadata> {
  const timeoutMs = normalizeProbeTimeoutMs(input.timeoutMs);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const result = createResponsesWebSocketUpstreamEventStream({
      input: createExecutorInput(input, controller.signal),
      provider: createProbeProvider(input),
      globalEnabled: true,
      clientTransport: "websocket",
      connectTimeoutMs: timeoutMs,
    });

    if (result.type === "skipped") {
      return {
        status: "degraded",
        supported: false,
        degraded: true,
        reason: result.reason,
      };
    }

    const firstEvent = await readFirstEvent(result.events);
    if (!firstEvent) {
      return {
        status: "degraded",
        supported: false,
        degraded: true,
        reason: "ws_unsupported",
        errorType: "close_before_first_frame",
      };
    }

    return {
      status: "supported",
      supported: true,
      degraded: false,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function readFirstEvent(
  events: AsyncIterable<ResponsesWebSocketJsonEvent>
): Promise<ResponsesWebSocketJsonEvent | null> {
  for await (const event of events) {
    return event;
  }

  return null;
}

function normalizeProbeTimeoutMs(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined || !Number.isFinite(timeoutMs)) {
    return DEFAULT_RESPONSES_WEBSOCKET_PROBE_TIMEOUT_MS;
  }

  return Math.max(1, Math.min(timeoutMs, DEFAULT_RESPONSES_WEBSOCKET_PROBE_TIMEOUT_MS));
}

function createExecutorInput(
  input: ResponsesWebSocketProbeInput,
  signal: AbortSignal
): ResponsesWebSocketExecutorInput {
  const upstreamBody = { ...input.body };
  if (typeof upstreamBody.model !== "string" && input.model) {
    upstreamBody.model = input.model;
  }

  return {
    id: "provider_test_responses_websocket_probe",
    parsed: {
      type: "response.create",
      upstreamBody: upstreamBody as ResponsesWebSocketExecutorInput["upstreamBody"],
      transport: { stream: true },
      modelSource: "body",
    },
    upstreamBody: upstreamBody as ResponsesWebSocketExecutorInput["upstreamBody"],
    transport: { stream: true },
    modelSource: "body",
    requestUrl: input.requestUrl,
    queueWaitMs: 0,
    metadata: {
      queueWaitMs: 0,
      storeFalseCacheHit: false,
      storeFalseCacheRefusalReason: null,
      storeFalseCacheDebug: null,
    },
    executionContext: {
      requestUrl: input.requestUrl,
      headers: new Headers(input.headers),
      clientAbortSignal: signal,
      sessionState: new ResponsesWebSocketSessionState(),
    },
  };
}

function createProbeProvider(input: ResponsesWebSocketProbeInput): Provider {
  return {
    id: -1,
    name: "provider-test-websocket-probe",
    url: input.providerUrl,
    key: input.apiKey,
    providerType: "codex",
    websiteUrl: null,
  } as Provider;
}

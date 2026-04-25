import type { Context } from "hono";
import type { ResponseRequest } from "@/app/v1/_lib/codex/types/response";
import { attachSessionIdToErrorResponse } from "@/app/v1/_lib/proxy/error-session-id";
import { detectClientFormat, detectFormatByEndpoint } from "@/app/v1/_lib/proxy/format-mapper";
import { ProxyForwarder } from "@/app/v1/_lib/proxy/forwarder";
import { GuardPipelineBuilder } from "@/app/v1/_lib/proxy/guard-pipeline";
import { normalizeResponseInput } from "@/app/v1/_lib/proxy/response-input-rectifier";
import { ProxySession } from "@/app/v1/_lib/proxy/session";
import { getCachedSystemSettings } from "@/lib/config";
import { logger } from "@/lib/logger";
import { SessionManager } from "@/lib/session-manager";
import { updateMessageRequestDetails } from "@/repository/message";
import { streamResponsesWebSocketEventsWithHttpFallback } from "./responses-websocket-fallback-bridge";
import {
  type ResponsesWebSocketDecisionChainSession,
  type ResponsesWebSocketDecisionMetadata,
  type ResponsesWebSocketExecutorInput,
  type ResponsesWebSocketJsonEvent,
  type ResponsesWebSocketRequestExecutor,
  recordResponsesWebSocketDecisionChainObservation,
} from "./responses-websocket-protocol";
import {
  createResponsesWebSocketUpstreamEventStream,
  type ResponsesWebSocketUpstreamAdapterResult,
} from "./responses-websocket-upstream-adapter";

export type ResponsesWebSocketProxyExecutionSession = Pick<ProxySession, "sessionId"> &
  Partial<
    Pick<
      ProxySession,
      | "authState"
      | "headers"
      | "provider"
      | "recordForwardStart"
      | "request"
      | "messageContext"
      | "addProviderToChain"
      | "getProviderChain"
      | "getLastSelectionContext"
    >
  >;

const TERMINAL_CACHEABLE_RESPONSE_EVENT_TYPES = new Set(["response.completed"]);

export type ResponsesWebSocketProxyGuardBoundaryResult = {
  session: ResponsesWebSocketProxyExecutionSession | null;
  earlyResponse: Response | null;
};

export type ResponsesWebSocketProxyGuardBoundary = (
  request: Request
) => Promise<ResponsesWebSocketProxyGuardBoundaryResult>;

export type ResponsesWebSocketProxyUpstreamAdapter = (
  input: ResponsesWebSocketExecutorInput,
  session: ResponsesWebSocketProxyExecutionSession,
  context: { globalEnabled: boolean }
) => ResponsesWebSocketUpstreamAdapterResult | Promise<ResponsesWebSocketUpstreamAdapterResult>;

export type ResponsesWebSocketProxyHttpFallback = (
  input: ResponsesWebSocketExecutorInput,
  session: ResponsesWebSocketProxyExecutionSession
) => Response | Promise<Response>;

export type ResponsesWebSocketProxyGuardExecutorOptions = {
  guardBoundary?: ResponsesWebSocketProxyGuardBoundary;
  upstreamAdapter?: ResponsesWebSocketProxyUpstreamAdapter;
  httpFallback?: ResponsesWebSocketProxyHttpFallback;
  isResponsesWebSocketEnabled?: () => boolean | Promise<boolean>;
};

export function createResponsesWebSocketProxyGuardExecutor(
  options: ResponsesWebSocketProxyGuardExecutorOptions = {}
): ResponsesWebSocketRequestExecutor {
  const guardBoundary = options.guardBoundary ?? runResponsesWebSocketProxyGuardBoundary;
  const upstreamAdapter = options.upstreamAdapter ?? defaultResponsesWebSocketUpstreamAdapter;
  const httpFallback = options.httpFallback ?? defaultResponsesWebSocketHttpFallback;
  const isResponsesWebSocketEnabled =
    options.isResponsesWebSocketEnabled ?? defaultResponsesWebSocketEnabled;

  return async (input) => {
    const request = createProxyGuardRequest(input);
    let guarded: ResponsesWebSocketProxyGuardBoundaryResult;

    try {
      guarded = await guardBoundary(request);
    } catch (error) {
      return [unknownErrorToWebSocketEvent(error)];
    }

    if (guarded.earlyResponse) {
      return [await responseToWebSocketErrorEvent(guarded.earlyResponse)];
    }

    if (!guarded.session) {
      return [
        {
          type: "error",
          error: {
            type: "server_error",
            code: "server_error",
            message: "Responses WebSocket proxy session was not initialized",
          },
        },
      ];
    }

    syncResponsesWebSocketInputFromGuardedSession(input, guarded.session);

    const continuationError = prepareStoreFalseContinuation(input, guarded.session);
    if (continuationError) {
      return [continuationError];
    }

    const globalEnabled = await isResponsesWebSocketEnabled();
    const upstream = await upstreamAdapter(input, guarded.session, { globalEnabled });
    const observed = observeResponsesWebSocketUpstream(input, guarded.session, upstream);

    const events = streamResponsesWebSocketEventsWithHttpFallback({
      requestId: input.id,
      upstream: observed.upstream,
      httpFallback: async () => {
        guarded.session?.recordForwardStart?.();
        try {
          const response = await httpFallback(input, guarded.session!);
          await recordResponsesWebSocketFallbackDecision(
            input,
            guarded.session!,
            observed,
            response.status
          );
          return response;
        } catch (error) {
          await recordResponsesWebSocketFallbackDecision(input, guarded.session!, observed, 502);
          throw error;
        }
      },
    });

    return streamResponsesWebSocketCodexContinuity(input, guarded.session, events);
  };
}

export async function runResponsesWebSocketProxyGuardBoundary(
  request: Request
): Promise<ResponsesWebSocketProxyGuardBoundaryResult> {
  const context = createProxyContext(request);
  const session = await ProxySession.fromContext(context);
  await applyProxyRuntimeSettings(session);
  await detectAndNormalizeProxyFormat(session);

  const pipeline = GuardPipelineBuilder.fromSession(session);
  const earlyResponse = await pipeline.run(session);
  if (earlyResponse) {
    return {
      session,
      earlyResponse: await attachSessionIdToErrorResponse(session.sessionId, earlyResponse),
    };
  }

  return { session, earlyResponse: null };
}

function createProxyGuardRequest(input: ResponsesWebSocketExecutorInput): Request {
  const requestUrl = new URL(input.requestUrl.toString(), "http://localhost");
  const headers = new Headers(input.executionContext.headers ?? undefined);

  for (const header of [
    "connection",
    "upgrade",
    "sec-websocket-accept",
    "sec-websocket-extensions",
    "sec-websocket-key",
    "sec-websocket-protocol",
    "sec-websocket-version",
  ]) {
    headers.delete(header);
  }

  headers.set("content-type", "application/json");

  return new Request(requestUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(input.upstreamBody),
    signal: input.executionContext.clientAbortSignal ?? undefined,
  });
}

function syncResponsesWebSocketInputFromGuardedSession(
  input: ResponsesWebSocketExecutorInput,
  session: ResponsesWebSocketProxyExecutionSession
): void {
  const guardedMessage = session.request?.message;
  if (!isRecord(guardedMessage)) return;

  const syncedBody = guardedMessage as ResponseRequest & Record<string, unknown>;
  input.upstreamBody = syncedBody;
  input.parsed.upstreamBody = syncedBody;

  if (session.headers) {
    input.executionContext.headers = session.headers;
  }
}

function prepareStoreFalseContinuation(
  input: ResponsesWebSocketExecutorInput,
  session: ResponsesWebSocketProxyExecutionSession
): ResponsesWebSocketJsonEvent | null {
  if (!session.provider || !input.executionContext.sessionState) return null;
  if (input.upstreamBody.store !== false) return null;
  if (typeof input.upstreamBody.previous_response_id !== "string") return null;

  const metadata = getMutableResponsesWebSocketExecutionMetadata(input);
  const reuse = input.executionContext.sessionState.resolveStoreFalseCacheReuse({
    requestBody: input.upstreamBody,
    providerIdentity: buildResponsesWebSocketProviderIdentity(session),
  });

  metadata.storeFalseCacheHit = reuse.hit;
  metadata.storeFalseCacheRefusalReason = reuse.hit ? null : reuse.reason;
  metadata.storeFalseCacheDebug = reuse.debugSnapshot;

  if (!reuse.hit) {
    return createFullContextRequiredErrorEvent();
  }

  rewriteStoreFalseContinuationToFullContext(input.upstreamBody, reuse.cachedItemChain);
  return null;
}

function rewriteStoreFalseContinuationToFullContext(
  requestBody: ResponseRequest & Record<string, unknown>,
  cachedItemChain: { inputItems: unknown[]; outputItems: unknown[] }
): void {
  requestBody.input = [
    ...cachedItemChain.inputItems,
    ...cachedItemChain.outputItems,
    ...normalizeResponsesWebSocketItemArray(requestBody.input),
  ] as ResponseRequest["input"];
  delete requestBody.previous_response_id;
}

function createFullContextRequiredErrorEvent(): ResponsesWebSocketJsonEvent {
  return {
    type: "error",
    error: {
      type: "invalid_request_error",
      code: "full_context_required",
      message: "Full context is required for store=false Responses WebSocket continuation",
    },
  };
}

async function* streamResponsesWebSocketCodexContinuity(
  input: ResponsesWebSocketExecutorInput,
  session: ResponsesWebSocketProxyExecutionSession,
  events: AsyncIterable<ResponsesWebSocketJsonEvent>
): AsyncIterable<ResponsesWebSocketJsonEvent> {
  let promptCacheKeyBound = false;

  for await (const event of events) {
    if (!promptCacheKeyBound) {
      promptCacheKeyBound = bindCodexPromptCacheKeyFromEvent(session, event);
    }

    updateStoreFalseContinuationCacheFromEvent(input, session, event);
    yield event;
  }
}

function bindCodexPromptCacheKeyFromEvent(
  session: ResponsesWebSocketProxyExecutionSession,
  event: ResponsesWebSocketJsonEvent
): boolean {
  if (session.provider?.providerType !== "codex") return false;
  if (!session.sessionId || !session.provider.id) return false;

  const promptCacheKey = SessionManager.extractCodexPromptCacheKey(event);
  if (!promptCacheKey) return false;

  void SessionManager.updateSessionWithCodexCacheKey(
    session.sessionId,
    promptCacheKey,
    session.provider.id,
    session.authState?.key?.id ?? session.messageContext?.key?.id ?? null
  ).catch((error) => {
    logger.error("[ResponsesWebSocket] Failed to update Codex session:", error);
  });

  return true;
}

function updateStoreFalseContinuationCacheFromEvent(
  input: ResponsesWebSocketExecutorInput,
  session: ResponsesWebSocketProxyExecutionSession,
  event: ResponsesWebSocketJsonEvent
): void {
  if (!session.provider || !input.executionContext.sessionState) return;
  if (input.upstreamBody.store !== false) return;
  if (!TERMINAL_CACHEABLE_RESPONSE_EVENT_TYPES.has(event.type)) return;

  const response = isRecord(event.response) ? event.response : null;
  if (!response) return;

  input.executionContext.sessionState.updateStoreFalseCache({
    requestBody: input.upstreamBody,
    response,
    providerIdentity: buildResponsesWebSocketProviderIdentity(session),
  });
}

function buildResponsesWebSocketProviderIdentity(session: ResponsesWebSocketProxyExecutionSession) {
  const provider = session.provider;
  if (!provider) {
    throw new Error("Responses WebSocket provider identity requires a provider");
  }

  return {
    providerId: provider.id,
    providerType: provider.providerType,
    upstreamBaseUrl: provider.url,
    endpointId: null,
    endpointUrl: provider.url,
  };
}

function normalizeResponsesWebSocketItemArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return cloneJson(value);
  if (value === undefined || value === null) return [];
  return [cloneJson(value)];
}

function cloneJson<T>(value: T): T {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

async function defaultResponsesWebSocketEnabled(): Promise<boolean> {
  try {
    const settings = await getCachedSystemSettings();
    const configured = (settings as { enableOpenAIResponsesWebSocket?: unknown })
      .enableOpenAIResponsesWebSocket;
    return typeof configured === "boolean" ? configured : true;
  } catch (settingsError) {
    logger.warn("[ResponsesWebSocket] Failed to load WebSocket setting, defaulting to enabled", {
      error: settingsError,
    });
    return true;
  }
}

function defaultResponsesWebSocketUpstreamAdapter(
  input: ResponsesWebSocketExecutorInput,
  session: ResponsesWebSocketProxyExecutionSession,
  context: { globalEnabled: boolean }
): ResponsesWebSocketUpstreamAdapterResult {
  if (!session.provider) {
    return { type: "skipped", reason: "non_codex_provider" };
  }

  return createResponsesWebSocketUpstreamEventStream({
    input,
    provider: session.provider,
    globalEnabled: context.globalEnabled,
    clientTransport: "websocket",
  });
}

async function defaultResponsesWebSocketHttpFallback(
  _input: ResponsesWebSocketExecutorInput,
  session: ResponsesWebSocketProxyExecutionSession
): Promise<Response> {
  if (!isForwardableProxySession(session)) {
    throw new Error("Responses WebSocket HTTP fallback requires a complete proxy session");
  }

  return await ProxyForwarder.send(session);
}

function isForwardableProxySession(
  session: ResponsesWebSocketProxyExecutionSession
): session is ProxySession {
  return !!session.provider && session.authState?.success === true;
}

type ObservedResponsesWebSocketUpstream = {
  upstream: ResponsesWebSocketUpstreamAdapterResult;
  errorBeforeClientEvent: unknown;
};

function observeResponsesWebSocketUpstream(
  input: ResponsesWebSocketExecutorInput,
  session: ResponsesWebSocketProxyExecutionSession,
  upstream: ResponsesWebSocketUpstreamAdapterResult
): ObservedResponsesWebSocketUpstream {
  const observed: ObservedResponsesWebSocketUpstream = { upstream, errorBeforeClientEvent: null };
  if (upstream.type !== "connected") return observed;

  let emittedClientEvent = false;
  observed.upstream = {
    ...upstream,
    events: (async function* () {
      try {
        for await (const event of upstream.events) {
          if (!emittedClientEvent) {
            emittedClientEvent = true;
            await recordResponsesWebSocketUpstreamDecision(input, session);
          }
          yield event;
        }
      } catch (error) {
        if (!emittedClientEvent) observed.errorBeforeClientEvent = error;
        throw error;
      }
    })(),
  };

  return observed;
}

async function recordResponsesWebSocketUpstreamDecision(
  input: ResponsesWebSocketExecutorInput,
  session: ResponsesWebSocketProxyExecutionSession
): Promise<void> {
  const metadata = buildResponsesWebSocketDecisionMetadata(input, {
    upstreamWsAttempted: true,
    upstreamWsConnected: true,
    downgradedToHttp: false,
  });
  await persistResponsesWebSocketDecision(input, session, metadata, 101);
}

async function recordResponsesWebSocketFallbackDecision(
  input: ResponsesWebSocketExecutorInput,
  session: ResponsesWebSocketProxyExecutionSession,
  observed: ObservedResponsesWebSocketUpstream,
  statusCode: number
): Promise<void> {
  const attempted = observed.upstream.type === "connected";
  const unsupportedCacheHit =
    observed.upstream.type === "skipped" && observed.upstream.reason === "ws_unsupported_cached";
  const metadata = buildResponsesWebSocketDecisionMetadata(input, {
    upstreamWsAttempted: attempted,
    upstreamWsConnected: false,
    downgradedToHttp: true,
    downgradeReason: resolveResponsesWebSocketDowngradeReason(
      observed.upstream,
      observed.errorBeforeClientEvent
    ),
    ...(unsupportedCacheHit ? { upstreamWsUnsupportedCacheHit: true } : {}),
  });

  await persistResponsesWebSocketDecision(input, session, metadata, statusCode);
}

function buildResponsesWebSocketDecisionMetadata(
  input: ResponsesWebSocketExecutorInput,
  partial: Omit<ResponsesWebSocketDecisionMetadata, "clientTransport">
): ResponsesWebSocketDecisionMetadata {
  const executionMetadata = getMutableResponsesWebSocketExecutionMetadata(input);

  return {
    clientTransport: "websocket",
    ...partial,
    queueWaitMs: executionMetadata.queueWaitMs,
    storeFalseCacheHit: executionMetadata.storeFalseCacheHit,
    storeFalseCacheRefusalReason: executionMetadata.storeFalseCacheRefusalReason,
  };
}

function getMutableResponsesWebSocketExecutionMetadata(input: ResponsesWebSocketExecutorInput) {
  const unsafeInput = input as ResponsesWebSocketExecutorInput & {
    metadata?: ResponsesWebSocketExecutorInput["metadata"];
    queueWaitMs?: number;
  };
  const metadata = unsafeInput.metadata ?? {
    queueWaitMs: Math.max(0, unsafeInput.queueWaitMs ?? 0),
    storeFalseCacheHit: false,
    storeFalseCacheRefusalReason: null,
    storeFalseCacheDebug: null,
  };

  unsafeInput.metadata = metadata;
  return metadata;
}

async function persistResponsesWebSocketDecision(
  input: ResponsesWebSocketExecutorInput,
  session: ResponsesWebSocketProxyExecutionSession,
  metadata: ResponsesWebSocketDecisionMetadata,
  statusCode: number
): Promise<void> {
  if (!session.provider || !isResponsesWebSocketDecisionChainSession(session)) return;

  resolveStoreFalseCacheObservation(input, session);
  const enrichedMetadata = buildResponsesWebSocketDecisionMetadata(input, {
    upstreamWsAttempted: metadata.upstreamWsAttempted,
    upstreamWsConnected: metadata.upstreamWsConnected,
    downgradedToHttp: metadata.downgradedToHttp,
    ...(metadata.downgradeReason ? { downgradeReason: metadata.downgradeReason } : {}),
    ...(metadata.upstreamWsUnsupportedCacheHit !== undefined
      ? { upstreamWsUnsupportedCacheHit: metadata.upstreamWsUnsupportedCacheHit }
      : {}),
  });

  try {
    recordResponsesWebSocketDecisionChainObservation({
      session,
      provider: session.provider,
      statusCode,
      metadata: enrichedMetadata,
    });

    if (session.messageContext?.id) {
      await updateMessageRequestDetails(session.messageContext.id, {
        statusCode,
        providerId: session.provider.id,
        providerChain: session.getProviderChain(),
      });
    }
  } catch (error) {
    logger.warn("[ResponsesWebSocket] Failed to record decision-chain metadata", {
      sessionId: session.sessionId ?? null,
      providerId: session.provider.id,
      error,
    });
  }
}

function resolveStoreFalseCacheObservation(
  input: ResponsesWebSocketExecutorInput,
  session: ResponsesWebSocketProxyExecutionSession
): void {
  if (!session.provider || !input.executionContext.sessionState) return;

  const metadata = getMutableResponsesWebSocketExecutionMetadata(input);
  if (metadata.storeFalseCacheHit || metadata.storeFalseCacheRefusalReason) return;

  const reuse = input.executionContext.sessionState.resolveStoreFalseCacheReuse({
    requestBody: input.upstreamBody,
    providerIdentity: buildResponsesWebSocketProviderIdentity(session),
  });

  metadata.storeFalseCacheHit = reuse.hit;
  metadata.storeFalseCacheRefusalReason = reuse.hit ? null : reuse.reason;
  metadata.storeFalseCacheDebug = reuse.debugSnapshot;
}

function resolveResponsesWebSocketDowngradeReason(
  upstream: ResponsesWebSocketUpstreamAdapterResult,
  error: unknown
): string {
  if (upstream.type === "skipped") {
    if (upstream.reason === "ws_unsupported_cached") return "upstream_ws_unsupported";
    if (upstream.reason === "global_disabled") return "websocket_disabled";
    return upstream.reason;
  }

  if (isRecord(error)) {
    if (error.code === "upstream_ws_unsupported" || error.fallbackSafe === true) {
      return "upstream_ws_unsupported";
    }
  }

  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/handshake/i.test(message)) return "upstream_ws_handshake_failed";
  return "upstream_ws_error";
}

function isResponsesWebSocketDecisionChainSession(
  session: ResponsesWebSocketProxyExecutionSession
): session is ResponsesWebSocketDecisionChainSession & ResponsesWebSocketProxyExecutionSession {
  return (
    typeof session.addProviderToChain === "function" &&
    typeof session.getProviderChain === "function"
  );
}

async function applyProxyRuntimeSettings(session: ProxySession): Promise<void> {
  try {
    const systemSettings = await getCachedSystemSettings();
    session.setHighConcurrencyModeEnabled(systemSettings.enableHighConcurrencyMode ?? false);
    session.setRawCrossProviderFallbackEnabled(
      systemSettings.allowNonConversationEndpointProviderFallback ?? true
    );
  } catch (settingsError) {
    logger.warn(
      "[ResponsesWebSocket] Failed to load proxy system settings, fallback highConcurrency=false and rawCrossProviderFallback=false",
      { error: settingsError }
    );
    session.setHighConcurrencyModeEnabled(false);
    session.setRawCrossProviderFallbackEnabled(false);
  }
}

async function detectAndNormalizeProxyFormat(session: ProxySession): Promise<void> {
  if (session.originalFormat === "claude") {
    const endpointFormat = detectFormatByEndpoint(session.requestUrl.pathname);

    if (endpointFormat) {
      session.setOriginalFormat(endpointFormat);
    } else {
      session.setOriginalFormat(detectClientFormat(session.request.message));
    }
  }

  if (session.originalFormat === "response") {
    await normalizeResponseInput(session);
  }
}

function createProxyContext(request: Request): Context {
  return {
    req: {
      method: request.method,
      url: request.url,
      raw: request,
      header(name?: string) {
        if (typeof name === "string") return request.headers.get(name) ?? undefined;
        return Object.fromEntries(request.headers.entries());
      },
    },
  } as unknown as Context;
}

async function responseToWebSocketErrorEvent(
  response: Response
): Promise<ResponsesWebSocketJsonEvent> {
  const fallback = response.status >= 500 ? "server_error" : "request_error";
  let errorType = fallback;
  let message = response.statusText || fallback;

  try {
    const body = (await response.clone().json()) as {
      error?: { type?: unknown; code?: unknown; message?: unknown };
    };
    errorType = stringOrFallback(body.error?.type ?? body.error?.code, fallback);
    message = stringOrFallback(body.error?.message, message);
  } catch {
    const text = await response.text();
    if (text) message = text;
  }

  return {
    type: "error",
    error: {
      type: errorType,
      code: errorType,
      message,
      status: response.status,
    },
  };
}

function stringOrFallback(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unknownErrorToWebSocketEvent(error: unknown): ResponsesWebSocketJsonEvent {
  return {
    type: "error",
    error: {
      type: "server_error",
      code: "server_error",
      message: error instanceof Error ? error.message : "Responses WebSocket guard failed",
    },
  };
}

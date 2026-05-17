import { logger } from "@/lib/logger";
import type { SystemSettings } from "@/types/system-config";
import type { ClientFormat } from "../format-mapper";
import { ProxyForwarder } from "../forwarder";
import type { ProxySession } from "../session";
import { isFakeStreamingEligible } from "./eligibility";
import type { ProtocolFamily } from "./response-validator";
import {
  type AttemptPerformer,
  buildFakeStreamingNonStreamResponse,
  buildFakeStreamingResponse,
} from "./runner";
import { cloneRequestForInternalNonStreamAttempt, detectClientStreamIntent } from "./stream-intent";

const HEARTBEAT_INTERVAL_MS = 5000;
// The underlying ProxyForwarder runs its own multi-provider loop with fake-200
// detection and serial fallback. We only allow ONE invocation of that loop
// per fake-streaming request to avoid double-counting message context, cost,
// and provider chain. Edge cases that slip past the forwarder's fake-200
// detection (e.g., empty content array, comment-only SSE) end as 502 here
// instead of triggering a second forwarder pass.
const MAX_ATTEMPTS = 1;

function familyFromFormat(format: ClientFormat): ProtocolFamily | null {
  switch (format) {
    case "claude":
      return "anthropic";
    case "openai":
      return "openai-chat";
    case "response":
      return "openai-responses";
    case "gemini":
    case "gemini-cli":
      return "gemini";
    default:
      return null;
  }
}

/**
 * If the request is eligible for fake streaming, run the fake streaming flow
 * and return its Response. Otherwise return null so the caller can fall back
 * to the regular ProxyForwarder + ProxyResponseHandler path.
 */
export async function tryFakeStreamingPath(
  session: ProxySession,
  systemSettings: SystemSettings
): Promise<Response | null> {
  const clientModel = (session.request.model ?? "").toString();
  const providerGroup = session.provider?.groupTag ?? null;
  const eligible = isFakeStreamingEligible(
    clientModel,
    providerGroup,
    systemSettings.fakeStreamingWhitelist
  );
  if (!eligible) return null;

  const family = familyFromFormat(session.originalFormat);
  if (!family) return null;

  const isStream = detectClientStreamIntent({
    format: session.originalFormat,
    pathname: session.requestUrl.pathname,
    search: session.requestUrl.search,
    body: session.request.message,
  });

  // Convert the session request to a non-stream upstream attempt before the
  // forwarder runs. We never let upstream open a streaming response because
  // we need to fully buffer + validate before emitting anything.
  applyNonStreamMutation(session);

  const performAttempt = buildAttemptPerformer(session);
  if (session.clientAbortSignal === null) {
    // No client abort signal means heartbeat / orchestrator can't observe
    // client disconnect — surface the silent degradation in the log so it's
    // not invisible in edge-middleware / test environments where this happens.
    logger.warn("[FakeStreaming] session.clientAbortSignal is null; abort propagation disabled", {
      model: clientModel,
    });
  }
  const abortSignal = session.clientAbortSignal ?? new AbortController().signal;

  if (isStream) {
    logger.debug("[FakeStreaming] taking stream path", {
      model: clientModel,
      providerGroup,
      family,
    });
    return buildFakeStreamingResponse({
      family,
      isStream: true,
      performAttempt,
      abortSignal,
      maxAttempts: MAX_ATTEMPTS,
      heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
    });
  }

  logger.debug("[FakeStreaming] taking non-stream path", {
    model: clientModel,
    providerGroup,
    family,
  });
  return await buildFakeStreamingNonStreamResponse({
    family,
    performAttempt,
    abortSignal,
    maxAttempts: MAX_ATTEMPTS,
  });
}

function applyNonStreamMutation(session: ProxySession): void {
  const cloned = cloneRequestForInternalNonStreamAttempt({
    format: session.originalFormat,
    pathname: session.requestUrl.pathname,
    search: session.requestUrl.search,
    body: session.request.message,
  });
  if (cloned.body) {
    // Mutate in place so downstream forwarder uses the non-stream body.
    for (const key of Object.keys(session.request.message)) {
      delete (session.request.message as Record<string, unknown>)[key];
    }
    Object.assign(session.request.message, cloned.body);
  }

  if (
    cloned.pathname !== session.requestUrl.pathname ||
    cloned.search !== session.requestUrl.search
  ) {
    const next = new URL(session.requestUrl.toString());
    next.pathname = cloned.pathname;
    next.search = cloned.search;
    session.requestUrl = next;
  }
}

function buildAttemptPerformer(session: ProxySession): AttemptPerformer {
  return async (_attemptIndex, abortSignal) => {
    if (abortSignal.aborted) {
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    }
    const response = await ProxyForwarder.send(session);
    try {
      const body = await response.text();
      return {
        status: response.status,
        body,
        providerId: session.provider?.id != null ? String(session.provider.id) : "unknown",
      };
    } finally {
      // ProxyForwarder.send hangs cleanup callbacks on the session that
      // ProxyResponseHandler.dispatch is normally responsible for invoking.
      // Since fake streaming consumes the response body itself, we must run
      // them here or the response timeout timer + agent-pool reservation will
      // leak.
      releaseForwarderResources(session);
    }
  };
}

function releaseForwarderResources(session: ProxySession): void {
  const augmented = session as ProxySession & {
    clearResponseTimeout?: (() => void) | null;
    releaseAgent?: (() => void) | null;
  };
  try {
    augmented.clearResponseTimeout?.();
  } catch {
    /* swallow cleanup errors */
  }
  augmented.clearResponseTimeout = null;
  try {
    augmented.releaseAgent?.();
  } catch {
    /* swallow cleanup errors */
  }
  augmented.releaseAgent = null;
}

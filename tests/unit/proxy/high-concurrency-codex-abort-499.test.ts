/**
 * Local reproduction: Codex client aborts right after reading `response.completed`,
 * and high-concurrency mode turns an already-finished upstream stream into a
 * billed-as-nothing 499 + a routing reshuffle on the following request.
 *
 * Two independent layers must both hold for the bug to appear:
 *   L1 (predicate) session.shouldRetainClientAbortBilling() short-circuits
 *       clientAbortCompleteSuccess to false (response-handler.ts:1962).
 *   L2 (evidence) the client-abort metering observer is stubbed out, so the
 *       finalizer sees allContent === "" and cannot find a completion marker
 *       even if L1 were fixed (response-handler.ts:3602).
 */
import { describe, expect, it, vi } from "vitest";
import { createClientAbortMeteringObserver } from "@/app/v1/_lib/proxy/client-abort-metering";
import { hasStreamCompletionMarker } from "@/app/v1/_lib/proxy/response-handler";
import { ProxySession } from "@/app/v1/_lib/proxy/session";

vi.mock("@/repository/model-price", () => ({ findLatestPriceByModel: vi.fn() }));
vi.mock("@/repository/system-config", () => ({ getSystemSettings: vi.fn() }));

const encoder = new TextEncoder();

/** Exactly what Codex reads before hanging up: a complete Responses stream. */
const CODEX_COMPLETED_STREAM =
  `event: response.output_text.delta\ndata: ${JSON.stringify({
    type: "response.output_text.delta",
    delta: "hello",
  })}\n\n` +
  `event: response.completed\ndata: ${JSON.stringify({
    type: "response.completed",
    response: {
      id: "resp_195393",
      model: "gpt-5-codex",
      usage: { input_tokens: 1200, output_tokens: 340 },
    },
  })}\n\n`;

function createSession(): ProxySession {
  const session = new (
    ProxySession as unknown as {
      new (init: Record<string, unknown>): ProxySession;
    }
  )({
    startTime: Date.now(),
    method: "POST",
    requestUrl: new URL("http://localhost/v1/responses"),
    headers: new Headers(),
    headerLog: "",
    request: { message: {}, log: "(test)", model: "gpt-5-codex" },
    userAgent: "codex_cli_rs/0.30.0",
    context: {},
    clientAbortSignal: null,
  });
  session.originalFormat = "response";
  return session;
}

/**
 * Mirror of the clientAbortCompleteSuccess IIFE (response-handler.ts:1962) --
 * the real one is module-private, so the decision is reproduced here over the
 * same two inputs the finalizer receives.
 */
function clientAbortCompleteSuccess(session: ProxySession, allContent: string): boolean {
  if (!session.shouldRetainClientAbortBilling()) return false; // L1 short-circuit
  if (!hasStreamCompletionMarker(allContent, session.originalFormat)) return false; // L2
  return true;
}

/** Mirror of the metering observer selection at response-handler.ts:3602. */
function meterFor(session: ProxySession) {
  return session.shouldRetainClientAbortBilling()
    ? createClientAbortMeteringObserver(session.originalFormat)
    : {
        observe: () => ({ billingComplete: false }),
        finish: () => ({ text: "", billingComplete: false, retainedBytes: 0 }),
      };
}

/** Drive the upstream bytes through whichever meter the mode selected. */
function observedContent(session: ProxySession): string {
  const meter = meterFor(session);
  meter.observe(encoder.encode(CODEX_COMPLETED_STREAM));
  return meter.finish().text;
}

describe("high-concurrency mode reclassifies a completed Codex stream as 499", () => {
  /**
   * Bug summary (from production logs 2025-04-17):
   *
   * Codex CLI reads a Responses stream until `response.completed`, then drops
   * the connection. The upstream finished normally with usage tokens, but:
   *
   * 1. High-concurrency mode short-circuits shouldRetainClientAbortBilling() to false.
   * 2. The client-abort meter is stubbed out (response-handler.ts:3602), so
   *    allContent === "" and hasStreamCompletionMarker() returns false.
   * 3. finalizeDeferredStreaming sees clientAborted=true + no completion marker
   *    → effectiveStatusCode = 499 (response-handler.ts:2024).
   * 4. shouldClearSessionBindingOnFailure = true (response-handler.ts:2051)
   *    → clearSessionBinding() is called (response-handler.ts:2119-2131).
   * 5. Next request from the same session loses affinity_hit, reselects a
   *    different provider → prompt cache miss (40% drop observed in logs).
   *
   * Provider chain for affected request (195393):
   *   affinity_hit (Provider A) → request_success (200) → system_error (499)
   *   ^^^^^^^^^^^^^^^^^^^^^^^^^   ^^^^^^^^^^^^^^^^^^^^   ^^^^^^^^^^^^^^^^^^
   *   10:52:44                    11:01:44               11:01:49 (5s later)
   *
   * The 200 came from hedge/single-path commitWinner at first byte;
   * the 499 came from finalizeDeferredStreaming after client abort.
   *
   * Cost: 18 subsequent requests each hit initial_selection, cycling through
   * providers without session affinity, losing ~40% prompt cache benefit.
   *
   * Root cause analysis confirms two independent layers:
   *   L1: shouldRetainClientAbortBilling() returns false (session.ts:594).
   *   L2: client-abort metering observer is stubbed, discarding evidence.
   *
   * Either layer alone is sufficient to trigger the bug.
   * L1 + L2 together guarantee it happens on every Codex abort.
   */
  it("L2: high-concurrency mode discards the completion evidence entirely", () => {
    const session = createSession();
    session.setHighConcurrencyModeEnabled(true);

    expect(observedContent(session)).toBe("");
    expect(hasStreamCompletionMarker(observedContent(session), "response")).toBe(false);
  });

  it("L2 baseline: normal mode retains the response.completed + usage evidence", () => {
    const session = createSession();

    const content = observedContent(session);
    expect(content).toContain("response.completed");
    expect(content).toContain('"output_tokens":340');
    expect(hasStreamCompletionMarker(content, "response")).toBe(true);
  });

  it("reproduces the bug: same finished stream -> 499 on, 200 off", () => {
    const hot = createSession();
    hot.setHighConcurrencyModeEnabled(true);
    const cold = createSession();

    // Client aborted after response.completed; upstream HTTP status was 200.
    expect(clientAbortCompleteSuccess(hot, observedContent(hot))).toBe(false);
    expect(clientAbortCompleteSuccess(cold, observedContent(cold))).toBe(true);
  });

  it("L1 alone is enough: even with full evidence the predicate says no", () => {
    const session = createSession();
    session.setHighConcurrencyModeEnabled(true);

    // Hand it the ideal bytes a fixed drain path would have collected.
    expect(hasStreamCompletionMarker(CODEX_COMPLETED_STREAM, "response")).toBe(true);
    expect(clientAbortCompleteSuccess(session, CODEX_COMPLETED_STREAM)).toBe(false);
  });
});

describe("session-binding cascade: 499 clears affinity, next request reshuffles", () => {
  /**
   * The 499 classification triggers shouldClearSessionBindingOnFailure = true,
   * which calls clearSessionBinding() (response-handler.ts:2119-2131).
   *
   * This means:
   * - Redis session:provider binding is deleted.
   * - Affinity state (tip → provider) may be tombstoned if the failed provider
   *   was the affinity nominee (affinity-recorder.ts:58).
   *
   * Next request from the same session:
   * - provider-selector.ts cannot find a session binding.
   * - affinity lookup either misses or hits a tombstone.
   * - Falls back to initial_selection → weighted random among all providers.
   * - Provider chain shows: initial_selection instead of affinity_hit/session_reuse.
   * - Prompt cache miss (different provider = no KV prefix match).
   *
   * This is observable in production logs:
   * - Request 195393: affinity_hit → request_success (200) → system_error (499)
   * - Requests 195394-195411 (18 requests): all start with initial_selection,
   *   cycling through different providers, cache hit rate drops ~40%.
   */
  it("shouldClearSessionBindingOnFailure is true when clientAbortCompleteSuccess is false", () => {
    const session = createSession();
    session.setHighConcurrencyModeEnabled(true);

    const content = observedContent(session);
    const clientAborted = true;
    const streamEndedNormally = true; // upstream finished normally
    const upstreamStatusCode = 200;

    // Mirror the logic at response-handler.ts:2051
    const complete = clientAbortCompleteSuccess(session, content);
    const shouldClear = (clientAborted || !streamEndedNormally) && !complete;

    expect(complete).toBe(false);
    expect(shouldClear).toBe(true);
  });

  it("normal mode: shouldClearSessionBindingOnFailure is false for completed streams", () => {
    const session = createSession();

    const content = observedContent(session);
    const clientAborted = true;
    const streamEndedNormally = true;

    const complete = clientAbortCompleteSuccess(session, content);
    const shouldClear = (clientAborted || !streamEndedNormally) && !complete;

    expect(complete).toBe(true);
    expect(shouldClear).toBe(false); // binding is NOT cleared
  });
});

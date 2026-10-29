import { afterEach, describe, expect, it, vi } from "vitest";
import {
  attachResponsesWsOutcome,
  copyResponsesWsOutcome,
  getResponsesWsContinuationBinding,
  getResponsesWsOutcome,
  isConnectionLocalResponsesWsContinuation,
  isConnectionLocalResponsesWsRequest,
  type ResponsesWsSessionBinding,
  setResponsesWsContinuationBinding,
} from "../continuation";
import {
  INTERNAL_SECRET_HEADER,
  RESPONSES_WS_PRIOR_LOCAL_HEADER,
  WS_FORWARD_FLAG_HEADER,
} from "../internal-secret";

function trustedHeaders(): Headers {
  vi.stubEnv("CCH_RESPONSES_WS_INTERNAL_SECRET", "continuation-test-secret");
  return new Headers({
    "x-cch-client-transport": "websocket",
    [INTERNAL_SECRET_HEADER]: "continuation-test-secret",
    [WS_FORWARD_FLAG_HEADER]: "1",
  });
}

afterEach(() => vi.unstubAllEnvs());

describe("Responses WS continuation contract", () => {
  it("requires a trusted websocket request for explicit local storage", () => {
    const headers = trustedHeaders();
    expect(isConnectionLocalResponsesWsRequest(headers, { store: false })).toBe(true);
    headers.delete(INTERNAL_SECRET_HEADER);
    expect(isConnectionLocalResponsesWsRequest(headers, { store: false })).toBe(false);
    expect(isConnectionLocalResponsesWsRequest({}, { store: false })).toBe(false);
    expect(isConnectionLocalResponsesWsRequest(new Headers(), { store: false })).toBe(false);
    headers.set(INTERNAL_SECRET_HEADER, "wrong-secret");
    expect(isConnectionLocalResponsesWsRequest(headers, { store: false })).toBe(false);
    headers.set(INTERNAL_SECRET_HEADER, "continuation-test-secret");
    headers.delete(WS_FORWARD_FLAG_HEADER);
    expect(isConnectionLocalResponsesWsRequest(headers, { store: false })).toBe(false);
  });

  it("preserves the prior local response constraint when current store changes", () => {
    const headers = trustedHeaders();
    headers.set(RESPONSES_WS_PRIOR_LOCAL_HEADER, "1");
    expect(isConnectionLocalResponsesWsRequest(headers, {})).toBe(true);
    expect(isConnectionLocalResponsesWsRequest(headers, { store: true })).toBe(true);
    headers.set(RESPONSES_WS_PRIOR_LOCAL_HEADER, "true");
    expect(isConnectionLocalResponsesWsRequest(headers, { store: true })).toBe(false);
    headers.set(RESPONSES_WS_PRIOR_LOCAL_HEADER, "1");
    headers.set("x-cch-client-transport", "http");
    expect(isConnectionLocalResponsesWsRequest(headers, { store: false })).toBe(false);
  });

  it("handles record header casing and only nonempty string previous IDs", () => {
    const headers = Object.fromEntries(trustedHeaders().entries());
    headers["X-CCH-Client-Transport"] = "WebSocket";
    delete headers["x-cch-client-transport"];
    expect(
      isConnectionLocalResponsesWsContinuation(headers, {
        store: false,
        previous_response_id: "resp_previous",
      })
    ).toBe(true);
    for (const previous_response_id of [undefined, "", "  ", 123]) {
      expect(
        isConnectionLocalResponsesWsContinuation(headers, { store: false, previous_response_id })
      ).toBe(false);
    }
    expect(
      isConnectionLocalResponsesWsContinuation(headers, {
        store: true,
        previous_response_id: "resp_stored",
      })
    ).toBe(false);
  });

  it("rejects spoofed markers before internal secret initialization", () => {
    vi.stubEnv("CCH_RESPONSES_WS_INTERNAL_SECRET", "");
    expect(
      isConnectionLocalResponsesWsRequest(
        {
          "x-cch-client-transport": "websocket",
          [WS_FORWARD_FLAG_HEADER]: "1",
          [RESPONSES_WS_PRIOR_LOCAL_HEADER]: "1",
        },
        { store: false }
      )
    ).toBe(false);
  });

  it("stores route bindings by session identity without modifying the session", () => {
    const session = {};
    const otherSession = {};
    const binding: ResponsesWsSessionBinding = {
      sessionId: "client-1",
      generation: "generation-1",
      providerId: 1,
      endpointId: null,
      upstreamUrl: "https://example.test/v1/responses",
      fingerprint: "fingerprint",
      connectionLocal: true,
      active: false,
    };
    expect(getResponsesWsContinuationBinding(session)).toBeUndefined();
    setResponsesWsContinuationBinding(session, binding);
    expect(getResponsesWsContinuationBinding(session)).toBe(binding);
    expect(getResponsesWsContinuationBinding(otherSession)).toBeUndefined();
    expect(Object.keys(session)).toEqual([]);
  });

  it("shares mutable outcome metadata across response wrappers", () => {
    const original = new Response("event");
    const wrapper = new Response("wrapped");
    const outcome = { generation: "generation-1", connectionLocal: true };
    expect(attachResponsesWsOutcome(original, outcome)).toBe(original);
    expect(copyResponsesWsOutcome(original, wrapper)).toBe(wrapper);
    expect(getResponsesWsOutcome(wrapper)).toBe(outcome);
    const originalState = getResponsesWsOutcome(original)!;
    originalState.continuationError = { code: "previous_response_not_found", status: 409 };
    expect(getResponsesWsOutcome(wrapper)?.continuationError).toEqual({
      code: "previous_response_not_found",
      status: 409,
    });
    const unrelated = new Response();
    expect(copyResponsesWsOutcome(unrelated, new Response())).toBeInstanceOf(Response);
    expect(getResponsesWsOutcome(unrelated)).toBeUndefined();
  });
});

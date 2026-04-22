import { describe, expect, test } from "vitest";
import { ProxyResponses } from "@/app/v1/_lib/proxy/responses";
import { attachSessionIdToErrorResponse } from "@/app/v1/_lib/proxy/error-session-id";

describe("ProxyResponses.attachSessionIdToErrorResponse", () => {
  test("appends to error.message for JSON error responses without exposing header", async () => {
    const response = ProxyResponses.buildError(400, "bad request");
    const decorated = await attachSessionIdToErrorResponse("s_123", response);

    expect(decorated.status).toBe(400);
    expect(decorated.headers.get("x-cch-session-id")).toBeNull();

    const body = await decorated.json();
    expect(body.error.message).toBe("bad request (cch_session_id: s_123)");
  });

  test("does nothing when sessionId is missing", async () => {
    const response = ProxyResponses.buildError(400, "bad request");
    const decorated = await attachSessionIdToErrorResponse(undefined, response);

    expect(decorated).toBe(response);
  });

  test("does nothing for non-error responses", async () => {
    const response = new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    const decorated = await attachSessionIdToErrorResponse("s_123", response);

    expect(decorated).toBe(response);
  });

  test("does not double-append when message already contains cch_session_id", async () => {
    const response = ProxyResponses.buildError(400, "bad request (cch_session_id: s_123)");
    const decorated = await attachSessionIdToErrorResponse("s_123", response);

    const body = await decorated.json();
    expect(body.error.message).toBe("bad request (cch_session_id: s_123)");
  });

  test("does not rewrite non-json error responses", async () => {
    const response = new Response("oops", {
      status: 500,
      headers: { "Content-Type": "text/plain" },
    });
    const decorated = await attachSessionIdToErrorResponse("s_123", response);

    expect(decorated).toBe(response);
    expect(await decorated.text()).toBe("oops");
  });

  test("does not rewrite json without error.message", async () => {
    const response = new Response(JSON.stringify({ foo: "bar" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
    const decorated = await attachSessionIdToErrorResponse("s_123", response);

    expect(decorated).toBe(response);
    expect(await decorated.json()).toEqual({ foo: "bar" });
  });

  test("does not rewrite SSE error responses", async () => {
    const response = new Response("data: hi\n\n", {
      status: 500,
      headers: { "Content-Type": "text/event-stream" },
    });
    const decorated = await attachSessionIdToErrorResponse("s_123", response);

    expect(decorated).toBe(response);
    expect(await decorated.text()).toBe("data: hi\n\n");
  });
});

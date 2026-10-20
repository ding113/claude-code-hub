import { describe, expect, test, vi } from "vitest";
import { ProxyResponses } from "@/app/v1/_lib/proxy/responses";
import {
  attachSessionIdToErrorMessage,
  attachSessionIdToErrorResponse,
} from "@/app/v1/_lib/proxy/error-session-id";

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

  test("does not rewrite error responses without content-type", async () => {
    const response = new Response(null, { status: 500 });
    response.headers.delete("content-type");
    const decorated = await attachSessionIdToErrorResponse("s_123", response);

    expect(decorated).toBe(response);
  });

  test("returns original response when error body cannot be read", async () => {
    const response = ProxyResponses.buildError(500, "boom");
    vi.spyOn(response, "clone").mockImplementation(() => {
      throw new Error("body already consumed");
    });

    const decorated = await attachSessionIdToErrorResponse("s_123", response);

    expect(decorated).toBe(response);
    const body = await decorated.json();
    expect(body.error.message).toBe("boom");
  });

  test.each([
    { label: "json null", body: "null" },
    { label: "json top-level string", body: JSON.stringify("plain error") },
    { label: "error is null", body: JSON.stringify({ error: null }) },
    { label: "error is not an object", body: JSON.stringify({ error: "broken" }) },
    { label: "error without message", body: JSON.stringify({ error: {} }) },
    { label: "error.message is not a string", body: JSON.stringify({ error: { message: 123 } }) },
    { label: "invalid json", body: "{invalid json" },
  ])("does not rewrite unrecognized error payload: $label", async ({ body }) => {
    const response = new Response(body, {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
    const decorated = await attachSessionIdToErrorResponse("s_123", response);

    expect(decorated).toBe(response);
    expect(await decorated.text()).toBe(body);
  });
});

describe("attachSessionIdToErrorMessage", () => {
  test("returns message unchanged when sessionId is missing", () => {
    expect(attachSessionIdToErrorMessage(null, "boom")).toBe("boom");
    expect(attachSessionIdToErrorMessage(undefined, "boom")).toBe("boom");
  });

  test("does not double-append when message already carries a session id", () => {
    expect(attachSessionIdToErrorMessage("s_123", "boom (cch_session_id: s_999)")).toBe(
      "boom (cch_session_id: s_999)"
    );
  });

  test("appends session id suffix to plain messages", () => {
    expect(attachSessionIdToErrorMessage("s_123", "boom")).toBe("boom (cch_session_id: s_123)");
  });
});

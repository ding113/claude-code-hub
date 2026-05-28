import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  normalizeResponseOutput,
  normalizeResponseOutputPayload,
} from "@/app/v1/_lib/proxy/response-output-normalizer";
import type { ProxySession } from "@/app/v1/_lib/proxy/session";

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

function createResponseSession(): ProxySession {
  return {
    originalFormat: "response",
    sessionId: "sess_test",
    requestSequence: 1,
  } as unknown as ProxySession;
}

describe("normalizeResponseOutputPayload", () => {
  it("normalizes nullable Responses fields that official SDKs parse as arrays or strings", () => {
    const payload = {
      id: "resp_test",
      object: "response",
      status: "completed",
      output: [
        {
          id: "msg_1",
          type: "message",
          role: "assistant",
          status: "completed",
          content: null,
        },
        {
          id: "msg_2",
          type: "message",
          role: "assistant",
          status: "completed",
          content: [
            {
              type: "output_text",
              text: null,
              annotations: null,
              logprobs: null,
            },
          ],
        },
        {
          id: "fc_1",
          type: "function_call",
          name: "lookup",
          arguments: null,
        },
        {
          id: "tc_1",
          type: "tool_calls",
          tool_calls: [{ function: { name: "search", arguments: { q: "ok" } } }],
        },
        {
          id: "rs_1",
          type: "reasoning",
          summary: null,
        },
      ],
      tools: null,
      usage: null,
    };

    const result = normalizeResponseOutputPayload(payload);

    expect(result.applied).toBe(true);
    expect(payload.output[0].content).toEqual([]);
    expect(payload.output[1].content[0]).toMatchObject({
      text: "",
      annotations: [],
      logprobs: [],
    });
    expect(payload.output[2].arguments).toBe("{}");
    expect(payload.output[3].tool_calls[0].function.arguments).toBe('{"q":"ok"}');
    expect(payload.output[4].summary).toEqual([]);
    expect(payload.tools).toEqual([]);
    expect(payload.usage).toBeNull();
  });

  it("normalizes top-level null output to an empty array", () => {
    const payload = {
      id: "resp_test",
      object: "response",
      status: "completed",
      output: null,
    };

    const result = normalizeResponseOutputPayload(payload);

    expect(result).toMatchObject({ applied: true });
    expect(payload.output).toEqual([]);
  });

  it("leaves non-response JSON payloads untouched", () => {
    const payload = {
      object: "list",
      output: null,
      data: [],
    };

    const result = normalizeResponseOutputPayload(payload);

    expect(result.applied).toBe(false);
    expect(payload.output).toBeNull();
  });
});

describe("normalizeResponseOutput", () => {
  it("returns a new SDK-compatible JSON response when nullable fields are fixed", async () => {
    const response = new Response(
      JSON.stringify({
        id: "resp_test",
        object: "response",
        status: "completed",
        output: [
          {
            id: "msg_1",
            type: "message",
            role: "assistant",
            status: "completed",
            content: [{ type: "output_text", text: null, annotations: null }],
          },
        ],
      }),
      {
        status: 200,
        headers: {
          "content-type": "Application/JSON",
          "content-length": "999",
          "content-encoding": "gzip",
        },
      }
    );

    const normalized = await normalizeResponseOutput(createResponseSession(), response);
    const body = await normalized.json();

    expect(normalized.headers.has("content-length")).toBe(false);
    expect(normalized.headers.has("content-encoding")).toBe(false);
    expect(body.output[0].content[0]).toMatchObject({ text: "", annotations: [] });
  });

  it("skips non-Responses client formats", async () => {
    const response = new Response('{"object":"response","output":null}', {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    const session = {
      ...createResponseSession(),
      originalFormat: "openai",
    } as unknown as ProxySession;

    const normalized = await normalizeResponseOutput(session, response);

    expect(normalized).toBe(response);
  });

  it("returns the original response when no normalization is needed", async () => {
    const response = new Response(
      JSON.stringify({
        id: "resp_test",
        object: "response",
        status: "completed",
        output: [
          {
            id: "msg_1",
            type: "message",
            role: "assistant",
            status: "completed",
            content: [],
          },
        ],
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      }
    );

    const normalized = await normalizeResponseOutput(createResponseSession(), response);

    expect(normalized).toBe(response);
  });

  it("skips non-2xx responses", async () => {
    const response = new Response('{"object":"response","output":null}', {
      status: 500,
      headers: { "content-type": "application/json" },
    });

    const normalized = await normalizeResponseOutput(createResponseSession(), response);

    expect(normalized).toBe(response);
  });

  it("skips non-JSON content types", async () => {
    const response = new Response("text", {
      status: 200,
      headers: { "content-type": "text/plain" },
    });

    const normalized = await normalizeResponseOutput(createResponseSession(), response);

    expect(normalized).toBe(response);
  });

  it("returns the original response when JSON parsing fails", async () => {
    const response = new Response("not json", {
      status: 200,
      headers: { "content-type": "application/json" },
    });

    const normalized = await normalizeResponseOutput(createResponseSession(), response);

    expect(normalized).toBe(response);
  });
});

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { executeProviderTest } from "@/lib/provider-testing/test-service";
import type { ProviderTestConfig } from "@/lib/provider-testing/types";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("executeProviderTest Responses WebSocket compatibility metadata", () => {
  test("keeps Codex HTTP success primary when the optional WebSocket probe succeeds", async () => {
    let probeInput:
      | Parameters<NonNullable<ProviderTestConfig["responsesWebSocketProbe"]>>[0]
      | null = null;

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(createCodexJsonResponse("pong")), {
        status: 200,
        statusText: "OK",
        headers: { "content-type": "application/json" },
      })
    );

    const result = await executeProviderTest({
      providerUrl: "https://codex.example.com/v1",
      apiKey: "sk-test",
      providerType: "codex",
      model: "gpt-5.3-codex",
      preset: "cx_codex_basic",
      timeoutMs: 1_000,
      responsesWebSocketProbe: async (input) => {
        probeInput = input;

        return {
          status: "supported",
          supported: true,
          degraded: false,
        };
      },
    } satisfies ProviderTestConfig);

    expect(result.success).toBe(true);
    expect(result.status).toBe("green");
    expect(result.subStatus).toBe("success");
    expect(result.httpStatusCode).toBe(200);
    expect(result.compatibility?.responsesWebSocket).toEqual({
      status: "supported",
      supported: true,
      degraded: false,
    });
    expect(probeInput).toMatchObject({
      requestUrl: "https://codex.example.com/v1/responses",
      model: "gpt-5.3-codex",
      headers: expect.objectContaining({ Authorization: "Bearer sk-test" }),
      body: expect.objectContaining({ model: "gpt-5.3-codex" }),
    });
    expect(probeInput?.timeoutMs).toBeGreaterThan(0);
    expect(probeInput?.timeoutMs).toBeLessThanOrEqual(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("keeps Codex HTTP success primary when the optional WebSocket probe rejects upgrade", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(createCodexJsonResponse("pong")), {
        status: 200,
        statusText: "OK",
        headers: { "content-type": "application/json" },
      })
    );

    const result = await executeProviderTest({
      providerUrl: "https://codex.example.com/v1",
      apiKey: "sk-test",
      providerType: "codex",
      model: "gpt-5.3-codex",
      preset: "cx_codex_basic",
      timeoutMs: 1_000,
      responsesWebSocketProbe: async () => {
        throw Object.assign(new Error("Unexpected server response: 426"), {
          code: "upstream_ws_unsupported",
        });
      },
    } satisfies ProviderTestConfig);

    expect(result.success).toBe(true);
    expect(result.status).toBe("green");
    expect(result.subStatus).toBe("success");
    expect(result.httpStatusCode).toBe(200);
    expect(result.compatibility?.responsesWebSocket).toMatchObject({
      status: "degraded",
      supported: false,
      degraded: true,
      reason: "ws_unsupported",
      errorType: "upstream_ws_unsupported",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("reports optional WebSocket probe failure as metadata without changing HTTP failure", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { type: "invalid_request_error", message: "bad codex request" },
        }),
        {
          status: 400,
          statusText: "Bad Request",
          headers: { "content-type": "application/json" },
        }
      )
    );

    const result = await executeProviderTest({
      providerUrl: "https://codex.example.com/v1",
      apiKey: "sk-test",
      providerType: "codex",
      model: "gpt-5.3-codex",
      preset: "cx_codex_basic",
      timeoutMs: 1_000,
      responsesWebSocketProbe: async () => {
        throw new Error("WebSocket upgrade refused");
      },
    } satisfies ProviderTestConfig);

    expect(result.success).toBe(false);
    expect(result.status).toBe("red");
    expect(result.subStatus).toBe("invalid_request");
    expect(result.httpStatusCode).toBe(400);
    expect(result.compatibility?.responsesWebSocket).toMatchObject({
      status: "degraded",
      supported: false,
      degraded: true,
      reason: "ws_unsupported",
      errorType: "websocket_probe_error",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

function createCodexJsonResponse(text: string) {
  return {
    id: "resp_test",
    object: "response",
    model: "gpt-5.3-codex",
    output: [
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text }],
      },
    ],
    usage: {
      input_tokens: 1,
      output_tokens: 1,
      total_tokens: 2,
    },
  };
}

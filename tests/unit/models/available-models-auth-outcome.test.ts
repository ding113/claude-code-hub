/**
 * Regression coverage for the `/v1/models` auth chain: every
 * `ApiKeyAuthFailureReason` branch and every user-state branch must surface
 * the correct 401 `error.type` so a downstream regression back to a generic
 * `invalid_api_key` would be caught.
 *
 * Companion to `tests/unit/proxy/auth-guard-account-state.test.ts`, which
 * covers the same matrix on the proxy auth guard.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("@/repository/key", () => ({
  resolveApiKeyAuthOutcome: vi.fn(),
}));

vi.mock("@/lib/proxy-agent", () => ({
  createProxyAgentForProvider: vi.fn(),
}));

vi.mock("@/lib/utils/timezone-resolver", () => ({
  resolveSystemTimezone: vi.fn().mockResolvedValue("UTC"),
}));

vi.mock("@/lib/utils/provider-schedule", () => ({
  isProviderActiveNow: vi.fn().mockReturnValue(true),
}));

vi.mock("@/app/v1/_lib/proxy/provider-selector", () => ({
  checkProviderGroupMatch: vi.fn().mockReturnValue(true),
}));

vi.mock("@/repository/provider", () => ({
  findAllProviders: vi.fn().mockResolvedValue([]),
}));

vi.mock("next-intl/server", () => ({
  getLocale: vi.fn().mockResolvedValue("en"),
}));

vi.mock("@/lib/utils/error-messages", async () => {
  const actual = await vi.importActual<typeof import("@/lib/utils/error-messages")>(
    "@/lib/utils/error-messages"
  );
  return {
    ...actual,
    getErrorMessageServer: vi.fn(async (_locale: string, code: string) => code),
  };
});

function makeContext(apiKey: string) {
  let thrown: Response | null = null;
  const ctx = {
    req: {
      path: "/v1/models",
      url: "http://localhost/v1/models",
      method: "GET",
      header: (name: string) => {
        const normalized = name.toLowerCase();
        if (normalized === "x-api-key") return apiKey;
        if (normalized === "anthropic-version") return undefined;
        return undefined;
      },
      query: () => undefined,
    },
    json: (body: unknown, status?: number) => {
      thrown = new Response(JSON.stringify(body), {
        status: status ?? 200,
        headers: { "content-type": "application/json" },
      });
      return thrown;
    },
    getResponse: () => thrown,
  };
  return ctx;
}

async function callAuthAndCaptureResponse(ctx: ReturnType<typeof makeContext>): Promise<Response> {
  // handleAvailableModels invokes authenticateRequest internally; both
  // resolve through Hono's c.json(...) which the makeContext helper stashes.
  // Because the auth helper throws the c.json response, we catch and inspect.
  const { handleAvailableModels } = await import("@/app/v1/_lib/models/available-models");
  try {
    await handleAvailableModels(ctx as never);
  } catch (thrown) {
    if (thrown instanceof Response) {
      return thrown;
    }
    throw thrown;
  }
  // Fallthrough: ctx.json was called via authenticateRequest with throw, so
  // the stashed response is what we want.
  const response = ctx.getResponse();
  if (!response) {
    throw new Error("Expected handleAvailableModels to throw an auth response");
  }
  return response;
}

async function readErrorBody(response: Response) {
  const json = (await response.json()) as { error: { message: string; type: string } };
  return json.error;
}

describe("handleAvailableModels auth outcomes", () => {
  it("returns 401 key_disabled for a disabled key", async () => {
    const { resolveApiKeyAuthOutcome } = await import("@/repository/key");
    vi.mocked(resolveApiKeyAuthOutcome).mockResolvedValueOnce({
      ok: false,
      reason: "key_disabled",
    });

    const response = await callAuthAndCaptureResponse(makeContext("sk-disabled"));

    expect(response.status).toBe(401);
    const error = await readErrorBody(response);
    expect(error.type).toBe("key_disabled");
    expect(error.message).toBe("PROXY_API_KEY_DISABLED");
  });

  it("returns 401 key_expired for an expired key", async () => {
    const { resolveApiKeyAuthOutcome } = await import("@/repository/key");
    vi.mocked(resolveApiKeyAuthOutcome).mockResolvedValueOnce({
      ok: false,
      reason: "key_expired",
    });

    const response = await callAuthAndCaptureResponse(makeContext("sk-expired"));

    expect(response.status).toBe(401);
    const error = await readErrorBody(response);
    expect(error.type).toBe("key_expired");
    expect(error.message).toBe("PROXY_API_KEY_EXPIRED");
  });

  it("returns 401 invalid_api_key for an unknown key", async () => {
    const { resolveApiKeyAuthOutcome } = await import("@/repository/key");
    vi.mocked(resolveApiKeyAuthOutcome).mockResolvedValueOnce({
      ok: false,
      reason: "not_found",
    });

    const response = await callAuthAndCaptureResponse(makeContext("sk-unknown"));

    expect(response.status).toBe(401);
    const error = await readErrorBody(response);
    expect(error.type).toBe("invalid_api_key");
    expect(error.message).toBe("PROXY_INVALID_API_KEY");
  });

  it("returns 401 user_disabled when the user account is disabled", async () => {
    const { resolveApiKeyAuthOutcome } = await import("@/repository/key");
    vi.mocked(resolveApiKeyAuthOutcome).mockResolvedValueOnce({
      ok: true,
      user: { id: 42, providerGroup: null, isEnabled: false, expiresAt: null },
      key: { providerGroup: null, name: "x" },
    } as never);

    const response = await callAuthAndCaptureResponse(makeContext("sk-userdisabled"));

    expect(response.status).toBe(401);
    const error = await readErrorBody(response);
    expect(error.type).toBe("user_disabled");
  });

  it("returns 401 user_expired when the user account is expired", async () => {
    const { resolveApiKeyAuthOutcome } = await import("@/repository/key");
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    vi.mocked(resolveApiKeyAuthOutcome).mockResolvedValueOnce({
      ok: true,
      user: { id: 43, providerGroup: null, isEnabled: true, expiresAt: yesterday },
      key: { providerGroup: null, name: "x" },
    } as never);

    const response = await callAuthAndCaptureResponse(makeContext("sk-userexpired"));

    expect(response.status).toBe(401);
    const error = await readErrorBody(response);
    expect(error.type).toBe("user_expired");
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Provider } from "@/types/provider";
import {
  CLIENT_TRANSPORT_HEADER,
  evaluateResponsesWsEligibility,
  isWebsocketClientRequest,
} from "../eligibility";
import {
  ensureInternalSecret,
  INTERNAL_SECRET_HEADER,
  WS_FORWARD_FLAG_HEADER,
} from "../internal-secret";
import { clearResponsesWsUnsupportedCache, markResponsesWsUnsupported } from "../unsupported-cache";

const isOpenaiResponsesWebsocketEnabledMock = vi.fn();
vi.mock("@/lib/config/system-settings-cache", () => ({
  isOpenaiResponsesWebsocketEnabled: () => isOpenaiResponsesWebsocketEnabledMock(),
}));

let TEST_SECRET = "";
const originalSecret = process.env.CCH_RESPONSES_WS_INTERNAL_SECRET;

beforeAll(() => {
  // Tests run in the same Node process; the eligibility check verifies
  // against `process.env.CCH_RESPONSES_WS_INTERNAL_SECRET`. Pin a known
  // value so tests are deterministic.
  process.env.CCH_RESPONSES_WS_INTERNAL_SECRET = "test-loopback-secret";
  TEST_SECRET = ensureInternalSecret();
});

afterAll(() => {
  if (originalSecret === undefined) {
    delete process.env.CCH_RESPONSES_WS_INTERNAL_SECRET;
  } else {
    process.env.CCH_RESPONSES_WS_INTERNAL_SECRET = originalSecret;
  }
});

function codexProvider(id = 1): Provider {
  return {
    id,
    name: `codex-${id}`,
    providerType: "codex",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "sk-test",
    enabled: true,
    weight: 1,
    priority: 1,
    costMultiplier: 1,
    groupTag: null,
    providerVendorId: null,
  } as unknown as Provider;
}

function claudeProvider(id = 2): Provider {
  return {
    id,
    name: `claude-${id}`,
    providerType: "claude",
    baseUrl: "https://api.anthropic.com/v1",
    apiKey: "sk-test",
    enabled: true,
    weight: 1,
    priority: 1,
    costMultiplier: 1,
    groupTag: null,
    providerVendorId: null,
  } as unknown as Provider;
}

/**
 * Build a request that LOOKS like the trusted internal tunnel: it has the
 * client-transport marker AND the per-process secret AND the forward flag.
 * Use this whenever you want eligibility to behave as for a true WS request.
 */
function trustedInternalHeaders(extra?: Record<string, string>): Headers {
  const h = new Headers();
  h.set(CLIENT_TRANSPORT_HEADER, "websocket");
  h.set(INTERNAL_SECRET_HEADER, TEST_SECRET);
  h.set(WS_FORWARD_FLAG_HEADER, "1");
  if (extra) {
    for (const [k, v] of Object.entries(extra)) h.set(k, v);
  }
  return h;
}

describe("isWebsocketClientRequest", () => {
  it("treats request with client-transport + valid secret + forward flag as a WS client", () => {
    expect(isWebsocketClientRequest(trustedInternalHeaders())).toBe(true);
  });

  it("rejects requests with client-transport but no internal secret (spoofing attempt)", () => {
    const h = new Headers();
    h.set(CLIENT_TRANSPORT_HEADER, "websocket");
    expect(isWebsocketClientRequest(h)).toBe(false);
  });

  it("rejects requests with client-transport + forward flag but no secret", () => {
    const h = new Headers();
    h.set(CLIENT_TRANSPORT_HEADER, "websocket");
    h.set(WS_FORWARD_FLAG_HEADER, "1");
    expect(isWebsocketClientRequest(h)).toBe(false);
  });

  it("rejects requests with a wrong internal secret", () => {
    const h = new Headers();
    h.set(CLIENT_TRANSPORT_HEADER, "websocket");
    h.set(INTERNAL_SECRET_HEADER, "wrong-secret");
    h.set(WS_FORWARD_FLAG_HEADER, "1");
    expect(isWebsocketClientRequest(h)).toBe(false);
  });

  it("rejects requests with a valid secret but no forward flag", () => {
    const h = new Headers();
    h.set(CLIENT_TRANSPORT_HEADER, "websocket");
    h.set(INTERNAL_SECRET_HEADER, TEST_SECRET);
    expect(isWebsocketClientRequest(h)).toBe(false);
  });

  it("returns false when header is absent or other transport", () => {
    expect(isWebsocketClientRequest({})).toBe(false);
    expect(
      isWebsocketClientRequest({
        [CLIENT_TRANSPORT_HEADER]: "http",
        [INTERNAL_SECRET_HEADER]: TEST_SECRET,
        [WS_FORWARD_FLAG_HEADER]: "1",
      } as Record<string, string>)
    ).toBe(false);
  });

  it("handles record keys regardless of case (HTTP header semantics)", () => {
    expect(
      isWebsocketClientRequest({
        "X-Cch-Client-Transport": "websocket",
        "X-Cch-Internal-Secret": TEST_SECRET,
        "X-Cch-Responses-Ws-Forward": "1",
      } as Record<string, string>)
    ).toBe(true);
    expect(
      isWebsocketClientRequest({
        "X-CCH-Client-TRANSPORT": "WEBSOCKET",
        "X-CCH-INTERNAL-SECRET": TEST_SECRET,
        "X-CCH-Responses-WS-Forward": "1",
      } as Record<string, string>)
    ).toBe(true);
  });
});

describe("evaluateResponsesWsEligibility", () => {
  beforeEach(() => {
    isOpenaiResponsesWebsocketEnabledMock.mockReset();
    clearResponsesWsUnsupportedCache();
  });

  it("returns not-websocket-client when header is absent", async () => {
    isOpenaiResponsesWebsocketEnabledMock.mockResolvedValue(true);
    const result = await evaluateResponsesWsEligibility({
      headers: new Headers(),
      provider: codexProvider(),
      endpointId: null,
    });
    expect(result).toEqual({ isWebsocketClient: false, eligible: false });
  });

  it("treats spoofed requests (no internal secret) as non-WS clients (HTTP path)", async () => {
    isOpenaiResponsesWebsocketEnabledMock.mockResolvedValue(true);
    const spoofed = new Headers();
    spoofed.set(CLIENT_TRANSPORT_HEADER, "websocket");
    spoofed.set(WS_FORWARD_FLAG_HEADER, "1");
    // intentionally no INTERNAL_SECRET_HEADER

    const result = await evaluateResponsesWsEligibility({
      headers: spoofed,
      provider: codexProvider(),
      endpointId: null,
    });
    // Spoofing must NOT be reported as a "ws downgrade" — there was never a
    // legitimate WS client. Return the same shape as a regular HTTP request.
    expect(result).toEqual({ isWebsocketClient: false, eligible: false });
  });

  it("treats requests with a wrong internal secret as non-WS clients", async () => {
    isOpenaiResponsesWebsocketEnabledMock.mockResolvedValue(true);
    const h = new Headers();
    h.set(CLIENT_TRANSPORT_HEADER, "websocket");
    h.set(INTERNAL_SECRET_HEADER, "definitely-not-the-secret");
    h.set(WS_FORWARD_FLAG_HEADER, "1");

    const result = await evaluateResponsesWsEligibility({
      headers: h,
      provider: codexProvider(),
      endpointId: null,
    });
    expect(result).toEqual({ isWebsocketClient: false, eligible: false });
  });

  it("records provider_not_codex for non-codex upstreams", async () => {
    isOpenaiResponsesWebsocketEnabledMock.mockResolvedValue(true);
    const result = await evaluateResponsesWsEligibility({
      headers: trustedInternalHeaders(),
      provider: claudeProvider(),
      endpointId: null,
    });
    expect(result.isWebsocketClient).toBe(true);
    expect(result.eligible).toBe(false);
    expect(result.downgradeReason).toBe("provider_not_codex");
  });

  it("records setting_disabled when global toggle is off", async () => {
    isOpenaiResponsesWebsocketEnabledMock.mockResolvedValue(false);
    const result = await evaluateResponsesWsEligibility({
      headers: trustedInternalHeaders(),
      provider: codexProvider(),
      endpointId: null,
    });
    expect(result.isWebsocketClient).toBe(true);
    expect(result.eligible).toBe(false);
    expect(result.downgradeReason).toBe("setting_disabled");
  });

  it("records endpoint_ws_unsupported_cached when cache flag present", async () => {
    isOpenaiResponsesWebsocketEnabledMock.mockResolvedValue(true);
    const provider = codexProvider(99);
    markResponsesWsUnsupported(provider.id, null, "ws_upgrade_rejected");
    const result = await evaluateResponsesWsEligibility({
      headers: trustedInternalHeaders(),
      provider,
      endpointId: null,
    });
    expect(result.eligible).toBe(false);
    expect(result.downgradeReason).toBe("endpoint_ws_unsupported_cached");
  });

  it("returns eligible when all conditions are met", async () => {
    isOpenaiResponsesWebsocketEnabledMock.mockResolvedValue(true);
    const result = await evaluateResponsesWsEligibility({
      headers: trustedInternalHeaders(),
      provider: codexProvider(),
      endpointId: null,
    });
    expect(result).toMatchObject({
      isWebsocketClient: true,
      eligible: true,
    });
  });
});

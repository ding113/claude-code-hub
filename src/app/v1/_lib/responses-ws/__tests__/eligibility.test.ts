import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Provider } from "@/types/provider";
import {
  CLIENT_TRANSPORT_HEADER,
  evaluateResponsesWsEligibility,
  isWebsocketClientRequest,
} from "../eligibility";
import { clearResponsesWsUnsupportedCache, markResponsesWsUnsupported } from "../unsupported-cache";

const isOpenaiResponsesWebsocketEnabledMock = vi.fn();
vi.mock("@/lib/config/system-settings-cache", () => ({
  isOpenaiResponsesWebsocketEnabled: () => isOpenaiResponsesWebsocketEnabledMock(),
}));

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
    // minimum required shape for our code path; other fields are unused here
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

describe("isWebsocketClientRequest", () => {
  it("detects websocket via Headers object", () => {
    const h = new Headers();
    h.set(CLIENT_TRANSPORT_HEADER, "websocket");
    expect(isWebsocketClientRequest(h)).toBe(true);
  });

  it("detects websocket via plain record", () => {
    expect(
      isWebsocketClientRequest({ [CLIENT_TRANSPORT_HEADER]: "WebSocket" } as Record<string, string>)
    ).toBe(true);
  });

  it("returns false when header is absent or other transport", () => {
    expect(isWebsocketClientRequest({})).toBe(false);
    expect(
      isWebsocketClientRequest({ [CLIENT_TRANSPORT_HEADER]: "http" } as Record<string, string>)
    ).toBe(false);
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

  it("records provider_not_codex for non-codex upstreams", async () => {
    isOpenaiResponsesWebsocketEnabledMock.mockResolvedValue(true);
    const h = new Headers();
    h.set(CLIENT_TRANSPORT_HEADER, "websocket");
    const result = await evaluateResponsesWsEligibility({
      headers: h,
      provider: claudeProvider(),
      endpointId: null,
    });
    expect(result.isWebsocketClient).toBe(true);
    expect(result.eligible).toBe(false);
    expect(result.downgradeReason).toBe("provider_not_codex");
  });

  it("records setting_disabled when global toggle is off", async () => {
    isOpenaiResponsesWebsocketEnabledMock.mockResolvedValue(false);
    const h = new Headers();
    h.set(CLIENT_TRANSPORT_HEADER, "websocket");
    const result = await evaluateResponsesWsEligibility({
      headers: h,
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
    const h = new Headers();
    h.set(CLIENT_TRANSPORT_HEADER, "websocket");
    const result = await evaluateResponsesWsEligibility({
      headers: h,
      provider,
      endpointId: null,
    });
    expect(result.eligible).toBe(false);
    expect(result.downgradeReason).toBe("endpoint_ws_unsupported_cached");
  });

  it("returns eligible when all conditions are met", async () => {
    isOpenaiResponsesWebsocketEnabledMock.mockResolvedValue(true);
    const h = new Headers();
    h.set(CLIENT_TRANSPORT_HEADER, "websocket");
    const result = await evaluateResponsesWsEligibility({
      headers: h,
      provider: codexProvider(),
      endpointId: null,
    });
    expect(result).toMatchObject({
      isWebsocketClient: true,
      eligible: true,
    });
  });
});

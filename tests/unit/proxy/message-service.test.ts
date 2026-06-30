import { beforeEach, describe, expect, it, vi } from "vitest";

const createMessageRequestMock = vi.hoisted(() =>
  vi.fn(async () => ({
    id: 1,
    createdAt: new Date("2026-01-01T00:00:00Z"),
  }))
);

vi.mock("@/repository/message", () => ({
  createMessageRequest: createMessageRequestMock,
}));

import { ProxyMessageService } from "@/app/v1/_lib/proxy/message-service";

describe("ProxyMessageService.ensureContext", () => {
  beforeEach(() => {
    createMessageRequestMock.mockClear();
  });

  function makeSession(options: {
    providerType: string;
    model?: string;
    message: Record<string, unknown>;
    specialSettings?: Array<Record<string, unknown>>;
  }) {
    const specialSettings = [...(options.specialSettings ?? [])];
    return {
      authState: {
        success: true,
        user: { id: 7 },
        key: { id: 9 },
        apiKey: "sk-test",
      },
      provider: {
        id: 3,
        providerType: options.providerType,
        costMultiplier: null,
      },
      request: {
        model: options.model ?? "test-model",
        message: options.message,
      },
      sessionId: "sess-1",
      userAgent: null,
      clientIp: null,
      getEndpoint: () => "/v1/responses",
      getOriginalModel: () => null,
      setOriginalModel: vi.fn(),
      getSpecialSettings: () => specialSettings,
      addSpecialSetting: (setting: Record<string, unknown>) => {
        specialSettings.push(setting);
      },
      getRequestSequence: () => 1,
      getGroupCostMultiplier: () => null,
      getMessagesLength: () => 1,
      setMessageContext: vi.fn(),
    };
  }

  it("captures anthropic output_config.effort into generic and legacy audit settings", async () => {
    const session = makeSession({
      providerType: "claude",
      message: { output_config: { effort: "medium" } },
    });

    await ProxyMessageService.ensureContext(session as never);

    expect(session.getSpecialSettings()).toEqual([
      {
        type: "reasoning_effort",
        scope: "request",
        hit: true,
        path: "output_config.effort",
        effort: "medium",
      },
      {
        type: "anthropic_effort",
        scope: "request",
        hit: true,
        effort: "medium",
      },
    ]);
    expect(createMessageRequestMock).toHaveBeenCalledTimes(1);
  });

  it("captures codex reasoning.effort into generic audit setting", async () => {
    const session = makeSession({
      providerType: "codex",
      message: { reasoning: { effort: "high" } },
    });

    await ProxyMessageService.ensureContext(session as never);

    expect(session.getSpecialSettings()).toEqual([
      {
        type: "reasoning_effort",
        scope: "request",
        hit: true,
        path: "reasoning.effort",
        effort: "high",
      },
    ]);
  });

  it("does not duplicate an existing reasoning_effort audit setting", async () => {
    const session = makeSession({
      providerType: "codex",
      message: { reasoning: { effort: "high" } },
      specialSettings: [
        {
          type: "reasoning_effort",
          scope: "request",
          hit: true,
          path: "reasoning.effort",
          effort: "high",
        },
      ],
    });

    await ProxyMessageService.ensureContext(session as never);

    expect(session.getSpecialSettings()).toEqual([
      {
        type: "reasoning_effort",
        scope: "request",
        hit: true,
        path: "reasoning.effort",
        effort: "high",
      },
    ]);
  });
});

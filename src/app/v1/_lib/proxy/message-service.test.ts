import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ProxySession } from "./session";

const createMessageRequestMock = vi.hoisted(() => vi.fn());

vi.mock("@/repository/message", () => ({
  createMessageRequest: createMessageRequestMock,
}));

import { ProxyMessageService } from "./message-service";

function createSession(providerType: string, message: Record<string, unknown>) {
  const specialSettings: NonNullable<ReturnType<ProxySession["getSpecialSettings"]>> = [];
  const setMessageContext = vi.fn();
  const session = {
    authState: {
      success: true,
      user: { id: 7 },
      key: { id: 8 },
      apiKey: "sk-test",
    },
    provider: {
      id: 9,
      providerType,
      costMultiplier: "1",
    },
    request: { model: "gpt-5", message },
    sessionId: "session-1",
    userAgent: "codex_cli_rs/1.0.0",
    clientIp: "127.0.0.1",
    getEndpoint: () => "/v1/responses",
    getOriginalModel: () => "gpt-5",
    setOriginalModel: vi.fn(),
    getSpecialSettings: () => (specialSettings.length > 0 ? specialSettings : null),
    addSpecialSetting: (setting: (typeof specialSettings)[number]) => specialSettings.push(setting),
    getRequestSequence: () => 1,
    getGroupCostMultiplier: () => "1",
    getMessagesLength: () => 1,
    setMessageContext,
  } as unknown as ProxySession;

  return { session, specialSettings, setMessageContext };
}

describe("ProxyMessageService Codex reasoning effort audit", () => {
  beforeEach(() => {
    createMessageRequestMock.mockReset();
    createMessageRequestMock.mockResolvedValue({ id: 101, createdAt: new Date("2026-07-10") });
  });

  test("Codex 请求创建使用记录前保存 reasoning.effort", async () => {
    const { session, specialSettings, setMessageContext } = createSession("codex", {
      reasoning: { effort: "high" },
    });

    await ProxyMessageService.ensureContext(session);

    expect(specialSettings).toContainEqual({
      type: "codex_reasoning_effort",
      scope: "request",
      hit: true,
      effort: "high",
    });
    expect(createMessageRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({ special_settings: specialSettings })
    );
    expect(setMessageContext).toHaveBeenCalledWith(
      expect.objectContaining({ id: 101, apiKey: "sk-test" })
    );
  });

  test("非 Codex 供应商不写入 Codex 思考强度审计", async () => {
    const { session, specialSettings } = createSession("openai-compatible", {
      reasoning: { effort: "high" },
    });

    await ProxyMessageService.ensureContext(session);

    expect(specialSettings).toEqual([]);
  });

  test("Codex 请求缺少 reasoning.effort 时不写入空审计", async () => {
    const { session, specialSettings } = createSession("codex", { reasoning: {} });

    await ProxyMessageService.ensureContext(session);

    expect(specialSettings).toEqual([]);
  });

  test("复用已有 Codex 思考强度审计，避免重复记录", async () => {
    const { session, specialSettings } = createSession("codex", {
      reasoning: { effort: "high" },
    });
    specialSettings.push({
      type: "codex_reasoning_effort",
      scope: "request",
      hit: true,
      effort: "high",
    });

    await ProxyMessageService.ensureContext(session);

    expect(specialSettings).toHaveLength(1);
  });
});

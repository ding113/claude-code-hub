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
    getManagedEndpoint: () => "/v1/responses",
    getOriginalModel: () => "gpt-5",
    setOriginalModel: vi.fn(),
    getSpecialSettings: () => (specialSettings.length > 0 ? specialSettings : null),
    addSpecialSetting: (setting: (typeof specialSettings)[number]) => specialSettings.push(setting),
    getRequestSequence: () => 1,
    getGroupCostMultiplier: () => "1",
    getMessagesLength: () => 1,
    getSessionIdentityMetadata: () => ({
      identity: "pfx:scope123:fp-deep",
      kind: "prefix_affinity",
      scopeTag: "scope123",
      fingerprint: "fp-deep",
      fingerprints: ["fp-deep", "fp-mid"],
    }),
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

  test("前缀亲和 Session identity 与原始 sessionId 一起写入请求记录", async () => {
    const { session } = createSession("codex", { reasoning: { effort: "high" } });

    await ProxyMessageService.ensureContext(session);

    expect(createMessageRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        session_id: "session-1",
        session_identity: "pfx:scope123:fp-deep",
        session_identity_kind: "prefix_affinity",
        affinity_scope_tag: "scope123",
        affinity_fingerprint: "fp-deep",
        affinity_fingerprint_chain: ["fp-deep", "fp-mid"],
      })
    );
  });

  test("remote compaction v2 uses the compact management endpoint", async () => {
    const { session } = createSession("codex", { input: [{ type: "compaction_trigger" }] });
    (session as unknown as { getManagedEndpoint: () => string }).getManagedEndpoint = () =>
      "/v1/responses/compact";

    await ProxyMessageService.ensureContext(session);

    expect(createMessageRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: "/v1/responses/compact" })
    );
  });
});

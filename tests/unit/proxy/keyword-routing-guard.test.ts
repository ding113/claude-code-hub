import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/drizzle/db", () => ({
  db: {
    insert: vi.fn(() => ({
      values: vi.fn(async () => undefined),
    })),
  },
}));

vi.mock("@/drizzle/schema", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/drizzle/schema")>();
  return {
    ...actual,
    messageRequest: {},
  };
});

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
  },
}));

vi.mock("@/lib/keyword-routing/engine", () => ({
  keywordRoutingEngine: {
    isEmpty: vi.fn(() => false),
    match: vi.fn(() => null),
  },
}));

vi.mock("@/lib/config/system-settings-cache", () => ({
  isKeywordModelRoutingEnabled: vi.fn(async () => true),
}));

import { ProxyKeywordRoutingGuard } from "@/app/v1/_lib/proxy/keyword-routing-guard";
import { ProxySession } from "@/app/v1/_lib/proxy/session";
import { isKeywordModelRoutingEnabled } from "@/lib/config/system-settings-cache";
import { keywordRoutingEngine } from "@/lib/keyword-routing/engine";
import { logger } from "@/lib/logger";
import type { KeywordRoutingRule } from "@/repository/keyword-routing-rules";

function createContext(request: Request) {
  return {
    req: {
      method: request.method,
      url: request.url,
      raw: request,
      header(name?: string) {
        if (name) {
          return request.headers.get(name) ?? undefined;
        }
        return Object.fromEntries(request.headers.entries());
      },
    },
  } as any;
}

async function createJsonSession(body: Record<string, unknown>): Promise<ProxySession> {
  const request = new Request("https://proxy.example.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return ProxySession.fromContext(createContext(request));
}

function createRule(overrides: Partial<KeywordRoutingRule> = {}): KeywordRoutingRule {
  return {
    id: 7,
    keyword: "ultrathink",
    sourceModel: null,
    targetModel: "claude-opus-4-6",
    caseSensitive: false,
    priority: 0,
    description: null,
    isEnabled: true,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

const DEFAULT_BODY = {
  model: "claude-sonnet-4-5",
  messages: [{ role: "user", content: "please ultrathink about this" }],
};

describe("ProxyKeywordRoutingGuard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isKeywordModelRoutingEnabled).mockResolvedValue(true);
    vi.mocked(keywordRoutingEngine.isEmpty).mockReturnValue(false);
    vi.mocked(keywordRoutingEngine.match).mockReturnValue(null);
  });

  it("skips when the master toggle is off and does not consult the engine", async () => {
    vi.mocked(isKeywordModelRoutingEnabled).mockResolvedValue(false);
    const session = await createJsonSession(DEFAULT_BODY);

    const response = await ProxyKeywordRoutingGuard.ensure(session);

    expect(response).toBeNull();
    expect(session.request.model).toBe("claude-sonnet-4-5");
    expect(keywordRoutingEngine.match).not.toHaveBeenCalled();
  });

  it("skips when the rule cache is empty (toggle on)", async () => {
    vi.mocked(keywordRoutingEngine.isEmpty).mockReturnValue(true);
    const session = await createJsonSession(DEFAULT_BODY);

    const response = await ProxyKeywordRoutingGuard.ensure(session);

    expect(response).toBeNull();
    expect(session.request.model).toBe("claude-sonnet-4-5");
    expect(session.request.message.model).toBe("claude-sonnet-4-5");
    expect(keywordRoutingEngine.match).not.toHaveBeenCalled();
  });

  it("rewrites the model on a keyword match and records the audit", async () => {
    const rule = createRule();
    vi.mocked(keywordRoutingEngine.match).mockReturnValue({ rule, matchedIn: "user" });
    const session = await createJsonSession(DEFAULT_BODY);

    const response = await ProxyKeywordRoutingGuard.ensure(session);

    expect(response).toBeNull();

    // 引擎收到的是提取后的文本与原始模型
    expect(keywordRoutingEngine.match).toHaveBeenCalledWith(
      expect.objectContaining({
        systemTexts: [],
        lastUserTexts: ["please ultrathink about this"],
      }),
      "claude-sonnet-4-5"
    );

    // request.model 与 message.model 均被改写
    expect(session.request.model).toBe("claude-opus-4-6");
    expect(session.request.message.model).toBe("claude-opus-4-6");

    // buffer 重新生成并包含目标模型
    const decoded = JSON.parse(new TextDecoder().decode(session.request.buffer as ArrayBuffer));
    expect(decoded.model).toBe("claude-opus-4-6");
    expect(decoded.messages).toEqual(DEFAULT_BODY.messages);

    // 审计信息完整
    expect(session.getKeywordRoutingAudit()).toEqual({
      userRequestedModel: "claude-sonnet-4-5",
      routedModel: "claude-opus-4-6",
      ruleId: 7,
      keyword: "ultrathink",
      matchedIn: "user",
    });

    // 回归守卫：不得调用 setOriginalModel —— 改写后 getOriginalModel() 必须返回目标模型，
    // 否则供应商选择会使用改写前模型，且 ModelRedirector 会静默回退本次改写
    expect(session.getOriginalModel()).toBe("claude-opus-4-6");

    // note 记录改写
    expect(session.request.note).toContain(
      "[Keyword Routed: claude-sonnet-4-5 -> claude-opus-4-6, rule#7]"
    );
  });

  it("does not mutate anything when the matched target equals the requested model", async () => {
    const rule = createRule({ targetModel: "claude-sonnet-4-5" });
    vi.mocked(keywordRoutingEngine.match).mockReturnValue({ rule, matchedIn: "user" });
    const session = await createJsonSession(DEFAULT_BODY);
    const bufferBefore = session.request.buffer;

    const response = await ProxyKeywordRoutingGuard.ensure(session);

    expect(response).toBeNull();
    expect(session.request.model).toBe("claude-sonnet-4-5");
    expect(session.request.message.model).toBe("claude-sonnet-4-5");
    expect(session.request.buffer).toBe(bufferBefore);
    expect(session.getKeywordRoutingAudit()).toBeNull();
    expect(session.request.note ?? "").not.toContain("Keyword Routed");
  });

  it("leaves the request untouched when no rule matches", async () => {
    vi.mocked(keywordRoutingEngine.match).mockReturnValue(null);
    const session = await createJsonSession(DEFAULT_BODY);
    const bufferBefore = session.request.buffer;

    const response = await ProxyKeywordRoutingGuard.ensure(session);

    expect(response).toBeNull();
    expect(session.request.model).toBe("claude-sonnet-4-5");
    expect(session.request.buffer).toBe(bufferBefore);
    expect(session.getKeywordRoutingAudit()).toBeNull();
  });

  it.each([
    "gemini",
    "gemini-cli",
  ] as const)("skips %s requests without consulting the engine", async (format) => {
    const session = await createJsonSession(DEFAULT_BODY);
    session.setOriginalFormat(format);

    const response = await ProxyKeywordRoutingGuard.ensure(session);

    expect(response).toBeNull();
    expect(session.request.model).toBe("claude-sonnet-4-5");
    expect(keywordRoutingEngine.isEmpty).not.toHaveBeenCalled();
    expect(keywordRoutingEngine.match).not.toHaveBeenCalled();
  });

  it("skips OpenAI multipart image requests without consulting the engine", async () => {
    const formData = new FormData();
    formData.append("model", "gpt-image-1.5");
    formData.append("prompt", "ultrathink this image");
    formData.append(
      "image[]",
      new File([new Uint8Array([1, 2, 3])], "image.png", { type: "image/png" }),
      "image.png"
    );

    const request = new Request("https://proxy.example.com/v1/images/edits", {
      method: "POST",
      body: formData,
    });
    const session = await ProxySession.fromContext(createContext(request));
    expect(session.isOpenAIImageMultipartRequest()).toBe(true);

    const response = await ProxyKeywordRoutingGuard.ensure(session);

    expect(response).toBeNull();
    expect(session.request.model).toBe("gpt-image-1.5");
    expect(keywordRoutingEngine.match).not.toHaveBeenCalled();
  });

  it("fails open when the engine throws", async () => {
    vi.mocked(keywordRoutingEngine.match).mockImplementation(() => {
      throw new Error("boom");
    });
    const session = await createJsonSession(DEFAULT_BODY);

    const response = await ProxyKeywordRoutingGuard.ensure(session);

    expect(response).toBeNull();
    expect(session.request.model).toBe("claude-sonnet-4-5");
    expect(session.getKeywordRoutingAudit()).toBeNull();
    expect(logger.error).toHaveBeenCalled();
  });

  it("skips when the request has no model", async () => {
    const session = await createJsonSession({
      messages: [{ role: "user", content: "please ultrathink about this" }],
    });
    expect(session.request.model).toBeNull();

    const response = await ProxyKeywordRoutingGuard.ensure(session);

    expect(response).toBeNull();
    expect(session.request.model).toBeNull();
    expect(keywordRoutingEngine.match).not.toHaveBeenCalled();
  });
});

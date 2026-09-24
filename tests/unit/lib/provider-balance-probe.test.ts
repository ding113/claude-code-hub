import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchWithDispatcher = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/lib/proxy-agent", () => ({
  createProxyAgentForProvider: vi.fn(() => null),
  fetchWithDispatcher: (...args: unknown[]) => fetchWithDispatcher(...args),
}));
vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const { buildOpenAiUsageRange, probeProviderBalance, resolveSourceBaseUrl } = await import(
  "@/lib/provider-balance/probe"
);
const { PROVIDER_BALANCE_MAX_RESPONSE_BYTES } = await import("@/lib/provider-balance/endpoints");

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function provider(overrides: Partial<Parameters<typeof probeProviderBalance>[0]> = {}) {
  return {
    id: 1,
    url: "https://relay.example.com",
    key: "sk-test",
    proxyUrl: null,
    proxyFallbackToDirect: false,
    ...overrides,
  };
}

function requestedUrls(): string[] {
  return fetchWithDispatcher.mock.calls.map((call) => call[0] as string);
}

beforeEach(() => {
  fetchWithDispatcher.mockReset();
});

describe("buildOpenAiUsageRange", () => {
  it("区间从当年 1 月 1 日到当天", () => {
    expect(buildOpenAiUsageRange(new Date("2026-09-24T10:00:00.000Z"))).toEqual({
      start: "2026-01-01",
      end: "2026-09-24",
    });
  });
});

describe("probeProviderBalance 来源选择", () => {
  it("命中 New API 额度端点后不再尝试其他来源", async () => {
    fetchWithDispatcher.mockResolvedValueOnce(
      jsonResponse({
        data: { total_granted: 5_000_000, total_used: 0, total_available: 5_000_000 },
      })
    );

    const snapshot = await probeProviderBalance(provider());

    expect(snapshot.status).toBe("ok");
    expect(snapshot.source).toBe("new-api-token-usage");
    expect(snapshot.balance).toBe(10);
    expect(requestedUrls()).toEqual(["https://relay.example.com/api/usage/token/"]);
  });

  it("端点返回 404 时回落到下一个来源", async () => {
    fetchWithDispatcher
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockResolvedValueOnce(jsonResponse({ hard_limit_usd: 120 }))
      .mockResolvedValueOnce(jsonResponse({ total_usage: 4500 }));

    const snapshot = await probeProviderBalance(provider());

    expect(snapshot.source).toBe("openai-billing");
    expect(snapshot.balance).toBe(75);
    expect(snapshot.totalGranted).toBe(120);
    expect(requestedUrls()[1]).toBe("https://relay.example.com/v1/dashboard/billing/subscription");
    expect(requestedUrls()[2]).toContain("/v1/dashboard/billing/usage?start_date=");
  });

  it("返回非 JSON 内容时视为该来源不可用", async () => {
    fetchWithDispatcher
      .mockResolvedValueOnce(new Response("<html>login</html>", { status: 200 }))
      .mockResolvedValueOnce(new Response("<html>login</html>", { status: 200 }));

    const snapshot = await probeProviderBalance(provider());

    expect(snapshot.status).toBe("unsupported");
    expect(snapshot.errorCode).toBeNull();
  });

  it("响应体超过上限时视为该来源不可用", async () => {
    const oversized = "x".repeat(PROVIDER_BALANCE_MAX_RESPONSE_BYTES + 1024);
    fetchWithDispatcher
      .mockResolvedValueOnce(new Response(oversized, { status: 200 }))
      .mockResolvedValueOnce(new Response(oversized, { status: 200 }));

    const snapshot = await probeProviderBalance(provider());

    expect(snapshot.status).toBe("unsupported");
  });

  it("所有来源都只返回空数据时判定为不支持", async () => {
    fetchWithDispatcher
      .mockResolvedValueOnce(jsonResponse({ data: { object: "billing" } }))
      .mockResolvedValueOnce(jsonResponse({ object: "billing_subscription" }))
      .mockResolvedValueOnce(jsonResponse({}));

    const snapshot = await probeProviderBalance(provider());

    expect(snapshot.status).toBe("unsupported");
    expect(snapshot.source).toBeNull();
  });

  it("ChatGPT 账号查询后端用量端点", async () => {
    fetchWithDispatcher.mockResolvedValueOnce(
      jsonResponse({ credits: { has_credits: true, unlimited: false, balance: "12.34" } })
    );

    const snapshot = await probeProviderBalance(
      provider({ url: "https://chatgpt.com/backend-api/codex" })
    );

    expect(snapshot.source).toBe("chatgpt-credits");
    expect(snapshot.balance).toBe(12.34);
    expect(requestedUrls()).toEqual(["https://chatgpt.com/backend-api/wham/usage"]);
  });

  it("官方直连端点不发起任何请求", async () => {
    const snapshot = await probeProviderBalance(provider({ url: "https://api.anthropic.com" }));

    expect(snapshot.status).toBe("unsupported");
    expect(fetchWithDispatcher).not.toHaveBeenCalled();
  });
});

describe("probeProviderBalance 失败分类", () => {
  it("401 归类为密钥被拒绝", async () => {
    fetchWithDispatcher
      .mockResolvedValueOnce(new Response("nope", { status: 401 }))
      .mockResolvedValueOnce(new Response("nope", { status: 401 }));

    const snapshot = await probeProviderBalance(provider());

    expect(snapshot.status).toBe("error");
    expect(snapshot.errorCode).toBe("unauthorized");
  });

  it("429 归类为被限流", async () => {
    fetchWithDispatcher
      .mockResolvedValueOnce(new Response("slow down", { status: 429 }))
      .mockResolvedValueOnce(new Response("slow down", { status: 429 }));

    const snapshot = await probeProviderBalance(provider());
    expect(snapshot.errorCode).toBe("rate_limited");
  });

  it("超时归类为 timeout", async () => {
    const timeoutError = new Error("timed out");
    timeoutError.name = "TimeoutError";
    fetchWithDispatcher.mockRejectedValue(timeoutError);

    const snapshot = await probeProviderBalance(provider());
    expect(snapshot.errorCode).toBe("timeout");
  });

  it("网络异常归类为 network", async () => {
    fetchWithDispatcher.mockRejectedValue(new Error("ECONNREFUSED"));

    const snapshot = await probeProviderBalance(provider());
    expect(snapshot.errorCode).toBe("network");
  });

  it("先出现的失败原因优先保留", async () => {
    fetchWithDispatcher
      .mockResolvedValueOnce(new Response("nope", { status: 403 }))
      .mockResolvedValueOnce(new Response("boom", { status: 500 }));

    const snapshot = await probeProviderBalance(provider());
    expect(snapshot.errorCode).toBe("forbidden");
  });

  it("地址非法时直接判定为 invalid_url", async () => {
    const snapshot = await probeProviderBalance(provider({ url: "ftp://relay.example.com" }));

    expect(snapshot.status).toBe("error");
    expect(snapshot.errorCode).toBe("invalid_url");
    expect(fetchWithDispatcher).not.toHaveBeenCalled();
  });
});

describe("probeProviderBalance 请求构造", () => {
  it("使用供应商自身的密钥做 Bearer 认证", async () => {
    fetchWithDispatcher.mockResolvedValueOnce(
      jsonResponse({ data: { total_available: 500_000, total_used: 0, total_granted: 500_000 } })
    );

    await probeProviderBalance(provider({ key: "sk-secret" }));

    const init = fetchWithDispatcher.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-secret");
    expect((init.headers as Record<string, string>).Accept).toBe("application/json");
  });

  it("子路径挂载的中转网关保留自己的路径前缀", async () => {
    fetchWithDispatcher.mockResolvedValueOnce(
      jsonResponse({ data: { total_available: 0, total_used: 0, total_granted: 0 } })
    );

    await probeProviderBalance(provider({ url: "https://relay.example.com/api/" }));

    expect(requestedUrls()[0]).toBe("https://relay.example.com/api/api/usage/token/");
  });

  it("基地址以 /v1 结尾时不产生重复版本段", async () => {
    fetchWithDispatcher
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockResolvedValueOnce(jsonResponse({ hard_limit_usd: 120 }))
      .mockResolvedValueOnce(jsonResponse({ total_usage: 4500 }));

    await probeProviderBalance(provider({ url: "https://relay.example.com/v1" }));

    expect(requestedUrls()[1]).toBe("https://relay.example.com/v1/dashboard/billing/subscription");
    expect(requestedUrls()[2]).toContain("/v1/dashboard/billing/usage?start_date=");
  });

  it("官方钱包端点忽略基地址里的 /v1 与子路径", async () => {
    fetchWithDispatcher.mockResolvedValueOnce(
      jsonResponse({ balance_infos: [{ currency: "CNY", total_balance: "5.00" }] })
    );

    const snapshot = await probeProviderBalance(
      provider({ url: "https://api.deepseek.com/v1", key: "sk-deepseek" })
    );

    expect(snapshot.source).toBe("deepseek-balance");
    expect(snapshot.balance).toBe(5);
    expect(requestedUrls()[0]).toBe("https://api.deepseek.com/user/balance");
  });
});

describe("resolveSourceBaseUrl", () => {
  it("网关兼容端点只去掉末尾的 API 版本后缀", () => {
    const gateway = "https://relay.example.com";
    expect(resolveSourceBaseUrl(gateway, "new-api-token-usage")).toBe(gateway);
    expect(resolveSourceBaseUrl(`${gateway}/v1`, "openai-billing")).toBe(gateway);
    expect(resolveSourceBaseUrl(`${gateway}/v1beta`, "openai-billing")).toBe(gateway);
    expect(resolveSourceBaseUrl(`${gateway}/api`, "new-api-token-usage")).toBe(`${gateway}/api`);
    expect(resolveSourceBaseUrl(`${gateway}/sub/v1`, "openai-billing")).toBe(`${gateway}/sub`);
  });

  it("站点根路径下的钱包端点一律取 origin", () => {
    expect(resolveSourceBaseUrl("https://api.deepseek.com/v1", "deepseek-balance")).toBe(
      "https://api.deepseek.com"
    );
    expect(resolveSourceBaseUrl("https://api.moonshot.cn/v1", "kimi-balance")).toBe(
      "https://api.moonshot.cn"
    );
    expect(resolveSourceBaseUrl("https://chatgpt.com/backend-api/codex", "chatgpt-credits")).toBe(
      "https://chatgpt.com"
    );
  });
});

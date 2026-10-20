import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { probeProviderBalance } = await import("@/lib/provider-balance/probe");

// 本地 HTTP 服务按上游源码的路由、鉴权规则与状态码应答：
// - Sub2API：backend/internal/server/routes/gateway.go 与 middleware/api_key_auth.go，
//   未注册的路径由 gin 返回 404 "404 page not found"
// - New API：middleware/auth.go，状态码与消息取自真实实例的应答。
//   v1.0.0-rc.21（2026-07 之前）令牌无效时返回 HTTP 200 与 success:false，
//   缺少或不匹配 New-Api-User 时返回 401；v1.0.0-rc.40 只凭令牌认证，令牌无效时返回 401

interface RecordedRequest {
  path: string;
  headers: IncomingHttpHeaders;
}

interface Upstream {
  server: Server;
  baseUrl: string;
  requests: RecordedRequest[];
}

type Route = (
  path: string,
  headers: IncomingHttpHeaders
) => { status: number; body: unknown } | null;

async function startUpstream(route: Route): Promise<Upstream> {
  const requests: RecordedRequest[] = [];
  const server = createServer((req, res) => {
    const path = req.url ?? "/";
    requests.push({ path, headers: req.headers });
    const result = route(path, req.headers);
    if (!result) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("404 page not found");
      return;
    }
    res.writeHead(result.status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result.body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${port}`, requests };
}

function bearer(headers: IncomingHttpHeaders): string | null {
  const value = headers.authorization;
  return value?.startsWith("Bearer ") ? value.slice("Bearer ".length) : null;
}

const SUB2API_WALLET_KEY = "sk-sub2api-wallet";
const SUB2API_QUOTA_KEY = "sk-sub2api-quota";

const sub2ApiResponses: Record<string, unknown> = {
  [SUB2API_WALLET_KEY]: {
    mode: "unrestricted",
    isValid: true,
    planName: "钱包余额",
    remaining: 12.5,
    unit: "USD",
    balance: 12.5,
    usage: {
      today: { requests: 0, cost: 0, actual_cost: 0 },
      total: { requests: 4, cost: 1.2, actual_cost: 0.6 },
    },
  },
  [SUB2API_QUOTA_KEY]: {
    mode: "quota_limited",
    isValid: true,
    status: "active",
    quota: { limit: 20, used: 3.5, remaining: 16.5, unit: "USD" },
    remaining: 16.5,
    unit: "USD",
  },
};

const sub2ApiRoute: Route = (path, headers) => {
  const pathname = path.split("?")[0];
  if (pathname !== "/v1/usage" && pathname !== "/antigravity/v1/usage") return null;

  const key = bearer(headers) ?? (headers["x-api-key"] as string | undefined) ?? null;
  const body = key ? sub2ApiResponses[key] : undefined;
  if (!body) {
    return { status: 401, body: { code: "INVALID_API_KEY", message: "Invalid API key" } };
  }
  return { status: 200, body };
};

const NEW_API_USER_ID = 7;
const NEW_API_ACCESS_TOKEN = "pat-new-api-account";
const NEW_API_KEY = "sk-new-api-key";

const newApiSelf = {
  success: true,
  message: "",
  data: {
    id: NEW_API_USER_ID,
    username: "alice",
    group: "default",
    quota: 6_250_000,
    used_quota: 1_250_000,
    request_count: 12,
  },
};

const newApiTokenUsage = {
  code: true,
  message: "ok",
  data: {
    object: "token_usage",
    name: "relay",
    total_granted: 1_000_000,
    total_used: 250_000,
    total_available: 750_000,
    unlimited_quota: false,
    model_limits: {},
    model_limits_enabled: false,
    expires_at: 0,
  },
};

function newApiRoute(release: "legacy" | "current"): Route {
  return (path, headers) => {
    if (path === "/api/usage/token/") {
      return bearer(headers) === NEW_API_KEY
        ? { status: 200, body: newApiTokenUsage }
        : { status: 401, body: { success: false, message: "无效的令牌" } };
    }
    if (path !== "/api/user/self") return null;

    if (bearer(headers) !== NEW_API_ACCESS_TOKEN) {
      return release === "legacy"
        ? {
            status: 200,
            body: { success: false, message: "Unauthorized, invalid access token" },
          }
        : {
            status: 401,
            body: {
              success: false,
              code: "AUTH_UNAUTHORIZED",
              message: "Unauthorized, invalid access token",
            },
          };
    }

    if (release === "legacy" && !headers["new-api-user"]) {
      return {
        status: 401,
        body: { success: false, message: "Unauthorized, New-Api-User header not provided" },
      };
    }
    if (release === "legacy" && headers["new-api-user"] !== String(NEW_API_USER_ID)) {
      return {
        status: 401,
        body: {
          success: false,
          message: "Unauthorized, New-Api-User does not match logged in user",
        },
      };
    }

    return { status: 200, body: newApiSelf };
  };
}

function provider(url: string, overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    url,
    key: SUB2API_WALLET_KEY,
    proxyUrl: null,
    proxyFallbackToDirect: false,
    newApiAccessToken: null,
    newApiUserId: null,
    ...overrides,
  };
}

let sub2api: Upstream;
let legacyNewApi: Upstream;
let currentNewApi: Upstream;

beforeAll(async () => {
  sub2api = await startUpstream(sub2ApiRoute);
  legacyNewApi = await startUpstream(newApiRoute("legacy"));
  currentNewApi = await startUpstream(newApiRoute("current"));
});

afterAll(async () => {
  await Promise.all(
    [sub2api, legacyNewApi, currentNewApi].map(
      (upstream) => new Promise<void>((resolve) => upstream.server.close(() => resolve()))
    )
  );
});

beforeEach(() => {
  for (const upstream of [sub2api, legacyNewApi, currentNewApi]) {
    upstream.requests.length = 0;
  }
});

describe("Sub2API 余额识别", () => {
  it("New API 端点 404 后命中 /v1/usage，读取钱包余额", async () => {
    const snapshot = await probeProviderBalance(provider(sub2api.baseUrl));

    expect(snapshot).toMatchObject({
      status: "ok",
      source: "sub2api-usage",
      balance: 12.5,
      currency: "USD",
      totalUsed: 0.6,
      unlimited: false,
      errorCode: null,
    });
    expect(sub2api.requests.map((request) => request.path)).toEqual([
      "/api/usage/token/",
      "/v1/usage",
    ]);
    expect(sub2api.requests[1].headers.authorization).toBe(`Bearer ${SUB2API_WALLET_KEY}`);
  });

  it("供应商地址带 /v1 后缀时不拼出重复的版本段", async () => {
    const snapshot = await probeProviderBalance(provider(`${sub2api.baseUrl}/v1`));

    expect(snapshot.source).toBe("sub2api-usage");
    expect(sub2api.requests.map((request) => request.path)).toEqual([
      "/api/usage/token/",
      "/v1/usage",
    ]);
  });

  it("Antigravity 子路径保留路径前缀", async () => {
    const snapshot = await probeProviderBalance(provider(`${sub2api.baseUrl}/antigravity`));

    expect(snapshot.balance).toBe(12.5);
    expect(sub2api.requests.at(-1)?.path).toBe("/antigravity/v1/usage");
  });

  it("设置了总额度的密钥读取密钥额度", async () => {
    const snapshot = await probeProviderBalance(
      provider(sub2api.baseUrl, { key: SUB2API_QUOTA_KEY })
    );

    expect(snapshot).toMatchObject({
      status: "ok",
      source: "sub2api-usage",
      balance: 16.5,
      totalGranted: 20,
      totalUsed: 3.5,
    });
  });

  it("密钥无效时报告密钥被拒绝，并继续尝试其余来源", async () => {
    const snapshot = await probeProviderBalance(provider(sub2api.baseUrl, { key: "sk-unknown" }));

    expect(snapshot.status).toBe("error");
    expect(snapshot.errorCode).toBe("unauthorized");
    expect(sub2api.requests.map((request) => request.path)).toEqual([
      "/api/usage/token/",
      "/v1/usage",
      "/v1/dashboard/billing/subscription",
    ]);
  });
});

describe("New API 系统访问令牌查询账户余额", () => {
  it("旧版本：携带用户 ID 时读取账户余额，不再查询密钥额度", async () => {
    const snapshot = await probeProviderBalance(
      provider(legacyNewApi.baseUrl, {
        key: NEW_API_KEY,
        newApiAccessToken: NEW_API_ACCESS_TOKEN,
        newApiUserId: NEW_API_USER_ID,
      })
    );

    expect(snapshot).toMatchObject({
      status: "ok",
      source: "new-api-account",
      balance: 12.5,
      totalUsed: 2.5,
      totalGranted: 15,
      currency: "USD",
    });
    expect(legacyNewApi.requests.map((request) => request.path)).toEqual(["/api/user/self"]);

    const headers = legacyNewApi.requests[0].headers;
    expect(headers.authorization).toBe(`Bearer ${NEW_API_ACCESS_TOKEN}`);
    expect(headers["new-api-user"]).toBe("7");
    expect(headers["veloera-user"]).toBe("7");
  });

  it("旧版本：缺少用户 ID 时上游返回 401，判定为令牌被拒绝", async () => {
    const snapshot = await probeProviderBalance(
      provider(legacyNewApi.baseUrl, {
        key: NEW_API_KEY,
        newApiAccessToken: NEW_API_ACCESS_TOKEN,
      })
    );

    expect(snapshot.status).toBe("error");
    expect(snapshot.errorCode).toBe("access_token_rejected");
    expect(legacyNewApi.requests.map((request) => request.path)).toEqual(["/api/user/self"]);
  });

  it("旧版本：用户 ID 与令牌不匹配时判定为令牌被拒绝", async () => {
    const snapshot = await probeProviderBalance(
      provider(legacyNewApi.baseUrl, {
        key: NEW_API_KEY,
        newApiAccessToken: NEW_API_ACCESS_TOKEN,
        newApiUserId: 999,
      })
    );

    expect(snapshot.errorCode).toBe("access_token_rejected");
  });

  it("旧版本：令牌无效时上游返回 200 与 success:false，同样判定为令牌被拒绝", async () => {
    const snapshot = await probeProviderBalance(
      provider(legacyNewApi.baseUrl, {
        key: NEW_API_KEY,
        newApiAccessToken: "pat-wrong",
        newApiUserId: NEW_API_USER_ID,
      })
    );

    expect(snapshot.status).toBe("error");
    expect(snapshot.errorCode).toBe("access_token_rejected");
  });

  it("新版本：只凭令牌即可读取账户余额，未配置用户 ID 时不发送用户头", async () => {
    const snapshot = await probeProviderBalance(
      provider(currentNewApi.baseUrl, {
        key: NEW_API_KEY,
        newApiAccessToken: NEW_API_ACCESS_TOKEN,
      })
    );

    expect(snapshot.source).toBe("new-api-account");
    expect(snapshot.balance).toBe(12.5);
    expect(currentNewApi.requests[0].headers["new-api-user"]).toBeUndefined();
  });

  it("新版本：令牌无效时上游返回 401，判定为令牌被拒绝", async () => {
    const snapshot = await probeProviderBalance(
      provider(currentNewApi.baseUrl, {
        key: NEW_API_KEY,
        newApiAccessToken: "pat-wrong",
      })
    );

    expect(snapshot.status).toBe("error");
    expect(snapshot.errorCode).toBe("access_token_rejected");
  });

  it("供应商地址带 /v1 后缀时仍然请求站点的 /api/user/self", async () => {
    await probeProviderBalance(
      provider(`${currentNewApi.baseUrl}/v1`, {
        key: NEW_API_KEY,
        newApiAccessToken: NEW_API_ACCESS_TOKEN,
      })
    );

    expect(currentNewApi.requests.map((request) => request.path)).toEqual(["/api/user/self"]);
  });

  it("令牌两端的空白在发送前去掉", async () => {
    const snapshot = await probeProviderBalance(
      provider(currentNewApi.baseUrl, {
        key: NEW_API_KEY,
        newApiAccessToken: `  ${NEW_API_ACCESS_TOKEN}  `,
      })
    );

    expect(snapshot.status).toBe("ok");
  });

  it("未配置令牌的 New API 供应商仍然读取密钥额度", async () => {
    const snapshot = await probeProviderBalance(
      provider(currentNewApi.baseUrl, { key: NEW_API_KEY })
    );

    expect(snapshot).toMatchObject({
      status: "ok",
      source: "new-api-token-usage",
      balance: 1.5,
      totalGranted: 2,
    });
  });

  it("站点不是 New API 家族时判定为不支持", async () => {
    const snapshot = await probeProviderBalance(
      provider(sub2api.baseUrl, {
        newApiAccessToken: NEW_API_ACCESS_TOKEN,
      })
    );

    expect(snapshot.status).toBe("unsupported");
    expect(sub2api.requests.map((request) => request.path)).toEqual(["/api/user/self"]);
  });
});

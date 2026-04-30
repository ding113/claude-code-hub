/**
 * /api/v1 管理 API：路由边界单元测试
 *
 * 验证：
 * - /api/v1/health 走管理 API 路由并返回固定健康响应；
 * - /api/v1/openapi.json 文档与代理 / 遗留管理路径互不相交；
 * - 任何未注册业务路径（含 /api/v1/messages 这种代理保留前缀）一律返回
 *   application/problem+json 的 404；
 * - 所有响应（包括 404）都附带 X-API-Version: 1.0.0。
 *
 * 使用进程内调用模式（参考 tests/test-utils.ts callActionsRoute），
 * 不启动 Next 服务器、不走真实端口。
 */

import { describe, expect, it } from "vitest";

import { DELETE, GET, OPTIONS, PATCH, POST, PUT } from "@/app/api/v1/[...route]/route";

type V1Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS";

type V1RouteCallOptions = {
  method: V1Method;
  /** 形如 "/api/v1/health"，必须以 "/" 开头 */
  pathname: string;
  headers?: Record<string, string>;
  body?: unknown;
};

type V1RouteCallResult = {
  response: Response;
  json?: unknown;
  text?: string;
};

const HANDLERS: Record<V1Method, (req: Request) => Response | Promise<Response>> = {
  GET,
  POST,
  PUT,
  PATCH,
  DELETE,
  OPTIONS,
};

async function callV1Route(options: V1RouteCallOptions): Promise<V1RouteCallResult> {
  const url = new URL(options.pathname, "http://localhost");

  const headers: Record<string, string> = {
    ...(options.headers ?? {}),
  };

  const hasBody = options.body !== undefined && options.method !== "GET";
  if (hasBody) {
    headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
  }

  const request = new Request(url, {
    method: options.method,
    headers,
    body: hasBody ? JSON.stringify(options.body) : undefined,
  });

  const handler = HANDLERS[options.method];
  const response = await handler(request);

  const contentType = response.headers.get("content-type") ?? "";
  if (
    contentType.includes("application/json") ||
    contentType.includes("application/problem+json")
  ) {
    const json = await response.json();
    return { response, json };
  }

  const text = await response.text();
  return { response, text };
}

describe("/api/v1 management route boundary", () => {
  it("GET /api/v1/health returns the health body", async () => {
    const { response, json } = await callV1Route({
      method: "GET",
      pathname: "/api/v1/health",
    });

    expect(response.status).toBe(200);
    expect(json).toEqual({
      ok: true,
      service: "management-api",
      version: "1.0.0",
    });
  });

  it("GET /api/v1/openapi.json exposes only management metadata", async () => {
    const { response, json } = await callV1Route({
      method: "GET",
      pathname: "/api/v1/openapi.json",
    });

    expect(response.status).toBe(200);

    const contentType = response.headers.get("content-type") ?? "";
    expect(contentType).toContain("application/json");

    const document = json as {
      info: { title: string; version: string };
      servers: Array<{ url: string }>;
      paths?: Record<string, unknown>;
    };

    expect(document.info.title).toBe("Claude Code Hub Management API");
    expect(document.info.version).toBe("1.0.0");
    expect(Array.isArray(document.servers)).toBe(true);
    expect(document.servers[0]?.url).toBe("/api/v1");

    const paths = document.paths ?? {};
    const pathKeys = Object.keys(paths);

    // 文档不能包含遗留 /api/actions/* 任何路径
    expect(pathKeys.some((p) => p.startsWith("/api/actions/"))).toBe(false);

    // 文档不能声明代理路径（哪怕是空对象）
    expect(pathKeys.some((p) => p === "/v1/messages" || p.startsWith("/v1/messages"))).toBe(false);
    expect(pathKeys.some((p) => p === "/api/v1/messages")).toBe(false);
  });

  it("POST /api/v1/messages is not claimed by management and returns problem+json 404", async () => {
    const { response, json } = await callV1Route({
      method: "POST",
      pathname: "/api/v1/messages",
      body: { model: "claude-3-5-sonnet", messages: [] },
    });

    expect(response.status).toBe(404);

    const contentType = response.headers.get("content-type") ?? "";
    expect(contentType).toContain("application/problem+json");

    const problem = json as Record<string, unknown>;
    expect(problem.status).toBe(404);
    expect(problem.errorCode).toBe("NOT_FOUND");
    expect(typeof problem.title).toBe("string");
    expect(typeof problem.type).toBe("string");
    expect(typeof problem.detail).toBe("string");
    expect(typeof problem.instance).toBe("string");
  });

  it("X-API-Version header is set to 1.0.0 on every response (including 404)", async () => {
    const success = await callV1Route({
      method: "GET",
      pathname: "/api/v1/health",
    });
    expect(success.response.headers.get("X-API-Version")).toBe("1.0.0");

    const docs = await callV1Route({
      method: "GET",
      pathname: "/api/v1/openapi.json",
    });
    expect(docs.response.headers.get("X-API-Version")).toBe("1.0.0");

    const notFound = await callV1Route({
      method: "GET",
      pathname: "/api/v1/this-path-does-not-exist",
    });
    expect(notFound.response.status).toBe(404);
    expect(notFound.response.headers.get("X-API-Version")).toBe("1.0.0");
  });
});

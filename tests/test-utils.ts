/**
 * Actions API（/api/actions/[...route]）的“进程内”调用工具
 *
 * 目标：
 * - 不启动 next dev / next start
 * - 不走真实网络端口（更稳定、更快、适合 CI）
 * - 仍然以 HTTP 语义（Request/Response）进行断言
 *
 * 适用范围：
 * - OpenAPI 文档（/api/actions/openapi.json）
 * - 文档 UI（/api/actions/docs /api/actions/scalar）
 * - 健康检查（/api/actions/health）
 * - 以及需要校验“缺少 Cookie 直接 401”的端点
 */

import { GET, POST } from "@/app/api/actions/[...route]/route";

export type ActionsRouteCallOptions = {
  method: "GET" | "POST";
  /**
   * 形如：/api/actions/openapi.json 或 /api/actions/users/getUsers
   */
  pathname: string;
  /**
   * 写入 Cookie: auth-token=...
   */
  authToken?: string;
  headers?: Record<string, string>;
  /**
   * POST 请求体，会自动 JSON.stringify
   */
  body?: unknown;
};

export async function callActionsRoute(options: ActionsRouteCallOptions): Promise<{
  response: Response;
  /**
   * 当响应为 application/json 时解析后的对象，否则为 undefined
   */
  json?: unknown;
  /**
   * 当响应不是 JSON 时返回文本，否则为 undefined
   */
  text?: string;
}> {
  const url = new URL(options.pathname, "http://localhost");

  const headers: Record<string, string> = {
    ...(options.headers ?? {}),
  };

  if (options.authToken) {
    const existing = headers.Cookie ? `${headers.Cookie}; ` : "";
    headers.Cookie = `${existing}auth-token=${options.authToken}`;
  }

  if (options.method === "POST") {
    headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
  }

  const request = new Request(url, {
    method: options.method,
    headers,
    body: options.method === "POST" ? JSON.stringify(options.body ?? {}) : undefined,
  });

  const response = options.method === "GET" ? await GET(request) : await POST(request);

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return { response, json: await response.json() };
  }

  return { response, text: await response.text() };
}

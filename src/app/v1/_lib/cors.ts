import type { Context, Hono } from "hono";

const DEFAULT_ALLOW_HEADERS =
  "authorization,x-api-key,x-goog-api-key,content-type,anthropic-version,x-session-id,x-client-version";

const DEFAULT_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": DEFAULT_ALLOW_HEADERS,
  "Access-Control-Expose-Headers":
    "x-request-id,x-ratelimit-limit,x-ratelimit-remaining,x-ratelimit-reset,retry-after",
  "Access-Control-Max-Age": "86400", // 24 hours
};

/**
 * 动态构建 CORS 响应头
 */
function buildCorsHeaders(options: { origin?: string | null; requestHeaders?: string | null }) {
  const headers = new Headers(DEFAULT_CORS_HEADERS);

  if (options.origin) {
    headers.set("Access-Control-Allow-Origin", options.origin);
    headers.append("Vary", "Origin");
  }

  if (options.requestHeaders) {
    headers.set("Access-Control-Allow-Headers", options.requestHeaders);
    headers.append("Vary", "Access-Control-Request-Headers");
  }

  if (headers.get("Access-Control-Allow-Origin") !== "*") {
    headers.set("Access-Control-Allow-Credentials", "true");
  }

  return headers;
}

/**
 * 为响应添加 CORS 头
 */
export function applyCors(
  res: Response,
  ctx: { origin?: string | null; requestHeaders?: string | null }
): Response {
  const corsHeaders = buildCorsHeaders(ctx);
  const headers = res.headers;

  if (!headers || typeof headers.set !== "function") {
    const safeStatus =
      typeof res.status === "number" && res.status >= 200 && res.status <= 599 ? res.status : 200;
    return new Response(res.body, { status: safeStatus, headers: corsHeaders });
  }

  corsHeaders.forEach((value, key) => {
    if (key === "vary") {
      headers.append(key, value);
    } else {
      headers.set(key, value);
    }
  });
  return res;
}

/**
 * 构建预检请求响应
 */
export function buildPreflightResponse(options: {
  origin?: string | null;
  requestHeaders?: string | null;
}): Response {
  return new Response(null, { status: 204, headers: buildCorsHeaders(options) });
}

export const CORS_HEADERS = DEFAULT_CORS_HEADERS;

/**
 * 注册 CORS 中间件
 */
export function registerCors(app: Hono): void {
  app.use("*", async (c, next) => {
    await next();
    return applyCors(c.res, {
      origin: c.req.header("origin"),
      requestHeaders: c.req.header("access-control-request-headers"),
    });
  });

  app.options("*", (c: Context) =>
    buildPreflightResponse({
      origin: c.req.header("origin"),
      requestHeaders: c.req.header("access-control-request-headers"),
    })
  );
}

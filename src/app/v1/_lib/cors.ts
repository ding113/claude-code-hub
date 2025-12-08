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
 * 合并 Vary 头并去重（保留原始大小写）
 */
function mergeVaryHeader(existing: string | null, newValue: string): string {
  const seen = new Set<string>();
  const result: string[] = [];

  // 先处理已有的值
  if (existing) {
    for (const v of existing.split(",")) {
      const trimmed = v.trim();
      const lower = trimmed.toLowerCase();
      if (!seen.has(lower)) {
        seen.add(lower);
        result.push(trimmed);
      }
    }
  }

  // 再处理新值
  for (const v of newValue.split(",")) {
    const trimmed = v.trim();
    const lower = trimmed.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      result.push(trimmed);
    }
  }

  return result.join(", ");
}

/**
 * 为响应添加 CORS 头
 *
 * 注意：始终创建新的 Response 对象，避免修改 immutable headers
 * 在 Next.js App Router 中，Response.headers 可能是只读的
 */
export function applyCors(
  res: Response,
  ctx: { origin?: string | null; requestHeaders?: string | null }
): Response {
  const corsHeaders = buildCorsHeaders(ctx);

  // 直接复用原始状态码（100-599 都是合法的 HTTP 状态码）
  const status = typeof res.status === "number" ? res.status : 200;
  const statusText = res.statusText ?? "";

  // 克隆 headers：优先使用原生构造函数，失败时手动复制
  let mergedHeaders: Headers;
  try {
    mergedHeaders = new Headers(res.headers);
  } catch {
    // 回退到手动复制
    mergedHeaders = new Headers();
    if (res.headers && typeof res.headers.forEach === "function") {
      try {
        res.headers.forEach((value, key) => {
          mergedHeaders.set(key, value);
        });
      } catch {
        // 忽略遍历错误，继续添加 CORS headers
      }
    }
  }

  // 添加 CORS headers（覆盖或追加）
  corsHeaders.forEach((value, key) => {
    if (key === "vary") {
      // Vary 头需要追加并去重
      const merged = mergeVaryHeader(mergedHeaders.get("vary"), value);
      mergedHeaders.set("vary", merged);
    } else {
      mergedHeaders.set(key, value);
    }
  });

  // 处理 body：检测是否已被消费
  // 如果 body 已被消费，无法安全地创建新 Response
  // 此时 headers 也很可能是 immutable 的，直接返回原响应
  // 注意：这种情况表明调用顺序有问题，应在上游确保 CORS 在 body 写入前应用
  if (res.bodyUsed) {
    console.warn(
      "[CORS] Response body already consumed, cannot apply CORS headers safely. " +
        "Please ensure CORS is applied before reading the response body."
    );
    return res;
  }

  // 始终返回新的 Response 对象
  return new Response(res.body, {
    status,
    statusText,
    headers: mergedHeaders,
  });
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

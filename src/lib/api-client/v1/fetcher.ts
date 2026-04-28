/**
 * /api/v1 客户端基础 fetch 函数。
 *
 * 职责：
 * - 始终带上 `credentials: "include"`，配合 cookie 鉴权；
 * - 对突变动词（POST/PUT/PATCH/DELETE）在 cookie 鉴权（未显式传入 Authorization / X-Api-Key）
 *   时自动获取 CSRF Token，写入 `X-CCH-CSRF` 请求头；
 *   - CSRF token 模块级缓存；
 *   - 收到 403 + errorCode === "csrf_invalid" 时清空缓存并重试一次；
 *   - 当前版本若 `/auth/csrf` 端点尚未实现（404）则优雅降级，跳过 CSRF；
 * - 对 `application/problem+json` 错误响应抛出 `ApiError`；
 * - 透传 `AbortSignal`：abort 时不吞错；
 * - 幂等动词（GET/HEAD）在网络失败（TypeError "Failed to fetch"）时重试一次。
 *
 * 注意：fetcher 不负责日志、不打印任何 token / cookie，避免泄漏敏感信息。
 */

import { ApiError, type ProblemJson } from "@/lib/api-client/v1/errors";

/** 默认基础路径，可通过 setApiBaseUrl 覆盖 */
let API_BASE_URL = "/api/v1";

/** 模块级 CSRF token 缓存 */
let csrfTokenCache: string | null = null;

/** 突变动词集合（需要 CSRF 保护） */
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** 幂等动词集合（在网络错误时可重试） */
const IDEMPOTENT_METHODS = new Set(["GET", "HEAD"]);

/** fetchApi 扩展选项 */
export interface FetchApiInit extends RequestInit {
  /** 显式跳过 CSRF 注入（如登录端点） */
  skipCsrf?: boolean;
}

/** 设置基础路径（默认 /api/v1） */
export function setApiBaseUrl(url: string): void {
  API_BASE_URL = url;
}

/** 获取当前基础路径，便于测试与扩展模块复用 */
export function getApiBaseUrl(): string {
  return API_BASE_URL;
}

/** 测试辅助：清空模块级 CSRF 缓存 */
export function __resetCsrfTokenCacheForTests(): void {
  csrfTokenCache = null;
}

/** 判断 init 中是否已显式提供 Authorization / X-Api-Key（即非纯 cookie 鉴权） */
function hasExplicitAuthHeader(init?: FetchApiInit): boolean {
  if (!init?.headers) return false;
  const headers = new Headers(init.headers);
  return headers.has("authorization") || headers.has("x-api-key");
}

/** 解析最终请求方法（默认 GET） */
function resolveMethod(init?: FetchApiInit): string {
  return (init?.method ?? "GET").toUpperCase();
}

/** 是否是 fetch 因网络问题抛出的 TypeError（"Failed to fetch"） */
function isNetworkTypeError(err: unknown): err is TypeError {
  return err instanceof TypeError && /failed to fetch/i.test(err.message);
}

/** 是否是 AbortSignal 触发的中止错误 */
function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = (err as { name?: string }).name;
  return name === "AbortError";
}

/** 在请求前确保 CSRF token 已就绪；返回 token 或 null（端点未实现 / 失败时降级） */
async function ensureCsrfToken(): Promise<string | null> {
  if (csrfTokenCache) return csrfTokenCache;
  try {
    const response = await fetch(`${API_BASE_URL}/auth/csrf`, {
      method: "GET",
      credentials: "include",
    });
    if (response.status === 404) {
      // CSRF 端点尚未实现（任务 4 完成后会上线）
      return null;
    }
    if (!response.ok) {
      return null;
    }
    const body = (await response.json().catch(() => null)) as {
      token?: string;
      csrfToken?: string;
    } | null;
    const token = body?.token ?? body?.csrfToken ?? null;
    if (token) {
      csrfTokenCache = token;
    }
    return csrfTokenCache;
  } catch {
    return null;
  }
}

/** 解析非 2xx 响应为 ApiError；非 problem+json 时构造一个最小化 ApiError */
async function buildErrorFromResponse(response: Response): Promise<ApiError> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/problem+json")) {
    try {
      const body = (await response.json()) as ProblemJson;
      return ApiError.fromProblemJson(response, body);
    } catch {
      // 解析失败时降级到下方分支
    }
  }
  return new ApiError({
    status: response.status,
    errorCode: "UNKNOWN_ERROR",
    title: response.statusText || "API Error",
  });
}

/** 拼接完整 URL：以 / 开头视为绝对路径，否则加 BASE_URL 前缀 */
function resolveUrl(input: string): string {
  if (/^https?:\/\//i.test(input)) return input;
  if (input.startsWith("/")) return input;
  return `${API_BASE_URL}/${input}`;
}

interface PerformFetchOptions {
  /** 该请求是否需要 CSRF（已在外层判定） */
  needsCsrf: boolean;
}

/**
 * 执行单次 fetch 调用。CSRF token 与重试在外层处理。
 */
async function performFetch(
  url: string,
  init: FetchApiInit | undefined,
  csrfToken: string | null,
  _opts: PerformFetchOptions
): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (csrfToken && !headers.has("x-cch-csrf")) {
    headers.set("X-CCH-CSRF", csrfToken);
  }
  return fetch(url, {
    ...init,
    headers,
    credentials: "include",
  });
}

/**
 * /api/v1 客户端 fetch 入口。
 *
 * @param input  目标路径（绝对路径或相对 BASE_URL 的 path，例如 "/api/v1/users" 或 "users"）
 * @param init   标准 RequestInit + skipCsrf 选项
 * @throws       ApiError（problem+json 错误响应）；AbortError（请求被取消）
 */
export async function fetchApi(input: string, init?: FetchApiInit): Promise<Response> {
  const url = resolveUrl(input);
  const method = resolveMethod(init);
  const isMutating = MUTATING_METHODS.has(method);
  const isCookieAuth = !hasExplicitAuthHeader(init);
  const skipCsrf = init?.skipCsrf === true;
  const needsCsrf = isMutating && isCookieAuth && !skipCsrf;

  let csrfToken: string | null = null;
  if (needsCsrf) {
    csrfToken = await ensureCsrfToken();
  }

  let response: Response;
  try {
    response = await performFetch(url, init, csrfToken, { needsCsrf });
  } catch (err) {
    if (isAbortError(err)) throw err;
    if (isNetworkTypeError(err) && IDEMPOTENT_METHODS.has(method)) {
      response = await performFetch(url, init, csrfToken, { needsCsrf });
    } else {
      throw err;
    }
  }

  // 处理 CSRF 失效：清空缓存重试一次
  if (response.status === 403 && needsCsrf) {
    const cloned = response.clone();
    const contentType = cloned.headers.get("content-type") ?? "";
    if (contentType.includes("application/problem+json")) {
      const body = (await cloned.json().catch(() => null)) as ProblemJson | null;
      if (body?.errorCode === "csrf_invalid") {
        csrfTokenCache = null;
        const retryToken = await ensureCsrfToken();
        response = await performFetch(url, init, retryToken, { needsCsrf });
      }
    }
  }

  if (!response.ok) {
    throw await buildErrorFromResponse(response);
  }
  return response;
}

import "server-only";

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { logger } from "@/lib/logger";

const execFileAsync = promisify(execFile);
const CURL_IMPERSONATE_BIN = "curl_chrome116";

/** 是否启用 curl-impersonate (Chrome TLS 指纹模拟)。 */
export const CURL_IMPERSONATE_ENABLED = !!process.env.ENABLE_CURL_IMPERSONATE;

/**
 * 需要 TLS 指纹模拟的上游域名(逗号分隔,支持子域)。
 * 只有被 Cloudflare 按指纹风控的站点需要;白名单外保持原生 fetch,
 * 避免影响其他 provider 的行为。
 */
const CURL_IMPERSONATE_HOSTS = (process.env.CURL_IMPERSONATE_HOSTS ?? "")
  .split(",")
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

/** URL 的 hostname 是否命中指纹模拟白名单。 */
export function shouldImpersonateProviderUrl(url: string): boolean {
  if (!CURL_IMPERSONATE_ENABLED || CURL_IMPERSONATE_HOSTS.length === 0) {
    return false;
  }
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return CURL_IMPERSONATE_HOSTS.some(
      (h) => hostname === h || hostname.endsWith(`.${h}`)
    );
  } catch {
    return false;
  }
}

/**
 * 通过 curl_chrome116 子进程发请求,模拟 Chrome 的 TLS/HTTP2 指纹(JA3/JA4)。
 * 部分上游(sub2api 站点)的 Cloudflare WAF 会按 TLS 指纹拦截非浏览器客户端,
 * 有效 token + Node undici = 403 HTML,Chrome 指纹 = 200。
 * 返回最小 fetch 兼容的 Response;二进制缺失/调用失败时回退原生 fetch。
 */
export async function impersonateFetch(
  url: string,
  init: { headers?: Record<string, string>; method?: string; body?: string } = {}
): Promise<Response> {
  const args = [
    "-sS",
    "--max-time",
    "30",
    "-w",
    "\n%{http_code}\n%{content_type}",
  ];
  const method = init.method ?? "GET";
  if (method !== "GET") args.push("-X", method);
  for (const [k, v] of Object.entries(init.headers ?? {})) {
    if (k.toLowerCase() === "user-agent") continue; // wrapper 自带 Chrome UA
    args.push("-H", `${k}: ${v}`);
  }
  if (init.body != null) args.push("--data-raw", init.body);
  args.push(url);

  try {
    const { stdout } = await execFileAsync(CURL_IMPERSONATE_BIN, args, {
      timeout: 35_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    const lines = stdout.split("\n");
    const statusLine = lines[lines.length - 2]?.trim() ?? "0";
    const contentType = lines[lines.length - 1]?.trim() ?? "";
    const body = lines.slice(0, -2).join("\n");
    const status = Number.parseInt(statusLine, 10) || 0;
    return new Response(body, {
      status,
      headers: { "content-type": contentType },
    });
  } catch (error) {
    logger.warn("[curl-impersonate] failed, falling back to fetch", {
      url,
      error: error instanceof Error ? error.message : String(error),
    });
    return fetch(url, {
      method,
      headers: init.headers,
      body: init.body,
      signal: AbortSignal.timeout(30_000),
    });
  }
}

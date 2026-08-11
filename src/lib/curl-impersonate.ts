import "server-only";

import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { Readable } from "node:stream";
import type { PassThrough } from "node:stream";
import { promisify } from "node:util";
import { logger } from "@/lib/logger";

const execFileAsync = promisify(execFile);

/**
 * 本地伪装代理地址(curl_cffi 常驻转发网关,连接池复用 TLS)。
 * 由 deploy/impersonate-proxy/impersonate_proxy.py 提供。
 */
const IMPERSONATE_PROXY_HOST = process.env.IMPERSONATE_PROXY_HOST ?? "127.0.0.1";
const IMPERSONATE_PROXY_PORT = process.env.IMPERSONATE_PROXY_PORT ?? "18686";
const IMPERSONATE_PROXY_URL = `http://${IMPERSONATE_PROXY_HOST}:${IMPERSONATE_PROXY_PORT}`;

/** 本地代理是否可用(health 探测,短超时)。 */
async function isImpersonateProxyAlive(): Promise<boolean> {
  try {
    const res = await fetch(`${IMPERSONATE_PROXY_URL}/health`, {
      signal: AbortSignal.timeout(1_500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * 通过本地伪装代理转发请求。返回 ImpersonateRequestResult 形状。
 * 仅在代理不可达或转发失败时 reject,由调用方回退 spawn curl。
 */
async function proxyForward(
  url: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string | Uint8Array | null;
    signal?: AbortSignal;
    bodyTimeoutMs?: number;
    proxyUrl?: string | null;
  }
): Promise<ImpersonateRequestResult> {
  const method = init.method ?? "GET";
  const bodyTimeoutMs = init.bodyTimeoutMs ?? 120_000;

  const proxyHeaders: Record<string, string> = {
    "X-CCH-Method": method,
    "X-CCH-Target": url,
    "X-CCH-Timeout": String(bodyTimeoutMs),
  };
  for (const [k, v] of Object.entries(init.headers ?? {})) {
    if (k.toLowerCase() === "user-agent") continue; // 代理端 curl_cffi 自带 Chrome UA
    proxyHeaders[k] = v;
  }

  let body: BodyInit | null = null;
  if (init.body != null) {
    body =
      typeof init.body === "string"
        ? init.body
        : (new Uint8Array(init.body.buffer, init.body.byteOffset, init.body.byteLength) as unknown as BodyInit);
  }

  const res = await fetch(`${IMPERSONATE_PROXY_URL}/impersonate`, {
    method: "POST",
    headers: proxyHeaders,
    body,
    signal: init.signal,
    // 本地代理是常驻进程,连接本身走 keep-alive;请求超时由 X-CCH-Timeout 与调用方共同管理
  });

  const headers: Record<string, string | string[]> = {};
  res.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  const bodyStream = Readable.fromWeb(
    res.body as unknown as import("node:stream/web").ReadableStream
  );
  return {
    statusCode: res.status,
    statusText: res.statusText,
    headers,
    body: bodyStream,
  };
}

/**
 * 直接调用 curl-impersonate-chrome 二进制,跳过 bash wrapper(curl_chrome116)。
 * wrapper 每请求多一次 bash 进程启动(~1.3ms);TLS/HTTP2 指纹参数内联如下,
 * 与 deploy/curl-impersonate/curl_chrome116 wrapper 保持一致。
 * 仅在本地伪装代理不可用时作为 fallback。
 */
const CURL_IMPERSONATE_BIN = "curl-impersonate-chrome";

/** wrapper 固定指纹参数(与 curl_chrome116 脚本等价)。 */
const FINGERPRINT_ARGS = [
  "--ciphers",
  "TLS_AES_128_GCM_SHA256,TLS_AES_256_GCM_SHA384,TLS_CHACHA20_POLY1305_SHA256,ECDHE-ECDSA-AES128-GCM-SHA256,ECDHE-RSA-AES128-GCM-SHA256,ECDHE-ECDSA-AES256-GCM-SHA384,ECDHE-RSA-AES256-GCM-SHA384,ECDHE-ECDSA-CHACHA20-POLY1305,ECDHE-RSA-CHACHA20-POLY1305,ECDHE-RSA-AES128-SHA,ECDHE-RSA-AES256-SHA,AES128-GCM-SHA256,AES256-GCM-SHA384,AES128-SHA,AES256-SHA",
  "-H",
  'sec-ch-ua: "Chromium";v="116", "Not)A;Brand";v="24", "Google Chrome";v="116"',
  "-H",
  "sec-ch-ua-mobile: ?0",
  "-H",
  'sec-ch-ua-platform: "Windows"',
  "-H",
  "Upgrade-Insecure-Requests: 1",
  "-H",
  "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36",
  "-H",
  "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
  "-H",
  "Sec-Fetch-Site: none",
  "-H",
  "Sec-Fetch-Mode: navigate",
  "-H",
  "Sec-Fetch-User: ?1",
  "-H",
  "Sec-Fetch-Dest: document",
  "-H",
  "Accept-Encoding: gzip, deflate, br",
  "-H",
  "Accept-Language: en-US,en;q=0.9",
  "--http2",
  "--http2-no-server-push",
  "--compressed",
  "--tlsv1.2",
  "--alps",
  "--tls-permute-extensions",
  "--cert-compression",
  "brotli",
];

/** 是否启用 curl-impersonate (Chrome TLS 指纹模拟)。 */
export const CURL_IMPERSONATE_ENABLED = !!process.env.ENABLE_CURL_IMPERSONATE;

/**
 * 需要 TLS 指纹模拟的上游域名(逗号分隔,支持子域)。
 * 为空 = 全站开启伪装(不限定域名)。
 */
const CURL_IMPERSONATE_HOSTS = (process.env.CURL_IMPERSONATE_HOSTS ?? "")
  .split(",")
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

/** 是否全站开启伪装(未配置白名单域名)。 */
export const CURL_IMPERSONATE_ALL = CURL_IMPERSONATE_ENABLED && CURL_IMPERSONATE_HOSTS.length === 0;

/**
 * URL 是否命中指纹模拟范围:
 * - 全站模式(未配置 CURL_IMPERSONATE_HOSTS)→ 所有 http(s) URL 都伪装;
 * - 白名单模式 → 仅命中域名的 URL 伪装。
 */
export function shouldImpersonateProviderUrl(url: string): boolean {
  if (!CURL_IMPERSONATE_ENABLED) return false;
  if (CURL_IMPERSONATE_ALL) {
    try {
      const proto = new URL(url).protocol;
      return proto === "http:" || proto === "https:";
    } catch {
      return false;
    }
  }
  if (CURL_IMPERSONATE_HOSTS.length === 0) return false;
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
 * 优先走本地伪装代理(连接池复用);代理不可用或失败时回退 spawn curl,
 * 二进制也缺失时回退原生 fetch。
 */
export async function impersonateFetch(
  url: string,
  init: {
    headers?: Record<string, string>;
    method?: string;
    body?: string;
    /** true 时跳过本地伪装代理,直接 spawn curl(健康测试等短请求用,避免占代理 worker 池) */
    bypassProxy?: boolean;
  } = {}
): Promise<Response> {
  // 实测 curl_cffi 常驻代理(chrome116 指纹)对部分 Cloudflare 上游被识别为
  // 伪浏览器,转发慢 10~18 倍(nikoapi 0.9s -> 17s)。统一直接 spawn
  // curl-impersonate-chrome(完整 Chrome 指纹);代理代码保留可回退。
  // bypassProxy 参数保留兼容调用方,不再生效。
  void init.bypassProxy;

  // 2) spawn curl fallback
  const args = [
    ...FINGERPRINT_ARGS,
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

/** curl 子进程请求结果,形状对齐 undici.request 的响应(forwarder 复用)。 */
export interface ImpersonateRequestResult {
  statusCode: number;
  statusText: string;
  headers: Record<string, string | string[]>;
  /** 响应体 Node 流(含错误处理器),与 undiciRes.body 同形状。 */
  body: Readable;
}

/**
 * 伪装请求的流式版本。优先走本地伪装代理(连接池复用 TLS,省每次握手);
 * 代理不可达/转发失败时回退 curl_chrome116 子进程。
 * 返回 ImpersonateRequestResult(与 undici.request 响应同形状),
 * forwarder 可直接复用现有 gzip 处理 / node 流转 web 流 / 错误处理逻辑。
 */
export async function impersonateRequest(
  url: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string | Uint8Array | null;
    signal?: AbortSignal;
    bodyTimeoutMs?: number;
    proxyUrl?: string | null;
  } = {}
): Promise<ImpersonateRequestResult> {
  // 实测 curl_cffi 常驻代理(chrome116 指纹)对部分 Cloudflare 上游被识别为
  // 伪浏览器,转发慢 10~18 倍(nikoapi 0.9s -> 17s,瑞科 3s -> 15s)。
  // 直接 spawn curl-impersonate-chrome(完整 Chrome 指纹),仅损失 ~1.5ms
  // 进程启动与跨请求连接复用;代理代码保留可回退,但不再用于真实请求。
  return impersonateRequestSpawn(url, init);
}

/**
 * 流式版本(内部实现):用 curl_chrome116 子进程发请求,`-D -` 把响应头 dump
 * 到 stdout 头部,解析出状态码/headers 后,剩余字节作为 body 流返回。
 * 子进程失败(非 HTTP 响应)时 reject,由调用方决定 fallback。
 */
function impersonateRequestSpawn(
  url: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string | Uint8Array | null;
    signal?: AbortSignal;
    bodyTimeoutMs?: number;
    proxyUrl?: string | null;
  } = {}
): Promise<ImpersonateRequestResult> {
  return new Promise((resolve, reject) => {
    const method = init.method ?? "GET";
    const bodyTimeoutMs = init.bodyTimeoutMs ?? 120_000;
    const connectTimeoutMs = Math.min(bodyTimeoutMs, 30_000);

    const args = [
      ...FINGERPRINT_ARGS,
      "-sS",
      "-N", // 无缓冲输出:SSE 等流式响应边到边转
      "-D",
      "-", // 响应头 dump 到 stdout(位于 body 之前)
      "-o",
      "-", // body 写 stdout
      "-X",
      method,
      "--connect-timeout",
      String(Math.max(1, Math.floor(connectTimeoutMs / 1000))),
      "--max-time",
      String(Math.max(5, Math.floor(bodyTimeoutMs / 1000))),
    ];

    for (const [k, v] of Object.entries(init.headers ?? {})) {
      if (k.toLowerCase() === "user-agent") continue; // wrapper 自带 Chrome UA
      args.push("-H", `${k}: ${v}`);
    }
    if (init.proxyUrl) args.push("-x", init.proxyUrl);
    let bodyRaw: string | null = null;
    if (init.body != null) {
      bodyRaw =
        typeof init.body === "string"
          ? init.body
          : Buffer.from(init.body.buffer, init.body.byteOffset, init.body.byteLength).toString("utf8");
      // body 走 stdin(@-) 而非 argv:argv 单参数上限 128KB(MAX_ARG_STRLEN),
      // 大请求体(如 300KB+ 的 /v1/responses)会 spawn E2BIG
      args.push("--data-binary", "@-");
    }
    args.push(url);

    let child;
    try {
      child = spawn(CURL_IMPERSONATE_BIN, args, {
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    if (bodyRaw != null) {
      child.stdin.on("error", () => {
        // 管道写失败(子进程已退出)忽略,exit 事件会兜底
      });
      child.stdin.end(bodyRaw);
    }

    const abortHandler = () => {
      if (!child.killed) child.kill("SIGKILL");
    };
    if (init.signal) {
      if (init.signal.aborted) {
        abortHandler();
      } else {
        init.signal.addEventListener("abort", abortHandler, { once: true });
      }
    }

    // 解析 stdout:先累积到 \r\n\r\n(header 结束),然后切出 body 流
    let headerBuffer = Buffer.alloc(0);
    let bodyStream: import("node:stream").PassThrough | null = null;
    let settled = false;

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      if (init.signal) init.signal.removeEventListener("abort", abortHandler);
      if (!child.killed) child.kill("SIGKILL");
      reject(err);
    };

    const succeed = (result: ImpersonateRequestResult) => {
      if (settled) return;
      settled = true;
      if (init.signal) init.signal.removeEventListener("abort", abortHandler);
      resolve(result);
    };

    const parseHeaderBlock = (block: string): ImpersonateRequestResult => {
      const lines = block.split(/\r?\n/);
      let statusCode = 0;
      let statusText = "";
      const headers: Record<string, string | string[]> = {};
      for (const line of lines) {
        if (line.startsWith("HTTP/")) {
          const m = line.match(/^HTTP\/\S+\s+(\d{3})(?:\s+(.*))?$/);
          if (m) {
            statusCode = Number.parseInt(m[1], 10);
            statusText = m[2]?.trim() ?? "";
          }
          continue;
        }
        const idx = line.indexOf(":");
        if (idx <= 0) continue;
        const key = line.slice(0, idx).trim().toLowerCase();
        const value = line.slice(idx + 1).trim();
        const existing = headers[key];
        if (existing === undefined) {
          headers[key] = value;
        } else if (Array.isArray(existing)) {
          existing.push(value);
        } else {
          headers[key] = [existing, value];
        }
      }
      if (!bodyStream) {
        throw new Error("[curl-impersonate] body stream not ready");
      }
      return { statusCode, statusText, headers, body: bodyStream };
    };

    child.stdout.on("data", (chunk: Buffer) => {
      if (bodyStream) {
        bodyStream.push(chunk);
        return;
      }
      headerBuffer = Buffer.concat([headerBuffer, chunk]);
      const idx = headerBuffer.indexOf(Buffer.from("\r\n\r\n"));
      if (idx === -1) {
        if (headerBuffer.length > 64 * 1024) {
          fail(new Error(`[curl-impersonate] oversized header block for ${url}`));
        }
        return;
      }
      const headerBlock = headerBuffer.subarray(0, idx).toString("utf8");
      const bodyStart = idx + 4;
      const rest = headerBuffer.subarray(bodyStart);
      const passthrough = new (require("node:stream").PassThrough)() as import("node:stream").PassThrough;
      bodyStream = passthrough;
      if (rest.length > 0) passthrough.push(rest);
      try {
        succeed(parseHeaderBlock(headerBlock));
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    });

    child.stdout.on("error", (err) => {
      // 流错误(如过早关闭):若已 resolve 则交给 body 的错误处理器
      if (!settled) fail(err instanceof Error ? err : new Error(String(err)));
    });

    child.stderr.on("data", () => {
      // 忽略 stderr;错误码由 exit 事件处理
    });

    child.on("error", (err) => {
      fail(err instanceof Error ? err : new Error(String(err)));
    });

    child.on("exit", (code, signal) => {
      // 正常 exit:若从未发出 body(如 HEAD/204)且 header 已解析,补一个空流
      if (!settled && bodyStream === null) {
        const passthrough = new (require("node:stream").PassThrough)() as import("node:stream").PassThrough;
        bodyStream = passthrough;
        if (headerBuffer.length > 0) {
          const idx = headerBuffer.indexOf(Buffer.from("\r\n\r\n"));
          if (idx !== -1) {
            try {
              succeed(parseHeaderBlock(headerBuffer.subarray(0, idx).toString("utf8")));
              passthrough.end();
              return;
            } catch (error) {
              fail(error instanceof Error ? error : new Error(String(error)));
              return;
            }
          }
        }
        fail(
          new Error(
            `[curl-impersonate] exited ${code ?? "null"} signal=${signal ?? "null"} before headers for ${url}`
          )
        );
        return;
      }
      if (!settled) {
        fail(
          new Error(
            `[curl-impersonate] exited ${code ?? "null"} signal=${signal ?? "null"} before headers for ${url}`
          )
        );
      }
      // 已 resolve:正常结束 body 流
      if (bodyStream) bodyStream.end();
    });
  });
}

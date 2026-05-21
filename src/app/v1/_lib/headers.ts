import { logger } from "@/lib/logger";

/**
 * Header 处理器配置
 */
export interface HeaderProcessorConfig {
  /** 需要删除的 header 黑名单 */
  blacklist?: string[];
  /** 需要设置/替换的 headers */
  overrides?: Record<string, string>;
  /** 是否保留原始 authorization（默认 false） */
  preserveAuthorization?: boolean;
  /** 是否保留客户端 IP 相关头（默认 false，开启后不再删除 x-forwarded-for/x-real-ip 等） */
  preserveClientIpHeaders?: boolean;
}

export function looksLikeAnthropicProxyUrl(providerUrl?: string | null): boolean {
  if (!providerUrl) {
    return false;
  }

  try {
    const hostname = new URL(providerUrl).hostname.toLowerCase();
    if (
      hostname === "anthropic.com" ||
      hostname.endsWith(".anthropic.com") ||
      hostname === "claude.ai" ||
      hostname.endsWith(".claude.ai")
    ) {
      return false;
    }

    // 只匹配常见 relay/proxy 标识，避免把普通业务域名误识别成代理层。
    return /(?:^|[.-])(proxy|relay|gateway|router|worker|openrouter|api2d|oaipro)(?:[.-]|$)/i.test(
      hostname
    );
  } catch {
    return false;
  }
}

// Claude Platform on AWS gateway: `https://aws-external-anthropic.{region}.api.aws`.
// 该网关使用 SigV4(Authorization)或 API Key(x-api-key)二选一鉴权;同时携带两者
// 会被服务端拒绝(`request must not include both 'authorization' and 'x-api-key' headers`)。
// Bearer 形式不被支持,所以代理只能走 x-api-key 路径。
function safeUrlHost(providerUrl?: string | null): string | undefined {
  if (!providerUrl) return undefined;
  try {
    return new URL(providerUrl).host;
  } catch {
    return undefined;
  }
}

export function looksLikeAwsExternalAnthropicUrl(providerUrl?: string | null): boolean {
  if (!providerUrl) {
    return false;
  }

  try {
    const hostname = new URL(providerUrl).hostname.toLowerCase();
    // 区域段限定为 AWS 实际命名（`<area>-<direction>-<digit>`，如 `us-east-1`/`us-gov-west-1`），
    // 避免 `aws-external-anthropic.fake.api.aws` 之类伪造主机伪装成网关。
    return /^aws-external-anthropic\.[a-z]+(?:-[a-z]+)+-\d+\.api\.aws$/.test(hostname);
  } catch {
    return false;
  }
}

export function resolveAnthropicAuthHeaders(
  apiKey: string,
  providerUrl?: string | null,
  options?: { forceBearerOnly?: boolean }
): Record<string, string> {
  // AWS External Anthropic 拒绝 Authorization+x-api-key 共存,且不接受 Bearer。
  // 上游硬约束优先级最高,即使调用方要求 forceBearerOnly 也按 x-api-key 单发。
  if (looksLikeAwsExternalAnthropicUrl(providerUrl)) {
    if (options?.forceBearerOnly) {
      // 只记录 host：userinfo / query / fragment 都可能携带签名 token 或 API key，
      // 直接落整段 URL（甚至仅做 userinfo 脱敏）都会留出泄露面。
      logger.warn(
        "[anthropic-auth] forceBearerOnly overridden for AWS External Anthropic gateway; sending x-api-key only",
        { providerHost: safeUrlHost(providerUrl) }
      );
    }
    return {
      "x-api-key": apiKey,
    };
  }

  if (options?.forceBearerOnly || looksLikeAnthropicProxyUrl(providerUrl)) {
    return {
      Authorization: `Bearer ${apiKey}`,
    };
  }

  return {
    Authorization: `Bearer ${apiKey}`,
    "x-api-key": apiKey,
  };
}

/**
 * 代理请求 Header 处理器
 */
export class HeaderProcessor {
  private blacklist: Set<string>;
  private overrides: Map<string, string>;

  constructor(config: HeaderProcessorConfig = {}) {
    // 初始化黑名单（默认包含代理相关的 headers）
    // 目的：保护客户端隐私，避免真实 IP 和来源信息泄露给上游供应商
    const clientIpHeaders = [
      // 标准代理转发头
      "x-forwarded-for", // 客户端真实 IP 链
      // 真实 IP 相关
      "x-real-ip", // Nginx 常用的真实 IP 头
      "x-client-ip", // 部分代理使用
      "x-originating-ip", // Microsoft 相关服务
      "x-remote-ip", // 部分代理使用
      "x-remote-addr", // 部分代理使用
    ];

    const defaultBlacklist = [
      ...clientIpHeaders,
      "x-forwarded-host", // 原始请求 Host
      "x-forwarded-port", // 原始请求端口
      "x-forwarded-proto", // 原始请求协议 (http/https)
      "forwarded", // RFC 7239 标准转发头

      // CDN/云服务商特定头
      "cf-connecting-ip", // Cloudflare 客户端 IP
      "cf-ipcountry", // Cloudflare 客户端国家
      "cf-ray", // Cloudflare 请求追踪 ID
      "cf-visitor", // Cloudflare 访问者信息
      "true-client-ip", // Cloudflare Enterprise / Akamai
      "x-cluster-client-ip", // 部分负载均衡器
      "fastly-client-ip", // Fastly CDN
      "x-azure-clientip", // Azure
      "x-azure-fdid", // Azure Front Door ID
      "x-azure-ref", // Azure 请求追踪
      "akamai-origin-hop", // Akamai
      "x-akamai-config-log-detail", // Akamai 配置日志

      // 请求追踪和关联头
      "x-request-id", // 请求追踪 ID
      "x-correlation-id", // 关联 ID
      "x-trace-id", // 追踪 ID
      "x-amzn-trace-id", // AWS X-Ray 追踪
      "x-b3-traceid", // Zipkin 追踪
      "x-b3-spanid", // Zipkin span
      "x-b3-parentspanid", // Zipkin parent span
      "x-b3-sampled", // Zipkin 采样标记
      "traceparent", // W3C Trace Context
      "tracestate", // W3C Trace Context 状态
    ];

    const clientIpHeaderSet = new Set(clientIpHeaders);
    const filteredBlacklist = config.preserveClientIpHeaders
      ? defaultBlacklist.filter((h) => !clientIpHeaderSet.has(h))
      : defaultBlacklist;

    // 如果不保留 authorization，添加到黑名单
    if (!config.preserveAuthorization) {
      filteredBlacklist.push("authorization");
    }

    this.blacklist = new Set(
      [...filteredBlacklist, ...(config.blacklist || [])].map((h) => h.toLowerCase())
    );

    // 初始化覆盖规则
    this.overrides = new Map(
      Object.entries(config.overrides || {}).map(([k, v]) => [k.toLowerCase(), v])
    );
  }

  /**
   * 处理 Headers 对象
   */
  process(headers: Headers): Headers {
    const processed = new Headers();

    // 第一步：根据黑名单过滤，默认全部透传
    headers.forEach((value, key) => {
      const lowerKey = key.toLowerCase();

      // 检查黑名单
      if (this.blacklist.has(lowerKey)) {
        return; // 跳过黑名单 header
      }

      // 保留这个 header
      processed.set(key, value);
    });

    // 第二步：应用覆盖规则
    this.overrides.forEach((value, key) => {
      processed.set(key, value);
    });

    return processed;
  }

  /**
   * 从 baseUrl 提取 host
   */
  static extractHost(baseUrl: string): string {
    try {
      const url = new URL(baseUrl);
      return url.host;
    } catch (error) {
      logger.error("提取 host 失败:", error);
      const match = baseUrl.match(/^https?:\/\/([^/]+)/);
      return match ? match[1] : "localhost";
    }
  }

  /**
   * 创建预配置的代理处理器
   */
  static createForProxy(config?: HeaderProcessorConfig): HeaderProcessor {
    // 默认的代理配置：删除常见的转发相关 headers
    return new HeaderProcessor({
      preserveAuthorization: false,
      ...config,
    });
  }
}

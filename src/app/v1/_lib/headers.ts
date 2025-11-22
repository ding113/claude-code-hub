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
    const defaultBlacklist = [
      // 标准代理转发头
      "x-forwarded-for", // 客户端真实 IP 链
      "x-forwarded-host", // 原始请求 Host
      "x-forwarded-port", // 原始请求端口
      "x-forwarded-proto", // 原始请求协议 (http/https)
      "forwarded", // RFC 7239 标准转发头

      // 真实 IP 相关
      "x-real-ip", // Nginx 常用的真实 IP 头
      "x-client-ip", // 部分代理使用
      "x-originating-ip", // Microsoft 相关服务
      "x-remote-ip", // 部分代理使用
      "x-remote-addr", // 部分代理使用

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

    // 如果不保留 authorization，添加到黑名单
    if (!config.preserveAuthorization) {
      defaultBlacklist.push("authorization");
    }

    this.blacklist = new Set(
      [...defaultBlacklist, ...(config.blacklist || [])].map((h) => h.toLowerCase())
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
      const match = baseUrl.match(/^https?:\/\/([^\/]+)/);
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

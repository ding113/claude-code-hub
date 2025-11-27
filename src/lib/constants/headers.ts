/**
 * IP 转发相关的 HTTP Headers 常量
 * 用于控制是否将客户端真实 IP 转发给上游供应商
 */

/**
 * IP 转发相关的 Headers 列表
 * 包含标准代理转发头、真实 IP 头、CDN 特定头等
 */
export const IP_FORWARDING_HEADERS = [
  // 标准代理转发头
  "x-forwarded-for", // 客户端真实 IP 链
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
] as const;

/**
 * 始终需要删除的 Headers（与 IP 无关）
 * 包括请求追踪、协议信息等
 */
export const ALWAYS_BLOCKED_HEADERS = [
  // 标准代理转发头（非 IP 部分）
  "x-forwarded-host", // 原始请求 Host
  "x-forwarded-port", // 原始请求端口
  "x-forwarded-proto", // 原始请求协议 (http/https)

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
] as const;

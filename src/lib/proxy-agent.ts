import { socksDispatcher } from "fetch-socks";
import { Agent, type Dispatcher, ProxyAgent, setGlobalDispatcher } from "undici";
import { getGlobalAgentPool as getPool } from "@/lib/proxy-agent/agent-pool";
import type { Provider } from "@/types/provider";
import { getEnvConfig } from "./config/env.schema";
import { logger } from "./logger";

/**
 * undici 全局超时配置
 *
 * 背景：undici (Node.js 内置 fetch) 有默认的 300 秒超时 (headersTimeout + bodyTimeout)
 * 问题：即使业务层通过 AbortController 设置更长的超时，undici 的 300 秒会先触发
 * 解决：显式配置 undici 全局超时（默认 600 秒，可通过环境变量调整），匹配 LLM 服务的最大响应时间
 *
 * @see https://github.com/nodejs/undici/issues/1373
 * @see https://github.com/nodejs/node/issues/46706
 */
const {
  FETCH_CONNECT_TIMEOUT: connectTimeout,
  FETCH_HEADERS_TIMEOUT: headersTimeout,
  FETCH_BODY_TIMEOUT: bodyTimeout,
} = getEnvConfig();

/**
 * 设置 undici 全局 Agent，覆盖默认的 300 秒超时
 * 此配置对所有 fetch() 调用生效（无论是否使用代理）
 */
setGlobalDispatcher(
  new Agent({
    connectTimeout,
    headersTimeout,
    bodyTimeout,
  })
);

logger.info("undici global dispatcher configured", {
  connectTimeout,
  headersTimeout,
  bodyTimeout,
  note: "覆盖 undici 默认 300s 超时，匹配 LLM 最大响应时间",
});

/**
 * 代理配置结果
 */
export interface ProxyConfig {
  agent: ProxyAgent | Dispatcher;
  fallbackToDirect: boolean;
  proxyUrl: string;
  http2Enabled: boolean; // HTTP/2 是否启用（SOCKS 代理不支持 HTTP/2）
}

/**
 * 最小的供应商代理配置接口（用于类型安全）
 * 仅包含创建代理 Agent 所需的必要字段
 */
export interface ProviderProxyConfig {
  id: number;
  name?: string;
  proxyUrl: string | null;
  proxyFallbackToDirect: boolean;
}

/**
 * 为供应商创建代理 Agent（如果配置了代理）
 *
 * 支持协议：
 * - http:// - HTTP 代理
 * - https:// - HTTPS 代理
 * - socks5:// - SOCKS5 代理
 * - socks4:// - SOCKS4 代理
 *
 * HTTP/2 支持：
 * - HTTP/HTTPS 代理支持 HTTP/2（通过 undici 的 allowH2 选项）
 * - SOCKS 代理不支持 HTTP/2（undici 限制）
 *
 * @param provider 供应商配置（Provider 或 ProviderProxyConfig）
 * @param targetUrl 目标请求 URL
 * @param enableHttp2 是否启用 HTTP/2（默认 false）
 * @returns 代理配置对象，如果未配置代理则返回 null
 */
export function createProxyAgentForProvider(
  provider: Provider | ProviderProxyConfig,
  targetUrl: string,
  enableHttp2 = false
): ProxyConfig | null {
  // 未配置代理
  if (!provider.proxyUrl) {
    return null;
  }

  const proxyUrl = provider.proxyUrl.trim();
  if (!proxyUrl) {
    return null;
  }

  try {
    // 解析代理 URL（验证格式）
    const parsedProxy = new URL(proxyUrl);

    // 根据协议选择 Agent
    let agent: ProxyAgent | Dispatcher;
    let actualHttp2Enabled = false; // 实际是否启用 HTTP/2

    if (parsedProxy.protocol === "socks5:" || parsedProxy.protocol === "socks4:") {
      // SOCKS 代理通过 fetch-socks（undici 兼容）
      // 使用 socksDispatcher 创建 undici 兼容的 Dispatcher
      agent = socksDispatcher(
        {
          type: parsedProxy.protocol === "socks5:" ? 5 : 4,
          host: parsedProxy.hostname,
          port: parseInt(parsedProxy.port, 10) || 1080,
          userId: parsedProxy.username || undefined,
          password: parsedProxy.password || undefined,
        },
        {
          connect: {
            timeout: connectTimeout,
          },
        }
      );
      actualHttp2Enabled = false; // SOCKS 不支持 HTTP/2

      // 警告：SOCKS 代理不支持 HTTP/2
      if (enableHttp2) {
        logger.warn("SOCKS proxy does not support HTTP/2, falling back to HTTP/1.1", {
          providerId: provider.id,
          providerName: provider.name ?? "unknown",
          protocol: parsedProxy.protocol,
        });
      }

      logger.debug("SOCKS dispatcher created via fetch-socks", {
        providerId: provider.id,
        providerName: provider.name ?? "unknown",
        protocol: parsedProxy.protocol,
        proxyHost: parsedProxy.hostname,
        proxyPort: parsedProxy.port,
        targetUrl: new URL(targetUrl).origin,
        http2Enabled: false,
      });
    } else if (parsedProxy.protocol === "http:" || parsedProxy.protocol === "https:") {
      // HTTP/HTTPS 代理（使用 undici）
      // 支持 HTTP/2：通过 allowH2 选项启用 ALPN 协商
      // ⭐ 配置超时，覆盖 undici 默认值，匹配 LLM 最大响应时间（默认 600 秒，可通过环境变量调整）
      agent = new ProxyAgent({
        uri: proxyUrl,
        allowH2: enableHttp2,
        connectTimeout,
        headersTimeout, // 等待响应头的超时
        bodyTimeout, // 等待响应体的超时
      });
      actualHttp2Enabled = enableHttp2;
      logger.debug("HTTP/HTTPS ProxyAgent created", {
        providerId: provider.id,
        providerName: provider.name ?? "unknown",
        protocol: parsedProxy.protocol,
        proxyHost: parsedProxy.hostname,
        proxyPort: parsedProxy.port,
        targetUrl: new URL(targetUrl).origin,
        http2Enabled: enableHttp2,
        connectTimeout,
        headersTimeout,
        bodyTimeout,
      });
    } else {
      throw new Error(
        `Unsupported proxy protocol: ${parsedProxy.protocol}. Supported protocols: http://, https://, socks5://, socks4://`
      );
    }

    return {
      agent,
      fallbackToDirect: provider.proxyFallbackToDirect ?? false,
      proxyUrl: maskProxyUrl(proxyUrl),
      http2Enabled: actualHttp2Enabled,
    };
  } catch (error) {
    logger.error("Failed to create ProxyAgent", {
      providerId: provider.id,
      providerName: provider.name ?? "unknown",
      proxyUrl: maskProxyUrl(proxyUrl),
      error: error instanceof Error ? error.message : String(error),
    });

    // 代理配置错误，直接抛出异常（不降级）
    throw new Error(
      `Invalid proxy configuration: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * 脱敏代理 URL（隐藏密码）
 * 示例：http://user:pass@proxy.com:8080 -> http://user:***@proxy.com:8080
 *
 * @param proxyUrl 原始代理 URL
 * @returns 脱敏后的代理 URL
 */
export function maskProxyUrl(proxyUrl: string): string {
  try {
    const url = new URL(proxyUrl);
    if (url.password) {
      url.password = "***";
    }
    return url.toString();
  } catch {
    // 如果 URL 解析失败，使用正则替换
    return proxyUrl.replace(/:([^:@]+)@/, ":***@");
  }
}

/**
 * 验证代理 URL 格式是否合法
 *
 * @param proxyUrl 代理 URL
 * @returns 是否合法
 */
export function isValidProxyUrl(proxyUrl: string): boolean {
  if (!proxyUrl || !proxyUrl.trim()) {
    return false;
  }

  try {
    const url = new URL(proxyUrl.trim());

    // 检查协议
    const supportedProtocols = ["http:", "https:", "socks5:", "socks4:"];
    if (!supportedProtocols.includes(url.protocol)) {
      return false;
    }

    // 必须有 hostname
    if (!url.hostname) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

// Re-export from agent-pool module
export {
  type AgentPool,
  type AgentPoolConfig,
  type AgentPoolStats,
  generateAgentCacheKey,
  getGlobalAgentPool,
  resetGlobalAgentPool,
} from "./proxy-agent/agent-pool";

/**
 * Extended ProxyConfig with cache key for health management
 */
export interface ProxyConfigWithCacheKey extends ProxyConfig {
  /** Cache key for marking agent as unhealthy on SSL errors */
  cacheKey: string;
}

/**
 * Get proxy agent for provider using the global Agent Pool
 *
 * This is the recommended way to get a proxy agent as it:
 * 1. Reuses agents across requests to the same endpoint
 * 2. Isolates connections between different endpoints
 * 3. Supports health management (mark unhealthy on SSL errors)
 *
 * @param provider Provider configuration
 * @param targetUrl Target request URL
 * @param enableHttp2 Whether to enable HTTP/2 (default: false)
 * @returns ProxyConfig with cacheKey, or null if no proxy configured
 */
export async function getProxyAgentForProvider(
  provider: Provider | ProviderProxyConfig,
  targetUrl: string,
  enableHttp2 = false
): Promise<ProxyConfigWithCacheKey | null> {
  // No proxy configured
  if (!provider.proxyUrl) {
    return null;
  }

  const proxyUrl = provider.proxyUrl.trim();
  if (!proxyUrl) {
    return null;
  }

  const pool = getPool();

  const { agent, cacheKey } = await pool.getAgent({
    endpointUrl: targetUrl,
    proxyUrl,
    enableHttp2,
  });

  // Determine actual HTTP/2 status (SOCKS doesn't support HTTP/2)
  const parsedProxy = new URL(proxyUrl);
  const isSocks = parsedProxy.protocol === "socks5:" || parsedProxy.protocol === "socks4:";
  const actualHttp2Enabled = isSocks ? false : enableHttp2;

  return {
    agent,
    fallbackToDirect: provider.proxyFallbackToDirect ?? false,
    proxyUrl: maskProxyUrl(proxyUrl),
    http2Enabled: actualHttp2Enabled,
    cacheKey,
  };
}

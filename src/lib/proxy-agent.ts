import { ProxyAgent } from "undici";
import { SocksProxyAgent } from "socks-proxy-agent";
import type { Provider } from "@/types/provider";
import { logger } from "./logger";

/**
 * 代理配置结果
 */
export interface ProxyConfig {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  agent: ProxyAgent | SocksProxyAgent | any; // any to support non-undici agents
  fallbackToDirect: boolean;
  proxyUrl: string;
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
 * @param provider 供应商配置
 * @param targetUrl 目标请求 URL
 * @returns 代理配置对象，如果未配置代理则返回 null
 */
export function createProxyAgentForProvider(
  provider: Provider,
  targetUrl: string
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
    let agent: ProxyAgent | SocksProxyAgent;

    if (parsedProxy.protocol === "socks5:" || parsedProxy.protocol === "socks4:") {
      // SOCKS 代理
      agent = new SocksProxyAgent(proxyUrl);
      logger.debug("SOCKS ProxyAgent created", {
        providerId: provider.id,
        providerName: provider.name,
        protocol: parsedProxy.protocol,
        proxyHost: parsedProxy.hostname,
        proxyPort: parsedProxy.port,
        targetUrl: new URL(targetUrl).origin,
      });
    } else if (parsedProxy.protocol === "http:" || parsedProxy.protocol === "https:") {
      // HTTP/HTTPS 代理（使用 undici）
      agent = new ProxyAgent(proxyUrl);
      logger.debug("HTTP/HTTPS ProxyAgent created", {
        providerId: provider.id,
        providerName: provider.name,
        protocol: parsedProxy.protocol,
        proxyHost: parsedProxy.hostname,
        proxyPort: parsedProxy.port,
        targetUrl: new URL(targetUrl).origin,
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
    };
  } catch (error) {
    logger.error("Failed to create ProxyAgent", {
      providerId: provider.id,
      providerName: provider.name,
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

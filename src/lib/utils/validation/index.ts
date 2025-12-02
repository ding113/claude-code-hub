export {
  clampIntInRange,
  clampTpm,
  clampWeight,
  formatTpmDisplay,
  validateNumericField,
} from "./provider";

import { logger } from "@/lib/logger";

/**
 * 验证URL格式
 */
export function isValidUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url);
    return Boolean(parsedUrl);
  } catch {
    return false;
  }
}

/**
 * 掩码显示密钥 - 统一显示6位掩码
 */
export function maskKey(key: string): string {
  if (!key || key.length <= 8) {
    return "••••••";
  }
  const head = 4;
  const tail = 4;
  return `${key.slice(0, head)}••••••${key.slice(-tail)}`;
}

/**
 * 从URL中提取基础域名
 * @param url - 完整的URL
 * @returns 基础域名（包含协议和主机名，不含路径）
 * @example
 * extractBaseUrl("https://api.minimaxi.com/anthropic/v1/messages") // "https://api.minimaxi.com"
 * extractBaseUrl("http://localhost:3000/api") // "http://localhost:3000"
 */
export function extractBaseUrl(url: string): string {
  try {
    const parsedUrl = new URL(url);
    // 返回协议 + 主机名（包含端口）
    return parsedUrl.origin;
  } catch (error) {
    logger.warn("Failed to parse URL", { url, error });
    // 如果URL解析失败，返回原始URL
    return url;
  }
}

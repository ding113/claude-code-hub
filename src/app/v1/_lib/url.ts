import { logger } from "@/lib/logger";

/**
 * 验证 URL 格式是否有效
 * @param url - 待验证的 URL 字符串
 * @returns 是否为有效的 URL
 */
function isValidUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    // 验证必须有协议和主机
    return !!urlObj.protocol && !!urlObj.hostname;
  } catch {
    return false;
  }
}

/**
 * 构建代理目标URL
 * @param baseUrl - 基础URL（如 https://open.bigmodel.cn/api/anthropic 或 http://47.89.209.119/v1）
 * @param requestUrl - 原始请求URL对象
 * @returns 拼接后的完整URL字符串
 * @throws {Error} 如果 baseUrl 格式无效或构建的 URL 无效
 */
export function buildProxyUrl(baseUrl: string, requestUrl: URL): string {
  try {
    // ⭐ 步骤 1: 验证 baseUrl 格式
    if (!baseUrl || typeof baseUrl !== "string") {
      throw new Error(
        `Invalid baseUrl: expected non-empty string, got ${typeof baseUrl}`
      );
    }

    // 尝试解析 baseUrl
    let baseUrlObj: URL;
    try {
      baseUrlObj = new URL(baseUrl);
    } catch (parseError) {
      throw new Error(
        `Invalid baseUrl format: ${baseUrl}. Expected format: http(s)://domain.com/path or http(s)://ip:port/path`
      );
    }

    // ⭐ 步骤 2: 验证协议
    if (!["http:", "https:"].includes(baseUrlObj.protocol)) {
      throw new Error(
        `Invalid protocol in baseUrl: ${baseUrlObj.protocol}. Only http: and https: are supported.`
      );
    }

    // ⭐ 步骤 3: 验证主机名
    if (!baseUrlObj.hostname) {
      throw new Error(
        `Invalid hostname in baseUrl: ${baseUrl}. Hostname is required.`
      );
    }

    // ⭐ 步骤 4: 合并路径
    // 确保路径拼接正确（处理斜杠）
    const basePath = baseUrlObj.pathname.replace(/\/$/, ""); // 移除末尾斜杠
    const requestPath = requestUrl.pathname; // 这已经包含 /v1/...

    // 如果 baseUrl 没有路径（如 http://47.89.209.119），basePath 为 ""
    // 拼接后为 /v1/responses，这是预期行为
    baseUrlObj.pathname = basePath + requestPath;

    // 保留原始请求的查询参数
    baseUrlObj.search = requestUrl.search;

    const finalUrl = baseUrlObj.toString();

    // ⭐ 步骤 5: 验证最终 URL
    if (!isValidUrl(finalUrl)) {
      throw new Error(
        `Constructed URL is invalid: ${finalUrl}. Please check baseUrl configuration.`
      );
    }

    return finalUrl;
  } catch (error) {
    // 记录详细错误信息，帮助诊断配置问题
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("URL 构建失败", {
      baseUrl,
      requestPath: requestUrl.pathname,
      requestSearch: requestUrl.search,
      error: errorMessage,
      suggestion:
        "请检查供应商配置的 API 端点格式，确保格式为: http(s)://domain.com/path 或 http(s)://ip:port/path",
    });

    // 抛出更清晰的错误，不再降级到字符串拼接（避免隐藏配置问题）
    throw new Error(`URL 构建失败: ${errorMessage}`);
  }
}

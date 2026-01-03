export type ProviderUrlValidationError = {
  message: string;
  details: {
    error: string;
    errorType: "InvalidProviderUrl";
  };
};

/**
 * 验证供应商地址是否是可用于连通性测试的 URL（仅做基础格式校验）
 *
 * 说明：此处不再限制内网地址/端口，统一交由管理员配置策略控制。
 */
export function validateProviderUrlForConnectivity(
  providerUrl: string
): { valid: true; normalizedUrl: string } | { valid: false; error: ProviderUrlValidationError } {
  const trimmedUrl = providerUrl.trim();

  try {
    const parsedProviderUrl = new URL(trimmedUrl);

    if (!["https:", "http:"].includes(parsedProviderUrl.protocol)) {
      return {
        valid: false,
        error: {
          message: "供应商地址格式无效",
          details: {
            error: "仅支持 HTTP 和 HTTPS 协议",
            errorType: "InvalidProviderUrl",
          },
        },
      };
    }

    return { valid: true, normalizedUrl: trimmedUrl };
  } catch (error) {
    return {
      valid: false,
      error: {
        message: "供应商地址格式无效",
        details: {
          error: error instanceof Error ? error.message : "URL 解析失败",
          errorType: "InvalidProviderUrl",
        },
      },
    };
  }
}

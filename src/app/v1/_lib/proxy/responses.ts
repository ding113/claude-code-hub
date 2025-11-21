export class ProxyResponses {
  static buildError(
    status: number,
    message: string,
    errorType?: string,
    details?: Record<string, unknown>
  ): Response {
    const payload: {
      error: {
        message: string;
        type: string;
        code?: string;
        details?: Record<string, unknown>;
      };
    } = {
      error: {
        message,
        type: errorType || this.getErrorType(status),
      },
    };

    // 添加错误代码（用于前端识别）
    if (errorType) {
      payload.error.code = errorType;
    }

    // 添加详细信息（可选）
    if (details) {
      payload.error.details = details;
    }

    return new Response(JSON.stringify(payload), {
      status,
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
    });
  }

  /**
   * 根据 HTTP 状态码获取默认错误类型
   */
  private static getErrorType(status: number): string {
    switch (status) {
      case 400:
        return "invalid_request_error";
      case 401:
        return "authentication_error";
      case 403:
        return "permission_error";
      case 404:
        return "not_found_error";
      case 429:
        return "rate_limit_error";
      case 500:
        return "internal_server_error";
      case 502:
        return "bad_gateway_error";
      case 503:
        return "service_unavailable_error";
      case 504:
        return "gateway_timeout_error";
      default:
        return "api_error";
    }
  }
}

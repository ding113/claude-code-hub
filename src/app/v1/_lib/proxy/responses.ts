export class ProxyResponses {
  static buildError(
    status: number,
    message: string,
    errorType?: string,
    details?: Record<string, unknown>,
    requestId?: string
  ): Response {
    const defaultType = ProxyResponses.getErrorType(status);
    const finalType = errorType || defaultType;

    const payload: {
      error: {
        message: string;
        type: string;
        code: string;
        details?: Record<string, unknown>;
      };
      request_id?: string;
    } = {
      error: {
        message,
        type: finalType,
        code: ProxyResponses.getErrorCode(status, finalType),
      },
    };

    // 添加详细信息（可选）
    if (details) {
      payload.error.details = details;
    }

    // 透传上游 request_id（可选）
    if (requestId) {
      payload.request_id = requestId;
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
      case 402:
        return "payment_required_error";
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

  /**
   * 根据 HTTP 状态码和错误类型生成错误代码
   *
   * 设计原则：
   * - code 字段用于客户端快速识别错误类型
   * - 优先使用 type，如果没有则根据状态码生成
   */
  private static getErrorCode(status: number, type: string): string {
    // 特殊类型直接使用 type 作为 code
    if (type && type !== "api_error") {
      return type;
    }

    // 回退到状态码
    switch (status) {
      case 400:
        return "invalid_request";
      case 401:
        return "unauthorized";
      case 402:
        return "payment_required";
      case 403:
        return "forbidden";
      case 404:
        return "not_found";
      case 429:
        return "rate_limit_exceeded";
      case 500:
        return "internal_error";
      case 502:
        return "bad_gateway";
      case 503:
        return "service_unavailable";
      case 504:
        return "gateway_timeout";
      default:
        return `http_${status}`;
    }
  }
}

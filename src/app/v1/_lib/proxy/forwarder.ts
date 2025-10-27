import { HeaderProcessor } from "../headers";
import { buildProxyUrl } from "../url";
import { recordFailure, recordSuccess, getCircuitState } from "@/lib/circuit-breaker";
import { ProxyProviderResolver } from "./provider-selector";
import { ProxyError } from "./errors";
import { ModelRedirector } from "./model-redirector";
import { logger } from "@/lib/logger";
import type { ProxySession } from "./session";
import { defaultRegistry } from "../converters";
import type { Format } from "../converters/types";
import { mapClientFormatToTransformer, mapProviderTypeToTransformer } from "./format-mapper";
import { isOfficialCodexClient, sanitizeCodexRequest } from "../codex/utils/request-sanitizer";

const MAX_RETRY_ATTEMPTS = 3;

export class ProxyForwarder {
  static async send(session: ProxySession): Promise<Response> {
    if (!session.provider || !session.authState?.success) {
      throw new Error("代理上下文缺少供应商或鉴权信息");
    }

    let lastError: Error | null = null;
    let attemptCount = 0;
    let currentProvider = session.provider;
    const failedProviderIds: number[] = []; // 记录已失败的供应商ID

    // 智能重试循环
    while (attemptCount <= MAX_RETRY_ATTEMPTS) {
      try {
        const response = await ProxyForwarder.doForward(session, currentProvider);

        // 成功：记录健康状态
        recordSuccess(currentProvider.id);

        logger.debug("ProxyForwarder: Request successful", {
          providerId: currentProvider.id,
          attempt: attemptCount + 1,
        });

        return response;
      } catch (error) {
        attemptCount++;
        lastError = error as Error;
        failedProviderIds.push(currentProvider.id); // 记录失败的供应商

        // 提取错误信息（支持 ProxyError 和普通 Error）
        const errorMessage =
          error instanceof ProxyError ? error.getDetailedErrorMessage() : (error as Error).message;

        // 记录失败的供应商和错误信息到决策链
        session.addProviderToChain(currentProvider, {
          reason: "retry_failed",
          circuitState: getCircuitState(currentProvider.id),
          attemptNumber: attemptCount,
          errorMessage: errorMessage, // 记录完整上游错误
        });

        // 记录失败
        recordFailure(currentProvider.id, lastError);

        logger.warn("ProxyForwarder: Provider failed", {
          providerId: currentProvider.id,
          attempt: attemptCount,
          maxAttempts: MAX_RETRY_ATTEMPTS + 1,
          error: lastError.message,
        });

        // 如果还有重试机会，选择新的供应商
        if (attemptCount <= MAX_RETRY_ATTEMPTS) {
          const alternativeProvider = await ProxyForwarder.selectAlternative(
            session,
            failedProviderIds // 传入所有已失败的供应商ID列表
          );

          if (!alternativeProvider) {
            logger.error("ProxyForwarder: No alternative provider available, stopping retries");
            break;
          }

          currentProvider = alternativeProvider;
          session.setProvider(currentProvider);

          logger.info("ProxyForwarder: Switched to alternative provider", {
            retryAttempt: attemptCount,
            newProviderId: currentProvider.id,
          });
        }
      }
    }

    // 所有重试都失败
    // 如果最后一个错误是 ProxyError，提取详细信息（包含上游响应）
    const errorDetails =
      lastError instanceof ProxyError
        ? lastError.getDetailedErrorMessage()
        : lastError?.message || "Unknown error";

    throw new Error(
      `All providers failed after ${attemptCount} attempts. Last error: ${errorDetails}`
    );
  }

  /**
   * 实际转发请求
   */
  private static async doForward(
    session: ProxySession,
    provider: typeof session.provider
  ): Promise<Response> {
    if (!provider) {
      throw new Error("Provider is required");
    }

    // 应用模型重定向（如果配置了）
    const wasRedirected = ModelRedirector.apply(session, provider);
    if (wasRedirected) {
      logger.debug("ProxyForwarder: Model redirected", { providerId: provider.id });
    }

    // 请求格式转换（基于 client 格式和 provider 类型）
    const fromFormat: Format = mapClientFormatToTransformer(session.originalFormat);
    const toFormat: Format | null = provider.providerType
      ? mapProviderTypeToTransformer(provider.providerType)
      : null;

    if (fromFormat !== toFormat && fromFormat && toFormat) {
      try {
        const transformed = defaultRegistry.transformRequest(
          fromFormat,
          toFormat,
          session.request.model || "",
          session.request.message,
          true // 假设所有请求都是流式的
        );

        logger.debug("ProxyForwarder: Request format transformed", {
          from: fromFormat,
          to: toFormat,
          model: session.request.model,
        });

        // 更新 session 中的请求体
        session.request.message = transformed;
      } catch (error) {
        logger.error("ProxyForwarder: Request transformation failed", {
          from: fromFormat,
          to: toFormat,
          error,
        });
        // 转换失败时继续使用原始请求
      }
    }

    // Codex 请求清洗（即使格式相同也要执行，除非是官方客户端）
    // 目的：确保非官方客户端的请求也能通过 Codex 供应商的校验
    // - 替换 instructions 为官方完整 prompt
    // - 删除不支持的参数（max_tokens, temperature 等）
    if (toFormat === "codex") {
      const isOfficialClient = isOfficialCodexClient(session.userAgent);

      if (!isOfficialClient) {
        logger.info("[ProxyForwarder] Non-official Codex client detected, sanitizing request", {
          userAgent: session.userAgent || "N/A",
          providerId: provider.id,
          providerName: provider.name,
        });

        try {
          const sanitized = sanitizeCodexRequest(
            session.request.message as Record<string, unknown>,
            session.request.model || "gpt-5-codex"
          );
          session.request.message = sanitized;

          logger.debug("[ProxyForwarder] Codex request sanitized successfully", {
            hasInstructions: !!sanitized.instructions,
            instructionsLength: (sanitized.instructions as string)?.length || 0,
          });
        } catch (error) {
          logger.error("[ProxyForwarder] Failed to sanitize Codex request, using original", {
            error,
          });
          // 清洗失败时继续使用原始请求（降级策略）
        }
      } else {
        logger.debug("[ProxyForwarder] Official Codex client detected, skipping sanitization", {
          userAgent: session.userAgent,
          providerId: provider.id,
        });
      }
    }

    const processedHeaders = ProxyForwarder.buildHeaders(session, provider);

    // 开发模式：输出最终请求头
    if (process.env.NODE_ENV === "development") {
      logger.trace("ProxyForwarder: Final request headers", {
        provider: provider.name,
        providerType: provider.providerType,
        headers: Object.fromEntries(processedHeaders.entries()),
      });
    }

    // 根据目标格式动态选择转发路径
    let forwardUrl = session.requestUrl;

    // Codex 供应商：使用 Response API 端点（/v1/responses）
    // 注意：基于 toFormat 而非 originalFormat，因为需要根据目标供应商类型选择路径
    if (toFormat === "codex") {
      forwardUrl = new URL(session.requestUrl);
      forwardUrl.pathname = "/v1/responses";
      logger.debug("ProxyForwarder: Codex request path rewrite", {
        from: session.requestUrl.pathname,
        to: "/v1/responses",
        originalFormat: fromFormat,
        targetFormat: toFormat,
      });
    }

    const proxyUrl = buildProxyUrl(provider.url, forwardUrl);

    // 输出最终代理 URL（用于调试）
    logger.debug("ProxyForwarder: Final proxy URL", { url: proxyUrl });

    const hasBody = session.method !== "GET" && session.method !== "HEAD";

    // 关键修复：使用转换后的 message 而非原始 buffer
    // 确保 OpenAI 格式转换为 Response API 后，发送的是包含 input 字段的请求体
    let requestBody: BodyInit | undefined;
    if (hasBody) {
      const bodyString = JSON.stringify(session.request.message);
      requestBody = bodyString;

      // 调试日志：输出实际转发的请求体（仅在开发环境）
      if (process.env.NODE_ENV === "development") {
        logger.trace("ProxyForwarder: Forwarding request", {
          provider: provider.name,
          providerId: provider.id,
          proxyUrl: proxyUrl,
          format: session.originalFormat,
          method: session.method,
          bodyLength: bodyString.length,
          bodyPreview: bodyString.slice(0, 1000),
        });
      }
    }

    const init: RequestInit = {
      method: session.method,
      headers: processedHeaders,
      ...(requestBody ? { body: requestBody } : {}),
    };

    (init as Record<string, unknown>).verbose = true;

    let response: Response;
    try {
      response = await fetch(proxyUrl, init);
    } catch (fetchError) {
      // 捕获 fetch 原始错误（网络错误、DNS 解析失败、JSON 序列化错误等）
      logger.error("ProxyForwarder: Fetch failed", {
        providerId: provider.id,
        error: fetchError,
        errorType: fetchError?.constructor?.name,
        errorMessage: (fetchError as Error)?.message,
        errorCause: (fetchError as Error & { cause?: unknown })?.cause,
        proxyUrl: proxyUrl,
        method: session.method,
        hasBody: !!requestBody,
      });

      throw fetchError;
    }

    // 检查 HTTP 错误状态（4xx/5xx 均视为失败，触发重试）
    // 注意：用户要求所有 4xx 都重试，包括 401、403、429 等
    if (!response.ok) {
      throw await ProxyError.fromUpstreamResponse(response, {
        id: provider.id,
        name: provider.name,
      });
    }

    return response;
  }

  /**
   * 选择替代供应商（排除所有已失败的供应商）
   */
  private static async selectAlternative(
    session: ProxySession,
    excludeProviderIds: number[] // 改为数组，排除所有失败的供应商
  ): Promise<typeof session.provider | null> {
    // 使用公开的选择方法，传入排除列表
    const alternativeProvider = await ProxyProviderResolver.pickRandomProviderWithExclusion(
      session,
      excludeProviderIds
    );

    if (!alternativeProvider) {
      logger.warn("ProxyForwarder: No alternative provider available", {
        excludedProviders: excludeProviderIds,
      });
      return null;
    }

    // 确保不是已失败的供应商之一
    if (excludeProviderIds.includes(alternativeProvider.id)) {
      logger.error("ProxyForwarder: Selector returned excluded provider", {
        providerId: alternativeProvider.id,
        message: "This should not happen",
      });
      return null;
    }

    return alternativeProvider;
  }

  private static buildHeaders(
    session: ProxySession,
    provider: NonNullable<typeof session.provider>
  ): Headers {
    const outboundKey = provider.key;

    // 构建请求头覆盖规则
    const overrides: Record<string, string> = {
      host: HeaderProcessor.extractHost(provider.url),
      authorization: `Bearer ${outboundKey}`,
      "x-api-key": outboundKey,
      "content-type": "application/json", // 确保 Content-Type
      "accept-encoding": "identity", // 禁用压缩：避免 undici ZlibError（代理应透传原始数据）
    };

    // Codex 特殊处理：强制设置 User-Agent
    // Codex 供应商检测 User-Agent，只接受 codex_cli_rs 客户端
    if (provider.providerType === "codex") {
      overrides["user-agent"] = "codex_cli_rs/1.0.0 (Mac OS 14.0.0; arm64)";
      logger.debug("ProxyForwarder: Codex provider detected, forcing User-Agent");
    }

    const headerProcessor = HeaderProcessor.createForProxy({
      blacklist: ["content-length"], // 删除原始 Content-Length，让 fetch 自动计算（转换请求后长度变化）
      overrides,
    });

    return headerProcessor.process(session.headers);
  }
}

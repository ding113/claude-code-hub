import { HeaderProcessor } from "../headers";
import { buildProxyUrl } from "../url";
import {
  recordFailure,
  recordSuccess,
  getCircuitState,
  getProviderHealthInfo,
} from "@/lib/circuit-breaker";
import { ProxyProviderResolver } from "./provider-selector";
import { ProxyError, categorizeError, ErrorCategory } from "./errors";
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

        // 修复：成功时记录到决策链
        session.addProviderToChain(currentProvider, {
          reason: attemptCount === 0 ? "request_success" : "retry_success",
          attemptNumber: attemptCount + 1,
          statusCode: response.status,
          circuitState: getCircuitState(currentProvider.id),
        });

        logger.info("ProxyForwarder: Request successful", {
          providerId: currentProvider.id,
          providerName: currentProvider.name,
          attempt: attemptCount + 1,
          statusCode: response.status,
        });

        return response;
      } catch (error) {
        attemptCount++;
        lastError = error as Error;

        // ⭐ 1. 分类错误（供应商错误 vs 系统错误）
        const errorCategory = categorizeError(lastError);
        const errorMessage =
          lastError instanceof ProxyError ? lastError.getDetailedErrorMessage() : lastError.message;

        // ⭐ 2. 系统错误处理（不计入熔断器，先重试1次当前供应商）
        if (errorCategory === ErrorCategory.SYSTEM_ERROR) {
          const err = lastError as Error & {
            code?: string;
            syscall?: string;
          };

          logger.warn("ProxyForwarder: System/network error occurred", {
            providerId: currentProvider.id,
            providerName: currentProvider.name,
            error: errorMessage,
            attemptNumber: attemptCount,
            willRetry: attemptCount === 1,
          });

          // 记录到决策链（不计入 failedProviderIds）
          session.addProviderToChain(currentProvider, {
            reason: "system_error",
            circuitState: getCircuitState(currentProvider.id),
            attemptNumber: attemptCount,
            errorMessage: errorMessage,
            errorDetails: {
              system: {
                errorType: err.constructor.name,
                errorName: err.name,
                errorCode: err.code,
                errorSyscall: err.syscall,
                errorStack: err.stack?.split("\n").slice(0, 3).join("\n"),
              },
            },
          });

          // 第一次系统错误：重试当前供应商（等待100ms避免立即重试）
          if (attemptCount === 1) {
            await new Promise((resolve) => setTimeout(resolve, 100));
            continue; // ⭐ 不切换供应商，不记录熔断器
          }

          // 第二次仍失败：切换供应商（但仍不熔断）
          logger.warn("ProxyForwarder: System error persists, switching provider", {
            providerId: currentProvider.id,
            providerName: currentProvider.name,
          });
        }

        // ⭐ 3. 供应商错误处理（所有 4xx/5xx HTTP 错误，计入熔断器，直接切换）
        else if (errorCategory === ErrorCategory.PROVIDER_ERROR) {
          const proxyError = lastError as ProxyError;
          const statusCode = proxyError.statusCode;

          logger.warn("ProxyForwarder: Provider error, switching immediately", {
            providerId: currentProvider.id,
            providerName: currentProvider.name,
            statusCode: statusCode,
            error: errorMessage,
            attemptNumber: attemptCount,
          });

          // 记录到失败列表（避免重新选择）
          failedProviderIds.push(currentProvider.id);

          // 获取熔断器健康信息（用于决策链显示）
          const { health, config } = await getProviderHealthInfo(currentProvider.id);

          // 记录到决策链
          session.addProviderToChain(currentProvider, {
            reason: "retry_failed",
            circuitState: getCircuitState(currentProvider.id),
            attemptNumber: attemptCount,
            errorMessage: errorMessage,
            circuitFailureCount: health.failureCount + 1, // 包含本次失败
            circuitFailureThreshold: config.failureThreshold,
            statusCode: statusCode,
            errorDetails: {
              provider: {
                id: currentProvider.id,
                name: currentProvider.name,
                statusCode: statusCode,
                statusText: proxyError.message,
                upstreamBody: proxyError.upstreamError?.body,
                upstreamParsed: proxyError.upstreamError?.parsed,
              },
            },
          });

          // ⭐ 只有非探测请求才计入熔断器
          if (session.isProbeRequest()) {
            logger.debug("ProxyForwarder: Probe request error, skipping circuit breaker", {
              providerId: currentProvider.id,
              providerName: currentProvider.name,
              messagesCount: session.getMessagesLength(),
            });
          } else {
            await recordFailure(currentProvider.id, lastError);
          }
        }

        // 尝试切换供应商（供应商错误 + 系统错误第二次失败）
        if (attemptCount <= MAX_RETRY_ATTEMPTS) {
          const alternativeProvider = await ProxyForwarder.selectAlternative(
            session,
            failedProviderIds // ⭐ 系统错误不在此列表中（仍可能被选中）
          );

          if (!alternativeProvider) {
            logger.error("ProxyForwarder: No alternative provider available, stopping retries", {
              attemptCount,
              failedProviderIds,
            });
            break;
          }

          currentProvider = alternativeProvider;
          session.setProvider(currentProvider);

          logger.info("ProxyForwarder: Switched to alternative provider", {
            retryAttempt: attemptCount,
            newProviderId: currentProvider.id,
            newProviderName: currentProvider.name,
          });
        }
      }
    }

    // 所有重试都失败
    // 如果最后一个错误是 ProxyError，保留状态码并重新抛出
    if (lastError instanceof ProxyError) {
      throw new ProxyError(
        `All providers failed after ${attemptCount} attempts. Last error: ${lastError.getDetailedErrorMessage()}`,
        lastError.statusCode // 使用最后一次请求的实际状态码
      );
    }

    // 其他类型的错误，抛出 500
    const errorDetails = lastError?.message || "Unknown error";
    throw new ProxyError(
      `All providers failed after ${attemptCount} attempts. Last error: ${errorDetails}`,
      500
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
      const log = isOfficialClient ? logger.debug.bind(logger) : logger.info.bind(logger);

      log("[ProxyForwarder] Normalizing Codex request for upstream compatibility", {
        userAgent: session.userAgent || "N/A",
        providerId: provider.id,
        providerName: provider.name,
        officialClient: isOfficialClient,
      });

      try {
        const sanitized = sanitizeCodexRequest(
          session.request.message as Record<string, unknown>,
          session.request.model || "gpt-5-codex"
        );

        const instructionsLength =
          typeof sanitized.instructions === "string" ? sanitized.instructions.length : 0;

        if (!instructionsLength) {
          logger.warn("[ProxyForwarder] Codex sanitization yielded empty instructions", {
            providerId: provider.id,
            officialClient: isOfficialClient,
          });
        }

        session.request.message = sanitized;

        logger.debug("[ProxyForwarder] Codex request sanitized", {
          instructionsLength,
          hasParallelToolCalls: sanitized.parallel_tool_calls,
          hasStoreFlag: sanitized.store,
        });
      } catch (error) {
        logger.error("[ProxyForwarder] Failed to sanitize Codex request, using original", {
          error,
          providerId: provider.id,
        });
        // 清洗失败时继续使用原始请求（降级策略）
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
      // 捕获 fetch 原始错误（网络错误、DNS 解析失败、连接失败等）
      const err = fetchError as Error & {
        cause?: unknown;
        code?: string; // Node.js 错误码：如 'ENOTFOUND'、'ECONNREFUSED'、'ETIMEDOUT'
        errno?: number;
        syscall?: string; // 系统调用：如 'getaddrinfo'、'connect'、'read'、'write'
      };

      logger.error("ProxyForwarder: Fetch failed", {
        providerId: provider.id,
        providerName: provider.name,
        proxyUrl: new URL(proxyUrl).origin, // 只记录域名，隐藏查询参数和 API Key

        // ⭐ 详细错误信息（关键诊断字段）
        errorType: err.constructor.name,
        errorName: err.name,
        errorMessage: err.message,
        errorCode: err.code, // ⭐ 如 'ENOTFOUND'（DNS失败）、'ECONNREFUSED'（连接拒绝）、'ETIMEDOUT'（超时）
        errorSyscall: err.syscall, // ⭐ 如 'getaddrinfo'（DNS查询）、'connect'（TCP连接）
        errorErrno: err.errno,
        errorCause: err.cause,
        errorStack: err.stack?.split("\n").slice(0, 3).join("\n"), // 前3行堆栈

        // 请求上下文
        method: session.method,
        hasBody: !!requestBody,
        bodySize: requestBody ? JSON.stringify(requestBody).length : 0,
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

    // claude-auth: 移除 x-api-key（避免中转服务冲突）
    if (provider.providerType === "claude-auth") {
      delete overrides["x-api-key"];
    }

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

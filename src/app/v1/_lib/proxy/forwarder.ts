import { HeaderProcessor } from "../headers";
import { buildProxyUrl } from "../url";
import {
  recordFailure,
  recordSuccess,
  getCircuitState,
  getProviderHealthInfo,
} from "@/lib/circuit-breaker";
import { ProxyProviderResolver } from "./provider-selector";
import { ProxyError, categorizeError, ErrorCategory, isClientAbortError } from "./errors";
import { ModelRedirector } from "./model-redirector";
import { SessionManager } from "@/lib/session-manager";
import { logger } from "@/lib/logger";
import type { ProxySession } from "./session";
import { defaultRegistry } from "../converters";
import type { Format } from "../converters/types";
import { mapClientFormatToTransformer, mapProviderTypeToTransformer } from "./format-mapper";
import { isOfficialCodexClient, sanitizeCodexRequest } from "../codex/utils/request-sanitizer";
import { createProxyAgentForProvider } from "@/lib/proxy-agent";
import type { Dispatcher } from "undici";
import { getEnvConfig } from "@/lib/config/env.schema";

const MAX_ATTEMPTS_PER_PROVIDER = 2; // 每个供应商最多尝试次数（首次 + 1次重试）
const MAX_PROVIDER_SWITCHES = 20; // 保险栓：最多切换 20 次供应商（防止无限循环）

export class ProxyForwarder {
  static async send(session: ProxySession): Promise<Response> {
    if (!session.provider || !session.authState?.success) {
      throw new Error("代理上下文缺少供应商或鉴权信息");
    }

    let lastError: Error | null = null;
    let currentProvider = session.provider;
    const failedProviderIds: number[] = []; // 记录已失败的供应商ID
    let totalProvidersAttempted = 0; // 已尝试的供应商数量（用于日志）

    // ========== 外层循环：供应商切换（最多 MAX_PROVIDER_SWITCHES 次）==========
    while (totalProvidersAttempted < MAX_PROVIDER_SWITCHES) {
      totalProvidersAttempted++;
      let attemptCount = 0; // 当前供应商的尝试次数

      logger.info("ProxyForwarder: Trying provider", {
        providerId: currentProvider.id,
        providerName: currentProvider.name,
        totalProvidersAttempted,
      });

      // ========== 内层循环：重试当前供应商（最多 MAX_ATTEMPTS_PER_PROVIDER 次）==========
      while (attemptCount < MAX_ATTEMPTS_PER_PROVIDER) {
        attemptCount++;

        try {
          const response = await ProxyForwarder.doForward(session, currentProvider);

          // ========== 成功分支 ==========
          recordSuccess(currentProvider.id);

          // ⭐ 成功后绑定 session 到供应商（智能绑定策略）
          if (session.sessionId) {
            // 使用智能绑定策略（主备模式 + 健康自动回迁）
            const result = await SessionManager.updateSessionBindingSmart(
              session.sessionId,
              currentProvider.id,
              currentProvider.priority || 0,
              totalProvidersAttempted === 1 && attemptCount === 1 // isFirstAttempt
            );

            if (result.updated) {
              logger.info("ProxyForwarder: Session binding updated", {
                sessionId: session.sessionId,
                providerId: currentProvider.id,
                providerName: currentProvider.name,
                priority: currentProvider.priority,
                groupTag: currentProvider.groupTag,
                reason: result.reason,
                details: result.details,
                attemptNumber: attemptCount,
                totalProvidersAttempted,
              });
            } else {
              logger.debug("ProxyForwarder: Session binding not updated", {
                sessionId: session.sessionId,
                providerId: currentProvider.id,
                providerName: currentProvider.name,
                priority: currentProvider.priority,
                reason: result.reason,
                details: result.details,
              });
            }

            // ⭐ 统一更新两个数据源（确保监控数据一致）
            // session:provider (真实绑定) 已在 updateSessionBindingSmart 中更新
            // session:info (监控信息) 在此更新
            void SessionManager.updateSessionProvider(session.sessionId, {
              providerId: currentProvider.id,
              providerName: currentProvider.name,
            }).catch((error) => {
              logger.error("ProxyForwarder: Failed to update session provider info", { error });
            });
          }

          // 记录到决策链
          session.addProviderToChain(currentProvider, {
            reason:
              totalProvidersAttempted === 1 && attemptCount === 1
                ? "request_success"
                : "retry_success",
            attemptNumber: attemptCount,
            statusCode: response.status,
            circuitState: getCircuitState(currentProvider.id),
          });

          logger.info("ProxyForwarder: Request successful", {
            providerId: currentProvider.id,
            providerName: currentProvider.name,
            attemptNumber: attemptCount,
            totalProvidersAttempted,
            statusCode: response.status,
          });

          return response; // ⭐ 成功：立即返回，结束所有循环
        } catch (error) {
          lastError = error as Error;

          // ⭐ 1. 分类错误（供应商错误 vs 系统错误 vs 客户端中断）
          const errorCategory = categorizeError(lastError);
          const errorMessage =
            lastError instanceof ProxyError
              ? lastError.getDetailedErrorMessage()
              : lastError.message;

          // ⭐ 2. 客户端中断处理（不计入熔断器，不重试，立即返回）
          if (errorCategory === ErrorCategory.CLIENT_ABORT) {
            logger.warn("ProxyForwarder: Client aborted, stopping immediately", {
              providerId: currentProvider.id,
              providerName: currentProvider.name,
              attemptNumber: attemptCount,
              totalProvidersAttempted,
            });

            // 记录到决策链（标记为客户端中断）
            session.addProviderToChain(currentProvider, {
              reason: "system_error", // 使用 system_error 作为客户端中断的原因
              circuitState: getCircuitState(currentProvider.id),
              attemptNumber: attemptCount,
              errorMessage: "Client aborted request",
              errorDetails: {
                system: {
                  errorType: "ClientAbort",
                  errorName: lastError.name,
                  errorCode: "CLIENT_ABORT",
                  errorStack: lastError.stack?.split("\n").slice(0, 3).join("\n"),
                },
              },
            });

            // 立即抛出错误，不重试
            throw lastError;
          }

          // ⭐ 3. 系统错误处理（不计入熔断器，先重试1次当前供应商）
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
              totalProvidersAttempted,
              willRetry: attemptCount < MAX_ATTEMPTS_PER_PROVIDER,
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

            // 第1次失败：等待100ms后重试当前供应商
            if (attemptCount < MAX_ATTEMPTS_PER_PROVIDER) {
              await new Promise((resolve) => setTimeout(resolve, 100));
              continue; // ⭐ 继续内层循环（重试当前供应商）
            }

            // 第2次失败：跳出内层循环，切换供应商
            logger.warn("ProxyForwarder: System error persists, will switch provider", {
              providerId: currentProvider.id,
              providerName: currentProvider.name,
              totalProvidersAttempted,
            });

            // ⭐ 检查是否启用了网络错误计入熔断器
            const env = getEnvConfig();
            if (env.ENABLE_CIRCUIT_BREAKER_ON_NETWORK_ERRORS) {
              logger.warn(
                "ProxyForwarder: Network error will be counted towards circuit breaker (enabled by config)",
                {
                  providerId: currentProvider.id,
                  providerName: currentProvider.name,
                  errorType: err.constructor.name,
                  errorCode: err.code,
                }
              );

              // 记录到失败列表（避免重新选择）
              failedProviderIds.push(currentProvider.id);

              // 计入熔断器
              await recordFailure(currentProvider.id, lastError);
            } else {
              logger.debug(
                "ProxyForwarder: Network error not counted towards circuit breaker (disabled by default)",
                {
                  providerId: currentProvider.id,
                  providerName: currentProvider.name,
                }
              );
            }

            break; // ⭐ 跳出内层循环，进入供应商切换逻辑
          }

          // ⭐ 4. 供应商错误处理（所有 4xx/5xx HTTP 错误，计入熔断器，直接切换）
          if (errorCategory === ErrorCategory.PROVIDER_ERROR) {
            const proxyError = lastError as ProxyError;
            const statusCode = proxyError.statusCode;

            logger.warn("ProxyForwarder: Provider error, will switch immediately", {
              providerId: currentProvider.id,
              providerName: currentProvider.name,
              statusCode: statusCode,
              error: errorMessage,
              attemptNumber: attemptCount,
              totalProvidersAttempted,
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

            break; // ⭐ 跳出内层循环，进入供应商切换逻辑
          }
        }
      } // ========== 内层循环结束 ==========

      // ========== 供应商切换逻辑 ==========
      const alternativeProvider = await ProxyForwarder.selectAlternative(
        session,
        failedProviderIds
      );

      if (!alternativeProvider) {
        // ⭐ 无可用供应商：所有供应商都失败了
        logger.error("ProxyForwarder: All providers failed", {
          totalProvidersAttempted,
          failedProviderCount: failedProviderIds.length,
          // 不记录详细供应商列表（安全考虑）
        });
        break; // 退出外层循环
      }

      // 切换到新供应商
      currentProvider = alternativeProvider;
      session.setProvider(currentProvider);

      logger.info("ProxyForwarder: Switched to alternative provider", {
        totalProvidersAttempted,
        newProviderId: currentProvider.id,
        newProviderName: currentProvider.name,
      });

      // ⭐ 继续外层循环（尝试新供应商）
    } // ========== 外层循环结束 ==========

    // ========== 所有供应商都失败：抛出简化错误 ==========
    // ⭐ 检查是否达到保险栓上限
    if (totalProvidersAttempted >= MAX_PROVIDER_SWITCHES) {
      logger.error("ProxyForwarder: Exceeded max provider switches (safety limit)", {
        totalProvidersAttempted,
        maxSwitches: MAX_PROVIDER_SWITCHES,
        failedProviderCount: failedProviderIds.length,
      });
    }

    // ⭐ 不暴露供应商详情，仅返回简单错误
    throw new ProxyError("所有供应商暂时不可用，请稍后重试", 503); // Service Unavailable
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

    // ⭐ 扩展 RequestInit 类型以支持 undici dispatcher
    interface UndiciFetchOptions extends RequestInit {
      dispatcher?: Dispatcher;
    }

    const init: UndiciFetchOptions = {
      method: session.method,
      headers: processedHeaders,
      signal: session.clientAbortSignal || undefined, // 传递客户端中断信号
      ...(requestBody ? { body: requestBody } : {}),
    };

    // ⭐ 应用代理配置（如果配置了）
    const proxyConfig = createProxyAgentForProvider(provider, proxyUrl);
    if (proxyConfig) {
      init.dispatcher = proxyConfig.agent;
      logger.info("ProxyForwarder: Using proxy", {
        providerId: provider.id,
        providerName: provider.name,
        proxyUrl: proxyConfig.proxyUrl,
        fallbackToDirect: proxyConfig.fallbackToDirect,
        targetUrl: new URL(proxyUrl).origin,
      });
    }

    (init as Record<string, unknown>).verbose = true;

    let response: Response;
    try {
      response = await fetch(proxyUrl, init);
    } catch (fetchError) {
      // 捕获 fetch 原始错误（网络错误、DNS 解析失败、连接失败等）
      const err = fetchError as Error & {
        cause?: unknown;
        code?: string; // Node.js 错误码：如 'ENOTFOUND'、'ECONNREFUSED'、'ETIMEDOUT'、'ECONNRESET'
        errno?: number;
        syscall?: string; // 系统调用：如 'getaddrinfo'、'connect'、'read'、'write'
      };

      // ⭐ 检测客户端主动中断（使用统一的精确检测函数）
      if (isClientAbortError(err)) {
        logger.warn("ProxyForwarder: Request/response aborted", {
          providerId: provider.id,
          providerName: provider.name,
          proxyUrl: new URL(proxyUrl).origin,
          errorName: err.name,
          errorMessage: err.message || "(empty message)",
          errorCode: err.code || "N/A",
        });

        // 客户端中断不应计入熔断器，也不重试，直接抛出错误
        throw new ProxyError(
          err.name === "ResponseAborted"
            ? "Response transmission aborted"
            : "Request aborted by client",
          499 // Nginx 使用的 "Client Closed Request" 状态码
        );
      }

      // ⭐ 代理相关错误处理（如果配置了代理）
      if (proxyConfig) {
        const isProxyError =
          err.message.includes("proxy") ||
          err.message.includes("ECONNREFUSED") ||
          err.message.includes("ENOTFOUND") ||
          err.message.includes("ETIMEDOUT");

        if (isProxyError) {
          logger.error("ProxyForwarder: Proxy connection failed", {
            providerId: provider.id,
            providerName: provider.name,
            proxyUrl: proxyConfig.proxyUrl,
            fallbackToDirect: proxyConfig.fallbackToDirect,
            errorType: err.constructor.name,
            errorMessage: err.message,
            errorCode: err.code,
          });

          // 如果配置了降级到直连，尝试不使用代理
          if (proxyConfig.fallbackToDirect) {
            logger.warn("ProxyForwarder: Falling back to direct connection", {
              providerId: provider.id,
              providerName: provider.name,
            });

            // 创建新的配置对象，不包含 dispatcher
            const fallbackInit = { ...init };
            delete fallbackInit.dispatcher;
            try {
              response = await fetch(proxyUrl, fallbackInit);
              logger.info("ProxyForwarder: Direct connection succeeded after proxy failure", {
                providerId: provider.id,
                providerName: provider.name,
              });
              // 成功后跳过 throw，继续执行后续逻辑
            } catch (directError) {
              // 直连也失败，抛出原始错误
              logger.error("ProxyForwarder: Direct connection also failed", {
                providerId: provider.id,
                error: directError,
              });
              throw fetchError; // 抛出原始代理错误
            }
          } else {
            // 不降级，直接抛出代理错误
            throw new ProxyError(`Proxy connection failed: ${err.message}`, 500);
          }
        } else {
          // 非代理相关错误，记录详细信息后抛出
          logger.error("ProxyForwarder: Fetch failed (with proxy configured)", {
            providerId: provider.id,
            providerName: provider.name,
            proxyUrl: new URL(proxyUrl).origin,
            proxyConfigured: proxyConfig.proxyUrl,
            errorType: err.constructor.name,
            errorName: err.name,
            errorMessage: err.message,
            errorCode: err.code,
            errorSyscall: err.syscall,
            errorErrno: err.errno,
            errorCause: err.cause,
            errorStack: err.stack?.split("\n").slice(0, 3).join("\n"),
            method: session.method,
            hasBody: !!requestBody,
            bodySize: requestBody ? JSON.stringify(requestBody).length : 0,
          });

          throw fetchError;
        }
      } else {
        // 未使用代理，原有错误处理逻辑
        logger.error("ProxyForwarder: Fetch failed", {
          providerId: provider.id,
          providerName: provider.name,
          proxyUrl: new URL(proxyUrl).origin, // 只记录域名，隐藏查询参数和 API Key

          // ⭐ 详细错误信息（关键诊断字段）
          errorType: err.constructor.name,
          errorName: err.name,
          errorMessage: err.message,
          errorCode: err.code, // ⭐ 如 'ENOTFOUND'（DNS失败）、'ECONNREFUSED'（连接拒绝）、'ETIMEDOUT'（超时）、'ECONNRESET'（连接重置）
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

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
import { getDefaultInstructions } from "../codex/constants/codex-instructions";
import { CodexInstructionsCache } from "@/lib/codex-instructions-cache";
import { createProxyAgentForProvider } from "@/lib/proxy-agent";
import type { Dispatcher } from "undici";
import { getEnvConfig } from "@/lib/config/env.schema";
import { GEMINI_PROTOCOL } from "../gemini/protocol";
import { GeminiAuth } from "../gemini/auth";

const MAX_ATTEMPTS_PER_PROVIDER = 2; // 每个供应商最多尝试次数（首次 + 1次重试）
const MAX_PROVIDER_SWITCHES = 20; // 保险栓：最多切换 20 次供应商（防止无限循环）

/**
 * 过滤私有参数（下划线前缀）
 *
 * 目的：防止私有参数（如 _canRetryWithOfficialInstructions）泄露到上游供应商
 * 导致 "Unsupported parameter" 错误
 *
 * @param obj - 原始请求对象
 * @returns 过滤后的请求对象
 */
function filterPrivateParameters(obj: unknown): unknown {
  // 非对象类型直接返回
  if (typeof obj !== "object" || obj === null) {
    return obj;
  }

  // 数组类型递归处理
  if (Array.isArray(obj)) {
    return obj.map((item) => filterPrivateParameters(item));
  }

  // 对象类型：过滤下划线前缀的键
  const filtered: Record<string, unknown> = {};
  const removedKeys: string[] = [];

  for (const [key, value] of Object.entries(obj)) {
    if (key.startsWith("_")) {
      // 私有参数：跳过
      removedKeys.push(key);
    } else {
      // 公开参数：递归过滤值
      filtered[key] = filterPrivateParameters(value);
    }
  }

  // 记录被过滤的参数（debug 级别）
  if (removedKeys.length > 0) {
    logger.debug("[ProxyForwarder] Filtered private parameters from request", {
      removedKeys,
      reason: "Private parameters (underscore-prefixed) should not be sent to upstream providers",
    });
  }

  return filtered;
}

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

          // ⭐ Phase 4: 成功响应后缓存 instructions（自动学习）
          if (
            currentProvider.providerType === "codex" &&
            currentProvider.codexInstructionsStrategy === "auto"
          ) {
            try {
              const requestBody = session.request.message as Record<string, unknown>;
              const instructions = requestBody.instructions;

              if (instructions && typeof instructions === "string") {
                await CodexInstructionsCache.set(
                  currentProvider.id,
                  session.request.model || "gpt-5-codex",
                  instructions
                );

                logger.debug(
                  "[ProxyForwarder] Cached successful instructions for future requests",
                  {
                    providerId: currentProvider.id,
                    providerName: currentProvider.name,
                    model: session.request.model,
                    instructionsLength: instructions.length,
                  }
                );
              }
            } catch (error) {
              // Fail Open: 缓存失败不影响主流程
              logger.warn("[ProxyForwarder] Failed to cache instructions, continuing", {
                error,
                providerId: currentProvider.id,
              });
            }
          }

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

          // ⭐ 3. 不可重试的客户端输入错误处理（不计入熔断器，不重试，立即返回）
          if (errorCategory === ErrorCategory.NON_RETRYABLE_CLIENT_ERROR) {
            const proxyError = lastError as ProxyError;
            const statusCode = proxyError.statusCode;

            logger.warn("ProxyForwarder: Non-retryable client error, stopping immediately", {
              providerId: currentProvider.id,
              providerName: currentProvider.name,
              statusCode: statusCode,
              error: errorMessage,
              attemptNumber: attemptCount,
              totalProvidersAttempted,
              reason:
                "White-listed client error (prompt length, content filter, PDF limit, or thinking format)",
            });

            // 记录到决策链（标记为不可重试的客户端错误）
            // 注意：不调用 recordFailure()，因为这不是供应商的问题，是客户端输入问题
            session.addProviderToChain(currentProvider, {
              reason: "client_error_non_retryable", // 新增的 reason 值
              circuitState: getCircuitState(currentProvider.id),
              attemptNumber: attemptCount,
              errorMessage: errorMessage,
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
                clientError: proxyError.getDetailedErrorMessage(),
              },
            });

            // 立即抛出错误，不重试，不切换供应商
            // 白名单错误不计入熔断器，因为是客户端输入问题，不是供应商故障
            throw lastError;
          }

          // ⭐ 4. 系统错误处理（不计入熔断器，先重试1次当前供应商）
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

            // 无论是否计入熔断器，都要加入 failedProviderIds（避免重复选择同一供应商）
            failedProviderIds.push(currentProvider.id);

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

          // ⭐ 5. 供应商错误处理（所有 4xx/5xx HTTP 错误，计入熔断器，直接切换）
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

            // 🆕 特殊处理：400 + "Instructions are not valid" 错误智能重试
            // 针对部分严格的 Codex 中转站（如 88code、foxcode），会验证 instructions 字段
            // 如果检测到该错误且满足重试条件，根据策略选择重试方式
            if (statusCode === 400 && errorMessage.includes("Instructions are not valid")) {
              const canRetryWithOfficial = (session.request.message as Record<string, unknown>)
                ._canRetryWithOfficialInstructions;
              const canRetryWithCache = currentProvider.codexInstructionsStrategy === "auto";

              if (canRetryWithOfficial || canRetryWithCache) {
                logger.warn(
                  "[ProxyForwarder] Detected 'Instructions are not valid' error, intelligent retry",
                  {
                    providerId: currentProvider.id,
                    providerName: currentProvider.name,
                    strategy: currentProvider.codexInstructionsStrategy,
                    attemptNumber: attemptCount,
                    totalProvidersAttempted,
                  }
                );

                // 优先尝试使用缓存的 instructions（如果存在）
                let retryInstructions: string | null = null;
                let instructionsSource: "cache" | "official" = "official";

                if (canRetryWithCache) {
                  try {
                    retryInstructions = await CodexInstructionsCache.get(
                      currentProvider.id,
                      session.request.model || "gpt-5-codex"
                    );

                    if (retryInstructions) {
                      instructionsSource = "cache";
                      logger.info("[ProxyForwarder] Retrying with cached instructions", {
                        providerId: currentProvider.id,
                        instructionsLength: retryInstructions.length,
                      });
                    }
                  } catch (error) {
                    logger.warn("[ProxyForwarder] Failed to fetch cached instructions", { error });
                  }
                }

                // Fallback: 使用官方 instructions
                if (!retryInstructions) {
                  retryInstructions = getDefaultInstructions(
                    session.request.model || "gpt-5-codex"
                  );
                  instructionsSource = "official";

                  logger.info("[ProxyForwarder] Retrying with official instructions (fallback)", {
                    providerId: currentProvider.id,
                    instructionsLength: retryInstructions.length,
                  });
                }

                // 替换 instructions
                (session.request.message as Record<string, unknown>).instructions =
                  retryInstructions;

                // 删除重试标记（避免无限循环）
                delete (session.request.message as Record<string, unknown>)
                  ._canRetryWithOfficialInstructions;

                // 记录到决策链
                session.addProviderToChain(currentProvider, {
                  reason:
                    instructionsSource === "cache"
                      ? "retry_with_cached_instructions"
                      : "retry_with_official_instructions",
                  circuitState: getCircuitState(currentProvider.id),
                  attemptNumber: attemptCount,
                  errorMessage: errorMessage,
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
                    instructionsSource,
                  },
                });

                // 继续内层循环（重试当前供应商，不切换）
                continue;
              }
            }

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

    let proxyUrl: string;
    let processedHeaders: Headers;
    let requestBody: BodyInit | undefined;
    let isStreaming = false;

    // --- GEMINI HANDLING ---
    if (provider.providerType === "gemini" || provider.providerType === "gemini-cli") {
      // 1. 直接透传请求体（不转换）
      const bodyString = JSON.stringify(session.request.message);
      requestBody = bodyString;

      // 检测流式请求
      try {
        const originalBody = session.request.message as Record<string, unknown>;
        isStreaming = originalBody.stream === true;
      } catch {
        isStreaming = false;
      }

      // 2. 准备认证和 Headers
      const accessToken = await GeminiAuth.getAccessToken(provider.key);
      const isApiKey = GeminiAuth.isApiKey(provider.key);

      const headers = new Headers();
      headers.set("Content-Type", "application/json");

      if (isApiKey) {
        headers.set(GEMINI_PROTOCOL.HEADERS.API_KEY, accessToken);
      } else {
        headers.set("Authorization", `Bearer ${accessToken}`);
      }

      // CLI specific headers
      if (provider.providerType === "gemini-cli") {
        headers.set(GEMINI_PROTOCOL.HEADERS.API_CLIENT, "GeminiCLI/1.0");
      }

      // 3. 直接透传：使用 buildProxyUrl() 拼接原始路径和查询参数
      const baseUrl =
        provider.url ||
        (provider.providerType === "gemini"
          ? GEMINI_PROTOCOL.OFFICIAL_ENDPOINT
          : GEMINI_PROTOCOL.CLI_ENDPOINT);

      proxyUrl = buildProxyUrl(baseUrl, session.requestUrl);
      processedHeaders = headers;

      logger.debug("ProxyForwarder: Gemini request passthrough", {
        providerId: provider.id,
        type: provider.providerType,
        url: proxyUrl,
        originalPath: session.requestUrl.pathname,
        isStreaming,
        isApiKey,
      });
    } else {
      // --- STANDARD HANDLING ---
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
      if (toFormat === "codex") {
        const isOfficialClient = isOfficialCodexClient(session.userAgent);
        const log = isOfficialClient ? logger.debug.bind(logger) : logger.info.bind(logger);

        log("[ProxyForwarder] Normalizing Codex request for upstream compatibility", {
          userAgent: session.userAgent || "N/A",
          providerId: provider.id,
          providerName: provider.name,
          officialClient: isOfficialClient,
          codexStrategy: provider.codexInstructionsStrategy,
        });

        const shouldBypassSanitizer =
          isOfficialClient && (provider.codexInstructionsStrategy ?? "auto") === "auto";

        if (shouldBypassSanitizer) {
          logger.debug(
            "[ProxyForwarder] Bypassing sanitizer for official Codex CLI (auto strategy)",
            {
              providerId: provider.id,
              providerName: provider.name,
            }
          );
        } else {
          try {
            const sanitized = await sanitizeCodexRequest(
              session.request.message as Record<string, unknown>,
              session.request.model || "gpt-5-codex",
              provider.codexInstructionsStrategy,
              provider.id,
              { isOfficialClient }
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
          }
        }
      }

      processedHeaders = ProxyForwarder.buildHeaders(session, provider);

      if (process.env.NODE_ENV === "development") {
        logger.trace("ProxyForwarder: Final request headers", {
          provider: provider.name,
          providerType: provider.providerType,
          headers: Object.fromEntries(processedHeaders.entries()),
        });
      }

      // ⭐ 直接使用原始请求路径，让 buildProxyUrl() 智能处理路径拼接
      // 移除了强制 /v1/responses 路径重写，解决 Issue #139
      // buildProxyUrl() 会检测 base_url 是否已包含完整路径，避免重复拼接
      proxyUrl = buildProxyUrl(provider.url, session.requestUrl);

      logger.debug("ProxyForwarder: Final proxy URL", {
        url: proxyUrl,
        originalPath: session.requestUrl.pathname,
        providerType: provider.providerType,
      });

      const hasBody = session.method !== "GET" && session.method !== "HEAD";

      if (hasBody) {
        const filteredMessage = filterPrivateParameters(session.request.message);
        const bodyString = JSON.stringify(filteredMessage);
        requestBody = bodyString;

        try {
          const parsed = JSON.parse(bodyString);
          isStreaming = parsed.stream === true;
        } catch {
          isStreaming = false;
        }

        if (process.env.NODE_ENV === "development") {
          logger.trace("ProxyForwarder: Forwarding request", {
            provider: provider.name,
            providerId: provider.id,
            proxyUrl: proxyUrl,
            format: session.originalFormat,
            method: session.method,
            bodyLength: bodyString.length,
            bodyPreview: bodyString.slice(0, 1000),
            isStreaming,
          });
        }
      }
    }

    // ⭐ 扩展 RequestInit 类型以支持 undici dispatcher
    interface UndiciFetchOptions extends RequestInit {
      dispatcher?: Dispatcher;
    }

    // ⭐ 双路超时控制（first-byte / total）
    // 注意：由于 undici fetch API 的限制，无法精确分离 DNS/TCP/TLS 连接阶段和响应头接收阶段
    // 参考：https://github.com/nodejs/undici/discussions/1313
    // 1. 首包/总响应超时：根据请求类型选择
    const responseController = new AbortController();
    let responseTimeoutMs: number;
    let responseTimeoutType: string;

    if (isStreaming) {
      // 流式请求：使用首字节超时（快速失败）
      responseTimeoutMs =
        provider.firstByteTimeoutStreamingMs > 0 ? provider.firstByteTimeoutStreamingMs : 0;
      responseTimeoutType = "streaming_first_byte";
    } else {
      // 非流式请求：使用总超时（防止无限挂起）
      responseTimeoutMs =
        provider.requestTimeoutNonStreamingMs > 0 ? provider.requestTimeoutNonStreamingMs : 0;
      responseTimeoutType = "non_streaming_total";
    }

    let responseTimeoutId: NodeJS.Timeout | null = null;
    if (responseTimeoutMs > 0) {
      responseTimeoutId = setTimeout(() => {
        responseController.abort();
        logger.warn("ProxyForwarder: Response timeout", {
          providerId: provider.id,
          providerName: provider.name,
          responseTimeoutMs,
          responseTimeoutType,
          isStreaming,
        });
      }, responseTimeoutMs);
    } else {
      logger.debug("ProxyForwarder: Response timeout disabled", {
        providerId: provider.id,
        providerName: provider.name,
        responseTimeoutType,
      });
    }

    // 2. 组合双路信号：response + client
    let combinedSignal: AbortSignal | undefined;
    const signals = [responseController.signal];
    if (session.clientAbortSignal) {
      signals.push(session.clientAbortSignal);
    }

    // ⭐ AbortSignal.any 实现（兼容所有环境）
    // 原因：Next.js standalone 可能覆盖全局 AbortSignal，导致原生 any 方法不可用
    if ("any" in AbortSignal && typeof AbortSignal.any === "function") {
      // 优先使用原生实现（Node.js 20.3+）
      combinedSignal = AbortSignal.any(signals);
      logger.debug("ProxyForwarder: Using native AbortSignal.any", {
        signalCount: signals.length,
      });
    } else {
      // Polyfill: 手动实现多信号组合逻辑
      logger.debug("ProxyForwarder: Using AbortSignal.any polyfill", {
        signalCount: signals.length,
        reason: "Native AbortSignal.any not available",
      });

      const combinedController = new AbortController();
      const cleanupHandlers: Array<() => void> = [];

      // 为每个信号添加监听器
      for (const signal of signals) {
        // 如果已经有信号中断，立即中断组合信号
        if (signal.aborted) {
          combinedController.abort();
          break;
        }

        // 监听信号中断事件
        const abortHandler = () => {
          // 中断组合信号
          combinedController.abort();
          // 清理所有监听器（避免内存泄漏）
          cleanupHandlers.forEach((cleanup) => cleanup());
        };

        signal.addEventListener("abort", abortHandler, { once: true });

        // 记录清理函数
        cleanupHandlers.push(() => {
          signal.removeEventListener("abort", abortHandler);
        });
      }

      combinedSignal = combinedController.signal;
    }

    const init: UndiciFetchOptions = {
      method: session.method,
      headers: processedHeaders,
      signal: combinedSignal, // 使用组合信号
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
    const fetchStartTime = Date.now();
    try {
      response = await fetch(proxyUrl, init);
      // ⭐ fetch 成功：收到 HTTP 响应头，保留响应超时继续监控
      // 注意：undici 的 fetch 在收到 HTTP 响应头后就 resolve，但实际数据（SSE 首字节 / 完整 JSON）
      // 还没到达。responseTimeoutId 需要延续到 response-handler 中才能真正控制"首字节"或"总耗时"
      const headersDuration = Date.now() - fetchStartTime;
      logger.debug("ProxyForwarder: HTTP headers received", {
        providerId: provider.id,
        providerName: provider.name,
        headersReceivedMs: headersDuration,
        note: "Response timeout continues to monitor body reading",
      });
      // ⚠️ 不要清除 responseTimeoutId！让它继续监控响应体读取
    } catch (fetchError) {
      // ⭐ fetch 失败：清除所有超时定时器
      if (responseTimeoutId) {
        clearTimeout(responseTimeoutId);
      }

      // 捕获 fetch 原始错误（网络错误、DNS 解析失败、连接失败等）
      const err = fetchError as Error & {
        cause?: unknown;
        code?: string; // Node.js 错误码：如 'ENOTFOUND'、'ECONNREFUSED'、'ETIMEDOUT'、'ECONNRESET'
        errno?: number;
        syscall?: string; // 系统调用：如 'getaddrinfo'、'connect'、'read'、'write'
      };

      // ⭐ 超时错误检测（优先级：response > client）

      if (responseController.signal.aborted && !session.clientAbortSignal?.aborted) {
        // 响应超时：HTTP 首包未在规定时间内到达
        // 修复：首字节超时应归类为供应商问题，计入熔断器并直接切换
        logger.error("ProxyForwarder: Response timeout (provider quality issue, will switch)", {
          providerId: provider.id,
          providerName: provider.name,
          responseTimeoutMs,
          responseTimeoutType,
          isStreaming,
          errorName: err.name,
          errorMessage: err.message || "(empty message)",
          reason:
            "First-byte timeout indicates slow provider response, should count towards circuit breaker",
        });

        // 抛出 ProxyError 并设置特殊状态码 524（Cloudflare: A Timeout Occurred）
        // 这样会被归类为 PROVIDER_ERROR，计入熔断器并直接切换供应商
        throw new ProxyError(
          `${responseTimeoutType === "streaming_first_byte" ? "供应商首字节响应超时" : "供应商响应超时"}: ${responseTimeoutMs}ms 内未收到数据`,
          524, // 524 = A Timeout Occurred (Cloudflare standard)
          {
            body: JSON.stringify({
              error: {
                type: "timeout_error",
                message: `Provider failed to respond within ${responseTimeoutMs}ms`,
                timeout_type: responseTimeoutType,
                timeout_ms: responseTimeoutMs,
              },
            }),
            parsed: {
              error: {
                type: "timeout_error",
                message: `Provider failed to respond within ${responseTimeoutMs}ms`,
                timeout_type: responseTimeoutType,
                timeout_ms: responseTimeoutMs,
              },
            },
            providerId: provider.id,
            providerName: provider.name,
          }
        );
      }

      // ⭐ 检测流式静默期超时（streaming_idle）
      if (err.message?.includes("streaming_idle") && !session.clientAbortSignal?.aborted) {
        // 流式静默期超时：首字节之后的连续静默窗口超时
        // 修复：静默期超时也是供应商问题，应计入熔断器
        logger.error(
          "ProxyForwarder: Streaming idle timeout (provider quality issue, will switch)",
          {
            providerId: provider.id,
            providerName: provider.name,
            idleTimeoutMs: provider.streamingIdleTimeoutMs,
            errorName: err.name,
            errorMessage: err.message || "(empty message)",
            reason:
              "Idle timeout indicates provider stopped sending data, should count towards circuit breaker",
          }
        );

        // 抛出 ProxyError（归类为 PROVIDER_ERROR）
        throw new ProxyError(
          `供应商流式响应静默超时: ${provider.streamingIdleTimeoutMs}ms 内未收到新数据`,
          524, // 524 = A Timeout Occurred
          {
            body: JSON.stringify({
              error: {
                type: "streaming_idle_timeout",
                message: `Provider stopped sending data for ${provider.streamingIdleTimeoutMs}ms`,
                timeout_ms: provider.streamingIdleTimeoutMs,
              },
            }),
            parsed: {
              error: {
                type: "streaming_idle_timeout",
                message: `Provider stopped sending data for ${provider.streamingIdleTimeoutMs}ms`,
                timeout_ms: provider.streamingIdleTimeoutMs,
              },
            },
            providerId: provider.id,
            providerName: provider.name,
          }
        );
      }

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
      // HTTP 错误：清除响应超时定时器
      if (responseTimeoutId) {
        clearTimeout(responseTimeoutId);
      }
      throw await ProxyError.fromUpstreamResponse(response, {
        id: provider.id,
        name: provider.name,
      });
    }

    // 将响应超时清理函数和 controller 引用附加到 session，供 response-handler 使用
    // response-handler 会在读到首字节（流式）或完整响应（非流式）后调用此函数
    const sessionWithTimeout = session as ProxySession & {
      clearResponseTimeout?: () => void;
      responseController?: AbortController;
    };

    sessionWithTimeout.clearResponseTimeout = () => {
      if (responseTimeoutId) {
        clearTimeout(responseTimeoutId);
      }
      logger.debug("ProxyForwarder: Response timeout cleared by response-handler", {
        providerId: provider.id,
        responseTimeoutMs,
        responseTimeoutType,
      });
    };

    // 传递 responseController 引用，让 response-handler 能区分超时和客户端中断
    sessionWithTimeout.responseController = responseController;

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

    // Codex 特殊处理：若存在原始 User-Agent 则透传，否则兜底设置
    if (provider.providerType === "codex") {
      const originalUA = session.userAgent;
      overrides["user-agent"] =
        originalUA || "codex_cli_rs/0.55.0 (Mac OS 26.1.0; arm64) vscode/2.0.64";
      logger.debug("ProxyForwarder: Codex provider detected, setting User-Agent", {
        originalUA: session.userAgent ? "provided" : "fallback",
      });
    }

    const headerProcessor = HeaderProcessor.createForProxy({
      blacklist: ["content-length"], // 删除原始 Content-Length，让 fetch 自动计算（转换请求后长度变化）
      overrides,
    });

    return headerProcessor.process(session.headers);
  }
}

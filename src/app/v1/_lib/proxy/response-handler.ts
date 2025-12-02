import { AsyncTaskManager } from "@/lib/async-task-manager";
import { logger } from "@/lib/logger";
import { ProxyStatusTracker } from "@/lib/proxy-status-tracker";
import { RateLimitService } from "@/lib/rate-limit";
import { SessionManager } from "@/lib/session-manager";
import { SessionTracker } from "@/lib/session-tracker";
import { calculateRequestCost } from "@/lib/utils/cost-calculation";
import { parseSSEData } from "@/lib/utils/sse";
import {
  updateMessageRequestCost,
  updateMessageRequestDetails,
  updateMessageRequestDuration,
} from "@/repository/message";
import { findLatestPriceByModel } from "@/repository/model-price";
import { getSystemSettings } from "@/repository/system-config";
import type { SessionUsageUpdate } from "@/types/session";
import { defaultRegistry } from "../converters";
import type { Format, TransformState } from "../converters/types";
import { GeminiAdapter } from "../gemini/adapter";
import type { GeminiResponse } from "../gemini/types";
import { isClientAbortError } from "./errors";
import { mapClientFormatToTransformer, mapProviderTypeToTransformer } from "./format-mapper";
import type { ProxySession } from "./session";

export type UsageMetrics = {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
};

export class ProxyResponseHandler {
  static async dispatch(session: ProxySession, response: Response): Promise<Response> {
    const contentType = response.headers.get("content-type") || "";
    const isSSE = contentType.includes("text/event-stream");

    if (!isSSE) {
      return await ProxyResponseHandler.handleNonStream(session, response);
    }

    return await ProxyResponseHandler.handleStream(session, response);
  }

  private static async handleNonStream(
    session: ProxySession,
    response: Response
  ): Promise<Response> {
    const messageContext = session.messageContext;
    const provider = session.provider;
    if (!provider) {
      return response;
    }

    const responseForLog = response.clone();
    const statusCode = response.status;

    // 检查是否需要格式转换
    const fromFormat: Format | null = provider.providerType
      ? mapProviderTypeToTransformer(provider.providerType)
      : null;
    const toFormat: Format = mapClientFormatToTransformer(session.originalFormat);
    const needsTransform = fromFormat !== toFormat && fromFormat && toFormat;
    let finalResponse = response;

    // --- GEMINI HANDLING ---
    if (provider.providerType === "gemini" || provider.providerType === "gemini-cli") {
      // 判断是否需要透传（客户端和提供商格式都必须是 Gemini）
      const isGeminiPassthrough =
        (session.originalFormat === "gemini" || session.originalFormat === "gemini-cli") &&
        (provider.providerType === "gemini" || provider.providerType === "gemini-cli");

      if (isGeminiPassthrough) {
        logger.debug(
          "[ResponseHandler] Gemini non-stream passthrough (clone for stats, return original)",
          {
            originalFormat: session.originalFormat,
            providerType: provider.providerType,
            model: session.request.model,
            statusCode: response.status,
            reason: "Client receives untouched response, stats read from clone",
          }
        );

        const responseForStats = response.clone();
        const statusCode = response.status;

        const taskId = `non-stream-passthrough-${messageContext?.id || `unknown-${Date.now()}`}`;
        const statsPromise = (async () => {
          try {
            const responseText = await responseForStats.text();

            const sessionWithCleanup = session as typeof session & {
              clearResponseTimeout?: () => void;
            };
            if (sessionWithCleanup.clearResponseTimeout) {
              sessionWithCleanup.clearResponseTimeout();
            }

            // 存储响应体到 Redis（5分钟过期）
            if (session.sessionId) {
              void SessionManager.storeSessionResponse(session.sessionId, responseText).catch(
                (err) => {
                  logger.error("[ResponseHandler] Failed to store response:", err);
                }
              );
            }

            // 使用共享的统计处理方法
            const duration = Date.now() - session.startTime;
            await finalizeRequestStats(session, responseText, statusCode, duration);
          } catch (error) {
            if (!isClientAbortError(error as Error)) {
              logger.error(
                "[ResponseHandler] Gemini non-stream passthrough stats task failed:",
                error
              );
            }
          } finally {
            AsyncTaskManager.cleanup(taskId);
          }
        })();

        AsyncTaskManager.register(taskId, statsPromise, "non-stream-passthrough-stats");
        statsPromise.catch((error) => {
          logger.error(
            "[ResponseHandler] Gemini non-stream passthrough stats task uncaught error:",
            error
          );
        });

        return response;
      } else {
        // ❌ 需要转换：客户端不是 Gemini 格式（如 OpenAI/Claude）
        try {
          const responseForTransform = response.clone();
          const responseText = await responseForTransform.text();
          const responseData = JSON.parse(responseText) as GeminiResponse;

          const transformed = GeminiAdapter.transformResponse(responseData, false);

          logger.debug(
            "[ResponseHandler] Transformed Gemini non-stream response to client format",
            {
              originalFormat: session.originalFormat,
              providerType: provider.providerType,
              model: session.request.model,
            }
          );

          finalResponse = new Response(JSON.stringify(transformed), {
            status: response.status,
            statusText: response.statusText,
            headers: new Headers(response.headers),
          });
        } catch (error) {
          logger.error("[ResponseHandler] Failed to transform Gemini non-stream response:", error);
          finalResponse = response;
        }
      }
    } else if (needsTransform && defaultRegistry.hasResponseTransformer(fromFormat, toFormat)) {
      try {
        // 克隆一份用于转换
        const responseForTransform = response.clone();
        const responseText = await responseForTransform.text();
        const responseData = JSON.parse(responseText) as Record<string, unknown>;

        // 使用转换器注册表进行转换
        const transformed = defaultRegistry.transformNonStreamResponse(
          session.context,
          fromFormat,
          toFormat,
          session.request.model || "",
          session.request.message, // original request
          session.request.message, // transformed request (same as original if no transform)
          responseData
        );

        logger.debug("[ResponseHandler] Transformed non-stream response", {
          from: fromFormat,
          to: toFormat,
          model: session.request.model,
        });

        // 构建新的响应
        finalResponse = new Response(JSON.stringify(transformed), {
          status: response.status,
          statusText: response.statusText,
          headers: new Headers(response.headers),
        });
      } catch (error) {
        logger.error("[ResponseHandler] Failed to transform response:", error);
        // 转换失败时返回原始响应
        finalResponse = response;
      }
    }

    // 使用 AsyncTaskManager 管理后台处理任务
    const taskId = `non-stream-${messageContext?.id || `unknown-${Date.now()}`}`;
    const abortController = new AbortController();

    const processingPromise = (async () => {
      const finalizeNonStreamAbort = async (): Promise<void> => {
        if (messageContext) {
          const duration = Date.now() - session.startTime;
          await updateMessageRequestDuration(messageContext.id, duration);
          await updateMessageRequestDetails(messageContext.id, {
            statusCode: statusCode,
            providerChain: session.getProviderChain(),
            model: session.getCurrentModel() ?? undefined, // ⭐ 更新重定向后的模型
            providerId: session.provider?.id, // ⭐ 更新最终供应商ID（重试切换后）
          });
          const tracker = ProxyStatusTracker.getInstance();
          tracker.endRequest(messageContext.user.id, messageContext.id);
        }

        if (session.sessionId) {
          const sessionUsagePayload: SessionUsageUpdate = {
            status: statusCode >= 200 && statusCode < 300 ? "completed" : "error",
            statusCode: statusCode,
          };

          void SessionManager.updateSessionUsage(session.sessionId, sessionUsagePayload).catch(
            (error: unknown) => {
              logger.error("[ResponseHandler] Failed to update session usage:", error);
            }
          );
        }
      };

      try {
        // 检查客户端是否断开
        if (session.clientAbortSignal?.aborted || abortController.signal.aborted) {
          logger.info("ResponseHandler: Non-stream task cancelled (client disconnected)", {
            taskId,
            providerId: provider.id,
          });
          try {
            await finalizeNonStreamAbort();
          } catch (finalizeError) {
            logger.error("ResponseHandler: Failed to finalize aborted non-stream response", {
              taskId,
              providerId: provider.id,
              finalizeError,
            });
          }
          return;
        }

        // ⭐ 非流式：读取完整响应体（会等待所有数据下载完成）
        const responseText = await responseForLog.text();

        // ⭐ 响应体读取完成：清除响应超时定时器
        const sessionWithCleanup = session as typeof session & {
          clearResponseTimeout?: () => void;
        };
        if (sessionWithCleanup.clearResponseTimeout) {
          sessionWithCleanup.clearResponseTimeout();
        }
        let usageRecord: Record<string, unknown> | null = null;
        let usageMetrics: UsageMetrics | null = null;

        const usageResult = parseUsageFromResponseText(responseText, provider.providerType);
        usageRecord = usageResult.usageRecord;
        usageMetrics = usageResult.usageMetrics;

        // Codex: Extract prompt_cache_key and update session binding
        if (provider.providerType === "codex" && session.sessionId && provider.id) {
          try {
            const responseData = JSON.parse(responseText) as Record<string, unknown>;
            const promptCacheKey = SessionManager.extractCodexPromptCacheKey(responseData);
            if (promptCacheKey) {
              void SessionManager.updateSessionWithCodexCacheKey(
                session.sessionId,
                promptCacheKey,
                provider.id
              ).catch((err) => {
                logger.error("[ResponseHandler] Failed to update Codex session:", err);
              });
            }
          } catch (parseError) {
            logger.trace("[ResponseHandler] Failed to parse JSON for Codex session:", parseError);
          }
        }

        // 存储响应体到 Redis（5分钟过期）
        if (session.sessionId) {
          void SessionManager.storeSessionResponse(session.sessionId, responseText).catch((err) => {
            logger.error("[ResponseHandler] Failed to store response:", err);
          });
        }

        if (usageRecord && usageMetrics && messageContext) {
          await updateRequestCostFromUsage(
            messageContext.id,
            session.getOriginalModel(),
            session.getCurrentModel(),
            usageMetrics,
            provider.costMultiplier
          );

          // 追踪消费到 Redis（用于限流）
          await trackCostToRedis(session, usageMetrics);
        }

        // 更新 session 使用量到 Redis（用于实时监控）
        if (session.sessionId && usageMetrics) {
          // 计算成本（复用相同逻辑）
          let costUsdStr: string | undefined;
          if (session.request.model) {
            const priceData = await findLatestPriceByModel(session.request.model);
            if (priceData?.priceData) {
              const cost = calculateRequestCost(
                usageMetrics,
                priceData.priceData,
                provider.costMultiplier
              );
              if (cost.gt(0)) {
                costUsdStr = cost.toString();
              }
            }
          }

          void SessionManager.updateSessionUsage(session.sessionId, {
            inputTokens: usageMetrics.input_tokens,
            outputTokens: usageMetrics.output_tokens,
            cacheCreationInputTokens: usageMetrics.cache_creation_input_tokens,
            cacheReadInputTokens: usageMetrics.cache_read_input_tokens,
            costUsd: costUsdStr,
            status: statusCode >= 200 && statusCode < 300 ? "completed" : "error",
            statusCode: statusCode,
          }).catch((error: unknown) => {
            logger.error("[ResponseHandler] Failed to update session usage:", error);
          });
        }

        if (messageContext) {
          const duration = Date.now() - session.startTime;
          await updateMessageRequestDuration(messageContext.id, duration);

          // 保存扩展信息（status code, tokens, provider chain）
          await updateMessageRequestDetails(messageContext.id, {
            statusCode: statusCode,
            inputTokens: usageMetrics?.input_tokens,
            outputTokens: usageMetrics?.output_tokens,
            cacheCreationInputTokens: usageMetrics?.cache_creation_input_tokens,
            cacheReadInputTokens: usageMetrics?.cache_read_input_tokens,
            providerChain: session.getProviderChain(),
            model: session.getCurrentModel() ?? undefined, // ⭐ 更新重定向后的模型
            providerId: session.provider?.id, // ⭐ 更新最终供应商ID（重试切换后）
          });

          // 记录请求结束
          const tracker = ProxyStatusTracker.getInstance();
          tracker.endRequest(messageContext.user.id, messageContext.id);
        }

        logger.debug("ResponseHandler: Non-stream response processed", {
          taskId,
          providerId: provider.id,
          providerName: provider.name,
          statusCode,
        });
      } catch (error) {
        // 检测 AbortError 的来源：响应超时 vs 客户端中断
        const err = error as Error;
        if (isClientAbortError(err)) {
          // 获取 responseController 引用（由 forwarder.ts 传递）
          const sessionWithController = session as typeof session & {
            responseController?: AbortController;
          };

          // 区分超时和客户端中断
          const isResponseTimeout =
            sessionWithController.responseController?.signal.aborted &&
            !session.clientAbortSignal?.aborted;

          if (isResponseTimeout) {
            // ⚠️ 响应超时：计入熔断器并记录错误日志
            logger.error("ResponseHandler: Response timeout during non-stream body read", {
              taskId,
              providerId: provider.id,
              providerName: provider.name,
              errorName: err.name,
            });

            // 计入熔断器（动态导入避免循环依赖）
            try {
              const { recordFailure } = await import("@/lib/circuit-breaker");
              await recordFailure(provider.id, err);
              logger.debug("ResponseHandler: Response timeout recorded in circuit breaker", {
                providerId: provider.id,
              });
            } catch (cbError) {
              logger.warn("ResponseHandler: Failed to record timeout in circuit breaker", {
                providerId: provider.id,
                error: cbError,
              });
            }

            // 注意：无法重试，因为客户端已收到 HTTP 200
            // 错误已记录，熔断器已更新，不抛出异常（避免影响后台任务）

            // 更新数据库记录（避免 orphan record）
            await persistRequestFailure({
              session,
              messageContext,
              statusCode: statusCode && statusCode >= 400 ? statusCode : 502,
              error: err,
              taskId,
              phase: "non-stream",
            });

            // 执行清理逻辑
            try {
              await finalizeNonStreamAbort();
            } catch (finalizeError) {
              logger.error("ResponseHandler: Failed to finalize aborted non-stream response", {
                taskId,
                providerId: provider.id,
                finalizeError,
              });
            }
          } else {
            // 客户端主动中断：正常日志，不抛出错误
            logger.warn("ResponseHandler: Non-stream processing aborted by client", {
              taskId,
              providerId: provider.id,
              providerName: provider.name,
              errorName: err.name,
              reason:
                err.name === "ResponseAborted"
                  ? "Response transmission interrupted"
                  : "Client disconnected",
            });
            try {
              await finalizeNonStreamAbort();
            } catch (finalizeError) {
              logger.error("ResponseHandler: Failed to finalize aborted non-stream response", {
                taskId,
                providerId: provider.id,
                finalizeError,
              });
            }
          }
        } else {
          logger.error("Failed to handle non-stream log:", error);

          // 更新数据库记录（避免 orphan record）
          await persistRequestFailure({
            session,
            messageContext,
            statusCode: statusCode && statusCode >= 400 ? statusCode : 500,
            error,
            taskId,
            phase: "non-stream",
          });
        }
      } finally {
        AsyncTaskManager.cleanup(taskId);
      }
    })();

    // 注册任务并添加全局错误捕获
    AsyncTaskManager.register(taskId, processingPromise, "non-stream-processing");
    processingPromise.catch(async (error) => {
      logger.error("ResponseHandler: Uncaught error in non-stream processing", {
        taskId,
        error,
      });

      // 更新数据库记录（避免 orphan record）
      await persistRequestFailure({
        session,
        messageContext,
        statusCode: statusCode && statusCode >= 400 ? statusCode : 500,
        error,
        taskId,
        phase: "non-stream",
      });
    });

    // 客户端断开时取消任务
    if (session.clientAbortSignal) {
      session.clientAbortSignal.addEventListener("abort", () => {
        AsyncTaskManager.cancel(taskId);
        abortController.abort();
      });
    }

    return finalResponse;
  }

  private static async handleStream(session: ProxySession, response: Response): Promise<Response> {
    const messageContext = session.messageContext;
    const provider = session.provider;

    if (!messageContext || !provider || !response.body) {
      return response;
    }

    // 检查是否需要格式转换
    const fromFormat: Format | null = provider.providerType
      ? mapProviderTypeToTransformer(provider.providerType)
      : null;
    const toFormat: Format = mapClientFormatToTransformer(session.originalFormat);
    const needsTransform = fromFormat !== toFormat && fromFormat && toFormat;
    let processedStream: ReadableStream<Uint8Array> = response.body;

    // --- GEMINI STREAM HANDLING ---
    if (provider.providerType === "gemini" || provider.providerType === "gemini-cli") {
      // 判断是否需要透传（客户端和提供商格式都必须是 Gemini）
      const isGeminiPassthrough =
        (session.originalFormat === "gemini" || session.originalFormat === "gemini-cli") &&
        (provider.providerType === "gemini" || provider.providerType === "gemini-cli");

      if (isGeminiPassthrough) {
        // 完全透传：clone 用于后台统计，返回原始 response
        logger.debug(
          "[ResponseHandler] Gemini stream passthrough (clone for stats, return original)",
          {
            originalFormat: session.originalFormat,
            providerType: provider.providerType,
            model: session.request.model,
            statusCode: response.status,
            reason: "Client receives untouched response, stats read from clone",
          }
        );

        const responseForStats = response.clone();
        const statusCode = response.status;

        const taskId = `stream-passthrough-${messageContext.id}`;
        const statsPromise = (async () => {
          try {
            const reader = responseForStats.body?.getReader();
            if (!reader) return;

            const chunks: string[] = [];
            const decoder = new TextDecoder();

            while (true) {
              if (session.clientAbortSignal?.aborted) break;

              const { done, value } = await reader.read();
              if (done) break;
              if (value) {
                chunks.push(decoder.decode(value, { stream: true }));
              }
            }

            const flushed = decoder.decode();
            if (flushed) chunks.push(flushed);
            const allContent = chunks.join("");

            // 存储响应体到 Redis（5分钟过期）
            if (session.sessionId) {
              void SessionManager.storeSessionResponse(session.sessionId, allContent).catch(
                (err) => {
                  logger.error(
                    "[ResponseHandler] Failed to store stream passthrough response:",
                    err
                  );
                }
              );
            }

            // 使用共享的统计处理方法
            const duration = Date.now() - session.startTime;
            await finalizeRequestStats(session, allContent, statusCode, duration);
          } catch (error) {
            if (!isClientAbortError(error as Error)) {
              logger.error("[ResponseHandler] Gemini passthrough stats task failed:", error);
            }
          } finally {
            AsyncTaskManager.cleanup(taskId);
          }
        })();

        AsyncTaskManager.register(taskId, statsPromise, "stream-passthrough-stats");
        statsPromise.catch((error) => {
          logger.error("[ResponseHandler] Gemini passthrough stats task uncaught error:", error);
        });

        return response;
      } else {
        // ❌ 需要转换：客户端不是 Gemini 格式（如 OpenAI/Claude）
        logger.debug("[ResponseHandler] Transforming Gemini stream to client format", {
          originalFormat: session.originalFormat,
          providerType: provider.providerType,
          model: session.request.model,
        });

        let buffer = "";
        const transformStream = new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            const decoder = new TextDecoder();
            const text = decoder.decode(chunk, { stream: true });
            buffer += text;

            const lines = buffer.split("\n");
            // Keep the last line in buffer as it might be incomplete
            buffer = lines.pop() || "";

            for (const line of lines) {
              const trimmedLine = line.trim();
              if (trimmedLine.startsWith("data:")) {
                const jsonStr = trimmedLine.slice(5).trim();
                if (!jsonStr) continue;
                try {
                  const geminiResponse = JSON.parse(jsonStr) as GeminiResponse;
                  const openAIChunk = GeminiAdapter.transformResponse(geminiResponse, true);
                  const output = `data: ${JSON.stringify(openAIChunk)}\n\n`;
                  controller.enqueue(new TextEncoder().encode(output));
                } catch {
                  // Ignore parse errors
                }
              }
            }
          },
          flush(controller) {
            if (buffer.trim().startsWith("data:")) {
              try {
                const jsonStr = buffer.trim().slice(5).trim();
                const geminiResponse = JSON.parse(jsonStr) as GeminiResponse;
                const openAIChunk = GeminiAdapter.transformResponse(geminiResponse, true);
                const output = `data: ${JSON.stringify(openAIChunk)}\n\n`;
                controller.enqueue(new TextEncoder().encode(output));
              } catch {}
            }
          },
        });
        processedStream = response.body.pipeThrough(transformStream);
      }
    } else if (needsTransform && defaultRegistry.hasResponseTransformer(fromFormat, toFormat)) {
      logger.debug("[ResponseHandler] Transforming stream response", {
        from: fromFormat,
        to: toFormat,
        model: session.request.model,
      });

      // 创建转换流
      const transformState: TransformState = {}; // 状态对象，用于在多个 chunk 之间保持状态
      const transformStream = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          try {
            const decoder = new TextDecoder();
            const text = decoder.decode(chunk, { stream: true });

            // 使用转换器注册表转换 chunk
            const transformedChunks = defaultRegistry.transformStreamResponse(
              session.context,
              fromFormat,
              toFormat,
              session.request.model || "",
              session.request.message, // original request
              session.request.message, // transformed request (same as original if no transform)
              text,
              transformState
            );

            // transformedChunks 是字符串数组
            for (const transformedChunk of transformedChunks) {
              if (transformedChunk) {
                controller.enqueue(new TextEncoder().encode(transformedChunk));
              }
            }
          } catch (error) {
            logger.error("[ResponseHandler] Stream transform error:", error);
            // 出错时传递原始 chunk
            controller.enqueue(chunk);
          }
        },
      });

      processedStream = response.body.pipeThrough(transformStream) as ReadableStream<Uint8Array>;
    }

    // ⭐ 使用 TransformStream 包装流，以便在 idle timeout 时能关闭客户端流
    // 这解决了 tee() 后 internalStream abort 不影响 clientStream 的问题
    let streamController: TransformStreamDefaultController<Uint8Array> | null = null;
    const controllableStream = processedStream.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        start(controller) {
          streamController = controller; // 保存 controller 引用
        },
        transform(chunk, controller) {
          controller.enqueue(chunk); // 透传数据
        },
      })
    );

    const [clientStream, internalStream] = controllableStream.tee();
    const statusCode = response.status;

    // 使用 AsyncTaskManager 管理后台处理任务
    const taskId = `stream-${messageContext.id}`;
    const abortController = new AbortController();

    // ⭐ 提升 idleTimeoutId 到外部作用域，以便客户端断开时能清除
    let idleTimeoutId: NodeJS.Timeout | null = null;

    const processingPromise = (async () => {
      const reader = internalStream.getReader();
      const decoder = new TextDecoder();
      const chunks: string[] = [];
      let usageForCost: UsageMetrics | null = null;
      let isFirstChunk = true; // ⭐ 标记是否为第一块数据

      // ⭐ 静默期 Watchdog：监控流式请求中途卡住（无新数据推送）
      const idleTimeoutMs =
        provider.streamingIdleTimeoutMs > 0 ? provider.streamingIdleTimeoutMs : Infinity;
      const startIdleTimer = () => {
        if (idleTimeoutMs === Infinity) return; // 禁用时跳过
        clearIdleTimer(); // 清除旧的
        idleTimeoutId = setTimeout(() => {
          logger.warn("ResponseHandler: Streaming idle timeout triggered", {
            taskId,
            providerId: provider.id,
            idleTimeoutMs,
            chunksCollected: chunks.length,
          });

          // ⭐ 1. 关闭客户端流（让客户端收到连接关闭通知，避免悬挂）
          try {
            if (streamController) {
              streamController.error(new Error("Streaming idle timeout"));
              logger.debug("ResponseHandler: Client stream closed due to idle timeout", {
                taskId,
                providerId: provider.id,
              });
            }
          } catch (e) {
            logger.warn("ResponseHandler: Failed to close client stream", {
              taskId,
              providerId: provider.id,
              error: e,
            });
          }

          // ⭐ 2. 终止上游连接（避免资源泄漏）
          try {
            const sessionWithController = session as typeof session & {
              responseController?: AbortController;
            };
            if (sessionWithController.responseController) {
              sessionWithController.responseController.abort(new Error("streaming_idle"));
              logger.debug("ResponseHandler: Upstream connection aborted due to idle timeout", {
                taskId,
                providerId: provider.id,
              });
            }
          } catch (e) {
            logger.warn("ResponseHandler: Failed to abort upstream connection", {
              taskId,
              providerId: provider.id,
              error: e,
            });
          }

          // ⭐ 3. 终止后台读取任务
          abortController.abort(new Error("streaming_idle"));
        }, idleTimeoutMs);
      };
      const clearIdleTimer = () => {
        if (idleTimeoutId) {
          clearTimeout(idleTimeoutId);
          idleTimeoutId = null;
        }
      };

      // ⭐ 不在首次读取前启动 idle timer（避免与首字节超时职责重叠）
      // idle timer 仅在首块数据到达后启动，用于检测流中途静默

      const flushAndJoin = (): string => {
        const flushed = decoder.decode();
        if (flushed) {
          chunks.push(flushed);
        }
        return chunks.join("");
      };

      const finalizeStream = async (allContent: string): Promise<void> => {
        // 存储响应体到 Redis（5分钟过期）
        if (session.sessionId) {
          void SessionManager.storeSessionResponse(session.sessionId, allContent).catch((err) => {
            logger.error("[ResponseHandler] Failed to store stream response:", err);
          });
        }

        const duration = Date.now() - session.startTime;
        await updateMessageRequestDuration(messageContext.id, duration);

        const tracker = ProxyStatusTracker.getInstance();
        tracker.endRequest(messageContext.user.id, messageContext.id);

        const usageResult = parseUsageFromResponseText(allContent, provider.providerType);
        usageForCost = usageResult.usageMetrics;

        // Codex: Extract prompt_cache_key from SSE events and update session binding
        if (provider.providerType === "codex" && session.sessionId && provider.id) {
          try {
            const sseEvents = parseSSEData(allContent);
            for (const event of sseEvents) {
              if (typeof event.data === "object" && event.data) {
                const promptCacheKey = SessionManager.extractCodexPromptCacheKey(
                  event.data as Record<string, unknown>
                );
                if (promptCacheKey) {
                  void SessionManager.updateSessionWithCodexCacheKey(
                    session.sessionId,
                    promptCacheKey,
                    provider.id
                  ).catch((err) => {
                    logger.error("[ResponseHandler] Failed to update Codex session (stream):", err);
                  });
                  break; // Only need first prompt_cache_key
                }
              }
            }
          } catch (parseError) {
            logger.trace("[ResponseHandler] Failed to parse SSE for Codex session:", parseError);
          }
        }

        await updateRequestCostFromUsage(
          messageContext.id,
          session.getOriginalModel(),
          session.getCurrentModel(),
          usageForCost,
          provider.costMultiplier
        );

        // 追踪消费到 Redis（用于限流）
        await trackCostToRedis(session, usageForCost);

        // 更新 session 使用量到 Redis（用于实时监控）
        if (session.sessionId && usageForCost) {
          let costUsdStr: string | undefined;
          if (session.request.model) {
            const priceData = await findLatestPriceByModel(session.request.model);
            if (priceData?.priceData) {
              const cost = calculateRequestCost(
                usageForCost,
                priceData.priceData,
                provider.costMultiplier
              );
              if (cost.gt(0)) {
                costUsdStr = cost.toString();
              }
            }
          }

          void SessionManager.updateSessionUsage(session.sessionId, {
            inputTokens: usageForCost.input_tokens,
            outputTokens: usageForCost.output_tokens,
            cacheCreationInputTokens: usageForCost.cache_creation_input_tokens,
            cacheReadInputTokens: usageForCost.cache_read_input_tokens,
            costUsd: costUsdStr,
            status: statusCode >= 200 && statusCode < 300 ? "completed" : "error",
            statusCode: statusCode,
          }).catch((error: unknown) => {
            logger.error("[ResponseHandler] Failed to update session usage:", error);
          });
        }

        // 保存扩展信息（status code, tokens, provider chain）
        await updateMessageRequestDetails(messageContext.id, {
          statusCode: statusCode,
          inputTokens: usageForCost?.input_tokens,
          outputTokens: usageForCost?.output_tokens,
          cacheCreationInputTokens: usageForCost?.cache_creation_input_tokens,
          cacheReadInputTokens: usageForCost?.cache_read_input_tokens,
          providerChain: session.getProviderChain(),
          model: session.getCurrentModel() ?? undefined, // ⭐ 更新重定向后的模型
          providerId: session.provider?.id, // ⭐ 更新最终供应商ID（重试切换后）
        });
      };

      try {
        while (true) {
          // 检查取消信号
          if (session.clientAbortSignal?.aborted || abortController.signal.aborted) {
            logger.info("ResponseHandler: Stream processing cancelled", {
              taskId,
              providerId: provider.id,
              chunksCollected: chunks.length,
            });
            break; // 提前终止
          }

          const { value, done } = await reader.read();
          if (done) {
            break;
          }
          if (value) {
            const chunkSize = value.length;
            chunks.push(decoder.decode(value, { stream: true }));

            // ⭐ 每次收到数据后重置静默期计时器（首次收到数据时启动）
            startIdleTimer();
            logger.trace("ResponseHandler: Idle timer reset (data received)", {
              taskId,
              providerId: provider.id,
              chunksCollected: chunks.length,
              lastChunkSize: chunkSize,
              idleTimeoutMs: idleTimeoutMs === Infinity ? "disabled" : idleTimeoutMs,
            });

            // ⭐ 流式：读到第一块数据后立即清除响应超时定时器
            if (isFirstChunk) {
              isFirstChunk = false;
              const sessionWithCleanup = session as typeof session & {
                clearResponseTimeout?: () => void;
              };
              if (sessionWithCleanup.clearResponseTimeout) {
                sessionWithCleanup.clearResponseTimeout();
                logger.debug("ResponseHandler: First chunk received, response timeout cleared", {
                  taskId,
                  providerId: provider.id,
                  firstChunkSize: chunkSize,
                });
              }
            }
          }
        }

        // ⭐ 流式读取完成：清除静默期计时器
        clearIdleTimer();
        const allContent = flushAndJoin();
        await finalizeStream(allContent);
      } catch (error) {
        // 检测 AbortError 的来源：响应超时 vs 静默期超时 vs 客户端/上游中断
        const err = error as Error;
        const sessionWithController = session as typeof session & {
          responseController?: AbortController;
        };
        const clientAborted = session.clientAbortSignal?.aborted ?? false;
        const isResponseControllerAborted =
          sessionWithController.responseController?.signal.aborted ?? false;

        if (isClientAbortError(err)) {
          // 区分不同的超时来源
          const isResponseTimeout = isResponseControllerAborted && !clientAborted;
          const isIdleTimeout = err.message?.includes("streaming_idle");

          if (isResponseTimeout && !isIdleTimeout) {
            // ⚠️ 响应超时（首字节超时）：计入熔断器并记录错误日志
            logger.error("ResponseHandler: Response timeout during stream body read", {
              taskId,
              providerId: provider.id,
              providerName: provider.name,
              messageId: messageContext.id,
              chunksCollected: chunks.length,
              errorName: err.name,
            });

            // ⚠️ 计入熔断器（动态导入避免循环依赖）
            try {
              const { recordFailure } = await import("@/lib/circuit-breaker");
              await recordFailure(provider.id, err);
              logger.debug("ResponseHandler: Response timeout recorded in circuit breaker", {
                providerId: provider.id,
              });
            } catch (cbError) {
              logger.warn("ResponseHandler: Failed to record timeout in circuit breaker", {
                providerId: provider.id,
                error: cbError,
              });
            }

            // 注意：无法重试，因为客户端已收到 HTTP 200
            // 错误已记录，熔断器已更新，不抛出异常（避免影响后台任务）

            // 更新数据库记录（避免 orphan record）
            await persistRequestFailure({
              session,
              messageContext,
              statusCode: statusCode && statusCode >= 400 ? statusCode : 502,
              error: err,
              taskId,
              phase: "stream",
            });
          } else if (isIdleTimeout) {
            // ⚠️ 静默期超时：计入熔断器并记录错误日志
            logger.error("ResponseHandler: Streaming idle timeout", {
              taskId,
              providerId: provider.id,
              providerName: provider.name,
              messageId: messageContext.id,
              chunksCollected: chunks.length,
            });

            // ⚠️ 计入熔断器（动态导入避免循环依赖）
            try {
              const { recordFailure } = await import("@/lib/circuit-breaker");
              await recordFailure(provider.id, err);
              logger.debug("ResponseHandler: Streaming idle timeout recorded in circuit breaker", {
                providerId: provider.id,
              });
            } catch (cbError) {
              logger.warn("ResponseHandler: Failed to record timeout in circuit breaker", {
                providerId: provider.id,
                error: cbError,
              });
            }

            // 注意：无法重试，因为客户端已收到 HTTP 200
            // 错误已记录，熔断器已更新，不抛出异常（避免影响后台任务）

            // 更新数据库记录（避免 orphan record - 这是导致 185 个孤儿记录的根本原因！）
            await persistRequestFailure({
              session,
              messageContext,
              statusCode: statusCode && statusCode >= 400 ? statusCode : 502,
              error: err,
              taskId,
              phase: "stream",
            });
          } else if (!clientAborted) {
            // 上游在流式过程中意外中断：视为供应商/网络错误
            logger.error("ResponseHandler: Upstream stream aborted unexpectedly", {
              taskId,
              providerId: provider.id,
              providerName: provider.name,
              messageId: messageContext.id,
              chunksCollected: chunks.length,
              errorName: err.name,
              errorMessage: err.message || "(empty message)",
            });

            await persistRequestFailure({
              session,
              messageContext,
              statusCode: 502,
              error: err,
              taskId,
              phase: "stream",
            });
          } else {
            // 客户端主动中断：正常日志，不抛出错误
            logger.warn("ResponseHandler: Stream reading aborted by client", {
              taskId,
              providerId: provider.id,
              providerName: provider.name,
              messageId: messageContext.id,
              chunksCollected: chunks.length,
              errorName: err.name,
              reason:
                err.name === "ResponseAborted"
                  ? "Response transmission interrupted"
                  : "Client disconnected",
            });
            try {
              const allContent = flushAndJoin();
              await finalizeStream(allContent);
            } catch (finalizeError) {
              logger.error("ResponseHandler: Failed to finalize aborted stream response", {
                taskId,
                messageId: messageContext.id,
                finalizeError,
              });
            }
          }
        } else {
          logger.error("Failed to save SSE content:", error);

          // 更新数据库记录（避免 orphan record）
          await persistRequestFailure({
            session,
            messageContext,
            statusCode: statusCode && statusCode >= 400 ? statusCode : 500,
            error,
            taskId,
            phase: "stream",
          });
        }
      } finally {
        // 确保资源释放
        clearIdleTimer(); // ⭐ 清除静默期计时器（防止泄漏）
        try {
          reader.releaseLock();
        } catch (releaseError) {
          logger.warn("Failed to release reader lock", { taskId, releaseError });
        }
        AsyncTaskManager.cleanup(taskId);
      }
    })();

    // 注册任务并添加全局错误捕获
    AsyncTaskManager.register(taskId, processingPromise, "stream-processing");
    processingPromise.catch(async (error) => {
      logger.error("ResponseHandler: Uncaught error in stream processing", {
        taskId,
        messageId: messageContext.id,
        error,
      });

      // 更新数据库记录（避免 orphan record）
      await persistRequestFailure({
        session,
        messageContext,
        statusCode: statusCode && statusCode >= 400 ? statusCode : 500,
        error,
        taskId,
        phase: "stream",
      });
    });

    // 客户端断开时取消任务并清除 idle timer
    if (session.clientAbortSignal) {
      session.clientAbortSignal.addEventListener("abort", () => {
        logger.debug("ResponseHandler: Client disconnected, cleaning up", {
          taskId,
          providerId: provider.id,
          messageId: messageContext.id,
        });

        // ⭐ 1. 清除 idle timeout（避免误触发）
        if (idleTimeoutId) {
          clearTimeout(idleTimeoutId);
          idleTimeoutId = null;
          logger.debug("ResponseHandler: Idle timeout cleared due to client disconnect", {
            taskId,
            providerId: provider.id,
          });
        }

        // 2. 取消后台任务
        AsyncTaskManager.cancel(taskId);
        abortController.abort();

        // 注意：不需要 streamController.error()（客户端已断开）
        // 注意：不需要 responseController.abort()（上游会自然结束）
      });
    }

    return new Response(clientStream, {
      status: response.status,
      statusText: response.statusText,
      headers: new Headers(response.headers),
    });
  }
}

function extractUsageMetrics(value: unknown): UsageMetrics | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const usage = value as Record<string, unknown>;
  const result: UsageMetrics = {};
  let hasAny = false;

  if (typeof usage.input_tokens === "number") {
    result.input_tokens = usage.input_tokens;
    hasAny = true;
  }

  // Gemini support
  if (typeof usage.promptTokenCount === "number") {
    result.input_tokens = usage.promptTokenCount;
    hasAny = true;
  }
  if (typeof usage.candidatesTokenCount === "number") {
    result.output_tokens = usage.candidatesTokenCount;
    hasAny = true;
  }
  // Gemini 缓存支持
  if (typeof usage.cachedContentTokenCount === "number") {
    result.cache_read_input_tokens = usage.cachedContentTokenCount;
    hasAny = true;
  }

  if (typeof usage.output_tokens === "number") {
    result.output_tokens = usage.output_tokens;
    hasAny = true;
  }

  if (typeof usage.cache_creation_input_tokens === "number") {
    result.cache_creation_input_tokens = usage.cache_creation_input_tokens;
    hasAny = true;
  }

  // Claude 格式：顶层 cache_read_input_tokens（扁平结构）
  if (typeof usage.cache_read_input_tokens === "number") {
    result.cache_read_input_tokens = usage.cache_read_input_tokens;
    hasAny = true;
  }

  // OpenAI Response API 格式：input_tokens_details.cached_tokens（嵌套结构）
  // 仅在顶层字段不存在时使用（避免重复计算）
  if (!result.cache_read_input_tokens) {
    const inputTokensDetails = usage.input_tokens_details as Record<string, unknown> | undefined;
    if (inputTokensDetails && typeof inputTokensDetails.cached_tokens === "number") {
      result.cache_read_input_tokens = inputTokensDetails.cached_tokens;
      hasAny = true;
      logger.debug("[UsageMetrics] Extracted cached tokens from OpenAI Response API format", {
        cachedTokens: inputTokensDetails.cached_tokens,
      });
    }
  }

  return hasAny ? result : null;
}

function parseUsageFromResponseText(
  responseText: string,
  providerType: string | null | undefined
): {
  usageRecord: Record<string, unknown> | null;
  usageMetrics: UsageMetrics | null;
} {
  let usageRecord: Record<string, unknown> | null = null;
  let usageMetrics: UsageMetrics | null = null;

  const applyUsageValue = (value: unknown, source: string) => {
    if (usageMetrics) {
      return;
    }

    if (!value || typeof value !== "object") {
      return;
    }

    const extracted = extractUsageMetrics(value);
    if (!extracted) {
      return;
    }

    usageRecord = value as Record<string, unknown>;
    usageMetrics = adjustUsageForProviderType(extracted, providerType);

    logger.debug("[ResponseHandler] Parsed usage from response", {
      source,
      providerType,
      usage: usageMetrics,
    });
  };

  try {
    const parsedValue = JSON.parse(responseText);

    if (parsedValue && typeof parsedValue === "object" && !Array.isArray(parsedValue)) {
      const parsed = parsedValue as Record<string, unknown>;

      // Standard usage fields
      applyUsageValue(parsed.usage, "json.root.usage");

      // Gemini usageMetadata (direct)
      applyUsageValue(parsed.usageMetadata, "json.root.usageMetadata");

      // Handle response wrapping (some Gemini providers return {response: {...}})
      if (parsed.response && typeof parsed.response === "object") {
        const responseObj = parsed.response as Record<string, unknown>;
        applyUsageValue(responseObj.usage, "json.response.usage");
        applyUsageValue(responseObj.usageMetadata, "json.response.usageMetadata");
      }

      if (Array.isArray(parsed.output)) {
        for (const item of parsed.output as Array<Record<string, unknown>>) {
          if (!item || typeof item !== "object") {
            continue;
          }
          applyUsageValue(item.usage, "json.output");
        }
      }
    }

    if (!usageMetrics && Array.isArray(parsedValue)) {
      for (const item of parsedValue) {
        if (!item || typeof item !== "object") {
          continue;
        }

        const record = item as Record<string, unknown>;
        applyUsageValue(record.usage, "json.array");

        if (record.data && typeof record.data === "object") {
          applyUsageValue((record.data as Record<string, unknown>).usage, "json.array.data");
        }
      }
    }
  } catch {
    // Fallback to SSE parsing when body is not valid JSON
  }

  // SSE 解析：支持两种格式
  // 1. 标准 SSE (event: + data:) - Claude/OpenAI
  // 2. 纯 data: 格式 - Gemini
  if (!usageMetrics && responseText.includes("data:")) {
    const events = parseSSEData(responseText);
    for (const event of events) {
      if (usageMetrics) {
        break;
      }

      if (typeof event.data !== "object" || !event.data) {
        continue;
      }

      const data = event.data as Record<string, unknown>;

      // Standard usage fields
      applyUsageValue(data.usage, `sse.${event.event}.usage`);

      // Gemini usageMetadata
      applyUsageValue(data.usageMetadata, `sse.${event.event}.usageMetadata`);

      // Handle response wrapping in SSE
      if (!usageMetrics && data.response && typeof data.response === "object") {
        const responseObj = data.response as Record<string, unknown>;
        applyUsageValue(responseObj.usage, `sse.${event.event}.response.usage`);
        applyUsageValue(responseObj.usageMetadata, `sse.${event.event}.response.usageMetadata`);
      }
    }
  }

  return { usageRecord, usageMetrics };
}

function adjustUsageForProviderType(
  usage: UsageMetrics,
  providerType: string | null | undefined
): UsageMetrics {
  if (providerType !== "codex") {
    return usage;
  }

  const cachedTokens = usage.cache_read_input_tokens;
  const inputTokens = usage.input_tokens;

  if (typeof cachedTokens !== "number" || typeof inputTokens !== "number") {
    return usage;
  }

  const adjustedInput = Math.max(inputTokens - cachedTokens, 0);
  if (adjustedInput === inputTokens) {
    return usage;
  }

  logger.debug("[UsageMetrics] Adjusted codex input tokens to exclude cached tokens", {
    providerType,
    originalInputTokens: inputTokens,
    cachedTokens,
    adjustedInputTokens: adjustedInput,
  });

  return {
    ...usage,
    input_tokens: adjustedInput,
  };
}

async function updateRequestCostFromUsage(
  messageId: number,
  originalModel: string | null,
  redirectedModel: string | null,
  usage: UsageMetrics | null,
  costMultiplier: number = 1.0
): Promise<void> {
  if (!usage) {
    logger.warn("[CostCalculation] No usage data, skipping cost update", { messageId });
    return;
  }

  if (!originalModel && !redirectedModel) {
    logger.warn("[CostCalculation] No model name available", { messageId });
    return;
  }

  // 获取系统设置中的计费模型来源配置
  const systemSettings = await getSystemSettings();
  const billingModelSource = systemSettings.billingModelSource;

  // 根据配置决定计费模型优先级
  let primaryModel: string | null;
  let fallbackModel: string | null;

  if (billingModelSource === "original") {
    // 优先使用重定向前的原始模型
    primaryModel = originalModel;
    fallbackModel = redirectedModel;
  } else {
    // 优先使用重定向后的实际模型
    primaryModel = redirectedModel;
    fallbackModel = originalModel;
  }

  logger.debug("[CostCalculation] Billing model source config", {
    messageId,
    billingModelSource,
    primaryModel,
    fallbackModel,
  });

  // Fallback 逻辑：优先主要模型，找不到则用备选模型
  let priceData = null;
  let usedModelForPricing = null;

  // Step 1: 尝试主要模型
  if (primaryModel) {
    priceData = await findLatestPriceByModel(primaryModel);
    if (priceData?.priceData) {
      usedModelForPricing = primaryModel;
      logger.debug("[CostCalculation] Using primary model for pricing", {
        messageId,
        model: primaryModel,
        billingModelSource,
      });
    }
  }

  // Step 2: Fallback 到备选模型
  if (!priceData && fallbackModel && fallbackModel !== primaryModel) {
    priceData = await findLatestPriceByModel(fallbackModel);
    if (priceData?.priceData) {
      usedModelForPricing = fallbackModel;
      logger.warn("[CostCalculation] Primary model price not found, using fallback model", {
        messageId,
        primaryModel,
        fallbackModel,
        billingModelSource,
      });
    }
  }

  // Step 3: 完全失败
  if (!priceData?.priceData) {
    logger.error("[CostCalculation] No price data found for any model", {
      messageId,
      originalModel,
      redirectedModel,
      billingModelSource,
      note: "Cost will be $0. Please check price table or model name.",
    });
    return;
  }

  // 计算费用
  const cost = calculateRequestCost(usage, priceData.priceData, costMultiplier);

  logger.info("[CostCalculation] Cost calculated successfully", {
    messageId,
    usedModelForPricing,
    billingModelSource,
    costUsd: cost.toString(),
    costMultiplier,
    usage,
  });

  if (cost.gt(0)) {
    await updateMessageRequestCost(messageId, cost);
  } else {
    logger.warn("[CostCalculation] Calculated cost is zero or negative", {
      messageId,
      usedModelForPricing,
      costUsd: cost.toString(),
      priceData: {
        inputCost: priceData.priceData.input_cost_per_token,
        outputCost: priceData.priceData.output_cost_per_token,
      },
    });
  }
}

/**
 * 统一的请求统计处理方法
 * 用于消除 Gemini 透传、普通非流式、普通流式之间的重复统计逻辑
 */
async function finalizeRequestStats(
  session: ProxySession,
  responseText: string,
  statusCode: number,
  duration: number
): Promise<void> {
  const { messageContext, provider } = session;
  if (!provider || !messageContext) {
    return;
  }

  // 1. 结束请求状态追踪
  ProxyStatusTracker.getInstance().endRequest(messageContext.user.id, messageContext.id);

  // 2. 更新请求时长
  await updateMessageRequestDuration(messageContext.id, duration);

  // 3. 解析 usage metrics
  const { usageMetrics } = parseUsageFromResponseText(responseText, provider.providerType);

  if (!usageMetrics) {
    // 即使没有 usageMetrics，也需要更新状态码和 provider chain
    await updateMessageRequestDetails(messageContext.id, {
      statusCode: statusCode,
      providerChain: session.getProviderChain(),
      model: session.getCurrentModel() ?? undefined,
      providerId: session.provider?.id, // ⭐ 更新最终供应商ID（重试切换后）
    });
    return;
  }

  // 4. 更新成本
  await updateRequestCostFromUsage(
    messageContext.id,
    session.getOriginalModel(),
    session.getCurrentModel(),
    usageMetrics,
    provider.costMultiplier
  );

  // 5. 追踪消费到 Redis（用于限流）
  await trackCostToRedis(session, usageMetrics);

  // 6. 更新 session usage
  if (session.sessionId) {
    let costUsdStr: string | undefined;
    if (session.request.model) {
      const priceData = await findLatestPriceByModel(session.request.model);
      if (priceData?.priceData) {
        const cost = calculateRequestCost(
          usageMetrics,
          priceData.priceData,
          provider.costMultiplier
        );
        if (cost.gt(0)) {
          costUsdStr = cost.toString();
        }
      }
    }

    void SessionManager.updateSessionUsage(session.sessionId, {
      inputTokens: usageMetrics.input_tokens,
      outputTokens: usageMetrics.output_tokens,
      cacheCreationInputTokens: usageMetrics.cache_creation_input_tokens,
      cacheReadInputTokens: usageMetrics.cache_read_input_tokens,
      costUsd: costUsdStr,
      status: statusCode >= 200 && statusCode < 300 ? "completed" : "error",
      statusCode: statusCode,
    }).catch((error: unknown) => {
      logger.error("[ResponseHandler] Failed to update session usage:", error);
    });
  }

  // 7. 更新请求详情
  await updateMessageRequestDetails(messageContext.id, {
    statusCode: statusCode,
    inputTokens: usageMetrics.input_tokens,
    outputTokens: usageMetrics.output_tokens,
    cacheCreationInputTokens: usageMetrics.cache_creation_input_tokens,
    cacheReadInputTokens: usageMetrics.cache_read_input_tokens,
    providerChain: session.getProviderChain(),
    model: session.getCurrentModel() ?? undefined,
    providerId: session.provider?.id, // ⭐ 更新最终供应商ID（重试切换后）
  });
}

/**
 * 追踪消费到 Redis（用于限流）
 */
async function trackCostToRedis(session: ProxySession, usage: UsageMetrics | null): Promise<void> {
  if (!usage || !session.sessionId) return;

  const messageContext = session.messageContext;
  const provider = session.provider;
  const key = session.authState?.key;
  const user = session.authState?.user;

  if (!messageContext || !provider || !key || !user) return;

  const modelName = session.request.model;
  if (!modelName) return;

  // 计算成本（应用倍率）
  const priceData = await findLatestPriceByModel(modelName);
  if (!priceData?.priceData) return;

  const cost = calculateRequestCost(usage, priceData.priceData, provider.costMultiplier);
  if (cost.lte(0)) return;

  const costFloat = parseFloat(cost.toString());

  // 追踪到 Redis（使用 session.sessionId）
  await RateLimitService.trackCost(
    key.id,
    provider.id,
    session.sessionId, // 直接使用 session.sessionId
    costFloat,
    {
      keyResetTime: key.dailyResetTime,
      keyResetMode: key.dailyResetMode,
      providerResetTime: provider.dailyResetTime,
      providerResetMode: provider.dailyResetMode,
    }
  );

  // 新增：追踪用户层每日消费
  await RateLimitService.trackUserDailyCost(user.id, costFloat);

  // 刷新 session 时间戳（滑动窗口）
  void SessionTracker.refreshSession(session.sessionId, key.id, provider.id).catch((error) => {
    logger.error("[ResponseHandler] Failed to refresh session tracker:", error);
  });
}

/**
 * 持久化请求失败信息到数据库
 * - 用于后台异步任务中的错误处理，确保 orphan records 被正确更新
 * - 包含完整的错误信息、duration、status code 和 provider chain
 */
async function persistRequestFailure(options: {
  session: ProxySession;
  messageContext: ProxySession["messageContext"] | null;
  statusCode: number;
  error: unknown;
  taskId: string;
  phase: "stream" | "non-stream";
}): Promise<void> {
  const { session, messageContext, statusCode, error, taskId, phase } = options;

  if (!messageContext) {
    logger.warn("ResponseHandler: Cannot persist failure without messageContext", {
      taskId,
      phase,
    });
    return;
  }

  const tracker = ProxyStatusTracker.getInstance();
  const errorMessage = formatProcessingError(error);
  const duration = Date.now() - session.startTime;

  try {
    // 更新请求持续时间
    await updateMessageRequestDuration(messageContext.id, duration);

    // 更新错误详情和 provider chain
    await updateMessageRequestDetails(messageContext.id, {
      statusCode,
      errorMessage,
      providerChain: session.getProviderChain(),
      model: session.getCurrentModel() ?? undefined,
      providerId: session.provider?.id, // ⭐ 更新最终供应商ID（重试切换后）
    });

    logger.info("ResponseHandler: Successfully persisted request failure", {
      taskId,
      phase,
      messageId: messageContext.id,
      duration,
      statusCode,
      errorMessage,
    });
  } catch (dbError) {
    logger.error("ResponseHandler: Failed to persist request failure", {
      taskId,
      phase,
      messageId: messageContext.id,
      error: errorMessage,
      dbError,
    });
  } finally {
    // 确保无论数据库操作成功与否，都清理追踪状态
    try {
      tracker.endRequest(messageContext.user.id, messageContext.id);
    } catch (trackerError) {
      logger.warn("ResponseHandler: Failed to end request tracking", {
        taskId,
        messageId: messageContext.id,
        trackerError,
      });
    }
  }
}

/**
 * 格式化处理错误信息
 * - 提取有意义的错误描述用于数据库存储
 */
function formatProcessingError(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message?.trim();
    return message ? `${error.name}: ${message}` : error.name;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

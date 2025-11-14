import {
  updateMessageRequestDuration,
  updateMessageRequestCost,
  updateMessageRequestDetails,
} from "@/repository/message";
import { findLatestPriceByModel } from "@/repository/model-price";
import { logger } from "@/lib/logger";
import { parseSSEData } from "@/lib/utils/sse";
import { calculateRequestCost } from "@/lib/utils/cost-calculation";
import { RateLimitService } from "@/lib/rate-limit";
import { SessionManager } from "@/lib/session-manager";
import { SessionTracker } from "@/lib/session-tracker";
import type { ProxySession } from "./session";
import { ProxyStatusTracker } from "@/lib/proxy-status-tracker";
import { defaultRegistry } from "../converters";
import type { Format, TransformState } from "../converters/types";
import { mapClientFormatToTransformer, mapProviderTypeToTransformer } from "./format-mapper";
import { AsyncTaskManager } from "@/lib/async-task-manager";
import { isClientAbortError } from "./errors";
import type { SessionUsageUpdate } from "@/types/session";

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

    if (needsTransform && defaultRegistry.hasResponseTransformer(fromFormat, toFormat)) {
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

    // ✅ 使用 AsyncTaskManager 管理后台处理任务
    const messageContext = session.messageContext;
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
        // ✅ 检查客户端是否断开
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

        const responseText = await responseForLog.text();
        let usageRecord: Record<string, unknown> | null = null;
        let usageMetrics: UsageMetrics | null = null;

        const usageResult = parseUsageFromResponseText(responseText, provider.providerType);
        usageRecord = usageResult.usageRecord;
        usageMetrics = usageResult.usageMetrics;

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
        // 检测是否为客户端中断（使用统一的精确检测函数）
        const err = error as Error;
        if (isClientAbortError(err)) {
          logger.warn("ResponseHandler: Non-stream processing aborted", {
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
        } else {
          logger.error("Failed to handle non-stream log:", error);
        }
      } finally {
        AsyncTaskManager.cleanup(taskId);
      }
    })();

    // ✅ 注册任务并添加全局错误捕获
    AsyncTaskManager.register(taskId, processingPromise, "non-stream-processing");
    processingPromise.catch((error) => {
      logger.error("ResponseHandler: Uncaught error in non-stream processing", {
        taskId,
        error,
      });
    });

    // ✅ 客户端断开时取消任务
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

    if (needsTransform && defaultRegistry.hasResponseTransformer(fromFormat, toFormat)) {
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

    const [clientStream, internalStream] = processedStream.tee();
    const statusCode = response.status;

    // ✅ 使用 AsyncTaskManager 管理后台处理任务
    const taskId = `stream-${messageContext.id}`;
    const abortController = new AbortController();

    const processingPromise = (async () => {
      const reader = internalStream.getReader();
      const decoder = new TextDecoder();
      const chunks: string[] = [];

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
        const usageMetrics = usageResult.usageMetrics;

        await updateRequestCostFromUsage(
          messageContext.id,
          session.getOriginalModel(),
          session.getCurrentModel(),
          usageMetrics,
          provider.costMultiplier
        );

        // 追踪消费到 Redis（用于限流）
        await trackCostToRedis(session, usageMetrics);

        // 更新 session 使用量到 Redis（用于实时监控）
        if (session.sessionId) {
          let costUsdStr: string | undefined;
          if (usageMetrics && session.request.model) {
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

          const sessionUsagePayload: SessionUsageUpdate = {
            status: statusCode >= 200 && statusCode < 300 ? "completed" : "error",
            statusCode,
          };

          if (usageMetrics) {
            sessionUsagePayload.inputTokens = usageMetrics.input_tokens;
            sessionUsagePayload.outputTokens = usageMetrics.output_tokens;
            sessionUsagePayload.cacheCreationInputTokens = usageMetrics.cache_creation_input_tokens;
            sessionUsagePayload.cacheReadInputTokens = usageMetrics.cache_read_input_tokens;
          }

          if (costUsdStr) {
            sessionUsagePayload.costUsd = costUsdStr;
          }

          void SessionManager.updateSessionUsage(session.sessionId, sessionUsagePayload).catch(
            (error: unknown) => {
              logger.error("[ResponseHandler] Failed to update session usage:", error);
            }
          );
        }

        // 保存扩展信息（status code, tokens, provider chain）
        await updateMessageRequestDetails(messageContext.id, {
          statusCode: statusCode,
          inputTokens: usageMetrics?.input_tokens,
          outputTokens: usageMetrics?.output_tokens,
          cacheCreationInputTokens: usageMetrics?.cache_creation_input_tokens,
          cacheReadInputTokens: usageMetrics?.cache_read_input_tokens,
          providerChain: session.getProviderChain(),
        });
      };

      try {
        while (true) {
          // ✅ 检查取消信号
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
            chunks.push(decoder.decode(value, { stream: true }));
          }
        }

        const allContent = flushAndJoin();
        await finalizeStream(allContent);
      } catch (error) {
        // 检测是否为客户端中断（使用统一的精确检测函数）
        const err = error as Error;
        if (isClientAbortError(err)) {
          logger.warn("ResponseHandler: Stream reading aborted", {
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
        } else {
          logger.error("Failed to save SSE content:", error);
        }
      } finally {
        // ✅ 确保资源释放
        try {
          reader.releaseLock();
        } catch (releaseError) {
          logger.warn("Failed to release reader lock", { taskId, releaseError });
        }
        AsyncTaskManager.cleanup(taskId);
      }
    })();

    // ✅ 注册任务并添加全局错误捕获
    AsyncTaskManager.register(taskId, processingPromise, "stream-processing");
    processingPromise.catch((error) => {
      logger.error("ResponseHandler: Uncaught error in stream processing", {
        taskId,
        messageId: messageContext.id,
        error,
      });
    });

    // ✅ 客户端断开时取消任务
    if (session.clientAbortSignal) {
      session.clientAbortSignal.addEventListener("abort", () => {
        AsyncTaskManager.cancel(taskId);
        abortController.abort();
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
      applyUsageValue(parsed.usage, "json.root");

      if (parsed.response && typeof parsed.response === "object") {
        applyUsageValue((parsed.response as Record<string, unknown>).usage, "json.response");
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

  if (!usageMetrics && responseText.includes("event:")) {
    const events = parseSSEData(responseText);
    for (const event of events) {
      if (usageMetrics) {
        break;
      }

      if (typeof event.data !== "object" || !event.data) {
        continue;
      }

      const data = event.data as Record<string, unknown>;
      applyUsageValue(data.usage, `sse.${event.event}`);

      if (!usageMetrics && data.response && typeof data.response === "object") {
        applyUsageValue(
          (data.response as Record<string, unknown>).usage,
          `sse.${event.event}.response`
        );
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

  // Fallback 逻辑：优先原始模型，找不到则用重定向模型
  let priceData = null;
  let usedModelForPricing = null;

  // Step 1: 尝试原始模型
  if (originalModel) {
    priceData = await findLatestPriceByModel(originalModel);
    if (priceData?.priceData) {
      usedModelForPricing = originalModel;
      logger.debug("[CostCalculation] Using original model for pricing", {
        messageId,
        model: originalModel,
      });
    }
  }

  // Step 2: Fallback 到重定向模型
  if (!priceData && redirectedModel && redirectedModel !== originalModel) {
    priceData = await findLatestPriceByModel(redirectedModel);
    if (priceData?.priceData) {
      usedModelForPricing = redirectedModel;
      logger.warn("[CostCalculation] Original model price not found, using redirected model", {
        messageId,
        originalModel,
        redirectedModel,
      });
    }
  }

  // Step 3: 完全失败
  if (!priceData?.priceData) {
    logger.error("[CostCalculation] No price data found for any model", {
      messageId,
      originalModel,
      redirectedModel,
      note: "Cost will be $0. Please check price table or model name.",
    });
    return;
  }

  // 计算费用
  const cost = calculateRequestCost(usage, priceData.priceData, costMultiplier);

  logger.info("[CostCalculation] Cost calculated successfully", {
    messageId,
    usedModelForPricing,
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
    costFloat
  );

  // ✅ 新增：追踪用户层每日消费
  await RateLimitService.trackUserDailyCost(user.id, costFloat);

  // 刷新 session 时间戳（滑动窗口）
  void SessionTracker.refreshSession(session.sessionId, key.id, provider.id).catch((error) => {
    logger.error("[ResponseHandler] Failed to refresh session tracker:", error);
  });
}

/**
 * Codex 请求清洗工具
 *
 * 功能：
 * 1. 检测官方 Codex CLI 客户端（基于 User-Agent）
 * 2. 清洗非官方客户端的 Codex 请求（即使格式相同）
 *
 * 参考：claude-relay-service/src/validators/clients/codexCliValidator.js
 */

import { CodexInstructionsCache } from "@/lib/codex-instructions-cache";
import { logger } from "@/lib/logger";
import { getDefaultInstructions } from "../../codex/constants/codex-instructions";

/**
 * 功能开关：是否启用 Codex Instructions 注入
 *
 * 用途：控制是否强制替换请求中的 instructions 字段为官方完整 prompt
 *
 * - true：强制替换 instructions（约 4000+ 字完整 prompt）
 * - false (默认)：保持原样透传，不修改 instructions
 *
 * 注意：
 * - 某些 Codex 供应商可能要求必须包含官方 instructions
 * - 如果代理请求失败，可以尝试启用此开关
 * - 官方 Codex CLI 客户端会自动包含完整 instructions，不需要注入
 */
export const ENABLE_CODEX_INSTRUCTIONS_INJECTION =
  process.env.ENABLE_CODEX_INSTRUCTIONS_INJECTION === "true" || false;

/**
 * 检测是否为官方 Codex CLI 客户端
 *
 * 官方客户端 User-Agent 格式：
 * - codex_vscode/0.35.0 (Windows 10.0.26100; x86_64) unknown (Cursor; 0.4.10)
 * - codex_cli_rs/0.50.0 (Mac OS 26.0.1; arm64) vscode/1.7.54
 *
 * @param userAgent - 请求的 User-Agent 头
 * @returns 是否为官方客户端
 */
export function isOfficialCodexClient(userAgent: string | null): boolean {
  if (!userAgent) {
    return false;
  }

  // 官方客户端检测正则（参考 claude-relay-service）
  const codexCliPattern = /^(codex_vscode|codex_cli_rs)\/[\d.]+/i;
  const isOfficial = codexCliPattern.test(userAgent);

  if (isOfficial) {
    logger.debug("[CodexSanitizer] Official Codex CLI client detected", {
      userAgent: userAgent.substring(0, 100),
    });
  }

  return isOfficial;
}

/**
 * 清洗 Codex 请求（即使格式相同也需要执行）
 *
 * 清洗内容：
 * 1. 根据策略处理 instructions（auto/force_official/keep_original）
 * 2. 删除不支持的参数：max_tokens, temperature, top_p 等
 * 3. 确保必需字段：stream, store, parallel_tool_calls
 *
 * 参考：
 * - OpenAI → Codex 转换器的处理逻辑
 * - CLIProxyAPI 的参数过滤规则
 *
 * @param request - 原始请求体
 * @param model - 模型名称（用于选择 instructions）
 * @param strategy - Codex Instructions 策略（供应商级别配置，可选）
 * @param providerId - 供应商 ID（用于缓存 instructions）
 * @returns 清洗后的请求体
 */
export async function sanitizeCodexRequest(
  request: Record<string, unknown>,
  model: string,
  strategy?: "auto" | "force_official" | "keep_original",
  providerId?: number,
  options?: { isOfficialClient?: boolean }
): Promise<Record<string, unknown>> {
  const { isOfficialClient = false } = options ?? {};

  // 优先使用供应商级别策略，否则使用全局环境变量
  const effectiveStrategy =
    strategy || (ENABLE_CODEX_INSTRUCTIONS_INJECTION ? "force_official" : "auto");

  // 官方 Codex CLI 客户端 + auto 策略：保持原始请求
  if (isOfficialClient && effectiveStrategy === "auto") {
    logger.debug("[CodexSanitizer] Official client detected, skipping auto sanitization", {
      model,
      providerId,
      strategy: effectiveStrategy,
      hasInstructions: typeof request.instructions === "string",
      instructionsLength:
        typeof request.instructions === "string" ? request.instructions.length : 0,
    });
    return request;
  }

  const output = { ...request };

  // 步骤 1: 根据策略决定是否替换 instructions
  if (effectiveStrategy === "force_official") {
    // 策略 1: 强制使用官方 instructions
    const officialInstructions = getDefaultInstructions(model);
    output.instructions = officialInstructions;

    logger.info("[CodexSanitizer] Using 'force_official' strategy, replaced with official prompt", {
      model,
      strategy: effectiveStrategy,
      instructionsLength: officialInstructions.length,
      instructionsPreview: `${officialInstructions.substring(0, 100)}...`,
    });
  } else if (effectiveStrategy === "keep_original") {
    // 策略 2: 始终透传，不添加重试标记
    logger.info("[CodexSanitizer] Using 'keep_original' strategy, keeping original instructions", {
      model,
      strategy: effectiveStrategy,
      hasInstructions: !!output.instructions,
      originalInstructionsLength:
        typeof output.instructions === "string" ? output.instructions.length : 0,
    });
  } else {
    // 策略 3 (默认): auto - 智能缓存对比 + 透传 + 添加重试标记

    // ⭐ Phase 3: 缓存对比和自动覆盖
    let shouldUseCachedInstructions = false;
    if (providerId) {
      try {
        const cachedInstructions = await CodexInstructionsCache.get(providerId, model);

        if (cachedInstructions) {
          const clientInstructions =
            typeof output.instructions === "string" ? output.instructions : "";

          // 对比缓存和客户端 instructions（允许 5% 长度误差）
          const lengthDiff = Math.abs(cachedInstructions.length - clientInstructions.length);
          const lengthThreshold = cachedInstructions.length * 0.05;

          if (lengthDiff > lengthThreshold) {
            // 不匹配：覆盖为缓存的 instructions
            logger.warn("[CodexSanitizer] Client instructions mismatch with cache, overriding", {
              model,
              providerId,
              cachedLength: cachedInstructions.length,
              clientLength: clientInstructions.length,
              lengthDiff,
              threshold: lengthThreshold,
            });

            output.instructions = cachedInstructions;
            shouldUseCachedInstructions = true;
          } else {
            logger.debug("[CodexSanitizer] Client instructions match cache", {
              model,
              providerId,
              instructionsLength: clientInstructions.length,
            });
          }
        } else {
          logger.debug("[CodexSanitizer] No cached instructions found for this provider+model", {
            model,
            providerId,
          });
        }
      } catch (error) {
        // Fail Open: 缓存读取失败不影响主流程
        logger.warn("[CodexSanitizer] Failed to read cached instructions, continuing", {
          error,
          providerId,
          model,
        });
      }
    }

    logger.info("[CodexSanitizer] Using 'auto' strategy with cache-aware logic", {
      model,
      strategy: effectiveStrategy,
      providerId,
      hasInstructions: !!output.instructions,
      instructionsSource: shouldUseCachedInstructions ? "cache" : "client",
      originalInstructionsLength:
        typeof output.instructions === "string" ? output.instructions.length : 0,
    });

    // ⭐ Phase 1: 添加重试标记（仅当未使用缓存时）
    if (!shouldUseCachedInstructions) {
      output._canRetryWithOfficialInstructions = true;
    }
  }

  // 步骤 2: 删除 Codex 不支持的参数
  // 参考 CLIProxyAPI 和 OpenAI → Codex 转换器
  const unsupportedParams = [
    "max_tokens",
    "max_output_tokens",
    "max_completion_tokens",
    "temperature",
    "top_p",
    "frequency_penalty",
    "presence_penalty",
    "logprobs",
    "top_logprobs",
    "n", // Codex 始终返回单个响应
    "stop", // Codex 不支持自定义停止序列
    "response_format", // Codex 使用固定格式
  ];

  const removedParams: string[] = [];
  for (const param of unsupportedParams) {
    if (param in output) {
      delete output[param];
      removedParams.push(param);
    }
  }

  if (removedParams.length > 0) {
    logger.debug("[CodexSanitizer] Removed unsupported parameters", {
      removed: removedParams,
    });
  }

  // 步骤 3: 确保必需字段
  // Codex API 的默认行为
  // 注意：不再强制设置 stream = true，因为 /v1/responses/compact 端点不支持 stream 参数
  // 如果客户端未指定 stream，则保持 undefined，由上游 API 决定默认行为
  // 参考：https://github.com/ding113/claude-code-hub/issues/368
  output.store = false; // Codex 不存储对话历史
  output.parallel_tool_calls = true; // Codex 支持并行工具调用

  logger.info("[CodexSanitizer] Request sanitized successfully", {
    model,
    hasInstructions: !!output.instructions,
    instructionsLength: (output.instructions as string)?.length || 0,
    removedParamsCount: removedParams.length,
    stream: output.stream,
  });

  return output;
}

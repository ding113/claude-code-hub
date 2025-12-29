/**
 * Codex 请求清洗工具
 *
 * 功能：
 * 1. 检测官方 Codex CLI 客户端（基于 User-Agent）
 * 2. 清洗非官方客户端的 Codex 请求（即使格式相同）
 *
 * 参考：claude-relay-service/src/validators/clients/codexCliValidator.js
 */

import { logger } from "@/lib/logger";

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
 * 1. instructions 一律透传（不注入、不替换、不缓存）
 * 2. 删除不支持的参数：max_tokens, temperature, top_p 等
 * 3. 确保必需字段：store, parallel_tool_calls
 *
 * 参考：
 * - OpenAI → Codex 转换器的处理逻辑
 * - CLIProxyAPI 的参数过滤规则
 *
 * @param request - 原始请求体
 * @param model - 模型名称（用于日志）
 * @param _strategy - 历史参数保留兼容（已不再生效）
 * @param _providerId - 历史参数保留兼容（已不再生效）
 * @returns 清洗后的请求体
 */
export async function sanitizeCodexRequest(
  request: Record<string, unknown>,
  model: string,
  _strategy?: "auto" | "force_official" | "keep_original",
  _providerId?: number,
  options?: { isOfficialClient?: boolean }
): Promise<Record<string, unknown>> {
  const { isOfficialClient = false } = options ?? {};

  // 官方 Codex CLI 客户端：保持原始请求，避免清洗逻辑误伤官方参数
  if (isOfficialClient) {
    logger.debug("[CodexSanitizer] Official client detected, bypassing sanitization", {
      model,
      hasInstructions: typeof request.instructions === "string",
      instructionsLength:
        typeof request.instructions === "string" ? request.instructions.length : 0,
    });
    return request;
  }

  const output = { ...request };

  // Codex instructions：一律透传，不注入、不替换、不缓存、不写入内部重试标记
  if ("_canRetryWithOfficialInstructions" in output) {
    delete (output as Record<string, unknown>)._canRetryWithOfficialInstructions;
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

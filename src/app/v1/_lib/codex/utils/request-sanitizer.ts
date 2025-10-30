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
 * 1. 强制替换 instructions 为官方完整 prompt
 * 2. 删除不支持的参数：max_tokens, temperature, top_p 等
 * 3. 确保必需字段：stream, store, parallel_tool_calls
 *
 * 参考：
 * - OpenAI → Codex 转换器的处理逻辑
 * - CLIProxyAPI 的参数过滤规则
 *
 * @param request - 原始请求体
 * @param model - 模型名称（用于选择 instructions）
 * @returns 清洗后的请求体
 */
export function sanitizeCodexRequest(
  request: Record<string, unknown>,
  model: string
): Record<string, unknown> {
  const output = { ...request };

  // 步骤 1: 根据开关决定是否替换 instructions
  if (ENABLE_CODEX_INSTRUCTIONS_INJECTION) {
    // 开关启用：强制替换 instructions 为官方完整 prompt
    // 某些 Codex 供应商可能要求必须有完整 instructions（约 4000+ 字）
    const officialInstructions = getDefaultInstructions(model);
    output.instructions = officialInstructions;

    logger.info("[CodexSanitizer] Instructions injection enabled, replaced with official prompt", {
      model,
      instructionsLength: officialInstructions.length,
      instructionsPreview: officialInstructions.substring(0, 100) + "...",
    });
  } else {
    // 开关关闭（默认）：保持原样透传
    logger.info("[CodexSanitizer] Instructions injection disabled, keeping original instructions", {
      model,
      hasInstructions: !!output.instructions,
      originalInstructionsLength:
        typeof output.instructions === "string" ? output.instructions.length : 0,
    });
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
  if (output.stream === undefined) {
    output.stream = true; // Codex 默认流式
  }
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

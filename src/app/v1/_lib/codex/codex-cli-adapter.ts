/**
 * Codex CLI Adapter
 *
 * 用途: 检测和注入 Codex CLI system instructions
 *
 * 背景:
 * - Codex 供应商期望请求包含特定的 Codex CLI system prompt
 * - 非 Codex CLI 客户端(如 Cursor)不会自动包含此 prompt
 * - claude-relay-service 通过自动注入 instructions 解决此问题
 *
 * ⚠️ 存疑功能:
 * - 此功能是否必需尚未完全验证
 * - 默认开启,如测试发现问题可通过 ENABLE_CODEX_CLI_INJECTION 关闭
 */

import { logger } from "@/lib/logger";
import { CODEX_CLI_INSTRUCTIONS, isCodexCLIRequest } from "./constants/codex-cli-instructions";
import type { ResponseRequest } from "./types/response";

/**
 * 功能开关
 *
 * TODO: 验证此功能是否必需
 * - 如果 Codex 供应商要求必须有此 prompt,保持 true
 * - 如果发现问题,可改为 false 或通过环境变量控制
 */
export const ENABLE_CODEX_CLI_INJECTION = false;

/**
 * 不兼容字段列表
 *
 * 参考: claude-relay-service/src/routes/openaiRoutes.js:L267-L278
 *
 * Codex CLI 不支持以下字段,需要在注入 instructions 时删除
 */
const INCOMPATIBLE_FIELDS: Array<keyof ResponseRequest> = [
  "temperature",
  "top_p",
  "user",
  "truncation",
  // 注意: max_output_tokens 根据测试决定是否删除
  // 注意: reasoning 保留(Codex 核心功能)
  // 注意: tools 保留(Codex 支持 function calls)
];

/**
 * 适配 Response API 请求,为 Codex 供应商注入必要的 instructions
 *
 * 工作流程:
 * 1. [可选] 如果开关启用且请求未包含 Codex CLI instructions,则注入
 * 2. [总是] 删除 Codex CLI 不支持的字段
 *
 * @param request - Response API 请求对象
 * @returns 适配后的请求对象
 */
export function adaptForCodexCLI(request: ResponseRequest): ResponseRequest {
  // 创建适配后的请求
  const adaptedRequest: ResponseRequest = {
    ...request,
  };

  // 步骤 1: 注入 instructions (如果开关启用)
  if (ENABLE_CODEX_CLI_INJECTION && !isCodexCLIRequest(request.instructions)) {
    logger.info("[CodexCLI] Non-Codex CLI request detected, injecting instructions");
    adaptedRequest.instructions = CODEX_CLI_INSTRUCTIONS;
  } else if (ENABLE_CODEX_CLI_INJECTION) {
    logger.info("[CodexCLI] Codex CLI request detected, skipping injection");
  } else {
    logger.info("[CodexCLI] Injection disabled, skipping instructions");
  }

  // 步骤 2: 删除不兼容字段 (总是执行)
  const removedFields: string[] = [];
  for (const field of INCOMPATIBLE_FIELDS) {
    if (field in adaptedRequest) {
      delete adaptedRequest[field];
      removedFields.push(field);
    }
  }

  if (removedFields.length > 0) {
    logger.debug(`[CodexCLI] Removed incompatible fields: ${removedFields.join(", ")}`);
  }

  logger.debug("[CodexCLI] Adapted request:", {
    hasInstructions: !!adaptedRequest.instructions,
    instructionsLength: adaptedRequest.instructions?.length,
    removedFields,
  });

  return adaptedRequest;
}

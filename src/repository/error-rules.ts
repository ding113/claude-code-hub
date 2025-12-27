"use server";

import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { errorRules } from "@/drizzle/schema";
import { emitErrorRulesUpdated } from "@/lib/emit-event";
import { validateErrorOverrideResponse } from "@/lib/error-override-validator";
import { logger } from "@/lib/logger";

/**
 * Claude API 错误格式
 * 参考: https://platform.claude.com/docs/en/api/errors
 */
export interface ClaudeErrorResponse {
  type: "error";
  error: {
    type: string; // 错误类型，如 "invalid_request_error"
    message: string; // 错误消息
    [key: string]: unknown; // 其他可选字段
  };
  request_id?: string; // 请求 ID（会自动从上游注入）
  [key: string]: unknown; // 其他可选字段
}

/**
 * Gemini API 错误格式
 * 参考: Google gRPC Status 标准
 */
export interface GeminiErrorResponse {
  error: {
    code: number; // HTTP 状态码，如 400
    message: string; // 错误消息
    status: string; // 错误状态，如 "INVALID_ARGUMENT"
    details?: unknown[]; // 可选的错误详情
    [key: string]: unknown; // 其他可选字段
  };
  [key: string]: unknown; // 其他可选字段
}

/**
 * OpenAI API 错误格式
 * 参考: https://platform.openai.com/docs/guides/error-codes
 */
export interface OpenAIErrorResponse {
  error: {
    message: string; // 错误消息
    type: string; // 错误类型，如 "invalid_request_error"
    param?: string | null; // 可选的参数名（指向出错的请求参数）
    code?: string | null; // 可选的错误代码，如 "model_not_found"
    [key: string]: unknown; // 其他可选字段
  };
  [key: string]: unknown; // 其他可选字段
}

/**
 * 错误覆写响应体类型（支持 Claude、Gemini、OpenAI 三种格式）
 */
export type ErrorOverrideResponse = ClaudeErrorResponse | GeminiErrorResponse | OpenAIErrorResponse;

export interface ErrorRule {
  id: number;
  pattern: string;
  matchType: "regex" | "contains" | "exact";
  category: string;
  description: string | null;
  /** 覆写响应体（JSON）：匹配成功时用此响应替换原始错误响应，null 表示不覆写 */
  overrideResponse: ErrorOverrideResponse | null;
  /** 覆写状态码：null 表示透传上游状态码 */
  overrideStatusCode: number | null;
  isEnabled: boolean;
  isDefault: boolean;
  priority: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 验证并清理 overrideResponse 字段
 *
 * 从数据库读取的 JSONB 数据可能被手动修改为畸形格式，
 * 此函数在 repository 层进行运行时验证，确保返回给上层的数据格式正确
 *
 * @param raw - 数据库中的原始值
 * @param context - 调用上下文（用于日志）
 * @returns 验证通过的 ErrorOverrideResponse 或 null
 */
function sanitizeOverrideResponse(raw: unknown, context: string): ErrorOverrideResponse | null {
  if (raw === null || raw === undefined) {
    return null;
  }

  const validationError = validateErrorOverrideResponse(raw);
  if (validationError) {
    logger.warn(
      `[ErrorRulesRepository] Invalid overrideResponse in ${context}: ${validationError}`
    );
    return null;
  }

  return raw as ErrorOverrideResponse;
}

/**
 * 获取所有启用的错误规则（用于缓存加载和运行时检测）
 */
export async function getActiveErrorRules(): Promise<ErrorRule[]> {
  const results = await db.query.errorRules.findMany({
    where: eq(errorRules.isEnabled, true),
    orderBy: [errorRules.priority, errorRules.category],
  });

  return results.map((r) => ({
    id: r.id,
    pattern: r.pattern,
    matchType: r.matchType as "regex" | "contains" | "exact",
    category: r.category,
    description: r.description,
    overrideResponse: sanitizeOverrideResponse(
      r.overrideResponse,
      `getActiveErrorRules id=${r.id}`
    ),
    overrideStatusCode: r.overrideStatusCode,
    isEnabled: r.isEnabled,
    isDefault: r.isDefault,
    priority: r.priority,
    createdAt: r.createdAt ?? new Date(),
    updatedAt: r.updatedAt ?? new Date(),
  }));
}

/**
 * 根据 ID 获取单个错误规则
 */
export async function getErrorRuleById(id: number): Promise<ErrorRule | null> {
  const result = await db.query.errorRules.findFirst({
    where: eq(errorRules.id, id),
  });

  if (!result) {
    return null;
  }

  return {
    id: result.id,
    pattern: result.pattern,
    matchType: result.matchType as "regex" | "contains" | "exact",
    category: result.category,
    description: result.description,
    overrideResponse: sanitizeOverrideResponse(
      result.overrideResponse,
      `getErrorRuleById id=${result.id}`
    ),
    overrideStatusCode: result.overrideStatusCode,
    isEnabled: result.isEnabled,
    isDefault: result.isDefault,
    priority: result.priority,
    createdAt: result.createdAt ?? new Date(),
    updatedAt: result.updatedAt ?? new Date(),
  };
}

/**
 * 获取所有错误规则（包括禁用的）
 */
export async function getAllErrorRules(): Promise<ErrorRule[]> {
  const results = await db.query.errorRules.findMany({
    orderBy: [desc(errorRules.createdAt)],
  });

  return results.map((r) => ({
    id: r.id,
    pattern: r.pattern,
    matchType: r.matchType as "regex" | "contains" | "exact",
    category: r.category,
    description: r.description,
    overrideResponse: sanitizeOverrideResponse(r.overrideResponse, `getAllErrorRules id=${r.id}`),
    overrideStatusCode: r.overrideStatusCode,
    isEnabled: r.isEnabled,
    isDefault: r.isDefault,
    priority: r.priority,
    createdAt: r.createdAt ?? new Date(),
    updatedAt: r.updatedAt ?? new Date(),
  }));
}

/**
 * 创建错误规则
 */
export async function createErrorRule(data: {
  pattern: string;
  matchType: "regex" | "contains" | "exact";
  category: string;
  description?: string;
  overrideResponse?: ErrorOverrideResponse | null;
  overrideStatusCode?: number | null;
  priority?: number;
}): Promise<ErrorRule> {
  const [result] = await db
    .insert(errorRules)
    .values({
      pattern: data.pattern,
      matchType: data.matchType,
      category: data.category,
      description: data.description,
      overrideResponse: data.overrideResponse,
      overrideStatusCode: data.overrideStatusCode ?? null,
      priority: data.priority ?? 0,
    })
    .returning();

  return {
    id: result.id,
    pattern: result.pattern,
    matchType: result.matchType as "regex" | "contains" | "exact",
    category: result.category,
    description: result.description,
    overrideResponse: sanitizeOverrideResponse(
      result.overrideResponse,
      `createErrorRule id=${result.id}`
    ),
    overrideStatusCode: result.overrideStatusCode,
    isEnabled: result.isEnabled,
    isDefault: result.isDefault,
    priority: result.priority,
    createdAt: result.createdAt ?? new Date(),
    updatedAt: result.updatedAt ?? new Date(),
  };
}

/**
 * 更新错误规则
 */
export async function updateErrorRule(
  id: number,
  data: Partial<{
    pattern: string;
    matchType: "regex" | "contains" | "exact";
    category: string;
    description: string;
    overrideResponse: ErrorOverrideResponse | null;
    overrideStatusCode: number | null;
    isEnabled: boolean;
    /** 是否为默认规则（编辑默认规则时会自动设为 false） */
    isDefault: boolean;
    priority: number;
  }>
): Promise<ErrorRule | null> {
  const [result] = await db
    .update(errorRules)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(errorRules.id, id))
    .returning();

  if (!result) {
    return null;
  }

  return {
    id: result.id,
    pattern: result.pattern,
    matchType: result.matchType as "regex" | "contains" | "exact",
    category: result.category,
    description: result.description,
    overrideResponse: sanitizeOverrideResponse(
      result.overrideResponse,
      `updateErrorRule id=${result.id}`
    ),
    overrideStatusCode: result.overrideStatusCode,
    isEnabled: result.isEnabled,
    isDefault: result.isDefault,
    priority: result.priority,
    createdAt: result.createdAt ?? new Date(),
    updatedAt: result.updatedAt ?? new Date(),
  };
}

/**
 * 删除错误规则
 */
export async function deleteErrorRule(id: number): Promise<boolean> {
  const result = await db.delete(errorRules).where(eq(errorRules.id, id)).returning();

  return result.length > 0;
}

/**
 * 默认错误规则定义
 */
const DEFAULT_ERROR_RULES = [
  {
    pattern: "prompt is too long.*(tokens.*maximum|maximum.*tokens)",
    category: "prompt_limit",
    description: "Prompt token limit exceeded",
    matchType: "regex" as const,
    isDefault: true,
    isEnabled: true,
    priority: 100,
    overrideResponse: {
      type: "error",
      error: {
        type: "prompt_limit",
        message: "输入内容过长，请减少 Prompt 中的 token 数量后重试",
      },
    },
  },
  // Issue #288: Add patterns for input length errors that should not trigger retry
  {
    pattern: "Input is too long",
    category: "input_limit",
    description: "Input content length exceeds provider limit",
    matchType: "contains" as const,
    isDefault: true,
    isEnabled: true,
    priority: 95,
    overrideResponse: {
      type: "error",
      error: {
        type: "input_limit",
        message: "输入内容超过供应商限制，请减少输入长度后重试",
      },
    },
  },
  {
    pattern: "CONTENT_LENGTH_EXCEEDS_THRESHOLD",
    category: "input_limit",
    description: "AWS Bedrock content length threshold exceeded",
    matchType: "contains" as const,
    isDefault: true,
    isEnabled: true,
    priority: 94,
    overrideResponse: {
      type: "error",
      error: {
        type: "input_limit",
        message: "内容长度超过阈值限制，请减少输入内容后重试",
      },
    },
  },
  {
    pattern: "ValidationException",
    category: "validation_error",
    description: "AWS/Bedrock validation error (non-retryable)",
    matchType: "contains" as const,
    isDefault: true,
    isEnabled: true,
    priority: 93,
    overrideResponse: {
      type: "error",
      error: {
        type: "validation_error",
        message: "请求参数验证失败，请检查请求格式是否正确",
      },
    },
  },
  {
    pattern:
      "context.*(length|window|limit).*exceed|exceed.*(context|token|length).*(limit|window)",
    category: "context_limit",
    description: "Context window or token limit exceeded",
    matchType: "regex" as const,
    isDefault: true,
    isEnabled: true,
    priority: 92,
    overrideResponse: {
      type: "error",
      error: {
        type: "context_limit",
        message: "上下文长度超过模型限制，请减少对话历史或输入内容",
      },
    },
  },
  {
    pattern: "max_tokens.*exceed|exceed.*max_tokens|maximum.*tokens.*allowed",
    category: "token_limit",
    description: "Max tokens parameter exceeds model limit",
    matchType: "regex" as const,
    isDefault: true,
    isEnabled: true,
    priority: 90,
    overrideResponse: {
      type: "error",
      error: {
        type: "token_limit",
        message: "max_tokens 参数超过模型允许的最大值，请降低该参数",
      },
    },
  },
  {
    pattern: "pricing plan does not include Long Context",
    category: "context_limit",
    description: "Provider pricing plan does not support Long Context prompts",
    matchType: "contains" as const,
    isDefault: true,
    isEnabled: true,
    priority: 91,
    overrideResponse: {
      type: "error",
      error: {
        type: "context_limit",
        message: "当前供应商套餐不支持长上下文，请切换供应商或减少输入",
      },
    },
  },
  {
    pattern: "blocked by.*content filter",
    category: "content_filter",
    description: "Content blocked by safety filters",
    matchType: "regex" as const,
    isDefault: true,
    isEnabled: true,
    priority: 90,
    overrideResponse: {
      type: "error",
      error: {
        type: "content_filter",
        message: "内容被安全过滤器拦截，请修改输入内容后重试",
      },
    },
  },
  // Tool use validation errors (non-retryable)
  {
    pattern: "`tool_use` ids must be unique|tool_use.*ids must be unique",
    category: "validation_error",
    description: "Duplicate tool_use IDs in request (client error)",
    matchType: "regex" as const,
    isDefault: true,
    isEnabled: true,
    priority: 89,
    overrideResponse: {
      type: "error",
      error: {
        type: "validation_error",
        message: "tool_use ID 重复，请确保每个工具调用使用唯一 ID",
      },
    },
  },
  // Issue #432: Empty message content validation error (non-retryable)
  {
    pattern: "all messages must have non-empty content",
    category: "validation_error",
    description: "Message content is empty (client error)",
    matchType: "contains" as const,
    isDefault: true,
    isEnabled: true,
    priority: 89,
    overrideResponse: {
      type: "error",
      error: {
        type: "validation_error",
        message: "消息内容不能为空，请确保所有消息都有有效内容（最后一条 assistant 消息除外）",
      },
    },
  },
  // Issue #366: Tool names must be unique (MCP server configuration error)
  {
    pattern: "Tool names must be unique",
    category: "validation_error",
    description:
      "Duplicate tool names in request (client error, related to MCP server configuration)",
    matchType: "contains" as const,
    isDefault: true,
    isEnabled: true,
    priority: 89,
    overrideResponse: {
      type: "error",
      error: {
        type: "validation_error",
        message: "工具名称重复，请检查 MCP 服务器配置确保工具名称唯一",
      },
    },
  },
  // Issue #470: server_tool_use.id format validation error (non-retryable)
  {
    pattern: "String should match pattern.*srvtoolu_|server_tool_use.*id.*should.*match",
    category: "validation_error",
    description: "server_tool_use.id format validation error (client error)",
    matchType: "regex" as const,
    isDefault: true,
    isEnabled: true,
    priority: 89,
    overrideResponse: {
      type: "error",
      error: {
        type: "validation_error",
        message: "server_tool_use.id 格式错误，必须以 srvtoolu_ 开头且仅包含字母、数字和下划线",
      },
    },
  },
  // Issue #471: tool_use_id found in tool_result blocks (non-retryable client error)
  {
    pattern:
      "unexpected.*['\"]tool_use_id['\"].*found in.*['\"]tool_result['\"]|messages\\..*\\.content\\..*: unexpected ['\"]tool_use_id['\"].*['\"]tool_result['\"]",
    category: "validation_error",
    description: "tool_use_id field incorrectly placed in tool_result blocks (client error)",
    matchType: "regex" as const,
    isDefault: true,
    isEnabled: true,
    priority: 89,
    overrideResponse: {
      type: "error",
      error: {
        type: "validation_error",
        message: "tool_result 块中不应包含 tool_use_id 字段，请检查消息格式",
      },
    },
  },
  // Tool result validation errors (non-retryable)
  {
    pattern: "unexpected.*tool_use_id.*tool_result|tool_result.*must have.*corresponding.*tool_use",
    category: "validation_error",
    description: "tool_result block missing corresponding tool_use (client error)",
    matchType: "regex" as const,
    isDefault: true,
    isEnabled: true,
    priority: 88,
    overrideResponse: {
      type: "error",
      error: {
        type: "validation_error",
        message: "tool_result 缺少对应的 tool_use，请检查工具调用链",
      },
    },
  },
  // Model-related errors (non-retryable)
  {
    pattern: '"actualModel" is null|actualModel.*null',
    category: "model_error",
    description: "Model parameter is null (Java NPE)",
    matchType: "regex" as const,
    isDefault: true,
    isEnabled: true,
    priority: 88,
    overrideResponse: {
      type: "error",
      error: {
        type: "model_error",
        message: "模型参数为空，请检查请求中的 model 字段",
      },
    },
  },
  {
    pattern: "unknown model|model.*not.*found|model.*does.*not.*exist",
    category: "model_error",
    description: "Unknown or non-existent model",
    matchType: "regex" as const,
    isDefault: true,
    isEnabled: true,
    priority: 87,
    overrideResponse: {
      type: "error",
      error: {
        type: "model_error",
        message: "未知模型，请检查模型名称是否正确",
      },
    },
  },
  {
    pattern: "model is required",
    category: "model_error",
    description: "Model parameter is required but missing",
    matchType: "contains" as const,
    isDefault: true,
    isEnabled: true,
    priority: 86,
    overrideResponse: {
      type: "error",
      error: {
        type: "model_error",
        message: "缺少必需的 model 参数，请在请求中指定模型名称",
      },
    },
  },
  {
    pattern: "模型名称.*为空|模型名称不能为空|未指定模型",
    category: "model_error",
    description: "Model name is empty or not specified (Chinese)",
    matchType: "regex" as const,
    isDefault: true,
    isEnabled: true,
    priority: 86,
    overrideResponse: {
      type: "error",
      error: {
        type: "model_error",
        message: "模型名称不能为空，请指定有效的模型名称",
      },
    },
  },
  {
    pattern: "PDF has too many pages|maximum of.*PDF pages",
    category: "pdf_limit",
    description: "PDF page limit exceeded",
    matchType: "regex" as const,
    isDefault: true,
    isEnabled: true,
    priority: 80,
    overrideResponse: {
      type: "error",
      error: {
        type: "pdf_limit",
        message: "PDF 页数超过限制（通常为 100 页），请减少页数后重试",
      },
    },
  },
  {
    pattern:
      "thinking.*format.*invalid|Expected.*thinking.*but found|clear_thinking.*requires.*thinking.*enabled",
    category: "thinking_error",
    description: "Invalid thinking block format or configuration",
    matchType: "regex" as const,
    isDefault: true,
    isEnabled: true,
    priority: 70,
    overrideResponse: {
      type: "error",
      error: {
        type: "thinking_error",
        message: "thinking 块格式无效，请检查配置或请求参数",
      },
    },
  },
  {
    pattern: "Missing required parameter|Extra inputs.*not permitted",
    category: "parameter_error",
    description: "Request parameter validation failed",
    matchType: "regex" as const,
    isDefault: true,
    isEnabled: true,
    priority: 60,
    overrideResponse: {
      type: "error",
      error: {
        type: "parameter_error",
        message: "缺少必需参数或包含不允许的参数，请检查请求格式",
      },
    },
  },
  {
    pattern: "非法请求|illegal request|invalid request",
    category: "invalid_request",
    description: "Invalid request format",
    matchType: "regex" as const,
    isDefault: true,
    isEnabled: true,
    priority: 50,
    overrideResponse: {
      type: "error",
      error: {
        type: "invalid_request",
        message: "请求格式非法，请检查请求结构是否符合 API 规范",
      },
    },
  },
  {
    pattern: "(cache_control.*(limit|maximum).*blocks|(maximum|limit).*blocks.*cache_control)",
    category: "cache_limit",
    description: "Cache control limit exceeded",
    matchType: "regex" as const,
    isDefault: true,
    isEnabled: true,
    priority: 40,
    overrideResponse: {
      type: "error",
      error: {
        type: "cache_limit",
        message: "cache_control 块数量超过限制，请减少缓存块数量",
      },
    },
  },
  {
    pattern: "image exceeds.*maximum.*bytes",
    category: "invalid_request",
    description: "Image size exceeds maximum limit",
    matchType: "regex" as const,
    isDefault: true,
    isEnabled: true,
    priority: 35,
    overrideResponse: {
      type: "error",
      error: {
        type: "invalid_request",
        message: "图片大小超过最大限制，请压缩图片后重试",
      },
    },
  },
];

/**
 * 同步默认错误规则（推荐使用）
 *
 * 将代码中的默认规则同步到数据库，采用"用户自定义优先"策略：
 * - pattern 不存在：插入新规则
 * - pattern 存在且 isDefault=true：更新为最新默认规则
 * - pattern 存在且 isDefault=false：跳过（保留用户的自定义版本）
 * - 不再存在于 DEFAULT_ERROR_RULES 中的默认规则：删除
 *
 * 使用场景：
 * 1. 系统启动时自动同步（instrumentation.ts）
 * 2. 用户点击"刷新缓存"按钮时手动同步
 *
 * @returns 同步统计：inserted（新增）、updated（更新）、skipped（跳过）、deleted（删除过期规则）
 */
export async function syncDefaultErrorRules(): Promise<{
  inserted: number;
  updated: number;
  skipped: number;
  deleted: number;
}> {
  const counters = { inserted: 0, updated: 0, skipped: 0, deleted: 0 };

  await db.transaction(async (tx) => {
    // 获取所有默认规则的 patterns
    const defaultPatterns = DEFAULT_ERROR_RULES.map((r) => r.pattern);
    const defaultPatternSet = new Set(defaultPatterns);

    // 一次查询获取数据库中所有默认规则（isDefault=true）
    const allDefaultRulesInDb = await tx.query.errorRules.findMany({
      where: eq(errorRules.isDefault, true),
      columns: { id: true, pattern: true },
    });

    // 删除不再存在于 DEFAULT_ERROR_RULES 中的默认规则
    for (const rule of allDefaultRulesInDb) {
      if (!defaultPatternSet.has(rule.pattern)) {
        await tx.delete(errorRules).where(eq(errorRules.id, rule.id));
        counters.deleted += 1;
      }
    }

    // 一次查询获取数据库中这些 pattern 的现有记录（包括用户自定义的）
    const existingRules = await tx.query.errorRules.findMany({
      where: inArray(errorRules.pattern, defaultPatterns),
      columns: { pattern: true, isDefault: true },
    });

    // 构建 pattern -> isDefault 的映射
    const existingMap = new Map(existingRules.map((r) => [r.pattern, r.isDefault]));

    for (const rule of DEFAULT_ERROR_RULES) {
      const existingIsDefault = existingMap.get(rule.pattern);

      if (existingIsDefault === undefined) {
        // pattern 不存在，直接插入
        const inserted = await tx
          .insert(errorRules)
          .values(rule)
          .onConflictDoNothing({ target: errorRules.pattern })
          .returning({ id: errorRules.id });
        if (inserted.length > 0) {
          counters.inserted += 1;
        } else {
          counters.skipped += 1;
        }
        continue;
      }

      if (existingIsDefault === true) {
        // pattern 存在且是默认规则，更新它
        await tx
          .update(errorRules)
          .set({
            matchType: rule.matchType,
            category: rule.category,
            description: rule.description,
            isEnabled: rule.isEnabled,
            isDefault: true,
            priority: rule.priority,
            updatedAt: new Date(),
          })
          .where(eq(errorRules.pattern, rule.pattern));
        counters.updated += 1;
        continue;
      }

      // pattern 存在但已被用户自定义（isDefault=false），跳过
      counters.skipped += 1;
    }
  });

  // 注意：不在此处触发 eventEmitter，由调用方决定是否刷新缓存
  // 这样可以避免调用方手动 reload() 时导致双重刷新
  return counters;
}

/**
 * 初始化默认错误规则
 *
 * @deprecated 请使用 syncDefaultErrorRules() 替代
 *
 * 此函数使用 ON CONFLICT DO NOTHING，只能插入新规则，无法更新已存在的规则。
 * 当 DEFAULT_ERROR_RULES 更新时，数据库中的旧规则不会被同步。
 *
 * syncDefaultErrorRules() 会删除所有预置规则并重新插入，确保每次都同步最新版本。
 */
export async function initializeDefaultErrorRules(): Promise<void> {
  // 使用事务批量插入，ON CONFLICT DO NOTHING 保证幂等性
  await db.transaction(async (tx) => {
    for (const rule of DEFAULT_ERROR_RULES) {
      await tx.insert(errorRules).values(rule).onConflictDoNothing({ target: errorRules.pattern });
    }
  });

  // 通知 ErrorRuleDetector 重新加载缓存
  // 这确保迁移完成后检测器能正确加载规则
  await emitErrorRulesUpdated();
}

/**
 * /api/v1 model-prices 资源 schema
 *
 * 设计要点：
 * - List / detail 输出沿用 src/types/model-price.ts 的 ModelPrice / ModelPriceData 形状；
 *   priceData 字段保持 record(string, unknown) 以保留 LiteLLM 表的全部扩展字段；
 * - upsert 单模型的输入复用 SingleModelPriceInput shape（来自 actions/model-prices）；
 * - 同步动作（syncLitellmCheck / syncLitellm）使用专用响应 schema 暴露 hasConflicts 与
 *   PriceUpdateResult 字段；
 * - catalog 输出仅暴露 modelName / litellmProvider / updatedAt（与 action 行为一致）。
 */

import { z } from "@hono/zod-openapi";
import { IsoDateTimeSchema } from "../_shared/serialization";

// ==================== 公共枚举 / 子 schema ====================

export const ModelPriceSourceSchema = z
  .enum(["litellm", "manual"])
  .describe("模型价格来源：litellm = 云端 LiteLLM；manual = 管理员手动维护")
  .openapi({ example: "litellm" });

export const ModelModeSchema = z
  .enum(["chat", "image_generation", "completion"])
  .describe("模型功能类别")
  .openapi({ example: "chat" });

const ModelPriceDataSchema = z
  .record(z.string(), z.unknown())
  .describe(
    "模型价格数据（保留 LiteLLM 的全部扩展字段；常见字段：mode / display_name / litellm_provider / *_cost_per_token 等）"
  )
  .openapi({
    example: {
      mode: "chat",
      display_name: "claude-sonnet-4",
      litellm_provider: "anthropic",
      input_cost_per_token: 0.000003,
      output_cost_per_token: 0.000015,
    },
  });

// ==================== 输出：单条模型价格 ====================

export const ModelPriceSchema = z
  .object({
    id: z.number().int().positive().describe("数据库主键").openapi({ example: 1 }),
    modelName: z.string().describe("模型名称").openapi({ example: "claude-sonnet-4-20250514" }),
    priceData: ModelPriceDataSchema,
    source: ModelPriceSourceSchema,
    createdAt: IsoDateTimeSchema.describe("创建时间（ISO 字符串）"),
    updatedAt: IsoDateTimeSchema.describe("更新时间（ISO 字符串）"),
  })
  .describe("模型价格响应（包含完整 priceData JSON 字段）");

export type ModelPriceResponse = z.infer<typeof ModelPriceSchema>;

// ==================== 输出：分页 / 列表 ====================

const ModelPriceListPageInfoSchema = z
  .object({
    page: z.number().int().min(1).describe("当前页码（1-based）").openapi({ example: 1 }),
    pageSize: z.number().int().min(1).describe("每页条数").openapi({ example: 20 }),
    total: z.number().int().min(0).describe("总条数").openapi({ example: 120 }),
    totalPages: z.number().int().min(0).describe("总页数").openapi({ example: 6 }),
  })
  .describe("Page-based 分页信息");

export const ModelPriceListResponseSchema = z
  .object({
    items: z.array(ModelPriceSchema).describe("模型价格列表"),
    pageInfo: ModelPriceListPageInfoSchema,
  })
  .describe("模型价格列表响应（page-based 分页）");

export type ModelPriceListResponse = z.infer<typeof ModelPriceListResponseSchema>;

// ==================== 输出：catalog ====================

export const ModelPriceCatalogItemSchema = z
  .object({
    modelName: z.string().describe("模型名称").openapi({ example: "claude-sonnet-4-20250514" }),
    litellmProvider: z
      .string()
      .nullable()
      .describe("LiteLLM 标记的 provider 名（可空）")
      .openapi({ example: "anthropic" }),
    updatedAt: IsoDateTimeSchema.describe("最后更新时间（ISO 字符串）"),
  })
  .describe("模型目录条目");

export type ModelPriceCatalogItem = z.infer<typeof ModelPriceCatalogItemSchema>;

export const ModelPriceCatalogResponseSchema = z
  .object({
    items: z.array(ModelPriceCatalogItemSchema).describe("可用模型目录"),
  })
  .describe("模型目录响应");

export type ModelPriceCatalogResponse = z.infer<typeof ModelPriceCatalogResponseSchema>;

// ==================== 输出：exists / 同步结果 ====================

export const ModelPriceExistsResponseSchema = z
  .object({
    exists: z.boolean().describe("是否存在任何价格记录").openapi({ example: true }),
  })
  .describe("价格表是否存在响应");

export const ModelPriceUpdateResultSchema = z
  .object({
    added: z
      .array(z.string())
      .describe("新增的模型名")
      .openapi({ example: ["gpt-4"] }),
    updated: z.array(z.string()).describe("更新的模型名").openapi({ example: [] }),
    unchanged: z.array(z.string()).describe("未发生变化的模型名").openapi({ example: [] }),
    failed: z.array(z.string()).describe("处理失败的模型名").openapi({ example: [] }),
    total: z.number().int().min(0).describe("总条数").openapi({ example: 1 }),
    skippedConflicts: z
      .array(z.string())
      .optional()
      .describe("因冲突而跳过的手动添加模型")
      .openapi({ example: [] }),
  })
  .describe("批量价格更新结果");

export type ModelPriceUpdateResult = z.infer<typeof ModelPriceUpdateResultSchema>;

const SyncConflictSchema = z
  .object({
    modelName: z.string().describe("发生冲突的模型名").openapi({ example: "gpt-4" }),
    manualPrice: ModelPriceDataSchema.describe("当前手动维护的价格"),
    litellmPrice: ModelPriceDataSchema.describe("LiteLLM 中的最新价格"),
  })
  .describe("LiteLLM 同步冲突条目");

export const SyncConflictCheckResponseSchema = z
  .object({
    hasConflicts: z.boolean().describe("是否存在冲突").openapi({ example: false }),
    conflicts: z.array(SyncConflictSchema).describe("冲突列表"),
  })
  .describe("LiteLLM 同步冲突检查响应");

export type SyncConflictCheckResponse = z.infer<typeof SyncConflictCheckResponseSchema>;

// ==================== 输入：upload / sync ====================

export const ModelPriceUploadSchema = z
  .object({
    jsonContent: z
      .string()
      .min(1, "jsonContent 不能为空")
      .describe("价格表 JSON / TOML 文本（系统会自动尝试 JSON / TOML 两种解析）")
      .openapi({ example: '{"gpt-4":{"mode":"chat","input_cost_per_token":0.00003}}' }),
    overwriteManual: z
      .array(z.string())
      .optional()
      .describe("要覆盖的 manual 模型名（可选）")
      .openapi({ example: [] }),
  })
  .describe("上传价格表请求体");

export type ModelPriceUploadInput = z.infer<typeof ModelPriceUploadSchema>;

export const ModelPriceSyncSchema = z
  .object({
    overwriteManual: z
      .array(z.string())
      .optional()
      .describe("LiteLLM 同步时要覆盖的 manual 模型名（可选）")
      .openapi({ example: [] }),
  })
  .describe("LiteLLM 同步请求体");

export type ModelPriceSyncInput = z.infer<typeof ModelPriceSyncSchema>;

// ==================== 输入：upsert single / pin manual ====================

export const SingleModelPriceUpsertSchema = z
  .object({
    displayName: z.string().optional().describe("显示名").openapi({ example: "GPT-4 Turbo" }),
    mode: ModelModeSchema,
    litellmProvider: z
      .string()
      .optional()
      .describe("LiteLLM provider 名")
      .openapi({ example: "openai" }),
    supportsPromptCaching: z
      .boolean()
      .optional()
      .describe("是否支持 prompt caching")
      .openapi({ example: false }),
    inputCostPerToken: z
      .number()
      .nonnegative()
      .optional()
      .describe("输入每 token 价格")
      .openapi({ example: 0.00001 }),
    outputCostPerToken: z
      .number()
      .nonnegative()
      .optional()
      .describe("输出每 token 价格")
      .openapi({ example: 0.00003 }),
    outputCostPerImage: z
      .number()
      .nonnegative()
      .optional()
      .describe("每张图片输出价格")
      .openapi({ example: 0 }),
    inputCostPerRequest: z
      .number()
      .nonnegative()
      .optional()
      .describe("按次调用固定费用")
      .openapi({ example: 0 }),
    cacheReadInputTokenCost: z
      .number()
      .nonnegative()
      .optional()
      .describe("缓存读取每 token 价格")
      .openapi({ example: 0 }),
    cacheCreationInputTokenCost: z
      .number()
      .nonnegative()
      .optional()
      .describe("缓存创建每 token 价格")
      .openapi({ example: 0 }),
    cacheCreationInputTokenCostAbove1hr: z
      .number()
      .nonnegative()
      .optional()
      .describe("缓存创建每 token 价格（1 小时以上）")
      .openapi({ example: 0 }),
    extraFieldsJson: z
      .string()
      .optional()
      .describe("高级字段 JSON 字符串（必须是对象）")
      .openapi({ example: "{}" }),
  })
  .describe("单模型价格 upsert 请求体（手动维护）");

export type SingleModelPriceUpsertInput = z.infer<typeof SingleModelPriceUpsertSchema>;

// ==================== 路径参数 ====================

export const ModelNameParamSchema = z
  .object({
    modelName: z.string().min(1).describe("模型名").openapi({ example: "claude-sonnet-4" }),
  })
  .describe("模型名路径参数");

export const ModelPricingProviderParamSchema = z
  .object({
    modelName: z.string().min(1).describe("模型名"),
    providerType: z
      .string()
      .min(1)
      .describe("价格提供商 key（来自 priceData.pricing 节点）")
      .openapi({ example: "anthropic" }),
  })
  .describe("manual pin 路径参数");

// ==================== 序列化辅助 ====================

interface ModelPriceLike {
  id: number;
  modelName: string;
  priceData: Record<string, unknown>;
  source: "litellm" | "manual";
  createdAt: Date | string;
  updatedAt: Date | string;
}

export function serializeModelPrice(input: ModelPriceLike): ModelPriceResponse {
  const created = input.createdAt instanceof Date ? input.createdAt.toISOString() : input.createdAt;
  const updated = input.updatedAt instanceof Date ? input.updatedAt.toISOString() : input.updatedAt;
  return {
    id: input.id,
    modelName: input.modelName,
    priceData: input.priceData,
    source: input.source,
    createdAt: created,
    updatedAt: updated,
  };
}

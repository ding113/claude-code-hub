"use server";

import { revalidatePath } from "next/cache";
import { emitActionAudit } from "@/lib/audit/emit";
import { getSession } from "@/lib/auth";
import { logger } from "@/lib/logger";
import {
  fetchCloudPriceTableToml,
  parseCloudPriceTableToml,
} from "@/lib/price-sync/cloud-price-table";
import {
  createModelPrice,
  deleteModelPriceByName,
  findAllLatestPrices,
  findAllLatestPricesPaginated,
  findAllManualPrices,
  findLatestPriceByModel,
  findLatestPriceByModelAndSource,
  hasAnyPriceRecords,
  type PaginatedResult,
  type PaginationParams,
  upsertModelPrice,
} from "@/repository/model-price";
import type {
  ModelPrice,
  ModelPriceData,
  PriceTableJson,
  PriceUpdateResult,
  SyncConflict,
  SyncConflictCheckResult,
} from "@/types/model-price";
import type { ActionResult } from "./types";

/**
 * 检查价格数据是否相同
 */
function isPriceDataEqual(data1: ModelPriceData, data2: ModelPriceData): boolean {
  const stableStringify = (value: unknown): string => {
    const seen = new WeakSet<object>();

    const canonicalize = (node: unknown): unknown => {
      if (node === null || node === undefined) return node;
      if (typeof node !== "object") return node;

      if (seen.has(node as object)) {
        return null;
      }
      seen.add(node as object);

      if (Array.isArray(node)) {
        return node.map(canonicalize);
      }

      const obj = node as Record<string, unknown>;
      const result: Record<string, unknown> = Object.create(null);
      for (const key of Object.keys(obj).sort()) {
        // 防御：避免 __proto__/constructor/prototype 触发原型链污染
        if (key === "__proto__" || key === "constructor" || key === "prototype") {
          continue;
        }
        result[key] = canonicalize(obj[key]);
      }
      return result;
    };

    return JSON.stringify(canonicalize(value));
  };

  return stableStringify(data1) === stableStringify(data2);
}

function buildManualPriceDataFromProviderPricing(
  modelName: string,
  basePriceData: ModelPriceData,
  pricingProviderKey: string
): ModelPriceData | null {
  const pricing = basePriceData.pricing;
  if (!pricing || typeof pricing !== "object" || Array.isArray(pricing)) {
    return null;
  }

  const pricingNode = pricing[pricingProviderKey];
  if (!pricingNode || typeof pricingNode !== "object" || Array.isArray(pricingNode)) {
    return null;
  }

  return {
    ...basePriceData,
    ...pricingNode,
    pricing: undefined,
    litellm_provider: pricingProviderKey,
    selected_pricing_provider: pricingProviderKey,
    selected_pricing_source_model: modelName,
    selected_pricing_resolution: "manual_pin",
  };
}

/**
 * 价格表处理核心逻辑（内部函数，无权限检查）
 * 用于系统初始化和 Web UI 上传
 * @param jsonContent - 价格表 JSON 内容
 * @param overwriteManual - 可选，要覆盖的手动添加模型名称列表
 */
export async function processPriceTableInternal(
  jsonContent: string,
  overwriteManual?: string[]
): Promise<ActionResult<PriceUpdateResult>> {
  try {
    // 解析JSON内容
    let priceTable: PriceTableJson;
    try {
      priceTable = JSON.parse(jsonContent);
    } catch {
      return { ok: false, error: "JSON格式不正确，请检查文件内容" };
    }

    // 验证是否为对象
    if (typeof priceTable !== "object" || priceTable === null) {
      return { ok: false, error: "价格表必须是一个JSON对象" };
    }

    // 元数据字段列表（不是实际的模型数据）
    const METADATA_FIELDS = ["sample_spec"];

    // 导入所有模型（过滤元数据字段）
    const entries = Object.entries(priceTable).filter(([modelName]) => {
      // 排除元数据字段
      if (METADATA_FIELDS.includes(modelName)) {
        logger.debug(`跳过元数据字段: ${modelName}`);
        return false;
      }
      return typeof modelName === "string" && modelName.trim().length > 0;
    });

    // 创建覆盖列表的 Set 用于快速查找
    const overwriteSet = new Set(overwriteManual ?? []);

    // 获取所有手动添加的模型（用于冲突检测）
    const manualPrices = await findAllManualPrices();

    // 批量获取数据库中“每个模型的最新价格”，避免 N+1 查询
    const existingLatestPrices = await findAllLatestPrices();
    const existingByModelName = new Map<string, ModelPrice>();
    for (const price of existingLatestPrices) {
      existingByModelName.set(price.modelName, price);
    }

    const result: PriceUpdateResult = {
      added: [],
      updated: [],
      unchanged: [],
      failed: [],
      total: entries.length,
      skippedConflicts: [],
    };

    // 处理每个模型的价格
    for (const [modelName, priceData] of entries) {
      try {
        // 验证价格数据基本类型
        if (typeof priceData !== "object" || priceData === null) {
          logger.warn(`模型 ${modelName} 的价格数据不是有效的对象`);
          result.failed.push(modelName);
          continue;
        }

        // 验证价格数据必须包含 mode 字段（所有有效模型都有这个字段）
        if (!("mode" in priceData)) {
          logger.warn(`模型 ${modelName} 缺少必需的 mode 字段，跳过处理`);
          result.failed.push(modelName);
          continue;
        }

        // 检查是否存在手动添加的价格且不在覆盖列表中
        const isManualPrice = manualPrices.has(modelName);
        if (isManualPrice && !overwriteSet.has(modelName)) {
          // 跳过手动添加的模型，记录到 skippedConflicts
          result.skippedConflicts?.push(modelName);
          result.unchanged.push(modelName);
          logger.debug(`跳过手动添加的模型: ${modelName}`);
          continue;
        }

        const existingPrice = existingByModelName.get(modelName) ?? null;

        if (!existingPrice) {
          // 模型不存在，新增记录
          await createModelPrice(modelName, priceData, "litellm");
          result.added.push(modelName);
        } else if (!isPriceDataEqual(existingPrice.priceData, priceData)) {
          // 模型存在但价格发生变化
          // 如果是手动模型且在覆盖列表中，先删除旧记录
          if (isManualPrice && overwriteSet.has(modelName)) {
            await deleteModelPriceByName(modelName);
          }
          await createModelPrice(modelName, priceData, "litellm");
          result.updated.push(modelName);
        } else {
          // 价格未发生变化，不需要更新
          result.unchanged.push(modelName);
        }
      } catch (error) {
        logger.error(`处理模型 ${modelName} 失败:`, error);
        result.failed.push(modelName);
      }
    }

    // 刷新页面数据
    try {
      revalidatePath("/settings/prices");
    } catch (error) {
      // 在后台任务/启动阶段可能没有 Next.js 的请求上下文，此处允许降级
      logger.debug("[ModelPrices] revalidatePath skipped", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return { ok: true, data: result };
  } catch (error) {
    logger.error("处理价格表失败:", error);
    const message = error instanceof Error ? error.message : "处理失败，请稍后重试";
    return { ok: false, error: message };
  }
}

/**
 * 上传并更新模型价格表（Web UI 入口，包含权限检查）
 *
 * 支持格式：
 * - JSON：PriceTableJson（内部入库格式）
 * - TOML：云端价格表格式（会提取 models 表后再入库）
 * @param overwriteManual - 可选，要覆盖的手动添加模型名称列表
 */
export async function uploadPriceTable(
  content: string,
  overwriteManual?: string[]
): Promise<ActionResult<PriceUpdateResult>> {
  // 权限检查：只有管理员可以上传价格表
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return { ok: false, error: "无权限执行此操作" };
  }

  // 先尝试 JSON；失败则按 TOML 解析（用于云端价格表文件直接上传）
  let jsonContent = content;
  try {
    JSON.parse(content);
  } catch {
    const parseResult = parseCloudPriceTableToml(content);
    if (!parseResult.ok) {
      emitActionAudit({
        category: "model_price",
        action: "model_price.bulk_upload",
        targetType: "model_price",
        success: false,
        errorMessage: parseResult.error,
      });
      return { ok: false, error: parseResult.error };
    }
    jsonContent = JSON.stringify(parseResult.data.models);
  }

  const result = await processPriceTableInternal(jsonContent, overwriteManual);

  if (result.ok) {
    emitActionAudit({
      category: "model_price",
      action: "model_price.bulk_upload",
      targetType: "model_price",
      after: {
        added: result.data.added.length,
        updated: result.data.updated.length,
        unchanged: result.data.unchanged.length,
        failed: result.data.failed.length,
        skippedConflicts: result.data.skippedConflicts?.length ?? 0,
        total: result.data.total,
        overwriteManualCount: overwriteManual?.length ?? 0,
      },
      success: true,
    });
  } else {
    emitActionAudit({
      category: "model_price",
      action: "model_price.bulk_upload",
      targetType: "model_price",
      success: false,
      errorMessage: result.error,
    });
  }

  return result;
}

/**
 * 获取所有模型的最新价格（包含 Claude 和 OpenAI 等所有模型）
 */
export async function getModelPrices(): Promise<ModelPrice[]> {
  try {
    // 权限检查：只有管理员可以查看价格表
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return [];
    }

    return await findAllLatestPrices();
  } catch (error) {
    logger.error("获取模型价格失败:", error);
    return [];
  }
}

export interface AvailableModelCatalogItem {
  modelName: string;
  litellmProvider: string | null;
  updatedAt: string;
}

/**
 * 获取本地价格表中的聊天模型目录。
 * 供供应商白名单模型选择器回退使用，按更新时间倒序返回。
 */
export async function getAvailableModelCatalog(): Promise<AvailableModelCatalogItem[]> {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return [];
    }

    const allPrices = await findAllLatestPrices();

    return allPrices
      .filter((price) => price.priceData.mode === "chat")
      .sort((left, right) => {
        const timeDelta = right.updatedAt.getTime() - left.updatedAt.getTime();
        if (timeDelta !== 0) {
          return timeDelta;
        }
        return left.modelName.localeCompare(right.modelName);
      })
      .map((price) => ({
        modelName: price.modelName,
        litellmProvider:
          typeof price.priceData.litellm_provider === "string"
            ? price.priceData.litellm_provider
            : null,
        updatedAt: price.updatedAt.toISOString(),
      }));
  } catch (error) {
    logger.error("获取可用模型目录失败:", error);
    return [];
  }
}

/**
 * 分页获取所有模型的最新价格
 */
export async function getModelPricesPaginated(
  params: PaginationParams
): Promise<ActionResult<PaginatedResult<ModelPrice>>> {
  try {
    // 权限检查：只有管理员可以查看价格表
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return {
        ok: false,
        error: "无权限执行此操作",
      };
    }

    const result = await findAllLatestPricesPaginated(params);
    return {
      ok: true,
      data: result,
    };
  } catch (error) {
    logger.error("获取模型价格失败:", error);
    return {
      ok: false,
      error: "获取价格数据失败，请稍后重试",
    };
  }
}

/**
 * 检查是否存在价格表数据
 */
export async function hasPriceTable(): Promise<boolean> {
  try {
    const session = await getSession();

    if (session && session.user.role === "admin") {
      const prices = await getModelPrices();
      return prices.length > 0;
    }

    return await hasAnyPriceRecords();
  } catch (error) {
    logger.error("检查价格表失败:", error);
    return false;
  }
}

/**
 * 获取可选择的聊天模型名称列表。
 * 直接复用本地模型目录，返回所有 provider 的聊天模型名。
 */
export async function getAvailableModelsByProviderType(): Promise<string[]> {
  try {
    const catalog = await getAvailableModelCatalog();
    return catalog.map((item) => item.modelName);
  } catch (error) {
    logger.error("获取可用模型列表失败:", error);
    return [];
  }
}

/**
 * 获取指定模型的最新价格
 */

/**
 * 检查 LiteLLM 同步是否会产生冲突
 * @returns 冲突检查结果，包含是否有冲突以及冲突列表
 */
export async function checkLiteLLMSyncConflicts(): Promise<ActionResult<SyncConflictCheckResult>> {
  try {
    // 权限检查：只有管理员可以检查冲突
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: "无权限执行此操作" };
    }

    // 拉取并解析云端 TOML 价格表
    const tomlResult = await fetchCloudPriceTableToml();
    if (!tomlResult.ok) {
      return {
        ok: false,
        error: tomlResult.error,
      };
    }

    const parseResult = parseCloudPriceTableToml(tomlResult.data);
    if (!parseResult.ok) {
      return { ok: false, error: parseResult.error };
    }

    const priceTable: PriceTableJson = parseResult.data.models;

    // 获取数据库中所有 manual 价格
    const manualPrices = await findAllManualPrices();
    logger.info(`[Conflict Check] Found ${manualPrices.size} manual prices in database`);

    // 构建冲突列表：检查哪些 manual 模型会被 LiteLLM 同步覆盖
    const conflicts: SyncConflict[] = [];
    for (const [modelName, manualPrice] of manualPrices) {
      const litellmPrice = priceTable[modelName];
      if (litellmPrice && typeof litellmPrice === "object" && "mode" in litellmPrice) {
        conflicts.push({
          modelName,
          manualPrice: manualPrice.priceData,
          litellmPrice: litellmPrice as ModelPriceData,
        });
      }
    }

    logger.info(`[Conflict Check] Found ${conflicts.length} conflicts`);

    return {
      ok: true,
      data: {
        hasConflicts: conflicts.length > 0,
        conflicts,
      },
    };
  } catch (error) {
    logger.error("检查同步冲突失败:", error);
    const message = error instanceof Error ? error.message : "检查失败，请稍后重试";
    return { ok: false, error: message };
  }
}

/**
 * 从 LiteLLM CDN 同步价格表到数据库
 * @param overwriteManual - 可选，要覆盖的手动添加模型名称列表
 * @returns 同步结果
 */
export async function syncLiteLLMPrices(
  overwriteManual?: string[]
): Promise<ActionResult<PriceUpdateResult>> {
  try {
    // 权限检查：只有管理员可以同步价格表
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: "无权限执行此操作" };
    }

    logger.info("[PriceSync] Starting cloud price sync...");

    // 拉取并解析云端 TOML 价格表
    const tomlResult = await fetchCloudPriceTableToml();
    if (!tomlResult.ok) {
      logger.error("[PriceSync] Failed to fetch cloud price table", { error: tomlResult.error });
      emitActionAudit({
        category: "model_price",
        action: "model_price.sync_litellm",
        targetType: "model_price",
        success: false,
        errorMessage: tomlResult.error,
      });
      return { ok: false, error: tomlResult.error };
    }

    const parseResult = parseCloudPriceTableToml(tomlResult.data);
    if (!parseResult.ok) {
      logger.error("[PriceSync] Failed to parse cloud price table", { error: parseResult.error });
      emitActionAudit({
        category: "model_price",
        action: "model_price.sync_litellm",
        targetType: "model_price",
        success: false,
        errorMessage: parseResult.error,
      });
      return { ok: false, error: parseResult.error };
    }

    const jsonContent = JSON.stringify(parseResult.data.models);
    const result = await processPriceTableInternal(jsonContent, overwriteManual);

    if (result.ok) {
      logger.info("[PriceSync] Cloud price sync completed", {
        added: result.data.added.length,
        updated: result.data.updated.length,
        unchanged: result.data.unchanged.length,
        failed: result.data.failed.length,
        skippedConflicts: result.data.skippedConflicts?.length ?? 0,
        total: result.data.total,
      });
      emitActionAudit({
        category: "model_price",
        action: "model_price.sync_litellm",
        targetType: "model_price",
        after: {
          added: result.data.added.length,
          updated: result.data.updated.length,
          unchanged: result.data.unchanged.length,
          failed: result.data.failed.length,
          skippedConflicts: result.data.skippedConflicts?.length ?? 0,
          total: result.data.total,
          overwriteManualCount: overwriteManual?.length ?? 0,
        },
        success: true,
      });
    } else {
      logger.error("[PriceSync] Cloud price sync failed", { error: result.error });
      emitActionAudit({
        category: "model_price",
        action: "model_price.sync_litellm",
        targetType: "model_price",
        success: false,
        errorMessage: result.error,
      });
    }

    return result;
  } catch (error) {
    logger.error("[PriceSync] Cloud price sync failed", error);
    const message = error instanceof Error ? error.message : "同步失败，请稍后重试";
    emitActionAudit({
      category: "model_price",
      action: "model_price.sync_litellm",
      targetType: "model_price",
      success: false,
      errorMessage: "SYNC_FAILED",
    });
    return { ok: false, error: message };
  }
}

/**
 * 单个模型价格输入类型
 */
export interface SingleModelPriceInput {
  modelName: string;
  displayName?: string;
  mode: "chat" | "image_generation" | "completion";
  litellmProvider?: string;
  supportsPromptCaching?: boolean;
  inputCostPerToken?: number;
  outputCostPerToken?: number;
  outputCostPerImage?: number;
  inputCostPerRequest?: number;
  cacheReadInputTokenCost?: number;
  cacheCreationInputTokenCost?: number;
  cacheCreationInputTokenCostAbove1hr?: number;
  extraFieldsJson?: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeExtraPriceData(value: unknown, path = ""): unknown {
  if (Array.isArray(value)) {
    return value.map((item, index) => sanitizeExtraPriceData(item, `${path}[${index}]`));
  }

  if (!isPlainObject(value)) {
    if (
      path &&
      /(cost|price|per_|rate|multiplier|session|query|page|pixel|character|dbu)/i.test(path)
    ) {
      if (typeof value === "string" && value.trim()) {
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed >= 0) {
          return parsed;
        }
      }

      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        throw new Error(`${path} 必须是非负数`);
      }
    }

    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [
      key,
      sanitizeExtraPriceData(nestedValue, path ? `${path}.${key}` : key),
    ])
  );
}

/**
 * 创建或更新单个模型价格（手动维护）
 */
export async function upsertSingleModelPrice(
  input: SingleModelPriceInput
): Promise<ActionResult<ModelPrice>> {
  try {
    // 权限检查：只有管理员可以操作
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: "无权限执行此操作" };
    }

    // 验证输入
    if (!input.modelName?.trim()) {
      return { ok: false, error: "模型名称不能为空" };
    }

    // 验证价格非负
    if (
      input.inputCostPerToken !== undefined &&
      (input.inputCostPerToken < 0 || !Number.isFinite(input.inputCostPerToken))
    ) {
      return { ok: false, error: "输入价格必须为非负数" };
    }
    if (
      input.outputCostPerToken !== undefined &&
      (input.outputCostPerToken < 0 || !Number.isFinite(input.outputCostPerToken))
    ) {
      return { ok: false, error: "输出价格必须为非负数" };
    }
    if (
      input.outputCostPerImage !== undefined &&
      (input.outputCostPerImage < 0 || !Number.isFinite(input.outputCostPerImage))
    ) {
      return { ok: false, error: "图片价格必须为非负数" };
    }
    if (
      input.inputCostPerRequest !== undefined &&
      (input.inputCostPerRequest < 0 || !Number.isFinite(input.inputCostPerRequest))
    ) {
      return { ok: false, error: "按次调用价格必须为非负数" };
    }
    if (
      input.cacheReadInputTokenCost !== undefined &&
      (input.cacheReadInputTokenCost < 0 || !Number.isFinite(input.cacheReadInputTokenCost))
    ) {
      return { ok: false, error: "缓存读取价格必须为非负数" };
    }
    if (
      input.cacheCreationInputTokenCost !== undefined &&
      (input.cacheCreationInputTokenCost < 0 || !Number.isFinite(input.cacheCreationInputTokenCost))
    ) {
      return { ok: false, error: "缓存创建价格必须为非负数" };
    }
    if (
      input.cacheCreationInputTokenCostAbove1hr !== undefined &&
      (input.cacheCreationInputTokenCostAbove1hr < 0 ||
        !Number.isFinite(input.cacheCreationInputTokenCostAbove1hr))
    ) {
      return { ok: false, error: "缓存创建(1h)价格必须为非负数" };
    }

    let extraPriceData: Record<string, unknown> = {};
    if (input.extraFieldsJson?.trim()) {
      try {
        const parsed = JSON.parse(input.extraFieldsJson);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          return { ok: false, error: "高级字段必须是 JSON 对象" };
        }
        extraPriceData = sanitizeExtraPriceData(parsed) as Record<string, unknown>;
      } catch (error) {
        return {
          ok: false,
          error:
            error instanceof Error
              ? `高级字段 JSON 解析失败: ${error.message}`
              : "高级字段 JSON 解析失败",
        };
      }
    }

    // 构建价格数据
    const priceData: ModelPriceData = {
      ...extraPriceData,
      mode: input.mode,
      display_name: input.displayName?.trim() || undefined,
      litellm_provider: input.litellmProvider || undefined,
      supports_prompt_caching: input.supportsPromptCaching,
      input_cost_per_token: input.inputCostPerToken,
      output_cost_per_token: input.outputCostPerToken,
      output_cost_per_image: input.outputCostPerImage,
      input_cost_per_request: input.inputCostPerRequest,
      cache_read_input_token_cost: input.cacheReadInputTokenCost,
      cache_creation_input_token_cost: input.cacheCreationInputTokenCost,
      cache_creation_input_token_cost_above_1hr: input.cacheCreationInputTokenCostAbove1hr,
    };

    // 捕获 before 快照
    const beforePrice = await findLatestPriceByModel(input.modelName.trim());

    // 执行更新
    const result = await upsertModelPrice(input.modelName.trim(), priceData);

    // 刷新页面数据
    try {
      revalidatePath("/settings/prices");
    } catch (error) {
      // 在后台任务/启动阶段可能没有 Next.js 的请求上下文，此处允许降级
      logger.debug("[ModelPrices] revalidatePath skipped", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    emitActionAudit({
      category: "model_price",
      action: "model_price.upsert",
      targetType: "model_price",
      targetId: String(result.id),
      targetName: result.modelName,
      before: beforePrice ?? undefined,
      after: {
        id: result.id,
        modelName: result.modelName,
        source: result.source,
        priceData: result.priceData,
      },
      success: true,
    });
    return { ok: true, data: result };
  } catch (error) {
    logger.error("更新模型价格失败:", error);
    const message = error instanceof Error ? error.message : "操作失败，请稍后重试";
    emitActionAudit({
      category: "model_price",
      action: "model_price.upsert",
      targetType: "model_price",
      targetName: input.modelName?.trim() ?? null,
      success: false,
      errorMessage: "UPSERT_FAILED",
    });
    return { ok: false, error: message };
  }
}

/**
 * 删除单个模型价格（硬删除）
 */
export async function deleteSingleModelPrice(modelName: string): Promise<ActionResult<void>> {
  try {
    // 权限检查：只有管理员可以操作
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: "无权限执行此操作" };
    }

    // 验证输入
    if (!modelName?.trim()) {
      return { ok: false, error: "模型名称不能为空" };
    }

    // 捕获 before 快照
    const beforePrice = await findLatestPriceByModel(modelName.trim());

    // 执行删除
    await deleteModelPriceByName(modelName.trim());

    // 刷新页面数据
    try {
      revalidatePath("/settings/prices");
    } catch (error) {
      logger.debug("[ModelPrices] revalidatePath skipped", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    emitActionAudit({
      category: "model_price",
      action: "model_price.delete",
      targetType: "model_price",
      targetId: beforePrice ? String(beforePrice.id) : null,
      targetName: modelName.trim(),
      before: beforePrice ?? undefined,
      success: true,
    });
    return { ok: true, data: undefined };
  } catch (error) {
    logger.error("删除模型价格失败:", error);
    const message = error instanceof Error ? error.message : "删除失败，请稍后重试";
    emitActionAudit({
      category: "model_price",
      action: "model_price.delete",
      targetType: "model_price",
      targetName: modelName?.trim() ?? null,
      success: false,
      errorMessage: "DELETE_FAILED",
    });
    return { ok: false, error: message };
  }
}

export async function pinModelPricingProviderAsManual(input: {
  modelName: string;
  pricingProviderKey: string;
}): Promise<ActionResult<ModelPrice>> {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: "无权限执行此操作" };
    }

    const modelName = input.modelName?.trim();
    const pricingProviderKey = input.pricingProviderKey?.trim();
    if (!modelName) {
      return { ok: false, error: "模型名称不能为空" };
    }
    if (!pricingProviderKey) {
      return { ok: false, error: "价格提供商不能为空" };
    }

    const latestCloudPrice = await findLatestPriceByModelAndSource(modelName, "litellm");
    if (!latestCloudPrice) {
      return { ok: false, error: "未找到云端模型价格" };
    }

    const manualPriceData = buildManualPriceDataFromProviderPricing(
      modelName,
      latestCloudPrice.priceData,
      pricingProviderKey
    );
    if (!manualPriceData) {
      return { ok: false, error: "未找到对应的多供应商价格节点" };
    }

    const result = await upsertModelPrice(modelName, manualPriceData);

    try {
      revalidatePath("/settings/prices");
    } catch (error) {
      logger.debug("[ModelPrices] revalidatePath skipped", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return { ok: true, data: result };
  } catch (error) {
    logger.error("固化多供应商价格失败:", error);
    const message = error instanceof Error ? error.message : "操作失败，请稍后重试";
    return { ok: false, error: message };
  }
}

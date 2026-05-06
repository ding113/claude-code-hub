import type { ActionResult } from "@/actions/types";
import { logger } from "@/lib/logger";
import { createKey, deleteKey, findActiveKeyByKeyString } from "@/repository/key";
import { countLedgerRequestsInTimeRange, sumLedgerTotalCost } from "@/repository/usage-ledger";

/**
 * 创建临时 Key（Service API 专用）
 * POST /api/service/keys/createTemp
 */
export async function createTempKey(params: {
  name: string;
  providerGroup: string;
  userId?: number;
  expiresAt?: string;
}): Promise<
  ActionResult<{
    id: number;
    key: string;
    name: string;
    providerGroup: string;
    createdAt: string;
  }>
> {
  try {
    const { name, providerGroup, userId = 1, expiresAt } = params;

    // 生成随机 Key
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const crypto = require("node:crypto");
    const keyString = `sk-${crypto.randomBytes(16).toString("hex")}`;

    // 调用 repository 创建 Key（使用 snake_case 字段）
    const keyRecord = await createKey({
      user_id: userId,
      key: keyString,
      name,
      provider_group: providerGroup,
      is_enabled: true,
      expires_at: expiresAt ? new Date(expiresAt) : null,
      can_login_web_ui: false,
      limit_5h_usd: null,
      limit_daily_usd: null,
      limit_weekly_usd: null,
      limit_monthly_usd: null,
      limit_total_usd: null,
      limit_concurrent_sessions: 10,
      cache_ttl_preference: "inherit",
    });

    logger.info("[ServiceKeys] Created temp key", { keyId: keyRecord.id, name });

    return {
      ok: true,
      data: {
        id: keyRecord.id,
        key: keyRecord.key,
        name: keyRecord.name,
        providerGroup: keyRecord.providerGroup ?? "",
        createdAt: keyRecord.createdAt.toISOString(),
      },
    };
  } catch (error) {
    logger.error("[ServiceKeys] Failed to create temp key", { error });
    return { ok: false, error: "Failed to create temp key" };
  }
}

/**
 * 软删除 Key（Service API 专用）
 * POST /api/service/keys/revoke
 */
export async function revokeKey(params: {
  keyId?: number;
  key?: string;
}): Promise<ActionResult<{ revoked: boolean }>> {
  try {
    const { keyId, key } = params;

    if (!keyId && !key) {
      return { ok: false, error: "keyId or key is required" };
    }

    let targetKeyId = keyId;

    // 如果只提供了 key 字符串，先查询 ID
    if (!targetKeyId && key) {
      const keyRecord = await findActiveKeyByKeyString(key);
      if (!keyRecord) {
        return { ok: false, error: "Key not found" };
      }
      targetKeyId = keyRecord.id;
    }

    // 调用 repository 软删除
    await deleteKey(targetKeyId!);

    logger.info("[ServiceKeys] Revoked key", { keyId: targetKeyId });

    return { ok: true, data: { revoked: true } };
  } catch (error) {
    logger.error("[ServiceKeys] Failed to revoke key", { error });
    return { ok: false, error: "Failed to revoke key" };
  }
}

/**
 * 查询 Key 用量统计（Service API 专用）
 * GET /api/service/keys/usage?key=sk-xxx
 */
export async function getKeyUsage(params: { key: string }): Promise<
  ActionResult<{
    key: string;
    keyName: string;
    providerGroup: string;
    totalCostUsd: number;
    totalRequests: number;
    todayCostUsd: number;
    todayRequests: number;
  }>
> {
  try {
    const { key } = params;

    // 查询 Key 信息
    const keyRecord = await findActiveKeyByKeyString(key);
    if (!keyRecord) {
      return { ok: false, error: "Key not found" };
    }

    // 计算总费用
    const totalCost = await sumLedgerTotalCost("key", key);

    // 计算今日费用
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayCost = await sumLedgerTotalCost("key", key, today);

    // 计算请求数
    const totalRequests = await countLedgerRequestsInTimeRange(
      "key",
      key,
      new Date(0), // 从 epoch 开始
      new Date()
    );

    const todayRequests = await countLedgerRequestsInTimeRange("key", key, today, new Date());

    return {
      ok: true,
      data: {
        key,
        keyName: keyRecord.name,
        providerGroup: keyRecord.providerGroup ?? "",
        totalCostUsd: parseFloat(totalCost),
        totalRequests,
        todayCostUsd: parseFloat(todayCost),
        todayRequests,
      },
    };
  } catch (error) {
    logger.error("[ServiceKeys] Failed to get key usage", { error });
    return { ok: false, error: "Failed to get key usage" };
  }
}

import crypto from "node:crypto";
import { parseUserAgent } from "@/lib/ua-parser";

export type ConcurrentUaIdentity = {
  bucket: string;
  id: string;
};

/**
 * 将输入归一化为正整数限额。
 *
 * - 非数字 / 非有限值 / <= 0 视为 0（无限制）
 * - > 0 时向下取整
 */
export function normalizeConcurrentUaLimit(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return Math.floor(value);
}

/**
 * 同时解析 Key/User 的并发 UA 上限（供 proxy guards 统一复用）。
 *
 * - `effectiveKeyLimit`：Key 的有效上限（Key>0 优先，否则回退到 User>0；都未设置则为 0）
 * - `normalizedUserLimit`：User 上限的归一化结果（<=0 视为 0）
 * - `enabled`：任一维度上限 >0 即为 true
 */
export function resolveKeyUserConcurrentUaLimits(
  keyLimit: number | null | undefined,
  userLimit: number | null | undefined
): { effectiveKeyLimit: number; normalizedUserLimit: number; enabled: boolean } {
  const normalizedUserLimit = normalizeConcurrentUaLimit(userLimit);
  const effectiveKeyLimit = resolveKeyConcurrentUaLimit(keyLimit, userLimit);
  const enabled = effectiveKeyLimit > 0 || normalizedUserLimit > 0;

  return { effectiveKeyLimit, normalizedUserLimit, enabled };
}

/**
 * 解析 Key 的“有效并发 UA 上限”。
 *
 * 规则：
 * - Key 自身设置（>0）优先生效
 * - Key 未设置/为 0 时，回退到 User 并发上限（>0）
 * - 都未设置/为 0 时，返回 0（表示无限制）
 */
export function resolveKeyConcurrentUaLimit(
  keyLimit: number | null | undefined,
  userLimit: number | null | undefined
): number {
  const normalizedKeyLimit = normalizeConcurrentUaLimit(keyLimit);
  if (normalizedKeyLimit > 0) {
    return normalizedKeyLimit;
  }

  return normalizeConcurrentUaLimit(userLimit);
}

/**
 * 解析并发 UA 标识（用于 Redis 并发追踪/限流）。
 *
 * 说明：
 * - 优先使用解析出的 `clientType` 作为 bucket（稳定、不随小版本变化）
 * - 解析失败时回退到原始 UA 字符串（trim 后）
 * - 最终以 sha256(bucket) 作为 Redis member（避免超长 UA 影响内存与性能）
 */
export function resolveConcurrentUaIdentity(
  userAgent: string | null | undefined
): ConcurrentUaIdentity {
  const raw = typeof userAgent === "string" ? userAgent.trim() : "";
  const parsed = raw ? parseUserAgent(raw) : null;
  const bucket = parsed?.clientType ?? (raw || "unknown");
  const id = `ua:${crypto.createHash("sha256").update(bucket, "utf8").digest("hex")}`;

  return { bucket, id };
}

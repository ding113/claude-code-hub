import { createHash } from "node:crypto";

/**
 * 请求身份原语：Replay 身份推导与前缀亲和 scope 共用的哈希工具。
 *
 * 哈希只需系统内部自洽（不与 CCHP 字节级对齐），统一使用 node:crypto sha256，
 * 不引入 xxh3 原生依赖。
 */

export function sha256Hex(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * 请求体的规范字节：优先原始 body buffer（逐字节稳定），
 * 无 buffer 时对已解析 message 做键序稳定序列化。
 */
export function canonicalRequestBytes(request: {
  buffer?: ArrayBuffer;
  message: Record<string, unknown>;
}): Uint8Array {
  if (request.buffer && request.buffer.byteLength > 0) {
    return new Uint8Array(request.buffer);
  }
  return new TextEncoder().encode(stableStringify(request.message));
}

/**
 * 租户隔离 scope 标签：sha256(keyId|format|model) 截 16 hex。
 * 含 keyId，跨租户/跨 key 不可能命中同一 scope。
 */
export function buildScopeTag(
  keyId: number | string,
  format: string,
  model: string | null | undefined
): string {
  return sha256Hex(`${keyId}|${format}|${model ?? ""}`).slice(0, 16);
}

/**
 * 键序稳定的 JSON 序列化（对象键按字典序排序，数组保序）。
 * 用于无原始 buffer 时从解析后 message 派生确定性字节。
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const parts: string[] = [];
  for (const key of keys) {
    const child = (value as Record<string, unknown>)[key];
    if (child === undefined) continue;
    parts.push(`${JSON.stringify(key)}:${stableStringify(child)}`);
  }
  return `{${parts.join(",")}}`;
}

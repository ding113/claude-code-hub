import { getEnvConfig } from "@/lib/config/env.schema";
import { buildScopeTag, canonicalRequestBytes, sha256Hex } from "@/lib/request-identity";
import type { ClientFormat } from "../format-mapper";
import type { ProxySession } from "../session";

/**
 * F2 Replay 身份推导（CCHP replay/identity.go 语义的简化移植）。
 *
 * replayId：全量作用域哈希（租户 scopeTag + endpoint + model + stream + 幂等键 + body 哈希），
 *   确定性——相同 body 与身份重推导得到相同 ID，跨副本一致；scopeTag 含 keyId，跨租户不可能命中。
 * verifier：仅内容维度（body 哈希 + endpoint + model + stream）的不同盐哈希，
 *   attach 时严格比对，防 replayId 哈希碰撞（CCHP 主 ID 含 principal / verifier 仅内容的结构对齐）。
 *
 * 不合格条件（返回 null，请求按现状处理）：
 * - 功能开关关闭；非 default endpoint policy（raw passthrough 等）
 * - 非 POST；非流式请求（stream !== true）
 * - 缺认证主体（key/user）；请求体为空
 * （probe/warmup/count_tokens 由 guard 管线顺序与 preset 天然排除，不达本步。）
 */

export interface ReplayIdentity {
  replayId: string;
  verifier: string;
  scopeTag: string;
  keyId: number;
  userId: number;
  format: ClientFormat;
  model: string | null;
  endpoint: string;
}

export const REPLAY_BYPASS_HEADER = "x-cch-no-replay";

export function deriveReplayIdentity(session: ProxySession): ReplayIdentity | null {
  try {
    const env = getEnvConfig();
    if (!env.ENABLE_REQUEST_REPLAY) return null;
    if (session.getEndpointPolicy().kind !== "default") return null;
    if (session.method !== "POST") return null;

    const message = session.request.message;
    if ((message as Record<string, unknown>).stream !== true) return null;

    const keyId = session.authState?.key?.id;
    const userId = session.authState?.user?.id;
    if (!keyId || !userId) return null;

    const bodyBytes = canonicalRequestBytes(session.request);
    if (bodyBytes.byteLength === 0) return null;

    const format = session.originalFormat;
    const model = session.getOriginalModel();
    const endpoint = session.getEndpoint() ?? "/";
    const scopeTag = buildScopeTag(keyId, format, model);
    const bodyHash = sha256Hex(bodyBytes);
    const idempotencyKey =
      session.headers.get("idempotency-key")?.trim() ||
      session.headers.get("x-idempotency-key")?.trim() ||
      "";

    const replayId = sha256Hex(
      `cch_replay_v1|${scopeTag}|${endpoint}|${model ?? ""}|stream|ik=${idempotencyKey}|${bodyHash}`
    ).slice(0, 32);
    const verifier = sha256Hex(
      `cch_replay_vf1|${bodyHash}|${endpoint}|${model ?? ""}|stream|ik=${idempotencyKey}`
    ).slice(0, 32);

    return { replayId, verifier, scopeTag, keyId, userId, format, model, endpoint };
  } catch {
    return null;
  }
}

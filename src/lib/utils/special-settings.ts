import { CONTEXT_1M_BETA_HEADER } from "@/lib/special-attributes";
import type { SpecialSetting } from "@/types/special-settings";

type BuildUnifiedSpecialSettingsParams = {
  /**
   * 已有 specialSettings（通常来自 DB special_settings 或 Session Redis 缓存）
   */
  existing?: SpecialSetting[] | null;
  /**
   * 拦截类型（如 warmup / sensitive_word）
   */
  blockedBy?: string | null;
  /**
   * 拦截原因（通常为 JSON 字符串）
   */
  blockedReason?: string | null;
  /**
   * HTTP 状态码（用于补齐守卫拦截信息）
   */
  statusCode?: number | null;
  /**
   * Cache TTL 实际应用值（用于展示 TTL/标头覆写命中）
   */
  cacheTtlApplied?: string | null;
  /**
   * 1M 上下文是否应用（用于展示 1M 标头覆写命中）
   */
  context1mApplied?: boolean | null;
};

function buildSettingKey(setting: SpecialSetting): string {
  switch (setting.type) {
    case "provider_parameter_override":
      return JSON.stringify([
        setting.type,
        setting.providerId ?? null,
        setting.providerType ?? null,
        setting.hit,
        setting.changed,
        [...setting.changes]
          .map((change) => [change.path, change.before, change.after, change.changed] as const)
          .sort((a, b) => a[0].localeCompare(b[0])),
      ]);
    case "response_fixer":
      return JSON.stringify([
        setting.type,
        setting.hit,
        [...setting.fixersApplied]
          .map((fixer) => [fixer.fixer, fixer.applied] as const)
          .sort((a, b) => a[0].localeCompare(b[0])),
      ]);
    case "guard_intercept":
      return JSON.stringify([setting.type, setting.guard, setting.action, setting.statusCode]);
    case "anthropic_cache_ttl_header_override":
      return JSON.stringify([setting.type, setting.ttl]);
    case "anthropic_context_1m_header_override":
      return JSON.stringify([setting.type, setting.header, setting.flag]);
    case "thinking_signature_rectifier":
      return JSON.stringify([
        setting.type,
        setting.hit,
        setting.providerId ?? null,
        setting.trigger,
        setting.attemptNumber,
        setting.retryAttemptNumber,
        setting.removedThinkingBlocks,
        setting.removedRedactedThinkingBlocks,
        setting.removedSignatureFields,
      ]);
    case "codex_session_id_completion":
      return JSON.stringify([
        setting.type,
        setting.hit,
        setting.action,
        setting.source,
        setting.sessionId,
      ]);
    default: {
      // 兜底：保证即使未来扩展类型也不会导致运行时崩溃
      const _exhaustive: never = setting;
      return JSON.stringify(_exhaustive);
    }
  }
}

/**
 * 构建“统一特殊设置”展示数据
 *
 * 目标：把 DB 字段（blockedBy/cacheTtlApplied/context1mApplied）与既有 special_settings 合并，
 * 统一在以下位置展示：日志列表/日志详情弹窗/Session 详情页。
 */
export function buildUnifiedSpecialSettings(
  params: BuildUnifiedSpecialSettingsParams
): SpecialSetting[] | null {
  const base = params.existing ?? [];
  const derived: SpecialSetting[] = [];

  if (params.blockedBy) {
    const guard = params.blockedBy;
    const action = guard === "warmup" ? "intercept_response" : "block_request";

    derived.push({
      type: "guard_intercept",
      scope: "guard",
      hit: true,
      guard,
      action,
      statusCode: params.statusCode ?? null,
      reason: params.blockedReason ?? null,
    });
  }

  if (params.cacheTtlApplied) {
    derived.push({
      type: "anthropic_cache_ttl_header_override",
      scope: "request_header",
      hit: true,
      ttl: params.cacheTtlApplied,
    });
  }

  if (params.context1mApplied === true) {
    derived.push({
      type: "anthropic_context_1m_header_override",
      scope: "request_header",
      hit: true,
      header: "anthropic-beta",
      flag: CONTEXT_1M_BETA_HEADER,
    });
  }

  if (base.length === 0 && derived.length === 0) {
    return null;
  }

  const seen = new Set<string>();
  const result: SpecialSetting[] = [];
  for (const item of [...base, ...derived]) {
    const key = buildSettingKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }

  return result.length > 0 ? result : null;
}

import { matchesAllowedModelRules } from "@/lib/allowed-model-rules";
import { getCircuitState, isCircuitOpen } from "@/lib/circuit-breaker";
import { getCachedSystemSettings } from "@/lib/config/system-settings-cache";
import { PROVIDER_GROUP } from "@/lib/constants/provider.constants";
import { logger } from "@/lib/logger";
import { selectBestHealthDispatchProvider } from "@/lib/provider-dispatch/health-aware-select";
import {
  matchesProviderGroupModelMatchRules,
  type ProviderGroupModelMatchRule,
  type ProviderGroupModelMatchRulesByName,
} from "@/lib/provider-groups/model-match-rules";
import { RateLimitService } from "@/lib/rate-limit";
import { SessionManager } from "@/lib/session-manager";
import { parseProviderGroups, resolveProviderGroupsWithDefault } from "@/lib/utils/provider-group";
import { isProviderActiveNow } from "@/lib/utils/provider-schedule";
import { resolveSystemTimezone } from "@/lib/utils/timezone";
import { isVendorTypeCircuitOpen } from "@/lib/vendor-type-circuit-breaker";
import { findAllProviders, findProviderById } from "@/repository/provider";
import {
  getGroupCostMultiplier,
  getProviderGroupModelMatchRules,
} from "@/repository/provider-groups";
import type { ProviderChainItem } from "@/types/message";
import type { HealthTestSloThresholds } from "@/lib/provider-health-test/slo-thresholds";
import type { Provider } from "@/types/provider";
import { isClientAllowedDetailed } from "./client-detector";
import type { ClientFormat } from "./format-mapper";
import { getVerboseProviderErrorCached } from "./provider-selector-settings-cache";
import { ProxyResponses } from "./responses";
import type { ProxySession } from "./session";

/**
 * 解析逗号分隔的分组字符串为数组
 *
 * @param groupString - 逗号分隔的分组字符串
 * @returns 清理后的分组数组（去空格、去空项）
 */
/**
 * 获取有效的供应商分组（优先级：key.providerGroup > user.providerGroup）
 *
 * @param session - 代理会话对象
 * @returns 有效分组字符串，或 null（无认证信息时）
 */
export function resolveEffectiveProviderGroup(input: {
  providerGroup?: string | null;
  key?: { providerGroup?: string | null } | null;
  user?: { providerGroup?: string | null } | null;
}): string | null {
  const selectedProviderGroup = input.providerGroup?.trim();
  if (selectedProviderGroup) {
    return selectedProviderGroup;
  }

  if (input.key) {
    return input.key.providerGroup || PROVIDER_GROUP.DEFAULT;
  }

  if (input.user) {
    return input.user.providerGroup || PROVIDER_GROUP.DEFAULT;
  }

  return null;
}

function getEffectiveProviderGroup(session?: ProxySession): string | null {
  return resolveEffectiveProviderGroup({
    providerGroup: session?.provider?.groupTag,
    key: session?.authState?.key,
    user: session?.authState?.user,
  });
}

async function resolveAndSetGroupCostMultiplier(session: ProxySession): Promise<void> {
  // Fail soft: if the lookup throws (Redis/DB hiccup), fall back to 1.0 so
  // request handling proceeds without billing disruption.
  const effectiveGroup = getEffectiveProviderGroup(session);
  if (!effectiveGroup) {
    session.setGroupCostMultiplier(1.0);
    return;
  }

  try {
    const multiplier = await getGroupCostMultiplier(effectiveGroup);
    session.setGroupCostMultiplier(multiplier);
  } catch (error) {
    logger.warn(
      "[ProviderResolver] Failed to resolve group cost multiplier, falling back to 1.0",
      {
        effectiveGroup,
        error: error instanceof Error ? error.message : String(error),
      }
    );
    session.setGroupCostMultiplier(1.0);
  }
}

/**
 * 检查供应商分组是否匹配用户分组（支持多分组逗号分隔）
 *
 * @param providerGroupTag - 供应商的 groupTag 字段（可为 null 或逗号分隔的多标签）
 * @param userGroups - 用户/密钥的分组配置（逗号分隔的多分组）
 * @returns 是否存在交集（true = 匹配）
 */
function checkProviderGroupMatch(providerGroupTag: string | null, userGroups: string): boolean {
  const groups = parseProviderGroups(userGroups);

  if (groups.includes(PROVIDER_GROUP.ALL)) {
    return true;
  }

  const providerTags = resolveProviderGroupsWithDefault(providerGroupTag);

  return providerTags.some((tag) => groups.includes(tag));
}

async function getHealthSloThresholds(): Promise<HealthTestSloThresholds> {
  const settings = await getCachedSystemSettings();
  return {
    minOnlineRate: settings.healthTestMinOnlineRatePercent / 100,
    maxAvgFirstByteMs: settings.healthTestMaxAvgLatencySeconds * 1000,
    minSampleCount: settings.healthTestWindowSize,
  };
}

/**
 * 检查供应商是否支持指定模型（用于调度器匹配）
 *
 * 核心逻辑（统一所有供应商类型）：
 * 1. 未设置 provider.allowedModels 或 group.modelMatchRules：该层接受任意模型
 * 2. 配置任一层规则：原始请求模型必须命中该层规则；两层规则同时配置时都必须通过
 * 3. modelRedirects 仅在供应商已被选中后用于改写上游模型，不参与调度放行
 *
 * 注意：allowedModels 与 group.modelMatchRules 都是声明性列表（用户可填写任意字符串），
 * 用于调度器匹配，不是真实模型校验。group.matchRules 只负责上游站点分组分类，
 * 不参与请求模型匹配。
 * 格式兼容性（如 claude 格式请求只路由到 claude 类型供应商）由 checkFormatProviderTypeCompatibility 独立保证。
 *
 * @param provider - 供应商信息
 * @param requestedModel - 用户请求的模型名称
 * @returns 是否支持该模型（用于调度器筛选）
 */
function providerSupportsModel(
  provider: Provider,
  requestedModel: string,
  groupModelMatchRules: ProviderGroupModelMatchRulesByName = new Map()
): boolean {
  // Provider-level and group-level rules are both allowlists when configured.
  if (
    provider.allowedModels &&
    provider.allowedModels.length > 0 &&
    !matchesAllowedModelRules(requestedModel, provider.allowedModels)
  ) {
    return false;
  }

  return matchesProviderGroupModelMatchRules(
    requestedModel,
    resolveProviderGroupsWithDefault(provider.groupTag),
    groupModelMatchRules
  );
}

/**
 * 根据原始请求格式限制可选供应商类型
 *
 * 核心逻辑：确保客户端请求格式与供应商类型兼容，避免格式错配
 *
 * 映射关系：
 * - claude → claude | claude-auth
 * - response → codex
 * - openai → openai-compatible
 * - gemini → gemini
 * - gemini-cli → gemini-cli
 *
 * @param format - 客户端请求格式（从 session.originalFormat 获取）
 * @param providerType - 供应商类型
 * @returns 是否兼容
 *
 * 向后兼容：调用方在 originalFormat 未设置时应跳过此检查
 */
function checkFormatProviderTypeCompatibility(
  format: ClientFormat,
  providerType: Provider["providerType"]
): boolean {
  switch (format) {
    case "claude":
      return providerType === "claude" || providerType === "claude-auth";
    case "response":
      return providerType === "codex";
    case "openai":
      return providerType === "openai-compatible";
    case "gemini":
      return providerType === "gemini";
    case "gemini-cli":
      return providerType === "gemini-cli";
    default:
      return true; // 未知格式回退为兼容（不会主动过滤）
  }
}

export class ProxyProviderResolver {
  static async ensure(
    session: ProxySession,
    _deprecatedTargetProviderType?: "claude" | "codex" // 废弃参数，保留向后兼容
  ): Promise<Response | null> {
    // 忽略废弃的 targetProviderType 参数
    if (_deprecatedTargetProviderType) {
      logger.warn(
        "[ProviderSelector] targetProviderType parameter is deprecated and will be ignored"
      );
    }

    // 动态尝试所有可用供应商（避免无限循环通过 excludedProviders 和 null 返回）
    const excludedProviders: number[] = [];

    // === 会话复用（已关闭：健康调度要求每请求重选最优供应商）===
    // Sticky session reuse would pin a stale provider after health ranking changes.
    // Keep the call site as a no-op so decision-chain / tests that mention reuse stay stable.

    // === 首次选择或重试 ===
    if (!session.provider) {
      const { provider, context } = await ProxyProviderResolver.pickRandomProvider(
        session,
        excludedProviders
      );
      session.setProvider(provider);
      session.setLastSelectionContext(context); // 保存用于后续记录
    }

    // === Resolve group cost multiplier ===
    await resolveAndSetGroupCostMultiplier(session);

    // === 故障转移循环 ===
    let attemptCount = 0;
    while (true) {
      attemptCount++;

      if (!session.provider) {
        break; // 无可用供应商，退出循环
      }

      // 选定供应商后，进行原子性并发检查并追踪
      if (session.sessionId) {
        const limit = session.provider.limitConcurrentSessions || 0;

        // 使用原子性检查并追踪（解决竞态条件）
        const checkResult = await RateLimitService.checkAndTrackProviderSession(
          session.provider.id,
          session.sessionId,
          limit
        );

        if (!checkResult.allowed) {
          // === 并发限制失败 ===
          logger.warn(
            "ProviderSelector: Provider concurrent session limit exceeded, trying fallback",
            {
              providerName: session.provider.name,
              providerId: session.provider.id,
              current: checkResult.count,
              limit,
              attempt: attemptCount,
            }
          );

          const failedContext = session.getLastSelectionContext();
          session.addProviderToChain(session.provider, {
            reason: "concurrent_limit_failed",
            selectionMethod: failedContext?.groupFilterApplied
              ? "group_filtered"
              : "weighted_random",
            circuitState: getCircuitState(session.provider.id),
            attemptNumber: attemptCount,
            errorMessage: checkResult.reason || "并发限制已达到",
            decisionContext: failedContext
              ? {
                  ...failedContext,
                  concurrentLimit: limit,
                  currentConcurrent: checkResult.count,
                }
              : {
                  totalProviders: 0,
                  enabledProviders: 0,
                  targetType: session.provider.providerType as NonNullable<
                    ProviderChainItem["decisionContext"]
                  >["targetType"],
                  requestedModel: session.getOriginalModel() || "",
                  groupFilterApplied: false,
                  beforeHealthCheck: 0,
                  afterHealthCheck: 0,
                  priorityLevels: [],
                  selectedPriority: 0,
                  candidatesAtPriority: [],
                  concurrentLimit: limit,
                  currentConcurrent: checkResult.count,
                },
          });

          // 加入排除列表
          excludedProviders.push(session.provider.id);

          // === 重试选择 ===
          const { provider: fallbackProvider, context: retryContext } =
            await ProxyProviderResolver.pickRandomProvider(session, excludedProviders);

          if (!fallbackProvider) {
            // 无其他可用供应商，退出循环
            logger.error("ProviderSelector: No fallback providers available", {
              excludedCount: excludedProviders.length,
              totalAttempts: attemptCount,
            });
            break;
          }

          // 切换到新供应商
          session.setProvider(fallbackProvider);
          session.setLastSelectionContext(retryContext);
          await resolveAndSetGroupCostMultiplier(session);
          continue; // 继续下一次循环，检查新供应商
        }

        // === 成功 ===
        if (checkResult.referenced) {
          session.recordProviderSessionRef(session.provider.id);
        }

        logger.debug("ProviderSelector: Session tracked atomically", {
          sessionId: session.sessionId,
          providerName: session.provider.name,
          count: checkResult.count,
          attempt: attemptCount,
        });

        // 只在首次选择时记录到决策链（重试时的记录由 forwarder.ts 在请求完成后统一记录）
        if (attemptCount === 1) {
          const successContext = session.getLastSelectionContext();
          session.addProviderToChain(session.provider, {
            reason: "initial_selection",
            selectionMethod: successContext?.groupFilterApplied
              ? "group_filtered"
              : "weighted_random",
            circuitState: getCircuitState(session.provider.id),
            decisionContext: successContext || {
              totalProviders: 0,
              enabledProviders: 0,
              targetType: session.provider.providerType as NonNullable<
                ProviderChainItem["decisionContext"]
              >["targetType"],
              requestedModel: session.getOriginalModel() || "",
              groupFilterApplied: false,
              beforeHealthCheck: 0,
              afterHealthCheck: 0,
              priorityLevels: [],
              selectedPriority: 0,
              candidatesAtPriority: [],
            },
          });
        }

        // ⭐ 延迟绑定策略：移除立即绑定，改为请求成功后绑定
        // 原因：并发检查成功 ≠ 请求成功，应该绑定到最终成功的供应商
        // await SessionManager.bindSessionToProvider(session.sessionId, session.provider.id); // ❌ 已移除

        // ⭐ 已移除：不要在并发检查通过后立即更新监控信息
        // 原因：此时请求还没发送，供应商可能失败
        // 修复：延迟到 forwarder 请求成功后统一更新（见 forwarder.ts:75-80）
        // void SessionManager.updateSessionProvider(...); // ❌ 已移除

        return null; // 成功
      }

      // sessionId 为空的情况（理论上不应该发生）
      logger.warn("ProviderSelector: sessionId is null, skipping concurrent check");
      return null;
    }

    // 循环结束：所有可用供应商都已尝试或无可用供应商
    const status = 503;

    // 获取系统设置中的 verboseProviderError 配置（使用缓存避免频繁查询数据库）
    const verboseError = await getVerboseProviderErrorCached();

    // 构建详细的错误消息
    let message = "No available providers";
    let errorType = "no_available_providers";

    if (excludedProviders.length > 0) {
      message = `All providers unavailable (tried ${excludedProviders.length} providers)`;
      errorType = "all_providers_failed";
    } else {
      const selectionContext = session.getLastSelectionContext();
      const filteredProviders = selectionContext?.filteredProviders;

      if (filteredProviders && filteredProviders.length > 0) {
        // 统计各种原因
        const rateLimited = filteredProviders.filter((p) => p.reason === "rate_limited");
        const circuitOpen = filteredProviders.filter((p) => p.reason === "circuit_open");
        const disabled = filteredProviders.filter((p) => p.reason === "disabled");
        const modelNotAllowed = filteredProviders.filter((p) => p.reason === "model_not_allowed");
        const clientRestricted = filteredProviders.filter((p) => p.reason === "client_restriction");

        // 计算可用供应商数量（排除禁用和模型不支持的）
        const unavailableCount = rateLimited.length + circuitOpen.length;
        const totalEnabled =
          filteredProviders.length -
          disabled.length -
          modelNotAllowed.length -
          clientRestricted.length;

        if (
          rateLimited.length > 0 &&
          circuitOpen.length === 0 &&
          unavailableCount === totalEnabled
        ) {
          // 全部因为限流
          message = `All providers rate limited (${rateLimited.length} providers)`;
          errorType = "rate_limit_exceeded";
        } else if (
          circuitOpen.length > 0 &&
          rateLimited.length === 0 &&
          unavailableCount === totalEnabled
        ) {
          // 全部因为熔断
          message = `All providers circuit breaker open (${circuitOpen.length} providers)`;
          errorType = "circuit_breaker_open";
        } else if (rateLimited.length > 0 && circuitOpen.length > 0) {
          // 混合原因
          message = `All providers unavailable (${rateLimited.length} rate limited, ${circuitOpen.length} circuit open)`;
          errorType = "mixed_unavailable";
        }
      }
    }

    logger.error("ProviderSelector: No available providers after trying all candidates", {
      excludedProviders,
      totalAttempts: attemptCount,
      errorType,
      filteredProviders: session.getLastSelectionContext()?.filteredProviders,
    });

    // 根据 verboseProviderError 配置决定返回详细错误还是简洁错误
    if (!verboseError) {
      // 简洁模式：返回固定的错误消息，不区分具体原因
      return ProxyResponses.buildError(status, "No available providers", "no_available_providers");
    }

    // 详细模式：构建详细的错误响应
    const details: Record<string, unknown> = {
      totalAttempts: attemptCount,
      excludedCount: excludedProviders.length,
    };

    const filteredProviders = session.getLastSelectionContext()?.filteredProviders;
    if (filteredProviders) {
      const clientRestricted = filteredProviders.filter((p) => p.reason === "client_restriction");

      // C-001: 脱敏供应商名称，仅暴露 id 和 reason
      details.filteredProviders = filteredProviders.map((p) => ({
        id: p.id,
        reason: p.reason,
      }));

      if (clientRestricted.length > 0) {
        details.clientRestrictedProviders = clientRestricted.map((p) => ({
          id: p.id,
          reason: p.reason,
        }));
      }
    }

    return ProxyResponses.buildError(status, message, errorType, details);
  }

  /**
   * 公开方法：选择供应商（支持排除列表，用于重试场景）
   */
  static async pickRandomProviderWithExclusion(
    session: ProxySession,
    excludeIds: number[]
  ): Promise<Provider | null> {
    const { provider } = await ProxyProviderResolver.pickRandomProvider(session, excludeIds);
    return provider;
  }

  /**
   * First-byte hedge alternate: next health-SLO qualified peer after excludes.
   * Returns null when no remaining SLO-qualified candidate exists → do not race.
   * Does not fall back to non-SLO peers. Ranking is cheapest cost first.
   */
  static async pickHealthSloAlternate(
    session: ProxySession,
    excludeIds: number[]
  ): Promise<Provider | null> {
    const { selectNextHealthDispatchAlternate, resolveDispatchCost } = await import(
      "@/lib/provider-dispatch/health-aware-select"
    );
    const { isProviderActiveNow } = await import("@/lib/utils/provider-schedule");
    const { resolveSystemTimezone } = await import("@/lib/utils/timezone");
    // providerSupportsModel is module-local in this file.

    const allProviders = await session.getProvidersSnapshot();
    const excludeSet = new Set(excludeIds);
    const effectiveGroupPick = getEffectiveProviderGroup(session);
    const requestedModel = session.getOriginalModel() || "";
    let groupModelMatchRules: ReadonlyMap<string, ProviderGroupModelMatchRule[] | null> = new Map();
    if (requestedModel) {
      try {
        groupModelMatchRules = await getProviderGroupModelMatchRules();
      } catch (error) {
        logger.warn("ProviderSelector: Failed to resolve group model rules; allowing by group", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const systemTimezone = await resolveSystemTimezone();

    let pool = allProviders.filter((provider) => {
      if (!provider.isEnabled || excludeSet.has(provider.id)) return false;
      if (!isProviderActiveNow(provider.activeTimeStart, provider.activeTimeEnd, systemTimezone)) {
        return false;
      }
      if (effectiveGroupPick && !checkProviderGroupMatch(provider.groupTag, effectiveGroupPick)) {
        return false;
      }
      if (session.originalFormat) {
        if (
          !checkFormatProviderTypeCompatibility(session.originalFormat, provider.providerType)
        ) {
          return false;
        }
      }
      if (
        requestedModel &&
        !providerSupportsModel(provider, requestedModel, groupModelMatchRules)
      ) {
        return false;
      }
      return true;
    });

    const healthSloThresholds = await getHealthSloThresholds();
    return selectNextHealthDispatchAlternate(
      pool,
      resolveDispatchCost,
      excludeIds,
      healthSloThresholds
    );
  }

  /**
   * 查找可复用的供应商（基于 session）
   *
   * Disabled: health-aware dispatch re-evaluates the optimal provider every request.
   * Sticky session reuse would freeze a previous winner after ranking changes.
   */
  private static async findReusable(_session: ProxySession): Promise<Provider | null> {
    return null;
  }


  private static async pickRandomProvider(
    session?: ProxySession,
    excludeIds: number[] = [] // 排除已失败的供应商
  ): Promise<{
    provider: Provider | null;
    context: NonNullable<ProviderChainItem["decisionContext"]>;
  }> {
    // 使用 Session 快照保证故障迁移期间数据一致性
    // 如果没有 session，回退到 findAllProviders（内部已使用缓存）
    const allProviders = session ? await session.getProvidersSnapshot() : await findAllProviders();
    const requestedModel = session?.getOriginalModel() || "";
    let groupModelMatchRules: ReadonlyMap<string, ProviderGroupModelMatchRule[] | null> = new Map();
    if (requestedModel) {
      try {
        groupModelMatchRules = await getProviderGroupModelMatchRules();
      } catch (error) {
        logger.warn("ProviderSelector: Failed to resolve group model rules; allowing by group", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // === Step 1: 分组预过滤（静默，用户只能看到自己分组内的供应商）===
    const effectiveGroupPick = getEffectiveProviderGroup(session);
    const keyGroupPick = session?.authState?.key?.providerGroup;

    let visibleProviders = allProviders;

    // 原始请求格式映射到目标供应商类型；缺省为 claude 以兼容历史请求
    const targetType: "claude" | "codex" | "openai-compatible" | "gemini" | "gemini-cli" = (() => {
      switch (session?.originalFormat) {
        case "claude":
          return "claude";
        case "response":
          return "codex";
        case "openai":
          return "openai-compatible";
        case "gemini":
          return "gemini";
        case "gemini-cli":
          return "gemini-cli";
        default:
          return "claude"; // 默认回退到 claude（向后兼容）
      }
    })();

    if (effectiveGroupPick) {
      const groupFiltered = allProviders.filter((p) =>
        checkProviderGroupMatch(p.groupTag, effectiveGroupPick)
      );

      if (groupFiltered.length > 0) {
        visibleProviders = groupFiltered;
        logger.debug("ProviderSelector: Group pre-filter applied (silent)", {
          effectiveGroup: effectiveGroupPick,
          keyGroupOverride: !!keyGroupPick,
          originalCount: allProviders.length,
          filteredCount: groupFiltered.length,
        });
      } else {
        // 严格分组隔离：用户分组内没有供应商
        logger.error("ProviderSelector: User group has no providers", {
          effectiveGroup: effectiveGroupPick,
        });
        return {
          provider: null,
          context: {
            totalProviders: 0,
            enabledProviders: 0,
            targetType,
            requestedModel,
            groupFilterApplied: true,
            userGroup: effectiveGroupPick || undefined,
            afterGroupFilter: 0,
            beforeHealthCheck: 0,
            afterHealthCheck: 0,
            filteredProviders: [],
            priorityLevels: [],
            selectedPriority: 0,
            candidatesAtPriority: [],
          },
        };
      }
    }

    // === 初始化决策上下文（使用 visibleProviders）===
    const context: NonNullable<ProviderChainItem["decisionContext"]> = {
      totalProviders: visibleProviders.length,
      enabledProviders: 0,
      targetType, // 根据原始请求格式推断目标供应商类型（修复：不再根据模型名推断）
      requestedModel, // 新增：记录请求的模型
      groupFilterApplied: !!effectiveGroupPick,
      userGroup: effectiveGroupPick || undefined,
      beforeHealthCheck: 0,
      afterHealthCheck: 0,
      filteredProviders: [],
      priorityLevels: [],
      selectedPriority: 0,
      candidatesAtPriority: [],
      excludedProviderIds: excludeIds.length > 0 ? excludeIds : undefined,
    };

    if (session) {
      const clientFilteredProviders: typeof visibleProviders = [];
      for (const p of visibleProviders) {
        const providerAllowed = p.allowedClients ?? [];
        const providerBlocked = p.blockedClients ?? [];
        if (providerAllowed.length === 0 && providerBlocked.length === 0) {
          clientFilteredProviders.push(p);
          continue;
        }
        const result = isClientAllowedDetailed(session, providerAllowed, providerBlocked);
        if (!result.allowed) {
          context.filteredProviders?.push({
            id: p.id,
            name: p.name,
            reason: "client_restriction",
            details: result.matchType === "blocklist_hit" ? "blocklist_hit" : "allowlist_miss",
            clientRestrictionContext: {
              matchType: result.matchType as "blocklist_hit" | "allowlist_miss",
              matchedPattern: result.matchedPattern,
              detectedClient: result.detectedClient,
              providerAllowlist: result.checkedAllowlist,
              providerBlocklist: result.checkedBlocklist,
            },
          });
          continue;
        }
        clientFilteredProviders.push(p);
      }
      visibleProviders = clientFilteredProviders;
    }

    // Resolve system timezone once for active time checks
    const systemTimezone = await resolveSystemTimezone();

    // Step 2: 基础过滤 + 格式/模型匹配（使用 visibleProviders）
    const enabledProviders = visibleProviders.filter((provider) => {
      // 2a. 基础过滤
      if (!provider.isEnabled || excludeIds.includes(provider.id)) {
        return false;
      }

      // 2a-2. 调度时间窗口过滤
      if (!isProviderActiveNow(provider.activeTimeStart, provider.activeTimeEnd, systemTimezone)) {
        return false;
      }

      // 2b. 格式类型匹配（新增）
      // 根据 session.originalFormat 限制候选供应商类型，避免格式错配
      if (session?.originalFormat) {
        const isFormatCompatible = checkFormatProviderTypeCompatibility(
          session.originalFormat,
          provider.providerType
        );
        if (!isFormatCompatible) {
          return false; // 过滤掉格式不兼容的供应商
        }
      }

      // 2c. 模型匹配
      if (!requestedModel) {
        // 资源类端点通常不携带 model，此时仅按格式兼容性筛选 provider，
        // 不应再因为缺失模型而把请求错误收窄到 claude。
        return true;
      }

      return providerSupportsModel(provider, requestedModel, groupModelMatchRules);
    });

    context.enabledProviders = enabledProviders.length;

    // 记录被过滤的供应商（遍历 visibleProviders）
    for (const p of visibleProviders) {
      if (!enabledProviders.includes(p)) {
        let reason:
          | "circuit_open"
          | "rate_limited"
          | "excluded"
          | "format_type_mismatch"
          | "type_mismatch"
          | "model_not_allowed"
          | "schedule_inactive"
          | "disabled" = "disabled";
        let details = "";

        if (!p.isEnabled) {
          reason = "disabled";
          details = "供应商已禁用";
        } else if (excludeIds.includes(p.id)) {
          reason = "excluded";
          details = "已在前序尝试中失败";
        } else if (!isProviderActiveNow(p.activeTimeStart, p.activeTimeEnd, systemTimezone)) {
          reason = "schedule_inactive";
          details = `outside active window ${p.activeTimeStart}-${p.activeTimeEnd}`;
        } else if (
          session?.originalFormat &&
          !checkFormatProviderTypeCompatibility(session.originalFormat, p.providerType)
        ) {
          reason = "format_type_mismatch";
          details = `原始格式 ${session.originalFormat} 与供应商类型 ${p.providerType} 不兼容`;
        } else if (
          requestedModel &&
          !providerSupportsModel(p, requestedModel, groupModelMatchRules)
        ) {
          reason = "model_not_allowed";
          details = `不支持模型 ${requestedModel}`;
        }

        context.filteredProviders?.push({
          id: p.id,
          name: p.name,
          reason,
          details,
        });
      }
    }

    if (enabledProviders.length === 0) {
      logger.warn("ProviderSelector: No providers support the requested model", {
        requestedModel,
        totalProviders: visibleProviders.length,
        excludedCount: excludeIds.length,
      });
      return { provider: null, context };
    }

    // Step 3: Candidate providers (group filter done in Step 1)
    const candidateProviders = enabledProviders;
    context.afterGroupFilter = enabledProviders.length;

    context.beforeHealthCheck = candidateProviders.length;

    // Step 4: 过滤超限供应商（健康度过滤）
    const healthyProviders = await ProxyProviderResolver.filterByLimits(candidateProviders);
    context.afterHealthCheck = healthyProviders.length;

    // 记录过滤掉的供应商（熔断或限流）
    const filteredOut = candidateProviders.filter(
      (p) => !healthyProviders.find((hp) => hp.id === p.id)
    );

    for (const p of filteredOut) {
      if (
        p.providerVendorId &&
        p.providerVendorId > 0 &&
        (await isVendorTypeCircuitOpen(p.providerVendorId, p.providerType))
      ) {
        context.filteredProviders?.push({
          id: p.id,
          name: p.name,
          reason: "circuit_open",
          details: "vendor_type_circuit_open",
        });
        continue;
      }

      if (await isCircuitOpen(p.id)) {
        const state = getCircuitState(p.id);
        context.filteredProviders?.push({
          id: p.id,
          name: p.name,
          reason: "circuit_open",
          details: state === "open" ? "circuit_open" : "circuit_half_open",
        });
      } else {
        context.filteredProviders?.push({
          id: p.id,
          name: p.name,
          reason: "rate_limited",
          details: "rate_limited",
        });
      }
    }

    if (healthyProviders.length === 0) {
      logger.warn("ProviderSelector: All providers rate limited or unavailable");
      // 所有供应商都被限流或不可用，返回 null 触发 503 错误
      return { provider: null, context };
    }

    // Step 5/6: health-aware cheapest-first, else cheapest among remaining peers.
    // priority/weight are no longer used for ranking (fields kept for schema/UI).
    const { resolveDispatchCost, selectCheapestProvider } = await import(
      "@/lib/provider-dispatch/health-aware-select"
    );
    const costLevels = [
      ...new Set(healthyProviders.map((p) => resolveDispatchCost(p))),
    ].sort((a, b) => a - b);
    // Reuse priorityLevels field in decision context as cost ladder for logs/UI.
    context.priorityLevels = costLevels;

    const healthSloThresholds = await getHealthSloThresholds();
    const healthPick = selectBestHealthDispatchProvider(
      healthyProviders,
      resolveDispatchCost,
      healthSloThresholds
    );

    let selected: Provider;
    let selectionMode: "health_slo" | "legacy_cost";

    if (healthPick) {
      selected = healthPick.provider;
      selectionMode = "health_slo";
      const bestCost = healthPick.candidates[0]?.costMultiplier ?? resolveDispatchCost(selected);
      context.selectedPriority = bestCost;
      const sameCost = healthPick.candidates.filter((c) => c.costMultiplier === bestCost);
      context.candidatesAtPriority = sameCost.map((c) => ({
        id: c.provider.id,
        name: c.provider.name,
        weight: 1,
        costMultiplier: c.costMultiplier,
        probability: sameCost.length > 0 ? 1 / sameCost.length : 0,
      }));
    } else {
      const cheapest = selectCheapestProvider(healthyProviders, resolveDispatchCost);
      if (!cheapest) {
        logger.warn("ProviderSelector: No providers after cost ranking");
        return { provider: null, context };
      }
      selected = cheapest;
      selectionMode = "legacy_cost";
      const bestCost = resolveDispatchCost(selected);
      context.selectedPriority = bestCost;
      const sameCost = healthyProviders.filter((p) => resolveDispatchCost(p) === bestCost);
      context.candidatesAtPriority = sameCost.map((p) => ({
        id: p.id,
        name: p.name,
        weight: 1,
        costMultiplier: resolveDispatchCost(p),
        probability: sameCost.length > 0 ? 1 / sameCost.length : 0,
      }));
    }

    // 详细的选择日志
    logger.info("ProviderSelector: Selection decision", {
      requestedModel,
      totalProviders: visibleProviders.length,
      enabledCount: enabledProviders.length,
      excludedIds: excludeIds,
      userGroup: effectiveGroupPick || "none",
      afterGroupFilter: candidateProviders.map((p) => p.name),
      afterHealthFilter: healthyProviders.length,
      filteredOut: filteredOut.map((p) => p.name),
      selectionMode,
      healthSloCandidates: healthPick?.candidates.map((c) => ({
        id: c.provider.id,
        name: c.provider.name,
        cost: c.costMultiplier,
        onlineRate: c.onlineRate,
        avgFirstByteMs: c.avgFirstByteMs,
      })),
      topCostLevel: context.selectedPriority,
      topCostCandidates: context.candidatesAtPriority,
      selected: {
        name: selected.name,
        id: selected.id,
        type: selected.providerType,
        cost: resolveDispatchCost(selected),
        onlineRate: selected.healthTestOnlineRate,
        avgFirstByteMs: selected.healthTestAvgFirstByteMs,
        circuitState: getCircuitState(selected.id),
      },
    });

    return { provider: selected, context };
  }

  /**
   * 过滤超限供应商
   *
   * 注意：并发 Session 限制检查已移至原子性检查（ensure 方法中），
   * 此处仅检查金额限制和熔断器状态
   */
  private static async filterByLimits(providers: Provider[]): Promise<Provider[]> {
    const results = await Promise.all(
      providers.map(async (p) => {
        // -1. 检查临时熔断（vendor+type）
        if (
          p.providerVendorId &&
          p.providerVendorId > 0 &&
          (await isVendorTypeCircuitOpen(p.providerVendorId, p.providerType))
        ) {
          logger.debug("ProviderSelector: Vendor-type circuit breaker is open", {
            providerId: p.id,
            vendorId: p.providerVendorId,
            providerType: p.providerType,
          });
          return null;
        }

        // 0. 检查熔断器状态
        if (await isCircuitOpen(p.id)) {
          logger.debug("ProviderSelector: Provider circuit breaker is open", {
            providerId: p.id,
          });
          return null;
        }

        // 1. 检查金额限制
        const costCheck = await RateLimitService.checkCostLimitsWithLease(p.id, "provider", {
          limit_5h_usd: p.limit5hUsd,
          limit_5h_reset_mode: p.limit5hResetMode,
          limit_daily_usd: p.limitDailyUsd,
          daily_reset_mode: p.dailyResetMode,
          daily_reset_time: p.dailyResetTime,
          limit_weekly_usd: p.limitWeeklyUsd,
          limit_monthly_usd: p.limitMonthlyUsd,
        });

        if (!costCheck.allowed) {
          logger.debug("ProviderSelector: Provider cost limit exceeded", {
            providerId: p.id,
          });
          return null;
        }

        // 2. 检查总消费上限（无重置窗口，达到后需要管理员取消限额或手动重置）
        const totalCheck = await RateLimitService.checkTotalCostLimit(
          p.id,
          "provider",
          p.limitTotalUsd,
          {
            resetAt: p.totalCostResetAt,
          }
        );

        if (!totalCheck.allowed) {
          logger.debug("ProviderSelector: Provider total cost limit exceeded", {
            providerId: p.id,
            reason: totalCheck.reason,
          });
          return null;
        }

        // 并发 Session 限制已移至原子性检查（avoid race condition）

        return p;
      })
    );

    return results.filter((p): p is Provider => p !== null);
  }

  /**
   * @deprecated Dispatch no longer uses priority. Kept for older tests / log shape.
   * Returns provider.costMultiplier (cheaper = smaller) so callers that still sort
   * by "priority ascending" get cost-first behavior.
   */
  static resolveEffectivePriority(provider: Provider, _userGroup: string | null): number {
    const raw = Number(provider.costMultiplier);
    return Number.isFinite(raw) && raw >= 0 ? raw : 1;
  }

  /**
   * Cheapest cost tier among candidates (replaces old priority tier).
   * Exported via private static so existing unit tests that spy on it keep working.
   */
  private static selectTopPriority(providers: Provider[], _userGroup?: string | null): Provider[] {
    if (providers.length === 0) return [];
    const costs = providers.map((p) => {
      const raw = Number(p.costMultiplier);
      return Number.isFinite(raw) && raw >= 0 ? raw : 1;
    });
    const minCost = Math.min(...costs);
    return providers.filter((p) => {
      const raw = Number(p.costMultiplier);
      const cost = Number.isFinite(raw) && raw >= 0 ? raw : 1;
      return cost === minCost;
    });
  }

  /**
   * Deterministic cheapest pick (no weight random).
   */
  private static selectOptimal(providers: Provider[]): Provider {
    if (providers.length === 0) {
      throw new Error("No providers available for selection");
    }
    if (providers.length === 1) return providers[0];
    const sorted = [...providers].sort((a, b) => {
      const costA = Number.isFinite(a.costMultiplier) ? a.costMultiplier : 1;
      const costB = Number.isFinite(b.costMultiplier) ? b.costMultiplier : 1;
      if (costA !== costB) return costA - costB;
      return a.id - b.id;
    });
    return sorted[0];
  }

  /**
   * @deprecated Weight random removed from dispatch. Always returns cheapest by cost.
   */
  private static weightedRandom(providers: Provider[]): Provider {
    return ProxyProviderResolver.selectOptimal(providers);
  }

  /**
   * 为指定用户和 providerType 选择最优 Provider（用于 /v1/models 端点）
   *
   * 此方法允许直接指定 providerType，用于对不同类型的 provider 进行独立决策
   * （如 openai 格式分别决策 codex 和 openai-compatible）
   */
  static async selectProviderByType(
    authState: {
      user: { id: number; providerGroup: string | null } | null;
      key: { providerGroup: string | null } | null;
    } | null,
    providerType: Provider["providerType"]
  ): Promise<{
    provider: Provider | null;
    context: NonNullable<ProviderChainItem["decisionContext"]>;
  }> {
    const allProviders = await findAllProviders();

    // 分组预过滤
    const effectiveGroupPick =
      authState?.key?.providerGroup || authState?.user?.providerGroup || null;

    let visibleProviders = allProviders;
    if (effectiveGroupPick) {
      visibleProviders = allProviders.filter((p) =>
        checkProviderGroupMatch(p.groupTag, effectiveGroupPick)
      );
    }

    // 按 providerType 精确过滤 + 调度时间窗口
    const systemTimezone = await resolveSystemTimezone();
    const typeFiltered = visibleProviders.filter(
      (p) =>
        p.isEnabled &&
        p.providerType === providerType &&
        isProviderActiveNow(p.activeTimeStart, p.activeTimeEnd, systemTimezone)
    );

    // 将 providerType 映射为 decisionContext 允许的 targetType
    const targetType: "claude" | "codex" | "openai-compatible" | "gemini" | "gemini-cli" =
      providerType === "claude-auth" ? "claude" : providerType;

    if (typeFiltered.length === 0) {
      return {
        provider: null,
        context: {
          totalProviders: visibleProviders.length,
          enabledProviders: 0,
          targetType,
          requestedModel: "",
          groupFilterApplied: !!effectiveGroupPick,
          userGroup: effectiveGroupPick || undefined,
          beforeHealthCheck: 0,
          afterHealthCheck: 0,
          filteredProviders: [],
          priorityLevels: [],
          selectedPriority: 0,
          candidatesAtPriority: [],
        },
      };
    }

    // 健康度检查（熔断器 + 费用限制）
    const healthyProviders = await ProxyProviderResolver.filterByLimits(typeFiltered);

    if (healthyProviders.length === 0) {
      // 被过滤的供应商（健康检查失败）
      const filtered = typeFiltered.map((p) => ({
        id: p.id,
        name: p.name,
        reason: "rate_limited" as const, // 简化：统一标记为 rate_limited
      }));

      return {
        provider: null,
        context: {
          totalProviders: visibleProviders.length,
          enabledProviders: typeFiltered.length,
          targetType,
          requestedModel: "",
          groupFilterApplied: !!effectiveGroupPick,
          userGroup: effectiveGroupPick || undefined,
          beforeHealthCheck: typeFiltered.length,
          afterHealthCheck: 0,
          filteredProviders: filtered,
          priorityLevels: [],
          selectedPriority: 0,
          candidatesAtPriority: [],
        },
      };
    }

    // Health-aware cheapest-first, else cheapest among remaining peers.
    const { resolveDispatchCost, selectCheapestProvider } = await import(
      "@/lib/provider-dispatch/health-aware-select"
    );
    const healthSloThresholds = await getHealthSloThresholds();
    const healthPick = selectBestHealthDispatchProvider(
      healthyProviders,
      resolveDispatchCost,
      healthSloThresholds
    );

    let selected: Provider;
    let candidates: Array<{
      id: number;
      name: string;
      weight: number;
      costMultiplier: number;
      probability: number;
    }>;

    if (healthPick) {
      selected = healthPick.provider;
      const bestCost = healthPick.candidates[0]?.costMultiplier ?? resolveDispatchCost(selected);
      const sameCost = healthPick.candidates.filter((c) => c.costMultiplier === bestCost);
      candidates = sameCost.map((c) => ({
        id: c.provider.id,
        name: c.provider.name,
        weight: 1,
        costMultiplier: c.costMultiplier,
        probability: sameCost.length > 0 ? 1 / sameCost.length : 0,
      }));
    } else {
      const cheapest = selectCheapestProvider(healthyProviders, resolveDispatchCost);
      if (!cheapest) {
        return {
          provider: null,
          context: {
            totalProviders: visibleProviders.length,
            enabledProviders: typeFiltered.length,
            targetType,
            requestedModel: "",
            groupFilterApplied: !!effectiveGroupPick,
            userGroup: effectiveGroupPick || undefined,
            beforeHealthCheck: typeFiltered.length,
            afterHealthCheck: healthyProviders.length,
            filteredProviders: [],
            priorityLevels: [],
            selectedPriority: 0,
            candidatesAtPriority: [],
          },
        };
      }
      selected = cheapest;
      const bestCost = resolveDispatchCost(selected);
      const sameCost = healthyProviders.filter((p) => resolveDispatchCost(p) === bestCost);
      candidates = sameCost.map((p) => ({
        id: p.id,
        name: p.name,
        weight: 1,
        costMultiplier: resolveDispatchCost(p),
        probability: sameCost.length > 0 ? 1 / sameCost.length : 0,
      }));
    }

    return {
      provider: selected,
      context: {
        totalProviders: visibleProviders.length,
        enabledProviders: typeFiltered.length,
        targetType,
        requestedModel: "",
        groupFilterApplied: !!effectiveGroupPick,
        userGroup: effectiveGroupPick || undefined,
        beforeHealthCheck: typeFiltered.length,
        afterHealthCheck: healthyProviders.length,
        filteredProviders: [],
        priorityLevels: [...new Set(healthyProviders.map((p) => resolveDispatchCost(p)))].sort(
          (a, b) => a - b
        ),
        selectedPriority: resolveDispatchCost(selected),
        candidatesAtPriority: candidates,
      },
    };
  }
}

// Export for testing
export {
  checkFormatProviderTypeCompatibility,
  checkProviderGroupMatch,
  isProviderActiveNow,
  providerSupportsModel,
};

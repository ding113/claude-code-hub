import { matchesAllowedModelRules } from "@/lib/allowed-model-rules";
import { getCircuitState, isCircuitOpen } from "@/lib/circuit-breaker";
import { getCachedSystemSettings } from "@/lib/config/system-settings-cache";
import { PROVIDER_GROUP } from "@/lib/constants/provider.constants";
import { logger } from "@/lib/logger";
import {
  selectBestHealthDispatchProvider,
  selectCheapestProvider,
} from "@/lib/provider-dispatch/health-aware-select";
import {
  matchesProviderGroupModelMatchRules,
  type ProviderGroupModelMatchRule,
  type ProviderGroupModelMatchRulesByName,
} from "@/lib/provider-groups/model-match-rules";
import type { ProviderGroupSharedSettings } from "@/lib/provider-groups/shared-settings";
import {
  resolveProviderGroupListsForProvider,
  isProviderAllowedByAllLists,
  type GroupAllowBlockLists,
} from "@/lib/provider-dispatch/group-allow-block";
import {
  resolveProviderHealthTestModelForRequest,
} from "@/lib/provider-health-test/model-config";
import type { HealthTestSloThresholds } from "@/lib/provider-health-test/slo-thresholds";
import { RateLimitService } from "@/lib/rate-limit";
import { getRedisClient } from "@/lib/redis";
import { parseProviderGroups, resolveProviderGroupsWithDefault } from "@/lib/utils/provider-group";
import { isProviderActiveNow } from "@/lib/utils/provider-schedule";
import { resolveSystemTimezone } from "@/lib/utils/timezone";
import { isVendorTypeCircuitOpen } from "@/lib/vendor-type-circuit-breaker";
import { findAllProviders, findProviderById } from "@/repository/provider";
import {
  getGroupCostMultiplier,
  getProviderGroupAllowBlockListsMap,
  getProviderGroupHealthTestModelFallbackMap,
  getProviderGroupHealthTestModelsMap,
  getProviderGroupModelMatchRules,
  getProviderGroupSharedSettingsMap,
} from "@/repository/provider-groups";
import type { ProviderChainItem } from "@/types/message";
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

function resolveHealthGroupScope(
  provider: Provider,
  effectiveGroup: string | null | undefined
): { explicit: boolean; scope: string | null } {
  const requestedGroups = parseProviderGroups(effectiveGroup);
  if (requestedGroups.length === 0 || requestedGroups.includes(PROVIDER_GROUP.ALL)) {
    return { explicit: false, scope: provider.groupTag };
  }

  const providerGroups = new Set(resolveProviderGroupsWithDefault(provider.groupTag));
  const matchingGroups = requestedGroups.filter((group) => providerGroups.has(group));
  return { explicit: true, scope: matchingGroups.length > 0 ? matchingGroups.join(",") : null };
}

/**
 * Check whether a provider passes the group-level allow/block lists for the
 * session's effective dispatch group. Fail-open on lookup errors.
 */
async function checkProviderGroupAllowBlock(
  provider: Provider,
  effectiveGroup: string | null | undefined
): Promise<boolean> {
  if (!effectiveGroup) return true;
  try {
    const listsMap = await getProviderGroupAllowBlockListsMap();
    const lists = resolveProviderGroupListsForProvider(listsMap, effectiveGroup, provider.groupTag);
    return isProviderAllowedByAllLists(provider.id, lists);
  } catch (error) {
    logger.warn("[ProviderSelector] Failed to check group allow/block lists, allowing provider", {
      providerId: provider.id,
      providerName: provider.name,
      effectiveGroup,
      error: error instanceof Error ? error.message : String(error),
    });
    return true;
  }
}

async function getHealthSloThresholds(): Promise<HealthTestSloThresholds> {
  const settings = await getCachedSystemSettings();
  return {
    minOnlineRate: settings.healthTestMinOnlineRatePercent / 100,
    maxAvgLatencyMs: settings.healthTestMaxAvgLatencySeconds * 1000,
    minSampleCount: 1,
  };
}

function projectProviderHealthForRequestedModel(
  provider: Provider,
  requestedModel: string,
  healthTestModelsByGroup: ReadonlyMap<string, string[] | null | undefined>,
  healthTestModelFallbacksByGroup: ReadonlyMap<string, string | null | undefined>,
  effectiveGroup?: string | null
): Provider {
  // When a request is explicitly scoped to a group, do not let a multi-tag
  // provider borrow model stats from one of its other, unrelated tags.
  // `all` intentionally keeps the provider-tag scope because it means every
  // eligible group rather than a literal provider-group row.
  const healthScope = resolveHealthGroupScope(provider, effectiveGroup);
  if (healthScope.explicit && !healthScope.scope) {
    return {
      ...provider,
      healthTestOnlineRate: null,
      healthTestAvgFirstByteMs: null,
      healthTestRecentResults: [],
      lastHealthTestModel: null,
      lastHealthTestOk: null,
      lastHealthTestStatus: null,
      lastHealthTestFirstByteMs: null,
      lastHealthTestLatencyMs: null,
      lastHealthTestErrorType: null,
      lastHealthTestErrorMessage: null,
    };
  }
  const statsModel = resolveProviderHealthTestModelForRequest(
    healthScope.scope,
    requestedModel,
    healthTestModelsByGroup,
    healthTestModelFallbacksByGroup
  );
  if (!statsModel) return provider;

  const stats = provider.healthTestModelStats?.[statsModel];
  const recentResults = stats?.recentResults ?? [];
  const lastSample = recentResults.at(-1) ?? null;
  return {
    ...provider,
    // A configured model without enough independent samples is deliberately
    // projected to an empty/non-qualified window; never fall back to aggregate.
    healthTestOnlineRate: stats?.onlineRate ?? null,
    healthTestAvgFirstByteMs: stats?.avgFirstByteMs ?? null,
    healthTestRecentResults: recentResults,
    lastHealthTestModel: statsModel,
    lastHealthTestOk: lastSample?.ok ?? null,
    lastHealthTestStatus: lastSample?.status ?? null,
    lastHealthTestFirstByteMs: lastSample?.firstByteMs ?? null,
    lastHealthTestLatencyMs: lastSample?.latencyMs ?? null,
    lastHealthTestErrorType: lastSample?.errorType ?? null,
    lastHealthTestErrorMessage: lastSample?.errorMessage ?? null,
  };
}

function projectProvidersHealthForRequestedModel(
  providers: Provider[],
  requestedModel: string,
  healthTestModelsByGroup: ReadonlyMap<string, string[] | null | undefined>,
  healthTestModelFallbacksByGroup: ReadonlyMap<string, string | null | undefined>,
  effectiveGroup?: string | null
): Provider[] {
  return providers.map((provider) =>
    projectProviderHealthForRequestedModel(
      provider,
      requestedModel,
      healthTestModelsByGroup,
      healthTestModelFallbacksByGroup,
      effectiveGroup
    )
  );
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

/**
 * 分组"请求格式 = 不覆盖"（sharedSettings.providerType 显式 null）时，
 * 组内 provider 接受所有客户端请求格式。
 *
 * 数据语义：
 * - providerType === null  → 显式"不覆盖"（UI 选项），路由层放行全部格式
 * - providerType 有值       → 按硬编码格式映射检查
 * - 组不存在/键缺失        → 从未设置，保持原硬编码检查（不改变既有行为）
 */
function isFormatAllowedForProvider(
  format: ClientFormat,
  provider: Provider,
  groupSharedByTag: ReadonlyMap<string, ProviderGroupSharedSettings | null>
): boolean {
  for (const tag of resolveProviderGroupsWithDefault(provider.groupTag)) {
    if (groupSharedByTag.get(tag)?.providerType === null) {
      return true;
    }
  }
  return checkFormatProviderTypeCompatibility(format, provider.providerType);
}

/**
 * 请求是否为流式。非流式请求不做会话复用（session_reuse / global_reuse）：
 * 每次都按健康调度重新选路，避免一次性工具调用等非流式请求粘滞到旧 provider。
 * 与 error-handler 的 isRequestStreaming 判定一致（body.stream / Gemini SSE / alt=sse）。
 */
export function isStreamingRequest(session: ProxySession): boolean {
  return (
    session.request?.message?.stream === true ||
    session.requestUrl?.pathname.includes("streamGenerateContent") ||
    session.requestUrl?.searchParams.get("alt") === "sse"
  );
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

    // === 全局复用（组+模型维度，跨会话复用）===
    // 非流式请求不做全局复用：一次性工具调用等无粘滞价值，每次按健康调度重新选路。
    const reusableRequest = isStreamingRequest(session);
    if (!session.provider && reusableRequest) {
      const reusedProvider = await ProxyProviderResolver.findGlobalReuse(session);
      if (reusedProvider) {
        session.setProvider(reusedProvider);
        session.addProviderToChain(reusedProvider, {
          reason: "global_reuse",
          selectionMethod: "global_reuse",
          circuitState: getCircuitState(reusedProvider.id),
          decisionContext: {
            totalProviders: 0,
            enabledProviders: 0,
            targetType: reusedProvider.providerType as NonNullable<ProviderChainItem["decisionContext"]>["targetType"],
            requestedModel: session.getOriginalModel() || "",
            groupFilterApplied: false,
            beforeHealthCheck: 0,
            afterHealthCheck: 0,
            priorityLevels: [reusedProvider.priority || 0],
            selectedPriority: reusedProvider.priority || 0,
            candidatesAtPriority: [
              {
                id: reusedProvider.id,
                name: reusedProvider.name,
                weight: reusedProvider.weight,
                costMultiplier: reusedProvider.costMultiplier,
              },
            ],
            sessionId: session.sessionId || undefined,
          },
        });
      }
    }

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
            selectionMethod:
              failedContext?.selectionMode ??
              (failedContext?.groupFilterApplied ? "group_filtered" : "cost_fallback"),
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
        // 复用路径（session_reuse/global_reuse）已记录选择来源，不再追加 initial_selection，
        // 否则 summary 格式化器会优先命中空 decisionContext 的 initial_selection 而非复用标记
        if (attemptCount === 1) {
          const chainHasReuse = session
            .getProviderChain()
            .some(
              (item) => item.reason === "session_reuse" || item.reason === "global_reuse"
            );
          if (!chainHasReuse) {
            const successContext = session.getLastSelectionContext();
            session.addProviderToChain(session.provider, {
              reason: "initial_selection",
              selectionMethod:
                successContext?.selectionMode ??
                (successContext?.groupFilterApplied ? "group_filtered" : "cost_fallback"),
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
   * First-byte hedge alternate: next health-SLO qualified peer after excludes,
   * ranked cheapest cost first (候选拉取永远"合格优先 + 倍率便宜优先"）。
   * Returns null when no remaining SLO-qualified candidate exists → do not race.
   * Does not fall back to non-SLO peers.
   *
   * When `sameCostAsProvider` is given (cold-start concurrent discovery), only
   * candidates whose dispatch cost equals the primary's are eligible: racing a
   * more expensive spare buys nothing (cheap primary is already optimal, spare
   * would only wait out the SLA window), and racing a cheaper spare is just a
   * wrong primary pick. Same-cost candidates race with zero wait — fastest
   * first byte wins, no window guard needed. Returns null when no same-cost
   * SLO candidate exists → primary runs single-path until first-byte timeout.
   *
   * `fastestMode`（冷启动双发跨倍率）同样按倍率升序取最便宜的合格备胎——
   * 竞速的"快"由 forwarder 的双发竞争决定（谁先回首字谁赢），不由候选选择承担。
   */
  static async pickHealthSloAlternate(
    session: ProxySession,
    excludeIds: number[],
    sameCostAsProvider?: Provider | null,
    fastestMode?: boolean
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
    const groupSharedByTag = await getProviderGroupSharedSettingsMap();
    const healthTestModelsByGroup = await getProviderGroupHealthTestModelsMap();
    const healthTestModelFallbacksByGroup = await getProviderGroupHealthTestModelFallbackMap();
    let groupAllowBlockLists: ReadonlyMap<string, GroupAllowBlockLists> | null = null;
    try {
      groupAllowBlockLists = await getProviderGroupAllowBlockListsMap();
    } catch (error) {
      logger.warn("ProviderSelector: Failed to load group allow/block lists, skipping filter", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const pool = allProviders.filter((provider) => {
      if (!provider.isEnabled || excludeSet.has(provider.id)) return false;
      if (!isProviderActiveNow(provider.activeTimeStart, provider.activeTimeEnd, systemTimezone)) {
        return false;
      }
      if (effectiveGroupPick && !checkProviderGroupMatch(provider.groupTag, effectiveGroupPick)) {
        return false;
      }
      if (effectiveGroupPick) {
        const lists = resolveProviderGroupListsForProvider(
          groupAllowBlockLists,
          effectiveGroupPick,
          provider.groupTag
        );
        if (!isProviderAllowedByAllLists(provider.id, lists)) {
          return false;
        }
      }
      if (session.originalFormat) {
        if (
          !isFormatAllowedForProvider(session.originalFormat, provider, groupSharedByTag)
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

    // 冷启动并发发现：fastestMode（跨倍率）时备胎从 SLO 合格池里选**倍率最低**的候选
    // （与主路 cheapest 构成双发，竞争由 forwarder 决定谁先回首字谁赢）——不是选延迟
    // 最快的：竞速机制保证"两个竞争选最快"，但候选拉取始终按"合格优先 + 倍率便宜优先"。
    // 非 fastestMode 且带 sameCostAsProvider 时保持"仅同倍率候选"约束（超时接力场景）。
    const healthSloThresholds = await getHealthSloThresholds();
    let selected: Provider | null = null;
    if (fastestMode) {
      const { listHealthDispatchCandidates } = await import(
        "@/lib/provider-dispatch/health-aware-select"
      );
      // listHealthDispatchCandidates 默认排序即倍率升序 → 取第一个 = 最便宜的合格备胎。
      const sloCandidates = listHealthDispatchCandidates(
        pool,
        resolveDispatchCost,
        healthSloThresholds
      ).filter((c) => !excludeSet.has(c.provider.id));
      selected = sloCandidates[0]?.provider ?? null;
    } else {
      const sameCostPool = sameCostAsProvider
        ? pool.filter(
            (provider) =>
              resolveDispatchCost(provider) === resolveDispatchCost(sameCostAsProvider)
          )
        : pool;

      const projectedPool = projectProvidersHealthForRequestedModel(
        sameCostPool,
        requestedModel,
        healthTestModelsByGroup,
        healthTestModelFallbacksByGroup,
        effectiveGroupPick
      );
      const selectedCandidate = selectNextHealthDispatchAlternate(
        projectedPool,
        resolveDispatchCost,
        excludeIds,
        healthSloThresholds
      );
      selected = selectedCandidate
        ? (pool.find((provider) => provider.id === selectedCandidate.id) ??
          selectedCandidate)
        : null;
    }
    return selected;
  }

  /**
   * 构建全局复用 Redis 键（组+模型维度）。
   *
   * ⚠️ 读写**必须**共用此函数，否则键维度漂移会导致读不到首选。
   * groupTag 分支逻辑与 resolveEffectiveProviderGroup 一致，但**忽略 session.provider**：
   *   读取侧此时 provider 为 null（仅在 !session.provider 时调用）；
   *   写入侧 provider 已设为 currentProvider——若依赖 groupTag 会得到 provider 自身标签，
   *   与读取侧的 session key/user 组对不上。
   *
   * 键不含请求格式/providerType 维度：跨格式同模型也要复用（用户 2026-08-13 拍板）。
   */
  static async buildGlobalReuseKey(
    session: ProxySession,
    modelOverride?: string | null
  ): Promise<string | null> {
    // modelOverride 用于竞速赢家结算：winner 为备胎时 sync 已把 session 模型覆盖成
    // 备胎的，但全局复用键必须以原请求模型为准，否则后续同模型请求匹配不到。
    const model = modelOverride ?? session.getOriginalModel();
    if (!model) return null;

    // 与 resolveEffectiveProviderGroup 的 key→user→null 优先级一致
    const key = session.authState?.key;
    const user = session.authState?.user;
    const groupTag = key
      ? key.providerGroup || PROVIDER_GROUP.DEFAULT
      : user
        ? user.providerGroup || PROVIDER_GROUP.DEFAULT
        : null;
    if (!groupTag) return null;

    return `cch:global:reuse:${groupTag}:${model}`;
  }

  /**
   * 查找全局复用首选（组+模型维度）
   *
   * 每次请求成功后都会把 provider 写入全局 Redis 键，同一组+同模型的其他会话
   * 选路时优先使用（跨会话粘滞）。键由新成功覆盖旧值；TTL 防止长期不活跃的 provider 占位。
   * 选路时复用资格检查（模型支持/熔断/限额等），不匹配则跳过回退正常调度。
   */
  private static async findGlobalReuse(session: ProxySession): Promise<Provider | null> {
    const key = await this.buildGlobalReuseKey(session);
    if (!key) return null;

    const model = session.getOriginalModel();

    const redis = getRedisClient();
    if (!redis || redis.status !== "ready") return null;

    try {
      const value = await redis.get(key);
      if (!value) return null;

      const providerId = parseInt(value, 10);
      if (Number.isNaN(providerId)) return null;

      const provider = await findProviderById(providerId);
      if (!provider?.isEnabled) return null;

      // 资格检查（不写 session 绑定；全局复用同样不可绕过熔断/限额/分组）
      if (provider.disableSessionReuse) return null;

      const systemTimezone = await resolveSystemTimezone();
      if (!isProviderActiveNow(provider.activeTimeStart, provider.activeTimeEnd, systemTimezone)) return null;

      if (provider.providerVendorId && provider.providerVendorId > 0 && (await isVendorTypeCircuitOpen(provider.providerVendorId, provider.providerType))) return null;

      if (await isCircuitOpen(provider.id)) return null;

      // 不再检查请求格式：跨格式同模型也复用（用户 2026-08-13 拍板）

      if (model && !providerSupportsModel(provider, model)) return null;

      const providerAllowed = provider.allowedClients ?? [];
      const providerBlocked = provider.blockedClients ?? [];
      const clientResult = isClientAllowedDetailed(session, providerAllowed, providerBlocked);
      if (!clientResult.allowed) return null;

      const effectiveGroup = getEffectiveProviderGroup(session);
      if (effectiveGroup && !checkProviderGroupMatch(provider.groupTag, effectiveGroup)) return null;

      // 分组白/黑名单：全局复用也不能绕过
      if (!(await checkProviderGroupAllowBlock(provider, effectiveGroup))) return null;

      // 限额检查
      const costCheck = await RateLimitService.checkCostLimitsWithLease(provider.id, "provider", {
        limit_5h_usd: provider.limit5hUsd,
        limit_5h_reset_mode: provider.limit5hResetMode,
        limit_daily_usd: provider.limitDailyUsd,
        daily_reset_mode: provider.dailyResetMode,
        daily_reset_time: provider.dailyResetTime,
        limit_weekly_usd: provider.limitWeeklyUsd,
        limit_monthly_usd: provider.limitMonthlyUsd,
      });
      if (!costCheck.allowed) return null;

      const totalCheck = await RateLimitService.checkTotalCostLimit(provider.id, "provider", provider.limitTotalUsd, { resetAt: provider.totalCostResetAt });
      if (!totalCheck.allowed) return null;

      logger.info("ProviderSelector: Using global reuse", {
        providerName: provider.name,
        providerId: provider.id,
        model,
        key,
      });

      return provider;
    } catch (error) {
      logger.error("ProviderSelector: Failed to read global reuse", { error });
      return null;
    }
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

    // === Step 1.5: 分组白/黑名单过滤（先白后黑）===
    if (effectiveGroupPick && visibleProviders.length > 0) {
      const allowBlockFiltered: typeof visibleProviders = [];
      for (const p of visibleProviders) {
        if (await checkProviderGroupAllowBlock(p, effectiveGroupPick)) {
          allowBlockFiltered.push(p);
        }
      }
      logger.debug("ProviderSelector: Group allow/block filter applied (silent)", {
        effectiveGroup: effectiveGroupPick,
        beforeCount: visibleProviders.length,
        filteredCount: allowBlockFiltered.length,
      });
      visibleProviders = allowBlockFiltered;
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
    const groupSharedByTag = await getProviderGroupSharedSettingsMap();
    const healthTestModelsByGroup = await getProviderGroupHealthTestModelsMap();
    const healthTestModelFallbacksByGroup = await getProviderGroupHealthTestModelFallbackMap();

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
      // 分组"请求格式=不覆盖"（providerType 显式 null）时放行所有格式
      if (session?.originalFormat) {
        const isFormatCompatible = isFormatAllowedForProvider(
          session.originalFormat,
          provider,
          groupSharedByTag
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
          !isFormatAllowedForProvider(session.originalFormat, p, groupSharedByTag)
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

    // Step 5/6: qualified health SLO first, else shortest average total latency.
    // priority/weight are no longer used for ranking (fields kept for schema/UI).
    const { resolveDispatchCost } = await import(
      "@/lib/provider-dispatch/health-aware-select"
    );
    const costLevels = [
      ...new Set(healthyProviders.map((p) => resolveDispatchCost(p))),
    ].sort((a, b) => a - b);
    // Reuse priorityLevels field in decision context as integer priority ladder
    // (0 = cheapest) for logs/UI, instead of exposing raw cost multipliers.
    context.priorityLevels = costLevels.map((_, index) => index);

    const healthSloThresholds = await getHealthSloThresholds();
    const healthSelectionProviders = projectProvidersHealthForRequestedModel(
      healthyProviders,
      requestedModel,
      healthTestModelsByGroup,
      healthTestModelFallbacksByGroup,
      effectiveGroupPick
    );
    const healthPick = selectBestHealthDispatchProvider(
      healthSelectionProviders,
      resolveDispatchCost,
      healthSloThresholds
    );

    let selected: Provider;
    let selectedHealthView: Provider;
    let selectionMode: "health_slo" | "latency_fallback";

    if (healthPick) {
      selected =
        healthyProviders.find((provider) => provider.id === healthPick.provider.id) ??
        healthPick.provider;
      selectedHealthView = healthPick.provider;
      selectionMode = "health_slo";
      const bestCost = healthPick.candidates[0]?.costMultiplier ?? resolveDispatchCost(selected);
      const bestCostIndex = costLevels.indexOf(bestCost);
      context.selectedPriority = bestCostIndex >= 0 ? bestCostIndex : 0;
      const sameCost = healthPick.candidates.filter((c) => c.costMultiplier === bestCost);
      context.candidatesAtPriority = sameCost.map((c) => ({
        id: c.provider.id,
        name: c.provider.name,
        weight: 1,
        costMultiplier: c.costMultiplier,
        probability: sameCost.length > 0 ? 1 / sameCost.length : 0,
      }));
    } else {
      // 无 SLO 合格候选：不合格的也按倍率便宜优先（用户拍板：候选拉取始终
      // "合格优先 + 倍率便宜优先"，合格拉完拉不合格，不合格同样倍率低者先）。
      const cheapest = selectCheapestProvider(healthSelectionProviders, resolveDispatchCost);
      if (!cheapest) {
        logger.warn("ProviderSelector: No providers after latency ranking");
        return { provider: null, context };
      }
      selected = healthyProviders.find((provider) => provider.id === cheapest.id) ?? cheapest;
      selectedHealthView = cheapest;
      selectionMode = "latency_fallback";
      const bestCost = resolveDispatchCost(selected);
      const bestCostIndex = costLevels.indexOf(bestCost);
      context.selectedPriority = bestCostIndex >= 0 ? bestCostIndex : 0;
      const sameCost = healthyProviders.filter((p) => resolveDispatchCost(p) === bestCost);
      context.candidatesAtPriority = sameCost.map((p) => ({
        id: p.id,
        name: p.name,
        weight: 1,
        costMultiplier: resolveDispatchCost(p),
        probability: sameCost.length > 0 ? 1 / sameCost.length : 0,
      }));
    }

    context.selectionMode = selectionMode;

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
        onlineRate: selectedHealthView.healthTestOnlineRate,
        avgFirstByteMs: selectedHealthView.healthTestAvgFirstByteMs,
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
      const allowBlockFiltered: typeof visibleProviders = [];
      for (const p of visibleProviders) {
        if (await checkProviderGroupAllowBlock(p, effectiveGroupPick)) {
          allowBlockFiltered.push(p);
        }
      }
      visibleProviders = allowBlockFiltered;
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

    // Qualified health SLO first, else shortest average total latency.
    const { resolveDispatchCost } = await import(
      "@/lib/provider-dispatch/health-aware-select"
    );
    const healthSloThresholds = await getHealthSloThresholds();
    const [healthTestModelsByGroup, healthTestModelFallbacksByGroup] = await Promise.all([
      getProviderGroupHealthTestModelsMap(),
      getProviderGroupHealthTestModelFallbackMap(),
    ]);
    const healthSelectionProviders = projectProvidersHealthForRequestedModel(
      healthyProviders,
      "",
      healthTestModelsByGroup,
      healthTestModelFallbacksByGroup,
      effectiveGroupPick
    );
    const healthPick = selectBestHealthDispatchProvider(
      healthSelectionProviders,
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
      selected =
        healthyProviders.find((provider) => provider.id === healthPick.provider.id) ??
        healthPick.provider;
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
      // 无 SLO 合格候选：不合格的也按倍率便宜优先（与 pickRandomProvider 主路一致）。
      const cheapest = selectCheapestProvider(healthSelectionProviders, resolveDispatchCost);
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
      selected = healthyProviders.find((provider) => provider.id === cheapest.id) ?? cheapest;
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

    const costLevels = [...new Set(healthyProviders.map((p) => resolveDispatchCost(p)))].sort(
      (a, b) => a - b
    );

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
        selectionMode: healthPick ? "health_slo" : "latency_fallback",
        filteredProviders: [],
        priorityLevels: costLevels.map((_, index) => index),
        selectedPriority: Math.max(0, costLevels.indexOf(resolveDispatchCost(selected))),
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

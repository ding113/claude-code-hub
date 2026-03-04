import { getCircuitState, isCircuitOpen } from "@/lib/circuit-breaker";
import { PROVIDER_GROUP } from "@/lib/constants/provider.constants";
import { logger } from "@/lib/logger";
import { RateLimitService } from "@/lib/rate-limit";
import { SessionManager } from "@/lib/session-manager";
import { findAllProviders } from "@/repository/provider";
import { getSystemSettings } from "@/repository/system-config";
import type { ProviderChainItem } from "@/types/message";
import type { Provider } from "@/types/provider";
import type { ClientFormat } from "./format-mapper";
import { ProxyResponses } from "./responses";
import type { ProxySession } from "./session";

// 系统设置缓存 - 避免每次请求失败都查询数据库
const SETTINGS_CACHE_TTL_MS = 60_000; // 60 seconds
let cachedVerboseProviderError: { value: boolean; expiresAt: number } | null = null;

async function getVerboseProviderErrorCached(): Promise<boolean> {
  const now = Date.now();
  if (cachedVerboseProviderError && cachedVerboseProviderError.expiresAt > now) {
    return cachedVerboseProviderError.value;
  }

  try {
    const systemSettings = await getSystemSettings();
    cachedVerboseProviderError = {
      value: systemSettings.verboseProviderError,
      expiresAt: now + SETTINGS_CACHE_TTL_MS,
    };
    return systemSettings.verboseProviderError;
  } catch (e) {
    logger.warn(
      "ProviderSelector: Failed to get system settings, using default verboseError=false",
      { error: e }
    );
    return false;
  }
}

/**
 * 解析逗号分隔的分组字符串为数组
 *
 * @param groupString - 逗号分隔的分组字符串
 * @returns 清理后的分组数组（去空格、去空项）
 */
function parseGroupString(groupString: string): string[] {
  return groupString
    .split(",")
    .map((g) => g.trim())
    .filter(Boolean);
}

/**
 * 获取有效的供应商分组（优先级：key.providerGroup > user.providerGroup）
 *
 * @param session - 代理会话对象
 * @returns 有效分组字符串，或 null（无认证信息时）
 */
function getEffectiveProviderGroup(session?: ProxySession): string | null {
  if (!session?.authState) {
    return null;
  }
  const { key, user } = session.authState;
  if (key) {
    return key.providerGroup || PROVIDER_GROUP.DEFAULT;
  }
  if (user) {
    return user.providerGroup || PROVIDER_GROUP.DEFAULT;
  }
  return PROVIDER_GROUP.DEFAULT;
}

/**
 * 检查供应商分组是否匹配用户分组（支持多分组逗号分隔）
 *
 * @param providerGroupTag - 供应商的 groupTag 字段（可为 null 或逗号分隔的多标签）
 * @param userGroups - 用户/密钥的分组配置（逗号分隔的多分组）
 * @returns 是否存在交集（true = 匹配）
 */
function checkProviderGroupMatch(providerGroupTag: string | null, userGroups: string): boolean {
  const groups = parseGroupString(userGroups);

  if (groups.includes(PROVIDER_GROUP.ALL)) {
    return true;
  }

  const providerTags = providerGroupTag
    ? parseGroupString(providerGroupTag)
    : [PROVIDER_GROUP.DEFAULT];

  return providerTags.some((tag) => groups.includes(tag));
}

/**
 * 检查供应商是否支持指定模型（用于调度器匹配）
 *
 * 核心逻辑：
 * 1. Claude 模型请求 (claude-*)：
 *    - Anthropic 提供商：根据 allowedModels 白名单判断
 *    - 非 Anthropic 提供商 + joinClaudePool：检查模型重定向是否指向 claude-* 模型
 *    - 非 Anthropic 提供商（未加入 Claude 调度池）：不支持
 *
 * 2. 非 Claude 模型请求 (gpt-*, gemini-*, 或其他任意模型)：
 *    - Anthropic 提供商：不支持（仅支持 Claude 模型）
 *    - 非 Anthropic 提供商（codex, gemini-cli, openai-compatible）：
 *      a. 如果未设置 allowedModels（null 或空数组）：接受任意模型
 *      b. 如果设置了 allowedModels：检查模型是否在声明列表中，或有模型重定向配置
 *      注意：allowedModels 是声明性列表（用户可填写任意字符串），用于调度器匹配，不是真实模型校验
 *
 * @param provider - 供应商信息
 * @param requestedModel - 用户请求的模型名称
 * @returns 是否支持该模型（用于调度器筛选）
 */
function providerSupportsModel(provider: Provider, requestedModel: string): boolean {
  const isClaudeModel = requestedModel.startsWith("claude-");
  const isClaudeProvider =
    provider.providerType === "claude" || provider.providerType === "claude-auth";

  // Case 1: Claude 模型请求
  if (isClaudeModel) {
    // 1a. Anthropic 提供商
    if (isClaudeProvider) {
      // 未设置 allowedModels 或为空数组：允许所有 claude 模型
      if (!provider.allowedModels || provider.allowedModels.length === 0) {
        return true;
      }
      // 检查白名单
      return provider.allowedModels.includes(requestedModel);
    }

    // 1b. 非 Anthropic 提供商 + joinClaudePool
    if (provider.joinClaudePool) {
      const redirectedModel = provider.modelRedirects?.[requestedModel];
      // 检查是否重定向到 claude 模型
      return redirectedModel?.startsWith("claude-") || false;
    }

    // 1c. 其他情况：非 Anthropic 提供商且未加入 Claude 调度池
    return false;
  }

  // Case 2: 非 Claude 模型请求（gpt-*, gemini-*, 或其他任意模型）
  // 2a. 优先检查显式声明（支持跨类型代理）
  // 原因：允许 Claude 类型供应商通过 allowedModels/modelRedirects 声明支持非 Claude 模型
  // 场景：Claude 供应商配置模型重定向，将 gemini-* 请求转发到真实的 Gemini 上游
  const explicitlyDeclared = !!(
    provider.allowedModels?.includes(requestedModel) || provider.modelRedirects?.[requestedModel]
  );

  if (explicitlyDeclared) {
    return true; // 显式声明优先级最高，允许跨类型代理
  }

  // 2b. Anthropic 提供商不支持非声明的非 Claude 模型
  // 保护机制：防止将非 Claude 模型误路由到 Anthropic API
  if (isClaudeProvider) {
    return false;
  }

  // 2c. 非 Anthropic 提供商（codex, gemini, gemini-cli, openai-compatible）
  // allowedModels 是声明列表，用于调度器匹配提供商
  // 用户可以手动填写任意模型名称（不限于真实模型），用于声明该提供商"支持"哪些模型

  // 未设置 allowedModels 或为空数组：接受任意模型（由上游提供商判断）
  if (!provider.allowedModels || provider.allowedModels.length === 0) {
    return true;
  }

  // 不在声明列表中且无重定向配置（前面已检查过 explicitlyDeclared）
  return false;
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

    // === 会话复用 ===
    const reusedProvider = await ProxyProviderResolver.findReusable(session);
    if (reusedProvider) {
      session.setProvider(reusedProvider);

      // 记录会话复用上下文
      session.addProviderToChain(reusedProvider, {
        reason: "session_reuse",
        selectionMethod: "session_reuse",
        circuitState: getCircuitState(reusedProvider.id),
        decisionContext: {
          totalProviders: 0, // 复用不需要筛选
          enabledProviders: 0,
          targetType: reusedProvider.providerType as NonNullable<
            ProviderChainItem["decisionContext"]
          >["targetType"],
          requestedModel: session.getCurrentModel() || "",
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

    // === 首次选择或重试 ===
    if (!session.provider) {
      const { provider, context } = await ProxyProviderResolver.pickRandomProvider(
        session,
        excludedProviders
      );
      session.setProvider(provider);
      session.setLastSelectionContext(context); // 保存用于后续记录
    }

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
                  requestedModel: session.getCurrentModel() || "",
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
          continue; // 继续下一次循环，检查新供应商
        }

        // === 成功 ===
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
              requestedModel: session.getCurrentModel() || "",
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

        // 计算可用供应商数量（排除禁用和模型不支持的）
        const unavailableCount = rateLimited.length + circuitOpen.length;
        const totalEnabled = filteredProviders.length - disabled.length - modelNotAllowed.length;

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
      // C-001: 脱敏供应商名称，仅暴露 id 和 reason
      details.filteredProviders = filteredProviders.map((p) => ({
        id: p.id,
        reason: p.reason,
      }));
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
   * 查找可复用的供应商（基于 session）
   */
  private static async findReusable(session: ProxySession): Promise<Provider | null> {
    if (!session.sessionId) {
      return null;
    }

    // 优先级 1: 检查固定 provider（心跳配置匹配的请求）
    const fixedProviderId = await SessionManager.getSessionFixedProvider(session.sessionId);
    if (fixedProviderId) {
      const provider = await session.getProviderById(fixedProviderId);
      if (provider && provider.isEnabled) {
        // 检查健康状态（熔断、限额等）
        const healthCheck = await ProxyProviderResolver.checkProviderHealth(session, provider);
        if (healthCheck.healthy) {
          logger.info("ProviderSelector: Reusing fixed provider (heartbeat match)", {
            providerName: provider.name,
            providerId: provider.id,
            sessionId: session.sessionId,
          });
          return provider;
        } else {
          // 固定 provider 不健康，清除固定绑定并继续检查普通绑定
          logger.info("ProviderSelector: Fixed provider unhealthy, clearing binding", {
            providerId: fixedProviderId,
            reason: healthCheck.reason,
          });
          void SessionManager.deleteSessionFixedProvider(session.sessionId).catch((error) => {
            logger.error("ProviderSelector: Failed to delete fixed provider binding", { error });
          });
        }
      }
    }

    // 优先级 2: 检查普通 session 绑定的 provider（需要消息数 > 1）
    if (!session.shouldReuseProvider()) {
      return null;
    }

    // 从 Redis 读取该 session 绑定的 provider
    const providerId = await SessionManager.getSessionProvider(session.sessionId);
    if (!providerId) {
      logger.debug("ProviderSelector: Session has no bound provider", {
        sessionId: session.sessionId,
      });
      return null;
    }

    // 验证 provider 可用性（使用请求级缓存）
    const provider = await session.getProviderById(providerId);
    if (!provider || !provider.isEnabled) {
      logger.debug("ProviderSelector: Session provider unavailable", {
        sessionId: session.sessionId,
        providerId,
      });
      return null;
    }

    // 检查健康状态（熔断、限额等）
    const healthCheck = await ProxyProviderResolver.checkProviderHealth(session, provider);
    if (!healthCheck.healthy) {
      logger.debug("ProviderSelector: Session provider unhealthy", {
        sessionId: session.sessionId,
        providerId: provider.id,
        reason: healthCheck.reason,
      });
      return null;
    }

    logger.info("ProviderSelector: Reusing provider", {
      providerName: provider.name,
      providerId: provider.id,
      sessionId: session.sessionId,
    });
    return provider;
  }

  /**
   * 检查供应商健康状态（统一检查熔断、限额等）
   *
   * 重要：如果服务商禁用了自动熔断（circuitBreakerDisabled = true），
   * 则跳过熔断检查和费用限制检查，确保服务商完全可用（与 filterByLimits 逻辑一致）
   * 但仍然检查模型支持和用户分组权限（这些是配置限制，不是运行时限制）
   */
  private static async checkProviderHealth(
    session: ProxySession,
    provider: Provider
  ): Promise<{ healthy: boolean; reason?: string }> {
    // 检查模型支持（配置限制，始终检查）
    const requestedModel = session.getCurrentModel();
    if (requestedModel && !providerSupportsModel(provider, requestedModel)) {
      return {
        healthy: false,
        reason: "model_not_supported",
      };
    }

    // 检查用户分组权限（配置限制，始终检查）
    const effectiveGroup = getEffectiveProviderGroup(session);
    if (effectiveGroup && !checkProviderGroupMatch(provider.groupTag, effectiveGroup)) {
      return {
        healthy: false,
        reason: "group_mismatch",
      };
    }

    // 如果禁用了自动熔断，跳过熔断检查和费用限制检查
    // 重要：必须先检查 circuitBreakerDisabled，因为它来自供应商对象（实时更新），
    // 而 isCircuitOpen 依赖熔断器配置缓存（有 5 分钟 TTL），可能存在延迟
    if (provider.circuitBreakerDisabled) {
      logger.debug(
        "ProviderSelector: Provider has circuit breaker disabled, skipping circuit and cost checks in health check",
        {
          providerId: provider.id,
          providerName: provider.name,
        }
      );
      return { healthy: true };
    }

    // 检查熔断器状态
    if (await isCircuitOpen(provider.id)) {
      return {
        healthy: false,
        reason: "circuit_open",
      };
    }

    // 检查费用限额
    const costCheck = await RateLimitService.checkCostLimits(provider.id, "provider", {
      limit_5h_usd: provider.limit5hUsd,
      limit_daily_usd: provider.limitDailyUsd,
      daily_reset_mode: provider.dailyResetMode,
      daily_reset_time: provider.dailyResetTime,
      limit_weekly_usd: provider.limitWeeklyUsd,
      limit_monthly_usd: provider.limitMonthlyUsd,
    });

    if (!costCheck.allowed) {
      return {
        healthy: false,
        reason: "cost_limit_exceeded",
      };
    }

    const totalCheck = await RateLimitService.checkTotalCostLimit(
      provider.id,
      "provider",
      provider.limitTotalUsd,
      {
        resetAt: provider.totalCostResetAt,
      }
    );

    if (!totalCheck.allowed) {
      return {
        healthy: false,
        reason: "total_cost_limit_exceeded",
      };
    }

    return { healthy: true };
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
    const requestedModel = session?.getCurrentModel() || "";

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

    // Step 2: 基础过滤 + 格式/模型匹配（使用 visibleProviders）
    const enabledProviders = visibleProviders.filter((provider) => {
      // 2a. 基础过滤
      if (!provider.isEnabled || excludeIds.includes(provider.id)) {
        return false;
      }

      // 2b. 格式类型匹配（新增）
      // 根据 session.originalFormat 限制候选供应商类型，避免格式错配
      // joinOpenAIPool：允许 claude/claude-auth 供应商加入 openai 调度池
      if (session?.originalFormat) {
        const isFormatCompatible =
          checkFormatProviderTypeCompatibility(session.originalFormat, provider.providerType) ||
          (session.originalFormat === "openai" &&
            (provider.providerType === "claude" || provider.providerType === "claude-auth") &&
            provider.joinOpenAIPool);
        if (!isFormatCompatible) {
          return false; // 过滤掉格式不兼容的供应商
        }
      }

      // 2c. 模型匹配（保留原有逻辑）
      if (!requestedModel) {
        // 没有模型信息时，只选择 Anthropic 提供商（向后兼容）
        return provider.providerType === "claude";
      }

      return providerSupportsModel(provider, requestedModel);
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
          | "context_1m_disabled"
          | "disabled" = "disabled";
        let details = "";

        if (!p.isEnabled) {
          reason = "disabled";
          details = "供应商已禁用";
        } else if (excludeIds.includes(p.id)) {
          reason = "excluded";
          details = "已在前序尝试中失败";
        } else if (
          session?.originalFormat &&
          !checkFormatProviderTypeCompatibility(session.originalFormat, p.providerType) &&
          !(
            session.originalFormat === "openai" &&
            (p.providerType === "claude" || p.providerType === "claude-auth") &&
            p.joinOpenAIPool
          )
        ) {
          reason = "format_type_mismatch";
          details = `原始格式 ${session.originalFormat} 与供应商类型 ${p.providerType} 不兼容`;
        } else if (requestedModel && !providerSupportsModel(p, requestedModel)) {
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

    // Step 2.5: 1M Context filter - 当客户端请求 1M 上下文时，过滤掉禁用的供应商
    let afterContext1mFilter = enabledProviders;
    const clientRequestsContext1m = session?.clientRequestsContext1m() ?? false;
    if (clientRequestsContext1m) {
      afterContext1mFilter = enabledProviders.filter((p) => {
        // 只有 context1mPreference === 'disabled' 的供应商才会被过滤
        // 'inherit' 和 'force_enable' 都允许
        return p.context1mPreference !== "disabled";
      });

      // 记录被 1M context 过滤的供应商
      for (const p of enabledProviders) {
        if (!afterContext1mFilter.includes(p)) {
          context.filteredProviders?.push({
            id: p.id,
            name: p.name,
            reason: "context_1m_disabled",
            details: "供应商禁用了 1M 上下文功能",
          });
        }
      }

      if (afterContext1mFilter.length === 0) {
        logger.warn("ProviderSelector: No providers support 1M context", {
          requestedModel,
          totalProviders: allProviders.length,
          enabledCount: enabledProviders.length,
        });
        return { provider: null, context };
      }
    }

    // Step 3: 候选供应商（分组过滤已在 Step 1 完成，1M 过滤在 Step 2.5 完成）
    const candidateProviders = afterContext1mFilter;
    context.afterGroupFilter = afterContext1mFilter.length;

    context.beforeHealthCheck = candidateProviders.length;

    // Step 4: 过滤超限供应商（健康度过滤）
    const healthyProviders = await ProxyProviderResolver.filterByLimits(candidateProviders);
    context.afterHealthCheck = healthyProviders.length;

    // 记录过滤掉的供应商（熔断或限流）
    const filteredOut = candidateProviders.filter(
      (p) => !healthyProviders.find((hp) => hp.id === p.id)
    );

    for (const p of filteredOut) {
      if (await isCircuitOpen(p.id)) {
        const state = getCircuitState(p.id);
        context.filteredProviders?.push({
          id: p.id,
          name: p.name,
          reason: "circuit_open",
          details: `熔断器${state === "open" ? "打开" : "半开"}`,
        });
      } else {
        context.filteredProviders?.push({
          id: p.id,
          name: p.name,
          reason: "rate_limited",
          details: "费用限制",
        });
      }
    }

    if (healthyProviders.length === 0) {
      logger.warn("ProviderSelector: All providers rate limited or unavailable");
      // 所有供应商都被限流或不可用，返回 null 触发 503 错误
      return { provider: null, context };
    }

    // Step 5: 优先级分层（只选择最高优先级的供应商）
    const topPriorityProviders = ProxyProviderResolver.selectTopPriority(healthyProviders);
    const priorities = [...new Set(healthyProviders.map((p) => p.priority || 0))].sort(
      (a, b) => a - b
    );
    context.priorityLevels = priorities;
    context.selectedPriority = Math.min(...healthyProviders.map((p) => p.priority || 0));

    // Step 6: 成本排序 + 加权选择 + 计算概率
    const totalWeight = topPriorityProviders.reduce((sum, p) => sum + p.weight, 0);
    context.candidatesAtPriority = topPriorityProviders.map((p) => ({
      id: p.id,
      name: p.name,
      weight: p.weight,
      costMultiplier: p.costMultiplier,
      probability: totalWeight > 0 ? Math.round((p.weight / totalWeight) * 100) : 0,
    }));

    const selected = ProxyProviderResolver.selectOptimal(topPriorityProviders);

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
      topPriorityLevel: context.selectedPriority,
      topPriorityCandidates: context.candidatesAtPriority,
      selected: {
        name: selected.name,
        id: selected.id,
        type: selected.providerType,
        priority: selected.priority,
        weight: selected.weight,
        cost: selected.costMultiplier,
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
   *
   * 重要：如果服务商禁用了自动熔断（circuitBreakerDisabled = true），
   * 则跳过所有费用限制检查，确保服务商完全可用
   */
  private static async filterByLimits(providers: Provider[]): Promise<Provider[]> {
    const results = await Promise.all(
      providers.map(async (p) => {
        // 0. 如果禁用了自动熔断，跳过所有限制检查（熔断、费用等），确保服务商完全可用
        // 重要：必须先检查 circuitBreakerDisabled，因为它来自供应商对象（实时更新），
        // 而 isCircuitOpen 依赖熔断器配置缓存（有 5 分钟 TTL），可能存在延迟
        if (p.circuitBreakerDisabled) {
          logger.debug(
            "ProviderSelector: Provider has circuit breaker disabled, skipping all limit checks",
            {
              providerId: p.id,
              providerName: p.name,
            }
          );
          return p;
        }

        // 1. 检查熔断器状态
        if (await isCircuitOpen(p.id)) {
          logger.debug("ProviderSelector: Provider circuit breaker is open", {
            providerId: p.id,
          });
          return null;
        }

        // 1. 检查金额限制
        const costCheck = await RateLimitService.checkCostLimits(p.id, "provider", {
          limit_5h_usd: p.limit5hUsd,
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
   * 优先级分层：只选择最高优先级的供应商
   */
  private static selectTopPriority(providers: Provider[]): Provider[] {
    if (providers.length === 0) {
      return [];
    }

    // 找到最小的优先级值（最高优先级）
    const minPriority = Math.min(...providers.map((p) => p.priority || 0));

    // 只返回该优先级的供应商
    return providers.filter((p) => (p.priority || 0) === minPriority);
  }

  /**
   * 成本排序 + 加权选择：在同优先级内，按成本排序后加权随机
   */
  private static selectOptimal(providers: Provider[]): Provider {
    if (providers.length === 0) {
      throw new Error("No providers available for selection");
    }

    if (providers.length === 1) {
      return providers[0];
    }

    // 按成本倍率排序（倍率低的在前）
    const sorted = [...providers].sort((a, b) => {
      const costA = a.costMultiplier;
      const costB = b.costMultiplier;
      return costA - costB;
    });

    // 加权随机选择（复用现有逻辑）
    return ProxyProviderResolver.weightedRandom(sorted);
  }

  /**
   * 加权随机选择
   */
  private static weightedRandom(providers: Provider[]): Provider {
    const totalWeight = providers.reduce((sum, p) => sum + p.weight, 0);

    if (totalWeight === 0) {
      const randomIndex = Math.floor(Math.random() * providers.length);
      return providers[randomIndex];
    }

    const random = Math.random() * totalWeight;
    let cumulativeWeight = 0;

    for (const provider of providers) {
      cumulativeWeight += provider.weight;
      if (random < cumulativeWeight) {
        return provider;
      }
    }

    return providers[providers.length - 1];
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

    // 按 providerType 精确过滤
    const typeFiltered = visibleProviders.filter(
      (p) => p.isEnabled && p.providerType === providerType
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

    // 优先级分层
    const topPriorityProviders = ProxyProviderResolver.selectTopPriority(healthyProviders);

    // 成本排序 + 加权随机选择
    const selected = ProxyProviderResolver.selectOptimal(topPriorityProviders);

    // 计算候选者概率
    const totalWeight = topPriorityProviders.reduce((sum, p) => sum + p.weight, 0);
    const candidates = topPriorityProviders.map((p) => ({
      id: p.id,
      name: p.name,
      weight: p.weight,
      costMultiplier: p.costMultiplier,
      probability: totalWeight > 0 ? p.weight / totalWeight : 1 / topPriorityProviders.length,
    }));

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
        priorityLevels: [...new Set(healthyProviders.map((p) => p.priority || 0))].sort(
          (a, b) => a - b
        ),
        selectedPriority: selected.priority || 0,
        candidatesAtPriority: candidates,
      },
    };
  }
}

// Export for testing
export { checkProviderGroupMatch };

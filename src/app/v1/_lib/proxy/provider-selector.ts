import { getCircuitState, isCircuitOpen } from "@/lib/circuit-breaker";
import { logger } from "@/lib/logger";
import { RateLimitService } from "@/lib/rate-limit";
import { SessionManager } from "@/lib/session-manager";
import { findAllProviders, findProviderById } from "@/repository/provider";
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

    if (session.getLastSelectionContext()?.filteredProviders) {
      details.filteredProviders = session.getLastSelectionContext()?.filteredProviders;
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
    if (!session.shouldReuseProvider() || !session.sessionId) {
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

    // 验证 provider 可用性
    const provider = await findProviderById(providerId);
    if (!provider || !provider.isEnabled) {
      logger.debug("ProviderSelector: Session provider unavailable", {
        sessionId: session.sessionId,
        providerId,
      });
      return null;
    }

    // 检查熔断器状态（TC-055 修复）
    if (await isCircuitOpen(provider.id)) {
      logger.debug("ProviderSelector: Session provider circuit is open", {
        sessionId: session.sessionId,
        providerId: provider.id,
        providerName: provider.name,
        circuitState: getCircuitState(provider.id),
      });
      return null;
    }

    // 检查模型支持（使用新的模型匹配逻辑）
    const requestedModel = session.getCurrentModel();
    if (requestedModel && !providerSupportsModel(provider, requestedModel)) {
      logger.debug("ProviderSelector: Session provider does not support requested model", {
        sessionId: session.sessionId,
        providerId: provider.id,
        providerName: provider.name,
        providerType: provider.providerType,
        requestedModel,
        allowedModels: provider.allowedModels,
        joinClaudePool: provider.joinClaudePool,
      });
      return null;
    }

    // 修复：检查用户分组权限（严格分组隔离 + 支持多分组）
    const userGroup = session?.authState?.user?.providerGroup;
    if (userGroup) {
      // 用户有分组，支持多个分组（逗号分隔）
      const userGroups = userGroup
        .split(",")
        .map((g) => g.trim())
        .filter(Boolean);

      // 检查供应商的 groupTag 与用户的分组是否有交集
      // 修复 #190: 支持供应商多标签（如 "cli,chat"）与用户单标签（如 "cli"）的匹配
      if (provider.groupTag) {
        // 将供应商的 groupTag 拆分成标签数组
        const providerTags = provider.groupTag
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean);

        // 检查是否有交集
        const hasIntersection = providerTags.some((tag) => userGroups.includes(tag));

        if (!hasIntersection) {
          logger.warn("ProviderSelector: Session provider not in user groups", {
            sessionId: session.sessionId,
            providerId: provider.id,
            providerName: provider.name,
            providerTags: providerTags.join(","),
            userGroups: userGroups.join(","),
            message: "Strict group isolation: rejecting cross-group session reuse",
          });
          return null; // 不允许复用，重新选择
        }
      }
    }
    // 全局用户（userGroup 为空）可以复用任何供应商

    logger.info("ProviderSelector: Reusing provider", {
      providerName: provider.name,
      providerId: provider.id,
      sessionId: session.sessionId,
    });
    return provider;
  }

  private static async pickRandomProvider(
    session?: ProxySession,
    excludeIds: number[] = [] // 排除已失败的供应商
  ): Promise<{
    provider: Provider | null;
    context: NonNullable<ProviderChainItem["decisionContext"]>;
  }> {
    const allProviders = await findAllProviders();
    const requestedModel = session?.getCurrentModel() || "";

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

    // === 初始化决策上下文 ===
    const context: NonNullable<ProviderChainItem["decisionContext"]> = {
      totalProviders: allProviders.length,
      enabledProviders: 0,
      targetType, // 根据原始请求格式推断目标供应商类型（修复：不再根据模型名推断）
      requestedModel, // 新增：记录请求的模型
      groupFilterApplied: false,
      beforeHealthCheck: 0,
      afterHealthCheck: 0,
      filteredProviders: [],
      priorityLevels: [],
      selectedPriority: 0,
      candidatesAtPriority: [],
      excludedProviderIds: excludeIds.length > 0 ? excludeIds : undefined,
    };

    // Step 1: 基础过滤 + 格式/模型匹配（新逻辑）
    const enabledProviders = allProviders.filter((provider) => {
      // 1a. 基础过滤
      if (!provider.isEnabled || excludeIds.includes(provider.id)) {
        return false;
      }

      // 1b. 格式类型匹配（新增）
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

      // 1c. 模型匹配（保留原有逻辑）
      if (!requestedModel) {
        // 没有模型信息时，只选择 Anthropic 提供商（向后兼容）
        return provider.providerType === "claude";
      }

      return providerSupportsModel(provider, requestedModel);
    });

    context.enabledProviders = enabledProviders.length;

    // 记录被过滤的供应商
    for (const p of allProviders) {
      if (!enabledProviders.includes(p)) {
        let reason:
          | "circuit_open"
          | "rate_limited"
          | "excluded"
          | "format_type_mismatch"
          | "type_mismatch"
          | "model_not_allowed"
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
          !checkFormatProviderTypeCompatibility(session.originalFormat, p.providerType)
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
        totalProviders: allProviders.length,
        excludedCount: excludeIds.length,
      });
      return { provider: null, context };
    }

    // Step 2: 用户分组过滤（如果用户指定了分组）
    let candidateProviders = enabledProviders;
    const userGroup = session?.authState?.user?.providerGroup;

    if (userGroup) {
      context.userGroup = userGroup;

      // 修复：支持多个分组（逗号分隔，如 "fero,chen"）
      const userGroups = userGroup
        .split(",")
        .map((g) => g.trim())
        .filter(Boolean);

      // 过滤：供应商的 groupTag 与用户的分组有交集
      // 修复 #190: 支持供应商多标签（如 "cli,chat"）与用户单标签（如 "cli"）的匹配
      const groupFiltered = enabledProviders.filter((p) => {
        if (!p.groupTag) return false;

        // 将供应商的 groupTag 拆分成标签数组
        const providerTags = p.groupTag
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean);

        // 检查是否有交集：用户的分组中是否有任意一个标签在供应商的标签列表中
        return providerTags.some((tag) => userGroups.includes(tag));
      });

      if (groupFiltered.length > 0) {
        candidateProviders = groupFiltered;
        context.groupFilterApplied = true;
        context.afterGroupFilter = groupFiltered.length;
        logger.debug("ProviderSelector: User multi-group filter applied", {
          userGroup,
          userGroups,
          count: groupFiltered.length,
        });
      } else {
        // 修复：严格分组隔离，无可用供应商时返回错误而不是 fallback
        context.groupFilterApplied = false;
        context.afterGroupFilter = 0;
        logger.error("ProviderSelector: User groups have no available providers", {
          userGroup,
          userGroups,
          enabledProviders: enabledProviders.length,
          message: "Strict group isolation: returning null instead of fallback",
        });

        // 返回 null 表示无可用供应商
        return {
          provider: null,
          context,
        };
      }
    }

    context.beforeHealthCheck = candidateProviders.length;

    // Step 3: 过滤超限供应商（健康度过滤）
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

    // Step 4: 优先级分层（只选择最高优先级的供应商）
    const topPriorityProviders = ProxyProviderResolver.selectTopPriority(healthyProviders);
    const priorities = [...new Set(healthyProviders.map((p) => p.priority || 0))].sort(
      (a, b) => a - b
    );
    context.priorityLevels = priorities;
    context.selectedPriority = Math.min(...healthyProviders.map((p) => p.priority || 0));

    // Step 5: 成本排序 + 加权选择 + 计算概率
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
      totalProviders: allProviders.length,
      enabledCount: enabledProviders.length,
      excludedIds: excludeIds,
      userGroup: userGroup || "none",
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
   */
  private static async filterByLimits(providers: Provider[]): Promise<Provider[]> {
    const results = await Promise.all(
      providers.map(async (p) => {
        // 0. 检查熔断器状态
        if (await isCircuitOpen(p.id)) {
          logger.debug("ProviderSelector: Provider circuit breaker is open", { providerId: p.id });
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
          logger.debug("ProviderSelector: Provider cost limit exceeded", { providerId: p.id });
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
}

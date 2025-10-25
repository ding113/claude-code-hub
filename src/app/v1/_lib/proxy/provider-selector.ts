import type { Provider } from "@/types/provider";
import { findProviderList, findProviderById } from "@/repository/provider";
import { RateLimitService } from "@/lib/rate-limit";
import { SessionManager } from "@/lib/session-manager";
import { isCircuitOpen, getCircuitState } from "@/lib/circuit-breaker";
import { ProxyResponses } from "./responses";
import { logger } from "@/lib/logger";
import type { ProxySession } from "./session";
import type { ProviderChainItem } from "@/types/message";

export class ProxyProviderResolver {
  static async ensure(
    session: ProxySession,
    targetProviderType: "claude" | "codex" = "claude"
  ): Promise<Response | null> {
    // 最大重试次数（避免无限循环）
    const MAX_RETRIES = 3;
    const excludedProviders: number[] = [];

    // === 会话复用 ===
    const reusedProvider = await ProxyProviderResolver.findReusable(session, targetProviderType);
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
          targetType: targetProviderType,
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
        excludedProviders,
        targetProviderType
      );
      session.setProvider(provider);
      session.setLastSelectionContext(context); // 保存用于后续记录
    }

    // === 故障转移循环 ===
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
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
              attempt: attempt + 1,
            }
          );

          const failedContext = session.getLastSelectionContext();
          session.addProviderToChain(session.provider, {
            reason: "concurrent_limit_failed",
            selectionMethod: failedContext?.groupFilterApplied
              ? "group_filtered"
              : "weighted_random",
            circuitState: getCircuitState(session.provider.id),
            attemptNumber: attempt + 1,
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
                  targetType: targetProviderType,
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
            await ProxyProviderResolver.pickRandomProvider(
              session,
              excludedProviders,
              targetProviderType
            );

          if (!fallbackProvider) {
            // 无其他可用供应商
            logger.error("ProviderSelector: No fallback providers available", {
              excludedCount: excludedProviders.length,
            });
            return ProxyResponses.buildError(
              503,
              `所有供应商并发限制已达到（尝试了 ${excludedProviders.length} 个供应商）`
            );
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
          attempt: attempt + 1,
        });

        const successContext = session.getLastSelectionContext();
        session.addProviderToChain(session.provider, {
          reason: attempt === 0 ? "initial_selection" : "retry_success",
          selectionMethod: successContext?.groupFilterApplied
            ? "group_filtered"
            : "weighted_random",
          circuitState: getCircuitState(session.provider.id),
          attemptNumber: attempt > 0 ? attempt + 1 : undefined,
          decisionContext: successContext || {
            totalProviders: 0,
            enabledProviders: 0,
            targetType: targetProviderType,
            groupFilterApplied: false,
            beforeHealthCheck: 0,
            afterHealthCheck: 0,
            priorityLevels: [],
            selectedPriority: 0,
            candidatesAtPriority: [],
          },
        });

        // 绑定 session 到 provider（同步等待，确保写入成功）
        await SessionManager.bindSessionToProvider(session.sessionId, session.provider.id);

        // 更新 session 详细信息中的 provider 信息（异步，非关键路径）
        void SessionManager.updateSessionProvider(session.sessionId, {
          providerId: session.provider.id,
          providerName: session.provider.name,
        }).catch((error) => {
          logger.error("ProviderSelector: Failed to update session provider info", { error });
        });

        return null; // 成功
      }

      // sessionId 为空的情况（理论上不应该发生）
      logger.warn("ProviderSelector: sessionId is null, skipping concurrent check");
      return null;
    }

    // 达到最大重试次数或无可用供应商
    const status = 503;
    const message =
      excludedProviders.length > 0
        ? `所有供应商不可用（尝试了 ${excludedProviders.length} 个供应商）`
        : "暂无可用的上游服务";
    logger.error("ProviderSelector: No available providers after retries", {
      excludedProviders,
      maxRetries: MAX_RETRIES,
    });
    return ProxyResponses.buildError(status, message);
  }

  /**
   * 公开方法：选择供应商（支持排除列表，用于重试场景）
   * 供应商类型从 session.providerType 自动读取，确保重试时类型一致
   */
  static async pickRandomProviderWithExclusion(
    session: ProxySession,
    excludeIds: number[]
  ): Promise<Provider | null> {
    // 从 session 读取供应商类型，避免参数传递和类型不一致
    const targetProviderType = session.providerType || "claude";
    const { provider } = await this.pickRandomProvider(session, excludeIds, targetProviderType);
    return provider;
  }

  /**
   * 查找可复用的供应商（基于 session）
   */
  private static async findReusable(
    session: ProxySession,
    targetProviderType: "claude" | "codex"
  ): Promise<Provider | null> {
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
    if (isCircuitOpen(provider.id)) {
      logger.debug("ProviderSelector: Session provider circuit is open", {
        sessionId: session.sessionId,
        providerId: provider.id,
        providerName: provider.name,
        circuitState: getCircuitState(provider.id),
      });
      return null;
    }

    // 检查供应商类型是否匹配
    if (provider.providerType !== targetProviderType) {
      logger.debug("ProviderSelector: Provider type mismatch", {
        providerId: provider.id,
        actual: provider.providerType,
        expected: targetProviderType,
      });
      return null;
    }

    // 检查模型白名单（如果设置了 allowedModels）
    const requestedModel = session.getCurrentModel();
    if (
      requestedModel &&
      provider.allowedModels &&
      provider.allowedModels.length > 0 &&
      !provider.allowedModels.includes(requestedModel)
    ) {
      logger.debug("ProviderSelector: Session provider does not support requested model", {
        sessionId: session.sessionId,
        providerId: provider.id,
        providerName: provider.name,
        requestedModel,
        allowedModels: provider.allowedModels,
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

  private static async pickRandomProvider(
    session?: ProxySession,
    excludeIds: number[] = [], // 排除已失败的供应商
    targetProviderType: "claude" | "codex" = "claude" // 目标供应商类型
  ): Promise<{
    provider: Provider | null;
    context: NonNullable<ProviderChainItem["decisionContext"]>;
  }> {
    const allProviders = await findProviderList();

    // === 初始化决策上下文 ===
    const context: NonNullable<ProviderChainItem["decisionContext"]> = {
      totalProviders: allProviders.length,
      enabledProviders: 0,
      targetType: targetProviderType,
      groupFilterApplied: false,
      beforeHealthCheck: 0,
      afterHealthCheck: 0,
      filteredProviders: [],
      priorityLevels: [],
      selectedPriority: 0,
      candidatesAtPriority: [],
      excludedProviderIds: excludeIds.length > 0 ? excludeIds : undefined,
    };

    // Step 0: 第一层过滤 - 排除已禁用、类型不匹配和黑名单中的供应商
    const enabledProviders = allProviders.filter(
      (provider) =>
        provider.isEnabled &&
        provider.providerType === targetProviderType &&
        !excludeIds.includes(provider.id)
    );

    context.enabledProviders = allProviders.filter(
      (p) => p.isEnabled && p.providerType === targetProviderType
    ).length;

    // 记录被排除的供应商
    for (const id of excludeIds) {
      const p = allProviders.find((x) => x.id === id);
      if (p) {
        context.filteredProviders!.push({
          id: p.id,
          name: p.name,
          reason: "excluded",
          details: "已在前序尝试中失败",
        });
      }
    }

    if (enabledProviders.length === 0) {
      logger.warn("ProviderSelector: No enabled providers after exclusion filter");
      return { provider: null, context };
    }

    // Step 0.5: 模型白名单过滤
    let modelFilteredProviders = enabledProviders;
    const requestedModel = session?.getCurrentModel();

    if (requestedModel) {
      const preModelFilterCount = enabledProviders.length;
      modelFilteredProviders = enabledProviders.filter((provider) => {
        // 如果供应商没有设置 allowedModels（null 或空数组），则允许所有模型
        if (!provider.allowedModels || provider.allowedModels.length === 0) {
          return true;
        }

        // 如果设置了 allowedModels，检查请求的模型是否在白名单中
        const allowed = provider.allowedModels.includes(requestedModel);

        if (!allowed) {
          context.filteredProviders!.push({
            id: provider.id,
            name: provider.name,
            reason: "model_not_allowed",
            details: `模型 ${requestedModel} 不在白名单中`,
          });
        }

        return allowed;
      });

      context.afterModelFilter = modelFilteredProviders.length;

      if (modelFilteredProviders.length < preModelFilterCount) {
        logger.debug("ProviderSelector: Model whitelist filter applied", {
          requestedModel,
          beforeFilter: preModelFilterCount,
          afterFilter: modelFilteredProviders.length,
          filteredOut: preModelFilterCount - modelFilteredProviders.length,
        });
      }
    }

    if (modelFilteredProviders.length === 0) {
      logger.warn("ProviderSelector: No providers support the requested model", {
        requestedModel,
      });
      return { provider: null, context };
    }

    // Step 1: 用户分组过滤（如果用户指定了分组）
    let candidateProviders = modelFilteredProviders;
    const userGroup = session?.authState?.user?.providerGroup;

    if (userGroup) {
      context.userGroup = userGroup;
      const groupFiltered = modelFilteredProviders.filter((p) => p.groupTag === userGroup);

      if (groupFiltered.length > 0) {
        candidateProviders = groupFiltered;
        context.groupFilterApplied = true;
        context.afterGroupFilter = groupFiltered.length;
        logger.debug("ProviderSelector: User group filter applied", {
          userGroup,
          count: groupFiltered.length,
        });
      } else {
        context.groupFilterApplied = false;
        context.afterGroupFilter = 0;
        logger.warn("ProviderSelector: User group has no providers, falling back", {
          userGroup,
        });
      }
    }

    context.beforeHealthCheck = candidateProviders.length;

    // Step 2: 过滤超限供应商（健康度过滤）
    const healthyProviders = await this.filterByLimits(candidateProviders);
    context.afterHealthCheck = healthyProviders.length;

    // 记录过滤掉的供应商（熔断或限流）
    const filteredOut = candidateProviders.filter(
      (p) => !healthyProviders.find((hp) => hp.id === p.id)
    );

    for (const p of filteredOut) {
      if (isCircuitOpen(p.id)) {
        const state = getCircuitState(p.id);
        context.filteredProviders!.push({
          id: p.id,
          name: p.name,
          reason: "circuit_open",
          details: `熔断器${state === "open" ? "打开" : "半开"}`,
        });
      } else {
        context.filteredProviders!.push({
          id: p.id,
          name: p.name,
          reason: "rate_limited",
          details: "费用限制",
        });
      }
    }

    if (healthyProviders.length === 0) {
      logger.warn("ProviderSelector: All providers rate limited, falling back to random");
      // Fail Open：降级到随机选择（让上游拒绝）
      const fallback = this.weightedRandom(candidateProviders);
      return { provider: fallback, context };
    }

    // Step 3: 优先级分层（只选择最高优先级的供应商）
    const topPriorityProviders = this.selectTopPriority(healthyProviders);
    const priorities = [...new Set(healthyProviders.map((p) => p.priority || 0))].sort(
      (a, b) => a - b
    );
    context.priorityLevels = priorities;
    context.selectedPriority = Math.min(...healthyProviders.map((p) => p.priority || 0));

    // Step 4: 成本排序 + 加权选择 + 计算概率
    const totalWeight = topPriorityProviders.reduce((sum, p) => sum + p.weight, 0);
    context.candidatesAtPriority = topPriorityProviders.map((p) => ({
      id: p.id,
      name: p.name,
      weight: p.weight,
      costMultiplier: p.costMultiplier,
      probability: totalWeight > 0 ? Math.round((p.weight / totalWeight) * 100) : 0,
    }));

    const selected = this.selectOptimal(topPriorityProviders);

    // 详细的选择日志
    logger.info("ProviderSelector: Selection decision", {
      targetProviderType,
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
        if (isCircuitOpen(p.id)) {
          logger.debug("ProviderSelector: Provider circuit breaker is open", { providerId: p.id });
          return null;
        }

        // 1. 检查金额限制
        const costCheck = await RateLimitService.checkCostLimits(p.id, "provider", {
          limit_5h_usd: p.limit5hUsd,
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
    return this.weightedRandom(sorted);
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

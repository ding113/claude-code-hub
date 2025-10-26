import type { ProviderChainItem } from "@/types/message";

/**
 * Level 1: 表格摘要（一行文字，20-30字）
 */
export function formatProviderSummary(chain: ProviderChainItem[]): string {
  if (!chain || chain.length === 0) return "";

  const first = chain[0];
  const ctx = first.decisionContext;

  // 会话复用
  if (first.reason === "session_reuse" && ctx?.sessionId) {
    const shortId = ctx.sessionId.slice(-6);
    return `会话复用 ${shortId}`;
  }

  // 单次成功
  if (chain.length === 1 && ctx) {
    const total = ctx.enabledProviders || 0;
    const healthy = ctx.afterHealthCheck || 0;
    if (total > 0 && healthy > 0) {
      return `${total}个候选→${healthy}个健康→选${first.name}`;
    }
    return "首次选择";
  }

  // 多次重试
  if (chain.length > 1) {
    const failed = chain
      .slice(0, -1)
      .map((c) => c.name)
      .join(",");
    const success = chain[chain.length - 1];
    return `${failed}失败→重试${success.name}✓`;
  }

  return "";
}

/**
 * Level 2: Popover 中等详情（2-3行，100-150字）
 */
export function formatProviderDescription(chain: ProviderChainItem[]): string {
  if (!chain || chain.length === 0) return "无决策记录";

  const first = chain[0];
  const ctx = first.decisionContext;

  // === 会话复用 ===
  if (first.reason === "session_reuse" && ctx) {
    return `🔄 会话复用

基于 session ${ctx.sessionId || "未知"} 复用供应商
${first.name} (优先级 ${first.priority}, 权重 ${first.weight})`;
  }

  // === 首次选择成功 ===
  if (first.reason === "initial_selection" && ctx) {
    let desc = `🎯 首次选择\n\n`;

    // 筛选过程
    desc += `${ctx.enabledProviders || 0}个启用`;
    if (ctx.userGroup) {
      desc += ` → ${ctx.userGroup}分组${ctx.afterGroupFilter || 0}个`;
    }
    desc += ` → 健康检查${ctx.afterHealthCheck || 0}个\n`;

    // 优先级候选
    if (ctx.candidatesAtPriority && ctx.candidatesAtPriority.length > 0) {
      desc += `优先级${ctx.selectedPriority}候选${ctx.candidatesAtPriority.length}个，`;
      desc += `加权随机选择${first.name}`;
    }

    return desc;
  }

  // === 重试场景 ===
  if (chain.length > 1) {
    let desc = `🔄 供应商重试\n\n`;
    for (let i = 0; i < chain.length; i++) {
      const item = chain[i];
      if (i > 0) desc += "\n↓\n";

      if (item.reason === "concurrent_limit_failed") {
        const limit = item.decisionContext?.concurrentLimit || 0;
        const current = item.decisionContext?.currentConcurrent || 0;
        desc += `第${i + 1}次: ${item.name} 并发限制 (${current}/${limit})`;
      } else if (item.reason === "retry_success") {
        desc += `第${i + 1}次: ${item.name} 重试成功 ✓`;
      } else {
        desc += `第${i + 1}次: ${item.name}`;
      }
    }
    return desc;
  }

  return "无详细信息";
}

/**
 * Level 3: Dialog 完整时间线（带时间戳，200-500字）
 */
export function formatProviderTimeline(chain: ProviderChainItem[]): {
  timeline: string;
  totalDuration: number;
} {
  if (!chain || chain.length === 0) {
    return { timeline: "无决策记录", totalDuration: 0 };
  }

  const startTime = chain[0].timestamp || 0;
  const endTime = chain[chain.length - 1].timestamp || startTime;
  const totalDuration = endTime - startTime;

  let timeline = "";

  for (let i = 0; i < chain.length; i++) {
    const item = chain[i];
    const ctx = item.decisionContext;
    const elapsed = item.timestamp ? item.timestamp - startTime : 0;

    if (i > 0) {
      timeline += "\n\n├──────────────┤\n\n";
    }

    // === 时间戳 ===
    timeline += `[${elapsed.toString().padStart(3, "0")}ms] `;

    // === 会话复用 ===
    if (item.reason === "session_reuse" && ctx) {
      timeline += `🔄 会话复用\n\n`;
      timeline += `Session ID: ${ctx.sessionId || "未知"}\n`;
      timeline += `供应商: ${item.name}\n`;
      timeline += `配置: 优先级${item.priority}, 权重${item.weight}, 成本${item.costMultiplier}x\n`;
      timeline += `\n✓ 复用成功`;
      continue;
    }

    // === 首次选择 ===
    if (item.reason === "initial_selection" && ctx) {
      timeline += `🎯 首次选择\n\n`;

      // 系统状态
      timeline += `系统状态:\n`;
      timeline += `• 总计 ${ctx.totalProviders} 个供应商\n`;
      timeline += `• 启用 ${ctx.enabledProviders} 个 (${ctx.targetType}类型)\n`;

      if (ctx.userGroup) {
        timeline += `• 用户分组 '${ctx.userGroup}' 筛选 → ${ctx.afterGroupFilter}个\n`;
      }

      timeline += `• 健康检查 → ${ctx.afterHealthCheck}个\n`;

      // 被过滤的供应商
      if (ctx.filteredProviders && ctx.filteredProviders.length > 0) {
        timeline += `\n被过滤:\n`;
        for (const f of ctx.filteredProviders) {
          const icon = f.reason === "circuit_open" ? "⚡" : "💰";
          timeline += `  ${icon} ${f.name} (${f.details || f.reason})\n`;
        }
      }

      // 优先级候选
      if (ctx.candidatesAtPriority && ctx.candidatesAtPriority.length > 0) {
        timeline += `\n优先级 ${ctx.selectedPriority} 候选 (${ctx.candidatesAtPriority.length}个):\n`;
        for (const c of ctx.candidatesAtPriority) {
          timeline += `  • ${c.name} [权重${c.weight}, 成本${c.costMultiplier}x`;
          if (c.probability) {
            timeline += `, ${c.probability}%概率`;
          }
          timeline += `]\n`;
        }
      }

      timeline += `\n✓ 选择 ${item.name}`;
      continue;
    }

    // === 并发限制失败 ===
    if (item.reason === "concurrent_limit_failed") {
      timeline += `❌ 第 ${item.attemptNumber} 次尝试失败\n\n`;
      timeline += `供应商: ${item.name}\n`;

      if (ctx?.concurrentLimit) {
        timeline += `并发限制: ${ctx.currentConcurrent}/${ctx.concurrentLimit} 会话\n`;
      }

      timeline += `错误: ${item.errorMessage || "未知"}`;
      continue;
    }

    // === 重试成功 ===
    if (item.reason === "retry_success" && ctx) {
      timeline += `✓ 第 ${item.attemptNumber} 次尝试成功\n\n`;

      if (ctx.excludedProviderIds && ctx.excludedProviderIds.length > 0) {
        timeline += `排除: `;
        const excludedNames =
          ctx.filteredProviders
            ?.filter((f) => ctx.excludedProviderIds?.includes(f.id))
            .map((f) => f.name) || [];
        timeline += excludedNames.join(", ") || `${ctx.excludedProviderIds.length}个供应商`;
        timeline += `\n`;
      }

      timeline += `剩余候选: ${ctx.afterHealthCheck}个\n`;
      timeline += `选择: ${item.name}`;
      continue;
    }

    // === 重试失败（上游 API 错误、超时等） ===
    if (item.reason === "retry_failed") {
      timeline += `❌ 第 ${item.attemptNumber} 次尝试失败\n\n`;
      timeline += `供应商: ${item.name}\n`;

      // 显示完整错误信息（这是最关键的调试信息）
      if (item.errorMessage) {
        timeline += `错误详情:\n`;
        timeline += `${item.errorMessage}\n`;
      } else {
        timeline += `错误: 未知\n`;
      }

      continue;
    }

    // 默认
    timeline += `${item.name} (${item.reason || "未知"})`;
  }

  return { timeline, totalDuration };
}

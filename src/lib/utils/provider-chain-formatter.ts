import type { ProviderChainItem } from "@/types/message";

/**
 * 辅助函数：判断供应商请求状态
 *
 * ⚠️ 注意：retry_success 有两种含义
 * 1. 有 statusCode：实际请求成功
 * 2. 无 statusCode：仅表示选择成功（中间状态，不应显示）
 */
function getProviderStatus(item: ProviderChainItem): '✓' | '✗' | '⚡' | null {
  // 成功标记：必须有 statusCode 且是成功状态码
  if ((item.reason === 'request_success' || item.reason === 'retry_success') && item.statusCode) {
    return '✓';
  }
  // 失败标记
  if (item.reason === 'retry_failed' || item.reason === 'system_error') {
    return '✗';
  }
  // 并发限制失败
  if (item.reason === 'concurrent_limit_failed') {
    return '⚡';
  }
  // 中间状态（选择成功但还没有请求结果）
  return null;
}

/**
 * 辅助函数：判断是否为实际请求记录（排除中间状态）
 */
function isActualRequest(item: ProviderChainItem): boolean {
  // 并发限制失败：算作一次尝试
  if (item.reason === 'concurrent_limit_failed') return true;

  // 失败记录
  if (item.reason === 'retry_failed' || item.reason === 'system_error') return true;

  // 成功记录：必须有 statusCode
  if ((item.reason === 'request_success' || item.reason === 'retry_success') && item.statusCode) {
    return true;
  }

  // 其他都是中间状态
  return false;
}

/**
 * 辅助函数：翻译熔断状态为中文
 */
function translateCircuitState(state?: string): string {
  switch (state) {
    case 'closed': return '关闭（正常）';
    case 'half-open': return '半开（试探中）';
    case 'open': return '全开（已熔断）';
    default: return '未知';
  }
}

/**
 * 辅助函数：获取错误码含义
 */
function getErrorCodeMeaning(code: string): string | null {
  const meanings: Record<string, string> = {
    'ENOTFOUND': 'DNS 解析失败',
    'ECONNREFUSED': '连接被拒绝',
    'ETIMEDOUT': '连接或读取超时',
    'ECONNRESET': '连接被重置',
  };
  return meanings[code] || null;
}

/**
 * Level 1: 表格摘要（完整链路，不截断）
 *
 * 前端用 CSS max-w + truncate 处理超长，Tooltip 显示完整内容
 */
export function formatProviderSummary(chain: ProviderChainItem[]): string {
  if (!chain || chain.length === 0) return "";

  // 过滤出实际请求记录（排除中间状态）
  const requests = chain.filter(isActualRequest);

  if (requests.length === 0) {
    // 没有实际请求
    return "";
  }

  // 单次请求且成功
  if (requests.length === 1 && getProviderStatus(requests[0]) === '✓') {
    const request = requests[0];

    // 查找是否有首次选择的决策记录
    const initialSelection = chain.find(item => item.reason === 'initial_selection');

    if (initialSelection && initialSelection.decisionContext) {
      const ctx = initialSelection.decisionContext;
      const total = ctx.enabledProviders || 0;
      const healthy = ctx.afterHealthCheck || 0;
      return `${total}个候选→${healthy}个健康→${request.name}(✓)`;
    }

    // 查找是否是会话复用
    const sessionReuse = chain.find(item => item.reason === 'session_reuse');
    if (sessionReuse) {
      return `${request.name}(✓) [会话复用]`;
    }
  }

  // 其他情况：显示请求链路（过滤掉 null 状态）
  const path = requests
    .map((item) => {
      const status = getProviderStatus(item);
      return status ? `${item.name}(${status})` : null;
    })
    .filter((item): item is string => item !== null)
    .join(" → ");

  return path;
}

/**
 * Level 2: Popover 中等详情（精简版）
 *
 * 只显示：首次选择逻辑 + 请求链路（成功/失败）
 * 不显示：错误详情、熔断详情
 */
export function formatProviderDescription(chain: ProviderChainItem[]): string {
  if (!chain || chain.length === 0) return "无决策记录";

  let desc = "";
  const first = chain[0];
  const ctx = first.decisionContext;

  // === 部分1: 首次选择逻辑 ===
  if (first.reason === "session_reuse" && ctx) {
    desc += `🔄 会话复用\n\n`;
    desc += `Session ${ctx.sessionId?.slice(-6) || '未知'}\n`;
    desc += `复用供应商: ${first.name}\n`;
  } else if (first.reason === "initial_selection" && ctx) {
    desc += `🎯 首次选择: ${first.name}\n\n`;
    desc += `${ctx.enabledProviders || 0}个候选`;
    if (ctx.userGroup) {
      desc += ` → 分组${ctx.afterGroupFilter || 0}个`;
    }
    desc += ` → 健康${ctx.afterHealthCheck || 0}个\n`;

    if (ctx.candidatesAtPriority && ctx.candidatesAtPriority.length > 0) {
      desc += `优先级${ctx.selectedPriority}: `;
      desc += ctx.candidatesAtPriority
        .map(c => `${c.name}(${c.probability}%)`)
        .join(" ");
    }
  }

  // === 部分2: 请求链路（精简） ===
  // 只显示实际请求记录（排除中间状态）
  const requests = chain.filter(isActualRequest);

  // 只有多次请求或单次请求失败时才显示链路
  if (requests.length > 1 || (requests.length === 1 && getProviderStatus(requests[0]) !== '✓')) {
    if (desc) desc += "\n\n";
    desc += `📍 请求链路:\n\n`;

    requests.forEach((item, index) => {
      const status = getProviderStatus(item);
      const statusEmoji = status === '✓' ? '✅' : (status === '⚡' ? '⚡' : '❌');

      desc += `${index + 1}. ${item.name} ${statusEmoji}`;

      // 标注特殊情况
      if (item.reason === 'system_error') {
        desc += ' (系统错误)';
      } else if (item.reason === 'concurrent_limit_failed') {
        desc += ' (并发限制)';
      }

      desc += "\n";
    });
  }

  return desc;
}

/**
 * Level 3: Dialog 完整时间线（详细版）
 *
 * 显示：所有决策、所有请求详情、结构化错误、中文状态
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

  // 建立请求序号映射（原始索引 → 请求序号）
  const requestIndexMap = new Map<number, number>();
  let requestNumber = 0;
  chain.forEach((item, index) => {
    if (isActualRequest(item)) {
      requestNumber++;
      requestIndexMap.set(index, requestNumber);
    }
  });

  let timeline = "";

  for (let i = 0; i < chain.length; i++) {
    const item = chain[i];
    const ctx = item.decisionContext;
    const elapsed = item.timestamp ? item.timestamp - startTime : 0;
    const actualAttemptNumber = requestIndexMap.get(i); // 使用映射的序号

    if (i > 0) {
      timeline += "\n\n";
    }

    // === 时间戳 ===
    timeline += `[${elapsed.toString().padStart(4, "0")}ms] `;

    // === 会话复用选择 ===
    if (item.reason === "session_reuse" && ctx) {
      timeline += `🔄 会话复用选择供应商\n\n`;
      timeline += `Session ID: ${ctx.sessionId || "未知"}\n`;
      timeline += `复用供应商: ${item.name}\n`;
      timeline += `配置: 优先级${item.priority}, 权重${item.weight}, 成本${item.costMultiplier}x\n`;
      timeline += `基于会话缓存复用此供应商（5分钟内）\n`;
      timeline += `\n⏳ 等待请求结果...`;
      continue;
    }

    // === 首次选择 ===
    if (item.reason === "initial_selection" && ctx) {
      timeline += `🎯 首次选择供应商\n\n`;

      // 系统状态
      timeline += `系统状态:\n`;
      timeline += `• 总计 ${ctx.totalProviders} 个供应商\n`;
      timeline += `• 启用 ${ctx.enabledProviders} 个 (${ctx.targetType}类型)\n`;

      if (ctx.userGroup) {
        timeline += `• 用户分组 '${ctx.userGroup}' → ${ctx.afterGroupFilter}个\n`;
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
      timeline += `\n\n⏳ 等待请求结果...`;
      continue;
    }

    // === 供应商错误（请求失败） ===
    if (item.reason === "retry_failed") {
      timeline += `❌ 第 ${actualAttemptNumber} 次请求失败\n\n`;

      // ⭐ 使用结构化错误数据
      if (item.errorDetails?.provider) {
        const p = item.errorDetails.provider;
        timeline += `供应商: ${p.name}\n`;
        timeline += `状态码: ${p.statusCode}\n`;
        timeline += `错误: ${p.statusText}\n`;

        // 计算请求耗时
        if (i > 0 && item.timestamp && chain[i - 1]?.timestamp) {
          const duration = item.timestamp - (chain[i - 1]?.timestamp || 0);
          timeline += `请求耗时: ${duration}ms\n`;
        }

        // 熔断状态
        if (item.circuitFailureCount !== undefined && item.circuitFailureThreshold) {
          timeline += `\n熔断状态:\n`;
          timeline += `• 当前: ${translateCircuitState(item.circuitState)}\n`;
          timeline += `• 失败计数: ${item.circuitFailureCount}/${item.circuitFailureThreshold}\n`;
          const remaining = item.circuitFailureThreshold - item.circuitFailureCount;
          if (remaining > 0) {
            timeline += `• 距离熔断: 还有${remaining}次\n`;
          } else {
            timeline += `• 状态: 已触发熔断\n`;
          }
        }

        // 错误详情（格式化 JSON）
        if (p.upstreamParsed) {
          timeline += `\n错误详情:\n`;
          timeline += JSON.stringify(p.upstreamParsed, null, 2);
        } else if (p.upstreamBody) {
          timeline += `\n错误详情:\n${p.upstreamBody}`;
        }
      } else {
        // 降级：使用 errorMessage
        timeline += `供应商: ${item.name}\n`;
        if (item.statusCode) {
          timeline += `状态码: ${item.statusCode}\n`;
        }
        timeline += `错误: ${item.errorMessage || "未知"}`;
      }

      continue;
    }

    // === 系统错误 ===
    if (item.reason === "system_error") {
      timeline += `❌ 第 ${actualAttemptNumber} 次请求失败（系统错误）\n\n`;

      // ⭐ 使用结构化错误数据
      if (item.errorDetails?.system) {
        const s = item.errorDetails.system;
        timeline += `供应商: ${item.name}\n`;
        timeline += `错误类型: 系统/网络错误\n`;
        timeline += `错误: ${s.errorName}\n`;

        // 计算请求耗时
        if (i > 0 && item.timestamp && chain[i - 1]?.timestamp) {
          const duration = item.timestamp - (chain[i - 1]?.timestamp || 0);
          timeline += `请求耗时: ${duration}ms\n`;
        }

        if (s.errorCode) {
          timeline += `\n错误详情:\n`;
          timeline += `• errorCode: ${s.errorCode}\n`;
          timeline += `• errorSyscall: ${s.errorSyscall || '未知'}\n`;

          const meaning = getErrorCodeMeaning(s.errorCode);
          if (meaning) {
            timeline += `• 含义: ${meaning}\n`;
          }
        }

        timeline += `\n⚠️ 此错误不计入供应商熔断器`;
      } else {
        // 降级
        timeline += `供应商: ${item.name}\n`;
        timeline += `错误: ${item.errorMessage || "未知"}\n`;
        timeline += `\n⚠️ 此错误不计入供应商熔断器`;
      }

      continue;
    }

    // === 重新选择供应商 ===
    if ((item.reason === "retry_success" || item.reason === "request_success") && i > 0) {
      // 如果是重试成功，先显示重新选择过程
      if (ctx?.excludedProviderIds && ctx.excludedProviderIds.length > 0) {
        const prevItem = chain[i - 1];
        const prevElapsed = prevItem.timestamp ? prevItem.timestamp - startTime : 0;

        // 插入重新选择的时间线
        timeline = timeline.substring(0, timeline.lastIndexOf("["));
        timeline += `\n\n[${(prevElapsed + 10).toString().padStart(4, "0")}ms] `;
        timeline += `🔄 重新选择供应商\n\n`;

        const excludedNames =
          ctx.filteredProviders
            ?.filter((f) => ctx.excludedProviderIds?.includes(f.id))
            .map((f) => f.name) || [];

        if (excludedNames.length > 0) {
          timeline += `排除: ${excludedNames.join(", ")}\n`;
        }

        timeline += `剩余候选: ${ctx.afterHealthCheck}个\n`;
        timeline += `选择: ${item.name}`;

        if (item.priority !== undefined && item.weight !== undefined) {
          timeline += ` (优先级${item.priority}, 权重${item.weight})`;
        }

        timeline += `\n\n⏳ 等待请求结果...\n\n`;
        timeline += `[${elapsed.toString().padStart(4, "0")}ms] `;
      }
    }

    // === 请求成功 ===
    if (item.reason === "request_success" || item.reason === "retry_success") {
      const attemptLabel = actualAttemptNumber === 1 ? "首次" : `第 ${actualAttemptNumber} 次`;
      timeline += `✅ ${attemptLabel}请求成功\n\n`;

      timeline += `供应商: ${item.name}\n`;
      timeline += `状态码: ${item.statusCode || 200} (OK)\n`;

      // 计算请求耗时
      if (i > 0 && item.timestamp && chain[i - 1]?.timestamp) {
        const duration = item.timestamp - (chain[i - 1]?.timestamp || 0);
        timeline += `请求耗时: ${(duration / 1000).toFixed(2)}s\n`;
      }

      timeline += `\n✓ 请求成功完成`;
      continue;
    }

    // 并发限制失败
    if (item.reason === "concurrent_limit_failed") {
      timeline += `❌ 第 ${actualAttemptNumber} 次尝试失败\n\n`;
      timeline += `供应商: ${item.name}\n`;

      if (ctx?.concurrentLimit) {
        timeline += `并发限制: ${ctx.currentConcurrent}/${ctx.concurrentLimit} 会话\n`;
      }

      timeline += `错误: ${item.errorMessage || "并发限制"}`;
      continue;
    }

    // 默认
    timeline += `${item.name} (${item.reason || "未知"})`;
  }

  return { timeline, totalDuration };
}

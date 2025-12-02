import type { ProviderChainItem } from "@/types/message";

/**
 * 辅助函数：判断供应商请求状态
 *
 * ⚠️ 注意：retry_success 有两种含义
 * 1. 有 statusCode：实际请求成功
 * 2. 无 statusCode：仅表示选择成功（中间状态，不应显示）
 */
function getProviderStatus(item: ProviderChainItem): "✓" | "✗" | "⚡" | "↓" | null {
  // 成功标记：必须有 statusCode 且是成功状态码
  if ((item.reason === "request_success" || item.reason === "retry_success") && item.statusCode) {
    return "✓";
  }
  // 失败标记
  if (item.reason === "retry_failed" || item.reason === "system_error") {
    return "✗";
  }
  // 并发限制失败
  if (item.reason === "concurrent_limit_failed") {
    return "⚡";
  }
  // HTTP/2 回退（协议降级，不是失败）
  if (item.reason === "http2_fallback") {
    return "↓";
  }
  // 中间状态（选择成功但还没有请求结果）
  return null;
}

/**
 * 辅助函数：判断是否为实际请求记录（排除中间状态）
 */
function isActualRequest(item: ProviderChainItem): boolean {
  // 并发限制失败：算作一次尝试
  if (item.reason === "concurrent_limit_failed") return true;

  // 失败记录
  if (item.reason === "retry_failed" || item.reason === "system_error") return true;

  // HTTP/2 回退：算作一次中间事件（显示但不计入失败）
  if (item.reason === "http2_fallback") return true;

  // 成功记录：必须有 statusCode
  if ((item.reason === "request_success" || item.reason === "retry_success") && item.statusCode) {
    return true;
  }

  // 其他都是中间状态
  return false;
}

/**
 * 辅助函数：翻译熔断状态
 */
function translateCircuitState(state: string | undefined, t: (key: string) => string): string {
  switch (state) {
    case "closed":
      return t("circuit.closed");
    case "half-open":
      return t("circuit.halfOpen");
    case "open":
      return t("circuit.open");
    default:
      return t("circuit.unknown");
  }
}

/**
 * 辅助函数：获取错误码含义
 */
function getErrorCodeMeaning(code: string, t: (key: string) => string): string | null {
  const errorKey = `errors.${code}`;
  // 尝试获取翻译，如果不存在则返回 null
  try {
    const translation = t(errorKey);
    // next-intl 在找不到键时会返回键本身
    return translation !== errorKey ? translation : null;
  } catch {
    return null;
  }
}

/**
 * Level 1: 表格摘要（完整链路，不截断）
 *
 * 前端用 CSS max-w + truncate 处理超长，Tooltip 显示完整内容
 */
export function formatProviderSummary(
  chain: ProviderChainItem[],
  t: (key: string, values?: Record<string, string | number>) => string
): string {
  if (!chain || chain.length === 0) return "";

  // 过滤出实际请求记录（排除中间状态）
  const requests = chain.filter(isActualRequest);

  if (requests.length === 0) {
    // 没有实际请求
    return "";
  }

  // 单次请求且成功
  if (requests.length === 1 && getProviderStatus(requests[0]) === "✓") {
    const request = requests[0];

    // 查找是否有首次选择的决策记录
    const initialSelection = chain.find((item) => item.reason === "initial_selection");

    if (initialSelection?.decisionContext) {
      const ctx = initialSelection.decisionContext;
      const total = ctx.enabledProviders || 0;
      const healthy = ctx.afterHealthCheck || 0;
      return t("summary.singleSuccess", {
        total: total.toString(),
        healthy: healthy.toString(),
        provider: request.name,
      });
    }

    // 查找是否是会话复用
    const sessionReuse = chain.find((item) => item.reason === "session_reuse");
    if (sessionReuse) {
      return t("summary.sessionReuse", { provider: request.name });
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
export function formatProviderDescription(
  chain: ProviderChainItem[],
  t: (key: string, values?: Record<string, string | number>) => string
): string {
  if (!chain || chain.length === 0) return t("description.noDecisionRecord");

  let desc = "";
  const first = chain[0];
  const ctx = first.decisionContext;

  // === 部分1: 首次选择逻辑 ===
  if (first.reason === "session_reuse" && ctx) {
    desc += `${t("description.sessionReuse")}\n\n`;
    desc += `${t("description.sessionId", {
      id: ctx.sessionId?.slice(-6) || t("description.unknown"),
    })}\n`;
    desc += `${t("description.reuseProvider", { provider: first.name })}\n`;
  } else if (first.reason === "initial_selection" && ctx) {
    desc += `${t("description.initialSelection", { provider: first.name })}\n\n`;
    desc += t("description.candidateCount", { count: ctx.enabledProviders || 0 });
    if (ctx.userGroup) {
      desc +=
        " → " +
        t("description.groupFiltered", {
          group: ctx.userGroup,
          count: ctx.afterGroupFilter || 0,
        });
    }
    desc += ` → ${t("description.healthyCount", { count: ctx.afterHealthCheck || 0 })}\n`;

    if (ctx.candidatesAtPriority && ctx.candidatesAtPriority.length > 0) {
      desc += `${t("description.priority", { priority: ctx.selectedPriority ?? 0 })}: `;
      desc += ctx.candidatesAtPriority
        .map((c) => t("description.candidate", { name: c.name, probability: c.probability ?? 0 }))
        .join(" ");
    }
  }

  // === 部分2: 请求链路（精简） ===
  // 只显示实际请求记录（排除中间状态）
  const requests = chain.filter(isActualRequest);

  // 只有多次请求或单次请求失败时才显示链路
  if (requests.length > 1 || (requests.length === 1 && getProviderStatus(requests[0]) !== "✓")) {
    if (desc) desc += "\n\n";
    desc += `${t("description.requestChain")}\n\n`;

    requests.forEach((item, index) => {
      const status = getProviderStatus(item);
      const statusEmoji =
        status === "✓" ? "✅" : status === "⚡" ? "⚡" : status === "↓" ? "⬇️" : "❌";

      desc += `${index + 1}. ${item.name} ${statusEmoji}`;

      // 标注特殊情况
      if (item.reason === "system_error") {
        desc += ` ${t("description.systemError")}`;
      } else if (item.reason === "concurrent_limit_failed") {
        desc += ` ${t("description.concurrentLimit")}`;
      } else if (item.reason === "http2_fallback") {
        desc += ` ${t("description.http2Fallback")}`;
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
export function formatProviderTimeline(
  chain: ProviderChainItem[],
  t: (key: string, values?: Record<string, string | number>) => string
): {
  timeline: string;
  totalDuration: number;
} {
  if (!chain || chain.length === 0) {
    return { timeline: t("timeline.noDecisionRecord"), totalDuration: 0 };
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
      timeline += `${t("timeline.sessionReuseTitle")}\n\n`;
      timeline += `${t("timeline.sessionId", { id: ctx.sessionId || t("timeline.unknown") })}\n`;
      timeline += `${t("timeline.reuseProvider", { provider: item.name })}\n`;
      timeline += `${t("timeline.providerConfig", {
        priority: item.priority ?? 0,
        weight: item.weight ?? 0,
        cost: item.costMultiplier ?? 1,
      })}\n`;
      timeline += `${t("timeline.sessionCache")}\n`;
      timeline += `\n${t("timeline.waiting")}`;
      continue;
    }

    // === 首次选择 ===
    if (item.reason === "initial_selection" && ctx) {
      timeline += `${t("timeline.initialSelectionTitle")}\n\n`;

      // 系统状态
      timeline += `${t("timeline.systemStatus")}:\n`;
      timeline += `${t("timeline.totalProviders", { count: ctx.totalProviders })}\n`;
      timeline += `${t("timeline.enabledProviders", {
        count: ctx.enabledProviders,
        type: ctx.targetType,
      })}\n`;

      if (ctx.userGroup) {
        timeline += `${t("timeline.userGroup", {
          group: ctx.userGroup,
          count: ctx.afterGroupFilter ?? 0,
        })}\n`;
      }

      timeline += `${t("timeline.healthCheck", { count: ctx.afterHealthCheck })}\n`;

      // 被过滤的供应商
      if (ctx.filteredProviders && ctx.filteredProviders.length > 0) {
        timeline += `\n${t("timeline.filtered")}:\n`;
        for (const f of ctx.filteredProviders) {
          const icon = f.reason === "circuit_open" ? "⚡" : "💰";
          timeline += `  ${icon} ${f.name} (${f.details || f.reason})\n`;
        }
      }

      // 优先级候选
      if (ctx.candidatesAtPriority && ctx.candidatesAtPriority.length > 0) {
        timeline +=
          "\n" +
          t("timeline.priorityCandidates", {
            priority: ctx.selectedPriority,
            count: ctx.candidatesAtPriority.length,
          }) +
          ":\n";
        for (const c of ctx.candidatesAtPriority) {
          timeline += `${t("timeline.candidateInfo", {
            name: c.name,
            weight: c.weight,
            cost: c.costMultiplier,
            probability: c.probability || "",
          })}\n`;
        }
      }

      timeline += `\n${t("timeline.selected", { provider: item.name })}`;
      timeline += `\n\n${t("timeline.waiting")}`;
      continue;
    }

    // === 供应商错误（请求失败） ===
    if (item.reason === "retry_failed") {
      timeline += `${t("timeline.requestFailed", { attempt: actualAttemptNumber ?? 0 })}\n\n`;

      // ⭐ 使用结构化错误数据
      if (item.errorDetails?.provider) {
        const p = item.errorDetails.provider;
        timeline += `${t("timeline.provider", { provider: p.name })}\n`;
        timeline += `${t("timeline.statusCode", { code: p.statusCode })}\n`;
        timeline += `${t("timeline.error", { error: p.statusText })}\n`;

        // 计算请求耗时
        if (i > 0 && item.timestamp && chain[i - 1]?.timestamp) {
          const duration = item.timestamp - (chain[i - 1]?.timestamp || 0);
          timeline += `${t("timeline.requestDuration", { duration })}\n`;
        }

        // 熔断状态
        if (item.circuitFailureCount !== undefined && item.circuitFailureThreshold) {
          timeline += `\n${t("timeline.circuitStatus")}:\n`;
          timeline += `${t("timeline.circuitCurrent", {
            state: translateCircuitState(item.circuitState, t),
          })}\n`;
          timeline += `${t("timeline.failureCount", {
            current: item.circuitFailureCount,
            threshold: item.circuitFailureThreshold,
          })}\n`;
          const remaining = item.circuitFailureThreshold - item.circuitFailureCount;
          if (remaining > 0) {
            timeline += `${t("timeline.circuitRemaining", { remaining })}\n`;
          } else {
            timeline += `${t("timeline.circuitTriggered")}\n`;
          }
        }

        // 错误详情（格式化 JSON）
        if (p.upstreamParsed) {
          timeline += `\n${t("timeline.errorDetails")}:\n`;
          timeline += JSON.stringify(p.upstreamParsed, null, 2);
        } else if (p.upstreamBody) {
          timeline += `\n${t("timeline.errorDetails")}:\n${p.upstreamBody}`;
        }
      } else {
        // 降级：使用 errorMessage
        timeline += `${t("timeline.provider", { provider: item.name })}\n`;
        if (item.statusCode) {
          timeline += `${t("timeline.statusCode", { code: item.statusCode })}\n`;
        }
        timeline += t("timeline.error", { error: item.errorMessage || t("timeline.unknown") });
      }

      continue;
    }

    // === 系统错误 ===
    if (item.reason === "system_error") {
      timeline += `${t("timeline.systemErrorFailed", { attempt: actualAttemptNumber ?? 0 })}\n\n`;

      // ⭐ 使用结构化错误数据
      if (item.errorDetails?.system) {
        const s = item.errorDetails.system;
        timeline += `${t("timeline.provider", { provider: item.name })}\n`;

        // 根据错误码显示更清晰的错误类型
        if (s.errorCode) {
          const meaning = getErrorCodeMeaning(s.errorCode, t);
          if (meaning) {
            timeline += `${t("timeline.errorType") + meaning}\n`;
          } else {
            timeline += `${t("timeline.errorType") + (s.errorName || t("timeline.unknown"))}\n`;
          }
        } else {
          timeline += `${t("timeline.errorType") + (s.errorName || t("timeline.unknown"))}\n`;
        }

        timeline += `${t("timeline.error", { error: s.errorName })}\n`;

        // 计算请求耗时
        if (i > 0 && item.timestamp && chain[i - 1]?.timestamp) {
          const duration = item.timestamp - (chain[i - 1]?.timestamp || 0);
          timeline += `${t("timeline.requestDuration", { duration })}\n`;
        }

        if (s.errorCode) {
          timeline += `\n${t("timeline.errorDetails")}:\n`;
          timeline += `${t("timeline.errorCode", { code: s.errorCode })}\n`;
          timeline += `${t("timeline.errorSyscall", {
            syscall: s.errorSyscall || t("timeline.unknown"),
          })}\n`;

          const meaning = getErrorCodeMeaning(s.errorCode, t);
          if (meaning) {
            timeline += `${t("timeline.errorMeaning", { meaning })}\n`;
          }
        }

        timeline += `\n${t("timeline.systemErrorNote")}`;
      } else {
        // 降级
        timeline += `${t("timeline.provider", { provider: item.name })}\n`;
        timeline += `${t("timeline.error", { error: item.errorMessage || t("timeline.unknown") })}\n`;
        timeline += `\n${t("timeline.systemErrorNote")}`;
      }

      continue;
    }

    // === HTTP/2 协议回退 ===
    if (item.reason === "http2_fallback") {
      timeline += `${t("timeline.http2Fallback")}\n\n`;

      timeline += `${t("timeline.provider", { provider: item.name })}\n`;

      // 使用结构化错误数据
      if (item.errorDetails?.system) {
        const s = item.errorDetails.system;
        timeline += `${t("timeline.http2ErrorType", { type: s.errorName || t("timeline.unknown") })}\n`;

        if (s.errorCode) {
          timeline += `${t("timeline.errorCode", { code: s.errorCode })}\n`;
        }
      } else if (item.errorMessage) {
        timeline += `${t("timeline.error", { error: item.errorMessage })}\n`;
      }

      timeline += `\n${t("timeline.http2FallbackNote")}`;
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
        timeline += `${t("timeline.reselect")}\n\n`;

        const excludedNames =
          ctx.filteredProviders
            ?.filter((f) => ctx.excludedProviderIds?.includes(f.id))
            .map((f) => f.name) || [];

        if (excludedNames.length > 0) {
          timeline += `${t("timeline.excluded", { providers: excludedNames.join(", ") })}\n`;
        }

        timeline += `${t("timeline.remainingCandidates", { count: ctx.afterHealthCheck })}\n`;
        timeline += t("timeline.selected", { provider: item.name });

        if (item.priority !== undefined && item.weight !== undefined) {
          timeline += t("timeline.withPriorityWeight", {
            priority: item.priority,
            weight: item.weight,
          });
        }

        timeline += `\n\n${t("timeline.waiting")}\n\n`;
        timeline += `[${elapsed.toString().padStart(4, "0")}ms] `;
      }
    }

    // === 请求成功 ===
    if (item.reason === "request_success" || item.reason === "retry_success") {
      const attemptLabel =
        actualAttemptNumber === 1
          ? t("timeline.firstAttempt")
          : t("timeline.nthAttempt", { attempt: actualAttemptNumber ?? 0 });
      timeline += `${t("timeline.requestSuccess", { label: attemptLabel })}\n\n`;

      timeline += `${t("timeline.provider", { provider: item.name })}\n`;
      timeline += `${t("timeline.successStatus", { code: item.statusCode || 200 })}\n`;

      // 模型重定向信息
      if (item.modelRedirect) {
        timeline += `\n${t("timeline.modelRedirect")}:\n`;
        timeline += `${t("timeline.modelRedirectFrom", {
          model: item.modelRedirect.originalModel,
        })}\n`;
        timeline += `${t("timeline.modelRedirectTo", {
          model: item.modelRedirect.redirectedModel,
        })}\n`;
        timeline += `${t("timeline.modelRedirectBilling", {
          model: item.modelRedirect.billingModel,
        })}\n`;
      }

      // 计算请求耗时
      if (i > 0 && item.timestamp && chain[i - 1]?.timestamp) {
        const duration = item.timestamp - (chain[i - 1]?.timestamp || 0);
        timeline += `${t("timeline.requestDurationSeconds", {
          duration: (duration / 1000).toFixed(2),
        })}\n`;
      }

      timeline += `\n${t("timeline.completed")}`;
      continue;
    }

    // 并发限制失败
    if (item.reason === "concurrent_limit_failed") {
      timeline += `${t("timeline.attemptFailed", { attempt: actualAttemptNumber ?? 0 })}\n\n`;
      timeline += `${t("timeline.provider", { provider: item.name })}\n`;

      if (ctx?.concurrentLimit) {
        timeline += `${t("timeline.concurrentLimitInfo", {
          current: ctx.currentConcurrent ?? 0,
          limit: ctx.concurrentLimit,
        })}\n`;
      }

      timeline += t("timeline.error", {
        error: item.errorMessage || t("timeline.concurrentLimit"),
      });
      continue;
    }

    // 默认
    timeline += `${item.name} (${item.reason || t("timeline.unknown")})`;
  }

  return { timeline, totalDuration };
}

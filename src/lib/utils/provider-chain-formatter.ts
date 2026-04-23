import type { ProviderChainItem } from "@/types/message";

/**
 * Format probability value for display.
 *
 * Handles:
 * - Normal 0-1 range: multiply by 100 (e.g., 0.5 -> "50.0%")
 * - Out-of-range values > 1: treat as already percentage, cap at 100 (e.g., 100 -> "100.0%")
 * - Invalid values (undefined, null, NaN, negative): returns null (hide badge)
 *
 * @param probability - The probability value (expected 0-1, but handles out-of-range)
 * @param decimals - Number of decimal places (default 1)
 * @returns Formatted percentage string or null if invalid
 */
export function formatProbability(
  probability: number | undefined | null,
  decimals = 1
): string | null {
  // Invalid values: hide badge
  if (probability === undefined || probability === null || Number.isNaN(probability)) {
    return null;
  }

  // Negative values: hide badge
  if (probability < 0) {
    return null;
  }

  // Normalize: if value > 1, it's likely already a percentage or out-of-range
  // Cap at 100% to prevent 10000.0% display
  let percentage: number;
  if (probability > 1) {
    // Value is already percentage-like or out-of-range, cap at 100
    percentage = Math.min(probability, 100);
  } else {
    // Normal 0-1 range, convert to percentage
    percentage = probability * 100;
  }

  return `${percentage.toFixed(decimals)}%`;
}

/**
 * Format probability for popover display (0 decimals).
 */
export function formatProbabilityCompact(probability: number | undefined | null): string | null {
  return formatProbability(probability, 0);
}

function formatDescriptionCandidate(
  candidate: { name: string; probability?: number },
  t: (key: string, values?: Record<string, string | number>) => string
): string {
  const formattedProbability = formatProbability(candidate.probability);

  if (!formattedProbability) {
    return t("description.candidateNoProbability", { name: candidate.name });
  }

  return t("description.candidate", {
    name: candidate.name,
    probability: formattedProbability,
  });
}

function formatTimelineCandidate(
  candidate: { name: string; weight: number; costMultiplier: number; probability?: number },
  t: (key: string, values?: Record<string, string | number>) => string
): string {
  const baseValues = {
    name: candidate.name,
    weight: candidate.weight,
    cost: candidate.costMultiplier,
  };
  const formattedProbability = formatProbability(candidate.probability);

  if (!formattedProbability) {
    return t("timeline.candidateInfoNoProbability", baseValues);
  }

  return t("timeline.candidateInfo", {
    ...baseValues,
    probability: formattedProbability,
  });
}

/**
 * 辅助函数：判断供应商请求状态
 *
 * ⚠️ 注意：retry_success 有两种含义
 * 1. 有 statusCode：实际请求成功
 * 2. 无 statusCode：仅表示选择成功（中间状态，不应显示）
 */
function getProviderStatus(item: ProviderChainItem): "✓" | "✗" | "⚡" | "↓" | null {
  // 成功标记：必须有 statusCode 且是成功状态码
  if (
    (item.reason === "request_success" ||
      item.reason === "retry_success" ||
      item.reason === "hedge_winner") &&
    item.statusCode
  ) {
    return "✓";
  }
  // 失败标记
  if (
    item.reason === "retry_failed" ||
    item.reason === "system_error" ||
    item.reason === "resource_not_found" ||
    item.reason === "client_error_non_retryable" ||
    item.reason === "endpoint_pool_exhausted" ||
    item.reason === "vendor_type_all_timeout" ||
    item.reason === "client_abort"
  ) {
    return "✗";
  }
  // Hedge 输家：取消标记
  if (item.reason === "hedge_loser_cancelled") {
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
  // Hedge 触发和启动（信息性事件，不是请求结果）
  if (item.reason === "hedge_triggered" || item.reason === "hedge_launched") {
    return null;
  }
  // 中间状态（选择成功但还没有请求结果）
  return null;
}

/**
 * Determine if a chain item represents an actual upstream request
 * (as opposed to intermediate states like initial_selection or hedge_triggered).
 *
 * Shared by provider-chain-popover and virtualized-logs-table.
 */
export function isActualRequest(item: ProviderChainItem): boolean {
  // 并发限制失败：算作一次尝试
  if (item.reason === "concurrent_limit_failed") return true;

  // 失败记录
  if (
    item.reason === "retry_failed" ||
    item.reason === "system_error" ||
    item.reason === "resource_not_found" ||
    item.reason === "client_error_non_retryable" ||
    item.reason === "endpoint_pool_exhausted" ||
    item.reason === "vendor_type_all_timeout" ||
    item.reason === "client_abort"
  ) {
    return true;
  }

  // Hedge 相关：winner 和 loser 都是实际请求
  if (item.reason === "hedge_winner" || item.reason === "hedge_loser_cancelled") return true;

  // Hedge 触发和启动：信息性事件，不算实际请求
  if (item.reason === "hedge_triggered" || item.reason === "hedge_launched") return false;

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
 * Determine if a decision chain contains a hedge race
 * (concurrent attempts, not sequential retries).
 */
export function isHedgeRace(chain: ProviderChainItem[]): boolean {
  return chain.some(
    (item) =>
      item.reason === "hedge_triggered" ||
      item.reason === "hedge_launched" ||
      item.reason === "hedge_winner" ||
      item.reason === "hedge_loser_cancelled"
  );
}

/**
 * Determine the final (winning) provider from a decision chain.
 *
 * Priority order:
 *  1. hedge_winner  -- the provider that won a hedge race
 *  2. Last request_success / retry_success with a statusCode
 *  3. Fallback to the last entry's name
 *
 * Returns null for empty / nullish chains.
 */
export function getFinalProviderName(chain: ProviderChainItem[] | null | undefined): string | null {
  if (!chain || chain.length === 0) return null;

  // Priority 1: hedge_winner
  const hedgeWinner = chain.find((item) => item.reason === "hedge_winner");
  if (hedgeWinner) return hedgeWinner.name;

  // Priority 2: last successful request (must have statusCode)
  for (let i = chain.length - 1; i >= 0; i--) {
    const item = chain[i];
    if ((item.reason === "request_success" || item.reason === "retry_success") && item.statusCode) {
      return item.name;
    }
  }

  // Priority 3: fallback to last entry
  return chain[chain.length - 1].name;
}

/**
 * Count real retries (excluding hedge race concurrent attempts).
 *
 * Design Decision:
 * - Hedge races are concurrent attempts, NOT sequential retries
 * - When a chain contains hedge race markers, we prioritize showing "Hedge Race"
 *   instead of retry count, as it's more important information for users
 *
 * Mixed Scenario Handling:
 * - If a chain contains BOTH sequential retries AND hedge race (e.g., retry_failed → hedge_triggered),
 *   this function returns 0 to indicate "no sequential retries to display"
 * - The UI will show "Hedge Race" badge instead of retry count
 * - This is intentional: hedge race takes precedence as it indicates concurrent provider competition
 *
 * @param chain - Provider decision chain
 * @returns Number of sequential retries (0 if hedge race detected)
 */
export function getRetryCount(chain: ProviderChainItem[]): number {
  if (isHedgeRace(chain)) {
    return 0;
  }

  const actualRequests = chain.filter(isActualRequest);
  return Math.max(0, actualRequests.length - 1);
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

function formatTimelineStatusCode(
  item: ProviderChainItem,
  code: number,
  t: (key: string, values?: Record<string, string | number>) => string
): string {
  return item.statusCodeInferred
    ? t("timeline.statusCodeInferred", { code })
    : t("timeline.statusCode", { code });
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
 * 辅助函数：格式化请求详情
 *
 * 将 errorDetails.request 格式化为可读的文本
 */
function formatRequestDetails(
  request: NonNullable<ProviderChainItem["errorDetails"]>["request"],
  t: (key: string, values?: Record<string, string | number>) => string
): string {
  if (!request) return "";

  let details = `\n${t("timeline.requestDetails")}:\n`;

  // URL 和方法
  details += `${t("timeline.requestMethod")}: ${request.method}\n`;
  details += `${t("timeline.requestUrl")}: ${request.url}\n`;

  // 请求头
  if (request.headers && request.headers !== "(empty)") {
    details += `${t("timeline.requestHeaders")}:\n`;
    // 缩进每一行
    const headerLines = request.headers.split("\n");
    for (const line of headerLines) {
      details += `  ${line}\n`;
    }
  }

  // 请求体
  if (request.body && request.body !== "(no body)") {
    details += `${t("timeline.requestBody")}`;
    if (request.bodyTruncated) {
      details += ` ${t("timeline.requestBodyTruncated")}`;
    }
    details += `:\n`;
    // 缩进请求体，限制显示长度
    const bodyPreview =
      request.body.length > 500 ? `${request.body.slice(0, 500)}...` : request.body;
    const bodyLines = bodyPreview.split("\n");
    for (const line of bodyLines) {
      details += `  ${line}\n`;
    }
  }

  return details;
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
      desc += ctx.candidatesAtPriority.map((c) => formatDescriptionCandidate(c, t)).join(" ");
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
      } else if (item.reason === "client_error_non_retryable") {
        desc += ` ${t("description.clientError")}`;
      } else if (item.reason === "resource_not_found") {
        desc += ` ${t("description.resourceNotFound")}`;
      } else if (item.reason === "endpoint_pool_exhausted") {
        desc += ` ${t("description.endpointPoolExhausted")}`;
      } else if (item.reason === "vendor_type_all_timeout") {
        desc += ` ${t("description.vendorTypeAllTimeout")}`;
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

    // === Session reuse client restriction ===
    if (item.reason === "client_restriction_filtered" && ctx) {
      timeline += `${t("filterDetails.session_reuse_client_restriction")}\n\n`;
      timeline += `${t("timeline.provider", { provider: item.name })}\n`;
      if (ctx.filteredProviders && ctx.filteredProviders.length > 0) {
        const f = ctx.filteredProviders[0];
        if (f.clientRestrictionContext) {
          const crc = f.clientRestrictionContext;
          const detailKey = `filterDetails.${crc.matchType}`;
          const detailsText = crc.matchedPattern
            ? t(detailKey, { pattern: crc.matchedPattern })
            : t(detailKey);
          timeline += `${detailsText}\n`;
          if (crc.detectedClient) {
            timeline += `${t("filterDetails.detectedClient", { client: crc.detectedClient })}\n`;
          }
        }
      }
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
          const icon =
            f.reason === "circuit_open" ? "⚡" : f.reason === "client_restriction" ? "🚫" : "💰";
          const detailsText = f.details
            ? t(`filterDetails.${f.details}`) !== `filterDetails.${f.details}`
              ? t(`filterDetails.${f.details}`)
              : f.details
            : f.reason;
          timeline += `  ${icon} ${f.name} (${detailsText})\n`;

          // Client restriction context details
          if (f.clientRestrictionContext) {
            const crc = f.clientRestrictionContext;
            if (crc.detectedClient) {
              timeline += `    ${t("filterDetails.detectedClient", { client: crc.detectedClient })}\n`;
            }
            if (crc.providerAllowlist.length > 0) {
              timeline += `    ${t("filterDetails.providerAllowlist", { list: crc.providerAllowlist.join(", ") })}\n`;
            }
            if (crc.providerBlocklist.length > 0) {
              timeline += `    ${t("filterDetails.providerBlocklist", { list: crc.providerBlocklist.join(", ") })}\n`;
            }
          }
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
          timeline += `${formatTimelineCandidate(c, t)}\n`;
        }
      }

      timeline += `\n${t("timeline.selected", { provider: item.name })}`;
      timeline += `\n\n${t("timeline.waiting")}`;
      continue;
    }

    // === 资源不存在（上游 404） ===
    if (item.reason === "resource_not_found") {
      const attempt = actualAttemptNumber ?? item.attemptNumber ?? 0;
      timeline += `${t("timeline.resourceNotFoundFailed", { attempt })}\n\n`;

      if (item.errorDetails?.provider) {
        const p = item.errorDetails.provider;
        timeline += `${t("timeline.provider", { provider: p.name })}\n`;
        timeline += `${formatTimelineStatusCode(item, p.statusCode, t)}\n`;
        timeline += `${t("timeline.error", { error: p.statusText })}\n`;

        // 计算请求耗时
        if (i > 0 && item.timestamp && chain[i - 1]?.timestamp) {
          const duration = item.timestamp - (chain[i - 1]?.timestamp || 0);
          timeline += `${t("timeline.requestDuration", { duration })}\n`;
        }

        // 错误详情（格式化 JSON）
        if (p.upstreamParsed) {
          timeline += `\n${t("timeline.errorDetails")}:\n`;
          timeline += JSON.stringify(p.upstreamParsed, null, 2);
        } else if (p.upstreamBody) {
          timeline += `\n${t("timeline.errorDetails")}:\n${p.upstreamBody}`;
        }
      } else {
        timeline += `${t("timeline.provider", { provider: item.name })}\n`;
        if (item.statusCode) {
          timeline += `${formatTimelineStatusCode(item, item.statusCode, t)}\n`;
        }
        timeline += t("timeline.error", { error: item.errorMessage || t("timeline.unknown") });
      }

      // 请求详情（用于问题排查）
      if (item.errorDetails?.request) {
        timeline += formatRequestDetails(item.errorDetails.request, t);
      }

      timeline += `\n${t("timeline.resourceNotFoundNote")}`;
      continue;
    }

    // === 供应商错误（请求失败） ===
    if (item.reason === "retry_failed") {
      timeline += `${t("timeline.requestFailed", { attempt: actualAttemptNumber ?? 0 })}\n\n`;

      // ⭐ 使用结构化错误数据
      if (item.errorDetails?.provider) {
        const p = item.errorDetails.provider;
        timeline += `${t("timeline.provider", { provider: p.name })}\n`;
        timeline += `${formatTimelineStatusCode(item, p.statusCode, t)}\n`;
        timeline += `${t("timeline.error", { error: p.statusText })}\n`;

        // 计算请求耗时
        if (i > 0 && item.timestamp && chain[i - 1]?.timestamp) {
          const duration = item.timestamp - (chain[i - 1]?.timestamp || 0);
          timeline += `${t("timeline.requestDuration", { duration })}\n`;
        }

        // 熔断状态
        if (item.circuitFailureCount !== undefined && item.circuitFailureThreshold !== undefined) {
          timeline += `\n${t("timeline.circuitStatus")}:\n`;
          if (item.circuitFailureThreshold === 0) {
            timeline += `${t("timeline.circuitDisabled")}\n`;
          } else {
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
        }

        // 错误详情（格式化 JSON）
        if (p.upstreamParsed) {
          timeline += `\n${t("timeline.errorDetails")}:\n`;
          timeline += JSON.stringify(p.upstreamParsed, null, 2);
        } else if (p.upstreamBody) {
          timeline += `\n${t("timeline.errorDetails")}:\n${p.upstreamBody}`;
        }

        // 请求详情（用于问题排查）
        if (item.errorDetails?.request) {
          timeline += formatRequestDetails(item.errorDetails.request, t);
        }
      } else {
        // 降级：使用 errorMessage
        timeline += `${t("timeline.provider", { provider: item.name })}\n`;
        if (item.statusCode) {
          timeline += `${formatTimelineStatusCode(item, item.statusCode, t)}\n`;
        }
        timeline += t("timeline.error", { error: item.errorMessage || t("timeline.unknown") });

        // 请求详情（降级路径）
        if (item.errorDetails?.request) {
          timeline += formatRequestDetails(item.errorDetails.request, t);
        }
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
            // 无已知含义时，优先显示完整错误消息
            timeline += `${t("timeline.errorType") + (s.errorMessage || s.errorName || t("timeline.unknown"))}\n`;
          }
        } else {
          // 无错误码时，显示完整错误消息而非简单的 errorName（如 "TypeError"）
          timeline += `${t("timeline.errorType") + (s.errorMessage || s.errorName || t("timeline.unknown"))}\n`;
        }

        // 显示完整的错误消息（优先使用 errorMessage，因为它包含更多细节）
        timeline += `${t("timeline.error", { error: s.errorMessage || s.errorName })}\n`;

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

        // 请求详情（用于问题排查）
        if (item.errorDetails?.request) {
          timeline += formatRequestDetails(item.errorDetails.request, t);
        }

        timeline += `\n${t("timeline.systemErrorNote")}`;
      } else {
        // 降级
        timeline += `${t("timeline.provider", { provider: item.name })}\n`;
        timeline += `${t("timeline.error", { error: item.errorMessage || t("timeline.unknown") })}\n`;

        // 请求详情（降级路径）
        if (item.errorDetails?.request) {
          timeline += formatRequestDetails(item.errorDetails.request, t);
        }

        timeline += `\n${t("timeline.systemErrorNote")}`;
      }

      continue;
    }

    // === 不可重试的客户端错误 ===
    if (item.reason === "client_error_non_retryable") {
      const attempt = item.attemptNumber ?? actualAttemptNumber ?? 0;
      timeline += `${t("timeline.clientErrorNonRetryable", { attempt })}\n\n`;

      if (item.errorDetails?.provider) {
        const p = item.errorDetails.provider;
        timeline += `${t("timeline.provider", { provider: p.name })}\n`;
        timeline += `${formatTimelineStatusCode(item, p.statusCode, t)}\n`;
        timeline += `${t("timeline.error", { error: p.statusText })}\n`;
      } else {
        timeline += `${t("timeline.provider", { provider: item.name })}\n`;
        if (item.statusCode) {
          timeline += `${formatTimelineStatusCode(item, item.statusCode, t)}\n`;
        }
        timeline += `${t("timeline.error", { error: item.errorMessage || t("timeline.unknown") })}\n`;
      }

      if (item.errorDetails?.matchedRule) {
        const rule = item.errorDetails.matchedRule;
        timeline += `\n${t("timeline.matchedRule")}:\n`;
        timeline += `${t("timeline.ruleId", { id: rule.ruleId })}\n`;
        timeline += `${t("timeline.ruleCategory", { category: rule.category })}\n`;
        timeline += `${t("timeline.rulePattern", { pattern: rule.pattern })}\n`;
        timeline += `${t("timeline.ruleMatchType", { matchType: rule.matchType })}\n`;
        if (rule.description) {
          timeline += `${t("timeline.ruleDescription", { description: rule.description })}\n`;
        }
        timeline += `${t("timeline.ruleHasOverride", {
          response: rule.hasOverrideResponse ? "true" : "false",
          statusCode: rule.hasOverrideStatusCode ? "true" : "false",
        })}\n`;
      }

      if (item.errorDetails?.request) {
        timeline += formatRequestDetails(item.errorDetails.request, t);
      }

      timeline += `\n${t("timeline.clientErrorNote")}`;
      continue;
    }

    // === HTTP/2 协议回退 ===
    if (item.reason === "http2_fallback") {
      timeline += `${t("timeline.http2Fallback")}\n\n`;

      timeline += `${t("timeline.provider", { provider: item.name })}\n`;

      // 使用结构化错误数据
      if (item.errorDetails?.system) {
        const s = item.errorDetails.system;
        // 优先使用完整错误消息，提供更多排错信息
        timeline += `${t("timeline.http2ErrorType", { type: s.errorMessage || s.errorName || t("timeline.unknown") })}\n`;

        if (s.errorCode) {
          timeline += `${t("timeline.errorCode", { code: s.errorCode })}\n`;
        }
      } else if (item.errorMessage) {
        timeline += `${t("timeline.error", { error: item.errorMessage })}\n`;
      }

      // 请求详情（用于问题排查）
      if (item.errorDetails?.request) {
        timeline += formatRequestDetails(item.errorDetails.request, t);
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

    // === 端点池耗尽 ===
    if (item.reason === "endpoint_pool_exhausted") {
      timeline += `${t("timeline.endpointPoolExhausted")}\n\n`;
      timeline += `${t("timeline.provider", { provider: item.name })}\n`;

      // 端点过滤统计
      if (item.endpointFilterStats && typeof item.endpointFilterStats.total === "number") {
        const stats = item.endpointFilterStats;
        timeline += `\n${t("timeline.endpointStats")}:\n`;
        timeline += `${t("timeline.endpointStatsTotal", { count: stats.total })}\n`;
        timeline += `${t("timeline.endpointStatsEnabled", { count: stats.enabled })}\n`;
        timeline += `${t("timeline.endpointStatsCircuitOpen", { count: stats.circuitOpen })}\n`;
        timeline += `${t("timeline.endpointStatsAvailable", { count: stats.available })}\n`;
      }

      // 严格模式阻止原因
      if (item.strictBlockCause === "no_endpoint_candidates") {
        timeline += `\n${t("timeline.strictBlockNoEndpoints")}`;
      } else if (item.strictBlockCause === "selector_error") {
        timeline += `\n${t("timeline.strictBlockSelectorError")}`;
        if (item.errorMessage) {
          timeline += `\n${t("timeline.error", { error: item.errorMessage })}`;
        }
      }

      continue;
    }

    // === 供应商类型全端点超时（524） ===
    if (item.reason === "vendor_type_all_timeout") {
      timeline += `${t("timeline.vendorTypeAllTimeout")}\n\n`;

      if (item.errorDetails?.provider) {
        const p = item.errorDetails.provider;
        timeline += `${t("timeline.provider", { provider: p.name })}\n`;
        timeline += `${t("timeline.statusCode", { code: p.statusCode })}\n`;
        timeline += `${t("timeline.error", { error: p.statusText })}\n`;

        if (i > 0 && item.timestamp && chain[i - 1]?.timestamp) {
          const duration = item.timestamp - (chain[i - 1]?.timestamp || 0);
          timeline += `${t("timeline.requestDuration", { duration })}\n`;
        }

        if (p.upstreamParsed) {
          timeline += `\n${t("timeline.errorDetails")}:\n`;
          timeline += JSON.stringify(p.upstreamParsed, null, 2);
        } else if (p.upstreamBody) {
          timeline += `\n${t("timeline.errorDetails")}:\n${p.upstreamBody}`;
        }

        if (item.errorDetails?.request) {
          timeline += formatRequestDetails(item.errorDetails.request, t);
        }
      } else {
        timeline += `${t("timeline.provider", { provider: item.name })}\n`;
        if (item.statusCode) {
          timeline += `${t("timeline.statusCode", { code: item.statusCode })}\n`;
        }
        timeline += `${t("timeline.error", { error: item.errorMessage || t("timeline.unknown") })}\n`;

        if (item.errorDetails?.request) {
          timeline += formatRequestDetails(item.errorDetails.request, t);
        }
      }

      timeline += `\n${t("timeline.vendorTypeAllTimeoutNote")}`;
      continue;
    }

    // === Hedge 备选供应商启动 ===
    if (item.reason === "hedge_launched") {
      timeline += `${t("timeline.hedgeLaunched")}\n\n`;
      timeline += `${t("timeline.provider", { provider: item.name })}\n`;
      timeline += `${t("timeline.attemptNumber", { number: actualAttemptNumber || item.attemptNumber || 0 })}\n`;
      if (item.circuitState) {
        timeline += `${t("timeline.circuitCurrent", { state: translateCircuitState(item.circuitState, t) })}\n`;
      }
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

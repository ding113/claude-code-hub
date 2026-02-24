import type { CacheHitRateAlertAnomaly, CacheHitRateAlertData, StructuredMessage } from "../types";
import { formatDateTime } from "../utils/date";

function formatPercent(rate: number): string {
  if (!Number.isFinite(rate)) return "";
  return `${(rate * 100).toFixed(1)}%`;
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "";
  return Math.round(value).toString();
}

function formatAnomalyTitle(anomaly: CacheHitRateAlertAnomaly): string {
  const provider = anomaly.providerName?.trim()
    ? anomaly.providerName.trim()
    : `Provider #${anomaly.providerId}`;
  return `${provider} / ${anomaly.model}`;
}

function buildAnomalyDetails(anomaly: CacheHitRateAlertAnomaly): string {
  const lines: string[] = [];

  lines.push(
    `当前(${anomaly.current.kind}): ${formatPercent(anomaly.current.hitRateTokens)} (req=${formatNumber(
      anomaly.current.requests
    )}, tok=${formatNumber(anomaly.current.denominatorTokens)})`
  );

  if (anomaly.baseline) {
    const source = anomaly.baselineSource ?? "unknown";
    lines.push(
      `基线(${source} ${anomaly.baseline.kind}): ${formatPercent(
        anomaly.baseline.hitRateTokens
      )} (req=${formatNumber(anomaly.baseline.requests)}, tok=${formatNumber(
        anomaly.baseline.denominatorTokens
      )})`
    );
  } else {
    lines.push("基线: 无");
  }

  if (anomaly.dropAbs !== null && Number.isFinite(anomaly.dropAbs)) {
    lines.push(`绝对跌幅: ${formatPercent(anomaly.dropAbs)}`);
  }
  if (anomaly.deltaRel !== null && Number.isFinite(anomaly.deltaRel)) {
    lines.push(`相对变化: ${formatPercent(anomaly.deltaRel)}`);
  }

  return lines.join("\n");
}

export function buildCacheHitRateAlertMessage(
  data: CacheHitRateAlertData,
  timezone?: string
): StructuredMessage {
  const tz = timezone || "UTC";
  const anomalyCount = data.anomalies.length;

  return {
    header: {
      title: "缓存命中率异常告警",
      icon: "[CACHE]",
      level: "warning",
    },
    sections: [
      {
        content: [
          {
            type: "quote",
            value: anomalyCount > 0 ? `检测到缓存命中率异常（${anomalyCount} 条）` : "未检测到异常",
          },
        ],
      },
      {
        title: "检测窗口",
        content: [
          {
            type: "fields",
            items: [
              {
                label: "窗口",
                value: `${data.window.mode} (${data.window.durationMinutes} 分钟)`,
              },
              { label: "开始", value: formatDateTime(data.window.startTime, tz) },
              { label: "结束", value: formatDateTime(data.window.endTime, tz) },
              { label: "抑制数量", value: String(data.suppressedCount) },
            ],
          },
        ],
      },
      {
        title: "阈值",
        content: [
          {
            type: "fields",
            items: [
              { label: "绝对下限(absMin)", value: formatPercent(data.settings.absMin) },
              { label: "绝对跌幅(dropAbs)", value: formatPercent(data.settings.dropAbs) },
              { label: "相对跌幅(dropRel)", value: formatPercent(data.settings.dropRel) },
              {
                label: "最小样本",
                value: `req>=${data.settings.minEligibleRequests}, tok>=${data.settings.minEligibleTokens}`,
              },
              { label: "冷却", value: `${data.settings.cooldownMinutes} 分钟` },
            ],
          },
        ],
      },
      ...(anomalyCount > 0
        ? [
            {
              title: "异常列表",
              content: [
                {
                  type: "list" as const,
                  style: "bullet" as const,
                  items: data.anomalies.map((a) => ({
                    primary: formatAnomalyTitle(a),
                    secondary: buildAnomalyDetails(a),
                  })),
                },
              ],
            },
          ]
        : []),
    ],
    timestamp: new Date(),
  };
}

export interface CacheHitRateAlertMetric {
  providerId: number;
  model: string;

  totalRequests: number;
  denominatorTokens: number;
  hitRateTokens: number;

  eligibleRequests: number;
  eligibleDenominatorTokens: number;
  hitRateTokensEligible: number;
}

export type CacheHitRateAlertMetricKey = string;

export type CacheHitRateAlertMetricCollection =
  | ReadonlyArray<CacheHitRateAlertMetric>
  | ReadonlyMap<CacheHitRateAlertMetricKey, CacheHitRateAlertMetric>;

export interface CacheHitRateAlertDecisionSettings {
  /** 当前 hitRate 绝对值低于该阈值直接告警 */
  absMin: number;
  /** 相对跌幅阈值：dropAbs / baseline >= dropRel */
  dropRel: number;
  /** 绝对跌幅阈值：baseline - current >= dropAbs */
  dropAbs: number;
  /** eligible 口径不足时可 fallback overall；不足则不参与告警 */
  minEligibleRequests: number;
  minEligibleTokens: number;
  /** 返回的告警条数上限 */
  topN: number;
}

export type CacheHitRateAlertBaselineSource = "historical" | "today" | "prev" | null;
export type CacheHitRateAlertMetricKind = "eligible" | "overall";

export interface CacheHitRateAlertSample {
  kind: CacheHitRateAlertMetricKind;
  requests: number;
  denominatorTokens: number;
  hitRateTokens: number;
}

export interface CacheHitRateAlertAnomaly {
  key: CacheHitRateAlertMetricKey;
  providerId: number;
  model: string;

  baselineSource: CacheHitRateAlertBaselineSource;
  current: CacheHitRateAlertSample;
  baseline: CacheHitRateAlertSample | null;

  deltaAbs: number | null;
  deltaRel: number | null;
  dropAbs: number | null;

  reasonCodes: string[];
}

export interface CacheHitRateAlertDecisionInput {
  current: CacheHitRateAlertMetricCollection;
  prev: CacheHitRateAlertMetricCollection;
  today: CacheHitRateAlertMetricCollection;
  historical: CacheHitRateAlertMetricCollection;
  settings: CacheHitRateAlertDecisionSettings;
}

function clampRate01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 1);
}

export function toCacheHitRateAlertMetricKey(providerId: number, model: string): string {
  return `${providerId}:${model}`;
}

function isMetricArray(
  input: CacheHitRateAlertMetricCollection
): input is ReadonlyArray<CacheHitRateAlertMetric> {
  return Array.isArray(input);
}

function toMetricMap(
  input: CacheHitRateAlertMetricCollection
): Map<string, CacheHitRateAlertMetric> {
  if (isMetricArray(input)) {
    const map = new Map<string, CacheHitRateAlertMetric>();
    for (const item of input) {
      if (!item) continue;
      if (!item.model || item.model.trim() === "") continue;
      map.set(toCacheHitRateAlertMetricKey(item.providerId, item.model), item);
    }
    return map;
  }

  return new Map([...input]);
}

function pickSample(
  metric: CacheHitRateAlertMetric,
  settings: CacheHitRateAlertDecisionSettings
): { sample: CacheHitRateAlertSample; reasonCodes: string[] } | null {
  const eligibleOk =
    metric.eligibleRequests >= settings.minEligibleRequests &&
    metric.eligibleDenominatorTokens >= settings.minEligibleTokens;
  if (eligibleOk) {
    return {
      sample: {
        kind: "eligible",
        requests: metric.eligibleRequests,
        denominatorTokens: metric.eligibleDenominatorTokens,
        hitRateTokens: clampRate01(metric.hitRateTokensEligible),
      },
      reasonCodes: ["use_eligible"],
    };
  }

  const overallOk =
    metric.totalRequests >= settings.minEligibleRequests &&
    metric.denominatorTokens >= settings.minEligibleTokens;
  if (!overallOk) {
    return null;
  }

  return {
    sample: {
      kind: "overall",
      requests: metric.totalRequests,
      denominatorTokens: metric.denominatorTokens,
      hitRateTokens: clampRate01(metric.hitRateTokens),
    },
    reasonCodes: ["use_overall", "eligible_insufficient"],
  };
}

function pickBaseline(
  kind: CacheHitRateAlertMetricKind,
  key: string,
  maps: Array<{
    source: Exclude<CacheHitRateAlertBaselineSource, null>;
    map: Map<string, CacheHitRateAlertMetric>;
  }>,
  settings: CacheHitRateAlertDecisionSettings
): {
  source: CacheHitRateAlertBaselineSource;
  sample: CacheHitRateAlertSample;
  reasonCodes: string[];
} | null {
  const baselineOk =
    kind === "eligible"
      ? (metric: CacheHitRateAlertMetric) =>
          metric.eligibleRequests >= settings.minEligibleRequests &&
          metric.eligibleDenominatorTokens >= settings.minEligibleTokens
      : (metric: CacheHitRateAlertMetric) =>
          metric.totalRequests >= settings.minEligibleRequests &&
          metric.denominatorTokens >= settings.minEligibleTokens;

  for (const { source, map } of maps) {
    const metric = map.get(key);
    if (!metric) continue;
    if (!baselineOk(metric)) continue;

    const sample: CacheHitRateAlertSample =
      kind === "eligible"
        ? {
            kind: "eligible",
            requests: metric.eligibleRequests,
            denominatorTokens: metric.eligibleDenominatorTokens,
            hitRateTokens: clampRate01(metric.hitRateTokensEligible),
          }
        : {
            kind: "overall",
            requests: metric.totalRequests,
            denominatorTokens: metric.denominatorTokens,
            hitRateTokens: clampRate01(metric.hitRateTokens),
          };

    const baselineKindCode = kind === "eligible" ? "baseline_eligible" : "baseline_overall";
    return {
      source,
      sample,
      reasonCodes: [baselineKindCode, `baseline_${source}`],
    };
  }
  return null;
}

export function decideCacheHitRateAnomalies(
  input: CacheHitRateAlertDecisionInput
): CacheHitRateAlertAnomaly[] {
  const settings = input.settings;
  if (settings.topN <= 0) return [];

  const currentMap = toMetricMap(input.current);
  const prevMap = toMetricMap(input.prev);
  const todayMap = toMetricMap(input.today);
  const historicalMap = toMetricMap(input.historical);

  const baselineCandidates: Array<{
    source: Exclude<CacheHitRateAlertBaselineSource, null>;
    map: Map<string, CacheHitRateAlertMetric>;
  }> = [
    { source: "historical", map: historicalMap },
    { source: "today", map: todayMap },
    { source: "prev", map: prevMap },
  ];

  const anomaliesWithSeverity: Array<{ anomaly: CacheHitRateAlertAnomaly; severity: number }> = [];

  for (const [key, currentMetric] of currentMap) {
    const currentPicked = pickSample(currentMetric, settings);
    if (!currentPicked) {
      continue;
    }

    const baselinePicked = pickBaseline(
      currentPicked.sample.kind,
      key,
      baselineCandidates,
      settings
    );
    if (!baselinePicked) {
      continue;
    }
    const baselineValue = baselinePicked.sample.hitRateTokens;

    const currentValue = currentPicked.sample.hitRateTokens;
    const deltaAbs = currentValue - baselineValue;
    const dropAbs = baselineValue - currentValue;
    const deltaRel = baselineValue <= 0 ? null : (currentValue - baselineValue) / baselineValue;

    const reasonCodes: string[] = [...currentPicked.reasonCodes];

    reasonCodes.push(...baselinePicked.reasonCodes);

    const triggered: string[] = [];

    if (currentValue < settings.absMin) {
      triggered.push("abs_min");
    }

    if (baselineValue > 0) {
      const effDropAbs = baselineValue - currentValue;
      const effDropRel = effDropAbs / baselineValue;
      if (effDropAbs >= settings.dropAbs && effDropRel >= settings.dropRel) {
        triggered.push("drop_abs_rel");
      }
    }

    if (triggered.length === 0) {
      continue;
    }

    reasonCodes.push(...triggered);

    const severity = Math.max(baselineValue - currentValue, settings.absMin - currentValue, 0);

    anomaliesWithSeverity.push({
      severity,
      anomaly: {
        key,
        providerId: currentMetric.providerId,
        model: currentMetric.model,
        baselineSource: baselinePicked?.source ?? null,
        current: currentPicked.sample,
        baseline: baselinePicked?.sample ?? null,
        deltaAbs,
        deltaRel,
        dropAbs,
        reasonCodes,
      },
    });
  }

  return anomaliesWithSeverity
    .sort((a, b) => b.severity - a.severity)
    .slice(0, settings.topN)
    .map((x) => x.anomaly);
}

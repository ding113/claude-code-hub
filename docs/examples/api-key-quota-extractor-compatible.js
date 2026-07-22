#!/usr/bin/env node
/**
 * Claude Code Hub getMyQuota extractor for ccswitch-style quota checks.
 *
 * Direct usage:
 *   node docs/examples/api-key-quota-extractor-compatible.js https://cch.example.com sk-your-api-key
 *
 * ccswitch template usage:
 *   Import or paste the exported `ccswitchTemplate` object.
 *
 * The request is:
 *   POST /api/actions/my-usage/getMyQuota
 *   Authorization: Bearer <apiKey>
 *   Content-Type: application/json
 *   Body: {}
 */

function toNumber(value, fallback = null) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function toBoolean(value, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function toStringOrNull(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function pickWindow(quotaWindows, name) {
  if (!quotaWindows || typeof quotaWindows !== "object") {
    return {};
  }
  const value = quotaWindows[name];
  return value && typeof value === "object" ? value : {};
}

function normalizeQuotaResponse(response) {
  const data =
    response && response.ok === true && response.data && typeof response.data === "object"
      ? response.data
      : {};

  const quotaWindows =
    data.quotaWindows && typeof data.quotaWindows === "object" ? data.quotaWindows : {};
  const fiveHour = pickWindow(quotaWindows, "fiveHour");
  const daily = pickWindow(quotaWindows, "daily");
  const weekly = pickWindow(quotaWindows, "weekly");
  const monthly = pickWindow(quotaWindows, "monthly");
  const total = pickWindow(quotaWindows, "total");

  const keyEnabled = toBoolean(data.keyIsEnabled, true);
  const userEnabled = toBoolean(data.userIsEnabled, true);
  const remaining = toNumber(data.remaining, toNumber(total.remainingUsd, null));
  const todayRemaining = toNumber(
    data.todayRemainingUsd,
    toNumber(daily.remainingUsd, toNumber(data.remainingDailyUsd, null))
  );

  return {
    ok: response && response.ok === true,
    isValid: response && response.ok === true && keyEnabled && userEnabled,
    invalidMessage: response && response.ok === true ? undefined : "Quota request failed",

    planName: "Claude Code Hub Usage",
    unit: typeof data.unit === "string" ? data.unit : "USD",

    keyName: toStringOrNull(data.keyName),
    userName: toStringOrNull(data.userName),
    providerGroup: toStringOrNull(data.providerGroup),
    keyIsEnabled: keyEnabled,
    userIsEnabled: userEnabled,

    remaining,
    todayRemaining,
    todayUsed: toNumber(data.todayUsedUsd, toNumber(daily.usedUsd, 0)),
    todayUsedPercent: toNumber(data.todayUsedPercent, toNumber(daily.usedPercent, null)),
    todayRemainingPercent: toNumber(
      data.todayRemainingPercent,
      toNumber(daily.remainingPercent, null)
    ),
    remainingPercent: toNumber(data.remainingPercent, toNumber(total.remainingPercent, null)),

    remaining5h: toNumber(fiveHour.remainingUsd, toNumber(data.remaining5hUsd, null)),
    remainingDaily: toNumber(daily.remainingUsd, toNumber(data.remainingDailyUsd, null)),
    remainingWeekly: toNumber(weekly.remainingUsd, toNumber(data.remainingWeeklyUsd, null)),
    remainingMonthly: toNumber(monthly.remainingUsd, toNumber(data.remainingMonthlyUsd, null)),
    remainingTotal: toNumber(total.remainingUsd, toNumber(data.remainingTotalUsd, null)),

    total: toNumber(total.limitUsd, toNumber(data.limitTotalUsd, null)),
    used: toNumber(total.usedUsd, toNumber(data.usedTotalUsd, 0)),
    rpmLimit: toNumber(data.rpmLimit, null),
    concurrentSessions: toNumber(data.concurrentSessions, 0),
    concurrentSessionsLimit: toNumber(data.concurrentSessionsLimit, null),
    expiresAt: toStringOrNull(data.expiresAt),
    resetMode: toStringOrNull(data.resetMode),
    resetTime: toStringOrNull(data.resetTime),

    quotaWindows: {
      fiveHour,
      daily,
      weekly,
      monthly,
      total,
    },

    balance: remaining,
    dailyBalance: todayRemaining,
    weeklyBalance: toNumber(weekly.remainingUsd, toNumber(data.remainingWeeklyUsd, null)),
    monthlyBalance: toNumber(monthly.remainingUsd, toNumber(data.remainingMonthlyUsd, null)),
    extra: [
      `5h=${toNumber(fiveHour.remainingUsd, "unlimited")}`,
      `daily=${todayRemaining ?? "unlimited"}`,
      `weekly=${toNumber(weekly.remainingUsd, "unlimited")}`,
      `monthly=${toNumber(monthly.remainingUsd, "unlimited")}`,
      `total=${toNumber(total.remainingUsd, remaining ?? "unlimited")}`,
    ].join(" "),
  };
}

const ccswitchTemplate = {
  request: {
    url: "{{baseUrl}}/api/actions/my-usage/getMyQuota",
    method: "POST",
    headers: {
      Authorization: "Bearer {{apiKey}}",
      "Content-Type": "application/json",
      "User-Agent": "cc-switch/1.0",
    },
    body: "{}",
  },
  extractor: normalizeQuotaResponse,
};

async function fetchQuota(baseUrl, apiKey) {
  const response = await fetch(new URL("/api/actions/my-usage/getMyQuota", baseUrl), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "User-Agent": "cc-switch/1.0",
    },
    body: "{}",
  });

  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`Quota API did not return JSON: HTTP ${response.status}`);
  }

  if (!response.ok || payload.ok !== true) {
    throw new Error(payload && typeof payload.error === "string" ? payload.error : `HTTP ${response.status}`);
  }

  return normalizeQuotaResponse(payload);
}

async function main() {
  const [, , baseUrl, apiKey] = process.argv;
  if (!baseUrl || !apiKey) {
    process.stderr.write(
      "Usage: node docs/examples/api-key-quota-extractor-compatible.js <baseUrl> <apiKey>\n"
    );
    process.exitCode = 1;
    return;
  }

  const quota = await fetchQuota(baseUrl, apiKey);
  process.stdout.write(`${JSON.stringify(quota, null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  ccswitchTemplate,
  fetchQuota,
  normalizeQuotaResponse,
};

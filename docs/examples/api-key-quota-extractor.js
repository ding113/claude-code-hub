/**
 * Direct Bearer API-key quota lookup adapter for Claude Code Hub.
 *
 * Usage:
 *   node docs/examples/api-key-quota-extractor.js \
 *     https://cch.fkcodex.com \
 *     sk-your-api-key
 *
 * This script calls:
 *   POST /api/actions/my-usage/getMyQuota
 * with:
 *   Authorization: Bearer <apiKey>
 *
 * and normalizes the response into a template-friendly structure.
 */

function assertOkResponse(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Quota API returned an empty or non-JSON response");
  }

  if (payload.ok !== true || !payload.data || typeof payload.data !== "object") {
    const errorMessage = typeof payload.error === "string" ? payload.error : "Quota API request failed";
    throw new Error(errorMessage);
  }

  return payload.data;
}

function pickNumber(value, fallback = null) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function pickBoolean(value, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function pickString(value, fallback = null) {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function normalizeQuotaData(data) {
  return {
    ok: true,

    keyName: pickString(data.keyName),
    userName: pickString(data.userName),
    providerGroup: pickString(data.providerGroup),

    keyIsEnabled: pickBoolean(data.keyIsEnabled),
    userIsEnabled: pickBoolean(data.userIsEnabled),

    remaining: pickNumber(data.remaining),
    unit: pickString(data.unit, "USD"),

    limit5hUsd: pickNumber(data.limit5hUsd),
    used5hUsd: pickNumber(data.used5hUsd, 0),
    remaining5hUsd: pickNumber(data.remaining5hUsd),

    limitDailyUsd: pickNumber(data.limitDailyUsd),
    usedDailyUsd: pickNumber(data.usedDailyUsd, 0),
    remainingDailyUsd: pickNumber(data.remainingDailyUsd),

    limitWeeklyUsd: pickNumber(data.limitWeeklyUsd),
    usedWeeklyUsd: pickNumber(data.usedWeeklyUsd, 0),
    remainingWeeklyUsd: pickNumber(data.remainingWeeklyUsd),

    limitMonthlyUsd: pickNumber(data.limitMonthlyUsd),
    usedMonthlyUsd: pickNumber(data.usedMonthlyUsd, 0),
    remainingMonthlyUsd: pickNumber(data.remainingMonthlyUsd),

    limitTotalUsd: pickNumber(data.limitTotalUsd),
    usedTotalUsd: pickNumber(data.usedTotalUsd, 0),
    remainingTotalUsd: pickNumber(data.remainingTotalUsd),

    rpmLimit: pickNumber(data.rpmLimit),
    concurrentSessions: pickNumber(data.concurrentSessions, 0),
    concurrentSessionsLimit: pickNumber(data.concurrentSessionsLimit),

    expiresAt: pickString(data.expiresAt),
    resetMode: pickString(data.resetMode),
    resetTime: pickString(data.resetTime),

    // Handy flat aliases for third-party template engines.
    isAvailable:
      pickBoolean(data.keyIsEnabled) && pickBoolean(data.userIsEnabled) && pickNumber(data.remaining, 0) > 0,
    balance: pickNumber(data.remaining),
    dailyBalance: pickNumber(data.remainingDailyUsd),
    weeklyBalance: pickNumber(data.remainingWeeklyUsd),
    monthlyBalance: pickNumber(data.remainingMonthlyUsd),
  };
}

async function fetchQuota(baseUrl, apiKey) {
  const url = new URL("/api/actions/my-usage/getMyQuota", baseUrl).toString();

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({}),
  });

  const text = await response.text();

  let payload;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    throw new Error(`Quota API did not return JSON (status ${response.status})`);
  }

  if (!response.ok) {
    const message = typeof payload?.error === "string" ? payload.error : `HTTP ${response.status}`;
    throw new Error(message);
  }

  return normalizeQuotaData(assertOkResponse(payload));
}

async function main() {
  const [, , baseUrl, apiKey] = process.argv;

  if (!baseUrl || !apiKey) {
    console.error("Usage: node docs/examples/api-key-quota-extractor.js <baseUrl> <apiKey>");
    process.exitCode = 1;
    return;
  }

  const result = await fetchQuota(baseUrl, apiKey);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

module.exports = {
  fetchQuota,
  normalizeQuotaData,
};

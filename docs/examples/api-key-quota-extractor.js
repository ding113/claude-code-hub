({
  request: {
    url: "{{baseUrl}}/api/actions/my-usage/getMyQuota",
    method: "POST",
    headers: {
      "Authorization": "Bearer {{apiKey}}",
      "Content-Type": "application/json",
      "User-Agent": "cc-switch/1.0"
    },
    body: "{}"
  },

  extractor: function(response) {
    const data = response && response.ok === true && response.data && typeof response.data === "object"
      ? response.data
      : {};

    const toNumber = function(value, fallback) {
      return typeof value === "number" && Number.isFinite(value) ? value : fallback;
    };

    const toBoolean = function(value, fallback) {
      return typeof value === "boolean" ? value : fallback;
    };

    return {
      ok: response && response.ok === true,
      isValid: toBoolean(data.keyIsEnabled, true) && toBoolean(data.userIsEnabled, true),
      planName: "Weekly Quota",

      keyName: typeof data.keyName === "string" ? data.keyName : null,
      userName: typeof data.userName === "string" ? data.userName : null,
      providerGroup: typeof data.providerGroup === "string" ? data.providerGroup : null,

      remaining: toNumber(data.remainingWeeklyUsd, null),
      total: toNumber(data.limitWeeklyUsd, null),
      used: toNumber(data.usedWeeklyUsd, 0),
      unit: typeof data.unit === "string" ? data.unit : "USD",

      remaining5hUsd: toNumber(data.remaining5hUsd, null),
      remainingDailyUsd: toNumber(data.remainingDailyUsd, null),
      remainingWeeklyUsd: toNumber(data.remainingWeeklyUsd, null),
      remainingMonthlyUsd: toNumber(data.remainingMonthlyUsd, null),
      remainingTotalUsd: toNumber(data.remainingTotalUsd, null),

      limit5hUsd: toNumber(data.limit5hUsd, null),
      limitDailyUsd: toNumber(data.limitDailyUsd, null),
      limitWeeklyUsd: toNumber(data.limitWeeklyUsd, null),
      limitMonthlyUsd: toNumber(data.limitMonthlyUsd, null),

      used5hUsd: toNumber(data.used5hUsd, 0),
      usedDailyUsd: toNumber(data.usedDailyUsd, 0),
      usedWeeklyUsd: toNumber(data.usedWeeklyUsd, 0),
      usedMonthlyUsd: toNumber(data.usedMonthlyUsd, 0),

      rpmLimit: toNumber(data.rpmLimit, null),
      expiresAt: typeof data.expiresAt === "string" ? data.expiresAt : null,
      resetMode: typeof data.resetMode === "string" ? data.resetMode : null,
      resetTime: typeof data.resetTime === "string" ? data.resetTime : null,
      extra: [
        "Overall remaining: " + (toNumber(data.remaining, null) ?? "unlimited"),
        "Daily remaining: " + (toNumber(data.remainingDailyUsd, null) ?? "unlimited"),
        "Monthly remaining: " + (toNumber(data.remainingMonthlyUsd, null) ?? "unlimited")
      ].join(" | "),

      balance: toNumber(data.remainingWeeklyUsd, null),
      dailyBalance: toNumber(data.remainingDailyUsd, null),
      weeklyBalance: toNumber(data.remainingWeeklyUsd, null),
      monthlyBalance: toNumber(data.remainingMonthlyUsd, null)
    };
  }
})

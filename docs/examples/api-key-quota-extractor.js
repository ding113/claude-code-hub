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

    const formatPercent = function(value) {
      return typeof value === "number" && Number.isFinite(value) ? value + "%" : "-";
    };

    const toBoolean = function(value, fallback) {
      return typeof value === "boolean" ? value : fallback;
    };

    const quotaWindows = data.quotaWindows && typeof data.quotaWindows === "object"
      ? data.quotaWindows
      : {};
    const fiveHour = quotaWindows.fiveHour || {};
    const daily = quotaWindows.daily || {};
    const weekly = quotaWindows.weekly || {};
    const monthly = quotaWindows.monthly || {};
    const total = quotaWindows.total || {};

    const isValid =
      response &&
      response.ok === true &&
      toBoolean(data.keyIsEnabled, true) &&
      toBoolean(data.userIsEnabled, true);

    return {
      isValid: !!isValid,
      invalidMessage: isValid ? undefined : "套餐不可用",
      remaining: toNumber(total.remainingUsd, toNumber(data.remainingTotalUsd, null)),
      unit: typeof data.unit === "string" ? data.unit : "USD",
      planName: "Total Quota",
      total: toNumber(total.limitUsd, toNumber(data.limitTotalUsd, null)),
      used: toNumber(total.usedUsd, toNumber(data.usedTotalUsd, 0)),
      todayUsed: toNumber(data.todayUsedUsd, toNumber(daily.usedUsd, 0)),
      todayRemaining: toNumber(data.todayRemainingUsd, toNumber(daily.remainingUsd, null)),
      remainingWeekly: toNumber(weekly.remainingUsd, toNumber(data.remainingWeeklyUsd, null)),
      remainingMonthly: toNumber(monthly.remainingUsd, toNumber(data.remainingMonthlyUsd, null)),
      remainingTotal: toNumber(total.remainingUsd, toNumber(data.remainingTotalUsd, null)),
      remaining5h: toNumber(fiveHour.remainingUsd, toNumber(data.remaining5hUsd, null)),
      remainingDaily: toNumber(daily.remainingUsd, toNumber(data.remainingDailyUsd, null)),
      extra: "5H剩余:" + formatPercent(fiveHour.remainingPercent)
        + "/日剩余:" + formatPercent(toNumber(daily.remainingPercent, data.todayRemainingPercent))
        + "/周剩余:" + formatPercent(weekly.remainingPercent)
        + "/月剩余:" + formatPercent(monthly.remainingPercent)
        + "/总剩余:" + formatPercent(toNumber(total.remainingPercent, data.remainingPercent))
    };
  }
})

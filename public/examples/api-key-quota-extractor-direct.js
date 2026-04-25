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
    const quotaWindows = data.quotaWindows && typeof data.quotaWindows === "object"
      ? data.quotaWindows
      : {};
    const fiveHour = quotaWindows.fiveHour || {};
    const daily = quotaWindows.daily || {};
    const weekly = quotaWindows.weekly || {};
    const monthly = quotaWindows.monthly || {};
    const total = quotaWindows.total || {};

    const toBoolean = function(value, fallback) {
      return typeof value === "boolean" ? value : fallback;
    };

    const isValid =
      response &&
      response.ok === true &&
      toBoolean(data.keyIsEnabled, true) &&
      toBoolean(data.userIsEnabled, true);

    return {
      isValid: !!isValid,
      invalidMessage: isValid ? undefined : "套餐不可用",
      planName: "Total Quota",
      unit: typeof data.unit === "string" ? data.unit : "USD",
      remaining: total.remainingUsd,
      total: total.limitUsd,
      used: total.usedUsd,
      todayUsed: data.todayUsedUsd,
      todayRemaining: data.todayRemainingUsd,
      todayUsedPercent: data.todayUsedPercent,
      todayRemainingPercent: data.todayRemainingPercent,
      remaining5h: fiveHour.remainingUsd,
      remainingDaily: daily.remainingUsd,
      remainingWeekly: weekly.remainingUsd,
      remainingMonthly: monthly.remainingUsd,
      remainingTotal: total.remainingUsd,
      remainingPercent: data.remainingPercent,
      extra: "5H剩余:" + fiveHour.remainingPercent + "%"
        + "/日剩余:" + daily.remainingPercent + "%"
        + "/周剩余:" + weekly.remainingPercent + "%"
        + "/月剩余:" + monthly.remainingPercent + "%"
        + "/总剩余:" + total.remainingPercent + "%"
    };
  }
})

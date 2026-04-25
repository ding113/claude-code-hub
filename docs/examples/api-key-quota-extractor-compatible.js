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

    const round2 = function(value) {
      return Math.round(value * 100) / 100;
    };

    const percent = function(used, total) {
      return total > 0 ? round2((used / total) * 100) : null;
    };

    const quotaWindows = data.quotaWindows && typeof data.quotaWindows === "object"
      ? data.quotaWindows
      : {};
    const fiveHour = quotaWindows.fiveHour || {};
    const daily = quotaWindows.daily || {};
    const weekly = quotaWindows.weekly || {};
    const monthly = quotaWindows.monthly || {};
    const total = quotaWindows.total || {};

    const limitMonthlyUsd = toNumber(data.limitMonthlyUsd, null);
    const limitTotalUsd = toNumber(data.limitTotalUsd, limitMonthlyUsd);
    const usedTotalUsd = toNumber(data.usedTotalUsd, toNumber(data.usedMonthlyUsd, 0));
    const remainingTotalUsd = limitTotalUsd === null ? null : round2(Math.max(limitTotalUsd - usedTotalUsd, 0));

    const limitDailyUsd = toNumber(data.limitDailyUsd, null);
    const usedDailyUsd = toNumber(data.usedDailyUsd, 0);
    const remainingDailyUsd = limitDailyUsd === null ? null : round2(Math.max(limitDailyUsd - usedDailyUsd, 0));

    const limit5hUsd = toNumber(data.limit5hUsd, null);
    const used5hUsd = toNumber(data.used5hUsd, 0);
    const remaining5hUsd = limit5hUsd === null ? null : round2(Math.max(limit5hUsd - used5hUsd, 0));

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
      remaining: toNumber(total.remainingUsd, remainingTotalUsd),
      total: toNumber(total.limitUsd, limitTotalUsd),
      used: toNumber(total.usedUsd, usedTotalUsd),
      todayUsed: toNumber(data.todayUsedUsd, toNumber(daily.usedUsd, usedDailyUsd)),
      todayRemaining: toNumber(data.todayRemainingUsd, toNumber(daily.remainingUsd, remainingDailyUsd)),
      todayUsedPercent: toNumber(data.todayUsedPercent, toNumber(daily.usedPercent, percent(usedDailyUsd, limitDailyUsd))),
      todayRemainingPercent: toNumber(
        data.todayRemainingPercent,
        toNumber(daily.remainingPercent, percent(remainingDailyUsd || 0, limitDailyUsd))
      ),
      remaining5h: toNumber(fiveHour.remainingUsd, remaining5hUsd),
      remainingDaily: toNumber(daily.remainingUsd, remainingDailyUsd),
      remainingWeekly: toNumber(weekly.remainingUsd, toNumber(data.remainingWeeklyUsd, null)),
      remainingMonthly: toNumber(monthly.remainingUsd, toNumber(data.remainingMonthlyUsd, null)),
      remainingTotal: toNumber(total.remainingUsd, remainingTotalUsd),
      remainingPercent: toNumber(total.remainingPercent, data.remainingPercent),
      extra: "5H剩余:" + toNumber(fiveHour.remainingPercent, percent(remaining5hUsd || 0, limit5hUsd)) + "%"
        + "/日剩余:" + toNumber(daily.remainingPercent, percent(remainingDailyUsd || 0, limitDailyUsd)) + "%"
        + "/周剩余:" + toNumber(weekly.remainingPercent, null) + "%"
        + "/月剩余:" + toNumber(monthly.remainingPercent, null) + "%"
        + "/总剩余:" + toNumber(total.remainingPercent, data.remainingPercent) + "%"
    };
  }
})

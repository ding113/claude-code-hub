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
      return total > 0 ? ((used / total) * 100).toFixed(0) : "0";
    };

    const limitMonthlyUsd = toNumber(data.limitMonthlyUsd, null);
    const limitTotalUsd = toNumber(data.limitTotalUsd, limitMonthlyUsd);
    const totalComesFromMonthly =
      limitTotalUsd !== null &&
      limitMonthlyUsd !== null &&
      limitTotalUsd === limitMonthlyUsd;
    const usedUsd = totalComesFromMonthly
      ? toNumber(data.usedMonthlyUsd, 0)
      : toNumber(data.usedTotalUsd, toNumber(data.usedMonthlyUsd, 0));
    const remaining = limitTotalUsd === null ? null : Math.max(limitTotalUsd - usedUsd, 0);

    const used5hUsd = toNumber(data.used5hUsd, 0);
    const limit5hUsd = toNumber(data.limit5hUsd, 0);
    const monthlyPercentBase = limitMonthlyUsd !== null ? limitMonthlyUsd : limitTotalUsd;

    const isValid =
      response &&
      response.ok === true &&
      toBoolean(data.keyIsEnabled, true) &&
      toBoolean(data.userIsEnabled, true);

    return {
      isValid: !!isValid,
      invalidMessage: isValid ? undefined : "套餐不可用",
      remaining: remaining === null ? null : round2(Math.max(remaining, 0)),
      unit: typeof data.unit === "string" ? data.unit : "USD",
      planName: "Total Quota",
      total: limitTotalUsd === null ? null : round2(limitTotalUsd),
      used: round2(usedUsd),
      extra: "5H:" + percent(used5hUsd, limit5hUsd) + "%/?:"
        + percent(usedUsd, monthlyPercentBase) + "%"
    };
  }
})

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

    const quotaWindows = data.quotaWindows && typeof data.quotaWindows === "object"
      ? data.quotaWindows
      : {};
    const total = quotaWindows.total || {};

    return {
      ok: response && response.ok === true,
      isValid: toBoolean(data.keyIsEnabled, true) && toBoolean(data.userIsEnabled, true),
      planName: "Total Quota",
      remaining: toNumber(total.remainingUsd, toNumber(data.remainingTotalUsd, null)),
      total: toNumber(total.limitUsd, toNumber(data.limitTotalUsd, null)),
      used: toNumber(total.usedUsd, toNumber(data.usedTotalUsd, 0)),
      usedPercent: toNumber(total.usedPercent, null),
      remainingPercent: toNumber(total.remainingPercent, toNumber(data.remainingPercent, null)),
      unit: typeof data.unit === "string" ? data.unit : "USD",
      keyName: typeof data.keyName === "string" ? data.keyName : null,
      userName: typeof data.userName === "string" ? data.userName : null,
      providerGroup: typeof data.providerGroup === "string" ? data.providerGroup : null,
      resetMode: typeof data.resetMode === "string" ? data.resetMode : null,
      resetTime: typeof data.resetTime === "string" ? data.resetTime : null
    };
  }
})

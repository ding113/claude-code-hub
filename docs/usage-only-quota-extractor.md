# Usage-Only Quota Extractor

This note documents the minimal compatibility path for external quota checks.
It does not add a new endpoint or a new authentication surface.

## Endpoint

Call the existing action route with the API key as a Bearer token:

```bash
curl -sS "$CCH_BASE_URL/api/actions/my-usage/getMyQuota" \
  -H "Authorization: Bearer $CCH_API_KEY" \
  -H "Content-Type: application/json" \
  -X POST \
  --data '{}'
```

The route is `POST /api/actions/my-usage/getMyQuota`. The request body is `{}`.
It uses the existing `allowReadOnlyAccess` path, so read-only keys can query
their own usage data without gaining access to admin-only actions.

## Response Fields

The response shape is the standard action wrapper:

- `ok`: true when the action succeeds.
- `data`: quota payload for the current key and user.

Useful compatibility fields under `data` include:

- `remaining`: the most restrictive remaining USD amount across configured quota windows, or `null` when unlimited.
- `todayRemainingUsd`: remaining USD amount for the daily window.
- `todayUsedUsd`: used USD amount for the daily window.
- `todayRemainingPercent`: remaining percentage for the daily window.
- `remainingPercent`: the most restrictive remaining percentage across configured quota windows.
- `quotaWindows`: structured `fiveHour`, `daily`, `weekly`, `monthly`, and `total` quota windows.
- `remaining5hUsd`, `remainingDailyUsd`, `remainingWeeklyUsd`, `remainingMonthlyUsd`, `remainingTotalUsd`: flat remaining aliases.
- `rpmLimit`, `concurrentSessions`, `concurrentSessionsLimit`: rate and session limits.
- `keyName`, `userName`, `providerGroup`, `keyIsEnabled`, `userIsEnabled`: key and user metadata.

Each `quotaWindows.*` entry contains:

- `period`
- `limitUsd`
- `usedUsd`
- `remainingUsd`
- `usedPercent`
- `remainingPercent`
- `isUnlimited`
- `isExhausted`

## Example Script

Use `docs/examples/api-key-quota-extractor-compatible.js` as either a direct
Node.js checker or as a ccswitch-style template source.

Direct check:

```bash
node docs/examples/api-key-quota-extractor-compatible.js "$CCH_BASE_URL" "$CCH_API_KEY"
```

The normalized output includes ccswitch-friendly fields such as `remaining`,
`todayRemaining`, `quotaWindows`, `balance`, `dailyBalance`, `weeklyBalance`,
and `monthlyBalance`.

## PR Note

This is a compatibility extension for clients that already consume usage data.
It documents and normalizes the existing `getMyQuota` response fields. It does
not introduce a public quota endpoint, does not accept API keys in request
bodies, and does not bypass the existing `allowReadOnlyAccess` authorization
gate.

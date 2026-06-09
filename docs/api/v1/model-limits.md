# Per-Model Limits API

Admin endpoints for managing per-model cost limits scoped to a user or an API
key. These complement the mainline user/key quotas by letting you cap spend on a
single model (or all models via a `*` wildcard) without affecting the shared
account-level budget.

See the OpenAPI surface for the authoritative schema:

- OpenAPI JSON: `/api/v1/openapi.json`
- Scalar UI: `/api/v1/scalar` (tag: `Model Limits`)

## Feature flag

Per-model limiting is opt-in and is enforced only when both flags are set:

- `ENABLE_MODEL_RATE_LIMIT=true` (default `false`)
- `ENABLE_RATE_LIMIT=true` (default `true`)

The management endpoints below are always available to admins regardless of the
flag, so limits can be configured ahead of enabling enforcement. When the flag
is off, configured limits are stored but never evaluated, and the request path
is unchanged.

## Authentication

All endpoints require `admin` access (session cookie, opaque session bearer
token, or `ADMIN_TOKEN`; user API keys are rejected unless
`ENABLE_API_KEY_ADMIN_ACCESS=true` for an admin-owned key). Cookie-authenticated
mutations must include the CSRF token from `GET /api/v1/auth/csrf`.

Errors use the standard `application/problem+json` envelope. Notable codes:

- `model_limit.not_found` (404): the targeted limit row does not exist.
- `model_limit.action_failed` (400): the underlying action rejected the input.
- `auth.forbidden` (403): caller lacks admin access.

## Endpoints

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/v1/model-limits/users/{userId}` | List a user's per-model limits |
| `POST` | `/api/v1/model-limits/users/{userId}` | Create or update a user limit (`model` in body) |
| `DELETE` | `/api/v1/model-limits/users/{userId}/{model}` | Delete a user limit |
| `GET` | `/api/v1/model-limits/keys/{keyId}` | List a key's per-model limits |
| `POST` | `/api/v1/model-limits/keys/{keyId}` | Create or update a key limit (`model` in body) |
| `DELETE` | `/api/v1/model-limits/keys/{keyId}/{model}` | Delete a key limit |

For `DELETE`, URL-encode the `model` path segment. The wildcard `*` is
`%2A` (e.g. `/api/v1/model-limits/keys/42/%2A`).

### List response

```json
{
  "items": [
    {
      "scopeType": "user",
      "scopeId": 7,
      "model": "claude-opus-4",
      "rpmLimit": null,
      "limit5hUsd": 2.5,
      "limit5hResetMode": "fixed",
      "dailyLimitUsd": 10,
      "limitWeeklyUsd": null,
      "limitMonthlyUsd": 100,
      "limitTotalUsd": null,
      "limit5hCostResetAt": null
    }
  ]
}
```

### Upsert body

```json
{
  "model": "claude-opus-4",
  "limit5hUsd": 2.5,
  "limit5hResetMode": "fixed",
  "dailyLimitUsd": 10,
  "limitWeeklyUsd": null,
  "limitMonthlyUsd": 100,
  "limitTotalUsd": null
}
```

- `model` is required (1-128 chars). Use `*` for an all-models fallback.
- Each USD field is optional. Omit a field to leave it unchanged on update;
  send `null` to clear it (unlimited for that window).
- `limit5hResetMode` is `fixed` or `rolling` and applies to the 5-hour window.
- `rpmLimit` is reserved for a future release and is not enforced.

The endpoint upserts on `(scope, model)` and returns the resulting row (HTTP
200). `DELETE` returns HTTP 204 with no body.

## Resolution semantics

When a request is evaluated, the most specific matching limit is chosen via a
4-level lookup (first match wins; no stacking):

1. key + exact model
2. key + `*`
3. user + exact model
4. user + `*`

If none match, no per-model limit applies and the request continues under the
mainline user/key quotas only.

Usage is metered on the resolved (post-redirect) model name, consistent with the
`model` column stored in `usage_ledger`. Limits reuse the mainline lease
mechanism (PostgreSQL as the authoritative source, Redis lease slices, atomic
decrement). On Redis failure the limiter fails open by default
(`MODEL_RATE_LIMIT_FAIL_OPEN=true`).

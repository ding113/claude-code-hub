# Management API v1 Migration Guide

This guide maps the deprecated `/api/actions/*` management surface to the new REST
management API under `/api/v1/*`.

Closes #1123 by covering provider search and true provider key reveal through documented REST
endpoints.

## Boundaries

- `/api/v1/*` is the management REST API.
- `/v1/*` remains the Claude/OpenAI-compatible proxy API.
- `/api/actions/*` remains available by default, but is deprecated and guarded by
  `ENABLE_LEGACY_ACTIONS_API`.

## Authentication Changes

- Public endpoints, such as `GET /api/v1/public/status`, require no credentials.
- Read endpoints accept a valid session, `ADMIN_TOKEN`, or user API key.
- Admin endpoints accept sessions and `ADMIN_TOKEN` by default.
- Admin user API keys can call admin endpoints only when `ENABLE_API_KEY_ADMIN_ACCESS=true`.
- Cookie-authenticated mutations require `X-CCH-CSRF` from `GET /api/v1/auth/csrf`.

## Endpoint Mapping

```text
/api/actions/users/getUsersBatchCore        -> GET    /api/v1/users
/api/actions/users/addUser                  -> POST   /api/v1/users
/api/actions/users/editUser                 -> PATCH  /api/v1/users/{id}
/api/actions/users/removeUser               -> DELETE /api/v1/users/{id}
/api/actions/users/searchUsersForFilter     -> GET    /api/v1/users:filter-search
/api/actions/keys/getKeys                   -> GET    /api/v1/users/{userId}/keys
/api/actions/keys/addKey                    -> POST   /api/v1/users/{userId}/keys
/api/actions/keys/editKey                   -> PATCH  /api/v1/keys/{keyId}
/api/actions/providers/getProviders         -> GET    /api/v1/providers
/api/actions/providers/addProvider          -> POST   /api/v1/providers
/api/actions/providers/editProvider         -> PATCH  /api/v1/providers/{providerId}
/api/actions/providers/removeProvider       -> DELETE /api/v1/providers/{providerId}
/api/actions/providers/getUnmaskedProviderKey -> GET  /api/v1/providers/{providerId}/key:reveal
/api/actions/provider-endpoints/getProviderVendors -> GET /api/v1/provider-vendors
/api/actions/model-prices/getModelPricesPaginated -> GET /api/v1/model-prices
/api/actions/usage-logs/getUsageLogsBatch   -> GET    /api/v1/usage-logs
/api/actions/audit-logs/getAuditLogsBatch   -> GET    /api/v1/audit-logs
/api/actions/active-sessions/getActiveSessions -> GET /api/v1/sessions
/api/actions/my-usage/getMyQuota            -> GET    /api/v1/me/quota
/api/actions/system-config/fetchSystemSettings -> GET /api/v1/system/settings
/api/actions/public-status/getPublicStatusSettings -> GET /api/v1/public/status
```

The complete action coverage inventory is enforced by
`src/lib/api/v1/action-migration-matrix.ts` and
`tests/unit/api/v1/action-migration-matrix.test.ts`.

## Provider Search And Key Reveal

Issue #1123 asked for management API support for provider search and true key lookup.

- Provider search/listing: `GET /api/v1/providers?q=...`
- True key lookup: `GET /api/v1/providers/{providerId}/key:reveal`

`key:reveal` is admin-tier, emits audit context through the shared action bridge, and returns
`Cache-Control: no-store` so clients do not persist revealed secrets by accident.

## Legacy Deprecation

Legacy action routes include:

- `Deprecation`
- `Sunset`
- `Link: </api/v1/openapi.json>; rel="successor-version"`

Set `ENABLE_LEGACY_ACTIONS_API=false` to return `410 Gone` problem responses for legacy action
execution while keeping the new `/api/v1/*` API active.

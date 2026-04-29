# Management REST API v1

`/api/v1/*` is the REST management API for Claude Code Hub. Its HTTP surface is
mounted separately from:

- `/v1/*`: Claude/OpenAI-compatible proxy endpoints.
- `/api/actions/*`: legacy Server Action adapter, now deprecated.

During this migration, v1 handlers intentionally delegate to the existing
server-side business actions so REST, OpenAPI, audit logging, and frontend
traffic can converge without reimplementing business rules.

## Documentation

- OpenAPI JSON: `/api/v1/openapi.json`
- Scalar UI: `/api/v1/scalar`
- Swagger UI: `/api/v1/docs`

Every response includes `X-API-Version: 1.0.0`.

## Authentication

The API accepts three credential transports:

- Browser session cookie: `auth-token=<session>`.
- Bearer token: `Authorization: Bearer <token>`.
- API key header: `X-Api-Key: <key>`.

Access tiers:

- `public`: no authentication required. Example: `GET /api/v1/public/status`.
- `read`: accepts a valid session, `ADMIN_TOKEN`, or any valid user API key.
- `admin`: accepts a valid session cookie, opaque session bearer token, and `ADMIN_TOKEN` by default. User API keys are rejected unless `ENABLE_API_KEY_ADMIN_ACCESS=true` and the key belongs to an admin user.

Cookie-authenticated mutations must first call `GET /api/v1/auth/csrf` and send the returned token in `X-CCH-CSRF`.

## Error Format

Failures use RFC 9457-style `application/problem+json`:

```json
{
  "type": "https://claude-code-hub.local/problems/auth.forbidden",
  "title": "Forbidden",
  "status": 403,
  "detail": "Admin access is required.",
  "instance": "/api/v1/providers",
  "errorCode": "auth.forbidden",
  "errorParams": {}
}
```

Frontend code should localize by `errorCode` and `errorParams`, not display `detail` directly.

## Legacy Actions API

`/api/actions/*` remains available by default with deprecation headers:

- `Deprecation: @1777420800` style structured-field date for April 29, 2026
- `Sunset: Thu, 31 Dec 2026 00:00:00 GMT` style HTTP date unless overridden by `LEGACY_ACTIONS_SUNSET_DATE`
- `Link: </api/v1/openapi.json>; rel="successor-version"`

Set `ENABLE_LEGACY_ACTIONS_API=false` to return `410 Gone` for legacy action execution. Legacy docs stay visible unless `LEGACY_ACTIONS_DOCS_MODE=hidden`.

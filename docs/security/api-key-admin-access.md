# API Key Admin Access

`ENABLE_API_KEY_ADMIN_ACCESS` controls whether user-issued API keys can call admin-tier `/api/v1/*` routes.

Default:

```bash
ENABLE_API_KEY_ADMIN_ACCESS=false
```

With the default, admin-tier routes accept:

- Browser session cookies.
- Opaque session bearer tokens.
- `ADMIN_TOKEN`.

They reject user API keys, even when the key belongs to an admin user and is sent with `Authorization: Bearer`.

When enabled:

```bash
ENABLE_API_KEY_ADMIN_ACCESS=true
```

Admin-tier routes also accept user API keys whose owner has `role=admin`.

## Security Tradeoff

Enabling this flag makes third-party automation easier, but it also widens the blast radius of any leaked admin API key. Treat admin user keys as production secrets:

- Use separate keys for automation.
- Rotate keys regularly.
- Avoid sharing keys between tools.
- Keep `provider key reveal` responses out of logs and caches.

Sensitive reveal endpoints set `Cache-Control: no-store, no-cache, must-revalidate` and `Pragma: no-cache`, but clients should still avoid persisting returned secrets.

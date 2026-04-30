# `/api/v1` Typed Client

This package is the only browser-safe entry point for the `/api/v1` REST surface.
Server-only code (Server Actions, route handlers, jobs) must NOT import from this
folder; it lives under `src/lib/api-client/v1/` precisely so client components can
reach it without dragging in `next/server`, repository code, or environment-only
modules.

## `apiClient` namespace

Every resource exports a typed client that is also mounted on the shared
`apiClient` namespace via `Object.assign`. Examples:

```ts
import { apiClient } from "@/lib/api-client/v1/client";

await apiClient.users.list({ limit: 50 });
await apiClient.keys.create(userId, input);
await apiClient.providers.update(providerId, patch);
```

Per-resource modules also re-export the same client (`usersClient`,
`keysClient`, …) so call sites can inline a single import when they only need
one resource.

## Hooks

Each resource ships a `hooks.ts` file with TanStack Query wrappers:

- **Reads** use `useQuery` plus a stable query-key factory (`xxxKeys`):
  ```ts
  import { useUsersList } from "@/lib/api-client/v1/users/hooks";
  const { data } = useUsersList({ limit: 50 });
  ```
- **Writes** use `useApiMutation` (`src/lib/hooks/use-api-mutation.ts`), which
  invalidates the relevant query-key prefixes and surfaces RFC 9457 errors via
  `localizeError` + `sonner`:
  ```ts
  const { mutateAsync, isPending } = useUpdateUser(userId);
  await mutateAsync(patch);
  ```

The query-key factories live next to each resource (`xxx/keys.ts`) and are the
only sanctioned way to build query keys; cross-resource invalidation pulls them
from `v1Keys` (see `src/lib/api-client/v1/keys.ts`).

## CSRF auto-injection

`fetchApi` (in `fetcher.ts`) automatically attaches `X-CCH-CSRF` to mutating
verbs (POST / PUT / PATCH / DELETE) when the call uses cookie auth (no explicit
`Authorization` / `X-Api-Key`). The CSRF token is fetched once, cached at module
scope, and silently refreshed on `403 + errorCode === "csrf_invalid"`. Callers
do not need to think about CSRF.

## Forbidden pattern

Any file beginning with `'use client'` MUST NOT import from `@/actions/*`. The
gate at `tests/unit/frontend/client-action-import-inventory.test.ts` enforces
this; the allowlist is empty in strict mode.

```ts
// WRONG — bundles server-only code into the client and breaks the gate.
"use client";
import { batchUpdateUsers } from "@/actions/users";
```

```ts
// RIGHT — typed v1 hook with CSRF, query-key invalidation, and error toast.
"use client";
import { useBatchUpdateUsers } from "@/lib/api-client/v1/users/hooks";
```

If a v1 endpoint is still missing for a legacy action, add a thin hook in the
appropriate `xxx/hooks.ts` that wraps `fetchApi` against the legacy
`/api/actions/...` URL and tag it with a `// TODO:` for the follow-up endpoint.

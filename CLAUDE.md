# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Info

- **Source**: https://github.com/ding113/claude-code-hub
- **PR Target Branch**: `dev` (all pull requests must target the dev branch)

## Critical Rules

1. **No Emoji in Code** - Never use emoji characters in any code, comments, or string literals
2. **Test Coverage** - All new features must have unit test coverage of at least 80%
3. **i18n Required** - All user-facing strings must use i18n (5 languages supported). Never hardcode display text
4. **Pre-commit Checklist** - Before committing, always run:
   ```bash
   bun run build      # Production build
   bun run lint       # Biome check
   bun run lint:fix   # Biome auto-fix
   bun run typecheck  # TypeScript check (uses tsgo)
   bun run test       # Run Vitest tests
   ```

## Build & Development Commands

```bash
# Development
bun install               # Install dependencies
bun run dev               # Run tsgo preflight, then start dev server (port 13500)

# Build & Production
bun run build             # Run tsgo preflight, then build for production
bun run start             # Start production server

# Quality Checks
bun run typecheck         # Type check with tsgo (faster)
bun run lint              # Lint with Biome
bun run lint:fix          # Auto-fix lint issues
bun run format            # Format code

# Testing
bun run test              # Run unit tests (vitest)
bun run test:ui           # Interactive test UI
bun run test:coverage     # Coverage report
bunx vitest run <file>    # Run single test file
bunx vitest run -t "test name"  # Run specific test

# Dev environment (via dev/Makefile)
cd dev && make dev        # Start all services (PG + Redis + app)
cd dev && make db         # Start only database services
```

## Database Migration Workflow

**IMPORTANT**: Never create SQL migration files manually. Always follow this workflow:

1. **Modify schema** - Edit `src/drizzle/schema.ts`
2. **Generate migration** - Run `bun run db:generate`
3. **Review generated SQL** - Check the generated file in `drizzle/` directory
4. **Edit if necessary** - Make any required adjustments to the generated SQL
5. **Apply migration** - Run `bun run db:migrate` or let `AUTO_MIGRATE=true` handle it on startup

```bash
bun run db:generate       # Generate Drizzle migrations from schema changes
bun run db:migrate        # Apply migrations
bun run db:push           # Push schema changes (dev only)
bun run db:studio         # Open Drizzle Studio
```

## Architecture Overview

### Tech Stack
- **Framework**: Next.js 16 (App Router) + Hono for API routes
- **Database**: PostgreSQL (Drizzle ORM) + Redis (ioredis)
- **UI**: React 19 + shadcn/ui + Tailwind CSS + Recharts
- **Package Manager**: Bun (1.3+)
- **Testing**: Vitest + happy-dom

### Directory Structure
```
src/
├── app/
│   ├── [locale]/dashboard/    # Dashboard UI pages
│   ├── api/
│   │   ├── v1/                # REST management API + OpenAPI docs
│   │   └── actions/           # Legacy Server Action adapter (deprecated)
│   └── v1/                    # Proxy API (Claude/OpenAI compatible)
│       └── _lib/
│           ├── proxy/         # Core proxy pipeline
│           ├── converters/    # Format converters (claude/openai/codex/gemini)
│           └── codex/         # Codex CLI adapter
├── actions/                   # Server Actions reused by REST handlers
├── lib/                       # Core business logic
│   ├── session-manager.ts     # Session & context caching
│   ├── circuit-breaker.ts     # Provider health management
│   ├── rate-limit/            # Multi-dimensional rate limiting
│   └── redis/                 # Redis utilities
├── repository/                # Drizzle ORM data access layer
└── drizzle/
    └── schema.ts              # Database schema definition
```

### Core Proxy Flow
The proxy pipeline (`src/app/v1/_lib/proxy-handler.ts`) processes requests through a guard chain:

```
Request -> GuardPipeline -> [auth -> sensitive -> client -> model -> version -> probe ->
                            session -> warmup -> requestFilter -> rateLimit ->
                            provider -> providerRequestFilter -> messageContext] ->
           ProxyForwarder -> ProxyResponseHandler -> Response
```

Key components:
- **GuardPipeline** (`guard-pipeline.ts`): Configurable chain of request guards
- **ProxySession** (`session.ts`): Request context holder
- **ProxyForwarder** (`forwarder.ts`): Handles upstream API calls
- **ProviderResolver** (`provider-selector.ts`): Load balancing with weight/priority
- **Format Converters** (`converters/`): Bidirectional format translation

### API Layer
- **Proxy endpoints**: `/v1/messages`, `/v1/chat/completions`, `/v1/responses`, `/v1/models` (also accepted without the `/v1` prefix)
- **Management API**: `/api/v1/*` - RESTful management surface documented by OpenAPI
- **Legacy Management API**: `/api/actions/{module}/{action}` - Deprecated Server Action adapter, retained behind `ENABLE_LEGACY_ACTIONS_API`
- **Docs**: `/api/v1/scalar` (Scalar UI), `/api/v1/docs` (Swagger), `/api/v1/openapi.json`
- **OpenAPI checks**: `bun run test:v1`, `bun run openapi:check`, `bun run openapi:lint`

## Code Conventions

- **Path alias**: `@/` maps to `./src/`
- **Formatting**: Biome (double quotes, trailing commas, 2-space indent, 100 char width)
- **Exports**: Prefer named exports over default exports
- **i18n**: Use `next-intl` for internationalization (5 languages: zh-CN, zh-TW, en, ja, ru)
- **Testing**: Unit tests in `tests/unit/`, integration in `tests/integration/`, source-adjacent tests in `src/**/*.test.ts`

## Environment Variables

Critical variables (see `.env.example` for full list):
- `ADMIN_TOKEN`: Admin login token (required)
- `DSN`: PostgreSQL connection string
- `REDIS_URL`: Redis connection URL
- `ENABLE_RATE_LIMIT`: Toggle rate limiting
- `SESSION_TTL`: Session cache TTL (default 300s)
- `AUTO_MIGRATE`: Auto-run migrations on startup

## Production Deploy (systemd, traced standalone)

This project's live install is **~288–292M**, not 1.5G. The 292M tree is Next's file-traced standalone. It is **not** `bun install --production` on the server.

### Why the size jumps

`next.config.ts` sets `output: "standalone"`. `bun run build` then:

1. Next traces runtime files into `.next/standalone/` (app, `.next/server`, **a trimmed `node_modules`**)
2. `scripts/copy-version-to-standalone.cjs` copies `VERSION`, `.next/static`, `public`
3. `scripts/copy-custom-server-to-standalone.cjs` copies `server.js`, `cluster.js`, `server-lib/`

Traced `node_modules` is ~116 packages (~247M). It already contains the server-external packages Next does not bundle (`ioredis`, `postgres`, `drizzle-orm`, `bull`, `@bull-board/*`, `pino`, `ws`, `undici`, `fetch-socks`, `@next/env`) plus native `sharp` for the build arch.

The trap: standalone `package.json` is a copy of the **root** file (all 78 `dependencies`). `bun install --production --frozen-lockfile` ignores tracing and installs the full graph (~869 packages, ~1.5G). `bun.lock` is gitignored (`.gitignore`); copying it only matters if you are intentionally doing a remote install.

`.next/node_modules/<name>-<hash>` entries are **symlinks** into `../../node_modules/<pkg>` (`ioredis`, `postgres`, `drizzle-orm`, `bull`, `pino`, …). `rsync --exclude '/node_modules/'` while keeping `.next/node_modules` leaves those stubs dangling unless you then `bun install` (and that is the 1.5G path).

Docker already uses the traced tree: `COPY --from=builder /app/.next/standalone ./` (see `Dockerfile`). systemd hosts should do the same.

### Extra trim to ~288M (same-arch glibc x86_64)

Local traced tree is ~399M. Two runtime-unused cuts bring it to the historical 292M:

| Cut | Typical size | Safe? |
|---|---|---|
| `find .next/standalone -name '*.map' -delete` | ~89M, almost all `node_modules/next/dist` | yes, source maps are not loaded at runtime |
| remove `@img/sharp-linuxmusl-x64` and `@img/sharp-libvips-linuxmusl-x64` | ~18M | yes on glibc hosts only |

Do **not** delete glibc sharp (`sharp-linux-x64`, `sharp-libvips-linux-x64`). Do **not** strip maps/native binaries on a cross-arch copy.

### Copy set (include these)

- traced `node_modules/` (top-level, ~116 packages)
- `.next/` (`server`, `static`, hashed `node_modules` stubs)
- `cluster.js`, `server.js`, `server-lib/`, `package.json`, `VERSION`
- `drizzle/`, `public/`

Do **not** copy `.env` / `.env.*`. Preserve the live `.env` across the swap (`install -m 600 -o cch -g cch`).

Do **not** copy `bun.lock` / `bunfig.toml` unless the target will run `bun install`. Same-arch systemd deploys should not.

### Do not

- Remote `bun install --production` on x86_64 hosts (inflates 292M → 1.5G)
- `rsync --exclude node_modules` blindly (drops hashed Next externals *and* the traced packages they point at)
- Ship an x86 `node_modules` to aarch64 (native `sharp` / optional extracts). Rebuild on the target, or use the 1.5G remote-install path there only
- Keep `/opt/claude-code-hub.prev` on `172.16.96.115` (12G disk; live + prev will not fit)

### Same-arch procedure

```bash
bun run build
# optional same-arch trim
find .next/standalone -name '*.map' -delete
rm -rf .next/standalone/node_modules/@img/sharp-linuxmusl-x64 \
       .next/standalone/node_modules/@img/sharp-libvips-linuxmusl-x64

# stage, then atomic swap; LIVE/NEXT/PREV differ per host
rsync -a --delete --exclude '/.env' --exclude '/.env.*' \
  .next/standalone/ "$HOST:$NEXT/"
# or tar-over-ssh when the host has no rsync:
# tar -C .next/standalone --exclude './.env' --exclude './.env.*' -cf - . \
#   | ssh "$HOST" "tar -C $NEXT -xf -"

ssh "$HOST" "install -m 600 -o cch -g cch $LIVE/.env $NEXT/.env
             chown -R cch:cch $NEXT
             systemctl stop cch
             rm -rf $PREV && mv $LIVE $PREV && mv $NEXT $LIVE   # 115: rm -rf \$LIVE instead of keeping PREV
             systemctl start cch"
```

ExecStart is `/usr/bin/node cluster.js` (or `/opt/cch/cluster.js` on dslab), **not** bun. After restart, `/api/health` may report redis `down` for ~15s (client connect race); `/api/health/ready` should be `healthy` once workers are up. Confirm `version` is `0.9.5` (or current `VERSION`) and `du -sh $LIVE` is ~288M with ~116 `node_modules` entries.

### Hosts

| Host | Live dir | Copy | Staging | Notes |
|---|---|---|---|---|
| `root@100.64.1.38` | `/opt/claude-code-hub` | rsync | `.next` / `.prev` | `HOSTNAME=127.0.0.1` `LOG_LEVEL=error`; MemoryMax=6G; do not kill `/opt/cch-go/ui` (`PORT=13501`) |
| `root@cch.in.dslab.top` | `/opt/cch` | rsync | `/opt/cch.next` / `.prev` | `HOSTNAME=0.0.0.0`; bun `/usr/bin/bun` |
| `root@172.16.96.115` | `/opt/claude-code-hub` | tar-over-ssh (no rsync) | no `.prev` | 12G disk; `CCH_MULTICORE_WORKERS=6`; bun `/usr/local/bin/bun` |

aarch64 (`xiaol@cpa1`) cannot reuse an x86 traced `node_modules`. Build on that host, or copy the tree **without** native `node_modules` and `bun install --production` there (accept ~1.5G).

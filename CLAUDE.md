# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Commands

```bash
bun install                    # Install dependencies
bun run dev                    # Dev server on port 13500
bun run build                  # Production build (copies VERSION to standalone)
bun run lint                   # Biome check
bun run lint:fix               # Biome auto-fix
bun run typecheck              # TypeScript check (uses tsgo for speed)
bun run test                   # Run Vitest tests
bun run test -- path/to/test   # Run single test file
bun run test:ui                # Vitest with browser UI
bun run db:generate            # Generate Drizzle migration (validates afterward)
bun run db:migrate             # Apply migrations
bun run db:studio              # Drizzle Studio GUI
```

## Architecture

### Proxy Request Pipeline (`src/app/v1/_lib/`)

Request flow through `proxy-handler.ts`:
1. `ProxySession.fromContext()` - Parse incoming request
2. `detectFormat()` - Identify API format (Claude/OpenAI/Codex)
3. `GuardPipelineBuilder.run()` - Execute guard chain:
   - `ProxyAuthenticator` - Validate API key
   - `SensitiveWordGuard` - Content filtering
   - `VersionGuard` - Client version check
   - `ProxySessionGuard` - Session allocation via Redis
   - `ProxyRateLimitGuard` - Multi-dimensional rate limiting
   - `ProxyProviderResolver` - Select provider (weight/priority/circuit breaker)
4. `ProxyForwarder.send()` - Forward with up to 3 retries on failure
5. `ProxyResponseHandler.dispatch()` - Handle streaming/non-streaming response

### Format Converters (`src/app/v1/_lib/converters/`)

Registry pattern in `registry.ts` maps conversion pairs:
- Claude <-> OpenAI bidirectional
- Claude <-> Codex (OpenAI Responses API)
- OpenAI <-> Codex
- Gemini CLI adapters

### Core Services (`src/lib/`)

**Session Manager** (`session-manager.ts`):
- 5-minute Redis context cache with sliding window
- Decision chain recording for audit trail
- Session ID extraction from metadata.user_id or messages hash

**Circuit Breaker** (`circuit-breaker.ts`):
- State machine: CLOSED -> OPEN -> HALF_OPEN -> CLOSED
- Per-provider isolation with configurable thresholds
- Redis persistence for multi-instance coordination

**Rate Limiting** (`rate-limit/`):
- Dimensions: RPM, cost (5h/week/month), concurrent sessions
- Levels: User, Key, Provider
- Redis Lua scripts for atomic operations
- Fail-open when Redis unavailable

### Database (`src/drizzle/`, `src/repository/`)

Drizzle ORM with PostgreSQL. Key tables:
- `users`, `keys` - Authentication and quotas
- `providers` - Upstream config (weight, priority, proxy, timeouts)
- `message_request` - Request logs with decision chain
- `model_prices` - Token pricing for cost calculation
- `error_rules`, `request_filters` - Request/response manipulation

Repository pattern in `src/repository/` wraps Drizzle queries.

### Server Actions API (`src/app/api/actions/`)

39 Server Actions auto-exposed as REST endpoints via `[...route]/route.ts`:
- OpenAPI 3.1.0 spec auto-generated from Zod schemas
- Swagger UI: `/api/actions/docs`
- Scalar UI: `/api/actions/scalar`

## Code Style

- Biome: 2-space indent, double quotes, trailing commas, 100 char max line
- Path alias: `@/*` -> `./src/*`
- Icons: Use `lucide-react`, no custom SVGs
- UI components in `src/components/ui/` (excluded from typecheck)

## Testing

Vitest configuration in `vitest.config.ts`:
- Environment: Node
- Coverage thresholds: 50% lines/functions, 40% branches
- Integration tests requiring DB are in `tests/integration/` (excluded by default)
- Test database must contain 'test' in name for safety

## I18n

5 locales via next-intl: `en`, `ja`, `ru`, `zh-CN`, `zh-TW`
- Messages: `messages/{locale}/*.json`
- Routing: `src/i18n/`

## Environment

See `.env.example` for all variables. Critical ones:
- `ADMIN_TOKEN` - Dashboard login (must change from default)
- `DSN` - PostgreSQL connection string
- `REDIS_URL` - Redis for rate limiting and sessions
- `AUTO_MIGRATE` - Run Drizzle migrations on startup

## Contributing

See `CONTRIBUTING.md` for branch naming, commit format, and PR process.
All PRs target `dev` branch; `main` is release-only.

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
bun run dev               # Start dev server (port 13500)

# Build & Production
bun run build             # Build for production (copies VERSION to standalone)
bun run start             # Start production server

# Quality Checks
bun run typecheck         # Type check with tsgo (faster)
bun run typecheck:tsc     # Type check with tsc
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
│   ├── api/                   # Internal API routes
│   └── v1/                    # Proxy API (Claude/OpenAI compatible)
│       └── _lib/
│           ├── proxy/         # Core proxy pipeline
│           ├── converters/    # Format converters (claude/openai/codex/gemini)
│           └── codex/         # Codex CLI adapter
├── actions/                   # Server Actions (exposed via /api/actions)
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
- **Proxy endpoints**: `/v1/messages`, `/v1/chat/completions`, `/v1/responses`
- **Management API**: `/api/actions/{module}/{action}` - Auto-generated OpenAPI docs
- **Docs**: `/api/actions/scalar` (Scalar UI), `/api/actions/docs` (Swagger)

## Code Conventions

- **Path alias**: `@/` maps to `./src/`
- **Formatting**: Biome (double quotes, trailing commas, 2-space indent, 100 char width)
- **Exports**: Prefer named exports over default exports
- **i18n**: Use `next-intl` for internationalization (5 languages: zh-CN, en, ja, ko, de)
- **Testing**: Unit tests in `tests/unit/`, integration in `tests/integration/`, source-adjacent tests in `src/**/*.test.ts`

## Environment Variables

Critical variables (see `.env.example` for full list):
- `ADMIN_TOKEN`: Admin login token (required)
- `DSN`: PostgreSQL connection string
- `REDIS_URL`: Redis connection URL
- `ENABLE_RATE_LIMIT`: Toggle rate limiting
- `SESSION_TTL`: Session cache TTL (default 300s)
- `AUTO_MIGRATE`: Auto-run migrations on startup

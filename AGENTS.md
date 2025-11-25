# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Claude Code Hub is an AI API proxy platform built with Next.js 15 + Hono + PostgreSQL + Redis. It provides multi-provider management, intelligent load balancing, real-time monitoring, and OpenAPI documentation for Claude/OpenAI compatible APIs.

## Development Commands

```bash
# Install dependencies
bun install

# Development server (port 13500 with Turbo)
bun run dev

# Build for production
bun run build

# Type checking
bun run typecheck

# Linting
bun run lint

# Format code
bun run format

# Database commands
bun run db:generate    # Generate Drizzle migrations
bun run db:migrate     # Run migrations
bun run db:push        # Push schema changes
bun run db:studio      # Open Drizzle Studio
```

### Local Development with Docker

```bash
cd dev
make dev      # Start PostgreSQL + Redis + bun dev
make db       # Start only database and Redis
make migrate  # Run database migrations
make clean    # Clean all resources
```

## Architecture

### Request Flow

```
Client Request → Next.js API Route (/v1)
    → ProxySession (context creation)
    → GuardPipeline (auth → version → session → sensitive → rateLimit → provider)
    → ProxyForwarder (request forwarding with format conversion)
    → ResponseHandler (streaming/non-streaming response)
```

### Key Directories

- `src/app/v1/_lib/` - Proxy core: handlers, guards, converters, forwarders
- `src/actions/` - Server Actions (business logic, exposed via OpenAPI)
- `src/repository/` - Database queries (Drizzle ORM)
- `src/lib/` - Shared utilities: rate-limit, circuit-breaker, session, logger
- `src/drizzle/` - Database schema and migrations
- `src/app/api/actions/` - OpenAPI documentation generation

### Provider Types

The system supports multiple provider types via `providerType` field:

- `claude` - Anthropic API (standard)
- `claude-auth` - Claude relay services (Bearer auth only)
- `codex` - Codex CLI (Response API)
- `gemini-cli` - Gemini CLI
- `openai-compatible` - OpenAI Compatible APIs

### Format Converters

Located in `src/app/v1/_lib/converters/`, these handle bidirectional conversion between:

- Claude Messages API
- OpenAI Chat Completions API
- Codex Response API
- Gemini CLI format

### Guard Pipeline

The `GuardPipelineBuilder` in `src/app/v1/_lib/proxy/guard-pipeline.ts` orchestrates request processing:

1. `auth` - API key validation
2. `version` - Client version check
3. `probe` - Handle probe requests
4. `session` - Session management (5-min context caching)
5. `sensitive` - Content filtering
6. `rateLimit` - Multi-dimensional rate limiting (RPM, USD limits)
7. `provider` - Provider selection (weight + priority + circuit breaker)
8. `messageContext` - Request logging

### Database Schema

Core tables in `src/drizzle/schema.ts`:

- `users` - User accounts with quota limits
- `keys` - API keys with per-key limits
- `providers` - Upstream provider configurations
- `messageRequest` - Request logs with token/cost tracking
- `modelPrices` - Model pricing data (LiteLLM sync)
- `errorRules` - Error classification rules
- `sensitiveWords` - Content filtering rules

### OpenAPI Documentation

Server Actions are automatically exposed as REST endpoints via `src/app/api/actions/[...route]/route.ts`:

- Swagger UI: `/api/actions/docs`
- Scalar UI: `/api/actions/scalar`
- OpenAPI JSON: `/api/actions/openapi.json`

## Configuration

Key environment variables (see `.env.example`):

- `ADMIN_TOKEN` - Admin login token (required)
- `DSN` - PostgreSQL connection string
- `REDIS_URL` - Redis for rate limiting and sessions
- `AUTO_MIGRATE` - Enable automatic DB migrations
- `ENABLE_RATE_LIMIT` - Enable rate limiting features
- `SESSION_TTL` - Session cache duration (default 300s)

## Important Patterns

### Path Alias

All imports use `@/*` alias mapping to `./src/*`.

### i18n

Internationalization via `next-intl` with messages in `/messages/{locale}/`.

### Rate Limiting

Redis Lua scripts ensure atomic operations. Fail-open strategy when Redis unavailable.

### Circuit Breaker

Per-provider circuit breaker with configurable thresholds. States: CLOSED → OPEN → HALF_OPEN.

### Session Stickiness

5-minute session caching to maintain provider consistency within conversations.

## PR Guidelines

- All PRs must target `dev` branch (never `main` directly)
- Run `bun run lint && bun run typecheck` before committing
- Follow Conventional Commits format (feat/fix/chore/refactor/test)

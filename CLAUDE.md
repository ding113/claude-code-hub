# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Claude Code Hub is a Claude Code API proxy and relay service platform for managing multiple AI service providers (supporting both Claude Code format and OpenAI-compatible format). It provides intelligent load balancing, user permission management, usage statistics, and real-time monitoring.

This project is enhanced from [zsio/claude-code-hub](https://github.com/zsio/claude-code-hub) with additional features including detailed logging, concurrency control, multi-window rate limiting, circuit breaker protection, decision chain tracking, and OpenAI compatibility.

**Communication**: Respond to users in Chinese.

## Common Commands

### Development

```bash
pnpm dev              # Start dev server (http://localhost:13500, with Turbopack)
pnpm build            # Build production (auto-copies VERSION file)
pnpm start            # Start production server
pnpm lint             # Run ESLint
pnpm typecheck        # TypeScript type checking
pnpm format           # Format code
pnpm format:check     # Check code formatting
```

### Database

```bash
pnpm db:generate      # Generate Drizzle migration files
pnpm db:migrate       # Execute database migrations
pnpm db:push          # Push schema directly to database (dev only)
pnpm db:studio        # Launch Drizzle Studio visual manager
```

### Docker Deployment

```bash
docker compose up -d                         # Start all services (background)
docker compose logs -f                       # View all service logs
docker compose logs -f app                   # View app logs only
docker compose restart app                   # Restart application
docker compose pull && docker compose up -d  # Upgrade to latest version
docker compose down                          # Stop and remove containers
```

### Local Development Tools (Recommended)

Complete development toolset in `dev/` directory for quick environment setup, deployment testing, and resource cleanup.

**Quick Start**:

```bash
cd dev
make help      # View all available commands
make dev       # One-command complete dev environment
```

**Common Commands**:

```bash
# Environment Management
make dev          # Start complete dev env (DB + pnpm dev)
make db           # Start database and Redis only
make stop         # Stop all services
make status       # View service status

# Image Build and Testing
make build        # Build Docker image
make compose      # Start full three-container setup

# Database Operations
make migrate      # Execute database migrations
make db-shell     # Enter PostgreSQL shell
make redis-shell  # Enter Redis CLI

# Log Viewing
make logs         # View all service logs
make logs-app     # View application logs

# Cleanup and Reset
make clean        # One-command cleanup of all resources
make reset        # Full reset (clean + dev)
```

**Development Environment Config**:

- PostgreSQL: `localhost:5433` (avoids conflict with local 5432)
- Redis: `localhost:6380` (avoids conflict with local 6379)
- Application: `http://localhost:13500` (Turbopack dev server)
- Admin Token: `dev-admin-token`

**Full Documentation**: See `dev/README.md`

## Core Tech Stack

- **Next.js 15** (App Router) + **React 19** + **TypeScript**
- **Hono** - API route handling
- **Drizzle ORM** + **PostgreSQL** - Data persistence
- **Redis** + **ioredis** - Rate limiting, session tracking, circuit breaker
- **Tailwind CSS v4** + **Shadcn UI** (orange theme) - UI framework
- **Pino** - Structured logging
- **Package Manager**: pnpm 9.15.0

## Architecture Overview

### Directory Structure

```
src/
├── app/                          # Next.js App Router
│   ├── v1/                       # API proxy core logic
│   │   ├── _lib/
│   │   │   ├── proxy/            # Claude Code format proxy (guards, session, forwarder)
│   │   │   ├── codex/            # OpenAI compatibility layer (chat/completions)
│   │   │   └── proxy-handler.ts  # Proxy request main entry
│   │   └── [...route]/route.ts   # Dynamic route handler
│   ├── dashboard/                # Dashboard (statistics, logs, leaderboard, real-time monitoring)
│   ├── settings/                 # Settings pages (users, providers, pricing, system config)
│   └── api/                      # Internal APIs (auth, admin, leaderboard, version)
├── lib/                          # Core business logic
│   ├── circuit-breaker.ts        # Circuit breaker (in-memory implementation)
│   ├── session-manager.ts        # Session tracking and caching
│   ├── rate-limit/               # Rate limiting service (Redis + Lua scripts)
│   ├── redis/                    # Redis client and utilities
│   ├── proxy-status-tracker.ts   # Real-time proxy status tracking
│   └── price-sync.ts             # LiteLLM price synchronization
├── repository/                   # Data access layer (Drizzle ORM)
├── drizzle/                      # Database schema and migrations
├── types/                        # TypeScript type definitions
└── components/                   # React UI components
```

### Proxy Request Processing Flow

Proxy requests go through these steps (see `src/app/v1/_lib/proxy-handler.ts`):

1. **Authentication Check** (`ProxyAuthenticator`) - Verify API Key
2. **Session Allocation** (`ProxySessionGuard`) - Concurrent session limit check
3. **Sensitive Word Check** (`ProxySensitiveWordGuard`) - Content filtering
4. **Rate Limit Check** (`ProxyRateLimitGuard`) - RPM + amount limits (5-hour/weekly/monthly)
5. **Provider Selection** (`ProxyProviderResolver`) - Intelligent selection and failover
   - Session reuse (5-minute cache)
   - Weight + priority + grouping
   - Circuit breaker state check
   - Concurrency limit check (atomic operations)
   - Failover loop (max 3 retries)
6. **Message Service** (`ProxyMessageService`) - Create message context and logging
7. **Request Forwarding** (`ProxyForwarder`) - Forward to upstream provider
8. **Response Handling** (`ProxyResponseHandler`) - Streaming/non-streaming response handling
9. **Error Handling** (`ProxyErrorHandler`) - Unified error handling and circuit breaker recording

### OpenAI Compatibility Layer

Supports `/v1/chat/completions` endpoint (see `src/app/v1/_lib/codex/chat-completions-handler.ts`):

- Auto-detect OpenAI format (`messages`) and Response API format (`input`)
- OpenAI → Response API conversion (`RequestTransformer`)
- Codex CLI instructions injection (`adaptForCodexCLI`)
- Response API → OpenAI conversion (`ResponseTransformer`)
- Supports `tools`, `reasoning`, `stream`, etc.

### Circuit Breaker Mechanism

In-memory circuit breaker implementation (`src/lib/circuit-breaker.ts`):

- **State Machine**: Closed → Open → Half-Open → Closed
- **Threshold**: Opens after 5 failures, lasts 30 minutes
- **Half-Open State**: Closes after 2 successes
- Auto-record failures and open circuit breaker
- Skip opened circuit breakers during provider selection

### Rate Limiting Strategy

Multi-layer rate limiting (`src/lib/rate-limit/service.ts`):

1. **RPM Rate Limiting** - User-level requests per minute
2. **Amount Rate Limiting** - User/key/provider level 5-hour/weekly/monthly limits
3. **Concurrent Session Limiting** - User/provider level concurrent session count
4. **Redis Lua Scripts** - Atomic check and increment (solves race conditions)
5. **Fail Open Strategy** - Graceful degradation when Redis unavailable, service continues

### Session Management

Session tracking and caching (`src/lib/session-manager.ts`):

- **5-Minute Context Cache** - Avoid frequent provider switching
- **Concurrent Session Counting** - Redis atomic tracking
- **Decision Chain Recording** - Complete provider selection and failover switching records
- **Auto Cleanup** - TTL expiration auto-cleanup

### Database Schema

Core table structure (`src/drizzle/schema.ts`):

- **users** - User management (RPM limits, daily quota, provider groups)
- **keys** - API keys (amount rate limiting, concurrency limits, expiration, Web UI login permission)
- **providers** - Provider management (weight, priority, cost multiplier, model redirection, concurrency limits)
- **messages** - Message logs (request/response, token usage, cost calculation, decision chain)
- **model_prices** - Model pricing (supports Claude and OpenAI formats, cache token pricing)
- **statistics** - Statistics data (hourly aggregation)

## Environment Variables

Key environment variables (see `.env.example`):

```bash
# Admin Authentication
ADMIN_TOKEN=change-me              # Admin panel login token (MUST change)

# Database Config
DSN="postgres://..."               # PostgreSQL connection string
AUTO_MIGRATE=true                  # Auto-execute migrations on startup

# Redis Config
REDIS_URL=redis://localhost:6379   # Redis connection URL
ENABLE_RATE_LIMIT=true             # Enable rate limiting feature

# Session Config
SESSION_TTL=300                    # Session cache expiration time (seconds)
STORE_SESSION_MESSAGES=false       # Store request messages (for real-time monitoring)

# Cookie Security Policy
ENABLE_SECURE_COOKIES=true         # Force HTTPS cookies (default: true)
                                   # Set to false to allow HTTP access, but reduces security

# Codex Instructions Injection (Experimental)
ENABLE_CODEX_INSTRUCTIONS_INJECTION=false  # Force replace Codex request instructions (default: false)
                                           # false: Keep original passthrough (recommended)
                                           # true: Force replace with official full prompt (~4000+ chars)

# Application Config
APP_PORT=23000                     # Application port
NODE_ENV=production                # Environment mode
TZ=Asia/Shanghai                   # Timezone setting
LOG_LEVEL=info                     # Log level
```

## Development Notes

### 1. Redis Dependency and Degradation Strategy

- **Fail Open Strategy**: Auto-degrade when Redis unavailable, rate limiting fails but service continues
- All Redis operations have try-catch and degradation logic
- Don't throw errors on Redis operation failures, log and continue

### 2. Concurrency Control and Race Conditions

- **Atomic Operations**: Use Redis Lua scripts for check-and-increment (`src/lib/redis/lua-scripts.ts`)
- **Session Allocation**: Check and track first, try other providers on failure
- Avoid concurrency limit checks without atomic guarantees

### 3. Database Migrations

- Use `pnpm db:generate` to generate migration files
- Production uses `AUTO_MIGRATE=true` for auto-execution
- Index optimization: All queries have corresponding composite indexes (see index definitions in schema.ts)
- Timezone handling: All timestamp fields use `withTimezone: true`

### 4. Timezone Handling

- Database statistics queries use `AT TIME ZONE 'Asia/Shanghai'` conversion
- Frontend display uses `date-fns` and `timeago.js`
- Environment variables `TZ` and `PGTZ` uniformly set to `Asia/Shanghai`

### 5. Cost Calculation

- Supports Claude format (`input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`)
- Supports OpenAI format (`prompt_tokens`, `completion_tokens`)
- Price unit: USD/M tokens (million tokens)
- Cost multiplier: Provider-level `cost_multiplier`

### 6. Logging

- Use Pino structured logging (`src/lib/logger.ts`)
- Log levels: `fatal` > `error` > `warn` > `info` > `debug` > `trace`
- Dev environment uses `pino-pretty` for beautified output
- Critical business logic must have info-level logs

### 7. Code Style

- Use ESLint + Prettier
- Run `pnpm typecheck` before commits to ensure type correctness
- Follow existing code style (reference code in `src/app/v1/_lib/proxy/`)

## Common Tasks

### Adding New Provider Type

1. Extend `providerType` enum in `src/drizzle/schema.ts`
2. Add type filtering logic in `src/app/v1/_lib/proxy/provider-selector.ts`
3. If format conversion needed, add transformer in `src/app/v1/_lib/codex/transformers/`

### Adding New Rate Limiting Dimension

1. Add new rate limiting method in `src/lib/rate-limit/service.ts`
2. Add corresponding Lua script in `src/lib/redis/lua-scripts.ts`
3. Integrate new check in `src/app/v1/_lib/proxy/rate-limit-guard.ts`

### Adding New Statistics Dimension

1. Extend `statistics` table in `src/drizzle/schema.ts`
2. Add query method in `src/repository/statistics.ts`
3. Add visualization component in `src/app/dashboard/_components/`

### Modifying Database Schema

1. Modify `src/drizzle/schema.ts`
2. Run `pnpm db:generate` to generate migration files
3. Check generated SQL files (`drizzle/` directory)
4. Run `pnpm db:push` (dev) or `pnpm db:migrate` (production)

## Troubleshooting

### Database Connection Failure

- Check `DSN` environment variable format
- Docker deployment: Ensure postgres service is running (`docker compose ps`)
- Local development: Check PostgreSQL service is running

### Redis Connection Failure

- Service still available (Fail Open strategy)
- Check `REDIS_URL` environment variable
- View Redis connection errors in logs
- Docker deployment: `docker compose exec redis redis-cli ping`

### Circuit Breaker False Triggers

- View `[CircuitBreaker]` records in logs
- Check provider health status (Dashboard → Provider Management)
- Wait 30 minutes for auto-recovery or manually restart app to reset state

### Provider Selection Failure

- Check if provider is enabled (`is_enabled = true`)
- Check circuit breaker state (`circuitState` in logs)
- Check concurrency limit config (`limit_concurrent_sessions`)
- View decision chain records (log details page)

## Reference Resources

- [Next.js 15 Documentation](https://nextjs.org/docs)
- [Hono Documentation](https://hono.dev/)
- [Drizzle ORM Documentation](https://orm.drizzle.team/)
- [Shadcn UI Documentation](https://ui.shadcn.com/)
- [LiteLLM Price Table](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json)

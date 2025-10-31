# Repository Guidelines

## Project Structure & Module Organization

- `src/app` holds Next.js routes and API handlers; UI primitives live in `src/components`.
- Shared server logic sits in `src/actions`, `src/lib`, and `src/repository`.
- Drizzle migrations and schema snapshots live under `drizzle/` with settings in `drizzle.config.ts`.
- Static assets stay in `public/`; deployment helpers live in `deploy/`, `docker-compose.yaml`, and the `Makefile`.
- Docker volumes write into `data/`; treat it as runtime-only.

## Build, Test, and Development Commands

- `pnpm dev` — starts Next.js (port 13500) with Turbo for local work.
- `pnpm build` / `pnpm start` — compiles the standalone production bundle and serves it.
- `pnpm lint`, `pnpm typecheck`, `pnpm format:check` — run ESLint 9, TypeScript `--noEmit`, and Prettier verification; treat failures as blockers.
- `pnpm db:generate`, `pnpm db:migrate`, `pnpm db:push`, `pnpm db:studio` — Drizzle Kit for schema evolution.
- `docker compose up -d` — spins up the full stack (app, Postgres, Redis) for parity testing.

## Coding Style & Naming Conventions

- 2-space indentation, trailing commas, and single quotes follow Prettier and `eslint.config.mjs`.
- React components use PascalCase (`UsageChart.tsx`); hooks and utilities stay camelCase; route folders remain kebab-case.
- Prefer `async/await`, keep server actions inside `src/actions`, and co-locate Tailwind classes with the JSX they style.
- Run `pnpm format` before submitting wide-ranging edits.

## Testing Guidelines

- Today we rely on `pnpm lint` and `pnpm typecheck` plus manual checks through `/admin`.
- Smoke API changes with `curl -H "Authorization: Bearer <ADMIN_TOKEN>" http://localhost:13500/api/providers`.
- New automated tests should follow `*.spec.ts` naming, live next to the feature, and wire into `package.json` scripts.
- Note any seed data or feature flags in the PR description so reviewers can reproduce your scenario.

## Commit & Pull Request Guidelines

- Follow Conventional commits (`fix:`, `chore:`, `feat:`) as seen in `git log`; keep subjects under 72 characters.
- Body text should note user impact plus migration or environment changes.
- PRs must include a short summary, screenshots or JSON samples for UI/API updates, links to issues, and migration callouts.
- Rebase onto `main`, run `pnpm lint && pnpm typecheck`, and flag anything that blocks deploy parity.

## Security & Configuration Tips

- Start from `.env.example`, rotate `ADMIN_TOKEN` before sharing previews, and scope provider keys to least privilege.
- Keep Redis, Postgres, and upstream tokens in secrets management—never in Git commits.
- Prefer `pnpm dev` with mock providers when debugging rather than production credentials.

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目简介

Claude Code Hub 是一个 Claude Code API 代理中转服务平台，用于统一管理多个 AI 服务提供商（支持 Claude Code 格式和 OpenAI 兼容格式），提供智能负载均衡、用户权限管理、使用统计和实时监控功能。

本项目基于 [zsio/claude-code-hub](https://github.com/zsio/claude-code-hub) 进行了增强，新增了详细日志记录、并发控制、多时段限流、熔断保护、决策链追踪、OpenAI 兼容等功能。

使用中文和用户沟通。

## 常用命令

### 开发命令

```bash
pnpm dev              # 启动开发服务器 (http://localhost:13500, 使用 Turbopack)
pnpm build            # 构建生产版本 (自动复制 VERSION 文件)
pnpm start            # 启动生产服务器
pnpm lint             # 运行 ESLint
pnpm typecheck        # TypeScript 类型检查
pnpm format           # 格式化代码
pnpm format:check     # 检查代码格式
```

### 数据库命令

```bash
pnpm db:generate      # 生成 Drizzle 迁移文件
pnpm db:migrate       # 执行数据库迁移
pnpm db:push          # 直接推送 schema 到数据库（开发环境）
pnpm db:studio        # 启动 Drizzle Studio 可视化管理界面
```

### Docker 部署

```bash
docker compose up -d             # 启动所有服务（后台运行）
docker compose logs -f           # 查看所有服务日志
docker compose logs -f app       # 仅查看应用日志
docker compose restart app       # 重启应用
docker compose pull && docker compose up -d  # 升级到最新版本
docker compose down              # 停止并删除容器
```

### 本地开发工具（推荐）

本项目提供了完整的本地开发工具集（位于 `dev/` 目录），可以快速启动开发环境、测试部署流程和清理资源。

**快速开始**：

```bash
cd dev
make help      # 查看所有可用命令
make dev       # 一键启动完整开发环境
```

**常用命令**：

```bash
# 环境管理
make dev          # 启动完整开发环境 (DB + pnpm dev)
make db           # 仅启动数据库和 Redis
make stop         # 停止所有服务
make status       # 查看服务状态

# 镜像构建和测试
make build        # 构建 Docker 镜像
make compose      # 启动三容器完整编排

# 数据库操作
make migrate      # 执行数据库迁移
make db-shell     # 进入 PostgreSQL shell
make redis-shell  # 进入 Redis CLI

# 日志查看
make logs         # 查看所有服务日志
make logs-app     # 查看应用日志

# 清理和重置
make clean        # 一键清理所有资源
make reset        # 完全重置 (clean + dev)
```

**开发环境配置**：

- PostgreSQL: `localhost:5433` (避免与本地 5432 冲突)
- Redis: `localhost:6380` (避免与本地 6379 冲突)
- 应用: `http://localhost:13500` (Turbopack 开发服务器)
- 管理员 Token: `dev-admin-token`

**完整文档**: 详见 `dev/README.md`

## 核心技术栈

- **Next.js 15** (App Router) + **React 19** + **TypeScript**
- **Hono** - 用于 API 路由处理
- **Drizzle ORM** + **PostgreSQL** - 数据持久化
- **Redis** + **ioredis** - 限流、会话追踪、熔断器
- **Tailwind CSS v4** + **Shadcn UI** (orange 主题) - UI 框架
- **Pino** - 结构化日志
- **包管理器**: pnpm 9.15.0

## 架构概览

### 目录结构

```
src/
├── app/                          # Next.js App Router
│   ├── v1/                       # API 代理核心逻辑
│   │   ├── _lib/
│   │   │   ├── proxy/            # Claude Code 格式代理 (guards, session, forwarder)
│   │   │   ├── codex/            # OpenAI 兼容层 (chat/completions)
│   │   │   └── proxy-handler.ts  # 代理请求主入口
│   │   └── [...route]/route.ts   # 动态路由处理器
│   ├── dashboard/                # 仪表盘 (统计、日志、排行榜、实时监控)
│   ├── settings/                 # 设置页面 (用户、供应商、价格、系统配置)
│   └── api/                      # 内部 API (auth, admin, leaderboard, version)
├── lib/                          # 核心业务逻辑
│   ├── circuit-breaker.ts        # 熔断器 (内存实现)
│   ├── session-manager.ts        # Session 追踪和缓存
│   ├── rate-limit/               # 限流服务 (Redis + Lua 脚本)
│   ├── redis/                    # Redis 客户端和工具
│   ├── proxy-status-tracker.ts   # 实时代理状态追踪
│   └── price-sync.ts             # LiteLLM 价格同步
├── repository/                   # 数据访问层 (Drizzle ORM)
├── drizzle/                      # 数据库 schema 和迁移
├── types/                        # TypeScript 类型定义
└── components/                   # React UI 组件
```

### 代理请求处理流程

代理请求经过以下步骤 (参见 `src/app/v1/_lib/proxy-handler.ts`):

1. **认证检查** (`ProxyAuthenticator`) - 验证 API Key
2. **Session 分配** (`ProxySessionGuard`) - 并发 Session 限制检查
3. **限流检查** (`ProxyRateLimitGuard`) - RPM + 金额限制 (5小时/周/月)
4. **供应商选择** (`ProxyProviderResolver`) - 智能选择和故障转移
   - Session 复用（5分钟缓存）
   - 权重 + 优先级 + 分组
   - 熔断器状态检查
   - 并发限制检查（原子性操作）
   - 故障转移循环（最多 3 次重试）
5. **消息服务** (`ProxyMessageService`) - 创建消息上下文和日志记录
6. **请求转发** (`ProxyForwarder`) - 转发到上游供应商
7. **响应处理** (`ProxyResponseHandler`) - 流式/非流式响应处理
8. **错误处理** (`ProxyErrorHandler`) - 统一错误处理和熔断器记录

### OpenAI 兼容层

支持 `/v1/chat/completions` 端点 (参见 `src/app/v1/_lib/codex/chat-completions-handler.ts`):

- 自动检测 OpenAI 格式 (`messages`) 和 Response API 格式 (`input`)
- OpenAI → Response API 转换 (`RequestTransformer`)
- Codex CLI instructions 注入 (`adaptForCodexCLI`)
- Response API → OpenAI 转换 (`ResponseTransformer`)
- 支持 `tools`、`reasoning`、`stream` 等功能

### 熔断器机制

内存实现的熔断器 (`src/lib/circuit-breaker.ts`):

- **状态机**: Closed → Open → Half-Open → Closed
- **阈值**: 失败 5 次后打开，持续 30 分钟
- **半开状态**: 成功 2 次后关闭
- 自动记录失败并打开熔断器
- 供应商选择时跳过已打开的熔断器

### 限流策略

多层限流 (`src/lib/rate-limit/service.ts`):

1. **RPM 限流** - 用户级别每分钟请求数
2. **金额限流** - 用户/密钥/供应商级别的 5小时/周/月 限制
3. **并发 Session 限流** - 用户/供应商级别的并发会话数
4. **Redis Lua 脚本** - 原子性检查和递增（解决竞态条件）
5. **Fail Open 策略** - Redis 不可用时降级，不影响服务

### Session 管理

Session 追踪和缓存 (`src/lib/session-manager.ts`):

- **5 分钟上下文缓存** - 避免频繁切换供应商
- **并发 Session 计数** - Redis 原子性追踪
- **决策链记录** - 完整的供应商选择和失败切换记录
- **自动清理** - TTL 过期自动清理

### 数据库 Schema

核心表结构 (`src/drizzle/schema.ts`):

- **users** - 用户管理 (RPM 限制、每日额度、供应商分组)
- **keys** - API 密钥 (金额限流、并发限制、过期时间)
- **providers** - 供应商管理 (权重、优先级、成本倍数、模型重定向、并发限制)
- **messages** - 消息日志 (请求/响应、Token 使用、成本计算、决策链)
- **model_prices** - 模型价格 (支持 Claude 和 OpenAI 格式、缓存 Token 定价)
- **statistics** - 统计数据 (小时级别聚合)

## 环境变量

关键环境变量 (参见 `.env.example`):

```bash
# 管理员认证
ADMIN_TOKEN=change-me              # 管理后台登录令牌（必须修改）

# 数据库配置
DSN="postgres://..."               # PostgreSQL 连接字符串
AUTO_MIGRATE=true                  # 启动时自动执行迁移

# Redis 配置
REDIS_URL=redis://localhost:6379   # Redis 连接地址
ENABLE_RATE_LIMIT=true             # 启用限流功能

# Session 配置
SESSION_TTL=300                    # Session 缓存过期时间（秒）
STORE_SESSION_MESSAGES=false       # 是否存储请求 messages（用于实时监控）

# Cookie 安全策略
ENABLE_SECURE_COOKIES=true         # 是否强制 HTTPS Cookie（默认：true）
                                   # 设置为 false 允许 HTTP 访问，但会降低安全性

# Codex Instructions 注入（实验性功能）
ENABLE_CODEX_INSTRUCTIONS_INJECTION=false  # 是否强制替换 Codex 请求的 instructions（默认：false）
                                           # false: 保持原样透传（推荐）
                                           # true: 强制替换为官方完整 prompt（约 4000+ 字）

# 应用配置
APP_PORT=23000                     # 应用端口
NODE_ENV=production                # 环境模式
TZ=Asia/Shanghai                   # 时区设置
LOG_LEVEL=info                     # 日志级别
```

## 开发注意事项

### 1. Redis 依赖和降级策略

- **Fail Open 策略**: Redis 不可用时自动降级，限流功能失效但服务仍可用
- 所有 Redis 操作都有 try-catch 和降级逻辑
- 不要在 Redis 操作失败时抛出错误，应该记录日志并继续

### 2. 并发控制和竞态条件

- **原子性操作**: 使用 Redis Lua 脚本进行检查并递增（`src/lib/redis/lua-scripts.ts`）
- **Session 分配**: 先检查并追踪，失败时尝试其他供应商
- 避免在没有原子性保证的情况下进行并发限制检查

### 3. 数据库迁移

- 使用 `pnpm db:generate` 生成迁移文件
- 生产环境使用 `AUTO_MIGRATE=true` 自动执行迁移
- 索引优化: 所有查询都有对应的复合索引（参见 schema.ts 中的 index 定义）
- 时区处理: 所有 timestamp 字段使用 `withTimezone: true`

### 4. 时区处理

- 数据库统计查询使用 `AT TIME ZONE 'Asia/Shanghai'` 转换
- 前端显示使用 `date-fns` 和 `timeago.js`
- 环境变量 `TZ` 和 `PGTZ` 统一设置为 `Asia/Shanghai`

### 5. 成本计算

- 支持 Claude 格式 (`input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`)
- 支持 OpenAI 格式 (`prompt_tokens`, `completion_tokens`)
- 价格单位: USD/M tokens (百万 tokens)
- 成本倍数: 供应商级别的 `cost_multiplier`

### 6. 日志记录

- 使用 Pino 结构化日志 (`src/lib/logger.ts`)
- 日志级别: `fatal` > `error` > `warn` > `info` > `debug` > `trace`
- 开发环境使用 `pino-pretty` 美化输出
- 关键业务逻辑必须有 info 级别日志

### 7. 代码风格

- 使用 ESLint + Prettier
- 提交前运行 `pnpm typecheck` 确保类型正确
- 遵循现有代码风格（参考 `src/app/v1/_lib/proxy/` 中的代码）

## 常见任务

### 添加新的供应商类型

1. 在 `src/drizzle/schema.ts` 中扩展 `providerType` 枚举
2. 在 `src/app/v1/_lib/proxy/provider-selector.ts` 中添加类型过滤逻辑
3. 如需格式转换，在 `src/app/v1/_lib/codex/transformers/` 中添加转换器

### 添加新的限流维度

1. 在 `src/lib/rate-limit/service.ts` 中添加新的限流方法
2. 在 `src/lib/redis/lua-scripts.ts` 中添加对应的 Lua 脚本
3. 在 `src/app/v1/_lib/proxy/rate-limit-guard.ts` 中集成新的检查

### 添加新的统计维度

1. 在 `src/drizzle/schema.ts` 中扩展 `statistics` 表
2. 在 `src/repository/statistics.ts` 中添加查询方法
3. 在 `src/app/dashboard/_components/` 中添加可视化组件

### 修改数据库 Schema

1. 修改 `src/drizzle/schema.ts`
2. 运行 `pnpm db:generate` 生成迁移文件
3. 检查生成的 SQL 文件 (`drizzle/` 目录)
4. 运行 `pnpm db:push` (开发) 或 `pnpm db:migrate` (生产)

## 故障排查

### 数据库连接失败

- 检查 `DSN` 环境变量格式
- Docker 部署: 确保 postgres 服务已启动 (`docker compose ps`)
- 本地开发: 检查 PostgreSQL 服务是否运行

### Redis 连接失败

- 服务仍然可用（Fail Open 策略）
- 检查 `REDIS_URL` 环境变量
- 查看日志中的 Redis 连接错误
- Docker 部署: `docker compose exec redis redis-cli ping`

### 熔断器误触发

- 查看日志中的 `[CircuitBreaker]` 记录
- 检查供应商健康状态（Dashboard → 供应商管理）
- 等待 30 分钟自动恢复或手动重启应用重置状态

### 供应商选择失败

- 检查供应商是否启用 (`is_enabled = true`)
- 检查熔断器状态（日志中的 `circuitState`）
- 检查并发限制配置（`limit_concurrent_sessions`）
- 查看决策链记录（日志详情页面）

## 参考资源

- [Next.js 15 文档](https://nextjs.org/docs)
- [Hono 文档](https://hono.dev/)
- [Drizzle ORM 文档](https://orm.drizzle.team/)
- [Shadcn UI 文档](https://ui.shadcn.com/)
- [LiteLLM 价格表](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json)

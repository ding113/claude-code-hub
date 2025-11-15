# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目简介

Claude Code Hub 是一个 Claude Code API 代理中转服务平台，用于统一管理多个 AI 服务提供商（支持 Claude Code 格式和 OpenAI 兼容格式），提供智能负载均衡、用户权限管理、使用统计和实时监控功能。

本项目基于 [zsio/claude-code-hub](https://github.com/zsio/claude-code-hub) 进行了增强，新增了：

- **自动化 API 文档生成**（OpenAPI 3.1.0 + Swagger/Scalar UI 双界面，39 个 REST API 端点）
- **价格表分页查询**（支持大规模数据，搜索防抖，SQL 层面性能优化）
- 详细日志记录、并发控制、多时段限流、熔断保护、决策链追踪、OpenAI 兼容等功能

使用中文和用户沟通。

## 常用命令

### 开发命令

```bash
bun dev              # 启动开发服务器 (http://localhost:13500, 使用 Turbopack)
bun build            # 构建生产版本 (自动复制 VERSION 文件)
bun start            # 启动生产服务器
bun lint             # 运行 ESLint
bun typecheck        # TypeScript 类型检查
bun format           # 格式化代码
bun format:check     # 检查代码格式
```

### 数据库命令

```bash
bun db:generate      # 生成 Drizzle 迁移文件
bun db:migrate       # 执行数据库迁移
bun db:push          # 直接推送 schema 到数据库（开发环境）
bun db:studio        # 启动 Drizzle Studio 可视化管理界面
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

### API 文档

```bash
# 访问 API 文档（需要先登录管理后台）
open http://localhost:13500/api/actions/scalar   # Scalar UI（推荐）
open http://localhost:13500/api/actions/docs     # Swagger UI

# 获取 OpenAPI 规范
curl http://localhost:13500/api/actions/openapi.json > openapi.json

# 健康检查
curl http://localhost:13500/api/actions/health
```

## 核心技术栈

- **Next.js 15** (App Router) + **React 19** + **TypeScript**
- **Hono** - 用于 API 路由处理
- **Drizzle ORM** + **PostgreSQL** - 数据持久化
- **Redis** + **ioredis** - 限流、会话追踪、熔断器
- **Tailwind CSS v4** + **Shadcn UI** (orange 主题) - UI 框架
- **Pino** - 结构化日志
- **包管理器**: bun 1.2.27

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
│   │   └── prices/               # 价格表页面（支持分页查询）
│   └── api/                      # 内部 API
│       ├── actions/[...route]/   # 自动化 API 文档系统 (OpenAPI 3.1.0)
│       ├── prices/               # 价格表分页 API
│       └── auth, admin, ...      # 认证、管理、排行榜、版本等
├── lib/                          # 核心业务逻辑
│   ├── api/
│   │   └── action-adapter-openapi.ts  # OpenAPI 自动生成核心适配器
│   ├── hooks/
│   │   └── use-debounce.ts       # 搜索防抖 Hook
│   ├── circuit-breaker.ts        # 熔断器 (内存实现)
│   ├── session-manager.ts        # Session 追踪和缓存
│   ├── rate-limit/               # 限流服务 (Redis + Lua 脚本)
│   ├── redis/                    # Redis 客户端和工具
│   ├── proxy-status-tracker.ts   # 实时代理状态追踪
│   └── price-sync.ts             # LiteLLM 价格同步
├── repository/                   # 数据访问层 (Drizzle ORM)
│   └── model-price.ts            # 模型价格查询（含分页方法）
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
   - 跨组降级策略（allowCrossGroupOnDegrade，可配置）
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

- #### 分组策略与跨组降级
  - 默认严格分组隔离：用户仅能调度到所属分组的供应商；若无可用候选则直接返回错误。
  - **跨组降级（可选）**：
    - ⚙️ 配置优先级：数据库 `system_settings.allow_cross_group_on_degrade` > 环境变量 `ALLOW_CROSS_GROUP_DEGRADE`（仅在数据库未初始化时生效） > 代码默认值 `false`。
    - 🛡️ 默认行为：保持关闭以确保向后兼容。
    - ✅ 启用效果：当分组内无可用供应商时降级到全局候选池，同时继续执行熔断/金额限流过滤，避免“黑屏”。
    - 📍 管理入口：系统设置页的“跨组降级策略”开关；环境变量仅作为临时 fallback。
    - 🔍 可观测性：Selector warn 日志（`ProviderSelector: Cross-group degradation activated`）、Forwarder info 日志（`ProxyForwarder: Cross-group degradation request served`），以及决策链 `ProviderChainItem.reason = cross_group_degradation`，`decisionContext.crossGroupDegradationUsed=true`。

### 代理支持

供应商级别的代理配置 (`src/lib/proxy-agent.ts`):

- **支持协议**: HTTP、HTTPS、SOCKS4、SOCKS5
- **配置粒度**: 每个供应商独立配置代理
- **自动检测**: 根据 URL 协议自动选择代理类型（HTTP/HTTPS 使用 undici ProxyAgent，SOCKS 使用 socks-proxy-agent）
- **故障降级**: 可配置代理失败时是否降级到直连（`proxy_fallback_to_direct` 字段）
- **连接测试**: UI 提供测试按钮，使用 HEAD 请求验证代理配置
- **安全性**: 日志中自动脱敏代理密码

**配置方式**:

在供应商管理页面的"代理配置"部分：

1. **代理地址** (`proxy_url`): 支持以下格式
   - HTTP: `http://proxy.example.com:8080`
   - HTTPS: `https://proxy.example.com:8080`
   - SOCKS4: `socks4://127.0.0.1:1080`
   - SOCKS5: `socks5://user:password@proxy.example.com:1080`

2. **降级策略** (`proxy_fallback_to_direct`):
   - 启用: 代理连接失败时自动尝试直连
   - 禁用: 代理失败直接报错，不降级

3. **测试连接**: 点击"测试连接"按钮验证配置，显示：
   - 连接成功/失败状态
   - HTTP 状态码
   - 响应时间
   - 是否使用代理
   - 错误详情（如果失败）

**技术实现**:

```typescript
// 代理工厂函数（src/lib/proxy-agent.ts）
export function createProxyAgentForProvider(
  provider: Provider,
  targetUrl: string
): ProxyConfig | null {
  // 自动检测协议并创建对应的 ProxyAgent 或 SocksProxyAgent
  // 返回 { agent, fallbackToDirect, proxyUrl }
}

// 请求转发层集成（src/app/v1/_lib/proxy/forwarder.ts）
const proxyConfig = createProxyAgentForProvider(provider, proxyUrl);
if (proxyConfig) {
  init.dispatcher = proxyConfig.agent; // undici dispatcher

  // 代理失败降级逻辑
  if (proxyError && proxyConfig.fallbackToDirect) {
    delete init.dispatcher;
    response = await fetch(proxyUrl, init); // 直连重试
  }
}
```

**使用场景**:

- 中国大陆访问海外 API 服务，改善连接性
- 企业内网环境，需要通过公司代理访问外网
- IP 限制场景，通过代理绕过 IP 封锁

### 数据库 Schema

核心表结构 (`src/drizzle/schema.ts`):

- **users** - 用户管理 (RPM 限制、每日额度、供应商分组)
- **keys** - API 密钥 (金额限流、并发限制、过期时间)
- **providers** - 供应商管理 (权重、优先级、成本倍数、模型重定向、并发限制)
- **messages** - 消息日志 (请求/响应、Token 使用、成本计算、决策链)
- **model_prices** - 模型价格 (支持 Claude 和 OpenAI 格式、缓存 Token 定价)
- **statistics** - 统计数据 (小时级别聚合)

## 模型重定向详解

### 功能定义

**模型重定向**是供应商级别的配置功能，允许将 Claude Code 客户端请求的 Claude 模型名称自动重定向到上游供应商实际支持的模型。

### 工作原理

```
Claude Code 客户端请求: claude-sonnet-4-5-20250929
    ↓
[CCH 模型重定向]
    ↓
实际转发到上游供应商: glm-4.6 (智谱) / gemini-pro (Google)
```

**关键点**：

- **源模型**（用户请求）：必须是 Claude 模型（如 `claude-sonnet-4-5-20250929`、`claude-opus-4`）
- **目标模型**（实际转发）：可以是任何上游供应商支持的模型（如 `glm-4.6`、`gemini-pro`、`gpt-4o`）
- **计费基准**：始终使用**源模型**（用户请求的模型）进行计费，保持用户端费用透明

### 配置方式

在**设置 → 供应商管理 → 编辑供应商**页面的"模型重定向"部分：

1. **用户请求的模型**：输入 Claude Code 客户端请求的模型（如 `claude-sonnet-4-5-20250929`）
2. **实际转发的模型**：输入上游供应商支持的模型（如 `glm-4.6`）
3. 点击"添加"按钮保存规则

**配置示例**：

```json
{
  "claude-sonnet-4-5-20250929": "glm-4.6",
  "claude-opus-4": "gemini-2.5-pro",
  "claude-3-5-sonnet-20241022": "gpt-4o"
}
```

### 使用场景

1. **接入第三方 AI 服务**
   - Claude Code 客户端只认 Anthropic 模型
   - 通过重定向，可以将请求转发到智谱、Google、OpenAI 等第三方服务
   - 用户无需修改客户端配置

2. **成本优化**
   - 将昂贵的 Claude 模型重定向到性能相近但更便宜的第三方模型
   - 示例：`claude-opus-4` → `gemini-2.5-pro`（假设 Gemini 更便宜）

3. **供应商切换**
   - 快速切换不同供应商而不影响客户端
   - 支持 A/B 测试不同模型的效果

4. **模型升级管理**
   - 自动将旧版本模型升级到新版本
   - 示例：`claude-3-opus` → `claude-opus-4`

### 计费说明

**重要**：系统使用**源模型**（用户请求的 Claude 模型）进行计费，而不是重定向后的目标模型。

- **用户请求**：`claude-sonnet-4-5-20250929`
- **实际转发**：`glm-4.6`
- **计费依据**：`claude-sonnet-4-5-20250929` 的价格表
- **数据库记录**：
  - `message_request.original_model` = `claude-sonnet-4-5-20250929`（计费）
  - `message_request.model` = `glm-4.6`（实际使用）

### 技术实现

**数据存储**：

- 表字段：`providers.model_redirects` (JSONB)
- 数据格式：`{ "源模型": "目标模型" }` 的键值对

**执行时机**：

1. 供应商选择完成后
2. 请求转发前
3. `ModelRedirector.apply()` 检查并应用重定向规则（参见 `src/app/v1/_lib/proxy/model-redirector.ts`）

**日志追踪**：

- 重定向会在请求日志中显示"已重定向"标记
- 详细信息包含源模型和目标模型
- Session note 记录完整的重定向路径

### 注意事项

1. **模型兼容性**：确保目标模型的能力与源模型匹配（如支持 tools、thinking 等功能）
2. **价格配置**：需要在价格表中配置源模型的价格，用于正确计费
3. **供应商类型**：建议配置 `joinClaudePool = true`，允许非 Anthropic 供应商加入 Claude 调度池
4. **测试验证**：配置后建议先测试，确保重定向生效且响应格式正确

## 环境变量

关键环境变量 (参见 `.env.example`):

```bash
# 管理员认证
ADMIN_TOKEN=change-me              # 管理后台登录令牌（必须修改）

# 数据库配置
DSN="postgres://..."               # PostgreSQL 连接字符串
AUTO_MIGRATE=true                  # 启动时自动执行迁移

# Redis 配置
# - TCP：使用 redis://
# - TLS（Upstash 等云服务）：使用 rediss://，客户端会显式启用 tls: {}
REDIS_URL=redis://localhost:6379   # Redis 连接地址（本地/容器）
# 例：Upstash TLS 连接（请替换密码和主机）
# REDIS_URL=rediss://default:your_password@your-subdomain.upstash.io:6379
ENABLE_RATE_LIMIT=true             # 启用限流功能

# 跨组降级策略（数据库未初始化时可在此临时启用；上线后建议改用系统设置开关）
ALLOW_CROSS_GROUP_DEGRADE=false    # true=允许跨组降级；false=保持严格分组隔离

# Session 配置
SESSION_TTL=300                    # Session 缓存过期时间（秒）
STORE_SESSION_MESSAGES=false       # 是否存储请求 messages（用于实时监控）

# 熔断器配置
ENABLE_CIRCUIT_BREAKER_ON_NETWORK_ERRORS=false  # 网络错误是否计入熔断器（默认：false）
                                                # false: 仅 HTTP 4xx/5xx 错误计入熔断器
                                                # true: 网络错误（DNS 失败、连接超时等）也计入熔断器

# Cookie 安全策略
ENABLE_SECURE_COOKIES=true         # 是否强制 HTTPS Cookie（默认：true）
                                   # 设置为 false 允许 HTTP 访问，但会降低安全性

# Codex Instructions 注入（已弃用，建议使用供应商级别配置）
# ⚠️ DEPRECATED: 请在供应商管理页面配置 "Codex Instructions 策略" 替代全局开关
# 供应商级别策略提供更精细的控制：auto（智能缓存）、force_official、keep_original
ENABLE_CODEX_INSTRUCTIONS_INJECTION=false  # 是否强制替换 Codex 请求的 instructions（默认：false）
                                           # false: 使用供应商级别策略（推荐）
                                           # true: 全局强制使用官方 instructions（向后兼容，不推荐）
                                           # 注意：供应商未配置策略时，此环境变量作为 fallback

# 应用配置
APP_PORT=23000                     # 应用端口
APP_URL=                           # 应用访问地址（留空自动检测，生产环境建议显式配置）
                                   # 示例：https://your-domain.com 或 http://192.168.1.100:23000
                                   # 用于 OpenAPI 文档的 server URL 配置
NODE_ENV=production                # 环境模式
TZ=Asia/Shanghai                   # 时区设置
LOG_LEVEL=info                     # 日志级别
```

### 环境变量配置注意事项

#### 布尔值配置的正确方式

**重要**: 所有布尔类型的环境变量(如 `ENABLE_SECURE_COOKIES`, `AUTO_MIGRATE`, `ENABLE_RATE_LIMIT` 等)必须使用以下值:

- ✅ **表示 `true`**: `true`, `1`, `yes`, `on` 或任何非 `false`/`0` 的值
- ✅ **表示 `false`**: `false`, `0`

**常见错误**:

```bash
# ❌ 错误 - 字符串 "false" 会被解析为 true!
ENABLE_SECURE_COOKIES="false"  # 错误:引号导致字符串被当作 true

# ✅ 正确 - 不带引号
ENABLE_SECURE_COOKIES=false    # 正确:直接写 false
ENABLE_SECURE_COOKIES=0        # 正确:也可以用 0
```

**技术原因**: 项目使用 Zod 的自定义 transform 逻辑处理布尔值,而不是默认的 `z.coerce.boolean()`,因为后者会将任何非空字符串(包括 `"false"`)都强制转换为 `true`。详见 `src/lib/config/env.schema.ts:20-22` 的注释说明。

#### Cookie 安全策略说明

当通过 HTTP(非 HTTPS)访问系统时:

1. **localhost 访问** (`http://localhost` 或 `http://127.0.0.1`)
   - 即使 `ENABLE_SECURE_COOKIES=true`,现代浏览器也允许设置 Secure Cookie
   - 这是浏览器的安全例外,用于方便本地开发

2. **远程 IP/域名访问** (`http://192.168.x.x` 或 `http://example.com`)
   - 如果 `ENABLE_SECURE_COOKIES=true`,浏览器会**拒绝**设置 Cookie,导致无法登录
   - 必须设置 `ENABLE_SECURE_COOKIES=false` 才能正常使用
   - 或者配置 HTTPS 反向代理(推荐)

#### OpenAPI 文档地址配置

OpenAPI 文档（`/api/actions/scalar` 和 `/api/actions/docs`）中的 server URL 配置：

**配置方式**：

- **生产环境（推荐）**：显式设置 `APP_URL` 环境变量

  ```bash
  APP_URL=https://your-domain.com  # HTTPS 域名
  APP_URL=http://192.168.1.100:23000  # HTTP IP + 端口
  ```

- **开发环境**：留空即可，自动使用 `http://localhost:13500`

**效果**：

- 配置后，OpenAPI 文档中的 "Try it out" 功能会自动使用正确的地址
- 避免生产环境显示 `http://localhost`，导致 API 测试失败

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
- 提交前运行 `bun typecheck` 确保类型正确
- 遵循现有代码风格（参考 `src/app/v1/_lib/proxy/` 中的代码）

### 8. 添加新的 API 端点

当需要将新的 Server Action 暴露为 REST API 时：

1. 在 `src/app/api/actions/[...route]/route.ts` 中注册：

   ```typescript
   const { route, handler } = createActionRoute(
     "module",
     "actionName",
     moduleActions.actionName,
     {
       requestSchema: YourZodSchema,  // 可选
       responseSchema: z.object(...),  // 可选
       description: "端点描述",
       tags: ["标签"],
       requiredRole: "admin",          // 可选
     }
   );
   app.openapi(route, handler);
   ```

2. OpenAPI 文档自动更新，无需手动维护

3. 测试端点：访问 `/api/actions/scalar` 查看并测试

**核心特性**：

- 使用 `createActionRoute()` 自动转换 Server Action 为 OpenAPI 端点
- 复用现有 Zod schemas 进行参数验证
- 自动生成 OpenAPI 3.1.0 规范文档
- 统一的 `ActionResult<T>` 响应格式

### 9. 价格表数据库查询优化

分页查询使用窗口函数和 CTE，注意：

- `findAllLatestPricesPaginated()` - 分页版本（推荐用于大数据量）
- `findAllLatestPrices()` - 非分页版本（向后兼容，小数据量）
- 搜索使用 SQL 层面的 `ILIKE`，性能优于客户端过滤
- 分页参数：`page`（页码）、`pageSize`（每页大小）、`search`（搜索关键词）

**实现要点**：

```typescript
// 使用 ROW_NUMBER() 窗口函数获取最新价格
WITH latest_prices AS (
  SELECT model_name, MAX(created_at) as max_created_at
  FROM model_prices
  WHERE model_name ILIKE '%search%'
  GROUP BY model_name
)
SELECT ... LIMIT 50 OFFSET 0;
```

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
2. 运行 `bun db:generate` 生成迁移文件
3. 检查生成的 SQL 文件 (`drizzle/` 目录)
4. 运行 `bun db:push` (开发) 或 `bun db:migrate` (生产)

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

### 代理连接失败

- 使用"测试连接"按钮验证代理配置
- 检查代理地址格式（必须包含协议前缀：http://, https://, socks4://, socks5://）
- 检查代理服务器是否可访问（防火墙、端口）
- 检查代理认证信息（用户名/密码）
- 查看日志中的详细错误信息：
  - `ProxyError`: 代理服务器连接失败
  - `Timeout`: 连接超时（默认 5 秒）
  - `NetworkError`: 网络错误或 DNS 解析失败
- 如启用了"降级到直连"，检查是否自动降级成功
- 验证目标供应商 URL 是否正确

## 参考资源

- [Next.js 15 文档](https://nextjs.org/docs)
- [Hono 文档](https://hono.dev/)
- [Drizzle ORM 文档](https://orm.drizzle.team/)
- [Shadcn UI 文档](https://ui.shadcn.com/)
- [LiteLLM 价格表](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json)
- 请使用 production 环境构建.

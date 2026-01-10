# Claude Code Hub - Go 重写方案

## 一、项目概况

### 1.1 原项目分析

| 维度 | 现状 (Node.js) | 说明 |
|------|---------------|------|
| 前端 | Next.js 16 + React 19 | 管理后台 UI |
| 后端 | Hono 4 | API 服务 |
| 数据库 | PostgreSQL + Drizzle ORM | 完整的表结构 |
| 缓存 | Redis + ioredis | 限流、会话缓存 |
| 代码量 | ~997 文件 | 包含前端 |

### 1.2 核心功能

- **代理网关**: 转发 AI API 请求到多个供应商
- **多协议支持**: Claude API、OpenAI 兼容 API、Codex API
- **用户管理**: 用户、API Key、权限控制
- **供应商管理**: 多供应商、权重分配、熔断器
- **配额限流**: 多维度限流（RPM、日限额、周限额等）
- **会话管理**: Session 跟踪、并发控制
- **费用统计**: Token 计费、成本追踪
- **通知系统**: Webhook 通知

---

## 二、技术栈选型

### 2.1 确定的技术栈

| 层级 | 选型 | 说明 |
|------|------|------|
| Web 框架 | Gin | 高性能，HTTP/2 + SSE 支持 |
| 数据库 | PostgreSQL | 复用现有数据库 |
| ORM | Bun + pgdriver | SQL-first，开发体验好 |
| Redis | go-redis/v9 | 限流、缓存、会话 |
| 日志 | zerolog | 高性能结构化日志 |
| 配置 | viper | 环境变量 + 配置文件 |
| 验证 | validator/v10 | 请求参数验证 |
| HTTP 客户端 | resty/v2 | 代理上游请求 |
| 金额计算 | quagmt/udecimal | 高性能、零分配精确金额计算 |
| 并发控制 | golang.org/x/sync | errgroup 等 |

### 2.2 Go 模块依赖

```go
// go.mod
module github.com/yourorg/claude-code-hub

go 1.23

require (
    // Web 框架
    github.com/gin-gonic/gin v1.10+

    // 数据库
    github.com/uptrace/bun v1.2+
    github.com/uptrace/bun/driver/pgdriver v1.2+
    github.com/uptrace/bun/dialect/pgdialect v1.2+

    // Redis
    github.com/redis/go-redis/v9 v9+

    // 配置 & 验证
    github.com/spf13/viper v1.19+
    github.com/go-playground/validator/v10 v10+

    // 日志
    github.com/rs/zerolog v1.33+

    // HTTP 客户端
    github.com/go-resty/resty/v2 v2.15+

    // 工具
    github.com/google/uuid v1.6+
    github.com/quagmt/udecimal v1.3+
    golang.org/x/sync v0.10+
)
```

### 2.3 前端策略

**当前决定**: 暂不考虑前端，先完成后端 API。

后续选项：
- A. 保留 Next.js 前端，Go 只负责后端 API
- B. 前端静态化，Go 服务内嵌静态文件
- C. 使用 Vue/Svelte 重写轻量级前端

---

## 三、项目目录结构

```
claude-code-hub/
├── cmd/
│   └── server/
│       └── main.go                # 应用入口
│
├── internal/                      # 内部包
│   ├── config/                    # 配置管理
│   │   ├── config.go              # 配置结构体
│   │   └── loader.go              # viper 加载
│   │
│   ├── database/                  # 数据库连接
│   │   ├── postgres.go            # Bun 初始化
│   │   ├── redis.go               # go-redis 客户端
│   │   └── migrations/            # SQL 迁移文件
│   │
│   ├── model/                     # 数据模型 (对应 schema.ts)
│   │   ├── user.go
│   │   ├── key.go
│   │   ├── provider.go
│   │   ├── message_request.go
│   │   ├── model_price.go
│   │   └── ...
│   │
│   ├── repository/                # 数据访问层
│   │   ├── user_repo.go
│   │   ├── key_repo.go
│   │   ├── provider_repo.go
│   │   ├── statistics_repo.go
│   │   └── ...
│   │
│   ├── service/                   # 业务逻辑层
│   │   ├── auth/
│   │   │   └── auth.go            # API Key 认证
│   │   ├── ratelimit/
│   │   │   ├── service.go         # 多维度限流
│   │   │   ├── lua_scripts.go     # Redis Lua 脚本
│   │   │   └── time_utils.go
│   │   ├── circuitbreaker/
│   │   │   ├── breaker.go         # 熔断器状态机
│   │   │   └── state.go           # Redis 状态持久化
│   │   ├── session/
│   │   │   ├── manager.go         # Session 管理
│   │   │   └── tracker.go         # 并发追踪
│   │   ├── cost/
│   │   │   └── calculator.go      # Token 计费
│   │   ├── cache/
│   │   │   ├── provider_cache.go  # 供应商缓存
│   │   │   └── session_cache.go
│   │   └── notification/
│   │       ├── queue.go           # 通知队列
│   │       └── webhook.go         # Webhook 发送
│   │
│   ├── proxy/                     # 代理核心 (最重要)
│   │   ├── handler.go             # 代理主逻辑
│   │   ├── session.go             # ProxySession 上下文
│   │   ├── forwarder.go           # 上游请求转发
│   │   ├── sse.go                 # SSE 流处理
│   │   ├── provider_selector.go   # 供应商选择 (权重/优先级)
│   │   ├── guard/                 # Guard 链
│   │   │   ├── pipeline.go
│   │   │   ├── auth_guard.go
│   │   │   ├── ratelimit_guard.go
│   │   │   ├── provider_guard.go
│   │   │   └── ...
│   │   └── converter/             # 格式转换器
│   │       ├── claude.go
│   │       ├── openai.go
│   │       ├── gemini.go
│   │       └── codex.go
│   │
│   ├── handler/                   # HTTP 处理器
│   │   ├── v1/                    # 代理 API
│   │   │   ├── messages.go        # /v1/messages
│   │   │   ├── chat.go            # /v1/chat/completions
│   │   │   ├── responses.go       # /v1/responses
│   │   │   └── models.go          # /v1/models
│   │   ├── api/                   # 管理 API
│   │   │   ├── users.go
│   │   │   ├── keys.go
│   │   │   ├── providers.go
│   │   │   └── ...
│   │   └── middleware/
│   │       ├── auth.go
│   │       ├── cors.go
│   │       ├── logger.go
│   │       └── recovery.go
│   │
│   └── pkg/                       # 内部工具包
│       ├── logger/
│       ├── errors/
│       ├── validator/
│       └── utils/
│
├── pkg/                           # 可导出的包
│   └── types/                     # 公共类型定义
│
├── scripts/
│   └── migrate/                   # 迁移工具
│
├── docs/                          # 文档
│   ├── REWRITE.md                 # 本文档
│   └── SPEC.md                    # 技术规范
│
├── go.mod
├── go.sum
├── Makefile
└── README.md
```

---

## 四、模块依赖关系

```
                    ┌─────────────────┐
                    │  cmd/server     │
                    │  (入口)          │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
        ┌─────────┐    ┌─────────┐    ┌─────────┐
        │ config  │    │ logger  │    │ database│
        │ (配置)   │    │ (日志)   │    │ (DB连接) │
        └────┬────┘    └────┬────┘    └────┬────┘
             │              │              │
             └──────────────┼──────────────┘
                            ▼
                    ┌───────────────┐
                    │   repository  │
                    │   (数据访问)    │
                    └───────┬───────┘
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
  ┌──────────┐       ┌──────────┐       ┌──────────┐
  │   auth   │       │  cache   │       │  cost    │
  │  (认证)   │       │  (缓存)   │       │ (计费)    │
  └────┬─────┘       └────┬─────┘       └────┬─────┘
       │                  │                  │
       └──────────────────┼──────────────────┘
                          ▼
              ┌───────────────────────┐
              │      ratelimit        │
              │       (限流)           │
              └───────────┬───────────┘
                          │
              ┌───────────┼───────────┐
              ▼           ▼           ▼
       ┌──────────┐ ┌──────────┐ ┌──────────┐
       │ breaker  │ │ session  │ │ webhook  │
       │  (熔断)   │ │  (会话)   │ │ (通知)    │
       └────┬─────┘ └────┬─────┘ └────┬─────┘
            │            │            │
            └────────────┼────────────┘
                         ▼
                 ┌───────────────┐
                 │     proxy     │
                 │   (代理核心)    │
                 └───────┬───────┘
                         │
                         ▼
                 ┌───────────────┐
                 │    handler    │
                 │  (HTTP处理器)  │
                 └───────────────┘
```

---

## 五、核心模块映射

| Node.js 模块 | Go 模块 | 优先级 | 复杂度 |
|-------------|---------|-------|-------|
| drizzle/schema.ts | internal/model/ | P0 | 中 |
| lib/auth.ts | internal/service/auth/ | P0 | 低 |
| lib/rate-limit/service.ts | internal/service/ratelimit/ | P0 | 高 |
| lib/circuit-breaker.ts | internal/service/circuitbreaker/ | P0 | 中 |
| lib/session-manager.ts | internal/service/session/ | P0 | 高 |
| v1/_lib/proxy-handler.ts | internal/proxy/handler.go | P0 | 高 |
| v1/_lib/proxy/forwarder.ts | internal/proxy/forwarder.go | P0 | 高 |
| v1/_lib/proxy/guard-pipeline.ts | internal/proxy/guard/ | P0 | 中 |
| lib/utils/cost-calculation.ts | internal/service/cost/ | P1 | 低 |
| lib/cache/provider-cache.ts | internal/service/cache/ | P1 | 低 |
| lib/notification/ | internal/service/notification/ | P2 | 中 |
| lib/redis/lua-scripts.ts | internal/service/ratelimit/lua_scripts.go | P0 | 中 |

---

## 六、分阶段实现计划

### Phase 1：基础设施 (Week 1)

| 序号 | 任务 | 对应 Node.js | 状态 |
|-----|------|-------------|------|
| 1.1 | 项目初始化 (go mod, Makefile) | - | 待开始 |
| 1.2 | config/ 配置加载 | lib/config/ | 待开始 |
| 1.3 | pkg/logger/ 日志 | lib/logger.ts | 待开始 |
| 1.4 | database/postgres.go | drizzle/db.ts | 待开始 |
| 1.5 | database/redis.go | lib/redis/ | 待开始 |
| 1.6 | model/ 数据模型 | drizzle/schema.ts | 待开始 |
| 1.7 | pkg/errors/ 错误处理 | lib/error-* | 待开始 |

**交付物**: 可运行的空服务，连接 PostgreSQL + Redis

---

### Phase 2：数据访问层 (Week 2)

| 序号 | 任务 | 对应 Node.js | 状态 |
|-----|------|-------------|------|
| 2.1 | repository/user_repo.go | repository/user.ts | 待开始 |
| 2.2 | repository/key_repo.go | repository/key.ts | 待开始 |
| 2.3 | repository/provider_repo.go | repository/provider.ts | 待开始 |
| 2.4 | repository/statistics_repo.go | repository/statistics.ts | 待开始 |
| 2.5 | repository/price_repo.go | actions/model-prices.ts | 待开始 |

**交付物**: 完整的 CRUD 操作层

---

### Phase 3：核心服务层 (Week 3-4)

| 序号 | 任务 | 对应 Node.js | 状态 |
|-----|------|-------------|------|
| 3.1 | service/auth/ API Key 认证 | lib/auth.ts | 待开始 |
| 3.2 | service/cache/ 供应商缓存 | lib/cache/ | 待开始 |
| 3.3 | service/cost/ Token 计费 | lib/utils/cost-calculation.ts | 待开始 |
| 3.4 | service/ratelimit/ 多维度限流 | lib/rate-limit/ | 待开始 |
| 3.5 | service/circuitbreaker/ 熔断器 | lib/circuit-breaker.ts | 待开始 |
| 3.6 | service/session/ 会话管理 | lib/session-manager.ts | 待开始 |

**交付物**: 核心业务逻辑可独立测试

---

### Phase 4：代理核心 (Week 5-6) ⭐ 最重要

| 序号 | 任务 | 对应 Node.js | 状态 |
|-----|------|-------------|------|
| 4.1 | proxy/session.go ProxySession | v1/_lib/proxy/session.ts | 待开始 |
| 4.2 | proxy/guard/ Guard 链 | v1/_lib/proxy/guards/ | 待开始 |
| 4.3 | proxy/provider_selector.go | v1/_lib/proxy/provider-selector.ts | 待开始 |
| 4.4 | proxy/forwarder.go 请求转发 | v1/_lib/proxy/forwarder.ts | 待开始 |
| 4.5 | proxy/sse.go SSE 流处理 | lib/utils/sse.ts | 待开始 |
| 4.6 | proxy/handler.go 主处理器 | v1/_lib/proxy-handler.ts | 待开始 |
| 4.7 | proxy/converter/ 格式转换 | v1/_lib/converters/ | 待开始 |

**交付物**: 完整的代理功能，可处理 Claude/OpenAI 请求

---

### Phase 5：HTTP 层 (Week 7)

| 序号 | 任务 | 对应 Node.js | 状态 |
|-----|------|-------------|------|
| 5.1 | handler/middleware/ 中间件 | 各中间件 | 待开始 |
| 5.2 | handler/v1/messages.go | /v1/messages | 待开始 |
| 5.3 | handler/v1/chat.go | /v1/chat/completions | 待开始 |
| 5.4 | handler/v1/responses.go | /v1/responses | 待开始 |
| 5.5 | handler/v1/models.go | /v1/models | 待开始 |
| 5.6 | handler/api/ 管理 API | /api/actions/* | 待开始 |

**交付物**: 完整的 API 端点，兼容现有客户端

---

### Phase 6：辅助功能 (Week 8+)

| 序号 | 任务 | 对应 Node.js | 状态 |
|-----|------|-------------|------|
| 6.1 | service/notification/ 通知 | lib/notification/ | 待开始 |
| 6.2 | Webhook 渲染器 | lib/webhook/renderers/ | 待开始 |
| 6.3 | 敏感词检测 | lib/sensitive-word-detector.ts | 待开始 |
| 6.4 | 请求过滤 | lib/request-filter-engine.ts | 待开始 |

---

## 七、测试与验证策略

### 7.1 测试层级

```
┌─────────────────────────────────────────────────┐
│               E2E 测试 (端到端)                   │
│   - 完整 API 请求流程                            │
│   - 与 Node.js 版本行为对比                       │
├─────────────────────────────────────────────────┤
│              集成测试 (Integration)              │
│   - Repository + 真实数据库                      │
│   - Service + Redis                             │
│   - HTTP Handler + 完整服务栈                    │
├─────────────────────────────────────────────────┤
│               单元测试 (Unit)                    │
│   - 纯函数逻辑                                   │
│   - Mock 外部依赖                                │
│   - 边界条件覆盖                                 │
└─────────────────────────────────────────────────┘
```

### 7.2 关键验证点

| 模块 | 验证内容 | 方法 |
|------|---------|------|
| 代理 API | 请求/响应格式兼容性 | 对比测试 |
| SSE 流 | 流式响应正确性 | 抓包对比 |
| 限流 | 多维度限流精度 | 压力测试 |
| 熔断器 | 状态切换正确性 | 故障注入 |
| 成本计算 | 计费精度 | 单元测试 |
| 并发 | 高并发稳定性 | 压力测试 |

### 7.3 兼容性测试脚本

```bash
# 同时运行两个服务，对比响应
# scripts/compare_test.sh

NODE_URL="http://localhost:3000"
GO_URL="http://localhost:8080"

# 对比 API 响应
curl -s "$NODE_URL/v1/models" | jq -S > /tmp/node_models.json
curl -s "$GO_URL/v1/models" | jq -S > /tmp/go_models.json
diff /tmp/node_models.json /tmp/go_models.json
```

### 7.4 灰度发布策略

```
阶段 1: 开发测试 (Dev)
  └── 仅内部测试环境

阶段 2: 影子模式 (Shadow)
  └── 复制生产流量到 Go 服务，不返回响应
  └── 对比日志和指标

阶段 3: 金丝雀发布 (Canary)
  └── 5% → 20% → 50% 流量切换

阶段 4: 全量发布 (Production)
  └── 100% 流量切换
  └── 保留 Node.js 服务作为回滚备份
```

---

## 八、API 兼容性要求

**目标**: 100% 兼容现有 Node.js 版本的 API

### 代理 API

| 端点 | 方法 | 说明 |
|------|------|------|
| /v1/messages | POST | Claude 原生 API |
| /v1/chat/completions | POST | OpenAI 兼容 API |
| /v1/responses | POST | Codex API |
| /v1/models | GET | 模型列表 |

### 管理 API

| 端点 | 方法 | 说明 |
|------|------|------|
| /api/actions/users/* | CRUD | 用户管理 |
| /api/actions/keys/* | CRUD | Key 管理 |
| /api/actions/providers/* | CRUD | 供应商管理 |
| /api/actions/statistics/* | GET | 统计数据 |

---

## 九、开发规范

### 9.1 代码风格

- 遵循 Go 官方代码规范
- 使用 golangci-lint 进行代码检查
- 错误处理使用 `errors.Wrap` 添加上下文
- 日志使用结构化字段

### 9.2 命名规范

- 包名使用小写单词
- 接口名以 `er` 结尾 (如 `UserRepository`)
- 私有方法/变量使用小写开头
- 常量使用驼峰式

### 9.3 测试规范

- 每个包必须有对应的 `_test.go` 文件
- 测试函数命名: `Test<Function>_<Scenario>`
- 使用 table-driven tests
- Mock 使用 `mockgen` 生成

---

## 十、风险与应对

| 风险 | 影响 | 应对策略 |
|------|------|---------|
| SSE 流处理复杂 | 高 | 详细研究 Gin SSE 实现，增加测试覆盖 |
| Lua 脚本迁移 | 中 | 保持与 Node.js 版本一致的脚本逻辑 |
| 供应商 API 变更 | 低 | 使用 adapter 模式隔离变更 |
| 性能回归 | 中 | 建立基准测试，持续监控 |

---

## 十一、里程碑检查点

- [ ] **M1**: 基础设施完成，服务可启动
- [ ] **M2**: Repository 层完成，可进行 CRUD 操作
- [ ] **M3**: 核心服务完成，限流/熔断可工作
- [ ] **M4**: 代理核心完成，可转发 API 请求
- [ ] **M5**: HTTP 层完成，API 100% 兼容
- [ ] **M6**: 辅助功能完成，通知系统可用
- [ ] **M7**: 测试完成，准备灰度发布

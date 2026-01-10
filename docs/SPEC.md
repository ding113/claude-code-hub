# Claude Code Hub - 技术规范 (SPEC)

## 一、数据模型规范

### 1.1 用户模型 (User)

```go
// internal/model/user.go
package model

import (
    "time"
    "github.com/uptrace/bun"
    "github.com/quagmt/udecimal"
)

type User struct {
    bun.BaseModel `bun:"table:users,alias:u"`

    ID              int             `bun:"id,pk,autoincrement" json:"id"`
    Name            string          `bun:"name,notnull" json:"name"`
    Role            string          `bun:"role,notnull,default:'user'" json:"role"` // admin, user
    Tags            []string        `bun:"tags,array" json:"tags"`

    // 配额限制
    RPMLimit        *int            `bun:"rpm_limit" json:"rpmLimit"`
    DailyLimitUSD   udecimal.Decimal `bun:"daily_limit_usd,type:numeric(10,4)" json:"dailyLimitUsd"`
    Limit5hUSD      udecimal.Decimal `bun:"limit_5h_usd,type:numeric(10,4)" json:"limit5hUsd"`
    LimitWeeklyUSD  udecimal.Decimal `bun:"limit_weekly_usd,type:numeric(10,4)" json:"limitWeeklyUsd"`
    LimitMonthlyUSD udecimal.Decimal `bun:"limit_monthly_usd,type:numeric(10,4)" json:"limitMonthlyUsd"`
    LimitTotalUSD   udecimal.Decimal `bun:"limit_total_usd,type:numeric(10,4)" json:"limitTotalUsd"`

    // 权限
    AllowedClients  []string        `bun:"allowed_clients,array" json:"allowedClients"`
    AllowedModels   []string        `bun:"allowed_models,array" json:"allowedModels"`

    // 状态
    IsEnabled       bool            `bun:"is_enabled,notnull,default:true" json:"isEnabled"`
    ExpiresAt       *time.Time      `bun:"expires_at" json:"expiresAt"`
    DeletedAt       *time.Time      `bun:"deleted_at,soft_delete" json:"deletedAt"`

    CreatedAt       time.Time       `bun:"created_at,notnull,default:current_timestamp" json:"createdAt"`
    UpdatedAt       time.Time       `bun:"updated_at,notnull,default:current_timestamp" json:"updatedAt"`

    // 关联
    Keys            []Key           `bun:"rel:has-many,join:id=user_id" json:"keys,omitempty"`
}
```

### 1.2 API Key 模型 (Key)

```go
// internal/model/key.go
type Key struct {
    bun.BaseModel `bun:"table:keys,alias:k"`

    ID              int             `bun:"id,pk,autoincrement" json:"id"`
    UserID          int             `bun:"user_id,notnull" json:"userId"`
    Name            string          `bun:"name,notnull" json:"name"`
    KeyHash         string          `bun:"key_hash,notnull,unique" json:"-"`
    KeyPrefix       string          `bun:"key_prefix,notnull" json:"keyPrefix"`

    // 配额 (继承或覆盖 User)
    RPMLimit        *int            `bun:"rpm_limit" json:"rpmLimit"`
    DailyLimitUSD   udecimal.Decimal `bun:"daily_limit_usd,type:numeric(10,4)" json:"dailyLimitUsd"`
    Limit5hUSD      udecimal.Decimal `bun:"limit_5h_usd,type:numeric(10,4)" json:"limit5hUsd"`
    LimitWeeklyUSD  udecimal.Decimal `bun:"limit_weekly_usd,type:numeric(10,4)" json:"limitWeeklyUsd"`
    LimitMonthlyUSD udecimal.Decimal `bun:"limit_monthly_usd,type:numeric(10,4)" json:"limitMonthlyUsd"`

    // 权限
    AllowedClients  []string        `bun:"allowed_clients,array" json:"allowedClients"`
    AllowedModels   []string        `bun:"allowed_models,array" json:"allowedModels"`

    IsEnabled       bool            `bun:"is_enabled,notnull,default:true" json:"isEnabled"`
    ExpiresAt       *time.Time      `bun:"expires_at" json:"expiresAt"`

    CreatedAt       time.Time       `bun:"created_at,notnull,default:current_timestamp" json:"createdAt"`
    UpdatedAt       time.Time       `bun:"updated_at,notnull,default:current_timestamp" json:"updatedAt"`

    // 关联
    User            *User           `bun:"rel:belongs-to,join:user_id=id" json:"user,omitempty"`
}
```

### 1.3 供应商模型 (Provider)

```go
// internal/model/provider.go
type Provider struct {
    bun.BaseModel `bun:"table:providers,alias:p"`

    ID              int             `bun:"id,pk,autoincrement" json:"id"`
    Name            string          `bun:"name,notnull" json:"name"`
    URL             string          `bun:"url,notnull" json:"url"`
    Key             string          `bun:"key,notnull" json:"-"` // 不序列化

    ProviderType    string          `bun:"provider_type,notnull" json:"providerType"` // anthropic, openai, azure, google, bedrock
    IsEnabled       bool            `bun:"is_enabled,notnull,default:true" json:"isEnabled"`
    Weight          int             `bun:"weight,notnull,default:1" json:"weight"`
    Priority        int             `bun:"priority,notnull,default:0" json:"priority"`
    CostMultiplier  udecimal.Decimal `bun:"cost_multiplier,type:numeric(5,2),default:1.00" json:"costMultiplier"`
    GroupTag        *string         `bun:"group_tag" json:"groupTag"`

    // 限流
    DailyLimitUSD   udecimal.Decimal `bun:"daily_limit_usd,type:numeric(10,4)" json:"dailyLimitUsd"`
    SessionLimit    *int            `bun:"session_limit" json:"sessionLimit"`

    // 熔断配置
    FailureThreshold         int    `bun:"failure_threshold,default:5" json:"failureThreshold"`
    OpenDuration             int    `bun:"open_duration,default:60000" json:"openDuration"` // ms
    HalfOpenSuccessThreshold int    `bun:"half_open_success_threshold,default:2" json:"halfOpenSuccessThreshold"`

    // 支持的模型
    SupportedModels []string        `bun:"supported_models,array" json:"supportedModels"`
    ModelMappings   map[string]string `bun:"model_mappings,type:jsonb" json:"modelMappings"`

    CreatedAt       time.Time       `bun:"created_at,notnull,default:current_timestamp" json:"createdAt"`
    UpdatedAt       time.Time       `bun:"updated_at,notnull,default:current_timestamp" json:"updatedAt"`
}
```

### 1.4 请求日志模型 (MessageRequest)

```go
// internal/model/message_request.go
type MessageRequest struct {
    bun.BaseModel `bun:"table:message_requests,alias:mr"`

    ID              int             `bun:"id,pk,autoincrement" json:"id"`
    KeyID           int             `bun:"key_id,notnull" json:"keyId"`
    ProviderID      int             `bun:"provider_id,notnull" json:"providerId"`
    SessionID       string          `bun:"session_id" json:"sessionId"`

    Model           string          `bun:"model" json:"model"`
    InputTokens     int             `bun:"input_tokens" json:"inputTokens"`
    OutputTokens    int             `bun:"output_tokens" json:"outputTokens"`
    CacheReadTokens int             `bun:"cache_read_tokens" json:"cacheReadTokens"`
    CacheWriteTokens int            `bun:"cache_write_tokens" json:"cacheWriteTokens"`

    CostUSD         udecimal.Decimal `bun:"cost_usd,type:numeric(12,6)" json:"costUsd"`
    StatusCode      int             `bun:"status_code" json:"statusCode"`
    LatencyMs       int             `bun:"latency_ms" json:"latencyMs"`
    ErrorMessage    *string         `bun:"error_message" json:"errorMessage"`

    // 请求类型
    RequestType     string          `bun:"request_type" json:"requestType"` // messages, chat, responses

    CreatedAt       time.Time       `bun:"created_at,notnull,default:current_timestamp" json:"createdAt"`

    // 关联
    Key             *Key            `bun:"rel:belongs-to,join:key_id=id" json:"key,omitempty"`
    Provider        *Provider       `bun:"rel:belongs-to,join:provider_id=id" json:"provider,omitempty"`
}
```

### 1.5 模型定价 (ModelPrice)

```go
// internal/model/model_price.go
type ModelPrice struct {
    bun.BaseModel `bun:"table:model_prices,alias:mp"`

    ID                  int             `bun:"id,pk,autoincrement" json:"id"`
    Model               string          `bun:"model,notnull,unique" json:"model"`
    InputPricePerMToken udecimal.Decimal `bun:"input_price_per_m_token,type:numeric(10,6)" json:"inputPricePerMToken"`
    OutputPricePerMToken udecimal.Decimal `bun:"output_price_per_m_token,type:numeric(10,6)" json:"outputPricePerMToken"`
    CacheReadPricePerMToken udecimal.Decimal `bun:"cache_read_price_per_m_token,type:numeric(10,6)" json:"cacheReadPricePerMToken"`
    CacheWritePricePerMToken udecimal.Decimal `bun:"cache_write_price_per_m_token,type:numeric(10,6)" json:"cacheWritePricePerMToken"`

    CreatedAt           time.Time       `bun:"created_at,notnull,default:current_timestamp" json:"createdAt"`
    UpdatedAt           time.Time       `bun:"updated_at,notnull,default:current_timestamp" json:"updatedAt"`
}
```

---

## 二、配置规范

### 2.1 环境变量

```go
// internal/config/config.go
package config

type Config struct {
    // 服务配置
    Server   ServerConfig   `mapstructure:"server"`
    Database DatabaseConfig `mapstructure:"database"`
    Redis    RedisConfig    `mapstructure:"redis"`
    Log      LogConfig      `mapstructure:"log"`
    Auth     AuthConfig     `mapstructure:"auth"`
}

type ServerConfig struct {
    Port            int    `mapstructure:"port" default:"8080"`
    Host            string `mapstructure:"host" default:"0.0.0.0"`
    ReadTimeout     int    `mapstructure:"read_timeout" default:"30"`    // seconds
    WriteTimeout    int    `mapstructure:"write_timeout" default:"120"`  // seconds for SSE
    ShutdownTimeout int    `mapstructure:"shutdown_timeout" default:"30"`
}

type DatabaseConfig struct {
    Host     string `mapstructure:"host" default:"localhost"`
    Port     int    `mapstructure:"port" default:"5432"`
    User     string `mapstructure:"user" default:"postgres"`
    Password string `mapstructure:"password"`
    DBName   string `mapstructure:"dbname" default:"claude_code_hub"`
    SSLMode  string `mapstructure:"sslmode" default:"disable"`
    MaxConns int    `mapstructure:"max_conns" default:"20"`
}

type RedisConfig struct {
    Host     string `mapstructure:"host" default:"localhost"`
    Port     int    `mapstructure:"port" default:"6379"`
    Password string `mapstructure:"password"`
    DB       int    `mapstructure:"db" default:"0"`
    PoolSize int    `mapstructure:"pool_size" default:"10"`
}

type LogConfig struct {
    Level  string `mapstructure:"level" default:"info"`
    Format string `mapstructure:"format" default:"json"` // json, text
}

type AuthConfig struct {
    AdminAPIKey string `mapstructure:"admin_api_key"` // 管理 API 认证
}
```

### 2.2 环境变量映射

| 环境变量 | 配置路径 | 默认值 | 说明 |
|---------|---------|-------|------|
| SERVER_PORT | server.port | 8080 | 服务端口 |
| SERVER_HOST | server.host | 0.0.0.0 | 监听地址 |
| DATABASE_HOST | database.host | localhost | 数据库地址 |
| DATABASE_PORT | database.port | 5432 | 数据库端口 |
| DATABASE_USER | database.user | postgres | 数据库用户 |
| DATABASE_PASSWORD | database.password | - | 数据库密码 |
| DATABASE_NAME | database.dbname | claude_code_hub | 数据库名 |
| REDIS_HOST | redis.host | localhost | Redis 地址 |
| REDIS_PORT | redis.port | 6379 | Redis 端口 |
| REDIS_PASSWORD | redis.password | - | Redis 密码 |
| LOG_LEVEL | log.level | info | 日志级别 |
| ADMIN_API_KEY | auth.admin_api_key | - | 管理 API Key |

---

## 三、API 规范

### 3.1 代理 API

#### POST /v1/messages (Claude 原生 API)

**请求头**:
```
Authorization: Bearer <api_key>
Content-Type: application/json
X-Session-ID: <optional_session_id>
```

**请求体**:
```json
{
  "model": "claude-sonnet-4-20250514",
  "max_tokens": 1024,
  "messages": [
    {"role": "user", "content": "Hello"}
  ],
  "stream": false
}
```

**响应 (非流式)**:
```json
{
  "id": "msg_xxx",
  "type": "message",
  "role": "assistant",
  "content": [
    {"type": "text", "text": "Hello!"}
  ],
  "model": "claude-sonnet-4-20250514",
  "stop_reason": "end_turn",
  "usage": {
    "input_tokens": 10,
    "output_tokens": 5
  }
}
```

**响应 (流式 SSE)**:
```
data: {"type":"message_start","message":{"id":"msg_xxx",...}}

data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}

data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}

data: {"type":"message_stop"}
```

---

#### POST /v1/chat/completions (OpenAI 兼容 API)

**请求头**:
```
Authorization: Bearer <api_key>
Content-Type: application/json
```

**请求体**:
```json
{
  "model": "gpt-4",
  "messages": [
    {"role": "user", "content": "Hello"}
  ],
  "stream": false
}
```

**响应**:
```json
{
  "id": "chatcmpl-xxx",
  "object": "chat.completion",
  "created": 1234567890,
  "model": "gpt-4",
  "choices": [
    {
      "index": 0,
      "message": {"role": "assistant", "content": "Hello!"},
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 5,
    "total_tokens": 15
  }
}
```

---

#### GET /v1/models

**响应**:
```json
{
  "object": "list",
  "data": [
    {
      "id": "claude-sonnet-4-20250514",
      "object": "model",
      "created": 1234567890,
      "owned_by": "anthropic"
    },
    {
      "id": "gpt-4",
      "object": "model",
      "created": 1234567890,
      "owned_by": "openai"
    }
  ]
}
```

---

### 3.2 管理 API

#### 用户管理

| 方法 | 端点 | 说明 |
|------|------|------|
| GET | /api/actions/users | 获取用户列表 |
| GET | /api/actions/users/:id | 获取单个用户 |
| POST | /api/actions/users | 创建用户 |
| PUT | /api/actions/users/:id | 更新用户 |
| DELETE | /api/actions/users/:id | 删除用户 |

#### API Key 管理

| 方法 | 端点 | 说明 |
|------|------|------|
| GET | /api/actions/keys | 获取 Key 列表 |
| GET | /api/actions/keys/:id | 获取单个 Key |
| POST | /api/actions/keys | 创建 Key (返回完整 Key) |
| PUT | /api/actions/keys/:id | 更新 Key |
| DELETE | /api/actions/keys/:id | 删除 Key |
| POST | /api/actions/keys/:id/rotate | 轮换 Key |

#### 供应商管理

| 方法 | 端点 | 说明 |
|------|------|------|
| GET | /api/actions/providers | 获取供应商列表 |
| GET | /api/actions/providers/:id | 获取单个供应商 |
| POST | /api/actions/providers | 创建供应商 |
| PUT | /api/actions/providers/:id | 更新供应商 |
| DELETE | /api/actions/providers/:id | 删除供应商 |
| POST | /api/actions/providers/:id/test | 测试供应商连接 |

#### 统计 API

| 方法 | 端点 | 说明 |
|------|------|------|
| GET | /api/actions/statistics/usage | 使用量统计 |
| GET | /api/actions/statistics/cost | 成本统计 |
| GET | /api/actions/statistics/users/:id | 单用户统计 |

---

## 四、错误码规范

### 4.1 HTTP 状态码

| 状态码 | 说明 |
|-------|------|
| 200 | 成功 |
| 400 | 请求参数错误 |
| 401 | 认证失败 (无效 API Key) |
| 403 | 权限不足 |
| 404 | 资源不存在 |
| 429 | 请求过于频繁 (限流) |
| 500 | 服务器内部错误 |
| 502 | 上游供应商错误 |
| 503 | 服务不可用 (熔断) |

### 4.2 错误响应格式

```json
{
  "error": {
    "type": "rate_limit_exceeded",
    "message": "You have exceeded your daily request limit",
    "code": "daily_limit_exceeded",
    "details": {
      "limit": 100,
      "used": 100,
      "reset_at": "2024-01-01T00:00:00Z"
    }
  }
}
```

### 4.3 错误类型

| 错误类型 | 说明 |
|---------|------|
| invalid_request | 请求格式错误 |
| authentication_error | 认证失败 |
| permission_denied | 权限不足 |
| rate_limit_exceeded | 限流触发 |
| provider_error | 上游供应商错误 |
| circuit_breaker_open | 熔断器开启 |
| internal_error | 内部错误 |

---

## 五、限流规范

### 5.1 限流维度

| 维度 | Redis Key 格式 | 窗口 |
|------|---------------|------|
| RPM (每分钟请求数) | `ratelimit:rpm:{key_id}:{minute}` | 1 分钟 |
| 日限额 | `ratelimit:daily:{key_id}:{date}` | 1 天 |
| 5 小时限额 | `ratelimit:5h:{key_id}:{window}` | 5 小时 |
| 周限额 | `ratelimit:weekly:{key_id}:{week}` | 1 周 |
| 月限额 | `ratelimit:monthly:{key_id}:{month}` | 1 月 |
| 总限额 | `ratelimit:total:{key_id}` | 永久 |

### 5.2 限流 Lua 脚本

```lua
-- check_and_increment.lua
-- 检查并增加计数，返回是否允许

local key = KEYS[1]
local limit = tonumber(ARGV[1])
local increment = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])

local current = redis.call('GET', key)
current = current and tonumber(current) or 0

if current + increment > limit then
    return {0, current, limit} -- 拒绝
end

redis.call('INCRBYFLOAT', key, increment)
if ttl > 0 then
    redis.call('EXPIRE', key, ttl)
end

return {1, current + increment, limit} -- 允许
```

### 5.3 限流优先级

检查顺序 (任一触发即拒绝):
1. RPM 限制 (Key 级别)
2. RPM 限制 (User 级别)
3. 日限额 (Key 级别)
4. 日限额 (User 级别)
5. 5 小时限额
6. 周限额
7. 月限额
8. 总限额

---

## 六、熔断器规范

### 6.1 状态定义

```go
type CircuitState string

const (
    StateClosed   CircuitState = "closed"    // 正常
    StateOpen     CircuitState = "open"      // 熔断
    StateHalfOpen CircuitState = "half_open" // 半开
)
```

### 6.2 状态转换

```
        ┌─────────────────────────────────────────┐
        │                                         │
        ▼                                         │
    ┌────────┐   失败次数 >= 阈值   ┌────────┐    │
    │ CLOSED │ ──────────────────▶ │  OPEN  │    │
    │ (正常)  │                     │ (熔断)  │    │
    └────────┘                     └────────┘    │
        ▲                              │         │
        │                              │ 超时    │
        │     成功次数 >= 阈值          ▼         │
        │ ◀───────────────────── ┌──────────┐   │
        │                        │ HALF_OPEN│   │
        │                        │  (半开)   │───┘
        │                        └──────────┘
        │                              │
        │         再次失败              │
        └──────────────────────────────┘
```

### 6.3 Redis 状态存储

```
# 熔断器状态
circuit:state:{provider_id} = "open" | "closed" | "half_open"

# 失败计数
circuit:failures:{provider_id} = 3

# 半开成功计数
circuit:half_open_successes:{provider_id} = 1

# 状态过期时间
circuit:open_until:{provider_id} = 1704067200 (timestamp)
```

---

## 七、会话管理规范

### 7.1 Session 结构

```go
type Session struct {
    ID         string    `json:"id"`
    KeyID      int       `json:"keyId"`
    ProviderID int       `json:"providerId"`
    Model      string    `json:"model"`
    CreatedAt  time.Time `json:"createdAt"`
    LastUsedAt time.Time `json:"lastUsedAt"`

    // 统计
    RequestCount int             `json:"requestCount"`
    TotalCost    udecimal.Decimal `json:"totalCost"`
}
```

### 7.2 Session Redis 存储

```
# Session 数据
session:{session_id} = {JSON}

# Session TTL
session:{session_id} TTL = 3600 (1 hour)

# 用户活跃 Session 列表
sessions:key:{key_id} = SET(session_id1, session_id2, ...)

# 供应商并发 Session 计数
provider:sessions:{provider_id} = 5
```

### 7.3 并发控制

- 每个供应商可配置最大并发 Session 数
- 超出限制时返回 503 错误
- Session 空闲超时后自动释放

---

## 八、日志规范

### 8.1 日志格式

```json
{
  "level": "info",
  "ts": "2024-01-01T00:00:00.000Z",
  "msg": "Request completed",
  "request_id": "req_xxx",
  "key_id": 123,
  "provider_id": 456,
  "model": "claude-sonnet-4-20250514",
  "latency_ms": 1234,
  "status_code": 200,
  "input_tokens": 100,
  "output_tokens": 50,
  "cost_usd": 0.001
}
```

### 8.2 日志级别

| 级别 | 使用场景 |
|------|---------|
| debug | 调试信息，生产环境关闭 |
| info | 正常请求日志 |
| warn | 警告 (限流、熔断等) |
| error | 错误 (上游失败、内部错误) |

---

## 九、接口定义

### 9.1 Repository 接口

```go
// internal/repository/user_repo.go
type UserRepository interface {
    Create(ctx context.Context, user *model.User) error
    GetByID(ctx context.Context, id int) (*model.User, error)
    GetByKeyID(ctx context.Context, keyID int) (*model.User, error)
    List(ctx context.Context, filter UserFilter) ([]model.User, int, error)
    Update(ctx context.Context, user *model.User) error
    Delete(ctx context.Context, id int) error
}

type UserFilter struct {
    Role      *string
    IsEnabled *bool
    Tags      []string
    Offset    int
    Limit     int
}
```

### 9.2 Service 接口

```go
// internal/service/ratelimit/service.go
type RateLimitService interface {
    // 检查是否允许请求
    Check(ctx context.Context, keyID int, userID int, cost udecimal.Decimal) (*RateLimitResult, error)

    // 记录使用量
    Record(ctx context.Context, keyID int, userID int, cost udecimal.Decimal) error

    // 获取当前使用量
    GetUsage(ctx context.Context, keyID int, userID int) (*UsageInfo, error)
}

type RateLimitResult struct {
    Allowed     bool
    LimitType   string // rpm, daily, weekly, etc.
    CurrentUsed udecimal.Decimal
    Limit       udecimal.Decimal
    ResetAt     *time.Time
}
```

### 9.3 Proxy 接口

```go
// internal/proxy/handler.go
type ProxyHandler interface {
    HandleMessages(ctx *gin.Context)      // /v1/messages
    HandleChat(ctx *gin.Context)          // /v1/chat/completions
    HandleResponses(ctx *gin.Context)     // /v1/responses
    HandleModels(ctx *gin.Context)        // /v1/models
}

// internal/proxy/guard/guard.go
type Guard interface {
    // 检查请求是否允许通过
    Check(session *ProxySession) error

    // Guard 名称
    Name() string
}
```

---

## 十、性能指标

### 10.1 目标指标

| 指标 | 目标值 |
|------|-------|
| P50 延迟 (代理开销) | < 5ms |
| P99 延迟 (代理开销) | < 20ms |
| 吞吐量 | > 10,000 req/s |
| 内存占用 | < 500MB |
| 启动时间 | < 3s |

### 10.2 监控指标

```go
// 需要暴露的 Prometheus 指标
request_total{method, path, status}           // 请求总数
request_duration_seconds{method, path}        // 请求延迟
upstream_request_total{provider, status}      // 上游请求总数
upstream_request_duration_seconds{provider}   // 上游请求延迟
circuit_breaker_state{provider}               // 熔断器状态
rate_limit_hit_total{type}                    // 限流触发次数
active_sessions{provider}                     // 活跃会话数
```

---

## 十一、安全规范

### 11.1 敏感数据处理

- API Key 存储使用 bcrypt 哈希
- 供应商密钥加密存储 (可选)
- 日志中屏蔽敏感字段

### 11.2 请求验证

- 所有输入参数进行验证
- 防止 SQL 注入 (使用参数化查询)
- 防止 XSS (JSON 响应自动转义)

### 11.3 速率限制

- 全局 IP 限流 (可选)
- API Key 级别限流
- 防止 DDoS 攻击

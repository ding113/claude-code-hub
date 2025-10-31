# API 文档使用指南

## 概述

Claude Code Hub 提供了完整的 REST API 接口，支持通过 HTTP 请求进行所有管理操作。所有 API 基于 OpenAPI 3.1.0 规范自动生成，确保文档与实现完全同步。

## 文档访问

### Scalar UI（推荐）

访问：`http://localhost:23000/api/actions/scalar`

**特性**：
- 🎨 现代化紫色主题
- 🔍 智能搜索和分类
- 🧪 交互式 API 测试
- 📱 响应式布局
- 💡 清晰的请求/响应示例

### Swagger UI（传统）

访问：`http://localhost:23000/api/actions/docs`

**特性**：
- 📚 传统 Swagger 界面
- 🧪 完整的 Try it out 功能
- 📄 标准 OpenAPI 格式
- 🔧 强大的调试工具

### OpenAPI 规范

访问：`http://localhost:23000/api/actions/openapi.json`

**用途**：
- 生成客户端 SDK（TypeScript、Python、Go 等）
- 导入到 Postman、Insomnia 等工具
- 自动化测试集成
- API 网关配置

## 认证方式

所有 API 端点使用 **Cookie 认证**：

1. 通过 Web UI 登录获取 session cookie
2. 在请求中包含 cookie：
   ```bash
   curl -X POST http://localhost:23000/api/actions/users/getUsers \
     -H "Cookie: session=your-session-cookie"
   ```

**在浏览器中获取 Cookie**：

1. 登录管理后台
2. 打开浏览器开发者工具（F12）
3. 进入 Application/存储 → Cookies
4. 复制 `session` cookie 的值

**在代码中使用**：

```typescript
// 使用 fetch API
const response = await fetch('/api/actions/users/getUsers', {
  method: 'POST',
  credentials: 'include', // 自动包含 cookie
});

// 使用 axios
const response = await axios.post('/api/actions/users/getUsers', {}, {
  withCredentials: true,
});
```

## 权限系统

- **管理员**（admin）：拥有完整的系统管理权限
- **普通用户**（user）：可查看自己的数据和使用统计

标记为 `(管理员)` 的端点需要管理员权限。

## API 模块

### 1. 用户管理 (5 个端点)

**基础路径**：`/api/actions/users/`

- `POST /getUsers` - 获取所有用户列表（管理员）
- `POST /addUser` - 创建新用户（管理员）
- `POST /editUser` - 编辑用户信息（管理员）
- `POST /removeUser` - 删除用户（管理员）
- `POST /getUserLimitUsage` - 获取用户限额使用情况

**示例：创建用户**

```bash
curl -X POST http://localhost:23000/api/actions/users/addUser \
  -H "Content-Type: application/json" \
  -H "Cookie: session=your-session-cookie" \
  -d '{
    "name": "Alice",
    "description": "测试用户",
    "rpm": 60,
    "dailyQuota": 10
  }'
```

**响应示例**：

```json
{
  "ok": true,
  "data": {
    "id": 1,
    "name": "Alice",
    "description": "测试用户",
    "rpm": 60,
    "dailyQuota": 10
  }
}
```

### 2. 密钥管理 (5 个端点)

**基础路径**：`/api/actions/keys/`

- `POST /getKeys` - 获取用户的密钥列表
- `POST /addKey` - 创建新密钥
- `POST /editKey` - 编辑密钥信息
- `POST /removeKey` - 删除密钥
- `POST /getKeyLimitUsage` - 获取密钥限额使用情况

**示例：创建密钥**

```bash
curl -X POST http://localhost:23000/api/actions/keys/addKey \
  -H "Content-Type: application/json" \
  -H "Cookie: session=your-session-cookie" \
  -d '{
    "userId": 1,
    "name": "Production Key",
    "expiresAt": "2025-12-31T23:59:59Z"
  }'
```

### 3. 供应商管理 (7 个端点)

**基础路径**：`/api/actions/providers/`

- `POST /getProviders` - 获取所有供应商列表（管理员）
- `POST /addProvider` - 创建新供应商（管理员）
- `POST /editProvider` - 编辑供应商信息（管理员）
- `POST /removeProvider` - 删除供应商（管理员）
- `POST /getProvidersHealthStatus` - 获取熔断器健康状态
- `POST /resetProviderCircuit` - 重置熔断器状态（管理员）
- `POST /getProviderLimitUsage` - 获取供应商限额使用情况

**示例：添加供应商**

```bash
curl -X POST http://localhost:23000/api/actions/providers/addProvider \
  -H "Content-Type: application/json" \
  -H "Cookie: session=your-session-cookie" \
  -d '{
    "name": "GLM Provider",
    "baseUrl": "https://api.provider.com/v1",
    "apiKey": "sk-xxx",
    "type": "claude",
    "weight": 10,
    "priority": 1,
    "isEnabled": true
  }'
```

### 4. 模型价格 (5 个端点)

**基础路径**：`/api/actions/model-prices/`

- `POST /getModelPrices` - 获取所有模型价格
- `POST /getModelPricesPaginated` - 获取模型价格（分页）
- `POST /uploadPriceTable` - 上传价格表（管理员）
- `POST /syncLiteLLMPrices` - 同步 LiteLLM 价格表（管理员）
- `POST /getAvailableModelsByProviderType` - 获取可用模型列表
- `POST /hasPriceTable` - 检查是否有价格表

**示例：分页获取价格**

```bash
curl -X POST http://localhost:23000/api/actions/model-prices/getModelPricesPaginated \
  -H "Content-Type: application/json" \
  -H "Cookie: session=your-session-cookie" \
  -d '{
    "page": 1,
    "pageSize": 50,
    "search": "claude"
  }'
```

**响应示例**：

```json
{
  "ok": true,
  "data": {
    "prices": [
      {
        "id": 1,
        "modelName": "claude-3-5-sonnet-20241022",
        "inputPrice": 3,
        "outputPrice": 15,
        "cacheCreationInputPrice": 3.75,
        "cacheReadInputPrice": 0.3,
        "createdAt": "2025-01-01T00:00:00Z"
      }
    ],
    "total": 150,
    "page": 1,
    "pageSize": 50,
    "totalPages": 3
  }
}
```

### 5. 统计数据 (1 个端点)

**基础路径**：`/api/actions/statistics/`

- `POST /getUserStatistics` - 获取用户统计数据

### 6. 使用日志 (3 个端点)

**基础路径**：`/api/actions/usage-logs/`

- `POST /getUsageLogs` - 获取使用日志
- `POST /getModelList` - 获取日志中的模型列表
- `POST /getStatusCodeList` - 获取日志中的状态码列表

**示例：获取日志**

```bash
curl -X POST http://localhost:23000/api/actions/usage-logs/getUsageLogs \
  -H "Content-Type: application/json" \
  -H "Cookie: session=your-session-cookie" \
  -d '{
    "startDate": "2025-01-01",
    "endDate": "2025-01-31",
    "limit": 100
  }'
```

### 7. 概览数据 (1 个端点)

**基础路径**：`/api/actions/overview/`

- `POST /getOverviewData` - 获取首页概览数据

### 8. 敏感词管理 (6 个端点)

**基础路径**：`/api/actions/sensitive-words/`

- `POST /listSensitiveWords` - 获取敏感词列表（管理员）
- `POST /createSensitiveWordAction` - 创建敏感词（管理员）
- `POST /updateSensitiveWordAction` - 更新敏感词（管理员）
- `POST /deleteSensitiveWordAction` - 删除敏感词（管理员）
- `POST /refreshCacheAction` - 手动刷新缓存（管理员）
- `POST /getCacheStats` - 获取缓存统计信息

### 9. Session 管理 (3 个端点)

**基础路径**：`/api/actions/active-sessions/`

- `POST /getActiveSessions` - 获取活跃 Session 列表
- `POST /getSessionDetails` - 获取 Session 详情
- `POST /getSessionMessages` - 获取 Session 的 messages 内容

### 10. 通知管理 (3 个端点)

**基础路径**：`/api/actions/notifications/`

- `POST /getNotificationSettingsAction` - 获取通知设置（管理员）
- `POST /updateNotificationSettingsAction` - 更新通知设置（管理员）
- `POST /testWebhookAction` - 测试 Webhook 配置（管理员）

## 响应格式

所有 API 响应遵循统一格式：

### 成功响应

```json
{
  "ok": true,
  "data": {
    // 响应数据
  }
}
```

### 失败响应

```json
{
  "ok": false,
  "error": "错误消息"
}
```

### HTTP 状态码

- `200`: 操作成功
- `400`: 请求错误（参数验证失败或业务逻辑错误）
- `401`: 未认证（需要登录）
- `403`: 权限不足
- `500`: 服务器内部错误

## 客户端 SDK 生成

使用 OpenAPI 规范自动生成客户端代码：

### TypeScript

```bash
npm install -g @openapitools/openapi-generator-cli

openapi-generator-cli generate \
  -i http://localhost:23000/api/actions/openapi.json \
  -g typescript-fetch \
  -o ./sdk/typescript
```

### Python

```bash
openapi-generator-cli generate \
  -i http://localhost:23000/api/actions/openapi.json \
  -g python \
  -o ./sdk/python
```

### Go

```bash
openapi-generator-cli generate \
  -i http://localhost:23000/api/actions/openapi.json \
  -g go \
  -o ./sdk/go
```

### 其他语言

支持 30+ 种编程语言，详见 [OpenAPI Generator 文档](https://openapi-generator.tech/docs/generators)。

## 工具集成

### Postman

1. 访问 `http://localhost:23000/api/actions/openapi.json`
2. 复制 JSON 内容
3. 在 Postman 中选择 Import → Raw text
4. 粘贴并导入

### Insomnia

1. 下载 OpenAPI JSON 文件
2. 在 Insomnia 中选择 Import/Export → Import Data → From File
3. 选择下载的 JSON 文件

### VS Code REST Client

创建 `.http` 文件：

```http
### 获取用户列表
POST http://localhost:23000/api/actions/users/getUsers
Content-Type: application/json
Cookie: session=your-session-cookie

{}

### 创建用户
POST http://localhost:23000/api/actions/users/addUser
Content-Type: application/json
Cookie: session=your-session-cookie

{
  "name": "Bob",
  "rpm": 60,
  "dailyQuota": 5
}
```

## 错误处理最佳实践

```typescript
async function callAPI<T>(endpoint: string, data: any): Promise<T> {
  try {
    const response = await fetch(`/api/actions/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      credentials: 'include', // 自动包含 cookie
    });

    const result = await response.json();

    if (!result.ok) {
      throw new Error(result.error);
    }

    return result.data as T;
  } catch (error) {
    console.error('API 调用失败:', error);
    throw error;
  }
}

// 使用示例
try {
  const users = await callAPI('users/getUsers', {});
  console.log('用户列表:', users);
} catch (error) {
  alert(`获取用户列表失败: ${error.message}`);
}
```

## 性能优化建议

### 1. 使用分页接口

对于大数据量查询（如价格表、日志），优先使用分页接口：

```typescript
// ❌ 不推荐：一次性获取所有数据
const allPrices = await callAPI('model-prices/getModelPrices', {});

// ✅ 推荐：分页获取
const pagedPrices = await callAPI('model-prices/getModelPricesPaginated', {
  page: 1,
  pageSize: 50,
  search: 'claude'
});
```

### 2. 缓存响应

对于不常变化的数据（如模型价格、供应商列表），可在客户端缓存：

```typescript
const cache = new Map<string, { data: any; expiry: number }>();

async function cachedCallAPI<T>(
  endpoint: string,
  data: any,
  ttl = 60000 // 1分钟
): Promise<T> {
  const cacheKey = `${endpoint}:${JSON.stringify(data)}`;
  const cached = cache.get(cacheKey);

  if (cached && Date.now() < cached.expiry) {
    return cached.data as T;
  }

  const result = await callAPI<T>(endpoint, data);
  cache.set(cacheKey, { data: result, expiry: Date.now() + ttl });

  return result;
}
```

### 3. 批量操作

尽量使用批量接口减少请求次数（如果可用）。

### 4. 并发控制

避免同时发送大量请求，可能触发限流：

```typescript
// ❌ 不推荐：并发 100 个请求
const promises = userIds.map(id =>
  callAPI('users/getUserLimitUsage', { userId: id })
);
await Promise.all(promises);

// ✅ 推荐：限制并发数为 5
async function* chunks<T>(arr: T[], n: number) {
  for (let i = 0; i < arr.length; i += n) {
    yield arr.slice(i, i + n);
  }
}

for await (const chunk of chunks(userIds, 5)) {
  await Promise.all(
    chunk.map(id => callAPI('users/getUserLimitUsage', { userId: id }))
  );
}
```

## 常见问题

### 如何处理 Cookie 认证？

在浏览器环境中，使用 `credentials: 'include'`：

```typescript
fetch('/api/actions/users/getUsers', {
  method: 'POST',
  credentials: 'include', // 自动包含 cookie
});
```

在非浏览器环境（如 Node.js），需要手动管理 cookie：

```typescript
import { CookieJar } from 'tough-cookie';
import fetch from 'node-fetch';

const jar = new CookieJar();

// 登录后保存 cookie
const loginResponse = await fetch('http://localhost:23000/api/auth/login', {
  method: 'POST',
  body: JSON.stringify({ token: 'admin-token' }),
});

const cookies = loginResponse.headers.raw()['set-cookie'];
cookies.forEach(cookie => jar.setCookieSync(cookie, 'http://localhost:23000'));

// 后续请求使用 cookie
const usersResponse = await fetch('http://localhost:23000/api/actions/users/getUsers', {
  method: 'POST',
  headers: {
    Cookie: jar.getCookiesSync('http://localhost:23000').join('; ')
  }
});
```

### API 端点返回 401 未认证？

检查：
1. 是否已通过 Web UI 登录
2. Cookie 是否正确传递
3. Cookie 是否过期（默认 7 天）

### 如何调试 API 请求？

1. 在 Scalar/Swagger UI 中直接测试
2. 使用浏览器开发者工具查看网络请求
3. 在服务端查看日志：`docker compose logs -f app`

### 是否支持 API Key 认证（而非 Cookie）？

当前版本仅支持 Cookie 认证。如需 API Key 认证，可以：
1. 在 GitHub Issues 提出需求
2. 自行扩展 `src/app/api/actions/[...route]/route.ts` 添加认证中间件

## 技术栈

- **Next.js 15** + App Router
- **Hono 4.10.2** + `@hono/zod-openapi`
- **Zod** - Runtime validation
- **OpenAPI 3.1.0** - API 规范
- **Swagger UI** + **Scalar** - 文档界面

## 参考资源

- [OpenAPI 3.1.0 规范](https://spec.openapis.org/oas/v3.1.0)
- [Hono 文档](https://hono.dev/)
- [Zod 文档](https://zod.dev/)
- [Swagger UI](https://swagger.io/tools/swagger-ui/)
- [Scalar API Reference](https://github.com/scalar/scalar)
- [OpenAPI Generator](https://openapi-generator.tech/)

## 反馈与贡献

如有问题或建议，请访问：

- [GitHub Issues](https://github.com/ding113/claude-code-hub/issues)
- [功能建议](https://github.com/ding113/claude-code-hub/issues/new)

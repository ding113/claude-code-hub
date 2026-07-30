# API 文档修复总结

**修复时间**: 2025-12-17
**问题描述**: API 文档中部分接口的 body 请求参数显示为 "UNKNOWN"
**修复方式**: 为所有不需要请求参数的接口显式声明空 `requestSchema`

---

## 🔍 问题根源

### 原因分析

当 `createActionRoute` 没有显式定义 `requestSchema` 时，会使用默认值：

```typescript
const {
  requestSchema = z.object({}).passthrough(),  // ⚠️ 带 passthrough 的空对象
  // ...
} = options;
```

**问题**：`z.object({}).passthrough()` 允许任意属性通过，导致 OpenAPI 生成器无法推断具体结构，文档显示为 **UNKNOWN**。

### 解决方案

为不需要参数的接口显式声明空 `requestSchema`：

```typescript
{
  requestSchema: z.object({}).describe("无需请求参数"),  // ✅ 清晰标注
  // ...
}
```

---

## 📝 修复的接口列表（15 个）

### 用户管理（1 个）
- ✅ `POST /api/actions/users/getUsers` - 获取用户列表

### 供应商管理（2 个）
- ✅ `POST /api/actions/providers/getProviders` - 获取供应商列表
- ✅ `POST /api/actions/providers/getProvidersHealthStatus` - 获取供应商健康状态

### 模型价格（4 个）
- ✅ `POST /api/actions/model-prices/getModelPrices` - 获取模型价格列表
- ✅ `POST /api/actions/model-prices/syncLiteLLMPrices` - 同步 LiteLLM 价格表
- ✅ `POST /api/actions/model-prices/getAvailableModelsByProviderType` - 获取可用模型列表
- ✅ `POST /api/actions/model-prices/hasPriceTable` - 检查价格表状态

### 使用日志（2 个）
- ✅ `POST /api/actions/usage-logs/getModelList` - 获取日志中的模型列表
- ✅ `POST /api/actions/usage-logs/getStatusCodeList` - 获取日志中的状态码列表

### 概览（1 个）
- ✅ `POST /api/actions/overview/getOverviewData` - 获取首页概览数据

### 敏感词管理（3 个）
- ✅ `POST /api/actions/sensitive-words/listSensitiveWords` - 获取敏感词列表
- ✅ `POST /api/actions/sensitive-words/refreshCacheAction` - 刷新敏感词缓存
- ✅ `POST /api/actions/sensitive-words/getCacheStats` - 获取缓存统计信息

### Session 管理（1 个）
- ✅ `POST /api/actions/active-sessions/getActiveSessions` - 获取活跃 Session 列表

### 通知管理（1 个）
- ✅ `POST /api/actions/notifications/getNotificationSettingsAction` - 获取通知设置

---

## 🧪 验证结果

### 类型检查

```bash
$ bun run typecheck
✅ 通过 - 无类型错误
```

### 统计信息

- **修复的接口数量**: 15 个
- **修改的代码行数**: ~45 行（每个接口增加 1 行 `requestSchema`）
- **影响的文件**: 1 个 (`src/app/api/actions/[...route]/route.ts`)

---

## 📊 修复效果对比

### 修复前

```json
// OpenAPI 文档生成的 Request Body Schema
{
  "type": "object",
  "additionalProperties": true,  // ❌ 无法推断具体结构
  "description": "UNKNOWN"
}
```

### 修复后

```json
// OpenAPI 文档生成的 Request Body Schema
{
  "type": "object",
  "properties": {},  // ✅ 明确标注为空对象
  "description": "无需请求参数"
}
```

---

## 🎯 最佳实践建议

### 未来开发规范

1. **所有接口都应显式声明 `requestSchema`**
   - 即使不需要参数，也应该使用 `z.object({}).describe("无需请求参数")`
   - 避免依赖默认值，提高文档可读性

2. **接口参数规范**
   ```typescript
   // ✅ 推荐：显式声明
   {
     requestSchema: z.object({}).describe("无需请求参数"),
     // ...
   }

   // ✅ 推荐：有参数时清晰定义
   {
     requestSchema: z.object({
       userId: z.number().int().positive().describe("用户 ID"),
     }).describe("查询用户信息的参数"),
     // ...
   }

   // ❌ 不推荐：完全不定义（依赖默认值）
   {
     // 缺少 requestSchema
     // ...
   }
   ```

3. **文档描述规范**
   - 使用 `.describe()` 为 schema 添加中文说明
   - 说明应简洁明了，避免冗余

---

## 📚 参考资料

- OpenAPI 3.1.0 规范：https://spec.openapis.org/oas/v3.1.0
- Zod Schema 文档：https://zod.dev
- 项目 API 适配器：`src/lib/api/action-adapter-openapi.ts`
- API 认证指南：`docs/api-authentication-guide.md`

---

**维护者**: CC Hub Team
**最后更新**: 2025-12-17

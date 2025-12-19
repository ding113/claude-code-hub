# API 测试失败问题诊断与修复方案

## 问题根因

API 测试失败的根本原因不是数据库或认证 Token 问题，而是 **Next.js Server API 与测试环境的兼容性问题**。

### 核心问题

1. **`cookies()` 调用限制**
   - 错误：`cookies` was called outside a request scope
   - 位置：`src/lib/auth.ts` → `getAuthCookie()` → `cookies()`
   - 原因：Next.js 的 `cookies()` 只能在真实的 HTTP 请求上下文中调用，测试环境的模拟 Request 无法提供该上下文

2. **`getTranslations()` 限制**
   - 错误：`getTranslations` is not supported in Client Components
   - 位置：`src/actions/users.ts` → `addUser()` 等函数内
   - 原因：next-intl 的 `getTranslations()` 需要 Next.js 运行时环境，测试环境无法提供

### 测试结果分析

- ✅ **未登录测试通过**：因为没有 auth-token，直接返回空数组，不调用 `validateKey()`
- ❌ **管理员认证测试失败**：因为 `validateKey()` 内部调用了 `cookies()`
- ❌ **所有写操作测试失败**：因为 `addUser()` 等函数调用了 `getTranslations()`

## 修复方案

### 方案 1：Mock Next.js 特定函数（✅ 推荐）

在测试环境中 Mock `cookies()` 和 `getTranslations()`，让测试能够正常运行。

**优点**：
- 保持原代码不变
- 完整测试业务逻辑
- 适合单元测试

**实现步骤**：

1. 创建测试 Mock 文件 `tests/mocks/nextjs.ts`：

```typescript
import { vi } from "vitest";

// Mock next/headers cookies
vi.mock("next/headers", () => ({
  cookies: vi.fn(() => ({
    get: vi.fn((name: string) => {
      // 从测试环境变量读取 Cookie
      if (name === "auth-token") {
        return { value: process.env.TEST_ADMIN_TOKEN || "test-admin-token" };
      }
      return undefined;
    }),
    set: vi.fn(),
    delete: vi.fn(),
  })),
}));

// Mock next-intl getTranslations
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(() => {
    return (key: string, params?: Record<string, unknown>) => {
      // 返回简单的英文消息（或使用 i18n 文件）
      const messages: Record<string, string> = {
        "users.created": "User created successfully",
        "users.updated": "User updated successfully",
        "users.deleted": "User deleted successfully",
        "errors.unauthorized": "Unauthorized",
        "errors.forbidden": "Forbidden",
        // ... 更多翻译
      };
      let msg = messages[key] || key;
      if (params) {
        Object.entries(params).forEach(([k, v]) => {
          msg = msg.replace(`{${k}}`, String(v));
        });
      }
      return msg;
    };
  }),
}));
```

2. 在 `tests/setup.ts` 中导入：

```typescript
import "./mocks/nextjs";
```

### 方案 2：使用集成测试（需要启动服务器）

不使用 `callActionsRoute` 直接调用 Server Actions，而是启动真实的 Next.js 开发服务器，通过 HTTP 请求测试 API。

**优点**：
- 完全真实的环境
- 测试覆盖更全面

**缺点**：
- 测试运行慢
- 需要管理服务器生命周期
- CI/CD 配置复杂

### 方案 3：简化测试范围（临时方案）

只测试不依赖 Next.js 特定功能的纯逻辑函数。

**缺点**：
- 测试覆盖率低
- 无法测试完整的 API 端点

## 推荐实施步骤

### 第 1 步：创建 Mock 文件

文件：`tests/mocks/nextjs.ts`

### 第 2 步：更新 `tests/setup.ts`

在顶部添加：
```typescript
import "./mocks/nextjs";
```

### 第 3 步：调整测试期望

某些测试可能需要调整期望值，因为 Mock 环境与真实环境有差异。

### 第 4 步：运行测试验证

```bash
npm run test
```

## 技术债务

这个问题暴露了以下技术债务：

1. **过度依赖 Next.js 特定 API**
   - `cookies()` 应该通过依赖注入或上下文传递
   - `getTranslations()` 应该有降级方案

2. **缺少测试友好的抽象层**
   - 建议创建 `AuthService` 和 `I18nService` 抽象，便于 Mock

3. **文档不完善**
   - 测试文档应该说明 Next.js 特定功能的测试限制

## 参考资料

- [Next.js Testing - Mocking](https://nextjs.org/docs/app/building-your-application/testing/vitest#mocking)
- [Vitest Mocking](https://vitest.dev/guide/mocking.html)
- [next-intl Testing](https://next-intl-docs.vercel.app/docs/workflows/testing)

---

**状态**：待修复
**优先级**：高
**预计工作量**：1-2 小时

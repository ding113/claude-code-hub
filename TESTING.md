# 测试基础设施文档

## 概述

本项目已配置完整的测试基础设施，包括：

- ✅ **单元测试**: Vitest + Testing Library
- ✅ **E2E 测试**: Playwright
- ✅ **覆盖率报告**: v8 Coverage
- ✅ **CI/CD 就绪**: 本地与 CI 环境均可运行

## 快速开始

### 运行所有测试

```bash
pnpm test
```

### 单元测试

```bash
# 运行单元测试（带覆盖率）
pnpm test:unit

# 监听模式
pnpm test:unit:watch
```

### E2E 测试

```bash
# 运行 E2E 测试（自动启动开发服务器）
pnpm test:e2e

# UI 模式（交互式调试）
pnpm test:e2e:ui
```

## 测试样例

### 已实现的测试

#### 1. 时间工具单元测试 (`src/lib/rate-limit/time-utils.spec.ts`)

- ✅ 5小时滚动窗口计算
- ✅ 周一自然周计算
- ✅ 月初自然月计算
- ✅ TTL 计算
- ✅ 重置时间计算
- ✅ 时区处理（Asia/Shanghai）

**覆盖率**: 100% lines, 100% branches, 100% functions

#### 2. 环境配置单元测试 (`src/lib/config/env.schema.spec.ts`)

- ✅ 布尔值字符串转换 (`"false"` → `false`, `"true"` → `true`)
- ✅ 默认值验证
- ✅ 数字类型转换
- ✅ 可选字段处理
- ✅ 枚举验证

**覆盖率**: 100% lines, 100% branches, 100% functions

#### 3. 成本计算单元测试 (`src/lib/utils/cost-calculation.spec.ts`)

- ✅ 空用量返回零成本
- ✅ 基于 token 数量计算成本
- ✅ 成本倍率应用

**覆盖率**: 100% lines, 58.82% branches (部分防御性代码未覆盖), 100% functions

#### 4. 供应商选择逻辑测试 (`src/app/v1/_lib/proxy/provider-selector.spec.ts`)

- ✅ 跨组降级配置测试
- ✅ 严格分组过滤
- ✅ 跨组降级策略
- ✅ 决策链记录

**覆盖率**: 50.22% lines, 32.74% branches, 83.33% functions

#### 5. 首页 E2E 测试 (`e2e/home.spec.ts`)

- ✅ 应用渲染测试
- ✅ 语言代码重定向测试

#### 6. 设置页 E2E 测试 (`e2e/settings.spec.ts`)

- ✅ 登录页可访问性测试
- ✅ 设置页认证要求测试

## 测试统计

### 单元测试

- **测试文件**: 4 个
- **测试用例**: 42 个
- **执行时间**: ~5-6 秒
- **整体覆盖率**:
  - Lines: 64.63%
  - Functions: 88.37%
  - Branches: 42.72%
  - Statements: 63.05%

### E2E 测试

- **测试文件**: 2 个
- **测试用例**: 4 个
- **执行时间**: ~8-10 秒
- **通过率**: 100%

## 项目结构

```
project/
├── src/
│   ├── lib/
│   │   ├── rate-limit/
│   │   │   ├── time-utils.ts
│   │   │   └── time-utils.spec.ts       ✅
│   │   ├── config/
│   │   │   ├── env.schema.ts
│   │   │   └── env.schema.spec.ts       ✅
│   │   └── utils/
│   │       ├── cost-calculation.ts
│   │       └── cost-calculation.spec.ts ✅
│   └── app/
│       └── v1/_lib/proxy/
│           ├── provider-selector.ts
│           └── provider-selector.spec.ts ✅
├── e2e/
│   ├── home.spec.ts                      ✅
│   └── settings.spec.ts                  ✅
├── test/
│   ├── setup.ts
│   └── README.md
├── vitest.config.ts
├── playwright.config.ts
└── TESTING.md (本文档)
```

## 配置文件

### Vitest 配置 (`vitest.config.ts`)

```typescript
{
  test: {
    globals: true,
    environment: "jsdom",
    environmentMatchGlobs: [["src/app/v1/_lib/proxy/**/*.spec.ts", "node"]],
    include: ["src/**/*.spec.{ts,tsx}"],
    setupFiles: ["./test/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      thresholds: { lines: 60, functions: 60, branches: 40, statements: 60 }
    }
  }
}
```

### Playwright 配置 (`playwright.config.ts`)

```typescript
{
  testDir: "./e2e",
  timeout: 30000,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: "http://localhost:13500",
    screenshot: "only-on-failure",
    trace: "on-first-retry"
  },
  projects: [{ name: "chromium" }]
}
```

## CI/CD 集成

### GitHub Actions 示例

```yaml
- name: Install dependencies
  run: pnpm install

- name: Install Playwright browsers
  run: pnpm exec playwright install chromium

- name: Run unit tests
  run: pnpm test:unit

- name: Run E2E tests
  run: pnpm test:e2e
```

## 覆盖率报告

运行单元测试后，覆盖率报告位于：

- **终端输出**: 控制台直接显示
- **HTML 报告**: `coverage/index.html`
- **LCOV 报告**: `coverage/lcov.info`

查看 HTML 报告：

```bash
open coverage/index.html  # macOS
xdg-open coverage/index.html  # Linux
```

## 最佳实践

### 单元测试

1. **纯函数优先**
   - 测试不依赖外部状态的函数
   - Mock 数据库、Redis、外部 API

2. **时区处理**
   - 使用 `vi.useFakeTimers()` 和 `vi.setSystemTime()`
   - 测试 Asia/Shanghai 时区行为

3. **类型安全**
   - 使用 TypeScript 类型定义
   - 避免 `any` 类型

### E2E 测试

1. **冒烟测试**
   - 测试关键页面可访问性
   - 验证基本渲染和重定向

2. **容错性**
   - 处理数据库未初始化情况
   - 使用宽松的选择器

3. **性能**
   - 使用 `domcontentloaded` 而非 `networkidle`
   - 减少不必要的等待

## 常见问题

### Q: 单元测试失败，提示 Mock 错误

**A**: 检查 `test/setup.ts` 中的 Mock 配置，确保所有外部依赖都已 Mock。

### Q: E2E 测试超时

**A**: 增加 `playwright.config.ts` 中的 `timeout` 配置，或优化页面加载速度。

### Q: 覆盖率不达标

**A**: 当前覆盖率阈值设置为：
- Lines: 60%
- Functions: 60%
- Branches: 40%
- Statements: 60%

可在 `vitest.config.ts` 中调整阈值。

### Q: 如何调试 E2E 测试

**A**: 使用 UI 模式：

```bash
pnpm test:e2e:ui
```

这将打开 Playwright 的交互式调试界面。

## 扩展测试

### 添加新的单元测试

1. 在被测试文件同目录下创建 `*.spec.ts`
2. 参考现有测试样例编写测试
3. 运行 `pnpm test:unit` 验证

### 添加新的 E2E 测试

1. 在 `e2e/` 目录下创建 `*.spec.ts`
2. 使用 Playwright 的 API 编写测试
3. 运行 `pnpm test:e2e` 验证

## 相关文档

- [test/README.md](./test/README.md) - 测试使用指南
- [Vitest 文档](https://vitest.dev/)
- [Playwright 文档](https://playwright.dev/)
- [Testing Library 文档](https://testing-library.com/)

## 维护者

如需更新测试配置或添加新的测试样例，请参考上述最佳实践，并确保所有测试通过后再提交。

```bash
# 提交前检查清单
pnpm typecheck  # TypeScript 类型检查
pnpm lint       # ESLint 检查
pnpm test       # 运行所有测试
```

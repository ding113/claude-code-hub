# Testing Infrastructure

本项目采用 Vitest + Playwright 测试框架，提供单元测试和 E2E 测试支持。

## 测试框架

- **单元测试**: Vitest + Testing Library
- **E2E 测试**: Playwright

## 运行测试

### 所有测试

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

# UI 模式（交互式）
pnpm test:e2e:ui
```

## 测试文件组织

```
project/
├── src/
│   ├── lib/
│   │   └── *.spec.ts          # 工具函数单元测试
│   ├── app/
│   │   └── **/*.spec.ts       # 业务逻辑单元测试
│   └── components/
│       └── *.spec.tsx         # React 组件测试
├── e2e/
│   ├── home.spec.ts           # E2E 测试
│   └── settings.spec.ts
└── test/
    ├── setup.ts               # 测试全局配置
    └── README.md              # 本文档
```

## 测试示例

### 单元测试示例

```typescript
import { describe, it, expect } from "vitest";
import { calculateRequestCost } from "./cost-calculation";

describe("calculateRequestCost", () => {
  it("calculates cost correctly", () => {
    const usage = { input_tokens: 1000, output_tokens: 500 };
    const price = { input_cost_per_token: 0.001, output_cost_per_token: 0.002 };

    const cost = calculateRequestCost(usage, price);

    expect(cost.toNumber()).toBeCloseTo(2.0, 2);
  });
});
```

### E2E 测试示例

```typescript
import { test, expect } from "@playwright/test";

test("homepage loads", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Claude Code Hub/);
});
```

## 覆盖率报告

单元测试运行后，覆盖率报告位于：

- **终端输出**: 控制台直接显示
- **HTML 报告**: `coverage/index.html`
- **LCOV 报告**: `coverage/lcov.info`

查看 HTML 报告：

```bash
open coverage/index.html
```

## 配置文件

- `vitest.config.ts` - Vitest 配置
- `playwright.config.ts` - Playwright 配置
- `test/setup.ts` - 测试环境初始化

## CI/CD 集成

在 CI 环境中运行测试：

```bash
# 单元测试
pnpm test:unit

# E2E 测试（需要先启动应用）
pnpm build
pnpm start &
pnpm exec playwright test
```

## 最佳实践

1. **单元测试**
   - 测试纯函数和工具类
   - Mock 外部依赖（数据库、API）
   - 保持测试简洁和快速

2. **E2E 测试**
   - 测试关键用户流程
   - 避免过度依赖 UI 细节
   - 使用语义化选择器

3. **通用原则**
   - 测试行为而非实现
   - 保持测试独立性
   - 使用描述性的测试名称

## 故障排查

### Vitest 常见问题

```bash
# 清除缓存
pnpm vitest run --no-cache

# 查看详细错误
pnpm vitest run --reporter=verbose
```

### Playwright 常见问题

```bash
# 安装浏览器
pnpm exec playwright install

# 查看测试报告
pnpm exec playwright show-report
```

## 相关文档

- [Vitest 文档](https://vitest.dev/)
- [Playwright 文档](https://playwright.dev/)
- [Testing Library 文档](https://testing-library.com/)

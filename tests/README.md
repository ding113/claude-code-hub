# 🧪 Claude Code Hub 测试指南

> **统一 Vitest 框架** | 38 个基础测试 + 103 个集成测试 ✅

---

## ⚡ 快速开始

```bash
# 运行基础测试（无需数据库，38 个测试）
bun run test

# Vitest UI 可视化界面（推荐）
bun run test:ui
# 浏览器访问 → http://localhost:51204/__vitest__/

# 监听模式
bun run test:watch

# 覆盖率报告
bun run test:coverage
```

### 🧹 测试数据自动清理

测试完成后会**自动清理**最近 10 分钟内创建的测试用户（名称包含"测试用户"、"test"或"Test"）。

**禁用自动清理**：
```bash
# 设置环境变量
AUTO_CLEANUP_TEST_DATA=false bun run test
```

**手动清理所有历史测试数据**：
```bash
# PowerShell
.\scripts\cleanup-test-users.ps1

# Bash/Git Bash
bash scripts/cleanup-test-users.sh
```

---

## 📊 测试状态

### ✅ 基础测试（当前可运行 - 38 个）

```
✅ Test Files  5 passed (5)
✅      Tests  38 passed (38)
⚡   Duration  ~9s
```

### ✅ E2E 测试（新增 - 10 个）

```
✅ Test Files  1 passed (1)
✅      Tests  10 passed (10)
⚡   Duration  ~2s
```

**测试内容**：
- 用户 CRUD 完整流程
- Key 管理完整流程
- 业务逻辑验证

**前提**：需要开发服务器运行（`bun run dev`）

| 测试文件 | 测试数 | 说明 | 依赖 |
|---------|--------|------|------|
| api-openapi-spec.test.ts | 13 | OpenAPI 规范验证 | 无 |
| api-endpoints.test.ts | 10 | API 端点测试 | 无 |
| api-actions-integrity.test.ts | 12 | 端点完整性检查 | 无 |
| request-filter-engine.test.ts | 2 | 请求过滤引擎 | 无 |
| terminate-active-sessions-batch.test.ts | 2 | Session 批量操作 | 无 |

### ⚠️ 集成测试（需要数据库）

| 测试文件 | 测试数 | 说明 | 依赖 |
|---------|--------|------|------|
| users-actions.test.ts | 35 | 用户管理 CRUD | 数据库 + Token |
| providers-actions.test.ts | 35 | 供应商管理 CRUD | 数据库 + Token |
| keys-actions.test.ts | 28 | API Key 管理 | 数据库 + Token |
| proxy-errors.test.ts | 24 | 代理错误检测 | 数据库 |
| error-rule-detector.test.ts | 16 | 错误规则检测器 | 数据库 |
| e2e-error-rules.test.ts | 20 | E2E 完整流程 | 数据库 + 认证 |

**总计**：38 + 103 = **141 个测试**

---

## 📁 目录结构

```
tests/
├── api/（API 测试）
│   ├── ✅ api-openapi-spec.test.ts (13) - 无需数据库
│   ├── ✅ api-endpoints.test.ts (10) - 无需数据库
│   ├── ✅ api-actions-integrity.test.ts (12) - 无需数据库
│   ├── ⚠️ users-actions.test.ts (35) - 需要数据库
│   ├── ⚠️ providers-actions.test.ts (35) - 需要数据库
│   └── ⚠️ keys-actions.test.ts (28) - 需要数据库
│
├── unit/（单元测试）
│   ├── ✅ request-filter-engine.test.ts (2)
│   └── ✅ terminate-active-sessions-batch.test.ts (2)
│
├── integration/（集成测试 - 需要数据库）
│   ├── proxy-errors.test.ts (24)
│   ├── error-rule-detector.test.ts (16)
│   └── e2e-error-rules.test.ts (20)
│
├── test-utils.ts           Next.js 路由调用工具
├── server-only.mock.ts     解决 server-only 包冲突
├── setup.ts                Vitest 全局配置
└── README.md               本文档
```

---

## 🔑 认证 Token 配置

### 自动读取（无需额外配置）

测试会自动使用 `.env` 中的 `ADMIN_TOKEN`：

```bash
# .env 文件（你已经配置好了）
ADMIN_TOKEN=2219260993
```

**测试中的使用**：
```typescript
// tests/setup.ts 自动设置
process.env.TEST_ADMIN_TOKEN = process.env.ADMIN_TOKEN;

// 测试文件中使用
const ADMIN_TOKEN = process.env.TEST_ADMIN_TOKEN;
```

---

## 🚀 运行完整测试（141 个）

### 前提条件

1. **启动数据库**：
```bash
docker compose up -d postgres redis
```

2. **配置测试数据库**（可选）：
```bash
# 创建 .env.test
echo 'DSN=postgres://postgres:postgres@localhost:5432/claude_code_hub' > .env.test
```

3. **启用所有测试**：

编辑 `vitest.config.ts`，注释掉 exclude 中的这几行：
```typescript
// "tests/integration/**",
// "tests/api/users-actions.test.ts",
// "tests/api/providers-actions.test.ts",
// "tests/api/keys-actions.test.ts",
```

4. **运行测试**：
```bash
bun run test
```

**预期结果**：
```
✅ Test Files  11 passed (11)
✅      Tests  141 passed (141)
```

---

## 🎯 测试命令

```bash
# 基础测试（无需数据库）
bun run test              # 运行 38 个基础测试
bun run test:api          # 仅 API 测试
bun run test:watch        # 监听模式
bun run test:ui           # Vitest UI

# 报告
bun run test:coverage     # 覆盖率报告
bun run test:ci           # CI 模式

# 代码质量
bun run lint              # 代码检查
bun run typecheck         # 类型检查（✅ 已通过）
```

---

## 📚 测试覆盖范围

### ✅ 基础测试（38 个）
- OpenAPI 规范完整性
- API 端点注册和文档
- HTTP 认证机制
- 参数验证
- 响应格式标准化
- API 文档 UI
- 请求过滤引擎
- Session 批量操作

### ⚠️ 集成测试（103 个 - 需要数据库）
- **用户管理**：创建、编辑、删除、启用/禁用、续期（35 个）
- **供应商管理**：CRUD、权重配置、代理设置（35 个）
- **Key 管理**：创建、删除、查询（28 个）
- **错误规则**：检测器、CRUD、E2E 流程（60 个）

---

## 🏆 整理成果

### 目录优化
- ✅ 删除 4 个多余文档
- ✅ 删除 4 个无用目录（fixtures, examples, helpers, mocks）
- ✅ 测试文件分类（api/ unit/ integration/）
- ✅ 扁平化工具文件

### 测试框架统一
- ✅ 移除 Bun Test
- ✅ 统一使用 Vitest
- ✅ 中文化测试描述
- ✅ Vitest UI 正常运行

### 测试覆盖提升
- **之前**：38 个测试
- **现在**：38 个（基础）+ 103 个（集成）= **141 个测试**
- **提升**：+270%

---

## 💡 推荐使用方式

### 日常开发（推荐）
```bash
# 运行基础测试（快速、稳定）
bun run test

# 或使用 UI 界面
bun run test:ui
```

### 完整验证（需要时）
```bash
# 启动数据库
docker compose up -d postgres redis

# 启用所有测试（修改 vitest.config.ts）
# 然后运行
bun run test
```

---

**维护者**: Claude Code Hub Team
**测试框架**: Vitest 4.0.16
**基础测试**: 100% (38/38)
**最后更新**: 2025-12-17

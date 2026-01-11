# Fix: Edge Runtime `process.once` build warning

## 背景

`next build` 过程中出现 Edge Runtime 不支持 Node API 的告警：`process.once`。

### 复现基线（修复前）

在修复前的版本（例如 tag `v0.4.1`）上运行 `bun run build` 可看到 Edge Runtime 不支持 Node API 的告警，其 import trace 包含：

```text
A Node.js API is used (process.once) which is not supported in the Edge Runtime.
Import traces:
  ./src/lib/async-task-manager.ts
  ./src/lib/price-sync/cloud-price-updater.ts
  ./src/instrumentation.ts
```

相关导入链路（import trace）包含：

- `src/lib/async-task-manager.ts`
- `src/lib/price-sync/cloud-price-updater.ts`
- `src/instrumentation.ts`

## 变更

- `AsyncTaskManager`：
  - 在 `process.env.NEXT_RUNTIME === "edge"` 时跳过初始化，避免触发 `process.once` 等 Node-only API。
- `cloud-price-updater`：
  - 移除对 `AsyncTaskManager` 的顶层静态 import。
  - 在 `requestCloudPriceTableSync()` 内部按需动态 import `AsyncTaskManager`，并在 Edge runtime 下直接 no-op。

## 验证

- `bun run lint`
- `bun run typecheck`
- Targeted coverage（仅统计本次相关文件）：
  - `bunx vitest run tests/unit/lib/async-task-manager-edge-runtime.test.ts tests/unit/price-sync/cloud-price-updater.test.ts --coverage --coverage.provider v8 --coverage.reporter text --coverage.include src/lib/async-task-manager.ts --coverage.include src/lib/price-sync/cloud-price-updater.ts`
  - 结果：All files >= 90%（Statements / Branches / Functions / Lines）
- `bun run build`
  - 结果：不再出现 Edge Runtime `process.once` 相关告警

## 回滚

如需回滚，优先按提交粒度回退（以 commit message 为准）：

- `fix: skip async task manager init on edge`
- `fix: avoid static async task manager import`
- `test: cover edge runtime task scheduling`

定位对应提交（示例）：

```bash
git log --oneline --grep "fix: skip async task manager init on edge"
git log --oneline --grep "fix: avoid static async task manager import"
git log --oneline --grep "test: cover edge runtime task scheduling"
```

## 备选方案（若回归）

如果未来 Next/Turbopack 的静态分析行为变化导致告警回归，可将 Node-only 的 signal hooks 拆分到 `*.node.ts`（例如 `async-task-manager.node.ts`），并仅在 `NEXT_RUNTIME !== "edge"` 的分支里动态引入。

## 快速定位（避免文档漂移）

```bash
rg -n "process\\.once" src/lib/async-task-manager.ts
rg -n "NEXT_RUNTIME|NEXT_PHASE" src/lib tests
rg -n "requestCloudPriceTableSync" src/lib/price-sync/cloud-price-updater.ts tests/unit/price-sync/cloud-price-updater.test.ts
```

## 备注

`.codex/plan/` 与 `.codex/issues/` 属于本地任务落盘目录，不应提交到 Git。

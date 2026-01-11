# Fix: Edge Runtime `process.once` build warning

## 背景

`next build` 过程中出现 Edge Runtime 不支持 Node API 的告警：`process.once`。

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
  - `bunx vitest run tests/unit/lib/async-task-manager-edge-runtime.test.ts tests/unit/price-sync/cloud-price-updater.test.ts --coverage --coverage.provider v8 --coverage.reporter text --coverage.reporter html --coverage.reporter json --coverage.reportsDirectory ./coverage-edgeonce --coverage.include src/lib/async-task-manager.ts --coverage.include src/lib/price-sync/cloud-price-updater.ts`
  - 结果：All files 100%（Statements / Branches / Functions / Lines）
- `bun run build`
  - 结果：不再出现 Edge Runtime `process.once` 相关告警

## 回滚

如需回滚，优先按提交粒度回退（示例 commit hash）：

- `fix: skip async task manager init on edge`（`9b54b107`）
- `fix: avoid static async task manager import`（`56a01255`）
- `test: cover edge runtime task scheduling`（`1152cdad`）

## 备注

`.codex/plan/` 与 `.codex/issues/` 属于本地任务落盘目录，不应提交到 Git。


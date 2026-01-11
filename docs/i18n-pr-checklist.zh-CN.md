# i18n PR 检查清单

> English: [i18n-pr-checklist.md](i18n-pr-checklist.md)

此清单适用于会影响 i18n messages 的变更，尤其是 `settings`、`dashboard`、`myUsage`。

## 必做（自动化）

- [ ] 运行 placeholder 审计（scoped）：
  - `bun run i18n:audit-placeholders`
- [ ] 若该 PR 目标是清零 placeholders，确保 fail 模式无命中：
  - `bun run i18n:audit-placeholders:fail`
- [ ] 运行 messages no-emoji 审计（fail 模式）：
  - `bun run i18n:audit-messages-no-emoji:fail`
- [ ] 运行与 i18n/settings split 相关的单元测试：
  - `bunx vitest run tests/unit/i18n/settings-split-guards.test.ts`
  - `bunx vitest run tests/unit/i18n/settings-index-modules-load.test.ts`

## 必做（Review 证据）

- [ ] 在 PR 描述中包含：
  - 审计输出 diff（before/after）或简短摘要（按 locale 统计 + 关键模块）
  - 如有 allowlist 变更，说明原因（保持 allowlist 最小且可审计）

## 必做（人工抽查）

至少覆盖 `ja` 与 `zh-TW`：
- [ ] Settings 页面（关键区域）：provider list、provider form、request filters、notifications
- [ ] Dashboard 关键组件
- [ ] My Usage 页面

为上述关键页面附上截图（或提供本地路径）。

## 需要遵守的规则

参见 `docs/i18n-translation-quality.md` 获取 R1/R2/R3 规则与 allowlist 约定。

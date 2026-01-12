# i18n settings split（拆分说明）

> English: [i18n-settings-split.md](i18n-settings-split.md)

本仓库将 `messages/<locale>/settings.json` 拆分为更小的 JSON 文件，存放在 `messages/<locale>/settings/` 目录下。

## 目录结构（Layout）

- `messages/<locale>/settings/*.json`: settings 顶层对象的各个子模块
- `messages/<locale>/settings/strings.json`: 直接属于 `settings` 顶层的字符串 key
- `messages/<locale>/settings/providers/*.json`: `settings.providers` 对象拆分后的子模块
- `messages/<locale>/settings/providers/strings.json`: provider 级别的字符串 key
- `messages/<locale>/settings/providers/form/*.json`: `settings.providers.form` 对象拆分后的子模块
- `messages/<locale>/settings/providers/form/strings.json`: provider form 的字符串 key

运行时拼装发生在 `messages/<locale>/settings/index.ts`，并由 `messages/<locale>/index.ts` 引入。

## 验证（Verification）

- 翻译质量规则与审计命令：
  - `docs/i18n-translation-quality.md`

- 跨 locale 同步 key（canonical: zh-CN）：
  - `node scripts/sync-settings-keys.js`

- 单元测试：
  - `bun run test`

- 针对 split 相关模块的 scoped coverage：
  - `bunx vitest run --coverage --coverage.include=scripts/sync-settings-keys.js --coverage.include=messages/**/settings/index.ts`

- Typecheck：
  - `bun run typecheck`

- Lint：
  - `bun run lint`

- Production build：
  - `bun run build`

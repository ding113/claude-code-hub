# i18n 翻译质量规则（R1/R2/R3）

> English: [i18n-translation-quality.md](i18n-translation-quality.md)

本文档定义本仓库 i18n 翻译质量的 **scope** 与 **可执行规则**。
下游脚本与 review checklist 应以本文档为真相源。

## Scope

必须翻译的范围（至少包含）：
- `settings`（拆分后的 settings messages，位于 `messages/<locale>/settings/`）
- `dashboard`（`messages/<locale>/dashboard.json`）
- `myUsage`（`messages/<locale>/myUsage.json`）

Locales：`zh-CN` 为 canonical。其他支持的 locales：`en`、`ja`、`ru`、`zh-TW`。

## Rule R1：非 canonical locale 禁止出现 zh-CN placeholder

对于任意非 canonical locale：
- 若某个 leaf string 在相同 key path 下 **等于** `zh-CN` 的 leaf string，且 `zh-CN` 的值包含汉字，则视为 **placeholder candidate**。
- placeholder candidates 应被 **修复**（翻译），或以明确理由 **加入 allowlist**。

可执行检查：
- `bun run i18n:audit-placeholders`
- 如需在任意命中时让命令失败：添加 `--fail`。
  - `bun run i18n:audit-placeholders:fail`

Allowlist（可审计、保持最小）：
- `scripts/audit-settings-placeholders.allowlist.json`
- 支持的过滤器：`key`、`keyPrefix`、`keyRegex`、`valueRegex`，以及 `glossary` terms。

## Rule R2：必须保留 placeholders/tokens

更新翻译时，**不要改动**：
- keys / JSON structure
- placeholder tokens（例如 `{name}`、`{count}`、`{resetTime}`）
- URL / command snippets（除非明确要翻译且已验证安全）

建议的验证方式：
- `tests/unit/i18n/` 下的单元测试
- 对受影响 locale 的 UI 页面做 spot-check（见 PR checklist）

## Rule R3：Glossary 与术语一致性

维护一份简短 glossary，用于跨 locale 保持一致的术语（品牌、模型名、产品术语等）。

初始 glossary（按需扩展，但保持最小并经过 review）：
- Provider / Model / API / HTTP/2
- Claude / OpenAI / Codex（名称不翻译）

## Rule R4：messages JSON 禁止 Emoji

`messages/**/*.json` 中不允许出现 Emoji 字符。

可执行检查：
- `bun run i18n:audit-messages-no-emoji:fail`

说明：
- 审计输出包含文件路径 + key path + Unicode codepoints（不会直接打印 Emoji 字符本身）。

## Notes

- 优先修复翻译，而不是扩展 allowlists。
- 每条 allowlist 记录都必须在 allowlist 文件中写清原因（最好在 PR 描述中也有引用）。

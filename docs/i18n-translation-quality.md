# i18n translation quality rules (R1/R2/R3)

> 中文对照版: [i18n-translation-quality.zh-CN.md](i18n-translation-quality.zh-CN.md)

This document defines the **scope** and **executable rules** for i18n translation quality in this repo.
Downstream scripts and review checklists should follow this document as the source of truth.

## Scope

Must-translate scope (at least):
- `settings` (split settings messages under `messages/<locale>/settings/`)
- `dashboard` (`messages/<locale>/dashboard.json`)
- `myUsage` (`messages/<locale>/myUsage.json`)

Locales: `zh-CN` is canonical. Other supported locales: `en`, `ja`, `ru`, `zh-TW`.

## Rule R1: No zh-CN placeholders in non-canonical locales

For any non-canonical locale:
- If a leaf string **equals** the `zh-CN` leaf string at the same key path, and the `zh-CN` value contains Han characters, it is treated as a **placeholder candidate**.
- Placeholder candidates should be **fixed** (translated), or **explicitly allowlisted** with a documented reason.

Executable check:
- `bun run i18n:audit-placeholders`
- To fail the command on any findings: add `--fail`.
  - `bun run i18n:audit-placeholders:fail`

Allowlist (auditable, minimal):
- `scripts/audit-settings-placeholders.allowlist.json`
- Supported filters: `key`, `keyPrefix`, `keyRegex`, `valueRegex`, plus `glossary` terms.

## Rule R2: Placeholders/tokens must be preserved

When updating translations, **do not change**:
- keys / JSON structure
- placeholder tokens (e.g. `{name}`, `{count}`, `{resetTime}`)
- URL / command snippets unless intentionally translated and verified safe

Recommended verification:
- unit tests under `tests/unit/i18n/`
- spot-check affected UI pages for the locale (see the PR checklist)

## Rule R3: Glossary and consistent terminology

Maintain a short glossary for terms that should be consistent across locales (brand, model names, product terms).

Initial glossary (expand as needed, but keep it minimal and reviewed):
- Provider / Model / API / HTTP/2
- Claude / OpenAI / Codex (names should not be translated)

## Rule R4: No emoji in messages JSON

`messages/**/*.json` must not contain emoji characters.

Executable check:
- `bun run i18n:audit-messages-no-emoji:fail`

Notes:
- The audit output prints file path + key path + Unicode codepoints (without printing emoji characters).

## Notes

- Prefer fixing translations over expanding allowlists.
- Every allowlist entry must have a clear reason in the allowlist file (and ideally referenced in the PR description).

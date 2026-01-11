# i18n no-emoji / docs zh evidence (2026-01-11)

This document is intended to be copy-pasted into a PR description.

## Summary

- Emoji cleanup (messages JSON):
  - Before: 20 strings contained emoji (top files: `provider-chain.json`, `settings/data.json` across locales)
  - After: 0 hits from `rg -n --pcre2 "\\p{Extended_Pictographic}" messages`
- Placeholder audit (zh-CN equality placeholders): OK
- Quality gates: `lint` / `typecheck` / `test` / `build` all pass

## Emoji cleanup details (messages JSON)

Key locations that were cleaned (keys unchanged, only values updated):
- `messages/<locale>/provider-chain.json`
  - `provider-chain.timeline.circuitTriggered`
  - `provider-chain.timeline.systemErrorNote`
- `messages/<locale>/settings/data.json`
  - `settings.data.import.warningMerge`
  - `settings.data.import.warningOverwrite`

Commands:
- Before/after scan:
  - `rg -n --pcre2 "\\p{Extended_Pictographic}" messages`
- Optional structured listing (prints masked preview, no emoji characters):
  - `node scripts/audit-messages-emoji.js --format=tsv`

## Placeholder audit (R1)

- `bun run i18n:audit-placeholders:fail`
- Expected output:
  - `OK: no zh-CN placeholder candidates found in split settings.`

## No-emoji gate (R4)

- Script (codepoints only, no emoji printing):
  - `bun run i18n:audit-messages-no-emoji:fail`
- Regression test (part of `bun run test`):
  - `tests/unit/i18n/audit-messages-no-emoji-script.test.ts`

## Full regression commands

- `bun run lint`
- `bun run typecheck`
- `bun run test`
- `bun run build`

## Related commits (local)

- `564ab845` chore: add messages emoji audit script (I18NE-010)
- `aaa9fc7d` fix: remove emoji from messages warnings (I18NE-040)
- `80d20686` test: add messages no-emoji audit gate (I18NE-050)
- `2ee38f59` docs: add zh-CN i18n docs (I18NE-020)
- `44eeb5e9` docs: add messages no-emoji rule (I18NE-060)
- `92ebaf0e` chore: run full regression checks (I18NE-070)

## Manual spotcheck (ja / zh-TW)

Due to environment limitations (no GUI/browser automation in this run), screenshots are not attached here.

Recommended steps:
1. Start dev server: `bun run dev` (port 13500)
2. Open pages for both `ja` and `zh-TW` locales:
   - Settings: `/settings` (providers list/form, request filters, notifications)
   - Dashboard: `/dashboard` (key widgets)
   - My Usage: `/my-usage`
3. Attach screenshots to the PR (or provide local file paths) and label each with locale + route.

# i18n PR checklist

> 中文对照版: [i18n-pr-checklist.zh-CN.md](i18n-pr-checklist.zh-CN.md)

This checklist is for changes that affect i18n messages, especially `settings`, `dashboard`, and `myUsage`.

## Required (automation)

- [ ] Run placeholder audit (scoped):
  - `bun run i18n:audit-placeholders`
- [ ] If the PR is meant to eliminate placeholders, ensure fail mode is clean:
  - `bun run i18n:audit-placeholders:fail`
- [ ] Run messages no-emoji audit (fail mode):
  - `bun run i18n:audit-messages-no-emoji:fail`
- [ ] Run unit tests relevant to i18n/settings split:
  - `bunx vitest run tests/unit/i18n/settings-split-guards.test.ts`
  - `bunx vitest run tests/unit/i18n/settings-index-modules-load.test.ts`

## Required (review evidence)

- [ ] Include in PR description:
  - the audit output diff (before/after) or a short summary (counts by locale + key modules)
  - any allowlist changes with reasons (keep allowlist minimal and auditable)

## Required (manual spotcheck)

For at least `ja` and `zh-TW`:
- [ ] Settings pages (key areas): provider list, provider form, request filters, notifications
- [ ] Dashboard key widgets
- [ ] My Usage page

Attach screenshots (or provide a local path) for the key pages above.

## Rules to follow

See `docs/i18n-translation-quality.md` for R1/R2/R3 rules and allowlist conventions.

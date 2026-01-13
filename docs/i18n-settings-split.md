# i18n settings split

> 中文对照版: [i18n-settings-split.zh-CN.md](i18n-settings-split.zh-CN.md)

This repository splits `messages/<locale>/settings.json` into smaller JSON chunks under `messages/<locale>/settings/`.

## Layout
- `messages/<locale>/settings/*.json`: settings top-level object parts
- `messages/<locale>/settings/strings.json`: top-level string keys that belong directly under `settings`
- `messages/<locale>/settings/providers/*.json`: `settings.providers` object parts
- `messages/<locale>/settings/providers/strings.json`: provider-level string keys
- `messages/<locale>/settings/providers/form/*.json`: `settings.providers.form` object parts
- `messages/<locale>/settings/providers/form/strings.json`: provider form string keys

Runtime composition happens in `messages/<locale>/settings/index.ts` and is imported by `messages/<locale>/index.ts`.

## Verification
- Translation quality rules and audit commands:
  - `docs/i18n-translation-quality.md`

- Sync keys across locales (canonical: zh-CN):
  - `node scripts/sync-settings-keys.js`

- Unit tests:
  - `bun run test`

- Scoped coverage for split-related modules:
  - `bunx vitest run --coverage --coverage.include=scripts/sync-settings-keys.js --coverage.include=messages/**/settings/index.ts`

- Typecheck:
  - `bun run typecheck`

- Lint:
  - `bun run lint`

- Production build:
  - `bun run build`

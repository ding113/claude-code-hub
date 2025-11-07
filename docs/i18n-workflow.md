# Translation Management Workflow

This document describes the translation workflow, key naming conventions, and how to add new translations for developers.

## Translation File Structure

```
messages/
├── zh-CN/          # Chinese Simplified (简体中文) - Default locale
│   ├── common.json
│   ├── auth.json
│   ├── dashboard.json
│   ├── settings.json
│   └── usage.json
├── zh-TW/          # Chinese Traditional (繁体中文)
│   └── ...
├── en/             # English
│   └── ...
├── ru/             # Russian (Русский)
│   └── ...
└── ja/             # Japanese (日本語)
    └── ...
```

## Translation Key Naming Convention

Translation keys follow a hierarchical structure: `namespace.section.key`

### Namespaces

- **common**: Shared UI elements (navigation, actions, status, time, validation)
- **auth**: Authentication related (login, logout, security warnings)
- **dashboard**: Dashboard pages (overview, logs, leaderboard, sessions, quotas)
- **settings**: Settings pages (providers, prices, config, data, notifications, etc.)
- **usage**: Usage documentation page

### Sections

Within each namespace, organize keys into logical sections:

- `nav`: Navigation items
- `actions`: Action buttons/links (save, cancel, delete, edit, etc.)
- `title`: Page/section titles
- `description`: Descriptive text
- `labels`: Form labels
- `placeholders`: Input placeholders
- `errors`: Error messages
- `toasts`: Toast notifications
- `dialogs`: Dialog content
- `columns`: Table columns

### Examples

```json
{
  "common": {
    "nav": {
      "dashboard": "仪表盘",
      "settings": "设置"
    },
    "actions": {
      "save": "保存",
      "cancel": "取消"
    }
  },
  "dashboard": {
    "overview": {
      "title": "概览",
      "totalRequests": "总请求数"
    }
  }
}
```

## Using Translations in Components

### Client Components

Use the `useTranslations()` hook:

```tsx
"use client";

import { useTranslations } from "next-intl";

export function MyComponent() {
  const t = useTranslations("namespace");

  return (
    <div>
      <h1>{t("title.pageTitle")}</h1>
      <p>{t("description.text")}</p>
      <button>{t("actions.save")}</button>
    </div>
  );
}
```

### Server Components

Use the `getTranslations()` function:

```tsx
import { getTranslations } from "next-intl/server";

export default async function MyPage() {
  const t = await getTranslations("namespace");

  return (
    <div>
      <h1>{t("title.pageTitle")}</h1>
      <p>{t("description.text")}</p>
    </div>
  );
}
```

### Dynamic Values

Use variables in translations:

```json
{
  "greeting": "你好，{name}!"
}
```

```tsx
const t = useTranslations("common");
<p>{t("greeting", { name: userName })}</p>
```

## Automated String Extraction

Use the extraction script to find and extract hardcoded Chinese strings:

```bash
# Dry run - preview extraction without modifying files
npx tsx scripts/extract-translations.ts --dry-run --verbose

# Extract and update translation files
npx tsx scripts/extract-translations.ts --verbose

# Extract from specific directory
npx tsx scripts/extract-translations.ts --target src/app/[locale]/dashboard
```

### Extraction Process

1. **Scan**: Script scans TSX files for Chinese characters (`[\u4e00-\u9fa5]+`)
2. **Generate Keys**: Auto-generates semantic keys based on context
3. **Update Files**: Adds new translations to `messages/zh-CN/*.json`
4. **Review**: Keys marked with `needsReview: true` require manual refinement

### Manual Key Refinement

Auto-generated keys like `key0key1key2` should be manually refined to semantic names:

```json
// Before (auto-generated)
{
  "title": {
    "key0key1key2key3key4": "消耗排行榜"
  }
}

// After (manually refined)
{
  "title": {
    "costRanking": "消耗排行榜"
  }
}
```

## Adding New Translations

### Step 1: Add Chinese (zh-CN) Translation

Add the new key to the appropriate namespace file in `messages/zh-CN/`:

```json
{
  "dashboard": {
    "newFeature": {
      "title": "新功能标题",
      "description": "新功能描述"
    }
  }
}
```

### Step 2: Add Placeholder for Other Locales

Add the same key structure to other locale files (`zh-TW/`, `en/`, `ru/`, `ja/`):

```json
{
  "dashboard": {
    "newFeature": {
      "title": "New Feature Title",
      "description": "New feature description"
    }
  }
}
```

### Step 3: Use Translation in Code

```tsx
const t = useTranslations("dashboard");
<div>
  <h2>{t("newFeature.title")}</h2>
  <p>{t("newFeature.description")}</p>
</div>
```

### Step 4: Validate JSON Syntax

Ensure all JSON files are valid:

```bash
# Check syntax for all translation files
find messages -name "*.json" -exec node -e "JSON.parse(require('fs').readFileSync('{}', 'utf-8'))" \;
```

## Translation Workflow

### For Developers

1. **Write new UI**: Use Chinese strings directly in code initially
2. **Extract strings**: Run extraction script to pull strings into translation files
3. **Refine keys**: Manually rename auto-generated keys to semantic names
4. **Use translations**: Replace hardcoded strings with `t()` calls
5. **Test**: Verify translations render correctly in all locales

### For Translators

1. **Source**: Always use `messages/zh-CN/*.json` as the source of truth
2. **Translate**: Update corresponding keys in target locale files
3. **Context**: Check the application UI for context if needed
4. **Review**: Have a native speaker review translations for accuracy

## TypeScript Type Safety

next-intl provides type-safe translation keys when configured correctly:

```tsx
// TypeScript will autocomplete and validate translation keys
const t = useTranslations("dashboard");
t("overview.title");  // ✓ Valid
t("invalid.key");     // ✗ TypeScript error
```

## Common Patterns

### Conditional Rendering

```tsx
{isLoading ? t("common.status.loading") : t("common.actions.submit")}
```

### Lists/Arrays

```json
{
  "weekdays": ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]
}
```

```tsx
const t = useTranslations("common");
const weekdays = t.raw("weekdays") as string[];
```

### Pluralization

```json
{
  "itemCount": "{count, plural, =0 {没有项目} =1 {1 个项目} other {# 个项目}}"
}
```

```tsx
t("itemCount", { count: items.length })
```

## Best Practices

### Do's

✅ Use semantic, descriptive key names
✅ Group related translations under common sections
✅ Keep translation keys in sync across all locales
✅ Use the extraction script to find hardcoded strings
✅ Review auto-generated keys and rename them
✅ Test with different locales before committing

### Don'ts

❌ Don't use auto-generated keys like `key0key1key2` in production
❌ Don't hardcode strings directly in components
❌ Don't forget to add keys to all locale files
❌ Don't nest keys too deeply (max 3-4 levels)
❌ Don't mix namespaces (keep related content together)

## Troubleshooting

### Translation Not Showing

**Problem**: `t("myKey")` returns the key instead of translation
**Solution**:
- Verify key exists in `messages/{locale}/{namespace}.json`
- Check namespace matches `useTranslations("namespace")`
- Ensure JSON syntax is valid

### TypeScript Error

**Problem**: "Argument of type 'string' is not assignable to parameter"
**Solution**:
- Add key to translation file
- Restart TypeScript server
- Check for typos in key path

### Missing Translation in Non-Default Locale

**Problem**: Fallback to Chinese appears in English locale
**Solution**:
- Add translation to `messages/en/{namespace}.json`
- Copy key structure from `messages/zh-CN/`
- Translate value to target language

## File Organization Reference

```
src/
├── app/
│   └── [locale]/               # Locale-aware pages
│       ├── layout.tsx          # NextIntlClientProvider setup
│       ├── page.tsx            # Home page (server component)
│       ├── login/
│       │   └── page.tsx        # Client component example
│       └── dashboard/
│           └── page.tsx        # Server component example
├── i18n/
│   ├── request.ts              # Server-side i18n configuration
│   └── routing.ts              # Locale-aware routing
└── messages/                   # Translation files
    ├── zh-CN/
    ├── zh-TW/
    ├── en/
    ├── ru/
    └── ja/
```

## Further Reading

- [next-intl Documentation](https://next-intl.dev/)
- [Next.js App Router i18n Guide](https://next-intl.dev/docs/getting-started/app-router)
- [Translation Best Practices](https://next-intl.dev/docs/usage/messages)

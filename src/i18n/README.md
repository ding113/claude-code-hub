# i18n Infrastructure

This directory contains the internationalization (i18n) infrastructure for the application using `next-intl`.

## Overview

The application supports 5 locales:

- **zh-CN** (Chinese Simplified) - Default
- **zh-TW** (Chinese Traditional)
- **en** (English)
- **ru** (Russian)
- **ja** (Japanese)

## File Structure

```
src/i18n/
├── config.ts          # Locale definitions and configuration
├── routing.ts         # Locale routing and navigation utilities
├── request.ts         # Server-side request configuration
├── index.ts           # Central exports
└── README.md          # This file
```

## Core Components

### 1. Configuration (`config.ts`)

Defines supported locales, default locale, and locale labels.

```typescript
import { locales, defaultLocale, localeLabels } from "@/i18n/config";
```

### 2. Routing (`routing.ts`)

Provides locale-aware routing configuration and navigation utilities.

**Key Features:**

- Automatic locale detection from:
  1. NEXT_LOCALE cookie (persisted for 1 year)
  2. Accept-Language header
  3. Default fallback (zh-CN)
- Always-prefix strategy: All routes include locale prefix (e.g., `/zh-CN/dashboard`)

**Navigation Utilities:**

```typescript
import { Link, redirect, useRouter, usePathname } from '@/i18n/routing';

// Use Link instead of next/link
<Link href="/dashboard">Dashboard</Link>

// Use redirect in Server Actions/Components
redirect('/dashboard');

// Use useRouter in Client Components
const router = useRouter();
router.push('/dashboard');

// Get current pathname without locale prefix
const pathname = usePathname();
```

### 3. Request Configuration (`request.ts`)

Configures how translations are loaded for each request. Currently returns empty messages object (translations will be added in IMPL-002).

## Middleware Integration

The middleware (`src/middleware.ts`) integrates:

1. **Locale Detection**: Automatically detects and routes based on locale
2. **Authentication**: Validates auth tokens and redirects if needed
3. **Path Preservation**: Maintains locale prefix in redirects

### Public Paths

These paths don't require authentication:

- `/[locale]/login`
- `/[locale]/usage-doc`
- `/api/auth/login`
- `/api/auth/logout`

### Protected Paths

All other paths require valid `auth-token` cookie.

## Usage Examples

### In Server Components

```typescript
import { useTranslations } from 'next-intl';

export default function ServerComponent() {
  const t = useTranslations('namespace');

  return <h1>{t('title')}</h1>;
}
```

### In Client Components

```typescript
'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';

export default function ClientComponent() {
  const t = useTranslations('namespace');

  return (
    <div>
      <h1>{t('title')}</h1>
      <Link href="/dashboard">{t('goToDashboard')}</Link>
    </div>
  );
}
```

### In Server Actions

```typescript
import { redirect } from "@/i18n/routing";
import { getTranslations } from "next-intl/server";

export async function serverAction() {
  const t = await getTranslations("namespace");

  // Do something...

  redirect("/dashboard");
}
```

## Locale Cookie

- **Name**: `NEXT_LOCALE`
- **Max Age**: 1 year
- **Path**: `/` (site-wide)
- **SameSite**: `lax`

## Next Steps (Future Tasks)

1. **IMPL-002**: Create translation files (`messages/[locale]/*.json`)
2. **IMPL-003**: Restructure app directory to `app/[locale]/*` pattern
3. **IMPL-004**: Extract hardcoded strings to translation keys
4. **IMPL-005**: Migrate date/time formatting to locale-aware
5. **IMPL-006**: Create language switcher component

## Technical Details

### Next.js 15 App Router Integration

The configuration integrates with Next.js 15's App Router using:

- `createNextIntlPlugin()` in `next.config.ts`
- `createMiddleware()` for locale routing
- `getRequestConfig()` for server-side translation loading

### Type Safety

All locale-related types are strictly typed:

- `Locale` type: Union of supported locale codes
- `Routing` type: Routing configuration type
- Navigation utilities: Fully typed for IDE autocomplete

### Runtime Environment

- Middleware uses Node.js runtime (`export const runtime = "nodejs"`)
- Required for database connections (postgres-js needs `net` module)

## Troubleshooting

### Issue: Locale not detected

**Solution**: Check Accept-Language header or NEXT_LOCALE cookie

### Issue: Redirect loop

**Solution**: Ensure public paths are correctly configured in middleware

### Issue: Type errors

**Solution**: Run `bun run typecheck` to verify TypeScript configuration

## References

- [next-intl Documentation](https://next-intl.dev/)
- [Next.js 15 App Router](https://nextjs.org/docs/app)
- [CLAUDE.md](../../CLAUDE.md) - Project guidelines

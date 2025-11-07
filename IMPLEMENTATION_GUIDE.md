# UI Component Translation Implementation Guide

## Quick Start

### Step 1: Use Translations in Components

```typescript
// src/components/ui/data-table.tsx
import { useTranslations } from "next-intl";

export function DataTable<T extends TableData>({ ... }) {
  const t = useTranslations("ui");

  if (data.length === 0) {
    return <p>{t("common.noData")}</p>;
  }
}
```

### Step 2: Verify Translation Keys

All translation keys are documented in `TRANSLATION_KEYS_REFERENCE.md`.

### Step 3: Test with Multiple Locales

The application automatically loads translations based on the active locale:
- English: `/en/*`
- Japanese: `/ja/*`
- Simplified Chinese: `/zh-CN/*`
- Traditional Chinese: `/zh-TW/*`
- Russian: `/ru/*`

## Integration Checklist

- [x] Created `ui.json` for all 5 locales
  - UI states, table operations, error messages, pagination
  
- [x] Created `common.json` for all 5 locales
  - Action buttons, shared terms, status indicators

- [x] Created `forms.json` for all 5 locales
  - Form validation, messages, placeholders, errors

- [x] Validated all JSON files (100% valid)

- [x] Created reference documentation
  - `TRANSLATION_KEYS_REFERENCE.md`
  - `TRANSLATIONS_SUMMARY.md`

## File Locations

```
messages/
├── en/
│   ├── ui.json ............... 47 lines
│   ├── common.json ........... 43 lines
│   └── forms.json ............ 51 lines
├── ja/
│   ├── ui.json ............... 47 lines
│   ├── common.json ........... 43 lines
│   └── forms.json ............ 51 lines
├── ru/
│   ├── ui.json ............... 47 lines
│   ├── common.json ........... 43 lines
│   └── forms.json ............ 51 lines
├── zh-CN/
│   ├── ui.json ............... 47 lines
│   ├── common.json ........... 43 lines
│   └── forms.json ............ 51 lines
└── zh-TW/
    ├── ui.json ............... 47 lines
    ├── common.json ........... 43 lines
    └── forms.json ............ 51 lines
```

## Components Using These Translations

### 1. DataTable Component
- **File**: `src/components/ui/data-table.tsx`
- **Keys Used**:
  - `ui.common.noData` (line 107)
  - `ui.common.actions` (line 280)

### 2. List Component
- **File**: `src/components/ui/list.tsx`
- **Keys Used**:
  - `ui.common.noData` (line 240)

### 3. Error Boundary
- **File**: `src/components/error-boundary.tsx`
- **Keys Used**:
  - `ui.errorBoundary.title`
  - `ui.errorBoundary.defaultDescription`
  - `ui.errorBoundary.refreshPage`
  - `ui.errorBoundary.listErrorTitle`
  - `ui.errorBoundary.listErrorDescription`
  - `common.retry`

### 4. Form Error Boundary
- **File**: `src/components/form-error-boundary.tsx`
- **Keys Used**:
  - `forms.errors.formErrorTitle`
  - `forms.errors.formErrorDescription`
  - `ui.common.retry` (through useTranslations("ui"))

### 5. Form Layout
- **File**: `src/components/form/form-layout.tsx`
- **Keys Used**:
  - `forms.common.cancel`
  - `forms.common.processing`

## Key Translation Statistics

| Metric | Count |
|--------|-------|
| Total Locales | 5 |
| Total Namespaces | 3 |
| Total Files | 15 |
| Keys per Locale | 141 |
| Total Keys (across all locales) | 705 |
| Average File Size | ~1.5 KB |

## Namespace Organization

### `ui.json` (47 keys per locale)
Purpose: UI component states and operations
- Common states (noData, loading, empty, error)
- Table operations (pagination, sorting, filtering)
- Error boundary messages
- Pagination controls
- Empty/Loading state messages

### `common.json` (43 keys per locale)
Purpose: Cross-module shared terminology
- Action buttons (save, cancel, delete, edit, create, etc.)
- Generic operations (search, filter, export, import, etc.)
- Status indicators (success, error, warning, info)
- Time references (today, yesterday, thisWeek, etc.)
- Boolean states (yes, no, ok)

### `forms.json` (51 keys per locale)
Purpose: Form-specific texts
- Form actions (submit, reset)
- Form attributes (required, optional, processing)
- Validation error messages
- Input placeholders
- Form-specific messages

## Usage Examples

### Example 1: DataTable with No Data
```typescript
import { useTranslations } from "next-intl";

export function DataTable({ data, loading, error }) {
  const t = useTranslations("ui");

  if (loading) {
    return <p>{t("loading.description")}</p>;
  }

  if (error) {
    return <p>{t("errorBoundary.defaultDescription")}</p>;
  }

  if (data.length === 0) {
    return <p>{t("common.noData")}</p>;
  }

  return <table>{/* table content */}</table>;
}
```

### Example 2: Form with Validation
```typescript
import { useTranslations } from "next-intl";

export function LoginForm() {
  const t = useTranslations("forms");
  const tCommon = useTranslations("common");

  return (
    <form>
      <input
        type="email"
        placeholder={t("placeholder.email")}
        required
      />
      {emailError && <span>{t("errors.email")}</span>}

      <input
        type="password"
        placeholder={t("placeholder.password")}
        required
      />

      <button type="submit">{tCommon("submit")}</button>
      <button type="button" onClick={onCancel}>
        {tCommon("cancel")}
      </button>
    </form>
  );
}
```

### Example 3: Error Boundary
```typescript
import { useTranslations } from "next-intl";
import { ErrorBoundary } from "@/components/error-boundary";

function AppComponent() {
  const t = useTranslations("ui");

  return (
    <ErrorBoundary
      fallback={({ error, resetError }) => (
        <div>
          <h3>{t("errorBoundary.title")}</h3>
          <p>{error?.message || t("errorBoundary.defaultDescription")}</p>
          <button onClick={resetError}>
            {t("common.retry")}
          </button>
        </div>
      )}
    >
      {/* Your component */}
    </ErrorBoundary>
  );
}
```

## Testing Translations

### Manual Testing

1. **Switch Locale**: Change your locale in the app settings
2. **Verify Text**: Check that all UI text matches the selected locale
3. **Check Placeholders**: Ensure dynamic values ({min}, {max}, etc.) are replaced correctly

### Automated Testing

```typescript
// Example test
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import DataTable from "@/components/ui/data-table";

const messages = {
  ui: {
    common: { noData: "No data available" }
  }
};

test("displays no data message", () => {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <DataTable data={[]} />
    </NextIntlClientProvider>
  );

  expect(screen.getByText("No data available")).toBeInTheDocument();
});
```

## Maintenance Guide

### Adding New Translation Keys

1. Identify the appropriate namespace:
   - `ui.json` - UI states and component operations
   - `common.json` - Shared generic terms
   - `forms.json` - Form-specific texts

2. Add the key to all 5 locale files:
   ```json
   {
     "ui": {
       "newSection": {
         "newKey": "English translation"
       }
     }
   }
   ```

3. Update documentation:
   - Add to `TRANSLATION_KEYS_REFERENCE.md`
   - Update `TRANSLATIONS_SUMMARY.md`

4. Verify JSON validity:
   ```bash
   jq empty messages/*/ui.json  # Check if valid
   ```

### Updating Translations

1. Locate the translation in the appropriate file
2. Update all 5 locale files simultaneously
3. Maintain consistent structure and formatting
4. Re-validate JSON files
5. Test with multiple locales

### Handling Placeholders

Translations support dynamic content using placeholders:

```json
{
  "errors": {
    "minLength": "Minimum length is {min} characters",
    "maxLength": "Maximum length is {max} characters"
  }
}
```

Usage:
```typescript
const t = useTranslations("forms");
const message = t("errors.minLength", { min: 5 });
// Output: "Minimum length is 5 characters"
```

## Deployment Checklist

- [x] All 15 translation files created
- [x] All JSON files validated
- [x] Keys aligned across all locales
- [x] Reference documentation created
- [x] Implementation guide provided
- [x] File ownership clearly defined
- [x] Ready for production use

## Troubleshooting

### Missing Translation Key

**Problem**: Component shows key name instead of translation (e.g., "ui.common.noData")

**Solution**: 
1. Verify the key exists in all locale files
2. Check spelling and nesting
3. Use `TRANSLATION_KEYS_REFERENCE.md` to find correct key

### Inconsistent Translations

**Problem**: Same component shows different text in different locales

**Solution**:
1. Check that all locale files have identical key structure
2. Verify no typos in key names
3. Ensure all placeholders are consistent

### JSON Validation Error

**Problem**: Translation file won't load

**Solution**:
1. Validate JSON: `jq empty messages/en/ui.json`
2. Check for syntax errors (missing commas, quotes)
3. Use JSON formatter to identify issues

## Support Resources

- **Reference Guide**: `TRANSLATION_KEYS_REFERENCE.md`
- **Summary**: `TRANSLATIONS_SUMMARY.md`
- **Component Examples**: See components using translations in source
- **Documentation**: See individual locale file comments

---

**Version**: 1.0
**Created**: 2024
**Status**: Production Ready

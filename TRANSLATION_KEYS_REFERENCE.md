# Translation Keys Reference Guide

Quick lookup guide for all translation keys available for UI components.

## How to Use Translations

```typescript
// In your React component
import { useTranslations } from "next-intl";

export function MyComponent() {
  const t = useTranslations("ui");           // For ui.json keys
  const tCommon = useTranslations("common");  // For common.json keys
  const tForms = useTranslations("forms");    // For forms.json keys

  return (
    <div>
      <p>{t("common.noData")}</p>  // "No data available"
      <button>{tCommon("save")}</button>  // "Save"
      <input placeholder={tForms("placeholder.text")} />  // "Enter text"
    </div>
  );
}
```

## UI Namespace (`ui.json`)

### Common UI States
```
ui.common.noData        "No data available"
ui.common.actions       "Actions"
ui.common.loading       "Loading..."
ui.common.empty         "Empty"
ui.common.error         "Error"
```

### Table Operations
```
ui.table.pagination     "Pagination"
ui.table.sorting        "Sort"
ui.table.filtering      "Filter"
ui.table.search         "Search"
ui.table.refresh        "Refresh"
ui.table.columns        "Columns"
ui.table.previousPage   "Previous"
ui.table.nextPage       "Next"
ui.table.pageInfo       "Page {current} of {total}"
ui.table.itemsPerPage   "Items per page"
ui.table.selectAll      "Select all"
ui.table.deselectAll    "Deselect all"
```

### Error Boundary
```
ui.errorBoundary.title                  "Something went wrong"
ui.errorBoundary.defaultDescription     "An unexpected error occurred..."
ui.errorBoundary.refreshPage            "Refresh page"
ui.errorBoundary.listErrorTitle         "Failed to load list"
ui.errorBoundary.listErrorDescription   "An error occurred while loading the list..."
```

### Pagination
```
ui.pagination.first     "First"
ui.pagination.last      "Last"
ui.pagination.previous  "Previous"
ui.pagination.next      "Next"
ui.pagination.goToPage  "Go to page"
ui.pagination.pageSize  "Page size"
ui.pagination.total     "Total {total} items"
```

### Empty & Loading States
```
ui.empty.title          "No data"
ui.empty.description    "No data to display"

ui.loading.title        "Loading"
ui.loading.description  "Please wait..."
```

## Common Namespace (`common.json`)

### Action Buttons
```
common.save             "Save"
common.cancel           "Cancel"
common.delete           "Delete"
common.confirm          "Confirm"
common.edit             "Edit"
common.create           "Create"
common.close            "Close"
common.back             "Back"
common.next             "Next"
common.previous         "Previous"
common.retry            "Retry"
common.refresh          "Refresh"
```

### Form Operations
```
common.search           "Search"
common.filter           "Filter"
common.export           "Export"
common.import           "Import"
common.submit           "Submit"
common.reset            "Reset"
```

### View Operations
```
common.view             "View"
common.copy             "Copy"
common.download         "Download"
common.upload           "Upload"
common.add              "Add"
common.remove           "Remove"
common.apply            "Apply"
common.clear            "Clear"
```

### Boolean States
```
common.ok               "OK"
common.yes              "Yes"
common.no               "No"
```

### Time References
```
common.today            "Today"
common.yesterday        "Yesterday"
common.thisWeek         "This week"
common.thisMonth        "This month"
common.thisYear         "This year"
```

### Status Indicators
```
common.loading          "Loading..."
common.error            "Error"
common.success          "Success"
common.warning          "Warning"
common.info             "Info"
common.noData           "No data"
common.emptyState       "No data to display"
```

## Forms Namespace (`forms.json`)

### Form Actions
```
forms.submit            "Submit"
forms.reset             "Reset"
```

### Form Attributes
```
forms.required          "Required"
forms.optional          "Optional"
forms.processing        "Processing..."
```

### Common Form Texts
```
forms.common.cancel         "Cancel"
forms.common.processing     "Processing..."
```

### Error Messages
```
forms.errors.formErrorTitle             "Form error"
forms.errors.formErrorDescription       "An error occurred while processing the form..."

forms.errors.required                   "This field is required"
forms.errors.invalid                    "Invalid input"
forms.errors.minLength                  "Minimum length is {min} characters"
forms.errors.maxLength                  "Maximum length is {max} characters"
forms.errors.min                        "Minimum value is {min}"
forms.errors.max                        "Maximum value is {max}"
forms.errors.email                      "Please enter a valid email address"
forms.errors.url                        "Please enter a valid URL"
forms.errors.pattern                    "Format does not match requirements"
```

### Input Placeholders
```
forms.placeholder.text                  "Enter text"
forms.placeholder.number                "Enter a number"
forms.placeholder.email                 "Enter your email"
forms.placeholder.password              "Enter your password"
forms.placeholder.search                "Search..."
forms.placeholder.select                "Select an option"
forms.placeholder.date                  "Select a date"
forms.placeholder.textarea              "Enter text here"
```

### Validation Messages
```
forms.validation.required               "This field is required"
forms.validation.invalid                "Invalid format"
forms.validation.tooShort               "Input too short"
forms.validation.tooLong                "Input too long"
forms.validation.invalidEmail           "Invalid email format"
forms.validation.invalidUrl             "Invalid URL format"
forms.validation.invalidNumber          "Invalid number format"
```

### Form Messages
```
forms.messages.success                  "Operation successful"
forms.messages.error                    "Operation failed"
forms.messages.saved                    "Saved successfully"
forms.messages.deleted                  "Deleted successfully"
forms.messages.loading                  "Processing..."
forms.messages.submit                   "Submitting..."
```

## Usage Patterns

### DataTable Component
```typescript
const t = useTranslations("ui");

// Show no data message
{data.length === 0 && <p>{t("common.noData")}</p>}

// Loading state
{loading && <div>{t("loading.description")}</div>}

// Table headers
<TableHead>{t("table.columns")}</TableHead>
<Button>{t("table.refresh")}</Button>
```

### Form Component
```typescript
const t = useTranslations("forms");
const tCommon = useTranslations("common");

// Input with placeholder
<input placeholder={t("placeholder.email")} />

// Validation error
{error && <span>{t("errors.required")}</span>}

// Submit button
<Button type="submit">{tCommon("submit")}</Button>

// Cancel button
<Button onClick={onCancel}>{tCommon("cancel")}</Button>
```

### Error Boundary
```typescript
const t = useTranslations("ui");

// Error title
<h3>{t("errorBoundary.title")}</h3>

// Error description
<p>{error?.message || t("errorBoundary.defaultDescription")}</p>

// Retry button
<Button>{t("common.retry")}</Button>
```

## Localization Notes by Language

### English (en)
- Standard professional English
- Clear and concise terminology
- Suitable for international business context

### Japanese (ja)
- Uses appropriate Japanese grammatical structures
- Technical terms in katakana
- Polite form suitable for professional interfaces

### Simplified Chinese (zh-CN)
- Mainland China standard terminology
- Clear and direct communication style
- Aligns with common technical community usage

### Traditional Chinese (zh-TW)
- Taiwan/Hong Kong character set
- Regional terminology alignment
- Professional and respectful tone

### Russian (ru)
- Full Russian language support
- Proper case and gender agreement
- Professional tone for business application

## Best Practices

1. **Always Use Translation Keys**: Never hardcode UI strings
   ```typescript
   // Good
   <p>{t("common.noData")}</p>

   // Avoid
   <p>No data available</p>
   ```

2. **Use Correct Namespace**: Choose the right namespace for context
   ```typescript
   // Use common for generic actions
   const tCommon = useTranslations("common");

   // Use forms for form-specific texts
   const tForms = useTranslations("forms");

   // Use ui for UI component states
   const tUI = useTranslations("ui");
   ```

3. **Handle Missing Keys Gracefully**: The i18n system will fallback to key name
   ```typescript
   // If key is missing, displays: "common.save"
   {tCommon("save")}
   ```

4. **Use Placeholders for Dynamic Content**: Format strings with placeholders
   ```typescript
   // Template has: "Minimum length is {min} characters"
   {t("errors.minLength", { min: 5 })}  // "Minimum length is 5 characters"
   ```

5. **Keep Keys Consistent**: Use the provided keys, don't create new ones
   - This ensures consistency across all locales
   - Prevents translation maintenance issues
   - Makes code reviews easier

## File Locations

```
/messages/en/ui.json          English UI texts
/messages/en/common.json      English common terms
/messages/en/forms.json       English form texts

/messages/ja/ui.json          Japanese UI texts
/messages/ja/common.json      Japanese common terms
/messages/ja/forms.json       Japanese form texts

/messages/ru/ui.json          Russian UI texts
/messages/ru/common.json      Russian common terms
/messages/ru/forms.json       Russian form texts

/messages/zh-CN/ui.json       Simplified Chinese UI texts
/messages/zh-CN/common.json   Simplified Chinese common terms
/messages/zh-CN/forms.json    Simplified Chinese form texts

/messages/zh-TW/ui.json       Traditional Chinese UI texts
/messages/zh-TW/common.json   Traditional Chinese common terms
/messages/zh-TW/forms.json    Traditional Chinese form texts
```

## Support & Maintenance

For questions or to request new translation keys:
1. Check this reference guide first
2. Verify the key exists in all 5 locales
3. Ensure consistent usage across components
4. Document any custom keys added to the codebase

---

**Last Updated**: 2024
**Version**: 1.0
**Maintenance**: Exclusive to UI component translations task

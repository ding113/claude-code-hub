/**
 * Shared utilities for batch edit components
 */

/**
 * Format a template string with values using ICU-style {placeholder} syntax
 */
export function formatMessage(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) =>
    Object.hasOwn(values, key) ? String(values[key]) : `{${key}}`
  );
}

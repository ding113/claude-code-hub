/**
 * Shared utilities for batch edit components
 */

import type { UserDisplay } from "@/types/user";

/**
 * Format a template string with values using ICU-style {placeholder} syntax
 */
export function formatMessage(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) =>
    Object.hasOwn(values, key) ? String(values[key]) : `{${key}}`
  );
}

export function buildSelectedKeysExportText(
  users: UserDisplay[],
  selectedKeyIds: ReadonlySet<number>
): string {
  const lines: string[] = [];

  for (const user of users) {
    for (const key of user.keys) {
      if (!selectedKeyIds.has(key.id)) continue;
      if (!key.fullKey) {
        throw new Error("missing-full-key");
      }
      lines.push(user.name, key.fullKey);
    }
  }

  return lines.join("\n");
}

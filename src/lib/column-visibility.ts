/**
 * Column visibility persistence utility
 *
 * Manages user preferences for table column visibility.
 * Uses localStorage with user ID scoping for persistence.
 */

const STORAGE_PREFIX = "claude-code-hub-columns";

/**
 * All toggleable column types across the application
 */
export type LogsTableColumn =
  | "user"
  | "key"
  | "sessionId"
  | "provider"
  | "tokens"
  | "cache"
  | "performance";

/**
 * Default visible columns (all visible by default)
 */
export const DEFAULT_VISIBLE_COLUMNS: LogsTableColumn[] = [
  "user",
  "key",
  "sessionId",
  "provider",
  "tokens",
  "cache",
  "performance",
];

/**
 * Columns that cannot be hidden (always visible)
 */
export const ALWAYS_VISIBLE_COLUMNS = ["time", "model", "cost", "status"] as const;

/**
 * Get the storage key for a specific user and table
 */
function getStorageKey(userId: number, tableId: string): string {
  return `${STORAGE_PREFIX}:${tableId}:${userId}`;
}

/**
 * Get hidden columns from localStorage
 *
 * @param userId - User ID for scoping
 * @param tableId - Table identifier (e.g., "usage-logs")
 * @returns Array of hidden column names
 */
export function getHiddenColumns(userId: number, tableId: string): LogsTableColumn[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const stored = localStorage.getItem(getStorageKey(userId, tableId));
    if (!stored) {
      return [];
    }
    const parsed = JSON.parse(stored) as LogsTableColumn[];
    // Validate that all items are valid column names
    return parsed.filter((col) => DEFAULT_VISIBLE_COLUMNS.includes(col));
  } catch {
    return [];
  }
}

/**
 * Get visible columns (inverse of hidden)
 *
 * @param userId - User ID for scoping
 * @param tableId - Table identifier
 * @returns Array of visible column names
 */
export function getVisibleColumns(userId: number, tableId: string): LogsTableColumn[] {
  const hidden = getHiddenColumns(userId, tableId);
  return DEFAULT_VISIBLE_COLUMNS.filter((col) => !hidden.includes(col));
}

/**
 * Set hidden columns in localStorage
 *
 * @param userId - User ID for scoping
 * @param tableId - Table identifier
 * @param hiddenColumns - Array of column names to hide
 */
export function setHiddenColumns(
  userId: number,
  tableId: string,
  hiddenColumns: LogsTableColumn[]
): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const key = getStorageKey(userId, tableId);
    if (hiddenColumns.length === 0) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, JSON.stringify(hiddenColumns));
    }
  } catch {
    // localStorage not available, silently fail
  }
}

/**
 * Toggle a single column's visibility
 *
 * @param userId - User ID for scoping
 * @param tableId - Table identifier
 * @param column - Column to toggle
 * @returns New array of hidden columns
 */
export function toggleColumn(
  userId: number,
  tableId: string,
  column: LogsTableColumn
): LogsTableColumn[] {
  const currentHidden = getHiddenColumns(userId, tableId);
  const isCurrentlyHidden = currentHidden.includes(column);

  const newHidden = isCurrentlyHidden
    ? currentHidden.filter((c) => c !== column)
    : [...currentHidden, column];

  setHiddenColumns(userId, tableId, newHidden);
  return newHidden;
}

/**
 * Reset all columns to visible
 *
 * @param userId - User ID for scoping
 * @param tableId - Table identifier
 */
export function resetColumns(userId: number, tableId: string): void {
  setHiddenColumns(userId, tableId, []);
}

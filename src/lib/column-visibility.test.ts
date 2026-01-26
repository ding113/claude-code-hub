import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  DEFAULT_VISIBLE_COLUMNS,
  getHiddenColumns,
  getVisibleColumns,
  resetColumns,
  setHiddenColumns,
  toggleColumn,
  type LogsTableColumn,
} from "./column-visibility";

// Mock localStorage
const mockStorage: Record<string, string> = {};
const mockLocalStorage = {
  getItem: vi.fn((key: string) => mockStorage[key] ?? null),
  setItem: vi.fn((key: string, value: string) => {
    mockStorage[key] = value;
  }),
  removeItem: vi.fn((key: string) => {
    delete mockStorage[key];
  }),
  clear: vi.fn(() => {
    for (const key of Object.keys(mockStorage)) {
      delete mockStorage[key];
    }
  }),
  length: 0,
  key: vi.fn(),
};

Object.defineProperty(globalThis, "localStorage", {
  value: mockLocalStorage,
  writable: true,
});

describe("column-visibility", () => {
  const userId = 123;
  const tableId = "usage-logs";
  const storageKey = `claude-code-hub-columns:${tableId}:${userId}`;

  beforeEach(() => {
    // Clear mock storage before each test
    for (const key of Object.keys(mockStorage)) {
      delete mockStorage[key];
    }
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getHiddenColumns", () => {
    test("returns empty array when no data stored", () => {
      const result = getHiddenColumns(userId, tableId);
      expect(result).toEqual([]);
    });

    test("returns stored hidden columns", () => {
      const hidden: LogsTableColumn[] = ["user", "key"];
      mockStorage[storageKey] = JSON.stringify(hidden);

      const result = getHiddenColumns(userId, tableId);
      expect(result).toEqual(hidden);
    });

    test("filters out invalid column names", () => {
      const stored = ["user", "invalid_column", "key"];
      mockStorage[storageKey] = JSON.stringify(stored);

      const result = getHiddenColumns(userId, tableId);
      expect(result).toEqual(["user", "key"]);
    });

    test("handles JSON parse errors gracefully", () => {
      mockStorage[storageKey] = "not-valid-json";

      const result = getHiddenColumns(userId, tableId);
      expect(result).toEqual([]);
    });

    test("scopes by user ID", () => {
      const user1Hidden: LogsTableColumn[] = ["user"];
      const user2Hidden: LogsTableColumn[] = ["provider", "tokens"];

      mockStorage[`claude-code-hub-columns:${tableId}:1`] = JSON.stringify(user1Hidden);
      mockStorage[`claude-code-hub-columns:${tableId}:2`] = JSON.stringify(user2Hidden);

      expect(getHiddenColumns(1, tableId)).toEqual(user1Hidden);
      expect(getHiddenColumns(2, tableId)).toEqual(user2Hidden);
    });

    test("scopes by table ID", () => {
      const table1Hidden: LogsTableColumn[] = ["user"];
      const table2Hidden: LogsTableColumn[] = ["provider"];

      mockStorage[`claude-code-hub-columns:table1:${userId}`] = JSON.stringify(table1Hidden);
      mockStorage[`claude-code-hub-columns:table2:${userId}`] = JSON.stringify(table2Hidden);

      expect(getHiddenColumns(userId, "table1")).toEqual(table1Hidden);
      expect(getHiddenColumns(userId, "table2")).toEqual(table2Hidden);
    });
  });

  describe("getVisibleColumns", () => {
    test("returns all columns when none hidden", () => {
      const result = getVisibleColumns(userId, tableId);
      expect(result).toEqual(DEFAULT_VISIBLE_COLUMNS);
    });

    test("excludes hidden columns", () => {
      const hidden: LogsTableColumn[] = ["user", "provider"];
      mockStorage[storageKey] = JSON.stringify(hidden);

      const result = getVisibleColumns(userId, tableId);
      expect(result).not.toContain("user");
      expect(result).not.toContain("provider");
      expect(result).toContain("key");
      expect(result).toContain("sessionId");
      expect(result).toContain("tokens");
    });
  });

  describe("setHiddenColumns", () => {
    test("stores hidden columns in localStorage", () => {
      const hidden: LogsTableColumn[] = ["user", "key"];
      setHiddenColumns(userId, tableId, hidden);

      expect(mockStorage[storageKey]).toBe(JSON.stringify(hidden));
    });

    test("removes storage key when array is empty", () => {
      // First set some hidden columns
      mockStorage[storageKey] = JSON.stringify(["user"]);

      // Then reset to empty
      setHiddenColumns(userId, tableId, []);

      expect(mockStorage[storageKey]).toBeUndefined();
    });

    test("handles localStorage errors gracefully", () => {
      mockLocalStorage.setItem.mockImplementationOnce(() => {
        throw new Error("QuotaExceededError");
      });

      // Should not throw
      expect(() => setHiddenColumns(userId, tableId, ["user"])).not.toThrow();
    });
  });

  describe("toggleColumn", () => {
    test("hides visible column", () => {
      const result = toggleColumn(userId, tableId, "user");

      expect(result).toContain("user");
      expect(getHiddenColumns(userId, tableId)).toContain("user");
    });

    test("shows hidden column", () => {
      // First hide the column
      setHiddenColumns(userId, tableId, ["user", "key"]);

      // Then toggle it back
      const result = toggleColumn(userId, tableId, "user");

      expect(result).not.toContain("user");
      expect(result).toContain("key");
      expect(getHiddenColumns(userId, tableId)).toEqual(["key"]);
    });

    test("returns updated hidden columns array", () => {
      const result1 = toggleColumn(userId, tableId, "user");
      expect(result1).toEqual(["user"]);

      const result2 = toggleColumn(userId, tableId, "provider");
      expect(result2).toEqual(["user", "provider"]);

      const result3 = toggleColumn(userId, tableId, "user");
      expect(result3).toEqual(["provider"]);
    });
  });

  describe("resetColumns", () => {
    test("removes all hidden columns", () => {
      // Set some hidden columns
      setHiddenColumns(userId, tableId, ["user", "key", "provider"]);
      expect(getHiddenColumns(userId, tableId)).toHaveLength(3);

      // Reset
      resetColumns(userId, tableId);

      expect(getHiddenColumns(userId, tableId)).toEqual([]);
      expect(mockStorage[storageKey]).toBeUndefined();
    });

    test("is idempotent when no columns hidden", () => {
      resetColumns(userId, tableId);
      resetColumns(userId, tableId);

      expect(getHiddenColumns(userId, tableId)).toEqual([]);
    });
  });

  describe("DEFAULT_VISIBLE_COLUMNS", () => {
    test("contains all expected toggleable columns", () => {
      expect(DEFAULT_VISIBLE_COLUMNS).toContain("user");
      expect(DEFAULT_VISIBLE_COLUMNS).toContain("key");
      expect(DEFAULT_VISIBLE_COLUMNS).toContain("sessionId");
      expect(DEFAULT_VISIBLE_COLUMNS).toContain("provider");
      expect(DEFAULT_VISIBLE_COLUMNS).toContain("tokens");
      expect(DEFAULT_VISIBLE_COLUMNS).toContain("cache");
      expect(DEFAULT_VISIBLE_COLUMNS).toContain("performance");
    });
  });
});

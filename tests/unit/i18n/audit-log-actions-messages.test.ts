import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const REPO_ROOT = process.cwd();
const LOCALES = ["en", "zh-CN", "zh-TW", "ja", "ru"] as const;

function walkFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      results.push(...walkFiles(fullPath));
    } else {
      results.push(fullPath);
    }
  }
  return results;
}

function getDirectDottedKeys(record: Record<string, unknown>): string[] {
  const dotted: string[] = [];
  for (const [key, value] of Object.entries(record)) {
    if (key.includes(".")) {
      dotted.push(key);
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      dotted.push(...getDirectDottedKeys(value as Record<string, unknown>));
    }
  }
  return dotted;
}

function flattenLeafKeys(record: Record<string, unknown>, prefix = ""): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(record)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      keys.push(...flattenLeafKeys(value as Record<string, unknown>, fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys;
}

function collectEmittedAuditActionTypes(): string[] {
  const srcRoot = path.join(REPO_ROOT, "src");
  const files = walkFiles(srcRoot).filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"));
  const actions = new Set<string>();

  const patterns = [
    /emitActionAudit\(\s*\{[\s\S]*?action:\s*"([^"]+)"/g,
    /createAuditLogAsync\(\s*\{[\s\S]*?actionType:\s*"([^"]+)"/g,
  ];

  for (const file of files) {
    const content = readFileSync(file, "utf8");
    for (const pattern of patterns) {
      let match: RegExpExecArray | null;
      pattern.lastIndex = 0;
      while ((match = pattern.exec(content)) !== null) {
        actions.add(match[1]);
      }
    }
  }

  return [...actions].sort();
}

function readLocaleActionTree(locale: (typeof LOCALES)[number]): Record<string, unknown> {
  const file = path.join(REPO_ROOT, "messages", locale, "auditLogs.json");
  const parsed = JSON.parse(readFileSync(file, "utf8")) as { actions: Record<string, unknown> };
  return parsed.actions;
}

describe("audit log action messages", () => {
  test("store actions in nested objects instead of dotted leaf keys", () => {
    for (const locale of LOCALES) {
      const dottedKeys = getDirectDottedKeys(readLocaleActionTree(locale));
      expect(dottedKeys, `${locale} should not contain dotted direct keys under actions`).toEqual(
        []
      );
    }
  });

  test("stay in sync across locales and cover every emitted audit action type", () => {
    const canonicalKeys = flattenLeafKeys(readLocaleActionTree("en")).sort();
    const emittedKeys = collectEmittedAuditActionTypes();

    expect(canonicalKeys).toEqual(emittedKeys);

    for (const locale of LOCALES) {
      expect(
        flattenLeafKeys(readLocaleActionTree(locale)).sort(),
        `${locale} action keys drifted`
      ).toEqual(canonicalKeys);
    }
  });
});

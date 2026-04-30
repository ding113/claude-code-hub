import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  CLIENT_ACTION_IMPORT_ALLOWLIST,
  getClientActionImportOwner,
} from "@/lib/api/v1/action-migration-matrix";

const scannedRoots = ["src/app", "src/components/customs", "src/hooks", "src/lib"];
const sourceExtensions = new Set([".ts", ".tsx"]);
const actionImportPattern = /from\s+["']@\/actions\/([^"']+)["']/;

function walkFiles(root: string): string[] {
  const absoluteRoot = path.join(process.cwd(), root);
  const result: string[] = [];
  const stack = [absoluteRoot];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    const stat = statSync(current);
    if (stat.isDirectory()) {
      for (const child of readdirSync(current)) {
        if (child === "node_modules" || child === ".next") continue;
        stack.push(path.join(current, child));
      }
      continue;
    }

    if (sourceExtensions.has(path.extname(current))) {
      result.push(current);
    }
  }

  return result.sort();
}

function hasUseClientDirective(source: string): boolean {
  const trimmed = source.trimStart();
  return trimmed.startsWith('"use client"') || trimmed.startsWith("'use client'");
}

describe("client-side action import inventory", () => {
  test("all allowlist entries have explicit owning migration tasks", () => {
    for (const entry of CLIENT_ACTION_IMPORT_ALLOWLIST) {
      expect([15, 16, 17, 18]).toContain(entry.ownerTask);
      expect(entry.reason.length).toBeGreaterThan(10);
    }
  });

  test("inventories current client action imports by migration owner", () => {
    const unownedImports: string[] = [];
    const seenOwnedImports: string[] = [];

    for (const root of scannedRoots) {
      for (const filePath of walkFiles(root)) {
        const source = readFileSync(filePath, "utf8");
        if (!hasUseClientDirective(source)) continue;

        for (const line of source.split(/\r?\n/)) {
          if (/^\s*import\s+type\s+/.test(line)) continue;
          const match = actionImportPattern.exec(line);
          if (!match) continue;
          const module = match[1].split("/")[0];
          const owner = getClientActionImportOwner(module);
          const relativePath = path.relative(process.cwd(), filePath);
          if (!owner) {
            unownedImports.push(`${relativePath} -> ${module}`);
            continue;
          }
          seenOwnedImports.push(`${relativePath} -> ${module} -> task-${owner.ownerTask}`);
        }
      }
    }

    expect(unownedImports).toEqual([]);
    expect(seenOwnedImports.length).toBeGreaterThanOrEqual(0);
  });
});

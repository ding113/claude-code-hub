import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, test } from "vitest";

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      return walk(fullPath);
    }
    return /\.(ts|tsx)$/.test(entry.name) ? [fullPath] : [];
  });
}

function isRouteOrServerChromeFile(filePath: string): boolean {
  const fileName = basename(filePath);

  return (
    fileName === "page.tsx" ||
    fileName === "layout.tsx" ||
    filePath.endsWith("dashboard-header.tsx") ||
    filePath.endsWith("dashboard-sections.tsx") ||
    filePath.endsWith("settings/_lib/nav-items.ts")
  );
}

describe("locale server translations", () => {
  test("route pages and server chrome pass locale explicitly to getTranslations", () => {
    const files = walk("src/app/[locale]").filter(isRouteOrServerChromeFile);
    const violations = files.flatMap((file) => {
      const content = readFileSync(file, "utf8");
      return content
        .split("\n")
        .map((line, index) => ({ line, lineNumber: index + 1 }))
        .filter(({ line }) => /getTranslations\(\s*["']/.test(line))
        .map(({ line, lineNumber }) => `${file}:${lineNumber}: ${line.trim()}`);
    });

    expect(violations).toEqual([]);
  });
});

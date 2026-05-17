import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const scannedRoots = ["src/app", "src/components", "src/hooks", "src/lib"];
const sourceExtensions = new Set([".ts", ".tsx"]);
const staticActionImportPattern = /import\s+(?!type\b)[^;]*?\s+from\s+["']@\/actions\/[^"']+["']/g;
const dynamicActionImportPattern = /import\s*\(\s*["']@\/actions\/[^"']+["']\s*\)/g;
const staticImportPattern =
  /import\s+(?!type\b)(?:[^;]*?\s+from\s+)?["']([^"']+)["']|export\s+(?!type\b)[^;]*?\s+from\s+["']([^"']+)["']/g;
const dynamicImportPattern = /import\s*\(\s*["']([^"']+)["']\s*\)/g;

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

function lineNumberFor(source: string, index: number): number {
  return source.slice(0, index).split(/\r?\n/).length;
}

describe("client-side action import strict gate", () => {
  test("'use client' files do not import legacy server actions", () => {
    const violations: string[] = [];

    for (const root of scannedRoots) {
      for (const filePath of walkFiles(root)) {
        const source = readFileSync(filePath, "utf8");
        if (!hasUseClientDirective(source)) continue;

        const relativePath = path.relative(process.cwd(), filePath);
        for (const pattern of [staticActionImportPattern, dynamicActionImportPattern]) {
          pattern.lastIndex = 0;
          for (const match of source.matchAll(pattern)) {
            const line = lineNumberFor(source, match.index ?? 0);
            violations.push(`${relativePath}:${line} -> ${match[0].replace(/\s+/g, " ")}`);
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  test("client import graph does not reach legacy server actions indirectly", () => {
    const sourceCache = new Map<string, string>();
    const fileSet = new Set(scannedRoots.flatMap(walkFiles));
    const violations: string[] = [];

    for (const filePath of fileSet) {
      const source = readSource(filePath, sourceCache);
      if (!hasUseClientDirective(source)) continue;

      const reachable = collectReachableFiles(filePath, fileSet, sourceCache);
      for (const reachableFile of reachable) {
        const reachableSource = readSource(reachableFile, sourceCache);
        const relativePath = path.relative(process.cwd(), reachableFile);
        for (const violation of findRuntimeActionImports(reachableSource)) {
          violations.push(
            `${path.relative(process.cwd(), filePath)} -> ${relativePath}:${violation.line} -> ${
              violation.importText
            }`
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

function readSource(filePath: string, sourceCache: Map<string, string>): string {
  const cached = sourceCache.get(filePath);
  if (cached !== undefined) return cached;
  const source = readFileSync(filePath, "utf8");
  sourceCache.set(filePath, source);
  return source;
}

function collectReachableFiles(
  entryFile: string,
  fileSet: Set<string>,
  sourceCache: Map<string, string>
): Set<string> {
  const visited = new Set<string>();
  const stack = [entryFile];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || visited.has(current)) continue;
    visited.add(current);

    const source = readSource(current, sourceCache);
    for (const specifier of parseRuntimeImportSpecifiers(source)) {
      const resolved = resolveSourceFile(current, specifier, fileSet);
      if (resolved && !visited.has(resolved)) {
        stack.push(resolved);
      }
    }
  }

  return visited;
}

function parseRuntimeImportSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  for (const pattern of [staticImportPattern, dynamicImportPattern]) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1] ?? match[2];
      if (specifier) specifiers.push(specifier);
    }
  }
  return specifiers;
}

function resolveSourceFile(
  fromFile: string,
  specifier: string,
  fileSet: Set<string>
): string | null {
  if (!specifier.startsWith("@/") && !specifier.startsWith(".")) return null;
  const basePath = specifier.startsWith("@/")
    ? path.join(process.cwd(), "src", specifier.slice(2))
    : path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    path.join(basePath, "index.ts"),
    path.join(basePath, "index.tsx"),
  ];
  return candidates.find((candidate) => fileSet.has(candidate)) ?? null;
}

function findRuntimeActionImports(source: string): Array<{ importText: string; line: number }> {
  const violations: Array<{ importText: string; line: number }> = [];
  for (const pattern of [staticActionImportPattern, dynamicActionImportPattern]) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) {
      const importText = match[0].replace(/\s+/g, " ");
      if (importText.startsWith("import type ")) continue;
      violations.push({
        importText,
        line: lineNumberFor(source, match.index ?? 0),
      });
    }
  }
  return violations;
}

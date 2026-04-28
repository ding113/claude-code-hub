/**
 * Static gate: prevent new client-side imports of `src/actions/*`.
 *
 * Inventory mode (Task 1):
 *  - Walks `src/app/[locale]/**`, `src/components/**`, `src/lib/hooks/**`,
 *    and `src/hooks/**` to find files whose first non-blank, non-comment
 *    statement is the directive `'use client'`.
 *  - For each such client file, every `from "@/actions/<module>"` import
 *    must be present in `clientActionImportAllowlist` keyed to a Wave 4
 *    task (15 / 16 / 17 / 18).
 *  - Server-side route handlers and server-only modules (no `'use client'`
 *    directive) are not inspected; they are allowed to import actions.
 *
 * Removal cadence:
 *  - Tasks 15 / 16 / 17 / 18 must REMOVE entries from
 *    `clientActionImportAllowlist` as each domain migrates to `/api/v1`.
 *  - At the end of Task 18 the allowlist must be empty.
 *
 * The gate fails when:
 *  - A client file imports `@/actions/*` but the (file, module) pair is
 *    NOT in the allowlist (new unlisted coupling).
 *  - The allowlist contains a stale entry whose file no longer exists or
 *    no longer imports that module (orphan).
 *  - The allowlist contains duplicate (file, module) pairs.
 *  - An entry references a module that does not exist as
 *    `src/actions/<module>.ts`.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  type AllowlistTask,
  type ClientActionImportEntry,
  clientActionImportAllowlist,
} from "./client-action-import-allowlist";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(__dirname, "../../..");
const ACTIONS_DIR = path.resolve(REPO_ROOT, "src/actions");

const SCAN_ROOTS: readonly string[] = [
  "src/app/[locale]",
  "src/components",
  "src/lib/hooks",
  "src/hooks",
];

const ALLOWED_TASKS: ReadonlySet<AllowlistTask> = new Set<AllowlistTask>([15, 16, 17, 18]);

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

// ---------------------------------------------------------------------------
// File system walking
// ---------------------------------------------------------------------------

function walk(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const full = path.join(dir, name);
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walk(full, out);
      continue;
    }
    if (!st.isFile()) continue;
    const ext = path.extname(name);
    if (!SOURCE_EXTENSIONS.has(ext)) continue;
    out.push(full);
  }
}

function listScanFiles(): string[] {
  const out: string[] = [];
  for (const r of SCAN_ROOTS) {
    walk(path.resolve(REPO_ROOT, r), out);
  }
  return out;
}

// ---------------------------------------------------------------------------
// First-directive detection
// ---------------------------------------------------------------------------

/**
 * Returns the first directive string at the top of the file (e.g.
 * `"use client"` or `"use server"`), or `null` if there is none.
 *
 * Skips:
 *  - shebang line
 *  - leading whitespace
 *  - // line comments
 *  - / * block comments * /
 */
function firstDirective(source: string): string | null {
  let s = source;
  if (s.startsWith("#!")) {
    const nl = s.indexOf("\n");
    s = nl < 0 ? "" : s.slice(nl + 1);
  }
  let i = 0;
  const n = s.length;
  while (i < n) {
    while (i < n && /\s/.test(s[i])) i++;
    if (i >= n) return null;
    if (s[i] === "/" && s[i + 1] === "/") {
      const nl = s.indexOf("\n", i);
      if (nl < 0) return null;
      i = nl + 1;
      continue;
    }
    if (s[i] === "/" && s[i + 1] === "*") {
      const end = s.indexOf("*/", i + 2);
      if (end < 0) return null;
      i = end + 2;
      continue;
    }
    break;
  }
  if (i >= n) return null;
  const quote = s[i];
  if (quote !== '"' && quote !== "'") return null;
  // Walk forward to matching quote, allowing simple escape \"
  let j = i + 1;
  while (j < n) {
    if (s[j] === "\\") {
      j += 2;
      continue;
    }
    if (s[j] === quote) break;
    j++;
  }
  if (j >= n) return null;
  return s.slice(i + 1, j);
}

// ---------------------------------------------------------------------------
// Action import detection
// ---------------------------------------------------------------------------

/**
 * Returns the deduplicated list of `@/actions/<module>` slugs imported by
 * the given source. Captures both:
 *  - `import ... from "@/actions/foo"` and `from "@/actions/foo/bar"`
 *  - `import("@/actions/foo")` dynamic imports
 */
function findActionImports(source: string): string[] {
  const re = /(?:from|import)\s*\(?\s*["']@\/actions\/([\w\-./]+)["']/g;
  const out = new Set<string>();
  for (const m of source.matchAll(re)) {
    const segment = m[1].split("/")[0];
    if (segment) out.add(segment);
  }
  return [...out].sort();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toRepoRelative(absolute: string): string {
  return path.relative(REPO_ROOT, absolute).split(path.sep).join("/");
}

function actionModuleExists(slug: string): boolean {
  try {
    const st = statSync(path.join(ACTIONS_DIR, `${slug}.ts`));
    return st.isFile();
  } catch {
    return false;
  }
}

interface DiscoveredImport {
  file: string;
  module: string;
}

function scanClientImports(): DiscoveredImport[] {
  const files = listScanFiles();
  const out: DiscoveredImport[] = [];
  for (const file of files) {
    let source: string;
    try {
      source = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const directive = firstDirective(source);
    if (directive !== "use client") continue;

    const modules = findActionImports(source);
    if (modules.length === 0) continue;

    const rel = toRepoRelative(file);
    for (const module of modules) {
      out.push({ file: rel, module });
    }
  }
  return out;
}

function pairKey(file: string, module: string): string {
  return `${file}::${module}`;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("clientActionImportAllowlist self-validation", () => {
  test("each entry has a recognized task number 15/16/17/18", () => {
    for (const entry of clientActionImportAllowlist) {
      expect(
        ALLOWED_TASKS.has(entry.task),
        `Entry ${pairKey(entry.file, entry.module)} has invalid task ${entry.task}`
      ).toBe(true);
    }
  });

  test("each entry uses forward-slash file paths", () => {
    for (const entry of clientActionImportAllowlist) {
      expect(entry.file.includes("\\"), `Backslash in path: ${entry.file}`).toBe(false);
    }
  });

  test("each entry references an existing src/actions/<module>.ts", () => {
    for (const entry of clientActionImportAllowlist) {
      expect(
        actionModuleExists(entry.module),
        `Allowlist entry ${pairKey(entry.file, entry.module)} references unknown module`
      ).toBe(true);
    }
  });

  test("no duplicate (file, module) pairs", () => {
    const seen = new Map<string, ClientActionImportEntry>();
    const dups: string[] = [];
    for (const entry of clientActionImportAllowlist) {
      const key = pairKey(entry.file, entry.module);
      if (seen.has(key)) dups.push(key);
      seen.set(key, entry);
    }
    expect(dups, `Duplicate allowlist entries: ${dups.join(", ")}`).toEqual([]);
  });
});

describe("client-side action import inventory gate", () => {
  const discovered = scanClientImports();
  const allowSet = new Set(clientActionImportAllowlist.map((e) => pairKey(e.file, e.module)));

  test("scan finds at least one client->action coupling (sanity)", () => {
    expect(discovered.length).toBeGreaterThan(0);
  });

  test("every discovered (file, module) pair is in the allowlist", () => {
    const unlisted = discovered
      .filter((d) => !allowSet.has(pairKey(d.file, d.module)))
      .map((d) => pairKey(d.file, d.module))
      .sort();
    expect(
      unlisted,
      `Unlisted client->action imports detected. Add them to clientActionImportAllowlist with a Wave 4 task number, or remove the import:\n${unlisted.join("\n")}`
    ).toEqual([]);
  });

  test("no orphan allowlist entries: every entry corresponds to a real client import", () => {
    const discoveredKeys = new Set(discovered.map((d) => pairKey(d.file, d.module)));
    const orphans = clientActionImportAllowlist
      .map((e) => pairKey(e.file, e.module))
      .filter((k) => !discoveredKeys.has(k))
      .sort();
    expect(
      orphans,
      `Stale allowlist entries (file no longer imports module). Remove them:\n${orphans.join("\n")}`
    ).toEqual([]);
  });

  test("server-only files importing actions are not inspected (negative control)", () => {
    // The scanner only walks SCAN_ROOTS plus filters by 'use client'. Pick
    // a known server-only file (any action module itself) and ensure it
    // does not appear in the discovered set.
    const knownServer = "src/actions/users.ts";
    const matches = discovered.filter((d) => d.file === knownServer);
    expect(matches).toEqual([]);
  });
});

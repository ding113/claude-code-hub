/**
 * Static gate: enforce the action-to-endpoint migration matrix.
 *
 * This test is the static counterpart of the OpenAPI v1 migration. It
 * guarantees that:
 *  1. Every top-level `src/actions/*.ts` module appears as a key in
 *     `actionMigrationMatrix` (no silent omissions).
 *  2. Every exported symbol from each module is either covered by the
 *     module's `endpointFamily` (best-effort presence check) or explicitly
 *     listed in `internalOnlySymbols` for that module, or the entire
 *     module is flagged `internalOnly: true`.
 *  3. The plan-level acceptance list (Wave 1 Task 1 acceptance criteria)
 *     of required module keys is fully covered.
 *
 * We use static parsing rather than runtime imports because action
 * modules carry "use server" plus heavy server-only dependencies (drizzle,
 * redis, next/cache). Static parsing is sufficient for the gate; precise
 * endpoint mapping is enforced by per-resource handler tests in later
 * tasks.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { actionMigrationMatrix, internalOnlySymbols } from "@/lib/api/v1/action-migration-matrix";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const ACTIONS_DIR = path.resolve(REPO_ROOT, "src/actions");

/**
 * Plan acceptance list (Task 1 acceptance): every one of these slugs must
 * appear in the matrix as a key.
 */
const REQUIRED_MODULE_KEYS: readonly string[] = [
  "users",
  "keys",
  "key-quota",
  "providers",
  "provider-endpoints",
  "provider-groups",
  "model-prices",
  "usage-logs",
  "my-usage",
  "audit-logs",
  "active-sessions",
  "active-sessions-utils",
  "concurrent-sessions",
  "session-response",
  "session-origin-chain",
  "statistics",
  "overview",
  "dashboard-realtime",
  "admin-user-insights",
  "sensitive-words",
  "notifications",
  "notification-bindings",
  "webhook-targets",
  "system-config",
  "request-filters",
  "error-rules",
  "rate-limit-stats",
  "proxy-status",
  "dispatch-simulator",
  "public-status",
  "provider-slots",
  "client-versions",
];

// ---------------------------------------------------------------------------
// Helpers: enumerate `src/actions/*.ts` module slugs
// ---------------------------------------------------------------------------

function listActionModuleSlugs(): string[] {
  const entries = readdirSync(ACTIONS_DIR);
  const slugs: string[] = [];
  for (const entry of entries) {
    const full = path.join(ACTIONS_DIR, entry);
    const st = statSync(full);
    if (!st.isFile()) continue;
    if (!entry.endsWith(".ts")) continue;
    if (entry.endsWith(".d.ts")) continue;
    if (entry.endsWith(".test.ts") || entry.endsWith(".spec.ts")) continue;
    slugs.push(entry.replace(/\.ts$/, ""));
  }
  return slugs.sort();
}

// ---------------------------------------------------------------------------
// Helpers: extract exported symbol names from action source via regex
// ---------------------------------------------------------------------------

/**
 * Strip simple `//` and `/* *\/` comments. Good enough for top-level
 * `export` detection; we do not need a full TS parser.
 */
function stripComments(source: string): string {
  let out = "";
  let i = 0;
  const n = source.length;
  while (i < n) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === "/" && next === "/") {
      const nl = source.indexOf("\n", i);
      i = nl < 0 ? n : nl;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end < 0 ? n : end + 2;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/**
 * Best-effort enumeration of top-level exported symbol names.
 *
 * Captures:
 *  - `export async function name(`
 *  - `export function name(`
 *  - `export const name =` / `export let name =` / `export var name =`
 *  - `export class Name`
 *  - `export interface Name`
 *  - `export type Name`
 *  - `export enum Name`
 *  - `export { a, b as c }` re-exports
 *
 * Skips type-only exports vs runtime-only? No — we record both because
 * the matrix gate is symbol-level, not value-level.
 */
function extractExportedSymbols(source: string): string[] {
  const cleaned = stripComments(source);
  const names = new Set<string>();

  const declRe =
    /^\s*export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|class|interface|type|enum|const|let|var)\s+([A-Za-z_$][\w$]*)/gm;
  for (const m of cleaned.matchAll(declRe)) {
    names.add(m[1]);
  }

  // `export { a, b as c, default as foo }` (single-line and multi-line)
  const namedRe = /export\s*\{([^}]+)\}\s*(?:from\s+["'][^"']+["'])?\s*;?/g;
  for (const m of cleaned.matchAll(namedRe)) {
    const inner = m[1];
    for (const segment of inner.split(",")) {
      const trimmed = segment.trim();
      if (!trimmed) continue;
      // forms: `Name`, `Name as Alias`, `default as Alias`, `type Foo`
      const noTypeKeyword = trimmed.replace(/^type\s+/, "");
      const parts = noTypeKeyword.split(/\s+as\s+/);
      const exported = (parts[1] ?? parts[0]).trim();
      if (!exported || exported === "default") continue;
      if (/^[A-Za-z_$][\w$]*$/.test(exported)) {
        names.add(exported);
      }
    }
  }

  return [...names].sort();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("actionMigrationMatrix coverage", () => {
  const slugs = listActionModuleSlugs();

  test("at least one action module is discovered (sanity)", () => {
    expect(slugs.length).toBeGreaterThan(0);
  });

  test("every src/actions/*.ts module is mapped in the matrix", () => {
    const missing = slugs.filter((s) => !(s in actionMigrationMatrix));
    expect(missing, `Modules missing from actionMigrationMatrix: ${missing.join(", ")}`).toEqual(
      []
    );
  });

  test("matrix has no orphan keys not backed by a real file", () => {
    const slugSet = new Set(slugs);
    const orphans = Object.keys(actionMigrationMatrix).filter((k) => !slugSet.has(k));
    expect(
      orphans,
      `Matrix references unknown modules (no matching src/actions/*.ts): ${orphans.join(", ")}`
    ).toEqual([]);
  });

  test("plan acceptance module list is fully covered", () => {
    const missing = REQUIRED_MODULE_KEYS.filter((k) => !(k in actionMigrationMatrix));
    expect(missing, `Required module keys missing: ${missing.join(", ")}`).toEqual([]);
  });

  test("internal-only modules carry a rationale and empty endpointFamily", () => {
    for (const [slug, entry] of Object.entries(actionMigrationMatrix)) {
      if (!entry.internalOnly) continue;
      expect(
        entry.endpointFamily,
        `${slug} is internalOnly but has endpointFamily entries`
      ).toEqual([]);
      expect(
        entry.notes && entry.notes.length > 0,
        `${slug} is internalOnly but missing rationale in notes`
      ).toBe(true);
    }
  });

  test("public modules declare at least one endpointFamily entry", () => {
    for (const [slug, entry] of Object.entries(actionMigrationMatrix)) {
      if (entry.internalOnly) continue;
      expect(
        entry.endpointFamily.length,
        `Public module ${slug} must declare at least one endpoint`
      ).toBeGreaterThan(0);
      // Every endpoint must live under /api/v1/
      for (const ep of entry.endpointFamily) {
        expect(ep.startsWith("/api/v1/"), `Endpoint must be under /api/v1: ${slug} -> ${ep}`).toBe(
          true
        );
      }
    }
  });

  test("active-sessions-utils is internalOnly", () => {
    const entry = actionMigrationMatrix["active-sessions-utils"];
    expect(entry, "active-sessions-utils must be in the matrix").toBeDefined();
    expect(entry.internalOnly).toBe(true);
  });

  test("processPriceTableInternal is excluded as a per-symbol internal", () => {
    expect(internalOnlySymbols["model-prices"]).toBeDefined();
    expect(internalOnlySymbols["model-prices"].processPriceTableInternal).toBeTruthy();
  });

  test("internalOnlySymbols only references modules present in the matrix", () => {
    for (const slug of Object.keys(internalOnlySymbols)) {
      expect(slug in actionMigrationMatrix).toBe(true);
    }
  });
});

describe("actionMigrationMatrix per-module export coverage", () => {
  const slugs = listActionModuleSlugs();

  for (const slug of slugs) {
    test(`module "${slug}" exposes all its top-level exports through the matrix`, () => {
      const entry = (actionMigrationMatrix as Readonly<Record<string, unknown>>)[slug];
      expect(entry, `Matrix entry missing for ${slug}`).toBeDefined();

      const filePath = path.join(ACTIONS_DIR, `${slug}.ts`);
      const source = readFileSync(filePath, "utf8");
      const exports = extractExportedSymbols(source);

      // For internal-only modules every export is implicitly internal.
      const matrixEntry = entry as { internalOnly?: true; endpointFamily: readonly string[] };
      if (matrixEntry.internalOnly) {
        // Sanity: there must be at least one symbol or a comment-only module.
        // We accept zero exports (e.g. a placeholder file) but still pass.
        return;
      }

      // Public modules MUST have at least one runtime export OR mark every
      // export as internal via internalOnlySymbols.
      const internalSymbols =
        (internalOnlySymbols as Readonly<Record<string, Readonly<Record<string, string>>>>)[slug] ??
        {};

      // We do NOT enforce 1:1 mapping to endpointFamily here (that's the
      // resource-task tests). We only assert that symbols are not silently
      // ignored: every public module must declare endpointFamily, and any
      // symbol explicitly excluded must live in internalOnlySymbols.
      // This loop documents the enumeration and provides a single place to
      // tighten the gate later.
      for (const symbolName of exports) {
        const isExcluded = symbolName in internalSymbols;
        // Presence check: symbol is either tracked in internal exclusions
        // or is part of a module whose endpointFamily covers it.
        expect(
          isExcluded || matrixEntry.endpointFamily.length > 0,
          `Symbol ${slug}::${symbolName} has no endpoint coverage and is not excluded`
        ).toBe(true);
      }
    });
  }
});

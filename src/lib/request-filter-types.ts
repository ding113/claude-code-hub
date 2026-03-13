/**
 * Operation DSL types for advanced request filter mode.
 *
 * Advanced mode replaces the simple scope/action/target/replacement fields
 * with a sequential array of typed operations that can manipulate headers
 * and body in more expressive ways (insert with dedup, deep merge, etc.).
 */

// ---------------------------------------------------------------------------
// Matcher: used by insert (anchor/dedupe) and remove (array element matching)
// ---------------------------------------------------------------------------

export interface FilterMatcher {
  /** Dot-path within array element; omit for scalar arrays */
  field?: string;
  /** Value to match against */
  value: unknown;
  /** Match strategy (default: "exact") */
  matchType?: "exact" | "contains" | "regex";
}

// ---------------------------------------------------------------------------
// Base
// ---------------------------------------------------------------------------

interface BaseOp {
  scope: "header" | "body";
}

// ---------------------------------------------------------------------------
// Set
// ---------------------------------------------------------------------------

export interface SetOp extends BaseOp {
  op: "set";
  /** Header name or body JSON path */
  path: string;
  value: unknown;
  /** default: "overwrite" */
  writeMode?: "overwrite" | "if_missing";
}

// ---------------------------------------------------------------------------
// Remove
// ---------------------------------------------------------------------------

export interface RemoveOp extends BaseOp {
  op: "remove";
  /** Header name or body JSON path */
  path: string;
  /** For array element removal by condition */
  matcher?: FilterMatcher;
}

// ---------------------------------------------------------------------------
// Merge (body only)
// ---------------------------------------------------------------------------

export interface MergeOp {
  op: "merge";
  /** Merge only operates on request body */
  scope: "body";
  /** Body JSON path to target object */
  path: string;
  /** Keys with null value -> delete; object value -> recursive merge; others -> overwrite */
  value: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Insert (body only)
// ---------------------------------------------------------------------------

export interface InsertOp {
  op: "insert";
  /** Insert only operates on request body */
  scope: "body";
  /** Body JSON path to target array */
  path: string;
  /** Item to insert */
  value: unknown;
  /** default: "end" */
  position?: "start" | "end" | "before" | "after";
  /** Required when position is "before" or "after" */
  anchor?: FilterMatcher;
  /** Fallback when anchor not found (default: "end") */
  onAnchorMissing?: "start" | "end" | "skip";
  dedupe?: {
    /** default: true */
    enabled?: boolean;
    /** Compare only these fields; default: deep compare entire element */
    byFields?: string[];
  };
}

// ---------------------------------------------------------------------------
// Union
// ---------------------------------------------------------------------------

export type FilterOperation = SetOp | RemoveOp | MergeOp | InsertOp;

import { JSONPath } from "jsonpath-plus";

function coerceNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const num = Number(trimmed);
    return Number.isFinite(num) ? num : null;
  }

  if (typeof value === "bigint") {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

  return null;
}

export function extractBalance(response: unknown, jsonpath: string): number {
  if (typeof jsonpath !== "string" || !jsonpath.trim()) {
    throw new Error("jsonpath must be a non-empty string");
  }

  let results: unknown;
  try {
    results = JSONPath({
      path: jsonpath,
      json: response as any,
      wrap: true,
      eval: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`JSONPath evaluation failed: ${message}`);
  }

  if (!Array.isArray(results)) {
    throw new Error("JSONPath result must be an array");
  }

  if (results.length === 0) {
    throw new Error("No match for JSONPath expression");
  }

  if (results.length > 1) {
    throw new Error("Multiple matches for JSONPath expression");
  }

  const num = coerceNumber(results[0]);
  if (num === null) {
    throw new Error("JSONPath match is not a numeric value");
  }

  return num;
}

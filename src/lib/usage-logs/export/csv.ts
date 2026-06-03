/**
 * CSV rendering for usage-logs exports. Numeric columns are normalized so Excel
 * parses them as numbers (see ./numeric), and timestamps are rendered in the
 * resolved system timezone (see ./format).
 */

import type { UsageLogRow } from "@/repository/usage-logs";
import { buildDetailHeaders, DETAIL_COLUMNS, isBlankValue } from "./columns";
import { formatExportTimestamp, isValidDate } from "./format";
import { normalizeDecimalForSpreadsheet } from "./numeric";

export const CSV_BOM = "﻿";

/**
 * Escape a CSV field, neutralizing spreadsheet formula injection. Mirrors the
 * historical behaviour: fields whose first non-whitespace char is one of
 * = + - @ are prefixed with a single quote.
 */
export function escapeCsvField(field: string): string {
  const dangerousChars = ["=", "+", "-", "@"];
  const trimmedField = field.trimStart();
  let safeField = field;
  if (trimmedField && dangerousChars.some((char) => trimmedField.startsWith(char))) {
    safeField = `'${field}`;
  }

  if (
    safeField.includes(",") ||
    safeField.includes('"') ||
    safeField.includes("\n") ||
    safeField.includes("\r")
  ) {
    return `"${safeField.replace(/"/g, '""')}"`;
  }
  return safeField;
}

function renderCsvCell(
  value: string | number | Date | null,
  column: (typeof DETAIL_COLUMNS)[number],
  timezone: string
): string {
  switch (column.kind) {
    case "datetime":
      return isValidDate(value) ? formatExportTimestamp(value, timezone) : "";
    case "number":
      if (isBlankValue(value) && !column.zeroWhenNull) {
        return "";
      }
      return normalizeDecimalForSpreadsheet(value as string | number | null);
    default:
      return escapeCsvField(typeof value === "string" ? value : String(value ?? ""));
  }
}

/** The CSV header row (comma-joined), with the timezone annotation. */
export function buildCsvHeaderLine(timezone: string): string {
  return buildDetailHeaders(timezone).map(escapeCsvField).join(",");
}

/** Render usage log rows as CSV data lines (no header, no BOM). */
export function buildCsvRows(logs: UsageLogRow[], timezone: string): string[] {
  return logs.map((log) =>
    DETAIL_COLUMNS.map((column) => renderCsvCell(column.get(log), column, timezone)).join(",")
  );
}

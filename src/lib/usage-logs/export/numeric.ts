/**
 * Numeric normalization for spreadsheet exports.
 *
 * Excel only keeps 15 significant digits. A `numeric(21, 15)` cost such as
 * `1.234567890123456` (16 significant digits) is therefore imported as *text*,
 * which breaks SUM() and other math. Values < 1 (e.g. `0.000123...`) have fewer
 * significant digits and slip under the ceiling, which is why only some rows
 * misbehaved. Normalizing every numeric value to <=15 significant digits, plain
 * decimal notation, with trailing zeros trimmed keeps Excel treating them as
 * numbers.
 */

const SPREADSHEET_NUMBER_FORMATTER = new Intl.NumberFormat("en-US", {
  maximumSignificantDigits: 15,
  useGrouping: false,
});

/**
 * Coerce a DB numeric string (or number) into a finite number, or null when the
 * input is empty, nullish, or not a finite number.
 */
export function toFiniteNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed === "") {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Render a decimal value as an Excel-safe numeric literal: at most 15
 * significant digits, plain decimal notation (never scientific), trailing zeros
 * stripped. Non-finite / empty / nullish inputs collapse to "0".
 */
export function normalizeDecimalForSpreadsheet(value: string | number | null | undefined): string {
  const parsed = toFiniteNumber(value);
  if (parsed === null) {
    return "0";
  }
  return SPREADSHEET_NUMBER_FORMATTER.format(parsed);
}

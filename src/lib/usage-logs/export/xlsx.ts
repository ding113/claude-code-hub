/**
 * Minimal, dependency-light XLSX writer for usage-logs exports.
 *
 * Why hand-rolled: we only need to emit two simple worksheets with correctly
 * typed numeric / date cells. A purpose-built writer (on top of the already
 * present `fflate` zip codec) keeps the cells genuinely numeric so Excel SUM()
 * works, renders timestamps as real Excel dates in the system timezone, and
 * avoids pulling in a heavy spreadsheet dependency tree.
 *
 * Workbook layout:
 *   Sheet 1 "Usage Logs"           - one row per request (mirrors the CSV)
 *   Sheet 2 "Daily/Hourly Summary" - aggregates (see ./summary)
 */

import { strToU8, zip } from "fflate";
import type { UsageLogRow } from "@/repository/usage-logs";
import {
  buildDetailHeaders,
  COST_NUM_FMT,
  DETAIL_COLUMNS,
  type DetailColumn,
  isBlankValue,
} from "./columns";
import { isValidDate, toExcelZonedDate } from "./format";
import { normalizeDecimalForSpreadsheet } from "./numeric";
import {
  createSummaryAccumulator,
  SUMMARY_HEADERS,
  type SummaryRow,
  type UsageLogsSummary,
} from "./summary";

// Cell style indices, matched 1:1 to the <cellXfs> entries in STYLES_XML below.
const STYLE = { text: 0, header: 1, datetime: 2, integer: 3, cost: 4 } as const;

// Spreadsheet column letters are invariant per column index, so precompute them
// once instead of recomputing inside every row.
const DETAIL_COLUMN_REFS = DETAIL_COLUMNS.map((_column, index) => columnRef(index));
const SUMMARY_COLUMN_REFS = SUMMARY_HEADERS.map((_header, index) => columnRef(index));

// Days between the Unix epoch (1970-01-01) and the Excel epoch (1899-12-30).
const EXCEL_EPOCH_OFFSET_DAYS = 25569;
const MS_PER_DAY = 86_400_000;
const SECONDS_PER_DAY = 86_400;

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&apos;";
    }
  });
}

// Keep only characters allowed by the XML 1.0 Char production, so a stray byte
// in a model/endpoint string (control bytes, unpaired surrogates, the U+FFFE /
// U+FFFF non-characters) cannot corrupt the whole workbook.
function stripIllegalXmlChars(value: string): string {
  let out = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (
      code === 0x09 ||
      code === 0x0a ||
      code === 0x0d ||
      (code >= 0x20 && code <= 0xd7ff) ||
      (code >= 0xe000 && code <= 0xfffd) ||
      (code >= 0x10000 && code <= 0x10ffff)
    ) {
      out += char;
    }
  }
  return out;
}

function sanitizeXmlText(value: string): string {
  return escapeXml(stripIllegalXmlChars(value));
}

/** Zero-based column index -> spreadsheet column letters (0 -> A, 26 -> AA). */
export function columnRef(index: number): string {
  let remaining = index + 1;
  let ref = "";
  while (remaining > 0) {
    const mod = (remaining - 1) % 26;
    ref = String.fromCharCode(65 + mod) + ref;
    remaining = Math.floor((remaining - 1) / 26);
  }
  return ref;
}

function excelSerial(date: Date): number {
  const serial = date.getTime() / MS_PER_DAY + EXCEL_EPOCH_OFFSET_DAYS;
  // Timestamps are whole seconds; snap to the second grid so binary-float
  // artifacts in the division cannot make Excel display the wrong second.
  return Math.round(serial * SECONDS_PER_DAY) / SECONDS_PER_DAY;
}

function textCell(ref: string, value: string, style: number): string {
  if (value === "") {
    return `<c r="${ref}" s="${style}"/>`;
  }
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${sanitizeXmlText(value)}</t></is></c>`;
}

function numberCell(ref: string, value: string | null, style: number): string {
  if (value === null) {
    return `<c r="${ref}" s="${style}"/>`;
  }
  return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
}

function dateCell(ref: string, date: Date): string {
  return `<c r="${ref}" s="${STYLE.datetime}"><v>${excelSerial(date)}</v></c>`;
}

// Only reached for number columns; cost gets the decimal format, the rest are integers.
function detailNumberStyle(column: DetailColumn): number {
  return column.numFmt === COST_NUM_FMT ? STYLE.cost : STYLE.integer;
}

function detailCell(column: DetailColumn, log: UsageLogRow, ref: string, timezone: string): string {
  const raw = column.get(log);
  if (column.kind === "datetime") {
    return isValidDate(raw) ? dateCell(ref, toExcelZonedDate(raw, timezone)) : `<c r="${ref}"/>`;
  }
  if (column.kind === "number") {
    if (isBlankValue(raw) && !column.zeroWhenNull) {
      return numberCell(ref, null, STYLE.integer);
    }
    return numberCell(
      ref,
      normalizeDecimalForSpreadsheet(raw as string | number | null),
      detailNumberStyle(column)
    );
  }
  return textCell(ref, typeof raw === "string" ? raw : String(raw ?? ""), STYLE.text);
}

function rowXml(rowNumber: number, cells: string[]): string {
  return `<row r="${rowNumber}">${cells.join("")}</row>`;
}

function headerRowXml(headers: string[], rowNumber: number, refs: string[]): string {
  const cells = headers.map((header, index) =>
    textCell(`${refs[index]}${rowNumber}`, header, STYLE.header)
  );
  return rowXml(rowNumber, cells);
}

function worksheetXml(rows: string[], columnCount: number): string {
  const lastCol = columnRef(columnCount - 1);
  const lastRow = Math.max(rows.length, 1);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${lastCol}${lastRow}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>${rows.join("")}</sheetData></worksheet>`;
}

/**
 * Render a single detail row's XML. `rowNumber` is 1-based (the header occupies
 * row 1). Exposed so callers can stream batches into the sheet without retaining
 * the whole result set in memory.
 */
export function buildDetailRowXml(log: UsageLogRow, rowNumber: number, timezone: string): string {
  const cells = DETAIL_COLUMNS.map((column, columnIndex) =>
    detailCell(column, log, `${DETAIL_COLUMN_REFS[columnIndex]}${rowNumber}`, timezone)
  );
  return rowXml(rowNumber, cells);
}

function detailSheetXml(detailRowsXml: string[], timezone: string): string {
  const rows = [
    headerRowXml(buildDetailHeaders(timezone), 1, DETAIL_COLUMN_REFS),
    ...detailRowsXml,
  ];
  return worksheetXml(rows, DETAIL_COLUMNS.length);
}

function summaryRowCells(row: SummaryRow, rowNumber: number, periodStyle: number): string[] {
  const integers = [
    row.requests,
    row.inputTokens,
    row.outputTokens,
    row.cacheWrite5m,
    row.cacheWrite1h,
    row.cacheRead,
    row.totalTokens,
  ];
  const cells = [textCell(`${SUMMARY_COLUMN_REFS[0]}${rowNumber}`, row.period, periodStyle)];
  integers.forEach((value, index) => {
    cells.push(
      numberCell(`${SUMMARY_COLUMN_REFS[index + 1]}${rowNumber}`, String(value), STYLE.integer)
    );
  });
  cells.push(
    numberCell(
      `${SUMMARY_COLUMN_REFS[8]}${rowNumber}`,
      normalizeDecimalForSpreadsheet(row.cost),
      STYLE.cost
    )
  );
  return cells;
}

function buildSummarySheet(summary: UsageLogsSummary): string {
  const rows = [headerRowXml([...SUMMARY_HEADERS], 1, SUMMARY_COLUMN_REFS)];
  summary.rows.forEach((row, index) => {
    rows.push(rowXml(index + 2, summaryRowCells(row, index + 2, STYLE.text)));
  });
  const totalRowNumber = summary.rows.length + 2;
  rows.push(rowXml(totalRowNumber, summaryRowCells(summary.total, totalRowNumber, STYLE.header)));
  return worksheetXml(rows, SUMMARY_HEADERS.length);
}

function summarySheetName(summary: UsageLogsSummary): string {
  return summary.granularity === "daily" ? "Daily Summary" : "Hourly Summary";
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy-mm-dd hh:mm:ss"/><numFmt numFmtId="165" formatCode="0.00######"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;

const ROOT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

const WORKBOOK_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

function workbookXml(summaryName: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Usage Logs" sheetId="1" r:id="rId1"/><sheet name="${escapeXml(summaryName)}" sheetId="2" r:id="rId2"/></sheets></workbook>`;
}

export interface XlsxParts {
  /** Pre-rendered detail row XML (one entry per data row, row numbers from 2). */
  detailRowsXml: string[];
  summary: UsageLogsSummary;
  timezone: string;
}

/**
 * Assemble an XLSX workbook (detail sheet + daily/hourly summary sheet) from
 * pre-rendered detail rows and an aggregated summary. Compression runs via
 * fflate's async zip so a large export does not block the event loop.
 */
export function assembleUsageLogsXlsx(parts: XlsxParts): Promise<Uint8Array> {
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(CONTENT_TYPES_XML),
    "_rels/.rels": strToU8(ROOT_RELS_XML),
    "xl/workbook.xml": strToU8(workbookXml(summarySheetName(parts.summary))),
    "xl/_rels/workbook.xml.rels": strToU8(WORKBOOK_RELS_XML),
    "xl/styles.xml": strToU8(STYLES_XML),
    "xl/worksheets/sheet1.xml": strToU8(detailSheetXml(parts.detailRowsXml, parts.timezone)),
    "xl/worksheets/sheet2.xml": strToU8(buildSummarySheet(parts.summary)),
  };
  return new Promise((resolve, reject) => {
    zip(files, { level: 6 }, (error, data) => (error ? reject(error) : resolve(data)));
  });
}

/**
 * Build an XLSX workbook for the given logs (convenience wrapper that holds all
 * rows in memory; the streaming export path uses buildDetailRowXml +
 * createSummaryAccumulator + assembleUsageLogsXlsx instead).
 */
export function buildUsageLogsXlsx(logs: UsageLogRow[], timezone: string): Promise<Uint8Array> {
  const accumulator = createSummaryAccumulator(timezone);
  const detailRowsXml = logs.map((log, index) => {
    accumulator.add(log);
    return buildDetailRowXml(log, index + 2, timezone);
  });
  return assembleUsageLogsXlsx({ detailRowsXml, summary: accumulator.finalize(), timezone });
}

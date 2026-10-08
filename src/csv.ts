/**
 * CSV export of scan rows. Semicolon-separated with a decimal comma, which is
 * what Spanish-locale Excel and most gestoría software import without a wizard.
 */
import type { ScanRow } from "./pipeline.js";

const COLUMNS: (keyof ScanRow)[] = [
  "path", "type", "status", "invoice_number", "issue_date", "issuer_tax_id", "recipient_tax_id",
  "base_amount", "vat_total", "irpf_amount", "total", "failed_checks",
];

function cell(value: ScanRow[keyof ScanRow]): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return value.toFixed(2).replace(".", ",");
  const s = Array.isArray(value) ? value.join(" | ") : String(value);
  // Neutralize spreadsheet formula injection from document text (CWE-1236).
  // Numbers never reach this branch, so no string gets an exemption.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[;"\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(rows: ScanRow[]): string {
  const header = COLUMNS.join(";");
  const body = rows.map((r) => COLUMNS.map((c) => cell(r[c])).join(";"));
  // BOM so Excel detects UTF-8 (accents in paths and names).
  return `\uFEFF${[header, ...body].join("\r\n")}\r\n`;
}

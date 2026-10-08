import { expect, it } from "vitest";
import { toCsv } from "./csv.js";
import type { ScanRow } from "./pipeline.js";

const row = (over: Partial<ScanRow>): ScanRow => ({
  path: "/x/a.pdf", type: "invoice", confidence: 1, status: "ok", invoice_number: "F-1", issue_date: "2026-07-01",
  issuer_tax_id: "B12345674", recipient_tax_id: null, base_amount: 1000, vat_total: 210, irpf_amount: null, total: 1210,
  failed_checks: [], ...over,
});

it("writes semicolon CSV with decimal comma and a UTF-8 BOM", () => {
  const csv = toCsv([row({})]);
  expect(csv.startsWith("\uFEFFpath;type;status")).toBe(true);
  expect(csv).toContain(";1000,00;210,00;;1210,00;");
});

it("quotes separators and neutralizes spreadsheet formulas", () => {
  const csv = toCsv([row({ invoice_number: "=HYPERLINK(\"http://x\")", failed_checks: ["a; b"] })]);
  expect(csv).toContain(`"'=HYPERLINK(""http://x"")"`);
  expect(csv).toContain(`"a; b"`);
});

it("keeps negative amounts numeric", () => {
  expect(toCsv([row({ total: -302.5 })])).toContain(";-302,50;");
});

it("neutralizes formulas that start with a digit-looking minus sign", () => {
  const csv = toCsv([row({ invoice_number: "-1+cmd|'/C calc'!A0" })]);
  expect(csv).toContain(";'-1+cmd|'/C calc'!A0;");
});

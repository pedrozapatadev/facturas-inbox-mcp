import { mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connect, INBOX, OWN_TAX_ID } from "./helpers.js";

let h: Awaited<ReturnType<typeof connect>>;
let scratch: string;

beforeAll(async () => {
  scratch = await mkdtemp(path.join(os.tmpdir(), "facturas-inbox-"));
  h = await connect([INBOX, scratch]);
});
afterAll(async () => {
  await h.close();
  await rm(scratch, { recursive: true, force: true });
});

describe("tool surface", () => {
  it("exposes six tools, each with annotations and an output schema", async () => {
    const { tools } = await h.client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["classify_document", "export_csv", "extract_invoice", "scan_folder", "validate_tax_id", "vat_summary"]);
    for (const t of tools) {
      expect(t.outputSchema, t.name).toBeDefined();
      expect(t.annotations?.openWorldHint, t.name).toBe(false);
      expect(t.annotations?.readOnlyHint, t.name).toBe(t.name !== "export_csv");
      expect(t.annotations?.destructiveHint, t.name).toBe(false);
    }
  });
});

describe("scan_folder", () => {
  it("triages the sample inbox", async () => {
    const { isError, data } = await h.call("scan_folder", {});
    expect(isError).toBe(false);
    expect(data.total_documents).toBe(11);
    expect(data.counts.by_status).toEqual({ ok: 6, needs_review: 2, not_an_invoice: 2, unreadable: 1 });
    const wrong = data.documents.find((d: any) => d.path.endsWith("total-erroneo.pdf"));
    expect(wrong.failed_checks[0]).toMatch(/^total_math/);
  });

  it("paginates with an opaque cursor", async () => {
    const first = await h.call("scan_folder", { limit: 4 });
    expect(first.data.documents).toHaveLength(4);
    const second = await h.call("scan_folder", { limit: 4, cursor: first.data.next_cursor });
    const third = await h.call("scan_folder", { limit: 4, cursor: second.data.next_cursor });
    expect(third.data.documents).toHaveLength(3);
    expect(third.data.next_cursor).toBeNull();
    const all = [...first.data.documents, ...second.data.documents, ...third.data.documents].map((d: any) => d.path);
    expect(new Set(all).size).toBe(11);
  });

  it("rejects a forged cursor with a recoverable error", async () => {
    const r = await h.call("scan_folder", { cursor: "not-a-cursor" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/Invalid cursor/);
  });
});

describe("extract_invoice", () => {
  it("returns concise output by default: only failed checks", async () => {
    const { data } = await h.call("extract_invoice", { path: "2026-08-03_laura-ejemplo-asesoria.pdf" });
    expect(data.invoice).toMatchObject({ issuer_tax_id: "12345678Z", irpf_amount: 150, total: 1060, status: "ok", checks: [] });
    expect(data.untrusted_text_preview).toBeUndefined();
  });

  it("returns every check and a text preview when detailed", async () => {
    const { data } = await h.call("extract_invoice", { path: "2026-08-03_laura-ejemplo-asesoria.pdf", response_format: "detailed" });
    expect(data.invoice.checks.length).toBeGreaterThanOrEqual(5);
    expect(data.untrusted_text_preview).toContain("Laura Ejemplo");
  });

  it("skips non-invoices unless forced", async () => {
    const skipped = await h.call("extract_invoice", { path: "2026-07-31_nomina-julio.pdf" });
    expect(skipped.data).toMatchObject({ document_type: "payroll", invoice: null });
    expect(skipped.data.warnings.join()).toMatch(/force: true/);
    const forced = await h.call("extract_invoice", { path: "2026-07-31_nomina-julio.pdf", force: true });
    expect(forced.data.invoice).not.toBeNull();
  });

  it("explains how to recover from a scanned PDF", async () => {
    const { data } = await h.call("classify_document", { path: "2026-09-05_escaneo-sin-texto.pdf" });
    expect(data.has_text_layer).toBe(false);
    expect(data.warnings.join()).toMatch(/OCR/);
  });
});

describe("vat_summary", () => {
  it("computes Q3 2026 for the sample business", async () => {
    const { isError, data } = await h.call("vat_summary", { own_tax_id: OWN_TAX_ID, quarter: "2026-Q3" });
    expect(isError).toBe(false);
    expect(data.period).toEqual({ from: "2026-07-01", to: "2026-09-30" });
    expect(data.repercutido).toMatchObject({ documents: 1, base_amount: 2400, vat_amount: 504 });
    // 52.50 + 210 + 51 − 52.50 (credit note)
    expect(data.soportado).toMatchObject({ documents: 4, base_amount: 1400, vat_amount: 261, irpf_amount: 150 });
    expect(data.soportado.by_rate).toEqual([
      { rate: 10, base_amount: 300, vat_amount: 30 },
      { rate: 21, base_amount: 1100, vat_amount: 231 },
    ]);
    expect(data.net_vat).toBe(243);
    expect(data.out_of_period).toBe(1);
    const reasons = Object.fromEntries(data.excluded.map((e: any) => [path.basename(e.path), e.reason]));
    expect(reasons["2026-07-30_papeleria-total-erroneo.pdf"]).toMatch(/total_math/);
    expect(reasons["2026-08-14_ticket-gasolinera.pdf"]).toMatch(/simplified/);
    expect(reasons["2026-09-05_escaneo-sin-texto.pdf"]).toMatch(/OCR/);
  });

  it("accepts an explicit date range and the own ID in any format", async () => {
    const { data } = await h.call("vat_summary", { own_tax_id: "ES B-87654323", from: "2026-06-01", to: "2026-06-30" });
    expect(data.soportado).toMatchObject({ documents: 1, vat_amount: 16.8 });
  });

  it.each([
    [{ own_tax_id: "B87654320", quarter: "2026-Q3" }, /not a valid/],
    [{ own_tax_id: OWN_TAX_ID }, /quarter/],
    [{ own_tax_id: OWN_TAX_ID, from: "2026-09-30", to: "2026-07-01" }, /after/],
  ])("returns an actionable error for %j", async (args, msg) => {
    const r = await h.call("vat_summary", args);
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(msg);
  });
});

describe("validate_tax_id", () => {
  it("validates without touching the filesystem", async () => {
    expect((await h.call("validate_tax_id", { tax_id: "X1234567L" })).data).toMatchObject({ valid: true, kind: "NIE" });
    expect((await h.call("validate_tax_id", { tax_id: "12345678A" })).data).toMatchObject({ valid: false, reason: "control letter should be Z" });
  });
});

describe("export_csv", () => {
  it("writes a new CSV and refuses to overwrite it", async () => {
    const out = path.join(scratch, "q3.csv");
    const first = await h.call("export_csv", { output_path: out });
    expect(first.data).toMatchObject({ rows: 11, by_status: { ok: 6, needs_review: 2, not_an_invoice: 2, unreadable: 1 } });
    expect((await stat(out)).mode & 0o777).toBe(0o600);
    const csv = await readFile(out, "utf8");
    expect(csv.split("\r\n").filter(Boolean)).toHaveLength(12);
    const again = await h.call("export_csv", { output_path: out });
    expect(again.isError).toBe(true);
    expect(again.text).toMatch(/already exists/);
  });

  it("only writes .csv files", async () => {
    const r = await h.call("export_csv", { output_path: path.join(scratch, "x.sh") });
    expect(r).toMatchObject({ isError: true });
  });
});

describe("sandbox", () => {
  it("rejects path traversal out of the allowed folders", async () => {
    const r = await h.call("extract_invoice", { path: "../../package.json" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/outside the allowed folders/);
  });

  it("rejects absolute paths elsewhere on disk", async () => {
    expect((await h.call("classify_document", { path: "/etc/hosts" })).isError).toBe(true);
    expect((await h.call("scan_folder", { folder: os.homedir() })).isError).toBe(true);
  });

  it("rejects a symlink inside a root that points outside it", async () => {
    const outside = await mkdtemp(path.join(os.tmpdir(), "facturas-outside-"));
    await writeFile(path.join(outside, "secret.txt"), "FACTURA secreta");
    await symlink(path.join(outside, "secret.txt"), path.join(scratch, "link.txt"));
    const r = await h.call("classify_document", { path: path.join(scratch, "link.txt") });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/outside the allowed folders/);
    await rm(outside, { recursive: true, force: true });
  });

  it("gives the same answer for missing and existing paths outside the roots (no existence oracle)", async () => {
    const existing = await h.call("classify_document", { path: "/etc/hosts" });
    const missing = await h.call("classify_document", { path: "/etc/definitely-not-here.txt" });
    expect(existing.text).toBe(missing.text);
    expect(existing.text).not.toContain(INBOX);
  });

  it("refuses to export outside the allowed folders", async () => {
    const r = await h.call("export_csv", { output_path: path.join(os.tmpdir(), "escape.csv") });
    expect(r.isError).toBe(true);
  });
});

describe("resource limits", () => {
  it("refuses PDFs above the page limit", async () => {
    const doc = await PDFDocument.create();
    for (let i = 0; i < 201; i++) doc.addPage();
    await writeFile(path.join(scratch, "huge.pdf"), await doc.save());
    const r = await h.call("classify_document", { path: path.join(scratch, "huge.pdf") });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/201 pages; the limit is 200/);
  });
});

describe("input validation", () => {
  it("rejects arguments that violate the schema before the handler runs", async () => {
    const r = await h.call("scan_folder", { limit: 10_000 }).catch((e: Error) => ({ isError: true, text: e.message }));
    expect(r.isError).toBe(true);
  });
});

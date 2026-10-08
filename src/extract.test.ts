import { describe, expect, it } from "vitest";
import { extractInvoice } from "./extract.js";

const INVOICE = `Laura Ejemplo Pérez
NIF: 12345678Z
FACTURA
Nº factura: 2026-031
Fecha de expedición: 03/08/2026
Cliente:
Gestoría Demo Ficticia SL
NIF: B87654323
Base imponible: 1.000,00 €
IVA 21%: 210,00 €
Retención IRPF 15%: -150,00 €
Total a pagar: 1.060,00 €`;

describe("extractInvoice", () => {
  it("extracts every field from a freelancer invoice with IRPF", () => {
    const r = extractInvoice(INVOICE);
    expect(r).toMatchObject({
      invoice_number: "2026-031",
      issue_date: "2026-08-03",
      issuer_tax_id: "12345678Z",
      recipient_tax_id: "B87654323",
      base_amount: 1000,
      vat: [{ rate: 21, amount: 210 }],
      vat_total: 210,
      irpf_rate: 15,
      irpf_amount: 150,
      total: 1060,
      status: "ok",
    });
    expect(r.checks.every((c) => c.passed)).toBe(true);
  });

  it("flags a total that does not reconcile", () => {
    const r = extractInvoice(INVOICE.replace("1.060,00", "1.100,00"));
    expect(r.status).toBe("needs_review");
    expect(r.checks.find((c) => c.id === "total_math")).toMatchObject({ passed: false });
  });

  it("flags VAT that does not match base × rate", () => {
    const r = extractInvoice(INVOICE.replace("210,00", "200,00").replace("1.060,00", "1.050,00"));
    expect(r.checks.find((c) => c.id === "vat_math")?.passed).toBe(false);
    expect(r.checks.find((c) => c.id === "total_math")?.passed).toBe(true);
  });

  it("handles several VAT rates with a per-rate base", () => {
    const r = extractInvoice(
      "Factura nº C/1\nFecha: 22/09/2026\nNIF A76543214\nCliente: NIF B87654323\nBase imponible: 400,00\nIVA 10% (300,00): 30,00\nIVA 21% (100,00): 21,00\nTotal factura: 451,00",
    );
    expect(r.vat).toEqual([{ rate: 10, base: 300, amount: 30 }, { rate: 21, base: 100, amount: 21 }]);
    expect(r.status).toBe("ok");
  });

  it("flags a non-standard VAT rate", () => {
    const r = extractInvoice("Factura nº 9\nFecha: 01/07/2026\nNIF B12345674\nBase imponible: 100,00\nIVA 18%: 18,00\nTotal: 118,00");
    expect(r.checks.find((c) => c.id === "vat_rate_standard")).toMatchObject({ passed: false });
  });

  it("does not let a label run across a line break", () => {
    expect(extractInvoice("FACTURA\nNº factura: PE-1").invoice_number).toBe("PE-1");
  });

  it("returns nulls, not guesses, for an empty document", () => {
    const r = extractInvoice("");
    expect(r).toMatchObject({ invoice_number: null, issue_date: null, issuer_tax_id: null, base_amount: null, total: null, status: "needs_review" });
  });

  it("falls back to the first two IDs when there is no client section", () => {
    const r = extractInvoice("B12345674 vende a 12345678Z\nBase imponible 10,00\nIVA 21% 2,10\nTotal 12,10");
    expect([r.issuer_tax_id, r.recipient_tax_id]).toEqual(["B12345674", "12345678Z"]);
  });
});

describe("hostile input", () => {
  // Measured on a 2024 laptop: ~0.9 s with the bounded regex, ~31 s with the
  // quadratic one it replaced. The 8 s budget leaves room for slow CI runners.
  it("stays linear on a long line of unclosed per-rate bases (ReDoS regression)", () => {
    const t = performance.now();
    extractInvoice("IVA 21% (1 ".repeat(40_000));
    expect(performance.now() - t).toBeLessThan(8000);
  }, 60_000);

  it("keeps offsets aligned when the text has decomposed accents or Hangul", () => {
    const decomposed = "Café ".repeat(5) + "한".repeat(10);
    expect(extractInvoice(`${decomposed}\nFactura nº F-77\nBase imponible 10,00`).invoice_number).toBe("F-77");
  });
});

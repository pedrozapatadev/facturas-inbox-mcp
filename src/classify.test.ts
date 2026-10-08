import { describe, expect, it } from "vitest";
import { classifyText } from "./classify.js";

describe("classifyText", () => {
  it("labels a standard invoice", () => {
    const r = classifyText("FACTURA\nNº factura: A-1\nBase imponible: 100,00\nIVA 21%: 21,00\nTotal factura: 121,00");
    expect(r.type).toBe("invoice");
    expect(r.signals).toContain("'base imponible'");
  });

  it("prefers credit_note over invoice when 'factura rectificativa' is present", () => {
    expect(classifyText("FACTURA RECTIFICATIVA\nBase imponible: -10,00\nIVA 21%: -2,10").type).toBe("credit_note");
  });

  it("recognises a simplified invoice / ticket", () => {
    expect(classifyText("FACTURA SIMPLIFICADA\nTicket nº 1\nTotal (IVA incluido) 5,00").type).toBe("simplified_invoice");
  });

  it("is accent- and case-insensitive", () => {
    expect(classifyText("NÓMINA\nLíquido a percibir 1.000,00").type).toBe("payroll");
    expect(classifyText("nomina\nliquido a percibir 1.000,00").type).toBe("payroll");
  });

  it("labels AEAT forms and bank statements", () => {
    expect(classifyText("Agencia Tributaria\nModelo 303 Autoliquidación").type).toBe("tax_form");
    expect(classifyText("Extracto de cuenta\nSaldo anterior 100,00\nSaldo final 50,00").type).toBe("bank_statement");
  });

  it("falls back to other on weak or no evidence", () => {
    expect(classifyText("Lorem ipsum dolor sit amet").type).toBe("other");
    expect(classifyText("").type).toBe("other");
  });
});

it("foldText preserves UTF-16 length so offsets map back to the original", async () => {
  const { foldText } = await import("./classify.js");
  for (const s of ["Nómina", "Café", "한국어 Factura", "ǅ ﬁ ẞ İ 😀"]) expect(foldText(s)).toHaveLength(s.length);
});

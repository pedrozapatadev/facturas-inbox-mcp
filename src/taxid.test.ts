import { describe, expect, it } from "vitest";
import { findTaxIds, validateTaxId } from "./taxid.js";

describe("validateTaxId", () => {
  it.each([
    ["12345678Z", "DNI"],
    ["00000000T", "DNI"],
    ["X1234567L", "NIE"],
    ["Y1234567X", "NIE"],
    ["Z1234567R", "NIE"],
    ["B12345674", "CIF"],
    ["A76543214", "CIF"],
    ["Q2826000H", "CIF"],
    ["K1234567L", "NIF_KLM"],
  ])("accepts %s as %s", (id, kind) => {
    expect(validateTaxId(id)).toMatchObject({ valid: true, kind });
  });

  it("normalizes spacing, hyphens, case and the ES VAT prefix", () => {
    expect(validateTaxId("es b-1234567-4")).toMatchObject({ valid: true, normalized: "B12345674" });
    expect(validateTaxId("12.345.678-z")).toMatchObject({ valid: true, normalized: "12345678Z" });
    expect(validateTaxId("ES12345678Z")).toMatchObject({ valid: true, normalized: "12345678Z" });
  });

  it("reports the expected control character on a bad checksum", () => {
    expect(validateTaxId("12345678A")).toMatchObject({ valid: false, kind: "DNI", reason: "control letter should be Z" });
    expect(validateTaxId("B12345675").reason).toContain("4");
  });

  it("enforces letter vs digit control by CIF entity type", () => {
    expect(validateTaxId("Q28260008").valid).toBe(false); // Q requires a letter (H)
    expect(validateTaxId("B1234567D").valid).toBe(false); // B requires a digit (4)
  });

  it.each(["", "hello", "1234567Z", "I1234567A", "B123456789"])("rejects malformed %j", (id) => {
    expect(validateTaxId(id)).toMatchObject({ valid: false, kind: null });
  });
});

describe("findTaxIds", () => {
  it("finds only checksum-valid IDs, in order, without duplicates", () => {
    const text = "Emisor NIF: B12345674\nTel 912345678\nPedido 12345678A\nCliente: 12345678Z\nB12345674";
    expect(findTaxIds(text).map((t) => t.normalized)).toEqual(["B12345674", "12345678Z"]);
  });
});

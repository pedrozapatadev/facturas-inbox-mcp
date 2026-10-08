import { describe, expect, it } from "vitest";
import { parseAmountCents, parseSpanishDate } from "./amounts.js";

describe("parseAmountCents", () => {
  it.each([
    ["1.234,56 €", 123456],
    ["1234,5", 123450],
    ["1,234.56", 123456],
    ["1234.56", 123456],
    ["1.234", 123400],
    ["1.234.567,00", 123456700],
    ["0,07", 7],
    ["-150,00 €", -15000],
    ["(52,50)", -5250],
    ["€ 302,50", 30250],
  ])("%s -> %i cents", (raw, cents) => {
    expect(parseAmountCents(raw)).toBe(cents);
  });

  it("returns NaN when there is no number", () => {
    expect(parseAmountCents("sin importe")).toBeNaN();
  });
});

describe("parseSpanishDate", () => {
  it.each([
    ["15/07/2026", "2026-07-15"],
    ["3-8-2026", "2026-08-03"],
    ["03.08.26", "2026-08-03"],
    ["2026-09-10", "2026-09-10"],
    ["22 de septiembre de 2026", "2026-09-22"],
    ["1 de Enero 2027", "2027-01-01"],
  ])("%s -> %s", (raw, iso) => {
    expect(parseSpanishDate(raw)).toBe(iso);
  });

  it.each(["31/02/2026", "no date here", "45/13/2026"])("rejects %s", (raw) => {
    expect(parseSpanishDate(raw)).toBeNull();
  });
});

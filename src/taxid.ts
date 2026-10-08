/**
 * Spanish tax identifier validation (NIF / NIE / CIF), checksum-exact.
 *
 * - DNI-style NIF: 8 digits + control letter            e.g. 12345678Z
 * - NIE (foreigners): X/Y/Z + 7 digits + control letter  e.g. X1234567L
 * - K/L/M NIF (special natural persons): letter + 7 digits + control letter
 * - CIF (legal entities): org letter + 7 digits + control digit or letter  e.g. B12345674
 *
 * An "ES" VAT prefix, spaces, dots and hyphens are tolerated and stripped.
 */

export type TaxIdKind = "DNI" | "NIE" | "NIF_KLM" | "CIF";

export interface TaxIdResult {
  input: string;
  normalized: string;
  valid: boolean;
  kind: TaxIdKind | null;
  /** Human-readable reason when invalid; the expected control character when the checksum fails. */
  reason?: string;
}

const DNI_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE";
const CIF_CONTROL_LETTERS = "JABCDEFGHI";
/** Entity types whose CIF control must be a letter. */
const CIF_LETTER_CONTROL = new Set(["N", "P", "Q", "R", "S", "W"]);
/** Entity types whose CIF control must be a digit. */
const CIF_DIGIT_CONTROL = new Set(["A", "B", "E", "H"]);

export function normalizeTaxId(raw: string): string {
  let s = raw.toUpperCase().replace(/[\s.\-/]/g, "");
  // "ES" VAT prefix, but don't eat a real leading letter of the ID itself.
  if (s.startsWith("ES") && s.length === 11) s = s.slice(2);
  return s;
}

function dniLetter(n: number): string {
  return DNI_LETTERS[n % 23]!;
}

function cifControlDigit(digits: string): number {
  let sum = 0;
  for (let i = 0; i < 7; i++) {
    const d = Number(digits[i]);
    if (i % 2 === 0) {
      // odd positions (1st, 3rd, ...): double and add the digits of the result
      const x = d * 2;
      sum += Math.floor(x / 10) + (x % 10);
    } else {
      sum += d;
    }
  }
  return (10 - (sum % 10)) % 10;
}

export function validateTaxId(raw: string): TaxIdResult {
  const input = raw;
  const s = normalizeTaxId(raw);
  const fail = (kind: TaxIdKind | null, reason: string): TaxIdResult => ({
    input,
    normalized: s,
    valid: false,
    kind,
    reason,
  });

  if (/^\d{8}[A-Z]$/.test(s)) {
    const expected = dniLetter(Number(s.slice(0, 8)));
    return s[8] === expected
      ? { input, normalized: s, valid: true, kind: "DNI" }
      : fail("DNI", `control letter should be ${expected}`);
  }

  if (/^[XYZ]\d{7}[A-Z]$/.test(s)) {
    const prefix = "XYZ".indexOf(s[0]!);
    const expected = dniLetter(Number(`${prefix}${s.slice(1, 8)}`));
    return s[8] === expected
      ? { input, normalized: s, valid: true, kind: "NIE" }
      : fail("NIE", `control letter should be ${expected}`);
  }

  if (/^[KLM]\d{7}[A-Z]$/.test(s)) {
    const expected = dniLetter(Number(s.slice(1, 8)));
    return s[8] === expected
      ? { input, normalized: s, valid: true, kind: "NIF_KLM" }
      : fail("NIF_KLM", `control letter should be ${expected}`);
  }

  if (/^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/.test(s)) {
    const org = s[0]!;
    const digit = cifControlDigit(s.slice(1, 8));
    const letter = CIF_CONTROL_LETTERS[digit]!;
    const control = s[8]!;
    const isDigit = /\d/.test(control);
    if (CIF_LETTER_CONTROL.has(org) && isDigit) return fail("CIF", `entity type ${org} requires control letter ${letter}`);
    if (CIF_DIGIT_CONTROL.has(org) && !isDigit) return fail("CIF", `entity type ${org} requires control digit ${digit}`);
    const ok = isDigit ? Number(control) === digit : control === letter;
    return ok
      ? { input, normalized: s, valid: true, kind: "CIF" }
      : fail("CIF", `control character should be ${digit} or ${letter}`);
  }

  return fail(null, "not a recognizable NIF, NIE or CIF format");
}

/**
 * Candidate tax IDs in free text, in order of appearance, deduplicated.
 * Only checksum-valid IDs are returned, which removes most false positives
 * (invoice numbers, phone numbers, postcodes).
 */
export function findTaxIds(text: string): (TaxIdResult & { offset: number })[] {
  const re = /\b(?:ES[\s-]?)?([0-9XYZKLMABCDEFGHJNPQRSUVW][\s.-]?\d{2}[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?[0-9A-Z])\b/gi;
  const seen = new Set<string>();
  const out: (TaxIdResult & { offset: number })[] = [];
  for (const m of text.matchAll(re)) {
    const r = validateTaxId(m[1]!);
    if (r.valid && !seen.has(r.normalized)) {
      seen.add(r.normalized);
      out.push({ ...r, input: m[0]!, offset: m.index! });
    }
  }
  return out;
}

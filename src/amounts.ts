/**
 * Money and date parsing for Spanish business documents.
 * Amounts are handled as integer cents to keep arithmetic checks exact.
 */

/**
 * Parse a Spanish- or English-formatted amount into integer cents.
 *   "1.234,56 €" -> 123456   "1234,5" -> 123450   "1,234.56" -> 123456
 *   "1.234" -> 123400 (dot followed by exactly 3 digits = thousands, Spanish convention)
 * Returns NaN when the string holds no parseable amount.
 */
export function parseAmountCents(raw: string): number {
  const m = raw.match(/-?\s*\d[\d.,\s]*/);
  if (!m) return Number.NaN;
  const isNegative = m[0].trim().startsWith("-") || /\(\s*\d/.test(raw);
  const s = m[0].replace(/[-\s]/g, "").replace(/[.,]$/, "");
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");

  let normalized: string;
  if (lastDot >= 0 && lastComma >= 0) {
    const decimal = lastDot > lastComma ? "." : ",";
    const thousands = decimal === "." ? "," : ".";
    normalized = s.split(thousands).join("").replace(decimal, ".");
  } else if (lastComma >= 0) {
    const isThousandsOnly = /^\d{1,3}(,\d{3})+$/.test(s) && s.split(",").length > 2;
    normalized = isThousandsOnly ? s.replace(/,/g, "") : s.replace(/,/g, ".");
  } else if (lastDot >= 0) {
    const isThousands = /^\d{1,3}(\.\d{3})+$/.test(s);
    normalized = isThousands ? s.replace(/\./g, "") : s;
  } else {
    normalized = s;
  }

  const value = Number(normalized);
  if (!Number.isFinite(value)) return Number.NaN;
  const cents = Math.round(value * 100);
  return isNegative ? -cents : cents;
}

export function centsToEuros(cents: number): number {
  return Math.round(cents) / 100;
}

const MONTHS: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7,
  agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};

function isoDate(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/**
 * Parse the first date found in `raw` into ISO `YYYY-MM-DD`.
 * Accepts dd/mm/yyyy, dd-mm-yyyy, dd.mm.yy, yyyy-mm-dd and "15 de julio de 2026".
 * Day-first is assumed for numeric dates (Spanish convention).
 */
export function parseSpanishDate(raw: string): string | null {
  const iso = raw.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return isoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const num = raw.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})\b/);
  if (num) {
    const y = num[3]!.length === 2 ? 2000 + Number(num[3]) : Number(num[3]);
    return isoDate(y, Number(num[2]), Number(num[1]));
  }

  const long = raw.toLowerCase().match(/\b(\d{1,2})\s+de\s+([a-z]+)\s+(?:de\s+)?(\d{4})\b/);
  if (long && MONTHS[long[2]!]) return isoDate(Number(long[3]), MONTHS[long[2]!]!, Number(long[1]));

  return null;
}

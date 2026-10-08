/**
 * Invoice field extraction from plain text, with arithmetic self-checks.
 *
 * The extractor never guesses silently: every field is either found or null,
 * and `checks` records which cross-validations passed, so an agent can decide
 * what to trust and what to send to a human.
 */
import { centsToEuros, parseAmountCents, parseSpanishDate } from "./amounts.js";
import { foldText } from "./classify.js";
import { findTaxIds } from "./taxid.js";

/** A money amount: "1.234,56", "1234,56", "1,234.56", "1234.56". */
const AMOUNT = String.raw`-?\d{1,3}(?:[.\s]\d{3})*,\d{2}|-?\d{1,3}(?:,\d{3})*\.\d{2}|-?\d+[.,]\d{2}|-?\d+`;
const RATE = String.raw`(\d{1,2}(?:[.,]\d{1,2})?)\s*%`;
const GAP = String.raw`[^\d\n%-]{0,25}`;

export const STANDARD_VAT_RATES = [0, 4, 5, 10, 21];

export interface VatLine {
  rate: number;
  /** Taxable base for this rate, when the document breaks it out per rate. */
  base?: number;
  amount: number;
}

export interface Check {
  id: "issuer_tax_id" | "issue_date" | "vat_rate_standard" | "vat_math" | "irpf_math" | "total_math";
  passed: boolean;
  detail: string;
}

export interface InvoiceFields {
  invoice_number: string | null;
  issue_date: string | null;
  issuer_tax_id: string | null;
  recipient_tax_id: string | null;
  base_amount: number | null;
  vat: VatLine[];
  vat_total: number | null;
  irpf_rate: number | null;
  irpf_amount: number | null;
  total: number | null;
  currency: "EUR";
  checks: Check[];
  /** "ok" when every check passed; otherwise a human should look at it. */
  status: "ok" | "needs_review";
}

const RECIPIENT_SECTION = /\b(cliente|destinatario|facturar\s+a|datos\s+del\s+cliente|bill\s+to)\b/;

function parseRate(raw: string): number {
  return Number(raw.replace(",", "."));
}

function firstAmount(folded: string, label: string): number | null {
  const m = folded.match(new RegExp(`${label}${GAP}(${AMOUNT})`));
  return m ? parseAmountCents(m[1]!) : null;
}

function findInvoiceNumber(text: string, folded: string): string | null {
  // [ \t] rather than \s: a label must not run across a line break into the next line.
  const re = /(?:\bn[ºo°]\.?[ \t]*(?:de[ \t]+)?(?:factura|ticket)|\b(?:factura|ticket)[ \t]*(?:n[ºo°]\.?|num(?:ero)?\.?)|\bnum(?:ero)?[ \t]+de[ \t]+factura|\binvoice[ \t]*(?:no\.?|number|#))[ \t]*:?[ \t]*((?=[a-z0-9\-/.]*\d)[a-z0-9][a-z0-9\-/.]{0,30})/;
  const m = re.exec(folded);
  if (!m) return null;
  const start = m.index + m[0].length - m[1]!.length;
  const value = text.slice(start, start + m[1]!.length).replace(/[.]$/, "");
  return /^[A-Za-z0-9][A-Za-z0-9\-/.]*$/.test(value) ? value : null;
}

function findDate(folded: string): string | null {
  const labelled = folded.match(/\bfecha(?:\s+de)?(?:\s+(?:factura|expedicion|emision))?\s*:?\s*([^\n]{0,40})/);
  return (labelled && parseSpanishDate(labelled[1]!)) ?? parseSpanishDate(folded);
}

function findParties(text: string, folded: string): { issuer: string | null; recipient: string | null } {
  const ids = findTaxIds(text);
  const sectionAt = folded.search(RECIPIENT_SECTION);
  if (sectionAt >= 0) {
    const before = ids.filter((t) => t.offset < sectionAt);
    const after = ids.filter((t) => t.offset >= sectionAt);
    return { issuer: before[0]?.normalized ?? null, recipient: after[0]?.normalized ?? before[1]?.normalized ?? null };
  }
  return { issuer: ids[0]?.normalized ?? null, recipient: ids[1]?.normalized ?? null };
}

function findVatLines(folded: string): VatLine[] {
  // "IVA 21%: 210,00" or, with the per-rate base, "IVA 10% (300,00): 30,00"
  const perRateBase = String.raw`(?:[ \t]*\((?:base[ \t]*)?(${AMOUNT})[^)\n]{0,40}\))?`;
  const re = new RegExp(String.raw`\b(?:iva|i\.v\.a\.?|vat)\b[^\d\n%]{0,15}${RATE}${perRateBase}${GAP}(${AMOUNT})`, "g");
  return [...folded.matchAll(re)]
    .map((m) => ({
      rate: parseRate(m[1]!),
      ...(m[2] ? { base: parseAmountCents(m[2]) } : {}),
      amount: parseAmountCents(m[3]!),
    }))
    .filter((v) => Number.isFinite(v.amount));
}

function findIrpf(folded: string): { rate: number | null; amount: number | null } {
  const m = folded.match(new RegExp(String.raw`\b(?:irpf|retencion)\b[^\d\n%]{0,25}${RATE}${GAP}(${AMOUNT})`));
  return m ? { rate: parseRate(m[1]!), amount: Math.abs(parseAmountCents(m[2]!)) } : { rate: null, amount: null };
}

function findTotal(folded: string): number | null {
  return (
    firstAmount(folded, String.raw`\b(?:total\s+(?:factura|a\s+pagar)|importe\s+total|total\s+importe)\b`) ??
    [...folded.matchAll(new RegExp(String.raw`\btotal\b(?!\s+(?:base|iva|bruto))${GAP}(${AMOUNT})`, "g"))]
      .map((m) => parseAmountCents(m[1]!))
      .at(-1) ??
    null
  );
}

export function extractInvoice(text: string): InvoiceFields {
  const folded = foldText(text);
  const parties = findParties(text, folded);
  const base = firstAmount(folded, String.raw`\bbase\s+imponible\b(?:\s+total)?`);
  const vat = findVatLines(folded);
  const irpf = findIrpf(folded);
  const total = findTotal(folded);
  const vatTotal = vat.length ? vat.reduce((s, v) => s + v.amount, 0) : null;

  const cents = {
    invoice_number: findInvoiceNumber(text, folded),
    issue_date: findDate(folded),
    issuer_tax_id: parties.issuer,
    recipient_tax_id: parties.recipient,
    base,
    vat,
    vatTotal,
    irpf,
    total,
  };
  const checks = runChecks(cents);

  return {
    invoice_number: cents.invoice_number,
    issue_date: cents.issue_date,
    issuer_tax_id: cents.issuer_tax_id,
    recipient_tax_id: cents.recipient_tax_id,
    base_amount: base === null ? null : centsToEuros(base),
    vat: vat.map((v) => ({ rate: v.rate, ...(v.base === undefined ? {} : { base: centsToEuros(v.base) }), amount: centsToEuros(v.amount) })),
    vat_total: vatTotal === null ? null : centsToEuros(vatTotal),
    irpf_rate: irpf.rate,
    irpf_amount: irpf.amount === null ? null : centsToEuros(irpf.amount),
    total: total === null ? null : centsToEuros(total),
    currency: "EUR",
    checks,
    status: checks.every((c) => c.passed) ? "ok" : "needs_review",
  };
}

interface CentsFields {
  issue_date: string | null;
  issuer_tax_id: string | null;
  base: number | null;
  vat: VatLine[];
  vatTotal: number | null;
  irpf: { rate: number | null; amount: number | null };
  total: number | null;
}

/** Tolerance for rounding: 1 cent per VAT line, plus 1. */
function tolerance(f: CentsFields): number {
  return f.vat.length + 1;
}

/** Rate × base per VAT line: uses the per-rate base when printed, else the single base. */
function checkVatMath(f: CentsFields, eur: (c: number) => string): Check | null {
  const lines = f.vat.length === 1 && f.vat[0]!.base === undefined && f.base !== null ? [{ ...f.vat[0]!, base: f.base }] : f.vat;
  if (lines.length === 0 || lines.some((v) => v.base === undefined)) return null;
  const parts = lines.map((v) => {
    const expected = Math.round((v.base! * v.rate) / 100);
    return { ok: Math.abs(expected - v.amount) <= 1, text: `${eur(v.base!)} × ${v.rate}% = ${eur(expected)} (document: ${eur(v.amount)})` };
  });
  const baseSum = lines.reduce((s, v) => s + v.base!, 0);
  const isBaseConsistent = f.base === null || Math.abs(baseSum - f.base) <= lines.length;
  return {
    id: "vat_math",
    passed: parts.every((p) => p.ok) && isBaseConsistent,
    detail: parts.map((p) => p.text).join("; ") + (isBaseConsistent ? "" : `; per-rate bases sum to ${eur(baseSum)}, not the stated base`),
  };
}

function runChecks(f: CentsFields): Check[] {
  const eur = (c: number) => centsToEuros(c).toFixed(2);
  const checks: Check[] = [
    f.issuer_tax_id
      ? { id: "issuer_tax_id", passed: true, detail: `issuer ${f.issuer_tax_id} has a valid checksum` }
      : { id: "issuer_tax_id", passed: false, detail: "no checksum-valid issuer NIF/CIF found" },
    f.issue_date
      ? { id: "issue_date", passed: true, detail: `issued ${f.issue_date}` }
      : { id: "issue_date", passed: false, detail: "no issue date found" },
  ];

  const odd = f.vat.filter((v) => !STANDARD_VAT_RATES.includes(v.rate));
  checks.push({
    id: "vat_rate_standard",
    passed: f.vat.length > 0 && odd.length === 0,
    detail: f.vat.length === 0 ? "no VAT line found" : odd.length ? `non-standard rate(s): ${odd.map((v) => v.rate).join(", ")}%` : "all VAT rates are standard Spanish rates",
  });

  const vatMath = checkVatMath(f, eur);
  if (vatMath) checks.push(vatMath);

  if (f.base !== null && f.irpf.rate !== null && f.irpf.amount !== null) {
    const expected = Math.round((f.base * f.irpf.rate) / 100);
    const passed = Math.abs(expected - f.irpf.amount) <= 1;
    checks.push({ id: "irpf_math", passed, detail: `base ${eur(f.base)} × ${f.irpf.rate}% = ${eur(expected)}, document says ${eur(f.irpf.amount)}` });
  }

  if (f.base !== null && f.total !== null) {
    const expected = f.base + (f.vatTotal ?? 0) - (f.irpf.amount ?? 0);
    const passed = Math.abs(expected - f.total) <= tolerance(f);
    checks.push({ id: "total_math", passed, detail: `base + IVA − IRPF = ${eur(expected)}, document total ${eur(f.total)}` });
  } else {
    checks.push({ id: "total_math", passed: false, detail: "base or total missing; cannot reconcile" });
  }
  return checks;
}

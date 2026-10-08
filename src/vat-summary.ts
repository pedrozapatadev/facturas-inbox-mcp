/**
 * IVA repercutido (charged on issued invoices) vs. IVA soportado (paid on
 * received invoices) for a period, from the perspective of one taxpayer.
 *
 * Only documents whose checks all passed are counted; everything else is
 * listed under `excluded` with the reason, so nothing disappears silently.
 * This is a working figure for review, not a filed modelo 303.
 */
import { centsToEuros } from "./amounts.js";
import type { AnalyzedDocument } from "./pipeline.js";

export interface DirectionTotals {
  documents: number;
  base_amount: number;
  vat_amount: number;
  irpf_amount: number;
  by_rate: { rate: number; base_amount: number | null; vat_amount: number }[];
}

export interface VatSummary {
  own_tax_id: string;
  period: { from: string; to: string };
  repercutido: DirectionTotals;
  soportado: DirectionTotals;
  /** repercutido − soportado. Positive means VAT to pay for the period. */
  net_vat: number;
  included: { path: string; direction: "issued" | "received"; invoice_number: string | null; issue_date: string; total: number | null }[];
  excluded: { path: string; reason: string }[];
  out_of_period: number;
  disclaimer: string;
}

interface Acc {
  documents: number;
  base: number;
  vat: number;
  irpf: number;
  rates: Map<number, { base: number | null; vat: number }>;
}

const emptyAcc = (): Acc => ({ documents: 0, base: 0, vat: 0, irpf: 0, rates: new Map() });
const toCents = (eur: number | null | undefined) => Math.round((eur ?? 0) * 100);

function finish(a: Acc): DirectionTotals {
  return {
    documents: a.documents,
    base_amount: centsToEuros(a.base),
    vat_amount: centsToEuros(a.vat),
    irpf_amount: centsToEuros(a.irpf),
    by_rate: [...a.rates.entries()]
      .sort(([x], [y]) => x - y)
      .map(([rate, v]) => ({ rate, base_amount: v.base === null ? null : centsToEuros(v.base), vat_amount: centsToEuros(v.vat) })),
  };
}

function add(acc: Acc, inv: NonNullable<AnalyzedDocument["invoice"]>): void {
  acc.documents += 1;
  acc.base += toCents(inv.base_amount);
  acc.irpf += toCents(inv.irpf_amount);
  const isSingleRate = inv.vat.length === 1;
  for (const line of inv.vat) {
    const lineBase = line.base ?? (isSingleRate ? inv.base_amount : undefined);
    const prev = acc.rates.get(line.rate) ?? { base: 0, vat: 0 };
    acc.rates.set(line.rate, {
      base: prev.base === null || lineBase === undefined || lineBase === null ? null : prev.base + toCents(lineBase),
      vat: prev.vat + toCents(line.amount),
    });
    acc.vat += toCents(line.amount);
  }
}

function exclusionReason(d: AnalyzedDocument, own: string): string | null {
  if (!d.has_text_layer) return "no text layer (needs OCR)";
  if (!d.invoice) return `not an invoice (${d.classification.type})`;
  if (d.classification.type === "simplified_invoice") return "simplified invoice (ticket): VAT is not broken out; review manually";
  if (d.invoice.status !== "ok") {
    return `failed checks: ${d.invoice.checks.filter((c) => !c.passed).map((c) => c.id).join(", ")}`;
  }
  if (d.invoice.issuer_tax_id !== own && d.invoice.recipient_tax_id !== own) return `neither party is ${own}`;
  return null;
}

export function summarizeVat(docs: AnalyzedDocument[], opts: { ownTaxId: string; from: string; to: string }): VatSummary {
  const issued = emptyAcc();
  const received = emptyAcc();
  const included: VatSummary["included"] = [];
  const excluded: VatSummary["excluded"] = [];
  let outOfPeriod = 0;

  for (const d of docs) {
    const date = d.invoice?.issue_date;
    if (date && (date < opts.from || date > opts.to)) {
      outOfPeriod += 1;
      continue;
    }
    const reason = exclusionReason(d, opts.ownTaxId) ?? (date ? null : "no issue date");
    if (reason) {
      excluded.push({ path: d.path, reason });
      continue;
    }
    const inv = d.invoice!;
    const direction = inv.issuer_tax_id === opts.ownTaxId ? "issued" : "received";
    add(direction === "issued" ? issued : received, inv);
    included.push({ path: d.path, direction, invoice_number: inv.invoice_number, issue_date: date!, total: inv.total });
  }

  return {
    own_tax_id: opts.ownTaxId,
    period: { from: opts.from, to: opts.to },
    repercutido: finish(issued),
    soportado: finish(received),
    net_vat: centsToEuros(issued.vat - received.vat),
    included,
    excluded,
    out_of_period: outOfPeriod,
    disclaimer: "Working figure from automatically extracted data. Review the excluded documents; this is not a filed modelo 303.",
  };
}

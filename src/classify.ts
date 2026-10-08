/**
 * Rule-based document classifier for Spanish business paperwork.
 *
 * Deterministic on purpose: every label comes with the signals that produced it,
 * so the calling agent (and the human reviewing its work) can see *why*.
 */

export const DOCUMENT_TYPES = [
  "invoice",            // factura completa
  "credit_note",        // factura rectificativa / abono
  "simplified_invoice", // factura simplificada / ticket
  "payroll",            // nómina
  "tax_form",           // modelo AEAT (303, 111, 130, 390, ...)
  "bank_statement",     // extracto / recibo bancario
  "other",
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

interface Rule {
  pattern: RegExp;
  weight: number;
  label: string;
}

const RULES: Record<Exclude<DocumentType, "other">, Rule[]> = {
  invoice: [
    { pattern: /\bfactura\b/, weight: 3, label: "word 'factura'" },
    { pattern: /\b(n[ºo°.]*|num(ero)?)\s*(de\s+)?factura\b|\bfactura\s*(n[ºo°.]*|num)/, weight: 2, label: "invoice number label" },
    { pattern: /\bbase\s+imponible\b/, weight: 2, label: "'base imponible'" },
    { pattern: /\biva\b/, weight: 1, label: "IVA mentioned" },
    { pattern: /\btotal\s+(factura|a\s+pagar)\b/, weight: 1, label: "invoice total label" },
    { pattern: /\b(invoice|vat)\b/, weight: 1, label: "English invoice terms" },
  ],
  credit_note: [
    { pattern: /\bfactura\s+rectificativa\b/, weight: 6, label: "'factura rectificativa'" },
    { pattern: /\babono\b/, weight: 2, label: "word 'abono'" },
    { pattern: /\bfactura\s+rectificada\b|\brectifica\s+a\b/, weight: 2, label: "reference to rectified invoice" },
    { pattern: /\bart(iculo|\.)?\s*80\b/, weight: 1, label: "art. 80 LIVA reference" },
  ],
  simplified_invoice: [
    { pattern: /\bfactura\s+simplificada\b/, weight: 6, label: "'factura simplificada'" },
    { pattern: /\bticket\b/, weight: 3, label: "word 'ticket'" },
    { pattern: /\biva\s+incluido\b/, weight: 2, label: "'IVA incluido'" },
    { pattern: /\b(efectivo|cambio|tarjeta)\b/, weight: 1, label: "point-of-sale payment terms" },
  ],
  payroll: [
    { pattern: /\bnomina\b/, weight: 4, label: "word 'nómina'" },
    { pattern: /\bliquido\s+a\s+percibir\b/, weight: 4, label: "'líquido a percibir'" },
    { pattern: /\bdevengos\b/, weight: 2, label: "'devengos'" },
    { pattern: /\bdeducciones\b/, weight: 1, label: "'deducciones'" },
    { pattern: /\b(seguridad\s+social|cotizacion|contingencias\s+comunes)\b/, weight: 2, label: "social security terms" },
  ],
  tax_form: [
    { pattern: /\bagencia\s+tributaria\b|\baeat\b/, weight: 3, label: "AEAT mentioned" },
    { pattern: /\bmodelo\s+(036|037|100|111|115|130|131|180|190|200|303|347|349|390)\b/, weight: 4, label: "AEAT form number" },
    { pattern: /\bautoliquidacion\b|\bdeclaracion\s+(trimestral|anual|informativa)\b/, weight: 2, label: "self-assessment terms" },
    { pattern: /\bejercicio\b.*\bperiodo\b|\bperiodo\b.*\bejercicio\b/s, weight: 1, label: "fiscal year + period" },
  ],
  bank_statement: [
    { pattern: /\bextracto\b/, weight: 3, label: "word 'extracto'" },
    { pattern: /\bsaldo\s+(anterior|final|inicial|disponible)\b/, weight: 3, label: "balance terms" },
    { pattern: /\bes\d{2}(\s?\d{4}){5}\b/, weight: 1, label: "Spanish IBAN" },
    { pattern: /\b(recibo\s+domiciliado|adeudo|transferencia)\b/, weight: 1, label: "bank movement terms" },
  ],
};

export interface Classification {
  type: DocumentType;
  /** 0–1. Share of the winning score over the total, damped for weak evidence. */
  confidence: number;
  signals: string[];
  /** Runner-up type when it scored close to the winner (an ambiguous document). */
  alternative?: DocumentType;
}

/**
 * Lowercase and strip accents so 'Nómina' and 'NOMINA' match the same rule.
 * Folds code point by code point and keeps the original wherever folding would
 * change the length, so offsets in the folded text are valid in the original.
 */
export function foldText(text: string): string {
  let out = "";
  for (const ch of text) {
    const folded = ch.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
    out += folded.length === ch.length ? folded : ch;
  }
  return out;
}

interface Scored {
  type: DocumentType;
  score: number;
  signals: string[];
}

/**
 * Credit notes and simplified invoices are invoices too, so they also score on
 * the generic invoice rules. When their own decisive marker is present
 * ("factura rectificativa", "factura simplificada", ...), they inherit the
 * invoice evidence instead of losing to it.
 */
function withInvoiceSubtypes(scored: Scored[]): Scored[] {
  const invoice = scored.find((s) => s.type === "invoice");
  if (!invoice) return scored;
  return scored.map((s) =>
    (s.type === "credit_note" || s.type === "simplified_invoice") && s.score >= 6
      ? { ...s, score: s.score + invoice.score, signals: [...s.signals, ...invoice.signals] }
      : s,
  );
}

export function classifyText(text: string): Classification {
  const folded = foldText(text);
  const raw = Object.entries(RULES).map(([type, rules]) => {
    const hits = rules.filter((r) => r.pattern.test(folded));
    return {
      type: type as DocumentType,
      score: hits.reduce((s, r) => s + r.weight, 0),
      signals: hits.map((r) => r.label),
    };
  });
  const scored = withInvoiceSubtypes(raw);
  scored.sort((a, b) => b.score - a.score);
  const [best, second] = scored;
  if (!best || best.score < 3) {
    return { type: "other", confidence: best && best.score > 0 ? 0.3 : 0.9, signals: best?.signals ?? [] };
  }
  const total = scored.reduce((s, x) => s + x.score, 0);
  const strength = Math.min(1, best.score / 8);
  const confidence = Math.round((best.score / total) * (0.5 + 0.5 * strength) * 100) / 100;
  const isAmbiguous = second !== undefined && second.score > 0 && second.score >= best.score * 0.6;
  return {
    type: best.type,
    confidence,
    signals: best.signals,
    ...(isAmbiguous ? { alternative: second.type } : {}),
  };
}

/**
 * One document in, one structured record out: read → classify → extract.
 * Shared by the single-document tools, the folder scan, the VAT summary and the CSV export.
 */
import { classifyText, type Classification, type DocumentType } from "./classify.js";
import { listDocuments, readDocumentText } from "./documents.js";
import { extractInvoice, type InvoiceFields } from "./extract.js";

/** Document types that carry invoice fields worth extracting. */
export const INVOICE_TYPES: ReadonlySet<DocumentType> = new Set(["invoice", "credit_note", "simplified_invoice"]);

export interface AnalyzedDocument {
  path: string;
  pages: number;
  has_text_layer: boolean;
  classification: Classification;
  /** Present only for invoice-like documents. */
  invoice?: InvoiceFields;
  warnings: string[];
}

export async function analyzeDocument(file: string): Promise<AnalyzedDocument> {
  const doc = await readDocumentText(file);
  const warnings: string[] = [];
  if (!doc.has_text_layer) {
    warnings.push("No text layer (likely a scanned image). Run OCR first, e.g. `ocrmypdf in.pdf out.pdf`, then retry.");
  }
  const classification = classifyText(doc.text);
  const isInvoiceLike = INVOICE_TYPES.has(classification.type);
  if (classification.alternative) {
    warnings.push(`Ambiguous: could also be "${classification.alternative}". Check the document before relying on the label.`);
  }
  return {
    path: file,
    pages: doc.pages,
    has_text_layer: doc.has_text_layer,
    classification,
    ...(isInvoiceLike ? { invoice: extractInvoice(doc.text) } : {}),
    warnings,
  };
}

/** Compact row for batch results: what an agent needs to triage a folder. */
export interface ScanRow {
  path: string;
  type: DocumentType;
  confidence: number;
  status: "ok" | "needs_review" | "not_an_invoice" | "unreadable";
  invoice_number: string | null;
  issue_date: string | null;
  issuer_tax_id: string | null;
  recipient_tax_id: string | null;
  base_amount: number | null;
  vat_total: number | null;
  irpf_amount: number | null;
  total: number | null;
  failed_checks: string[];
}

export function toScanRow(a: AnalyzedDocument): ScanRow {
  const inv = a.invoice;
  const status: ScanRow["status"] = !a.has_text_layer ? "unreadable" : inv ? inv.status : "not_an_invoice";
  return {
    path: a.path,
    type: a.classification.type,
    confidence: a.classification.confidence,
    status,
    invoice_number: inv?.invoice_number ?? null,
    issue_date: inv?.issue_date ?? null,
    issuer_tax_id: inv?.issuer_tax_id ?? null,
    recipient_tax_id: inv?.recipient_tax_id ?? null,
    base_amount: inv?.base_amount ?? null,
    vat_total: inv?.vat_total ?? null,
    irpf_amount: inv?.irpf_amount ?? null,
    total: inv?.total ?? null,
    failed_checks: inv ? inv.checks.filter((c) => !c.passed).map((c) => `${c.id}: ${c.detail}`) : [],
  };
}

/** Analyze files a few at a time. A file that fails to parse becomes an "unreadable" record, not a failed call. */
export async function analyzeFiles(paths: string[]): Promise<AnalyzedDocument[]> {
  const results: AnalyzedDocument[] = [];
  const CONCURRENCY = 4;
  for (let i = 0; i < paths.length; i += CONCURRENCY) {
    const batch = paths.slice(i, i + CONCURRENCY).map((p) => analyzeDocument(p).catch((err: Error) => unreadable(p, err)));
    results.push(...(await Promise.all(batch)));
  }
  return results;
}

/** Analyze every supported document in `dir`. */
export async function analyzeFolder(dir: string, opts: { recursive: boolean }): Promise<AnalyzedDocument[]> {
  const files = await listDocuments(dir, opts);
  return analyzeFiles(files.map((f) => f.path));
}

function unreadable(file: string, err: Error): AnalyzedDocument {
  return {
    path: file,
    pages: 0,
    has_text_layer: false,
    classification: { type: "other", confidence: 0, signals: [] },
    warnings: [err.message],
  };
}

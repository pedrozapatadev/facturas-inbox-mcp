/**
 * Zod schemas for tool inputs and outputs. Output schemas are published to the
 * client and the SDK validates every `structuredContent` against them.
 */
import * as z from "zod/v4";
import { DOCUMENT_TYPES } from "./classify.js";

const isoDate = z.iso.date();
const money = z.number().nullable();

export const pathInput = z
  .string()
  .min(1)
  .max(4096)
  .describe("Path to a .pdf or .txt document. Absolute, or relative to the first allowed folder.");

export const folderInput = z
  .string()
  .min(1)
  .max(4096)
  .optional()
  .describe("Folder to read. Absolute, or relative to the first allowed folder. Defaults to the first allowed folder.");

export const classificationSchema = z.object({
  type: z.enum(DOCUMENT_TYPES),
  confidence: z.number().min(0).max(1),
  signals: z.array(z.string()).describe("Evidence that produced the label"),
  alternative: z.enum(DOCUMENT_TYPES).optional().describe("Close runner-up, present only when the document is ambiguous"),
});

export const checkSchema = z.object({
  id: z.enum(["issuer_tax_id", "issue_date", "vat_rate_standard", "vat_math", "irpf_math", "total_math"]),
  passed: z.boolean(),
  detail: z.string(),
});

export const invoiceSchema = z.object({
  invoice_number: z.string().nullable(),
  issue_date: isoDate.nullable(),
  issuer_tax_id: z.string().nullable(),
  recipient_tax_id: z.string().nullable(),
  base_amount: money,
  vat: z.array(z.object({ rate: z.number(), base: z.number().optional(), amount: z.number() })),
  vat_total: money,
  irpf_rate: z.number().nullable(),
  irpf_amount: money,
  total: money,
  currency: z.literal("EUR"),
  checks: z.array(checkSchema),
  status: z.enum(["ok", "needs_review"]),
});

export const scanRowSchema = z.object({
  path: z.string(),
  type: z.enum(DOCUMENT_TYPES),
  confidence: z.number(),
  status: z.enum(["ok", "needs_review", "not_an_invoice", "unreadable"]),
  invoice_number: z.string().nullable(),
  issue_date: isoDate.nullable(),
  issuer_tax_id: z.string().nullable(),
  recipient_tax_id: z.string().nullable(),
  base_amount: money,
  vat_total: money,
  irpf_amount: money,
  total: money,
  failed_checks: z.array(z.string()),
});

const directionTotals = z.object({
  documents: z.number().int(),
  base_amount: z.number(),
  vat_amount: z.number(),
  irpf_amount: z.number(),
  by_rate: z.array(z.object({ rate: z.number(), base_amount: z.number().nullable(), vat_amount: z.number() })),
});

export const vatSummarySchema = z.object({
  own_tax_id: z.string(),
  period: z.object({ from: isoDate, to: isoDate }),
  repercutido: directionTotals.describe("Output VAT: invoices you issued"),
  soportado: directionTotals.describe("Input VAT: invoices you received"),
  net_vat: z.number().describe("repercutido − soportado; positive means VAT to pay"),
  included: z.array(
    z.object({
      path: z.string(),
      direction: z.enum(["issued", "received"]),
      invoice_number: z.string().nullable(),
      issue_date: isoDate,
      total: money,
    }),
  ),
  excluded: z.array(z.object({ path: z.string(), reason: z.string() })),
  out_of_period: z.number().int(),
  disclaimer: z.string(),
});

export const taxIdSchema = z.object({
  input: z.string(),
  normalized: z.string(),
  valid: z.boolean(),
  kind: z.enum(["DNI", "NIE", "NIF_KLM", "CIF"]).nullable(),
  reason: z.string().optional(),
});

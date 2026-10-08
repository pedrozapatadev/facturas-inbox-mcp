# facturas-inbox-mcp

[![CI](https://github.com/pedrozapatadev/facturas-inbox-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/pedrozapatadev/facturas-inbox-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![MCP SDK v2](https://img.shields.io/badge/MCP_SDK-v2-black)
![Node ≥ 20.12](https://img.shields.io/badge/node-%E2%89%A520.12-green)

An [MCP](https://modelcontextprotocol.io) server that turns a folder of Spanish business documents
into validated, structured data an AI agent can reason over. It classifies each PDF (factura,
rectificativa, ticket, nómina, modelo AEAT…), extracts the invoice fields (NIF/CIF, base imponible,
IVA per rate, IRPF, total), **checks the arithmetic and the tax-ID checksums**, and computes the IVA
soportado / repercutido position for a quarter.

Local and offline. No API keys. It reads only the folders you give it.

> Built for the everyday job of a Spanish *gestoría*: a client drops a month of PDFs in a folder and
> someone has to work out what is what, what adds up and what the VAT position is.

## 30-second demo

Claude Code, Sonnet, pointed at the synthetic [`examples/inbox`](examples/inbox) (11 documents,
including a wrong total, a ticket, a credit note, a payslip, a modelo 303 and a scanned page).
Real session; the answer is trimmed for length (full, unedited transcript in [`docs/demo-transcript.md`](docs/demo-transcript.md)):

```text
> I'm the bookkeeper for Gestoría Demo Ficticia SL (CIF B87654323). Process the invoice
  inbox and tell me our IVA position for Q3 2026, and flag anything I need to look at
  by hand. Answer in English, briefly.

  ⏺ facturas - scan_folder {}
  ⏺ facturas - vat_summary {"own_tax_id":"B87654323","quarter":"2026-Q3"}
  ⏺ facturas - validate_tax_id {"tax_id":"B87654323"}

Q3 2026 IVA position: €243.00 to pay (a pagar), provisional.

- IVA repercutido: €504.00, from 1 issued invoice (GD-2026-0088, base €2,400 at 21%)
- IVA soportado: €261.00, from 4 received documents (base €1,400): €231 at 21% and
  €30 at 10%
- The July papelería invoice (€52.50 IVA) is cancelled out by the September credit note.

Check by hand:
1. Papelería PE-2026/0455 (30 Jul): the total says €1,250 but base + IVA comes to
   €1,210. Excluded. If the supplier corrects it, your position drops to about €33.
2. Gasolinera ticket 88213 (14 Aug, €60): IVA not broken out and no recipient NIF.
   Excluded. Probably not deductible without a full invoice.
3. Scanned PDF (5 Sep): no text layer, so it needs OCR or a manual read. It could be
   a missing Q3 invoice.
4. Credit note PE-2026/R-0019: classified at 0.69 confidence. Confirm it really is a
   rectificativa of PE-2026/0412.
5. Laura's advisory invoice (3 Aug): €150 IRPF withheld, which goes on modelo 111,
   not the IVA return.
   …
```

**5 turns · 23 s · $0.13.** Every number comes from a tool result, not from the model doing
arithmetic. Documents that fail a check are excluded and listed with a reason, so nothing is
silently counted or silently dropped.

## Tools

| Tool | What it does | Hints |
|---|---|---|
| `scan_folder` | Classify and extract every document in a folder; one compact row each, paginated with `limit` / `cursor` | read-only |
| `classify_document` | Label one document, with a confidence score and the signals behind the label | read-only |
| `extract_invoice` | Invoice number, date, issuer/recipient NIF, base, VAT lines, IRPF, total, plus every cross-check. `response_format: concise \| detailed` | read-only |
| `validate_tax_id` | NIF / NIE / CIF checksum validation. Says the expected control character when wrong | read-only |
| `vat_summary` | IVA repercutido vs. soportado for a `quarter` (`2026-Q3`) or a `from`/`to` range, by rate, with the exclusions listed | read-only |
| `export_csv` | Write the scan to a new `.csv` file (`;`-separated, decimal comma, opens directly in Spanish Excel). Never overwrites | writes a new file |

Every tool publishes an `outputSchema` and returns `structuredContent`, and the SDK validates both
directions. All tools set full [annotations](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)
(`readOnlyHint`, `destructiveHint: false`, `idempotentHint`, `openWorldHint: false`), so clients can
auto-approve the read-only ones.

### The checks

`extract_invoice` returns `status: "ok"` only when every check passes:

| Check | Rule |
|---|---|
| `issuer_tax_id` | A checksum-valid NIF/NIE/CIF is present before the client section |
| `issue_date` | A real calendar date was found (`15/07/2026`, `22 de septiembre de 2026`, …) |
| `vat_rate_standard` | Every VAT rate is a Spanish rate (0, 4, 5, 10, 21 %) |
| `vat_math` | base × rate = VAT, per rate when the invoice breaks bases out (±1 cent) |
| `irpf_math` | base × IRPF rate = withholding (±1 cent) |
| `total_math` | base + VAT − IRPF = total |

All arithmetic is in integer cents.

## Install

Requires Node.js 20.12 or newer.

### Claude Code

```bash
claude mcp add facturas -- npx -y facturas-inbox-mcp ~/Documents/facturas
```

### Claude Desktop

Add this to `claude_desktop_config.json` (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "facturas": {
      "command": "npx",
      "args": ["-y", "facturas-inbox-mcp", "/Users/you/Documents/facturas"]
    }
  }
}
```

### Any other MCP client

It's a standard stdio server: `npx -y facturas-inbox-mcp <folder> [more folders…]`. Folders can also
come from `FACTURAS_INBOX_DIRS` (separated like `PATH`).

### From source, with the sample inbox

```bash
git clone https://github.com/pedrozapatadev/facturas-inbox-mcp && cd facturas-inbox-mcp
npm install && npm run build
claude mcp add facturas -- node "$PWD/dist/index.js" "$PWD/examples/inbox"
```

Then ask: *"I'm the bookkeeper for CIF B87654323. What's our IVA position for Q3 2026?"*

To poke at the tools without an LLM, run `npm run inspect` (MCP Inspector).

## Design decisions

- **Deterministic core, no model inside.** The agent is already a language model. What it lacks are
  tools whose answers it can trust. Extraction is rule-based and every result carries its evidence:
  classifier signals, check details, warnings. The server can explain itself, and the same input
  always gives the same output.
- **Fail loudly, not silently.** Fields that weren't found are `null`, not guessed. Documents that
  fail a check are excluded from totals *and listed with the reason*. Errors are returned as
  `isError` results that say how to fix the call ("Pass `force: true` to try anyway", "Run OCR
  first").
- **Token-efficient.** `scan_folder` returns compact rows and paginates. `extract_invoice` is concise
  by default. `export_csv` returns a path and counts, not the data.
- **Sandboxed filesystem.** Paths are resolved with `realpath` and must sit inside a folder given at
  startup, so `../` traversal and symlinks that point outside are rejected (and tested). The only
  write is `export_csv`, which creates new `.csv` files and never overwrites.
- **Untrusted document text.** The server instructions tell the agent never to follow instructions
  found inside a document. Raw text is only returned on request, labelled `untrusted_text_preview`.
  CSV cells that start with `=`, `+`, `-` or `@` are neutralized against spreadsheet formula
  injection. Exports are created `0600`.
- **Bounded work per document.** Files are limited to 20 MB and PDFs to 200 pages. Text is cut at
  1M characters before analysis. The extraction regexes are linear-time; a ReDoS case has a
  regression test.
- **Threat model.** The attacker controls document *contents*, not the filesystem. Paths that are
  missing and paths outside the folders get the same error, so the tool can't be used to probe what
  exists elsewhere. Someone who can already write to the inbox could race the check-then-read (a
  TOCTOU window); that is out of scope.
- **stdout is the protocol.** All logging goes to stderr. An end-to-end test drives the built binary
  over real stdio, and it would fail on a stray `console.log`.

## Limitations

Honest scope. This is a showcase-sized tool, not accounting software.

- **PDFs need a text layer.** Scanned images are reported as `unreadable` with an OCR hint
  (e.g. [`ocrmypdf`](https://github.com/ocrmypdf/OCRmyPDF)); there is no built-in OCR.
- **Heuristic extraction** tuned to common Spanish invoice layouts (labelled fields like
  *Base imponible*, *IVA 21 %*, *Total factura*). Unusual layouts come back as `needs_review`
  rather than wrong.
- **Not handled yet:** recargo de equivalencia, intra-EU / reverse-charge invoices, Facturae XML, and
  counterparty names (only tax IDs).
- **Checksum validation only.** A valid NIF is well-formed; it is not confirmed as registered with
  AEAT or VIES.
- **Not an e-invoicing or VeriFactu tool.** It reads received paperwork; it does not issue invoices
  or file returns. `vat_summary` is a working figure for review, not a modelo 303.

## Development

```bash
npm install
npm run fixtures    # regenerate examples/inbox (synthetic data, valid-checksum fictional IDs)
npm run typecheck
npm test            # unit + in-memory MCP client + stdio end-to-end (build first for the e2e)
npm run build
npm run inspect     # MCP Inspector UI against the sample inbox
```

```
src/
  index.ts        stdio entry point, CLI args → allowed folders
  server.ts       the six tools: schemas, annotations, error mapping
  schemas.ts      zod input/output schemas
  pipeline.ts     read → classify → extract, shared by all tools
  classify.ts     rule-based document classifier with explainable signals
  extract.ts      invoice field extraction + arithmetic checks
  taxid.ts        NIF / NIE / CIF validation
  amounts.ts      Spanish amounts and dates, in integer cents
  vat-summary.ts  repercutido / soportado aggregation
  documents.ts    sandboxed filesystem + PDF text extraction
  csv.ts          Excel-friendly CSV export
test/             MCP-level tests (in-memory client, stdio e2e, sandbox escapes)
```

Built on the official [MCP TypeScript SDK v2](https://ts.sdk.modelcontextprotocol.io/v2/) (`@modelcontextprotocol/server`),
[zod](https://zod.dev) and [unpdf](https://github.com/unjs/unpdf).

## Roadmap

- Optional OCR pass for scanned documents
- Counterparty names, recargo de equivalencia, intra-EU invoices
- Facturae XML input
- VIES lookup as an opt-in, clearly network-marked tool
- Streamable HTTP transport for remote deployment

## License

[MIT](LICENSE) © 2026 Pedro Zapata Medal. All sample documents are synthetic: the companies, people
and tax IDs are fictional.

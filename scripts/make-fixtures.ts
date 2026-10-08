/**
 * Generates the synthetic sample inbox in examples/inbox/.
 * Every company, person and tax ID here is fictional; tax IDs are generated
 * with valid checksums so the extractor treats them like real ones.
 *
 *   npx tsx scripts/make-fixtures.ts
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

const OUT = path.resolve(import.meta.dirname, "../examples/inbox");

/** Build a checksum-valid CIF from an org letter and 7 digits. */
function cif(org: string, digits: string): string {
  let sum = 0;
  for (let i = 0; i < 7; i++) {
    const d = Number(digits[i]);
    sum += i % 2 === 0 ? Math.floor((d * 2) / 10) + ((d * 2) % 10) : d;
  }
  const control = (10 - (sum % 10)) % 10;
  return `${org}${digits}${"PQRSNW".includes(org) ? "JABCDEFGHI"[control] : control}`;
}

const OWN = { name: "Gestoría Demo Ficticia SL", id: cif("B", "8765432"), addr: "Calle Inventada 12, 28013 Madrid" };
const PAPELERIA = { name: "Papelería El Ejemplo SL", id: cif("B", "1234567"), addr: "Av. Imaginaria 4, 46001 Valencia" };
const CATERING = { name: "Catering La Muestra SA", id: cif("A", "7654321"), addr: "Plaza Ficción 9, 41001 Sevilla" };
const CLIENTE = { name: "Talleres Prueba SL", id: cif("B", "2468024"), addr: "Polígono Supuesto 3, 50001 Zaragoza" };
const FREELANCE = { name: "Laura Ejemplo Pérez", id: "12345678Z", addr: "Calle Hipotética 7, 28004 Madrid" };

type Line = string | [string, string];
interface Party { name: string; id: string; addr: string }

function invoice(o: {
  title?: string; number: string; date: string; from: Party; to: Party;
  items: [string, string][]; totals: [string, string][]; note?: string;
}): Line[] {
  return [
    o.from.name, `NIF: ${o.from.id}`, o.from.addr, "",
    o.title ?? "FACTURA", ["Nº factura:", o.number], ["Fecha de expedición:", o.date], "",
    "Cliente:", o.to.name, `NIF: ${o.to.id}`, o.to.addr, "",
    ["Concepto", "Importe"], ...o.items, "",
    ...o.totals, ...(o.note ? ["", o.note] : []),
  ];
}

const DOCS: Record<string, Line[]> = {
  "2026-07-15_papeleria-el-ejemplo.pdf": invoice({
    number: "PE-2026/0412", date: "15/07/2026", from: PAPELERIA, to: OWN,
    items: [["Material de oficina (lote trimestral)", "250,00 €"]],
    totals: [["Base imponible:", "250,00 €"], ["IVA 21%:", "52,50 €"], ["Total factura:", "302,50 €"]],
  }),
  "2026-08-03_laura-ejemplo-asesoria.pdf": invoice({
    number: "2026-031", date: "03/08/2026", from: FREELANCE, to: OWN,
    items: [["Asesoría laboral, julio 2026", "1.000,00 €"]],
    totals: [["Base imponible:", "1.000,00 €"], ["IVA 21%:", "210,00 €"], ["Retención IRPF 15%:", "-150,00 €"], ["Total a pagar:", "1.060,00 €"]],
  }),
  "2026-09-10_emitida-talleres-prueba.pdf": invoice({
    number: "GD-2026-0088", date: "10/09/2026", from: OWN, to: CLIENTE,
    items: [["Gestión contable y fiscal, Q3 2026", "2.400,00 €"]],
    totals: [["Base imponible:", "2.400,00 €"], ["IVA 21%:", "504,00 €"], ["Total factura:", "2.904,00 €"]],
  }),
  "2026-09-22_catering-la-muestra.pdf": invoice({
    number: "CLM/26/1907", date: "22 de septiembre de 2026", from: CATERING, to: OWN,
    items: [["Menú cierre de trimestre (30 pax)", "300,00 €"], ["Bebidas", "100,00 €"]],
    totals: [["Base imponible:", "400,00 €"], ["IVA 10% (300,00):", "30,00 €"], ["IVA 21% (100,00):", "21,00 €"], ["Total factura:", "451,00 €"]],
  }),
  "2026-09-28_rectificativa-papeleria.pdf": invoice({
    title: "FACTURA RECTIFICATIVA", number: "PE-2026/R-0019", date: "28/09/2026", from: PAPELERIA, to: OWN,
    items: [["Abono por devolución del lote PE-2026/0412", "-250,00 €"]],
    totals: [["Base imponible:", "-250,00 €"], ["IVA 21%:", "-52,50 €"], ["Total factura:", "-302,50 €"]],
    note: "Rectifica a la factura PE-2026/0412 (art. 80 LIVA).",
  }),
  "2026-07-30_papeleria-total-erroneo.pdf": invoice({
    number: "PE-2026/0455", date: "30/07/2026", from: PAPELERIA, to: OWN,
    items: [["Tóner y papel", "1.000,00 €"]],
    totals: [["Base imponible:", "1.000,00 €"], ["IVA 21%:", "210,00 €"], ["Total factura:", "1.250,00 €"]],
  }),
  "2026-06-20_papeleria-q2.pdf": invoice({
    number: "PE-2026/0301", date: "20/06/2026", from: PAPELERIA, to: OWN,
    items: [["Material de oficina", "80,00 €"]],
    totals: [["Base imponible:", "80,00 €"], ["IVA 21%:", "16,80 €"], ["Total factura:", "96,80 €"]],
  }),
  "2026-08-14_ticket-gasolinera.pdf": [
    "ESTACIÓN DE SERVICIO FICTICIA", `NIF: ${cif("B", "1357913")}`, "FACTURA SIMPLIFICADA", "Ticket nº 88213",
    "Fecha: 14/08/2026 09:41", "", ["Gasóleo A 42,10 L", "60,00 €"], ["Total (IVA incluido)", "60,00 €"],
    "IVA 21% incluido", "Pago con tarjeta",
  ],
  "2026-07-31_nomina-julio.pdf": [
    "RECIBO DE SALARIOS (NÓMINA)", `Empresa: ${OWN.name}`, `CIF: ${OWN.id}`, "Trabajador: Persona Ficticia Uno",
    "Periodo de liquidación: 01/07/2026 a 31/07/2026", "", "I. DEVENGOS", ["Salario base", "1.800,00"],
    "II. DEDUCCIONES", ["Contingencias comunes 4,70%", "84,60"], ["Retención IRPF 12%", "216,00"], "",
    ["LÍQUIDO A PERCIBIR", "1.499,40"],
  ],
  "2026-07-20_modelo-303-2T.pdf": [
    "Agencia Tributaria", "Modelo 303. IVA. Autoliquidación", `NIF: ${OWN.id}`, "Ejercicio: 2026  Periodo: 2T", "",
    ["Total cuota devengada", "3.150,00"], ["Total a deducir", "1.020,00"], ["Resultado", "2.130,00"],
  ],
};

async function render(lines: Line[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]); // A4
  const font = await doc.embedFont(StandardFonts.Helvetica);
  let y = 790;
  for (const line of lines) {
    const [left, right] = typeof line === "string" ? [line, undefined] : line;
    page.drawText(left, { x: 56, y, size: 10, font, color: rgb(0.1, 0.1, 0.1) });
    if (right) page.drawText(right, { x: 539 - font.widthOfTextAtSize(right, 10), y, size: 10, font });
    y -= 16;
  }
  doc.setProducer("facturas-inbox-mcp fixtures");
  doc.setCreationDate(new Date("2026-01-01T00:00:00Z"));
  doc.setModificationDate(new Date("2026-01-01T00:00:00Z"));
  return doc.save();
}

/** A "scanned" page: only graphics, no text layer. */
async function renderScan(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  for (let i = 0; i < 30; i++) page.drawRectangle({ x: 56, y: 780 - i * 22, width: 200 + ((i * 37) % 280), height: 8, color: rgb(0.6, 0.6, 0.6) });
  doc.setCreationDate(new Date("2026-01-01T00:00:00Z"));
  doc.setModificationDate(new Date("2026-01-01T00:00:00Z"));
  return doc.save();
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
for (const [name, lines] of Object.entries(DOCS)) await writeFile(path.join(OUT, name), await render(lines));
await writeFile(path.join(OUT, "2026-09-05_escaneo-sin-texto.pdf"), await renderScan());
console.log(`Wrote ${Object.keys(DOCS).length + 1} documents to ${path.relative(process.cwd(), OUT)}`);
console.log(`Own company tax ID (use as own_tax_id): ${OWN.id}`);

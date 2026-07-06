// Single PDF generator seam. Modules that need a PDF (invoices, receipts,
// statements, reports) call renderPdf(doc) → PDF bytes. Uses pdf-lib (pure JS —
// no native binary, so NO external_node_modules entry).
//
// WinAnsi gotcha: pdf-lib's StandardFonts can't encode ₹ / smart quotes / em-dash
// and drawText THROWS on them. winAnsiSafe() maps the common offenders and drops
// anything else, so a caller passing currency-formatted text (e.g. "₹620.00")
// never blows up.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

export interface PdfKeyValue { label: string; value: string }

export interface PdfDoc {
  title?: string;                // document metadata title
  heading?: string;              // large heading on the first page
  meta?: PdfKeyValue[];          // header block, e.g. Invoice # / Date
  bodyLines?: string[];          // free text, one line each
  rows?: PdfKeyValue[];          // right-aligned two-column table (label … value)
  footer?: string;               // small footer at the bottom of the last page
}

function winAnsiSafe(s: string): string {
  return s
    .replace(/₹/g, 'Rs ')
    .replace(/€/g, 'EUR ')
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
    .replace(/[–—]/g, '-')
    // drop anything still outside the Latin-1 range StandardFonts can encode
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '');
}

const A4 = { w: 595.28, h: 841.89 };
const MARGIN = 56;

export async function renderPdf(doc: PdfDoc): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  if (doc.title) pdf.setTitle(winAnsiSafe(doc.title));
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const ink = rgb(0.1, 0.1, 0.12);
  const muted = rgb(0.42, 0.42, 0.46);

  let page: PDFPage = pdf.addPage([A4.w, A4.h]);
  let y = A4.h - MARGIN;

  const ensure = (need: number) => {
    if (y - need < MARGIN + 24) { page = pdf.addPage([A4.w, A4.h]); y = A4.h - MARGIN; }
  };
  const line = (s: string, size: number, f: PDFFont, color = ink) => {
    ensure(size + 6);
    page.drawText(winAnsiSafe(s), { x: MARGIN, y, size, font: f, color });
    y -= size + 6;
  };

  if (doc.heading) { line(doc.heading, 20, bold); y -= 6; }

  for (const m of doc.meta ?? []) {
    ensure(16);
    page.drawText(winAnsiSafe(m.label), { x: MARGIN, y, size: 10, font, color: muted });
    page.drawText(winAnsiSafe(m.value), { x: MARGIN + 140, y, size: 10, font: bold, color: ink });
    y -= 16;
  }
  if ((doc.meta ?? []).length) y -= 8;

  for (const l of doc.bodyLines ?? []) line(l, 11, font);
  if ((doc.bodyLines ?? []).length) y -= 6;

  for (const r of doc.rows ?? []) {
    ensure(18);
    const value = winAnsiSafe(r.value);
    const vw = bold.widthOfTextAtSize(value, 11);
    page.drawText(winAnsiSafe(r.label), { x: MARGIN, y, size: 11, font, color: ink });
    page.drawText(value, { x: A4.w - MARGIN - vw, y, size: 11, font: bold, color: ink });
    y -= 18;
  }

  if (doc.footer) {
    page.drawText(winAnsiSafe(doc.footer), { x: MARGIN, y: 30, size: 9, font, color: muted });
  }

  return pdf.save();
}

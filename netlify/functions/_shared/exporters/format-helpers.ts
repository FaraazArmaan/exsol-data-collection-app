import type { ExportProductRow } from './types';

/** "19.99 USD" style for Meta. */
export function metaPrice(cents: number, currency: string): string {
  return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
}

/** Plain "19.99" for Amazon (currency from marketplace). */
export function plainPrice(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** Meta availability vocab uses spaces. */
export function metaAvailability(a: ExportProductRow['availability']): string {
  switch (a) {
    case 'in_stock':       return 'in stock';
    case 'out_of_stock':   return 'out of stock';
    case 'preorder':       return 'preorder';
    case 'discontinued':   return 'discontinued';
  }
}

/** Amazon condition codes (Inventory Loader). */
export function amazonConditionCode(c: ExportProductRow['condition']): string {
  switch (c) {
    case 'new':          return '11';
    case 'refurbished':  return '2';
    case 'used':         return '6';   // used-very-good as a default
  }
}

/** ISO-8601 range used by Meta `sale_price_effective_date`. */
export function metaSaleDateRange(start: string | null, end: string | null): string | null {
  if (!start && !end) return null;
  return `${start ?? ''}/${end ?? ''}`;
}

/** Generate a safe filename stem for image filenames inside the ZIP. */
export function imageStem(row: ExportProductRow): string {
  return (row.sku ?? row.id).replace(/[^a-zA-Z0-9_-]/g, '_');
}

/** Image filename for the nth image (0 = main). */
export function imageFilename(row: ExportProductRow, index: number, ext = 'jpg'): string {
  return index === 0
    ? `images/${imageStem(row)}_main.${ext}`
    : `images/${imageStem(row)}_${index}.${ext}`;
}

/** CSV escape: wrap in quotes if contains comma/quote/newline; double quotes inside. */
export function csvEscape(v: string | number | null | undefined): string {
  if (v == null) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** TSV escape: replace tabs/newlines with spaces (Amazon TSV is strict). */
export function tsvEscape(v: string | number | null | undefined): string {
  if (v == null) return '';
  return String(v).replace(/[\t\n\r]/g, ' ');
}

// Generator must run under TZ=UTC so the XLSX serials encode UTC wall-clock times.
// XLSX serializes Date cells in the writer's local time; on a non-UTC machine
// the serial integer can land on the next calendar day for end-of-day UTC dates.
// Regenerate with: TZ=UTC npx tsx scripts/gen-phase-b-dates-fixture.ts

import * as XLSX from 'xlsx';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const aoa = [
  ['sku', 'name', 'type', 'price', 'sale_starts_at', 'sale_ends_at'],
  ['W-1', 'Widget', 'physical', 10, new Date('2026-08-01T00:00:00Z'), new Date('2026-08-31T23:59:59Z')],
];
const sheet = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, sheet, 'Sheet1');
const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
writeFileSync(join(process.cwd(), 'tests/fixtures/products/import-phase-b-dates.xlsx'), buf);
console.log('wrote import-phase-b-dates.xlsx');

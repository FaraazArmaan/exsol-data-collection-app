import JSZip from 'jszip';
import type { DomainResponse, Unit } from './types';

// Client-side export of a domain's loaded aggregates (KPIs + each breakdown).
// Uniform across all five domains — no per-domain server endpoint needed, and it
// exports exactly what the panel shows. (The Sales domain also has a richer
// server-side raw-row export at /api/analytics-sales-export.)

function cell(v: unknown): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function num(value: number, unit: Unit): string {
  return unit === 'cents' ? (value / 100).toFixed(2) : String(value);
}

export function buildDomainCsv(title: string, data: DomainResponse): string {
  const lines: string[] = [];
  lines.push(cell(`${title} analytics`));
  lines.push('');
  lines.push('KPI,Value');
  for (const k of data.kpis) lines.push(`${cell(k.label)},${num(k.value, k.unit)}`);
  for (const b of data.breakdowns) {
    lines.push('');
    lines.push(`${cell(b.label)},Value,%`);
    for (const r of b.rows) lines.push(`${cell(r.key)},${num(r.value, b.unit)},${r.pct.toFixed(1)}`);
  }
  return lines.join('\n');
}

function baseName(title: string, data: DomainResponse): string {
  const day = (data.generatedAt || '').slice(0, 10) || 'export';
  return `${title.toLowerCase()}-${day}`;
}

// Build a ZIP whose single entry is `<base>.csv`. Exposed (with a selectable
// output type) so tests can unzip and verify the CSV without a DOM.
export async function domainZipBytes<T extends 'blob' | 'uint8array'>(
  title: string,
  data: DomainResponse,
  type: T,
): Promise<{ base: string; bytes: T extends 'blob' ? Blob : Uint8Array }> {
  const base = baseName(title, data);
  const zip = new JSZip();
  zip.file(`${base}.csv`, buildDomainCsv(title, data));
  const bytes = (await zip.generateAsync({ type, compression: 'DEFLATE' })) as any;
  return { base, bytes };
}

// Zip the CSV and download it. Zipping matches the platform's export convention
// (u-products-export / workspace-export) and guarantees a typed .zip the OS
// opens; the CSV inside carries a real .csv name. The revoke is DEFERRED —
// revoking the object URL synchronously after click() aborts the download in
// Chromium and leaves an untyped, UUID-named file (the bug this replaces).
export async function downloadDomainZip(title: string, data: DomainResponse): Promise<void> {
  const { base, bytes } = await domainZipBytes(title, data, 'blob');
  const url = URL.createObjectURL(bytes);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${base}.zip`;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

import type { DomainResponse, Unit } from './types';

// Client-side CSV export of a domain's loaded aggregates (KPIs + each
// breakdown). Uniform across all five domains — no per-domain server endpoint
// needed, and it exports exactly what the panel shows. (The Sales domain also
// has a richer server-side raw-row export at /api/analytics-sales-export.)

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

export function downloadDomainCsv(title: string, data: DomainResponse): void {
  const blob = new Blob([buildDomainCsv(title, data)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${title.toLowerCase()}-${data.generatedAt.slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

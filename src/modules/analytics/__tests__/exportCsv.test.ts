import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { buildDomainCsv, domainZipBytes } from '../exportCsv';
import type { DomainResponse } from '../shared/types';

const data: DomainResponse = {
  scope: { isRootScope: true, nodeCount: 0 },
  kpis: [
    { id: 'revenue', label: 'Revenue', value: 250000, unit: 'cents' },
    { id: 'sales', label: 'Sales', value: 7, unit: 'count' },
  ],
  series: [],
  breakdowns: [
    { id: 'by_channel', label: 'By channel', unit: 'cents', viz: 'bar',
      rows: [{ key: 'instore', value: 250000, pct: 100 }] },
  ],
  generatedAt: '2026-07-01T10:00:00.000Z',
};

describe('buildDomainCsv', () => {
  it('renders KPI rows with cents as rupees and counts as integers', () => {
    const csv = buildDomainCsv('Sales', data);
    expect(csv).toContain('Revenue,2500.00');
    expect(csv).toContain('Sales,7');
  });
  it('renders each breakdown as its own section', () => {
    const csv = buildDomainCsv('Sales', data);
    expect(csv).toContain('By channel,Value,%');
    expect(csv).toContain('instore,2500.00,100.0');
  });
  it('escapes commas in labels', () => {
    const csv = buildDomainCsv('Sales', {
      ...data,
      breakdowns: [{ id: 'x', label: 'X', unit: 'count', viz: 'table',
        rows: [{ key: 'A, B', value: 1, pct: 100 }] }],
    });
    expect(csv).toContain('"A, B",1,100.0');
  });
});

describe('domainZipBytes', () => {
  it('produces a valid ZIP containing a working .csv with the data', async () => {
    const { base, bytes } = await domainZipBytes('Sales', data, 'uint8array');
    expect(base).toBe('sales-2026-07-01');
    const zip = await JSZip.loadAsync(bytes);
    const names = Object.keys(zip.files);
    expect(names).toContain('sales-2026-07-01.csv');
    const csv = await zip.file('sales-2026-07-01.csv')!.async('string');
    expect(csv).toContain('Revenue,2500.00');
    expect(csv).toContain('instore,2500.00,100.0');
  });
});

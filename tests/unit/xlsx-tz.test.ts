import { describe, expect, test } from 'vitest';
import * as XLSX from 'xlsx';
import { readDateOnlyCell } from '../../src/lib/xlsx-tz';

describe('readDateOnlyCell — empty input', () => {
  test('null → { yyyymmdd: null }', () => {
    expect(readDateOnlyCell(null)).toEqual({ yyyymmdd: null });
  });

  test('undefined → { yyyymmdd: null }', () => {
    expect(readDateOnlyCell(undefined)).toEqual({ yyyymmdd: null });
  });

  test('empty string → { yyyymmdd: null }', () => {
    expect(readDateOnlyCell('')).toEqual({ yyyymmdd: null });
  });

  test('whitespace-only string → { yyyymmdd: null }', () => {
    expect(readDateOnlyCell('   ')).toEqual({ yyyymmdd: null });
  });
});

describe('readDateOnlyCell — Date object (cellDates: true path)', () => {
  test('UTC-midnight Date returns wall-clock YYYY-MM-DD', () => {
    const d = new Date(Date.UTC(2026, 5, 12));
    expect(readDateOnlyCell(d)).toEqual({ yyyymmdd: '2026-06-12' });
  });

  test('year-boundary Date zero-pads correctly', () => {
    const d = new Date(Date.UTC(2026, 0, 1));
    expect(readDateOnlyCell(d)).toEqual({ yyyymmdd: '2026-01-01' });
  });

  test('leap day', () => {
    const d = new Date(Date.UTC(2024, 1, 29));
    expect(readDateOnlyCell(d)).toEqual({ yyyymmdd: '2024-02-29' });
  });

  test('invalid Date (NaN time) → invalid_date', () => {
    const d = new Date('not a date');
    expect(readDateOnlyCell(d)).toEqual({ yyyymmdd: null, error: 'invalid_date' });
  });
});

describe('readDateOnlyCell — Excel serial number', () => {
  test('integer serial decodes via SSF', () => {
    const serial = 45820;
    const parts = XLSX.SSF.parse_date_code(serial);
    const expected = `${parts!.y}-${String(parts!.m).padStart(2, '0')}-${String(parts!.d).padStart(2, '0')}`;
    expect(readDateOnlyCell(serial)).toEqual({ yyyymmdd: expected });
  });

  test('serial with fractional IST offset (Math.floor strips it)', () => {
    const integer = 45820;
    const withOffset = integer + 5.5 / 24;
    const parts = XLSX.SSF.parse_date_code(integer);
    const expected = `${parts!.y}-${String(parts!.m).padStart(2, '0')}-${String(parts!.d).padStart(2, '0')}`;
    expect(readDateOnlyCell(withOffset)).toEqual({ yyyymmdd: expected });
  });

  test('out-of-range serial → invalid_serial', () => {
    expect(readDateOnlyCell(-1)).toEqual({ yyyymmdd: null, error: 'invalid_serial' });
  });
});

describe('readDateOnlyCell — string', () => {
  test('YYYY-MM-DD literal is passed through', () => {
    expect(readDateOnlyCell('2026-06-12')).toEqual({ yyyymmdd: '2026-06-12' });
  });

  test('full ISO at midnight UTC → date portion', () => {
    expect(readDateOnlyCell('2026-06-12T00:00:00.000Z')).toEqual({ yyyymmdd: '2026-06-12' });
  });

  test('full ISO with IST offset (13:00:00Z) → same UTC date', () => {
    expect(readDateOnlyCell('2026-06-12T18:30:00+05:30')).toEqual({ yyyymmdd: '2026-06-12' });
  });

  test('garbage string → invalid_date', () => {
    expect(readDateOnlyCell('not a date')).toEqual({ yyyymmdd: null, error: 'invalid_date' });
  });
});

describe('readDateOnlyCell — type guard', () => {
  test('boolean → invalid_type', () => {
    expect(readDateOnlyCell(true)).toEqual({ yyyymmdd: null, error: 'invalid_type' });
  });

  test('object → invalid_type', () => {
    expect(readDateOnlyCell({ year: 2026 })).toEqual({ yyyymmdd: null, error: 'invalid_type' });
  });

  test('array → invalid_type', () => {
    expect(readDateOnlyCell([2026, 6, 12])).toEqual({ yyyymmdd: null, error: 'invalid_type' });
  });
});

import { describe, it, expect } from 'vitest';
import { isValidIdentifier, isValidSchemaName, safeQuoteIdent, safeQuoteSchema, generateSchemaName } from '../../netlify/functions/_shared/identifier';

describe('isValidIdentifier', () => {
  it.each(['x', 'owners', 'a1', 'snake_case', 'a'.repeat(63)])('accepts %s', (s) => {
    expect(isValidIdentifier(s)).toBe(true);
  });
  it.each([
    '', '1leading', 'Mixed', 'has space', 'has-dash', "drop;--", '"quoted"', 'a'.repeat(64), '_leading',
  ])('rejects %s', (s) => {
    expect(isValidIdentifier(s)).toBe(false);
  });
});

describe('isValidSchemaName', () => {
  it('accepts client_<32hex>', () => {
    expect(isValidSchemaName('client_' + 'a'.repeat(32))).toBe(true);
    expect(isValidSchemaName('client_0123456789abcdef0123456789abcdef')).toBe(true);
  });
  it.each([
    'client_', 'client_a', 'client_' + 'g'.repeat(32), 'client_' + 'A'.repeat(32),
    'CLIENT_' + 'a'.repeat(32), 'public', 'client_' + 'a'.repeat(33),
  ])('rejects %s', (s) => {
    expect(isValidSchemaName(s)).toBe(false);
  });
});

describe('safeQuoteIdent', () => {
  it('wraps a valid identifier in double quotes', () => {
    expect(safeQuoteIdent('owners')).toBe('"owners"');
  });
  it('throws on invalid identifier', () => {
    expect(() => safeQuoteIdent('drop table x; --')).toThrow(/invalid_identifier/);
  });
  it('throws on empty', () => {
    expect(() => safeQuoteIdent('')).toThrow(/invalid_identifier/);
  });
});

describe('safeQuoteSchema and generateSchemaName', () => {
  it('safeQuoteSchema wraps a valid schema name in double quotes', () => {
    expect(safeQuoteSchema('client_' + 'a'.repeat(32))).toBe('"client_' + 'a'.repeat(32) + '"');
  });
  it('safeQuoteSchema throws on invalid schema name', () => {
    expect(() => safeQuoteSchema('public')).toThrow(/invalid_schema_name/);
  });
  it('generateSchemaName with custom rand returns client_<hex>', () => {
    expect(generateSchemaName(() => 'a'.repeat(32))).toBe('client_' + 'a'.repeat(32));
  });
  it('generateSchemaName with default rand returns a valid schema name', () => {
    const name = generateSchemaName();
    expect(isValidSchemaName(name)).toBe(true);
  });
});

import { describe, test, expect } from 'vitest';
import { parseCsv } from '../../src/modules/shared/team-modals/csv-parser';

describe('parseCsv', () => {
  test('parses header + 3 rows into typed objects', () => {
    const text = [
      'display_name,role_key,level_number,email,create_login,temp_password',
      'Alice,owner,1,alice@example.com,true,abc12345',
      'Bob,manager,2,bob@example.com,false,',
      'Carol,staff,3,,false,',
    ].join('\n');
    const result = parseCsv(text);
    expect(result.parseErrors).toEqual([]);
    expect(result.rows).toHaveLength(3);
    expect(result.rows[0]).toEqual({
      display_name: 'Alice',
      role_key: 'owner',
      level_number: 1,
      email: 'alice@example.com',
      create_login: true,
      temp_password: 'abc12345',
      parent_email: null,
      phone: null,
      notes: null,
    });
    expect(result.rows[1]!.level_number).toBe(2);
    expect(result.rows[1]!.create_login).toBe(false);
    expect(result.rows[2]!.email).toBeNull();
  });

  test('handles quoted field with embedded comma', () => {
    const text = [
      'display_name,role_key',
      '"Smith, John",owner',
    ].join('\n');
    const result = parseCsv(text);
    expect(result.parseErrors).toEqual([]);
    expect(result.rows[0]!.display_name).toBe('Smith, John');
  });

  test('handles quoted field with escaped double-quote', () => {
    const text = [
      'display_name,role_key,notes',
      'Alice,owner,"She said ""hi"""',
    ].join('\n');
    const result = parseCsv(text);
    expect(result.parseErrors).toEqual([]);
    expect(result.rows[0]!.notes).toBe('She said "hi"');
  });

  test('flags missing required column display_name', () => {
    const text = [
      'role_key,email',
      'owner,alice@example.com',
    ].join('\n');
    const result = parseCsv(text);
    expect(result.rows).toHaveLength(0);
    expect(result.parseErrors[0]!.message).toMatch(/display_name/);
  });

  test('ignores trailing blank line and trailing comma', () => {
    const text = [
      'display_name,role_key,',
      'Alice,owner,',
      '',
    ].join('\n');
    const result = parseCsv(text);
    expect(result.parseErrors).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.display_name).toBe('Alice');
  });

  test('soft-warns on unknown extra column', () => {
    const text = [
      'display_name,role_key,foobar',
      'Alice,owner,whatever',
    ].join('\n');
    const result = parseCsv(text);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.display_name).toBe('Alice');
    expect(result.parseErrors.some((e) => /unknown/i.test(e.message) && /foobar/.test(e.message))).toBe(true);
  });
});

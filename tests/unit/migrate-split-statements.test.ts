import { describe, expect, test } from 'vitest';
import { splitStatements } from '../../scripts/migrate';

describe('splitStatements', () => {
  test('header comment block preceding a statement keeps the statement', () => {
    const sql =
      '-- header\n-- another header line\nALTER TABLE x ALTER COLUMN y DROP NOT NULL;';
    const result = splitStatements(sql);
    expect(result).toEqual(['ALTER TABLE x ALTER COLUMN y DROP NOT NULL']);
  });

  test('two statements each preceded by a header comment yields both', () => {
    const sql = '-- first\nSTMT_A;\n-- second\nSTMT_B;';
    const result = splitStatements(sql);
    expect(result).toEqual(['STMT_A', 'STMT_B']);
  });

  test('trailing comment-only chunk is dropped', () => {
    const sql = 'STMT_A;\n-- trailing thoughts';
    const result = splitStatements(sql);
    expect(result).toEqual(['STMT_A']);
  });

  test('empty file returns no statements', () => {
    expect(splitStatements('')).toEqual([]);
    expect(splitStatements('   \n\n   ')).toEqual([]);
  });

  test('file containing $$ is passed through as a single statement', () => {
    const sql = '-- header\nCREATE FUNCTION f() RETURNS void AS $$ BEGIN; END; $$ LANGUAGE plpgsql;';
    const result = splitStatements(sql);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('$$');
  });

  test('blank lines between comments and SQL are also stripped', () => {
    const sql = '-- header\n\n-- more\n\nSELECT 1;';
    expect(splitStatements(sql)).toEqual(['SELECT 1']);
  });
});

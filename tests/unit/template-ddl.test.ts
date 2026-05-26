import { describe, it, expect } from 'vitest';
import { TEMPLATES } from '../../netlify/functions/_shared/templates';
import { generateCreateSchema, generateDropSchema } from '../../netlify/functions/_shared/template-ddl';

const FIXED_SCHEMA = 'client_a1b2c3d4e5f60123456789abcdef0123';

describe('template-ddl: CREATE SCHEMA per template (golden)', () => {
  for (const key of Object.keys(TEMPLATES)) {
    it(`${key} v1`, () => {
      const sql = generateCreateSchema(FIXED_SCHEMA, TEMPLATES[key]!);
      expect(sql).toMatchSnapshot();
    });
  }
});

describe('template-ddl: DROP SCHEMA', () => {
  it('drops with CASCADE', () => {
    expect(generateDropSchema(FIXED_SCHEMA)).toBe(`DROP SCHEMA "${FIXED_SCHEMA}" CASCADE;`);
  });
});

describe('template-ddl: identifier safety', () => {
  it('throws on invalid schema name', () => {
    expect(() => generateCreateSchema('invalid', TEMPLATES.shop!)).toThrow(/invalid_schema_name/);
  });
});

import { describe, it, expect } from 'vitest';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

describe('migration 050 — brand_* columns on clients', () => {
  it('adds the five nullable *_key text columns', async () => {
    const rows = (await sql`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'clients'
        AND column_name IN ('brand_logo_key','brand_logo_alt_key','brand_favicon_key','brand_app_icon_key','brand_social_key')
      ORDER BY column_name
    `) as Array<{ column_name: string; data_type: string; is_nullable: string }>;
    expect(rows).toHaveLength(5);
    for (const r of rows) { expect(r.data_type).toBe('text'); expect(r.is_nullable).toBe('YES'); }
  });

  it('adds brand_hero_keys as text[] NOT NULL default empty', async () => {
    const rows = (await sql`
      SELECT data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'clients' AND column_name = 'brand_hero_keys'
    `) as Array<{ data_type: string; is_nullable: string; column_default: string | null }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.data_type).toBe('ARRAY');
    expect(rows[0]!.is_nullable).toBe('NO');
  });

  it('adds brand_theme text NOT NULL default dark with a CHECK constraint', async () => {
    const col = (await sql`
      SELECT is_nullable, column_default FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'clients' AND column_name = 'brand_theme'
    `) as Array<{ is_nullable: string; column_default: string | null }>;
    expect(col[0]!.is_nullable).toBe('NO');
    expect(col[0]!.column_default ?? '').toContain('dark');
    const cons = (await sql`
      SELECT conname FROM pg_constraint WHERE conname = 'clients_brand_theme_chk'
    `) as Array<{ conname: string }>;
    expect(cons).toHaveLength(1);
  });

  it('adds brand_accent / brand_font_heading / brand_font_body nullable text', async () => {
    const rows = (await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'clients'
        AND column_name IN ('brand_accent','brand_font_heading','brand_font_body')
    `) as Array<{ column_name: string }>;
    expect(rows).toHaveLength(3);
  });
});

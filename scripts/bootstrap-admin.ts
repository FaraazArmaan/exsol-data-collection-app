#!/usr/bin/env tsx
import { neon } from '@neondatabase/serverless';
import { hash } from '@node-rs/argon2';

async function main() {
  const url = process.env.DATABASE_URL;
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL;
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  const missing = (['DATABASE_URL', 'BOOTSTRAP_ADMIN_EMAIL', 'BOOTSTRAP_ADMIN_PASSWORD'] as const).filter(
    (k) => !process.env[k],
  );
  if (missing.length > 0) {
    throw new Error(`missing required env var(s): ${missing.join(', ')}`);
  }
  if (password!.length < 8) {
    throw new Error(`BOOTSTRAP_ADMIN_PASSWORD must be at least 8 characters (got ${password!.length})`);
  }
  const sql = neon(url!);
  const passwordHash = await hash(password!);

  // Upsert by email: insert if absent, else update password_hash only (preserves google_sub).
  const rows = (await sql`
    INSERT INTO public.admins (email, password_hash, display_name, is_bootstrap)
    VALUES (${email!}, ${passwordHash}, 'ExSol Admin', true)
    ON CONFLICT (email) DO UPDATE
      SET password_hash = EXCLUDED.password_hash,
          updated_at    = now()
    RETURNING id, (xmax = 0) AS created
  `) as { id: string; created: boolean }[];
  const row = rows[0];
  if (!row) throw new Error('upsert returned no row');
  console.log(row.created ? `✓ created bootstrap admin ${email} (id=${row.id})` : `✓ updated bootstrap admin password for ${email}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

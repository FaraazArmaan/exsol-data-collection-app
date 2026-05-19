import { Pool } from '@neondatabase/serverless';
import { hash as argonHash } from '@node-rs/argon2';

const url = process.env.NEON_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
const adminEmail = process.env.ADMIN_GOOGLE_EMAIL?.toLowerCase().trim();
const adminPassword = process.env.ADMIN_PASSWORD;

if (!url) {
  console.error('Missing NEON_DATABASE_URL (or TEST_DATABASE_URL).');
  process.exit(1);
}
if (!adminEmail) {
  console.error('Missing ADMIN_GOOGLE_EMAIL.');
  process.exit(1);
}

const pool = new Pool({ connectionString: url });

async function main() {
  const c = await pool.connect();
  try {
    const existing = await c.query(
      `SELECT id, is_admin FROM users WHERE email = $1`,
      [adminEmail],
    );

    if ((existing.rowCount ?? 0) > 0) {
      const row = existing.rows[0];
      if (row.is_admin) {
        console.log(`Admin already exists: ${adminEmail}`);
      } else {
        await c.query(`UPDATE users SET is_admin = true, updated_at = now() WHERE id = $1`, [row.id]);
        console.log(`Promoted existing user to admin: ${adminEmail}`);
      }
      if (adminPassword) {
        const ph = await argonHash(adminPassword);
        await c.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [ph, row.id]);
        console.log('  Password set/updated (email+password login enabled).');
      }
      return;
    }

    const passwordHash = adminPassword ? await argonHash(adminPassword) : null;
    await c.query(
      `INSERT INTO users (email, name, is_admin, email_verified, password_hash)
       VALUES ($1, $2, true, true, $3)`,
      [adminEmail, 'Admin', passwordHash],
    );
    console.log(`Created admin: ${adminEmail}`);
    if (passwordHash) {
      console.log('  Email+password login enabled (ADMIN_PASSWORD was set).');
    }
    console.log('  First Google sign-in with this email will link the Google account.');
  } finally {
    c.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

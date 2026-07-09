import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { NeonQueryFunction } from '@neondatabase/serverless';
import { hashPassword, verifyPassword } from './argon';

type SQL = NeonQueryFunction<false, false>;

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const TOTP_STEP_SECONDS = 30;
const TOTP_DIGITS = 6;

export interface AdminMfaRow {
  admin_id: string;
  totp_secret: string;
  enabled_at: string | null;
  recovery_code_hashes: string[];
}

export function generateTotpSecret(): string {
  return toBase32(randomBytes(20));
}

export function totpUri(input: { issuer: string; account: string; secret: string }): string {
  const label = `${input.issuer}:${input.account}`;
  const params = new URLSearchParams({
    secret: input.secret,
    issuer: input.issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}

export function verifyTotp(secret: string, code: string, now = Date.now()): boolean {
  const normalized = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(normalized)) return false;
  const counter = Math.floor(now / 1000 / TOTP_STEP_SECONDS);
  return [-1, 0, 1].some((offset) => safeEqual(normalized, totpCode(secret, counter + offset)));
}

export function totpCode(secret: string, counter = Math.floor(Date.now() / 1000 / TOTP_STEP_SECONDS)): string {
  const key = fromBase32(secret);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', key).update(msg).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary = ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

export async function getAdminMfa(sql: SQL, adminId: string): Promise<AdminMfaRow | null> {
  const rows = (await sql`
    SELECT admin_id, totp_secret, enabled_at, recovery_code_hashes
    FROM public.admin_mfa
    WHERE admin_id = ${adminId}::uuid
    LIMIT 1
  `) as AdminMfaRow[];
  return rows[0] ?? null;
}

export async function adminMfaEnabled(sql: SQL, adminId: string): Promise<boolean> {
  const row = await getAdminMfa(sql, adminId);
  return row?.enabled_at !== null && row?.enabled_at !== undefined;
}

export async function createAdminMfaChallenge(sql: SQL, input: {
  adminId: string;
  ip: string | null;
  userAgent: string | null;
}): Promise<string> {
  const rows = (await sql`
    INSERT INTO public.admin_mfa_challenges (admin_id, ip, user_agent)
    VALUES (${input.adminId}::uuid, ${input.ip}::inet, ${input.userAgent})
    RETURNING id
  `) as { id: string }[];
  return rows[0]!.id;
}

export async function consumeAdminMfaChallenge(sql: SQL, challengeId: string): Promise<{
  adminId: string;
  ip: string | null;
  userAgent: string | null;
} | null> {
  const rows = (await sql`
    UPDATE public.admin_mfa_challenges
    SET consumed_at = now()
    WHERE id = ${challengeId}::uuid
      AND consumed_at IS NULL
      AND expires_at > now()
    RETURNING admin_id, ip::text AS ip, user_agent
  `) as { admin_id: string; ip: string | null; user_agent: string | null }[];
  const row = rows[0];
  return row ? { adminId: row.admin_id, ip: row.ip, userAgent: row.user_agent } : null;
}

export async function generateRecoveryCodes(): Promise<{ codes: string[]; hashes: string[] }> {
  const codes = Array.from({ length: 10 }, () => `${randomChunk()}-${randomChunk()}`);
  const hashes = await Promise.all(codes.map((code) => hashPassword(normalizeRecoveryCode(code))));
  return { codes, hashes };
}

export async function consumeRecoveryCode(
  sql: SQL,
  adminId: string,
  recoveryCode: string,
  hashes: string[],
): Promise<boolean> {
  const normalized = normalizeRecoveryCode(recoveryCode);
  for (let i = 0; i < hashes.length; i++) {
    if (await verifyPassword(normalized, hashes[i] ?? null)) {
      const next = hashes.filter((_, idx) => idx !== i);
      await sql`
        UPDATE public.admin_mfa
        SET recovery_code_hashes = ${JSON.stringify(next)}::jsonb
        WHERE admin_id = ${adminId}::uuid
      `;
      return true;
    }
  }
  return false;
}

export function normalizeRecoveryCode(code: string): string {
  return code.trim().toLowerCase().replace(/\s+/g, '');
}

function toBase32(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

function fromBase32(secret: string): Buffer {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of secret.toUpperCase().replace(/=+$/g, '')) {
    const idx = BASE32.indexOf(ch);
    if (idx === -1) throw new Error('invalid_base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function safeEqual(a: string, b: string): boolean {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}

function randomChunk(): string {
  return randomBytes(4).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
}

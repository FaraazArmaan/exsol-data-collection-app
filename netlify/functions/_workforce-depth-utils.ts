import { jsonError } from './_shared/http';
import { db } from './_shared/db';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function readJson(req: Request): Promise<Record<string, unknown> | Response> {
  try {
    const body = await req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) return jsonError(400, 'invalid_json');
    return body as Record<string, unknown>;
  } catch {
    return jsonError(400, 'invalid_json');
  }
}

export function stringField(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === 'string' ? value.trim() : '';
}

export function nullableStringField(body: Record<string, unknown>, key: string): string | null {
  const value = stringField(body, key);
  return value || null;
}

export function optionalUuidField(body: Record<string, unknown>, key: string): string | Response | null {
  const value = nullableStringField(body, key);
  if (!value) return null;
  return UUID_RE.test(value) ? value : jsonError(400, `invalid_${key}`);
}

export function optionalUuidParam(value: string | null, key: string): string | Response | null {
  if (!value) return null;
  return UUID_RE.test(value) ? value : jsonError(400, `invalid_${key}`);
}

export function numberField(body: Record<string, unknown>, key: string): number | null {
  const value = body[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function booleanField(body: Record<string, unknown>, key: string, fallback = false): boolean {
  const value = body[key];
  return typeof value === 'boolean' ? value : fallback;
}

export function jsonBodyField(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (value && typeof value === 'object') return JSON.stringify(value);
  return '{}';
}

export async function resourceExists(clientId: string, resourceId: string): Promise<boolean> {
  if (!UUID_RE.test(resourceId)) return false;
  const sql = db();
  const rows = await sql`
    SELECT id
    FROM public.booking_resources
    WHERE id = ${resourceId}::uuid AND bucket_id = ${clientId}::uuid
    LIMIT 1
  ` as Array<{ id: string }>;
  return rows.length > 0;
}

export function dateOrToday(value: string | null): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : new Date().toISOString().slice(0, 10);
}

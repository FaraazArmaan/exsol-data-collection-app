import { getCurrentUser, type AuthedUser } from './session-manager.ts';

export function json(body: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(extraHeaders);
  headers.set('content-type', 'application/json');
  return new Response(JSON.stringify(body), { status, headers });
}

export function methodNotAllowed(): Response {
  return json({ error: 'method_not_allowed' }, 405);
}

export async function requireUser(req: Request): Promise<AuthedUser | Response> {
  const user = await getCurrentUser(req);
  if (!user) return json({ error: 'unauthenticated' }, 401);
  return user;
}

export async function requireAdmin(req: Request): Promise<AuthedUser | Response> {
  const u = await requireUser(req);
  if (u instanceof Response) return u;
  if (!u.isAdmin) return json({ error: 'forbidden' }, 403);
  return u;
}

export async function readJson<T = unknown>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

export function safeStr(value: unknown, max = 1000): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max) return null;
  return trimmed;
}

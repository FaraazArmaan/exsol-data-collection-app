import { jsonError } from './http';

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function rejectCrossSiteMutation(req: Request): Response | null {
  if (!UNSAFE.has(req.method.toUpperCase())) return null;

  const origin = req.headers.get('origin');
  if (!origin) return allowsNoOrigin(req) ? null : jsonError(403, 'csrf_origin_required');

  let source: string;
  try { source = new URL(origin).origin; } catch { return jsonError(403, 'csrf_origin_invalid'); }
  return allowedOrigins(req).has(source) ? null : jsonError(403, 'csrf_origin_mismatch');
}

function allowedOrigins(req: Request): Set<string> {
  const url = new URL(req.url);
  const host = req.headers.get('host') ?? url.host;
  const proto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || url.protocol.slice(0, -1);
  return new Set([url.origin, `${proto}://${host}`]);
}

function allowsNoOrigin(req: Request): boolean {
  if (process.env.VITEST === 'true' || process.env.NODE_ENV === 'test') return true;
  const host = req.headers.get('host') ?? new URL(req.url).host;
  const name = host.startsWith('[') ? host.slice(1, host.indexOf(']')) : host.split(':')[0]!;
  return name === 'localhost' || name === '127.0.0.1' || name === '::1';
}

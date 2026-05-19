import { opt } from './env.ts';

export const ACCESS_COOKIE_NAME = 'exsol_at';
export const REFRESH_COOKIE_NAME = 'exsol_rt';

const ACCESS_MAX_AGE = 15 * 60;
const REFRESH_MAX_AGE = 30 * 24 * 3600;
const REFRESH_PATH = '/api/auth/refresh';

const isProd = (): boolean => opt('NODE_ENV') === 'production';

function build(name: string, value: string, maxAge: number, path: string): string {
  const parts = [`${name}=${value}`, `Max-Age=${maxAge}`, `Path=${path}`, 'HttpOnly', 'SameSite=Lax'];
  if (isProd()) parts.push('Secure');
  return parts.join('; ');
}

export function setAccessCookie(token: string): string {
  return build(ACCESS_COOKIE_NAME, token, ACCESS_MAX_AGE, '/');
}

export function setRefreshCookie(token: string): string {
  return build(REFRESH_COOKIE_NAME, token, REFRESH_MAX_AGE, REFRESH_PATH);
}

export function clearAccessCookie(): string {
  return build(ACCESS_COOKIE_NAME, '', 0, '/');
}

export function clearRefreshCookie(): string {
  return build(REFRESH_COOKIE_NAME, '', 0, REFRESH_PATH);
}

export function parseCookies(header: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!header) return result;
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    result[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return result;
}

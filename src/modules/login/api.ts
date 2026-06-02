import { apiFetch } from '../../lib/api-client';

export type UnifiedLoginResponse =
  | { kind: 'admin';        admin: { id: string; email: string; display_name: string; is_bootstrap: boolean } }
  | { kind: 'bucket_user';  user: { id: string; email: string; must_change_password: boolean };
                            client: { id: string; slug: string; name: string } }
  | { kind: 'choice';       clients: Array<{ id: string; slug: string; name: string }> };

export const unifiedLogin = (email: string, password: string, client?: string) =>
  apiFetch<UnifiedLoginResponse>('/api/login', {
    method: 'POST',
    body: JSON.stringify({ email, password, ...(client ? { client } : {}) }),
  });

export const unifiedGoogleLogin = (idToken: string, client?: string) =>
  apiFetch<UnifiedLoginResponse>('/api/login', {
    method: 'POST',
    body: JSON.stringify({ idToken, ...(client ? { client } : {}) }),
  });

// Admin-mediated forgot password — flips a flag on matching credentials.
// Response is intentionally the same shape regardless of whether the email
// matches anything (no enumeration leak).
export const forgotPassword = (email: string, client?: string) =>
  apiFetch<{ ok: true; message: string }>('/api/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email, ...(client ? { client } : {}) }),
  });

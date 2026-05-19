export async function getJSON(path) {
  const res = await fetch(path, { credentials: 'include' });
  if (!res.ok && res.status !== 401) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

export async function postJSON(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export async function fetchMe() {
  return getJSON('/api/me');
}

export async function fetchConfig() {
  return getJSON('/api/config');
}

export async function signOut() {
  await postJSON('/api/auth/logout');
}

export function requireAuth(onUser) {
  fetchMe().then(({ user }) => {
    if (!user) {
      window.location.href = '/login.html';
      return;
    }
    onUser(user);
  });
}

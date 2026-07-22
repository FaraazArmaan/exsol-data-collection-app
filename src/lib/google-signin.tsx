// Wraps Google Identity Services (the script tag is in index.html).
// Renders the official Google button into a div ref; calls onCredential
// with the returned id_token JWT.
//
// Loads the client ID from /api/auth-config once per app lifetime.

import { useEffect, useRef, useState } from 'react';
import { apiFetch } from './api-client';

// Minimal Google JS API surface we use.
interface GoogleId {
  initialize: (config: { client_id: string; callback: (resp: { credential: string }) => void }) => void;
  renderButton: (el: HTMLElement, opts: { theme?: 'outline' | 'filled_blue' | 'filled_black'; size?: 'large' | 'medium' | 'small'; width?: number | string; text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin'; shape?: 'rectangular' | 'pill' }) => void;
}
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  interface Window {
    google?: { accounts: { id: GoogleId } };
  }
}

let cachedClientId: string | null = null;
let clientIdPromise: Promise<string | null> | null = null;

async function getGoogleClientId(): Promise<string | null> {
  if (cachedClientId) return cachedClientId;
  if (!clientIdPromise) {
    clientIdPromise = apiFetch<{ google_client_id: string }>('/api/auth-config').then((r) => {
      if (r.ok) { cachedClientId = r.data.google_client_id; return cachedClientId; }
      return null;
    });
  }
  return clientIdPromise;
}

interface Props {
  onCredential: (idToken: string) => void;
  text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
  width?: number;
}

export function GoogleSignInButton({ onCredential, text = 'signin_with', width = 320 }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const clientId = await getGoogleClientId();
      if (cancelled) return;
      if (!clientId) { setError('Google sign-in unavailable.'); return; }

      // Poll for Google JS to be ready (script is async/defer in index.html).
      const start = Date.now();
      while (!window.google?.accounts?.id) {
        if (cancelled) return;
        if (Date.now() - start > 5000) { setError('Google sign-in failed to load.'); return; }
        await new Promise((r) => setTimeout(r, 50));
      }

      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (resp) => { if (resp.credential) onCredential(resp.credential); },
      });
      if (ref.current) {
        ref.current.replaceChildren(); // clear previous render (hot-reload safe)
        window.google.accounts.id.renderButton(ref.current, {
          theme: 'outline',
          size: 'large',
          text,
          shape: 'rectangular',
          width: Math.min(width, ref.current.clientWidth || width),
        });
      }
    })();

    return () => { cancelled = true; };
  }, [onCredential, text, width]);

  if (error) return <p className="muted" style={{ fontSize: 12 }}>{error}</p>;
  return <div ref={ref} style={{ display: 'flex', justifyContent: 'center' }} />;
}

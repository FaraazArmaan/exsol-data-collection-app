import { useEffect, useMemo, useState } from 'react';

// Shown across the workspace when an admin is "viewing as client". Driven by the
// non-HttpOnly imp_ctx cookie that the admin sidebar sets on impersonation. Exit
// clears imp_ctx + the bu_session (via u-logout) and returns to the admin console.
function readImpCtx(): string | null {
  const m = document.cookie.split(/;\s*/).find((c) => c.startsWith('imp_ctx='));
  return m ? decodeURIComponent(m.slice('imp_ctx='.length)) : null;
}

function readImpActor(): string {
  const m = document.cookie.split(/;\s*/).find((c) => c.startsWith('imp_actor='));
  return m ? decodeURIComponent(m.slice('imp_actor='.length)) : 'admin';
}

function readImpStarted(): string | null {
  const m = document.cookie.split(/;\s*/).find((c) => c.startsWith('imp_started='));
  return m ? decodeURIComponent(m.slice('imp_started='.length)) : null;
}

function formatElapsed(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function ImpersonationBanner() {
  const [ctx] = useState(readImpCtx);
  const [actor] = useState(readImpActor);
  const startedAt = useMemo(() => {
    const raw = readImpStarted();
    const parsed = raw ? new Date(raw) : new Date();
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }, []);
  const [elapsed, setElapsed] = useState(0);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    if (!ctx) return undefined;
    const update = () => {
      setElapsed(Math.max(0, Math.floor((Date.now() - startedAt.getTime()) / 1000)));
    };
    update();
    const id = window.setInterval(update, 1000);
    return () => { window.clearInterval(id); };
  }, [ctx, startedAt]);

  useEffect(() => {
    if (!ctx) return undefined;
    const id = window.setInterval(() => {
      void fetch('/api/auth-me', { credentials: 'same-origin' });
    }, 5 * 60 * 1000);
    return () => { window.clearInterval(id); };
  }, [ctx]);

  if (!ctx) return null;

  async function exit() {
    setExiting(true);
    document.cookie = 'imp_ctx=; Path=/; Max-Age=0; SameSite=Lax';
    document.cookie = 'imp_actor=; Path=/; Max-Age=0; SameSite=Lax';
    document.cookie = 'imp_started=; Path=/; Max-Age=0; SameSite=Lax';
    try {
      await fetch('/api/admin-impersonation-exit', { method: 'POST', credentials: 'same-origin' });
    } catch { /* clear + leave anyway */ }
    window.location.href = '/';
  }

  return (
    <div className="imp-banner" role="status">
      <span>Viewing <strong>{ctx}</strong> as {actor} — changes you make are saved to this workspace.</span>
      <span className="imp-banner__timer">Session {formatElapsed(elapsed)}</span>
      <button type="button" className="imp-banner__exit" onClick={() => void exit()} disabled={exiting}>
        {exiting ? 'Exiting…' : 'Exit to admin'}
      </button>
    </div>
  );
}

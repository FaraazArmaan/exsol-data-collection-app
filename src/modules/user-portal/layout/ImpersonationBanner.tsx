import { useState } from 'react';

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

export function ImpersonationBanner() {
  const [ctx] = useState(readImpCtx);
  const [actor] = useState(readImpActor);
  const [exiting, setExiting] = useState(false);
  if (!ctx) return null;

  async function exit() {
    setExiting(true);
    document.cookie = 'imp_ctx=; Path=/; Max-Age=0; SameSite=Lax';
    document.cookie = 'imp_actor=; Path=/; Max-Age=0; SameSite=Lax';
    try { await fetch('/api/u-logout', { method: 'POST', credentials: 'same-origin' }); } catch { /* clear + leave anyway */ }
    window.location.href = '/';
  }

  return (
    <div className="imp-banner" role="status">
      <span>Viewing <strong>{ctx}</strong> as {actor} — changes you make are saved to this workspace.</span>
      <button type="button" className="imp-banner__exit" onClick={() => void exit()} disabled={exiting}>
        {exiting ? 'Exiting…' : 'Exit to admin'}
      </button>
    </div>
  );
}

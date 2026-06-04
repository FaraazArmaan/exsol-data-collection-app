// src/lib/use-admin-session-heartbeat.ts
//
// While mounted, ping /api/auth-me every 5 minutes to keep the admin session
// cookie refreshed. auth-me.ts calls mintSession() when claims are within
// 10 minutes of expiry, so a 5-minute interval guarantees the 15-minute
// admin JWT never approaches its hard expiry while a user is on a long-form
// admin surface (onboarding wizard, import preview).
//
// Used by: OnboardClientWizard, OnboardClientImportPreview.

import { useEffect } from 'react';

const HEARTBEAT_MS = 5 * 60 * 1000;

export function useAdminSessionHeartbeat(): void {
  useEffect(() => {
    const id = window.setInterval(() => {
      void fetch('/api/auth-me', { credentials: 'same-origin' });
    }, HEARTBEAT_MS);
    return () => { window.clearInterval(id); };
  }, []);
}

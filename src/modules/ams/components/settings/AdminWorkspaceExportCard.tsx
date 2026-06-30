import { useState } from 'react';

// Mirrors isoFilenameStamp in netlify/functions/_shared/workspace-export-format.ts
// AND in WorkspaceExportCard.tsx (the bucket-user sibling). If the format
// changes here, change it there too — the server uses the same stamp for
// the Content-Disposition filename.
function isoFilenameStamp(d: Date): string {
  const iso = d.toISOString();
  return `${iso.slice(0, 10).replace(/-/g, '')}T${iso.slice(11, 19).replace(/:/g, '')}Z`;
}

interface Props {
  /** UUID of the client whose workspace data to export. */
  clientId: string;
  /** Workspace slug used for the download filename. */
  slug: string;
}

/**
 * Admin-side workspace backup card. Mounted on `/clients/:clientId` so admins
 * see the same affordance as bucket-users do on `/c/:slug/account`.
 *
 * Differs from WorkspaceExportCard in two ways:
 *   - No useUserAuth call; admins use a different session context.
 *   - Requires explicit `?client=<clientId>` since admin sessions aren't
 *     workspace-scoped at the JWT level.
 *
 * No FE permission gate — server-side authenticateForPermission decides.
 */
export default function AdminWorkspaceExportCard({ clientId, slug }: Props) {
  const [busy, setBusy] = useState<'json' | 'zip' | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function download(format: 'json' | 'zip') {
    setBusy(format);
    setErr(null);
    try {
      const res = await fetch(
        `/api/workspace-export?format=${format}&client=${encodeURIComponent(clientId)}`,
        { credentials: 'include' },
      );
      if (!res.ok) {
        if (res.status === 413) setErr('Workspace is too large to export in one file. Try removing old data or contact the ExSol team.');
        else setErr(`Export failed (${res.status}).`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `workspace-${slug || 'workspace'}-${isoFilenameStamp(new Date())}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setErr('Network error. Try again.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="ams-export-card">
      <h3>Workspace backup</h3>
      <p>
        Download a snapshot of this workspace's data as an admin. Includes users,
        structure, files metadata, and products metadata. Passwords are never included.
      </p>
      <div className="ams-export-card-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy !== null}
          aria-busy={busy !== null}
          onClick={() => download('json')}
        >
          {busy === 'json' ? 'Preparing…' : 'Download JSON'}
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy !== null}
          aria-busy={busy !== null}
          onClick={() => download('zip')}
        >
          {busy === 'zip' ? 'Preparing…' : 'Download ZIP'}
        </button>
      </div>
      {err && <p className="ams-export-card-error" role="alert">{err}</p>}
    </section>
  );
}

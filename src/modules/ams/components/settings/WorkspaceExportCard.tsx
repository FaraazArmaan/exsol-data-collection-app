import { useState } from 'react';
import { useUserAuth } from '../../../user-portal/user-auth-context';

function canExport(
  permissions: Record<string, true>,
  level_number: number | null | undefined,
): boolean {
  if (level_number == null || level_number === 1) return true;
  return permissions['_platform.workspace.view'] === true;
}

function isoFilenameStamp(d: Date): string {
  const iso = d.toISOString();
  return `${iso.slice(0, 10).replace(/-/g, '')}T${iso.slice(11, 19).replace(/:/g, '')}Z`;
}

export default function WorkspaceExportCard() {
  const { permissions, user, client } = useUserAuth();
  const [busy, setBusy] = useState<'json' | 'zip' | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (!canExport(permissions, (user as { level_number?: number | null }).level_number)) {
    return null;
  }

  async function download(format: 'json' | 'zip') {
    setBusy(format);
    setErr(null);
    try {
      const res = await fetch(`/api/workspace-export?format=${format}`, {
        credentials: 'include',
      });
      if (!res.ok) {
        if (res.status === 413) setErr('Workspace is too large to export in one file. Contact support.');
        else setErr(`Export failed (${res.status}).`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `workspace-${client?.slug ?? 'workspace'}-${isoFilenameStamp(new Date())}.${format}`;
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
        Download a snapshot of this workspace's data. Includes users, structure,
        files metadata, and products metadata. Passwords are never included.
      </p>
      <div className="ams-export-card-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy !== null}
          onClick={() => download('json')}
        >
          {busy === 'json' ? 'Preparing…' : 'Download JSON'}
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy !== null}
          onClick={() => download('zip')}
        >
          {busy === 'zip' ? 'Preparing…' : 'Download ZIP'}
        </button>
      </div>
      {err && <p className="ams-export-card-error">{err}</p>}
    </section>
  );
}

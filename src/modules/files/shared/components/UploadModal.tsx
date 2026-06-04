import { useState } from 'react';
import type { CategoryKey } from '../categories';
import { CATEGORY_KEYS, CATEGORY_LABELS, MAX_CATEGORIES_PER_FILE } from '../categories';
import type { FileTier } from '../types';
import { reserveUploadUrl, uploadBytes, commitFile, ApiError } from '../api';
import { TierPicker } from './TierPicker';

interface Props {
  clientId: string | null;
  isL1Owner: boolean;
  isAdminVault: boolean;
  initialFile?: File | null;
  onClose: () => void;
  onUploaded: () => void;
}

export function UploadModal({ clientId, isL1Owner, isAdminVault, initialFile, onClose, onUploaded }: Props) {
  const [mode, setMode] = useState<'file' | 'url'>('file');
  const [pickedFile, setPickedFile] = useState<File | null>(initialFile ?? null);
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [categories, setCategories] = useState<CategoryKey[]>([]);
  const [tier, setTier] = useState<FileTier>('public');
  const [allowedRoleIds, setAllowedRoleIds] = useState<string[]>([]);
  const [allowedNodeIds, setAllowedNodeIds] = useState<string[]>([]);
  const [allowedUserNodeIds, setAllowedUserNodeIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleCategory(c: CategoryKey) {
    setCategories((prev) => {
      if (prev.includes(c)) return prev.filter((x) => x !== c);
      if (prev.length >= MAX_CATEGORIES_PER_FILE) return prev;
      return [...prev, c];
    });
  }

  async function submit() {
    setBusy(true); setError(null);
    try {
      if (!title) throw new ApiError(400, { error: { code: 'title_required' } });
      if (categories.length === 0) throw new ApiError(400, { error: { code: 'category_required' } });

      if (mode === 'file') {
        if (!pickedFile) throw new ApiError(400, { error: { code: 'file_required' } });
        const { blob_key, upload_token } = await reserveUploadUrl({
          name: pickedFile.name, type: pickedFile.type || 'application/octet-stream', size: pickedFile.size,
        });
        await uploadBytes(upload_token, pickedFile.type || 'application/octet-stream', pickedFile);
        await commitFile({
          blob_key,
          title,
          description: description || undefined,
          mime: pickedFile.type, byte_size: pickedFile.size, filename: pickedFile.name,
          categories, tier,
          allowed_role_ids: tier === 'role' ? allowedRoleIds : undefined,
          allowed_node_ids: tier === 'restricted' ? allowedNodeIds : undefined,
          allowed_user_node_ids: tier === 'confidential' ? allowedUserNodeIds : undefined,
        });
      } else {
        if (!url) throw new ApiError(400, { error: { code: 'url_required' } });
        await commitFile({
          external_url: url,
          title,
          description: description || undefined,
          categories, tier,
          allowed_role_ids: tier === 'role' ? allowedRoleIds : undefined,
          allowed_node_ids: tier === 'restricted' ? allowedNodeIds : undefined,
          allowed_user_node_ids: tier === 'confidential' ? allowedUserNodeIds : undefined,
        });
      }
      onUploaded();
      onClose();
    } catch (e) {
      const detail = (e as ApiError).detail as { error?: { code?: string } } | null;
      setError(detail?.error?.code ?? (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
      <div style={{ background: '#000', border: '1px solid #222', borderRadius: 8, padding: 24, width: 560, maxHeight: '90vh', overflow: 'auto' }}>
        <h3 style={{ marginTop: 0 }}>Upload</h3>

        <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
          <button type="button" onClick={() => setMode('file')} style={{ fontWeight: mode === 'file' ? 700 : 400 }}>File</button>
          <button type="button" onClick={() => setMode('url')} style={{ fontWeight: mode === 'url' ? 700 : 400 }}>URL</button>
        </div>

        {mode === 'file'
          ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <input type="file" onChange={(e) => setPickedFile(e.target.files?.[0] ?? null)} />
              {pickedFile && <span style={{ fontSize: 12, color: '#888' }}>{pickedFile.name}</span>}
            </div>
          )
          : <input placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} style={{ width: '100%', padding: 8 }} />}

        <label style={{ display: 'block', marginTop: 12 }}>
          Title <input value={title} onChange={(e) => setTitle(e.target.value)} style={{ width: '100%', padding: 6 }} />
        </label>
        <label style={{ display: 'block', marginTop: 8 }}>
          Description <textarea value={description} onChange={(e) => setDescription(e.target.value)} style={{ width: '100%', padding: 6, minHeight: 50 }} />
        </label>

        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>Categories (up to {MAX_CATEGORIES_PER_FILE}):</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {CATEGORY_KEYS.map((c) => {
              const on = categories.includes(c);
              return (
                <button
                  key={c} type="button"
                  onClick={() => toggleCategory(c)}
                  style={{
                    fontSize: 11, padding: '4px 10px', borderRadius: 12,
                    background: on ? '#2c5f2d' : '#1a1a1a',
                    color: on ? '#fff' : '#888',
                    border: 'none', cursor: 'pointer',
                  }}
                >{CATEGORY_LABELS[c]}</button>
              );
            })}
          </div>
        </div>

        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>Security tier:</div>
          <TierPicker
            clientId={clientId}
            tier={tier}
            onTierChange={setTier}
            allowedRoleIds={allowedRoleIds} onAllowedRoleIdsChange={setAllowedRoleIds}
            allowedNodeIds={allowedNodeIds} onAllowedNodeIdsChange={setAllowedNodeIds}
            allowedUserNodeIds={allowedUserNodeIds} onAllowedUserNodeIdsChange={setAllowedUserNodeIds}
            isL1Owner={isL1Owner} isAdminVault={isAdminVault}
          />
        </div>

        {error && <p style={{ color: '#c66', marginTop: 12 }}>{error}</p>}

        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 18 }}>
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" onClick={submit} disabled={busy} style={{ background: '#fff', color: '#000', padding: '6px 14px' }}>
            {busy ? 'Uploading…' : 'Upload'}
          </button>
        </div>
      </div>
    </div>
  );
}

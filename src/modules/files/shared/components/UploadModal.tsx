import { useState } from 'react';
import type { CSSProperties } from 'react';
import type { CategoryKey } from '../categories';
import { CATEGORY_KEYS, CATEGORY_LABELS, MAX_CATEGORIES_PER_FILE } from '../categories';
import { CATEGORY_COLORS } from '../category-colors';
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
    <div className="fm-modal__scrim" onClick={onClose}>
      <div className="fm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="fm-modal__head">
          <h3>Upload file</h3>
          <button type="button" className="fm-modal__x" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="fm-modal__body">
          <div className="fm-seg">
            <button type="button" className={mode === 'file' ? 'is-active' : ''} onClick={() => setMode('file')}>File</button>
            <button type="button" className={mode === 'url' ? 'is-active' : ''} onClick={() => setMode('url')}>Link / URL</button>
          </div>

          {mode === 'file'
            ? (
              <div className="fm-field">
                <input type="file" className="fm-input" onChange={(e) => setPickedFile(e.target.files?.[0] ?? null)} />
                {pickedFile && <span className="fm-modal__meta">{pickedFile.name} · {(pickedFile.size / 1024).toFixed(1)} KB</span>}
              </div>
            )
            : (
              <div className="fm-field">
                <span className="fm-field__label">External URL</span>
                <input className="fm-input" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} />
              </div>
            )}

          <div className="fm-field">
            <span className="fm-field__label">Title</span>
            <input className="fm-input" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="fm-field">
            <span className="fm-field__label">Description</span>
            <textarea className="fm-textarea" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          <div className="fm-field">
            <span className="fm-field__label">Categories (up to {MAX_CATEGORIES_PER_FILE})</span>
            <div className="fm-filters" style={{ margin: 0 }}>
              {CATEGORY_KEYS.map((c) => {
                const on = categories.includes(c);
                return (
                  <button
                    key={c} type="button"
                    className={`fm-chip${on ? ' is-on' : ''}`}
                    aria-pressed={on}
                    style={{ '--chip-color': CATEGORY_COLORS[c] } as CSSProperties}
                    onClick={() => toggleCategory(c)}
                  >
                    <span className="fm-chip__dot" />
                    {CATEGORY_LABELS[c]}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="fm-field">
            <span className="fm-field__label">Security tier</span>
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

          {error && <p className="fm-error">{error}</p>}
        </div>

        <div className="fm-modal__foot">
          <span className="fm-spacer" />
          <button type="button" className="fm-btn fm-btn--ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="fm-btn fm-btn--primary" onClick={submit} disabled={busy}>
            {busy ? 'Uploading…' : 'Upload'}
          </button>
        </div>
      </div>
    </div>
  );
}

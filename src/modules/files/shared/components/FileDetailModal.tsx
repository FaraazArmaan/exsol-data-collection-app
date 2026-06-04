import { useEffect, useState } from 'react';
import type { CategoryKey } from '../categories';
import { CATEGORY_KEYS, CATEGORY_LABELS } from '../categories';
import type { FileRow, FileTier } from '../types';
import { deleteFile, getFile, patchFile } from '../api';
import { TierBadge } from './TierBadge';

interface Props {
  id: string;
  isL1Owner: boolean;
  isAdminVault: boolean;
  clientId: string | null;
  onClose: () => void;
  onChanged: () => void;
}

export function FileDetailModal(p: Props) {
  const [file, setFile] = useState<FileRow | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [categories, setCategories] = useState<CategoryKey[]>([]);
  const [tier, setTier] = useState<FileTier>('public');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getFile(p.id).then(({ file: f }) => {
      setFile(f);
      setTitle(f.title);
      setDescription(f.description ?? '');
      setCategories((f.categories ?? []) as CategoryKey[]);
      setTier(f.tier);
    }).catch(() => setFile(null));
  }, [p.id]);

  async function save() {
    setBusy(true);
    try {
      await patchFile(p.id, { title, description, categories, tier });
      p.onChanged();
      p.onClose();
    } finally { setBusy(false); }
  }

  async function remove(hard: boolean) {
    if (!confirm(hard ? 'Permanently delete this file?' : 'Move to trash?')) return;
    setBusy(true);
    try {
      await deleteFile(p.id, hard);
      p.onChanged();
      p.onClose();
    } finally { setBusy(false); }
  }

  if (!file) return null;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
      <div style={{ background: '#000', border: '1px solid #222', borderRadius: 8, padding: 24, width: 720, maxHeight: '90vh', overflow: 'auto' }}>
        <h3 style={{ marginTop: 0 }}>{file.title} <TierBadge tier={file.tier} /></h3>

        <div style={{ marginBottom: 16, color: '#888', fontSize: 12 }}>
          {file.type} · {file.byte_size ? `${(file.byte_size / 1024).toFixed(1)} KB` : '—'} · {new Date(file.created_at).toLocaleString()}
        </div>

        <label style={{ display: 'block', marginTop: 8 }}>
          Title <input value={title} onChange={(e) => setTitle(e.target.value)} style={{ width: '100%', padding: 6 }} />
        </label>
        <label style={{ display: 'block', marginTop: 8 }}>
          Description <textarea value={description} onChange={(e) => setDescription(e.target.value)} style={{ width: '100%', padding: 6, minHeight: 60 }} />
        </label>

        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>Categories:</div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {CATEGORY_KEYS.map((c) => {
              const on = categories.includes(c);
              return (
                <button
                  key={c} type="button"
                  onClick={() => setCategories((prev) => on ? prev.filter((x) => x !== c) : prev.length < 3 ? [...prev, c] : prev)}
                  style={{
                    fontSize: 11, padding: '4px 10px', borderRadius: 12,
                    background: on ? '#2c5f2d' : '#1a1a1a', color: on ? '#fff' : '#888',
                    border: 'none', cursor: 'pointer',
                  }}
                >{CATEGORY_LABELS[c]}</button>
              );
            })}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12, justifyContent: 'space-between', marginTop: 20 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => remove(false)} disabled={busy}>Move to trash</button>
            <button type="button" onClick={() => remove(true)} disabled={busy} style={{ color: '#c66' }}>Delete permanently</button>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <button type="button" onClick={p.onClose}>Cancel</button>
            <button type="button" onClick={save} disabled={busy} style={{ background: '#fff', color: '#000', padding: '6px 14px' }}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

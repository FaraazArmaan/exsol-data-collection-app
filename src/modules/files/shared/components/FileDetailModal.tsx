import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import type { CategoryKey } from '../categories';
import { CATEGORY_KEYS, CATEGORY_LABELS } from '../categories';
import { CATEGORY_COLORS } from '../category-colors';
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
    <div className="fm-modal__scrim" onClick={p.onClose}>
      <div className="fm-modal fm-modal--wide" onClick={(e) => e.stopPropagation()}>
        <div className="fm-modal__head">
          <h3>{file.title}</h3>
          <TierBadge tier={file.tier} />
          <button type="button" className="fm-modal__x" onClick={p.onClose} aria-label="Close">×</button>
        </div>

        <div className="fm-modal__body">
          <span className="fm-modal__meta">
            {file.type} · {file.byte_size ? `${(file.byte_size / 1024).toFixed(1)} KB` : '—'} · {new Date(file.created_at).toLocaleString()}
          </span>

          <div className="fm-field">
            <span className="fm-field__label">Title</span>
            <input className="fm-input" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="fm-field">
            <span className="fm-field__label">Description</span>
            <textarea className="fm-textarea" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          <div className="fm-field">
            <span className="fm-field__label">Categories</span>
            <div className="fm-filters" style={{ margin: 0 }}>
              {CATEGORY_KEYS.map((c) => {
                const on = categories.includes(c);
                return (
                  <button
                    key={c} type="button"
                    className={`fm-chip${on ? ' is-on' : ''}`}
                    aria-pressed={on}
                    style={{ '--chip-color': CATEGORY_COLORS[c] } as CSSProperties}
                    onClick={() => setCategories((prev) => on ? prev.filter((x) => x !== c) : prev.length < 3 ? [...prev, c] : prev)}
                  >
                    <span className="fm-chip__dot" />
                    {CATEGORY_LABELS[c]}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="fm-modal__foot fm-modal__foot--split">
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="fm-btn" onClick={() => remove(false)} disabled={busy}>Move to trash</button>
            <button type="button" className="fm-btn fm-btn--danger" onClick={() => remove(true)} disabled={busy}>Delete permanently</button>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" className="fm-btn fm-btn--ghost" onClick={p.onClose}>Cancel</button>
            <button type="button" className="fm-btn fm-btn--primary" onClick={save} disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

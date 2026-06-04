import type { FileRow, FileType } from '../types';
import { FileTile } from './FileTile';

interface Props {
  files: FileRow[];
  activeType: FileType | null;
  onTypeChange: (t: FileType | null) => void;
  onOpen: (file: FileRow) => void;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
}

const TYPES: FileType[] = ['document', 'image', 'video', 'audio', 'external'];
const TYPE_LABEL: Record<FileType, string> = {
  document: 'Docs', image: 'Images', video: 'Videos', audio: 'Audio', external: 'External',
};

export function FileGrid(p: Props) {
  return (
    <div>
      <div style={{ display: 'flex', borderBottom: '1px solid #222' }}>
        {TYPES.map((t) => (
          <button
            key={t} type="button"
            onClick={() => p.onTypeChange(t)}
            style={{
              padding: '8px 16px',
              background: p.activeType === t ? '#1a1a1a' : 'transparent',
              color: p.activeType === t ? '#fff' : '#888',
              border: 'none', borderBottom: p.activeType === t ? '2px solid #fff' : 'none',
              cursor: 'pointer',
            }}
          >{TYPE_LABEL[t]}</button>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10, marginTop: 14 }}>
        {p.files.map((f) => (
          <FileTile
            key={f.id} file={f}
            selected={p.selectedIds?.has(f.id)}
            onClick={() => p.onOpen(f)}
            onToggleSelect={p.onToggleSelect ? () => p.onToggleSelect!(f.id) : undefined}
          />
        ))}
      </div>
      {p.files.length === 0 && <p style={{ color: '#666', textAlign: 'center', marginTop: 30 }}>No files.</p>}
    </div>
  );
}

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
  document: 'Documents', image: 'Images', video: 'Videos', audio: 'Audio', external: 'External',
};

export function FileGrid(p: Props) {
  return (
    <div>
      <div className="fm-tabs" role="tablist">
        {TYPES.map((t) => (
          <button
            key={t} type="button" role="tab"
            aria-selected={p.activeType === t}
            onClick={() => p.onTypeChange(t)}
          >{TYPE_LABEL[t]}</button>
        ))}
      </div>
      <div className="fm-grid">
        {p.files.map((f) => (
          <FileTile
            key={f.id} file={f}
            selected={p.selectedIds?.has(f.id)}
            onClick={() => p.onOpen(f)}
            onToggleSelect={p.onToggleSelect ? () => p.onToggleSelect!(f.id) : undefined}
          />
        ))}
        {p.files.length === 0 && (
          <div className="fm-empty">
            <span className="fm-empty__glyph">🗂</span>
            <span>No files here yet</span>
            <span className="fm-empty__hint">Upload a file or drag one onto this page to get started.</span>
          </div>
        )}
      </div>
    </div>
  );
}

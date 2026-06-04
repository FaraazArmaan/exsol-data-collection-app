import type { FileRow } from '../types';
import { TierBadge } from './TierBadge';

const TYPE_ICON: Record<FileRow['type'], string> = {
  document: '📄', image: '🖼', video: '🎬', audio: '🎵', external: '🔗',
};

interface Props {
  file: FileRow;
  selected?: boolean;
  onClick?: () => void;
  onToggleSelect?: () => void;
}

export function FileTile({ file, selected, onClick, onToggleSelect }: Props) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', flexDirection: 'column', gap: 6, padding: 12,
        background: selected ? '#1a1a1a' : '#0a0a0a',
        border: `1px solid ${selected ? '#fff' : '#222'}`,
        borderRadius: 6, cursor: 'pointer', minHeight: 110,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 28 }}>{TYPE_ICON[file.type]}</span>
        {onToggleSelect && (
          <input
            type="checkbox"
            checked={!!selected}
            onChange={(e) => { e.stopPropagation(); onToggleSelect(); }}
            onClick={(e) => e.stopPropagation()}
          />
        )}
      </div>
      <div style={{ fontSize: 13, color: '#ddd', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {file.title}
      </div>
      <TierBadge tier={file.tier} />
    </div>
  );
}

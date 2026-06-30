import type { FileRow } from '../types';
import { TierBadge } from './TierBadge';

const TYPE_GLYPH: Record<FileRow['type'], string> = {
  document: '📄', image: '🖼', video: '🎬', audio: '🎵', external: '🔗',
};

interface Props {
  file: FileRow;
  selected?: boolean;
  onClick?: () => void;
  onToggleSelect?: () => void;
}

export function FileTile({ file, selected, onClick, onToggleSelect }: Props) {
  const showThumb = file.type === 'image';
  return (
    <div
      className={`fm-tile${selected ? ' is-selected' : ''}`}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(); } }}
    >
      {onToggleSelect && (
        <input
          type="checkbox"
          className="fm-tile__check"
          checked={!!selected}
          onChange={(e) => { e.stopPropagation(); onToggleSelect(); }}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Select ${file.title}`}
        />
      )}
      <div className="fm-tile__thumb">
        {showThumb
          ? <img src={`/api/files-thumbnail/${file.id}`} alt="" loading="lazy" />
          : <span className="fm-tile__glyph">{TYPE_GLYPH[file.type]}</span>}
      </div>
      <div className="fm-tile__body">
        <div className="fm-tile__title" title={file.title}>{file.title}</div>
        <div className="fm-tile__foot">
          <TierBadge tier={file.tier} />
        </div>
      </div>
    </div>
  );
}

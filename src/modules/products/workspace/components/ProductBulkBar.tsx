import type { ProductStatus } from '../../shared/types';

export function ProductBulkBar(props: {
  count: number;
  canEdit: boolean;
  canDelete: boolean;
  onSetStatus: (s: ProductStatus) => void;
  onClear: () => void;
}) {
  const { count, canEdit, canDelete, onSetStatus, onClear } = props;
  if (count === 0) return null;

  return (
    <div className="pm-bulkbar" role="region" aria-label="Bulk actions">
      <b>{count} selected</b>
      {canEdit && (
        <>
          <button type="button" onClick={() => onSetStatus('draft')}>Move to Draft</button>
          <button type="button" onClick={() => onSetStatus('active')}>Move to Active</button>
        </>
      )}
      {canDelete && (
        <button type="button" className="pm-danger" onClick={() => onSetStatus('archived')}>
          Archive
        </button>
      )}
      <button type="button" className="pm-link" onClick={onClear}>Clear</button>
    </div>
  );
}

import { CATEGORY_KEYS, CATEGORY_LABELS, type CategoryKey } from '../categories';
import type { BulkAction } from '../types';

interface Props {
  selectedIds: string[];
  isL1Owner: boolean;
  onAction: (a: BulkAction) => void;
  onClear: () => void;
}

export function BulkActionBar({ selectedIds, isL1Owner, onAction, onClear }: Props) {
  if (selectedIds.length === 0) return null;
  const ids = selectedIds;
  return (
    <div className="fm-bulkbar" role="toolbar" aria-label="Bulk actions">
      <span className="fm-bulkbar__count">{ids.length} selected</span>
      <span className="fm-bulkbar__sep" />
      <button type="button" className="fm-btn" onClick={() => onAction({ action: 'soft_delete', file_ids: ids })}>Delete</button>
      <button type="button" className="fm-btn" onClick={() => onAction({ action: 'restore', file_ids: ids })}>Restore</button>
      <select
        aria-label="Add category" defaultValue=""
        onChange={(e) => { if (e.target.value) { onAction({ action: 'add_category', file_ids: ids, category: e.target.value as CategoryKey }); e.target.value = ''; } }}
      >
        <option value="">+ Category…</option>
        {CATEGORY_KEYS.map((k) => <option key={k} value={k}>{CATEGORY_LABELS[k]}</option>)}
      </select>
      <select
        aria-label="Change tier" defaultValue=""
        onChange={(e) => { if (e.target.value) { onAction({ action: 'change_tier', file_ids: ids, tier: e.target.value as never }); e.target.value = ''; } }}
      >
        <option value="">Set tier…</option>
        <option value="public">Public</option>
        <option value="role">Role</option>
        {isL1Owner && <option value="restricted">Restricted</option>}
        {isL1Owner && <option value="confidential">Confidential</option>}
      </select>
      <span className="fm-bulkbar__sep" />
      <button type="button" className="fm-btn fm-btn--ghost" onClick={onClear}>Clear</button>
    </div>
  );
}

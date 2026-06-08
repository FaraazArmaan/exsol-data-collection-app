// Placeholder — fully implemented in T20.
// Keeping the export signature stable so the list page wiring (T17) is complete.

export function ProductImportModal(props: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  if (!props.open) return null;
  return (
    <div className="pm-modal-backdrop" onClick={props.onClose}>
      <div className="pm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="pm-modal-header">
          <h3>Import Products</h3>
          <button type="button" onClick={props.onClose} aria-label="Close">✕</button>
        </div>
        <div className="pm-modal-body">
          <p className="pm-muted">Import UI coming soon.</p>
        </div>
        <div className="pm-modal-footer">
          <button type="button" onClick={props.onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

import { useState, useEffect } from 'react';
import type { DrillType, DrillResponse, MovementRow, PoItemRow, BomRow } from '../shared/types';
import { fetchDrill } from '../shared/api';

interface Props {
  type: DrillType;
  id: string;
  onClose: () => void;
  colSpan: number;
}

function centsToDisplay(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function shortId(uuid: string): string {
  return uuid.slice(0, 8);
}

function MovementsTable({ rows }: { rows: MovementRow[] }) {
  return (
    <table className="sc-drill-table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Type</th>
          <th>Qty delta</th>
          <th>Ref</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td>{r.date}</td>
            <td>{r.type}</td>
            <td>{r.qtyDelta > 0 ? `+${r.qtyDelta}` : String(r.qtyDelta)}</td>
            <td>{r.ref ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PoItemsTable({ rows }: { rows: PoItemRow[] }) {
  return (
    <table className="sc-drill-table">
      <thead>
        <tr>
          <th>Product</th>
          <th>Qty</th>
          <th>Unit cost</th>
          <th>Line total</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td>{r.product}</td>
            <td>{r.qty}</td>
            <td>{centsToDisplay(r.unitCostCents)}</td>
            <td>{centsToDisplay(r.lineTotalCents)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function BomTable({ rows }: { rows: BomRow[] }) {
  return (
    <table className="sc-drill-table">
      <thead>
        <tr>
          <th>Component</th>
          <th>Qty</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td>{r.component}</td>
            <td>{r.qty}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function DrillPanel({ type, id, onClose, colSpan }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [data, setData] = useState<DrillResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    setData(null);
    fetchDrill(type, id)
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(true);
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [type, id]);

  let content: React.ReactNode;
  if (loading) {
    content = <span className="sc-drill-loading">Loading…</span>;
  } else if (error) {
    content = <span className="sc-drill-error">Failed to load detail.</span>;
  } else if (!data || data.rows.length === 0) {
    content = <span className="sc-drill-empty">No detail rows.</span>;
  } else if (type === 'product-movements') {
    content = <MovementsTable rows={data.rows as MovementRow[]} />;
  } else if (type === 'po-items') {
    content = <PoItemsTable rows={data.rows as PoItemRow[]} />;
  } else {
    content = <BomTable rows={data.rows as BomRow[]} />;
  }

  return (
    <tr>
      <td colSpan={colSpan} className="sc-drill-cell">
        <div className="sc-drill-panel">
          <button className="sc-drill-close" onClick={onClose} aria-label="Close detail">×</button>
          {content}
        </div>
      </td>
    </tr>
  );
}
